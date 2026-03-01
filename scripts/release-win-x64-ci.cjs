#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(command) {
  console.log(`[release-win-x64-ci] $ ${command}`)
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function fail(message) {
  console.error(`[release-win-x64-ci] FAIL: ${message}`)
  process.exit(1)
}

if (!process.env.GH_TOKEN) {
  fail('GH_TOKEN is missing.')
}

const rootDir = process.cwd()
const packageJsonPath = path.join(rootDir, 'package.json')
if (!fs.existsSync(packageJsonPath)) {
  fail(`Missing package.json in ${rootDir}`)
}

const version = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
const expectedTag = process.env.RELEASE_TAG || ''
if (expectedTag) {
  const normalizedTag = expectedTag.startsWith('v') ? expectedTag.slice(1) : expectedTag
  if (normalizedTag !== version) {
    fail(`Tag/package version mismatch. tag=${expectedTag} package=${version}`)
  }
}

run('npm run prepare:win:deps')
run('npm run build:app')
run('npx electron-builder --win --x64 --publish never --config electron-builder.json')
run('node scripts/verify-win-package.cjs release x64')
run('npx electron-builder --win --x64 --publish always --config electron-builder.json')
run('node scripts/verify-win-package.cjs release x64')

console.log(`[release-win-x64-ci] DONE version=${version}`)
