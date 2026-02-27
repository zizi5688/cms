import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateCheckResult, type UpdateInfo } from 'electron-updater'

type AppUpdatePhase =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

type AppUpdateState = {
  enabled: boolean
  phase: AppUpdatePhase
  message: string
  platform: NodeJS.Platform
  currentVersion: string
  latestVersion: string | null
  checkedAt: number | null
  downloadedAt: number | null
  percent: number | null
}

type InstallUpdateResult = {
  accepted: boolean
  reason?: string
  state: AppUpdateState
}

const UPDATE_STATUS_CHANNEL = 'app:update.status'
const UPDATE_GET_STATE_CHANNEL = 'app:update.getState'
const UPDATE_CHECK_CHANNEL = 'app:update.check'
const UPDATE_INSTALL_CHANNEL = 'app:update.install'

let initialized = false
let checkPromise: Promise<void> | null = null
let installPromptActive = false

let updateState: AppUpdateState = {
  enabled: false,
  phase: 'idle',
  message: '自动更新尚未初始化。',
  platform: process.platform,
  currentVersion: app.getVersion(),
  latestVersion: null,
  checkedAt: null,
  downloadedAt: null,
  percent: null
}

function cloneState(): AppUpdateState {
  return { ...updateState }
}

function broadcastState(): void {
  const payload = cloneState()
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed()) continue
      win.webContents.send(UPDATE_STATUS_CHANNEL, payload)
    } catch {
      // noop
    }
  }
}

function patchState(patch: Partial<AppUpdateState>): void {
  updateState = { ...updateState, ...patch, currentVersion: app.getVersion(), platform: process.platform }
  broadcastState()
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error ?? 'unknown error')
}

async function maybePromptInstall(updateInfo: UpdateInfo): Promise<void> {
  if (installPromptActive) return
  installPromptActive = true
  try {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `新版本 ${updateInfo.version} 已下载完成。`,
      detail: '是否立即重启并安装更新？',
      buttons: ['立即安装', '稍后'],
      defaultId: 0,
      cancelId: 1
    })

    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  } catch (error) {
    patchState({
      phase: 'error',
      message: `更新安装确认失败：${errorMessage(error)}`
    })
  } finally {
    installPromptActive = false
  }
}

function bindUpdaterEvents(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    patchState({
      phase: 'checking',
      message: '正在检查更新...',
      checkedAt: Date.now(),
      percent: null
    })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    patchState({
      phase: 'available',
      latestVersion: info.version ?? null,
      message: `发现新版本 ${info.version}，正在后台下载...`,
      checkedAt: Date.now(),
      percent: 0
    })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    patchState({
      phase: 'not-available',
      latestVersion: info.version ?? app.getVersion(),
      message: '当前已是最新版本。',
      checkedAt: Date.now(),
      percent: null
    })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0
    patchState({
      phase: 'downloading',
      message: `正在下载更新 ${percent.toFixed(1)}%`,
      percent
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    patchState({
      phase: 'downloaded',
      latestVersion: info.version ?? updateState.latestVersion,
      message: `更新已下载完成（${info.version ?? 'unknown'}）。`,
      downloadedAt: Date.now(),
      percent: 100
    })
    void maybePromptInstall(info)
  })

  autoUpdater.on('error', (error: unknown) => {
    patchState({
      phase: 'error',
      message: `自动更新失败：${errorMessage(error)}`,
      checkedAt: Date.now()
    })
  })
}

async function checkForUpdates(source: 'startup' | 'manual'): Promise<AppUpdateState> {
  if (!updateState.enabled) return cloneState()

  if (checkPromise) {
    await checkPromise
    return cloneState()
  }

  checkPromise = (async () => {
    try {
      if (source === 'manual') {
        patchState({
          phase: 'checking',
          message: '正在检查更新...',
          checkedAt: Date.now(),
          percent: null
        })
      }
      const result = await autoUpdater.checkForUpdates()
      // 兜底：某些异常流程可能不会触发 update-not-available 事件。
      if (!result || !result.isUpdateAvailable) {
        const latest = result?.updateInfo?.version ?? app.getVersion()
        patchState({
          phase: 'not-available',
          latestVersion: latest,
          message: '当前已是最新版本。',
          checkedAt: Date.now(),
          percent: null
        })
      }
    } catch (error) {
      patchState({
        phase: 'error',
        message: `检查更新失败：${errorMessage(error)}`,
        checkedAt: Date.now(),
        percent: null
      })
    }
  })().finally(() => {
    checkPromise = null
  })

  await checkPromise
  return cloneState()
}

function registerUpdaterIpc(): void {
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async (): Promise<AppUpdateState> => cloneState())

  ipcMain.handle(UPDATE_CHECK_CHANNEL, async (): Promise<AppUpdateState> => {
    return checkForUpdates('manual')
  })

  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async (): Promise<InstallUpdateResult> => {
    if (!updateState.enabled) {
      return { accepted: false, reason: 'disabled', state: cloneState() }
    }
    if (updateState.phase !== 'downloaded') {
      return { accepted: false, reason: 'not-downloaded', state: cloneState() }
    }

    try {
      autoUpdater.quitAndInstall()
      return { accepted: true, state: cloneState() }
    } catch (error) {
      patchState({
        phase: 'error',
        message: `启动安装失败：${errorMessage(error)}`
      })
      return { accepted: false, reason: 'install-error', state: cloneState() }
    }
  })
}

function scheduleStartupCheck(): void {
  setTimeout(() => {
    void checkForUpdates('startup')
  }, 12_000)
}

function resolveDisabledMessage(): string {
  if (process.platform !== 'win32') return '自动更新目前仅在 Windows 启用。'
  if (!app.isPackaged) return '开发模式已禁用自动更新。'
  return '自动更新已禁用。'
}

export function initAutoUpdate(): void {
  if (initialized) return
  initialized = true
  registerUpdaterIpc()

  if (process.platform !== 'win32' || !app.isPackaged) {
    patchState({
      enabled: false,
      phase: 'disabled',
      message: resolveDisabledMessage(),
      latestVersion: null,
      percent: null
    })
    return
  }

  patchState({
    enabled: true,
    phase: 'idle',
    message: '自动更新已就绪。',
    latestVersion: null,
    checkedAt: null,
    downloadedAt: null,
    percent: null
  })

  bindUpdaterEvents()

  app.on('browser-window-created', (_event, window) => {
    try {
      if (window.isDestroyed()) return
      window.webContents.send(UPDATE_STATUS_CHANNEL, cloneState())
    } catch {
      // noop
    }
  })

  scheduleStartupCheck()
}

export type { AppUpdatePhase, AppUpdateState, InstallUpdateResult, UpdateCheckResult }
