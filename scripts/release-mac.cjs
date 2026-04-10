#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(command, options = {}) {
  console.log(`[release-mac] $ ${command}`)
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true,
    ...options
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function runCapture(command) {
  const result = spawnSync(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    encoding: 'utf8'
  })

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  }
}

function fail(message) {
  console.error(`[release-mac] FAIL: ${message}`)
  process.exit(1)
}

function info(message) {
  console.log(`[release-mac] ${message}`)
}

function cleanReleaseDir(rootDir) {
  const releaseDir = path.join(rootDir, 'release')
  fs.rmSync(releaseDir, { recursive: true, force: true })
  fs.mkdirSync(releaseDir, { recursive: true })
  info(`Cleaned release directory: ${releaseDir}`)
}

function resolveMacArch() {
  const requested = String(process.env.MAC_ARCH || process.arch || 'arm64').trim().toLowerCase()
  if (requested === 'arm64' || requested === 'x64') return requested
  fail(`Unsupported mac arch: ${requested}`)
}

function loadPublishTarget(rootDir) {
  const configPath = path.join(rootDir, 'electron-builder.json')
  if (!fs.existsSync(configPath)) {
    fail(`Missing electron-builder.json in ${rootDir}`)
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const githubTarget = Array.isArray(config.publish)
    ? config.publish.find((entry) => entry && entry.provider === 'github')
    : null
  if (!githubTarget?.owner || !githubTarget?.repo) {
    fail('Cannot resolve GitHub publish target from electron-builder.json')
  }
  return githubTarget
}

function readLatestMacArtifacts(rootDir) {
  const releaseDir = path.join(rootDir, 'release')
  const latestMacYmlPath = path.join(releaseDir, 'latest-mac.yml')
  if (!fs.existsSync(latestMacYmlPath)) {
    fail(`Missing latest-mac.yml after local build: ${latestMacYmlPath}`)
  }

  const latestMacYml = fs.readFileSync(latestMacYmlPath, 'utf8')
  const pathLine = latestMacYml
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith('path: '))
  if (!pathLine) {
    fail('Cannot find "path:" entry in latest-mac.yml')
  }

  const zipName = pathLine.replace(/^.*path:\s*/, '').trim()
  const dmgName =
    fs.readdirSync(releaseDir).find((name) => name.endsWith('.dmg')) || null

  return {
    releaseDir,
    latestMacYmlName: 'latest-mac.yml',
    zipName,
    dmgName
  }
}

function verifyPublishedAssets({ tagName, owner, repo, requiredAssets }) {
  const result = runCapture(`gh release view ${tagName} --repo ${owner}/${repo} --json assets`)
  if (!result.ok) {
    fail(`Cannot verify published release assets for ${tagName}. ${result.stderr || result.stdout}`)
  }

  let parsed
  try {
    parsed = JSON.parse(result.stdout || '{}')
  } catch (error) {
    fail(`Cannot parse gh release view output: ${error instanceof Error ? error.message : String(error)}`)
  }

  const assetNames = new Set(
    Array.isArray(parsed.assets) ? parsed.assets.map((asset) => String(asset?.name || '').trim()).filter(Boolean) : []
  )

  for (const assetName of requiredAssets) {
    if (!assetNames.has(assetName)) {
      fail(`Published release ${tagName} is missing required asset: ${assetName}`)
    }
  }
}

if (!process.env.GH_TOKEN) {
  fail('GH_TOKEN is missing. Set it first, then rerun.')
}

const rootDir = process.cwd()
const packageJsonPath = path.join(rootDir, 'package.json')
if (!fs.existsSync(packageJsonPath)) {
  fail(`Missing package.json in ${rootDir}`)
}

const arch = resolveMacArch()
const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const tagName = `v${version}`
const { owner, repo } = loadPublishTarget(rootDir)

const branchResult = runCapture('git branch --show-current')
if (!branchResult.ok) {
  fail('Cannot detect current git branch.')
}
if (branchResult.stdout !== 'main') {
  fail(`Release must run on main branch. Current branch: ${branchResult.stdout}`)
}

const dirtyResult = runCapture('git status --porcelain')
if (!dirtyResult.ok) {
  fail('Cannot read git working tree state.')
}
if (dirtyResult.stdout.length > 0) {
  fail('Working tree is not clean. Commit/stash changes before release.')
}

const remoteTagResult = runCapture(`git ls-remote --tags origin refs/tags/${tagName}`)
if (!remoteTagResult.ok) {
  fail(`Cannot verify remote tag ${tagName}. Check network/auth first. ${remoteTagResult.stderr}`)
}
if (remoteTagResult.stdout.length > 0) {
  fail(`Remote tag ${tagName} already exists. Bump version before release to avoid mutating old releases.`)
}

info(`Preflight passed. Version=${version}, tag=${tagName}, arch=${arch}`)

cleanReleaseDir(rootDir)
run('npm run build:mac:engine')
run('npm run build:mac:verify-engine')
run('npm run prepare:mac:deps')
run('npm run build:app')
run('npm run verify:packaging-config')
run(`npx electron-builder --mac --${arch} --publish never --config electron-builder.json`)
run(`node scripts/verify-mac-package.cjs release ${arch}`)
run(`npx electron-builder --mac --${arch} --publish always --config electron-builder.json`)
run(`node scripts/verify-mac-package.cjs release ${arch}`)

const { latestMacYmlName, zipName, dmgName } = readLatestMacArtifacts(rootDir)
const requiredAssets = [latestMacYmlName, zipName]
if (dmgName) requiredAssets.push(dmgName)
verifyPublishedAssets({ tagName, owner, repo, requiredAssets })

info(`Release publish complete for ${tagName} (${requiredAssets.join(', ')})`)
