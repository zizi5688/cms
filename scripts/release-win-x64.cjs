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

info(`Preflight passed. Version=${version}, tag=${tagName}`)

run('npm run build:app')
run('npx electron-builder --win --x64 --publish never --config electron-builder.json')
run('node scripts/verify-win-package.cjs release x64')
run('npx electron-builder --win --x64 --publish always --config electron-builder.json')
run('node scripts/verify-win-package.cjs release x64')

info(`Release publish complete for ${tagName}`)
