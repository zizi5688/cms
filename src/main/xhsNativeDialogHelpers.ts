import { spawn } from 'child_process'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import type { BrowserWindow } from 'electron'

export type NativeDialogSelectResult = {
  ok: boolean
  reason?: string
  detail?: string
}

export type NativeDialogWindowState = {
  wasVisible: boolean
  wasMinimized: boolean
  wasAlwaysOnTop: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, Math.max(0, Math.floor(ms)))
  })
}

type AppleScriptRunResult = {
  ok: boolean
  stdout: string
  stderr: string
  reason?: string
}

async function runAppleScript(options: {
  lines: string[]
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}): Promise<AppleScriptRunResult> {
  const args = options.lines.flatMap((line) => ['-e', line])

  return new Promise<AppleScriptRunResult>((resolvePromise) => {
    const child = spawn('osascript', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env ?? {}) }
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch (error) {
        void error
      }
      resolvePromise({ ok: false, stdout, stderr, reason: 'timeout' })
    }, Math.max(500, Math.floor(options.timeoutMs ?? 8_000)))

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk ?? '')
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk ?? '')
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      const message = error instanceof Error ? error.message : String(error)
      resolvePromise({ ok: false, stdout, stderr: `${stderr}${stderr ? ' | ' : ''}${message}`, reason: 'spawn-failed' })
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolvePromise({ ok: true, stdout, stderr })
        return
      }
      resolvePromise({ ok: false, stdout, stderr, reason: `osascript-exit-${code ?? 'null'}` })
    })
  })
}

export function buildMacNativeDialogAppleScriptLines(): string[] {
  return [
    'on containsTargetFileName(targetContainer, targetFileName)',
    '  try',
    '    set uiItems to entire contents of targetContainer',
    '  on error',
    '    return false',
    '  end try',
    '  repeat with uiItem in uiItems',
    '    try',
    '      if (name of uiItem as text) is targetFileName then return true',
    '    end try',
    '    try',
    '      if (value of uiItem as text) is targetFileName then return true',
    '    end try',
    '    try',
    '      if (description of uiItem as text) is targetFileName then return true',
    '    end try',
    '  end repeat',
    '  return false',
    'end containsTargetFileName',
    'set targetPidText to system attribute "CMS_XHS_DIALOG_PID"',
    'set targetPath to system attribute "CMS_XHS_DIALOG_FILE_PATH"',
    'if targetPidText is "" then error "missing-target-pid"',
    'set targetPid to targetPidText as integer',
    'set targetFileName to do shell script "basename " & quoted form of targetPath',
    'set priorClipboardText to ""',
    'set hadPriorClipboard to false',
    'try',
    '  set priorClipboardText to the clipboard as text',
    '  set hadPriorClipboard to true',
    'end try',
    'set the clipboard to targetPath',
    'tell application "System Events"',
    '  set targetProc to first application process whose unix id is targetPid',
    '  tell targetProc',
    '    set frontmost to true',
    '    delay 0.2',
    '    set chooserReady to false',
    '    repeat 30 times',
    '      try',
    '        if exists button "打开" of sheet 1 of window 1 then set chooserReady to true',
    '      end try',
    '      try',
    '        if exists button "Open" of sheet 1 of window 1 then set chooserReady to true',
    '      end try',
    '      try',
    '        if exists button "打开" of window 1 then set chooserReady to true',
    '      end try',
    '      try',
    '        if exists button "Open" of window 1 then set chooserReady to true',
    '      end try',
    '      if chooserReady is true then exit repeat',
    '      delay 0.1',
    '    end repeat',
    '    if chooserReady is false then error "chooser-not-ready"',
    '    keystroke "g" using {command down, shift down}',
    '    delay 0.35',
    '    keystroke "v" using {command down}',
    '    delay 0.25',
    '    set typedPathVerified to false',
    '    repeat 25 times',
    '      set typedPathValue to ""',
    '      try',
    '        set typedPathValue to value of text field 1 of sheet 1 of sheet 1 of window 1',
    '      end try',
    '      if typedPathValue is "" then',
    '        try',
    '          set typedPathValue to value of text field 1 of sheet 1 of window 1',
    '        end try',
    '      end if',
    '      if typedPathValue is "" then',
    '        try',
    '          set typedPathValue to value of text field 1 of window 1',
    '        end try',
    '      end if',
    '      if typedPathValue is targetPath then',
    '        set typedPathVerified to true',
    '        exit repeat',
    '      end if',
    '      delay 0.1',
    '    end repeat',
    '    if typedPathVerified is false then error "go-to-folder-path-mismatch"',
    '    key code 36',
    '    delay 0.55',
    '    set selectedFileNameVerified to false',
    '    repeat 25 times',
    '      set selectedFileNameValue to ""',
    '      try',
    '        set selectedFileNameValue to value of text field 1 of sheet 1 of window 1',
    '      end try',
    '      if selectedFileNameValue is "" then',
    '        try',
    '          set selectedFileNameValue to value of text field 1 of window 1',
    '        end try',
    '      end if',
    '      if selectedFileNameValue is targetFileName then',
    '        set selectedFileNameVerified to true',
    '        exit repeat',
    '      end if',
    '      try',
    '        if my containsTargetFileName(window 1, targetFileName) then',
    '          set selectedFileNameValue to targetFileName',
    '          set selectedFileNameVerified to true',
    '          exit repeat',
    '        end if',
    '      end try',
    '      delay 0.1',
    '    end repeat',
    '    if selectedFileNameVerified is false then error "selected-file-name-mismatch"',
    '    set didClickOpen to false',
    '    repeat 20 times',
      '      try',
    '        if exists button "打开" of sheet 1 of window 1 then',
    '          if enabled of button "打开" of sheet 1 of window 1 then',
    '            click button "打开" of sheet 1 of window 1',
    '            set didClickOpen to true',
    '          end if',
    '        end if',
    '      end try',
    '      try',
    '        if didClickOpen is false then',
    '          if exists button "Open" of sheet 1 of window 1 then',
    '            if enabled of button "Open" of sheet 1 of window 1 then',
    '              click button "Open" of sheet 1 of window 1',
    '              set didClickOpen to true',
    '            end if',
    '          end if',
    '        end if',
    '      end try',
    '      try',
    '        if didClickOpen is false then',
    '          if exists button "打开" of window 1 then',
    '            if enabled of button "打开" of window 1 then',
    '              click button "打开" of window 1',
    '              set didClickOpen to true',
    '            end if',
    '          end if',
    '        end if',
    '      end try',
    '      try',
    '        if didClickOpen is false then',
    '          if exists button "Open" of window 1 then',
    '            if enabled of button "Open" of window 1 then',
    '              click button "Open" of window 1',
    '              set didClickOpen to true',
    '            end if',
    '          end if',
    '        end if',
    '      end try',
    '      if didClickOpen is true then exit repeat',
    '      delay 0.1',
    '    end repeat',
    '    if didClickOpen is false then key code 36',
    '  end tell',
    'end tell',
    'if hadPriorClipboard then set the clipboard to priorClipboardText'
  ]
}

