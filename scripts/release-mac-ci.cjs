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

function ensureGhToken() {
  const existing = String(process.env.GH_TOKEN || '').trim()
  if (existing) {
    return
  }

  const result = spawnSync('gh', ['auth', 'token'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  })

  if (result.status !== 0 || !String(result.stdout || '').trim()) {
    fail(`Cannot resolve GH_TOKEN from gh auth token. ${(result.stderr || result.stdout || '').trim()}`)
  }

  process.env.GH_TOKEN = String(result.stdout || '').trim()
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

ensureGhToken()
run('node scripts/release-mac.cjs')

console.log(`[release-mac-ci] DONE version=${version}`)
