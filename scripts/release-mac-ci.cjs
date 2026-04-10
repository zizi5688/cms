#!/usr/bin/env node

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(command) {
  console.log(`[release-mac-ci] $ ${command}`)
  const result = spawnSync(command, {
    stdio: 'inherit',
    shell: true
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function fail(message) {
  console.error(`[release-mac-ci] FAIL: ${message}`)
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

run('node scripts/release-mac.cjs')

console.log(`[release-mac-ci] DONE version=${version}`)
