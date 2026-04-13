import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resourcesDirFromContext, signNativeModules } = require('./after-pack-runtime-deps.cjs')

function createDarwinContext(appOutDir, productFilename = 'Custom CMS') {
  return {
    appOutDir,
    electronPlatformName: 'darwin',
    packager: {
      appInfo: {
        productFilename
      }
    }
  }
}

test('resourcesDirFromContext uses the product filename for darwin bundles', () => {
  const context = createDarwinContext('/tmp/release-root', 'Super CMS')

  assert.equal(
    resourcesDirFromContext(context),
    path.join('/tmp/release-root', 'Super CMS.app', 'Contents', 'Resources')
  )
})

test('signNativeModules signs every native artifact under the darwin resources directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-sign-native-'))
  const context = createDarwinContext(path.join(tempRoot, 'release', 'mac-arm64'))
  const resourcesDir = resourcesDirFromContext(context)
  const nestedDir = path.join(resourcesDir, 'node_modules', 'nested')
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.writeFileSync(path.join(resourcesDir, 'top-level.node'), 'node-binary')
  fs.writeFileSync(path.join(nestedDir, 'nested-addon.node'), 'node-binary')
  fs.writeFileSync(path.join(nestedDir, 'libexample.dylib'), 'dylib-binary')
  fs.writeFileSync(path.join(nestedDir, 'ignore.txt'), 'ignore-me')

  const commands = []
  signNativeModules(context, {
    execSyncImpl(command) {
      commands.push(command)
    }
  })

  assert.equal(commands.length, 3)
  assert(commands.every((command) => command.includes('codesign --sign - --force --preserve-metadata=entitlements')))
  assert(commands.some((command) => command.includes('top-level.node')))
  assert(commands.some((command) => command.includes('nested-addon.node')))
  assert(commands.some((command) => command.includes('libexample.dylib')))
})

test('signNativeModules skips signing on non-darwin platforms', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-sign-native-skip-'))
  const resourcesDir = path.join(tempRoot, 'release', 'resources')
  fs.mkdirSync(resourcesDir, { recursive: true })
  fs.writeFileSync(path.join(resourcesDir, 'addon.node'), 'node-binary')

  const commands = []
  signNativeModules(
    {
      appOutDir: path.join(tempRoot, 'release'),
      electronPlatformName: 'linux',
      packager: {
        appInfo: {
          productFilename: 'Super CMS'
        }
      }
    },
    {
      execSyncImpl(command) {
        commands.push(command)
      }
    }
  )

  assert.deepEqual(commands, [])
})
