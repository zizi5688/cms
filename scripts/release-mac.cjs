#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function formatCommand(command, args) {
  return [command, ...args]
    .map((value) => {
      const text = String(value)
      return /\s/.test(text) ? JSON.stringify(text) : text
    })
    .join(' ')
}

function run(command, args = [], options = {}) {
  console.log(`[release-mac] $ ${formatCommand(command, args)}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf8',
    ...options
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function runCapture(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...options
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

function resolvePublishMode() {
  const requested = String(process.env.MAC_PUBLISH_MODE || 'auto-fallback').trim().toLowerCase()
  if (requested === 'full' || requested === 'hybrid' || requested === 'auto-fallback') {
    return requested
  }
  fail(`Unsupported MAC_PUBLISH_MODE: ${requested}`)
}

function ensureGhToken() {
  const existing = String(process.env.GH_TOKEN || '').trim()
  if (existing) {
    info('Using GH_TOKEN from environment')
    return existing
  }

  const tokenResult = runCapture('gh', ['auth', 'token'])
  if (!tokenResult.ok || !tokenResult.stdout) {
    fail(`Cannot resolve GH_TOKEN from gh auth token. ${tokenResult.stderr || tokenResult.stdout}`)
  }

  process.env.GH_TOKEN = tokenResult.stdout
  info('Resolved GH_TOKEN from gh auth token')
  return tokenResult.stdout
}

function ensureMainMatchesOrigin() {
  run('git', ['fetch', 'origin', 'main', '--tags'])

  const headResult = runCapture('git', ['rev-parse', 'HEAD'])
  const remoteResult = runCapture('git', ['rev-parse', 'origin/main'])
  if (!headResult.ok || !remoteResult.ok) {
    fail('Cannot compare local HEAD with origin/main.')
  }
  if (headResult.stdout !== remoteResult.stdout) {
    fail(`Release must run from an up-to-date main branch. HEAD=${headResult.stdout} origin/main=${remoteResult.stdout}`)
  }

  return headResult.stdout
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
  const zipBlockmapName = `${zipName}.blockmap`
  const dmgName = fs.readdirSync(releaseDir).find((name) => name.endsWith('.dmg')) || null
  const dmgBlockmapName = dmgName ? `${dmgName}.blockmap` : null

  mustExist(path.join(releaseDir, zipName), `zip artifact ${zipName}`)
  mustExist(path.join(releaseDir, zipBlockmapName), `zip blockmap ${zipBlockmapName}`)
  if (dmgName) {
    mustExist(path.join(releaseDir, dmgName), `dmg artifact ${dmgName}`)
  }
  if (dmgBlockmapName && fs.existsSync(path.join(releaseDir, dmgBlockmapName)) === false) {
    info(`DMG blockmap missing locally, will continue without it: ${dmgBlockmapName}`)
  }

  return {
    releaseDir,
    latestMacYmlName: 'latest-mac.yml',
    zipName,
    zipBlockmapName,
    dmgName,
    dmgBlockmapName
  }
}

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`)
  }
}

function verifyPublishedAssets({ tagName, owner, repo, requiredAssets }) {
  const result = runCapture('gh', ['release', 'view', tagName, '--repo', `${owner}/${repo}`, '--json', 'assets'])
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

  return assetNames
}

function createRelease({ tagName, owner, repo, targetSha }) {
  run('gh', [
    'release',
    'create',
    tagName,
    '--repo',
    `${owner}/${repo}`,
    '--target',
    targetSha,
    '--title',
    tagName,
    '--notes',
    `Automated macOS release for ${tagName}`,
    '--latest'
  ])
}

function uploadAssets({ tagName, owner, repo, releaseDir, assetNames }) {
  const assetPaths = assetNames
    .filter(Boolean)
    .map((name) => path.join(releaseDir, name))

  run('gh', ['release', 'upload', tagName, ...assetPaths, '--repo', `${owner}/${repo}`, '--clobber'])
}

