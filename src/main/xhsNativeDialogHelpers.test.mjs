import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { buildMacNativeDialogAppleScriptLines, restoreWindowAfterNativeDialog } from './xhsNativeDialogHelpers.ts'

test('buildMacNativeDialogAppleScriptLines targets the owning process by pid instead of an arbitrary frontmost process', () => {
  const script = buildMacNativeDialogAppleScriptLines().join('\n')

  assert.match(script, /on run argv/)
  assert.match(script, /set targetPidText to item 1 of argv/)
  assert.match(script, /set targetPath to item 2 of argv/)
  assert.match(script, /set targetPid to targetPidText as integer/)
  assert.match(script, /first application process whose unix id is targetPid/)
  assert.doesNotMatch(script, /first process whose frontmost is true/)
  assert.doesNotMatch(script, /system attribute/)
  assert.doesNotMatch(script, /tell application targetAppName to activate/)
})

test('buildMacNativeDialogAppleScriptLines waits for the chooser and restores clipboard state', () => {
  const script = buildMacNativeDialogAppleScriptLines().join('\n')

  assert.match(script, /chooserReady/)
  assert.match(script, /chooser-not-ready/)
  assert.match(script, /priorClipboardText/)
  assert.match(script, /if hadPriorClipboard then set the clipboard to priorClipboardText/)
})

test('buildMacNativeDialogAppleScriptLines verifies the go-to-folder input matches the target path before continuing', () => {
  const script = buildMacNativeDialogAppleScriptLines().join('\n')

  assert.match(script, /go-to-folder-path-mismatch/)
  assert.match(script, /keystroke "a" using \{command down\}/)
  assert.match(script, /key code 51/)
  assert.match(script, /set typedPathVerified to false/)
  assert.match(script, /set typedPathValue to value of text field 1/)
  assert.match(script, /if typedPathValue is targetPath then/)
})

test('buildMacNativeDialogAppleScriptLines verifies the selected file name before clicking open', () => {
  const script = buildMacNativeDialogAppleScriptLines().join('\n')

  assert.match(script, /selected-file-name-mismatch/)
  assert.match(script, /set priorTextItemDelimiters to AppleScript's text item delimiters/)
  assert.match(script, /set targetFileName to last text item of targetPath/)
  assert.match(script, /set selectedFileNameVerified to false/)
  assert.match(script, /selectedFileNameValue is targetFileName/)
  assert.match(script, /if selectedFileNameVerified is false then error "selected-file-name-mismatch"\ndelay 3|if selectedFileNameVerified is false then error "selected-file-name-mismatch"\n    delay 3/)
})

test('buildMacNativeDialogAppleScriptLines compiles as valid AppleScript on macOS', () => {
  if (process.platform !== 'darwin') return

  const dir = mkdtempSync(join(tmpdir(), 'xhs-native-dialog-'))
  const sourcePath = join(dir, 'picker.applescript')
  const compiledPath = join(dir, 'picker.scpt')
  writeFileSync(sourcePath, `${buildMacNativeDialogAppleScriptLines().join('\n')}\n`, 'utf8')

  const result = spawnSync('/usr/bin/osacompile', ['-o', compiledPath, sourcePath], {
    encoding: 'utf8'
  })

  rmSync(dir, { recursive: true, force: true })

  assert.equal(
    result.status,
    0,
    `AppleScript should compile, got status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`
  )
})

function createMockWindow(options = {}) {
  let visible = options.visible ?? true
  let focused = options.focused ?? true
  let minimized = options.minimized ?? false
  let alwaysOnTop = options.alwaysOnTop ?? true
  let hideCalls = 0
  let blurCalls = 0
  let minimizeCalls = 0
  let setAlwaysOnTopCalls = 0
  const hideBehavior = typeof options.hideBehavior === 'function' ? options.hideBehavior : null

  const win = {
    id: 99,
    isDestroyed: () => false,
    isVisible: () => visible,
    isFocused: () => focused,
    isMinimized: () => minimized,
    isAlwaysOnTop: () => alwaysOnTop,
    setAlwaysOnTop: (next) => {
      setAlwaysOnTopCalls += 1
      alwaysOnTop = Boolean(next)
    },
    blur: () => {
      blurCalls += 1
      focused = false
    },
    hide: () => {
      hideCalls += 1
      if (hideBehavior) {
        const next = hideBehavior({ hideCalls, visible, focused, minimized, alwaysOnTop })
        if (next && typeof next === 'object') {
          if (typeof next.visible === 'boolean') visible = next.visible
          if (typeof next.focused === 'boolean') focused = next.focused
          if (typeof next.minimized === 'boolean') minimized = next.minimized
          if (typeof next.alwaysOnTop === 'boolean') alwaysOnTop = next.alwaysOnTop
          return
        }
      }
      visible = false
      focused = false
    },
    minimize: () => {
      minimizeCalls += 1
      minimized = true
      visible = true
      focused = false
    }
  }

  return {
    win,
    getState: () => ({ visible, focused, minimized, alwaysOnTop }),
    getCounts: () => ({ hideCalls, blurCalls, minimizeCalls, setAlwaysOnTopCalls })
  }
}

test('restoreWindowAfterNativeDialog hides the owner window in forced-hide mode', async () => {
  const mock = createMockWindow({ visible: true, focused: true, minimized: false, alwaysOnTop: true })

  await restoreWindowAfterNativeDialog(
    mock.win,
    { wasVisible: false, wasMinimized: false, wasAlwaysOnTop: false },
    { forceHideAfterDialog: true }
  )

  assert.equal(mock.getState().visible, false)
  assert.equal(mock.getCounts().hideCalls >= 1, true)
  assert.equal(mock.getCounts().setAlwaysOnTopCalls, 1)
})

test('restoreWindowAfterNativeDialog retries hiding when the first hide does not stick', async () => {
  const mock = createMockWindow({
    visible: true,
    focused: true,
    minimized: false,
    alwaysOnTop: true,
    hideBehavior: ({ hideCalls }) => {
      if (hideCalls === 1) return { visible: true, focused: true }
      return { visible: false, focused: false }
    }
  })

  await restoreWindowAfterNativeDialog(
    mock.win,
    { wasVisible: false, wasMinimized: false, wasAlwaysOnTop: false },
    { forceHideAfterDialog: true }
  )

  assert.equal(mock.getState().visible, false)
  assert.equal(mock.getCounts().hideCalls >= 2, true)
})
