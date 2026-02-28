#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(command, options = {}) {
  console.log(`[release-win-x64] $ ${command}`)
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
  console.error(`[release-win-x64] FAIL: ${message}`)
  process.exit(1)
}

function info(message) {
  console.log(`[release-win-x64] ${message}`)
}

function isWindowsExecutable(filePath) {
  try {
    const header = fs.readFileSync(filePath)
    return header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a
  } catch {
    return false
  }
}

function isNonEmptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
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

const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const tagName = `v${version}`
const distDir = path.join(rootDir, 'dist')
const bundledEngineCandidates = [
  path.join(distDir, 'cms_engine.exe'),
  path.join(distDir, 'cms_engine')
]
const bundledRealEsrganExe = path.join(distDir, 'realesrgan', 'realesrgan-ncnn-vulkan.exe')
const bundledRealEsrganModelFiles = [
  path.join(distDir, 'realesrgan', 'models', 'realesrgan-x4plus.param'),
  path.join(distDir, 'realesrgan', 'models', 'realesrgan-x4plus.bin')
]

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
  fail(
    `Cannot verify remote tag ${tagName}. Check network/auth first. ${remoteTagResult.stderr}`
  )
}
if (remoteTagResult.stdout.length > 0) {
  fail(
    `Remote tag ${tagName} already exists. Bump version before release to avoid mutating old releases.`
  )
}

run('npm run prepare:win:deps')

const bundledEnginePath = bundledEngineCandidates.find((candidate) => fs.existsSync(candidate))
if (!bundledEnginePath) {
  fail(
    'Missing bundled cms_engine in dist/. Run `npm run build:win:engine` first, then rerun publish.'
  )
}
if (!isWindowsExecutable(bundledEnginePath)) {
  fail(
    `Bundled cms_engine is not a Windows executable (MZ): ${bundledEnginePath}. Rebuild with \`npm run build:win:engine\`.`
  )
}

if (!fs.existsSync(bundledRealEsrganExe)) {
  fail(
    `Missing Real-ESRGAN executable in dist/: ${bundledRealEsrganExe}. Run \`npm run prepare:win:deps\` first.`
  )
}
if (!isWindowsExecutable(bundledRealEsrganExe)) {
  fail(`Bundled Real-ESRGAN is not a Windows executable (MZ): ${bundledRealEsrganExe}`)
}

for (const modelPath of bundledRealEsrganModelFiles) {
  if (!fs.existsSync(modelPath)) {
    fail(`Missing Real-ESRGAN model file: ${modelPath}`)
  }
  if (!isNonEmptyFile(modelPath)) {
    fail(`Invalid Real-ESRGAN model file (empty): ${modelPath}`)
  }
}

info(`Preflight passed. Version=${version}, tag=${tagName}`)
info(`Bundled engine: ${bundledEnginePath}`)
info(`Bundled Real-ESRGAN: ${bundledRealEsrganExe}`)

run('npm run build:app')
run('npx electron-builder --win --x64 --publish never --config electron-builder.json')
run('node scripts/verify-win-package.cjs release x64')
run('npx electron-builder --win --x64 --publish always --config electron-builder.json')
run('node scripts/verify-win-package.cjs release x64')

info(`Release publish complete for ${tagName}`)