function tryUploadAssets({ tagName, owner, repo, releaseDir, assetNames }) {
  const assetPaths = assetNames
    .filter(Boolean)
    .map((name) => path.join(releaseDir, name))

  const result = runCapture('gh', ['release', 'upload', tagName, ...assetPaths, '--repo', `${owner}/${repo}`, '--clobber'])
  if (!result.ok) {
    info(`Optional asset upload failed: ${result.stderr || result.stdout}`)
  }
  return result.ok
}

const rootDir = process.cwd()
const packageJsonPath = path.join(rootDir, 'package.json')
if (!fs.existsSync(packageJsonPath)) {
  fail(`Missing package.json in ${rootDir}`)
}

ensureGhToken()
const arch = resolveMacArch()
const publishMode = resolvePublishMode()
const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const tagName = `v${version}`
const { owner, repo } = loadPublishTarget(rootDir)

const branchResult = runCapture('git', ['branch', '--show-current'])
if (!branchResult.ok) {
  fail('Cannot detect current git branch.')
}
if (branchResult.stdout !== 'main') {
  fail(`Release must run on main branch. Current branch: ${branchResult.stdout}`)
}

const dirtyResult = runCapture('git', ['status', '--porcelain'])
if (!dirtyResult.ok) {
  fail('Cannot read git working tree state.')
}
if (dirtyResult.stdout.length > 0) {
  fail('Working tree is not clean. Commit/stash changes before release.')
}

const remoteTagResult = runCapture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`])
if (!remoteTagResult.ok) {
  fail(`Cannot verify remote tag ${tagName}. Check network/auth first. ${remoteTagResult.stderr}`)
}
if (remoteTagResult.stdout.length > 0) {
  fail(`Remote tag ${tagName} already exists. Bump version before release to avoid mutating old releases.`)
}

const targetSha = ensureMainMatchesOrigin()

info(`Preflight passed. Version=${version}, tag=${tagName}, arch=${arch}, mode=${publishMode}`)

cleanReleaseDir(rootDir)
run('npm', ['run', 'build:mac:engine'])
run('npm', ['run', 'build:mac:verify-engine'])
run('npm', ['run', 'prepare:mac:deps'])
run('npm', ['run', 'build:app'])
run('npm', ['run', 'verify:packaging-config'])
run('npx', ['electron-builder', '--mac', `--${arch}`, '--publish', 'never', '--config', 'electron-builder.json'])
run('node', ['scripts/verify-mac-package.cjs', 'release', arch])

const { releaseDir, latestMacYmlName, zipName, zipBlockmapName, dmgName, dmgBlockmapName } = readLatestMacArtifacts(rootDir)
const hybridAssets = [latestMacYmlName, zipName, zipBlockmapName]
const fullAssets = [...hybridAssets, dmgName, dmgBlockmapName].filter(Boolean)

createRelease({ tagName, owner, repo, targetSha })
uploadAssets({ tagName, owner, repo, releaseDir, assetNames: hybridAssets })

let effectiveMode = publishMode === 'hybrid' ? 'hybrid' : 'full'
if (publishMode !== 'hybrid' && dmgName) {
  const optionalAssets = [dmgName, dmgBlockmapName].filter(Boolean)
  const optionalUploadOk = tryUploadAssets({ tagName, owner, repo, releaseDir, assetNames: optionalAssets })
  if (!optionalUploadOk) {
    if (publishMode === 'full') {
      fail(`Full publish failed while uploading optional DMG assets for ${tagName}.`)
    }
    effectiveMode = 'hybrid'
    info(`Fell back to hybrid publish for ${tagName}; DMG remains available locally at ${path.join(releaseDir, dmgName)}`)
  }
}

const requiredAssets = effectiveMode === 'full' ? fullAssets : hybridAssets
const publishedAssets = verifyPublishedAssets({ tagName, owner, repo, requiredAssets })
const publishedAssetList = Array.from(publishedAssets).sort().join(', ')

info(`Release publish complete for ${tagName} mode=${effectiveMode} assets=${publishedAssetList}`)
