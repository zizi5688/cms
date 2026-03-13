#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

function fail(message) {
  console.error(`[verify-packaging-config] FAIL: ${message}`)
  process.exit(1)
}

function info(message) {
  console.log(`[verify-packaging-config] ${message}`)
}

const configPath = path.join(process.cwd(), 'electron-builder.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const files = Array.isArray(config.files) ? config.files : []

const requiredPatterns = [
  '!{.claude,.github,.githooks,.trae,.worktrees}{,/**/*}',
  '!{AI_Tools,build,dist,docs,outputs,python,release,scripts,skills}{,/**/*}',
  '!{AGENTS.md,components.json,cms.sqlite,cms_engine.spec,.gitmessage.txt}'
]

for (const pattern of requiredPatterns) {
  if (!files.includes(pattern)) {
    fail(`Missing required exclusion pattern: ${pattern}`)
  }
}

info(`PASS: ${path.basename(configPath)} excludes local-only packaging inputs`)