export async function revealWindowForNativeDialog(ownerWindow: BrowserWindow | null): Promise<NativeDialogWindowState | null> {
  if (!ownerWindow || ownerWindow.isDestroyed()) return null

  const state: NativeDialogWindowState = {
    wasVisible: ownerWindow.isVisible(),
    wasMinimized: ownerWindow.isMinimized(),
    wasAlwaysOnTop: ownerWindow.isAlwaysOnTop()
  }

  try {
    if (state.wasMinimized) ownerWindow.restore()
  } catch (error) {
    void error
  }

  try {
    if (!state.wasVisible) ownerWindow.show()
  } catch (error) {
    void error
  }

  try {
    if (!state.wasAlwaysOnTop) ownerWindow.setAlwaysOnTop(true)
  } catch (error) {
    void error
  }

  try {
    const { app } = await import('electron')
    app.focus()
  } catch (error) {
    void error
  }
  await sleep(120)

  try {
    ownerWindow.moveTop()
  } catch (error) {
    void error
  }

  try {
    ownerWindow.focus()
  } catch (error) {
    void error
  }

  try {
    ownerWindow.webContents.focus()
  } catch (error) {
    void error
  }

  await sleep(180)
  return state
}

export async function restoreWindowAfterNativeDialog(
  ownerWindow: BrowserWindow | null,
  state: NativeDialogWindowState | null,
  options?: { forceHideAfterDialog?: boolean }
): Promise<void> {
  if (!ownerWindow || ownerWindow.isDestroyed() || !state) return

  await sleep(260)

  try {
    if (!state.wasAlwaysOnTop) ownerWindow.setAlwaysOnTop(false)
  } catch (error) {
    void error
  }

  try {
    const shouldHide = options?.forceHideAfterDialog === true || state.wasVisible === false

    if (shouldHide) {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (attempt > 1) {
          await sleep(attempt === 2 ? 160 : 320)
        }

        try {
          ownerWindow.blur()
        } catch (error) {
          void error
        }

        ownerWindow.hide()
        await sleep(80)
        if (!ownerWindow.isVisible()) break
      }
    } else if (state.wasMinimized) {
      ownerWindow.minimize()
    }
  } catch (error) {
    void error
  }
}

export async function pickFileInMacNativeDialog(input: {
  filePath: string
  processId?: number
}): Promise<NativeDialogSelectResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'unsupported-platform', detail: process.platform }
  }

  const normalizedPath = resolve(String(input.filePath ?? '').trim())
  if (!normalizedPath) return { ok: false, reason: 'empty-path' }
  if (!existsSync(normalizedPath)) return { ok: false, reason: 'file-not-found', detail: normalizedPath }
  try {
    const info = statSync(normalizedPath)
    if (!info.isFile()) return { ok: false, reason: 'not-a-file', detail: normalizedPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'stat-failed', detail: message }
  }

  const processId = Math.max(0, Math.floor(Number(input.processId) || 0))
  if (!processId) return { ok: false, reason: 'missing-process-id' }
  const result = await runAppleScript({
    lines: buildMacNativeDialogAppleScriptLines(),
    env: {
      CMS_XHS_DIALOG_PID: String(processId),
      CMS_XHS_DIALOG_FILE_PATH: normalizedPath
    },
    timeoutMs: 12_000
  })

  if (result.ok) return { ok: true }
  const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join(' | ')
  return { ok: false, reason: result.reason ?? 'unknown-error', detail }
}
