import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMacNativeArtifactRepairCommand,
  detectMacNativeArtifactGatekeeperIssue,
  promptForMacNativeArtifactRepair
} from './macNativeArtifactGatekeeperGuard.ts'

test('buildMacNativeArtifactRepairCommand escapes spaces and strips dev suffixes', () => {
  assert.equal(
    buildMacNativeArtifactRepairCommand('Super CMS [DEV]'),
    'xattr -cr /Applications/Super\\ CMS.app'
  )
})

test('detectMacNativeArtifactGatekeeperIssue returns a repair prompt for quarantine errors on macOS', () => {
  const issue = detectMacNativeArtifactGatekeeperIssue({
    platform: 'darwin',
    appName: 'Super CMS',
    candidateModules: ['fsevents'],
    loadModule() {
      throw new Error('fsevents.node failed to load because it is quarantined by macOS')
    }
  })

  assert(issue)
  assert.equal(issue?.moduleName, 'fsevents')
  assert.match(issue?.detail ?? '', /quarantined/i)
  assert.equal(issue?.command, 'xattr -cr /Applications/Super\\ CMS.app')
})

test('detectMacNativeArtifactGatekeeperIssue ignores missing modules and non-mac platforms', () => {
  const missingModuleIssue = detectMacNativeArtifactGatekeeperIssue({
    platform: 'darwin',
    appName: 'Super CMS',
    candidateModules: ['fsevents'],
    loadModule() {
      const error = new Error("Cannot find module 'fsevents'")
      error.name = 'MODULE_NOT_FOUND'
      throw error
    }
  })

  const nonMacIssue = detectMacNativeArtifactGatekeeperIssue({
    platform: 'win32',
    appName: 'Super CMS',
    candidateModules: ['fsevents'],
    loadModule() {
      throw new Error('fsevents.node is not verified')
    }
  })

  assert.equal(missingModuleIssue, null)
  assert.equal(nonMacIssue, null)
})

test('promptForMacNativeArtifactRepair copies the command when the user chooses the copy action', async () => {
  const copied = []
  const dialogCalls = []
  const issue = {
    moduleName: 'fsevents',
    detail: 'fsevents.node is not verified',
    command: 'xattr -cr /Applications/Super\\ CMS.app'
  }

  const copiedCommand = await promptForMacNativeArtifactRepair({
    issue,
    showMessageBox: async (payload) => {
      dialogCalls.push(payload)
      return { response: 0 }
    },
    writeClipboardText(text) {
      copied.push(text)
    }
  })

  assert.equal(copiedCommand, true)
  assert.equal(dialogCalls.length, 1)
  assert.match(dialogCalls[0].message, /检测到 macOS 安全限制/)
  assert.deepEqual(copied, ['xattr -cr /Applications/Super\\ CMS.app'])
})
