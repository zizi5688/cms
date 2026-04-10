#!/usr/bin/env node

const { spawnSync } = require('child_process')

const result = spawnSync('node', ['scripts/release-mac-ci.cjs'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    MAC_ARCH: 'arm64'
  }
})

process.exit(result.status || 0)
