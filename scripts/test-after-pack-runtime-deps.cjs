#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { default: afterPack } = require('./after-pack-runtime-deps.cjs')

function fail(message) {
  console.error(`[test-after-pack-runtime-deps] FAIL: ${message}`)
  process.exit(1)
}

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`)
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'super-cms-afterpack-'))
  const appOutDir = path.join(tempRoot, 'release', 'mac-arm64')
  const resourcesDir = path.join(appOutDir, 'Super CMS.app', 'Contents', 'Resources')
  fs.mkdirSync(resourcesDir, { recursive: true })

  await afterPack({
    appOutDir,
    electronPlatformName: 'darwin',
    packager: {
      projectDir: process.cwd(),
      appInfo: {
        productFilename: 'Super CMS'
      }
    }
  })

  const externalNodeModulesDir = path.join(resourcesDir, 'node_modules')
  const requiredPaths = [
    ['p-limit/package.json', 'p-limit package'],
    ['yocto-queue/package.json', 'yocto-queue package'],
    ['electron-store/index.js', 'electron-store package'],
    ['sharp/package.json', 'sharp package'],
    ['@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node', 'sharp native binary']
  ]

  for (const [relativePath, label] of requiredPaths) {
    assertExists(path.join(externalNodeModulesDir, relativePath), label)
  }

  console.log('[test-after-pack-runtime-deps] PASS: afterPack copied required runtime packages')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
