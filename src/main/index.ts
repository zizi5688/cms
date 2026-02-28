import { app, shell, BrowserWindow, ipcMain, dialog, protocol, clipboard, powerSaveBlocker, session } from 'electron'
import { spawn } from 'child_process'
import { join, resolve, extname, basename, dirname } from 'path'
import * as path from 'path'
import { createReadStream, openAsBlob, existsSync, statSync, appendFileSync } from 'fs'
import { copyFile, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { tmpdir } from 'os'
import ElectronStore from 'electron-store'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import devDockIcon from '../../resources/icon-dev.png?asset'
import { Readable } from 'stream'
import sharp from 'sharp'
import pLimit from 'p-limit'
import { fileURLToPath } from 'url'
import { AccountManager } from './services/accountManager'
import { PublisherService, registerQueueRunnerIpc, runQueue } from './publisher'
import { ProductManager } from './services/productManager'
import { TaskManager } from './taskManager'
import { WorkspaceService } from './services/workspaceService'
import { performBackup } from './services/backupService'
import { captureVideoFrame, cleanupTempPreviews, prepareVideoPreview } from './services/videoProcessor'
import {
  composeVideoFromImages,
  composeVideoFromPreparedImagePool,
  normalizeImagePaths,
  normalizeVideoPaths,
  type ComposeVideoFailureDebug,
  type VideoOutputAspect
} from './services/videoComposer'
import { listDouyinHotMusicTracks, syncDouyinHotMusic } from './services/douyinHotMusic'
import { SqliteService } from './services/sqliteService'
import { QueueService } from './services/queueService'
import { ScoutService } from './services/scoutService'
import { getAppReleaseMeta } from './services/releaseMeta'
import { initAutoUpdate } from './services/autoUpdate'

// 防止 dev 模式下 stdout 管道断开导致未捕获 EPIPE 崩溃
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return
  throw err
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return
  throw err
})

type FeishuResponse<T> = {
  code: number
  msg?: string
  message?: string
  data?: T
}

type TenantAccessTokenResponse = {
  code: number
  msg?: string
  message?: string
  tenant_access_token?: string
  expire?: number
}

type UploadImageResponse = FeishuResponse<{
  file_token?: string
  fileToken?: string
  image_key?: string
  imageKey?: string
}>

type CreateRecordResponse = FeishuResponse<{
  record: { record_id: string }
}>

type ListRecordsResponse = FeishuResponse<Record<string, unknown>>

const tenantTokenCache = new Map<string, { token: string; expireAt: number }>()
const gpuLimit = pLimit(1)
let isQuitting = false
let scheduleHeartbeatTimer: NodeJS.Timeout | null = null
const runningScheduleByAccount = new Map<string, Promise<void>>()
const IPC_FETCH_XHS_IMAGE = 'IPC_FETCH_XHS_IMAGE'
const IPC_IMAGE_UPDATED = 'IPC_IMAGE_UPDATED'
const IPC_IMAGE_FETCH_FAILED = 'IPC_IMAGE_FETCH_FAILED'
const IPC_SEARCH_1688_BY_IMAGE = 'IPC_SEARCH_1688_BY_IMAGE'
const IPC_SOURCING_CAPTCHA_NEEDED = 'IPC_SOURCING_CAPTCHA_NEEDED'
const IPC_SOURCING_LOGIN_NEEDED = 'IPC_SOURCING_LOGIN_NEEDED'
let imageFetchProcessedCount = 0
let mainWindow: BrowserWindow | null = null
let sourcingLoginWindow: BrowserWindow | null = null
const safeFileRecoveredByName = new Map<string, string>()
const DASHBOARD_AUTO_IMPORT_SCAN_INTERVAL_MS = 5_000
const DASHBOARD_AUTO_IMPORT_RETRY_DELAY_MS = 15_000
const DASHBOARD_AUTO_IMPORT_EXTENSIONS = new Set(['.xlsx', '.xlsm'])
let disposeScoutDashboardAutoImportWatcher: (() => void) | null = null
type ProcessLogFn = (level: 'stdout' | 'stderr' | 'info' | 'error', message: string) => void

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

type NativeDialogSelectResult = {
  ok: boolean
  reason?: string
  detail?: string
}

async function pickFileInMacNativeDialog(filePath: string): Promise<NativeDialogSelectResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'unsupported-platform', detail: process.platform }
  }

  const normalizedPath = resolve(String(filePath ?? '').trim())
  if (!normalizedPath) return { ok: false, reason: 'empty-path' }
  if (!existsSync(normalizedPath)) return { ok: false, reason: 'file-not-found', detail: normalizedPath }
  try {
    const info = statSync(normalizedPath)
    if (!info.isFile()) return { ok: false, reason: 'not-a-file', detail: normalizedPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'stat-failed', detail: message }
  }

  const scriptLines = [
    'set targetPath to system attribute "CMS_XHS_DIALOG_FILE_PATH"',
    'set the clipboard to targetPath',
    'tell application "System Events"',
    '  delay 0.35',
    '  keystroke "g" using {command down, shift down}',
    '  delay 0.45',
    '  keystroke "v" using {command down}',
    '  delay 0.25',
    '  key code 36',
    '  delay 0.55',
    '  set didClickOpen to false',
    '  set frontProc to first process whose frontmost is true',
    '  tell frontProc',
    '    try',
    '      click button "打开" of window 1',
    '      set didClickOpen to true',
    '    on error',
    '      try',
    '        click button "Open" of window 1',
    '        set didClickOpen to true',
    '      on error',
    '        try',
    '          click button "打开" of sheet 1 of window 1',
    '          set didClickOpen to true',
    '        on error',
    '          try',
    '            click button "Open" of sheet 1 of window 1',
    '            set didClickOpen to true',
    '          on error',
    '            set didClickOpen to false',
    '          end try',
    '        end try',
    '      end try',
    '    end try',
    '  end tell',
    '  if didClickOpen is false then key code 36',
    'end tell'
  ]
  const args = scriptLines.flatMap((line) => ['-e', line])

  const result = await new Promise<NativeDialogSelectResult>((resolvePromise) => {
    const child = spawn('osascript', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CMS_XHS_DIALOG_FILE_PATH: normalizedPath }
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch (error) {
        void error
      }
      resolvePromise({ ok: false, reason: 'timeout' })
    }, 8_000)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk ?? '')
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk ?? '')
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      const message = error instanceof Error ? error.message : String(error)
      resolvePromise({ ok: false, reason: 'spawn-failed', detail: message })
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolvePromise({ ok: true })
        return
      }
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ')
      resolvePromise({ ok: false, reason: `osascript-exit-${code ?? 'null'}`, detail })
    })
  })

  return result
}

function appendCoverFetchDebugLog(line: string): void {
  try {
    const ts = new Date().toISOString()
    appendFileSync(getCoverFetchDebugLogPath(), `[${ts}] ${line}\n`, 'utf-8')
  } catch {
    // noop
  }
}

function getCoverFetchDebugLogPath(): string {
  return join(app.getPath('userData'), 'cover_fetch_debug.log')
}

function getVideoComposerDebugLogPath(): string {
  return join(app.getPath('userData'), 'video_composer_debug.log')
}

function appendVideoComposerDebugLog(entry: string): void {
  try {
    const ts = new Date().toISOString()
    appendFileSync(getVideoComposerDebugLogPath(), `[${ts}] ${entry}\n\n`, 'utf-8')
  } catch {
    // noop
  }
}

function formatVideoComposerFailureDetails(options: {
  batchIndex: number
  batchTotal: number
  seed: number
  sourceImageCount: number
  sourceVideoCount?: number
  error: string
  bgmPath?: string
  debug?: ComposeVideoFailureDebug
}): string {
  const lines: string[] = []
  lines.push(`batch=${options.batchIndex}/${options.batchTotal}`)
  lines.push(`seed=${options.seed}`)
  lines.push(`sourceImageCount=${options.sourceImageCount}`)
  lines.push(`sourceVideoCount=${Math.max(0, Number(options.sourceVideoCount) || 0)}`)
  lines.push(`error=${options.error}`)
  lines.push(`bgmPath=${options.bgmPath ? options.bgmPath : '<none>'}`)

  const debug = options.debug
  if (debug) {
    lines.push(
      `runtime=${debug.runtime.platform}/${debug.runtime.arch} packaged=${debug.runtime.isPackaged ? '1' : '0'}`
    )
    lines.push(`errorName=${debug.errorName}`)
    lines.push(`ffmpeg=${debug.ffmpeg.normalizedPath || '<empty>'} exists=${debug.ffmpeg.exists ? '1' : '0'}`)
    lines.push(`ffprobe=${debug.ffprobe.normalizedPath || '<empty>'} exists=${debug.ffprobe.exists ? '1' : '0'}`)
    if (debug.stackTop) lines.push(`stackTop=${debug.stackTop}`)
  }

  return lines.join(' | ')
}

function parseOptionalBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const raw = value.trim().toLowerCase()
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return null
}

function readCoverDebugState(): {
  visual: boolean
  keepWindowOpen: boolean
  openDevTools: boolean
  logPath: string
} {
  const coverVisual = parseOptionalBool(process.env.CMS_SCOUT_COVER_VISUAL)
  const sourcingVisual = parseOptionalBool(process.env.CMS_SCOUT_SOURCING_VISUAL)
  const coverKeepOpen = parseOptionalBool(process.env.CMS_SCOUT_COVER_KEEP_OPEN)
  const sourcingKeepOpen = parseOptionalBool(process.env.CMS_SCOUT_KEEP_WINDOW_OPEN)
  const coverDevTools = parseOptionalBool(process.env.CMS_SCOUT_COVER_OPEN_DEVTOOLS)
  const sourcingDevTools = parseOptionalBool(process.env.CMS_SCOUT_OPEN_DEVTOOLS)
  return {
    visual: coverVisual ?? sourcingVisual ?? false,
    keepWindowOpen: coverKeepOpen ?? sourcingKeepOpen ?? false,
    openDevTools: coverDevTools ?? sourcingDevTools ?? false,
    logPath: getCoverFetchDebugLogPath()
  }
}

function isLikelyMountedOrRemotePath(filePath: string): boolean {
  const normalizedPath = resolve(String(filePath ?? '').trim())
  if (!normalizedPath) return false
  if (process.platform === 'darwin') return normalizedPath.startsWith('/Volumes/')
  if (process.platform === 'win32') return normalizedPath.startsWith('\\\\')
  return normalizedPath.startsWith('/mnt/') || normalizedPath.startsWith('/media/')
}

function sanitizeTempLabel(label: string): string {
  const normalized = String(label ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) return 'stage'
  return normalized.slice(0, 32)
}

async function copyFileWithRetry(
  sourcePath: string,
  destinationPath: string,
  attempts = 4,
  retryDelayMs = 220
): Promise<void> {
  const source = resolve(String(sourcePath ?? '').trim())
  const destination = resolve(String(destinationPath ?? '').trim())
  if (!source || !destination) {
    throw new Error(`[ImageLab] 文件复制失败：source/destination 不能为空。`)
  }

  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await copyFile(source, destination)
      const copiedStat = await stat(destination)
      if (!copiedStat.isFile() || copiedStat.size <= 0) {
        throw new Error('copied file is empty or invalid')
      }
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await sleepMs(retryDelayMs)
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`[ImageLab] 文件复制失败：${source} -> ${destination} (${message})`)
}

type LocalInputPlan = {
  inputPath: string
  usedLocalStaging: boolean
  cleanup: () => Promise<void>
}

async function createLocalInputPlan(
  inputPath: string,
  stageLabel: string,
  sendLog?: ProcessLogFn
): Promise<LocalInputPlan> {
  const normalizedInputPath = resolve(String(inputPath ?? '').trim())
  if (!normalizedInputPath) throw new Error(`[ImageLab] ${stageLabel} 输入路径为空。`)

  if (!isLikelyMountedOrRemotePath(normalizedInputPath)) {
    return {
      inputPath: normalizedInputPath,
      usedLocalStaging: false,
      cleanup: async () => void 0
    }
  }

  const stageRoot = join(app.getPath('temp'), 'super-cms-local-stage')
  await mkdir(stageRoot, { recursive: true })
  const stageDir = join(
    stageRoot,
    `${sanitizeTempLabel(stageLabel)}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  )
  await mkdir(stageDir, { recursive: true })

  const inputExt = extname(normalizedInputPath) || '.png'
  const stagedInputPath = join(stageDir, `input${inputExt}`)

  sendLog?.('info', `[ImageLab] ${stageLabel}：检测到挂载盘路径，启用本地暂存读取。`)
  await copyFileWithRetry(normalizedInputPath, stagedInputPath)
  await ensureImageReadableWithRetry(stagedInputPath, `${stageLabel} 临时输入`, sendLog)

  return {
    inputPath: stagedInputPath,
    usedLocalStaging: true,
    cleanup: async () => {
      await rm(stageDir, { recursive: true, force: true }).catch(() => void 0)
    }
  }
}

type LocalProcessingPlan = {
  inputPath: string
  outputPath: string
  usedLocalStaging: boolean
  commit: () => Promise<void>
  cleanup: () => Promise<void>
}

async function createLocalProcessingPlan(
  inputPath: string,
  outputPath: string,
  stageLabel: string,
  sendLog?: ProcessLogFn
): Promise<LocalProcessingPlan> {
  const normalizedInputPath = resolve(String(inputPath ?? '').trim())
  const normalizedOutputPath = resolve(String(outputPath ?? '').trim())
  if (!normalizedInputPath || !normalizedOutputPath) {
    throw new Error(`[ImageLab] ${stageLabel} 输入/输出路径不能为空。`)
  }

  if (!isLikelyMountedOrRemotePath(normalizedInputPath) && !isLikelyMountedOrRemotePath(normalizedOutputPath)) {
    return {
      inputPath: normalizedInputPath,
      outputPath: normalizedOutputPath,
      usedLocalStaging: false,
      commit: async () => void 0,
      cleanup: async () => void 0
    }
  }

  const stageRoot = join(app.getPath('temp'), 'super-cms-local-stage')
  await mkdir(stageRoot, { recursive: true })
  const stageDir = join(
    stageRoot,
    `${sanitizeTempLabel(stageLabel)}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  )
  await mkdir(stageDir, { recursive: true })

  const inputExt = extname(normalizedInputPath) || '.png'
  const outputExt = extname(normalizedOutputPath) || '.png'
  const stagedInputPath = join(stageDir, `input${inputExt}`)
  const stagedOutputPath = join(stageDir, `output${outputExt}`)
  let committed = false

  sendLog?.('info', `[ImageLab] ${stageLabel}：检测到挂载盘路径，启用本地暂存处理。`)
  await copyFileWithRetry(normalizedInputPath, stagedInputPath)
  await ensureImageReadableWithRetry(stagedInputPath, `${stageLabel} 临时输入`, sendLog)

  return {
    inputPath: stagedInputPath,
    outputPath: stagedOutputPath,
    usedLocalStaging: true,
    commit: async () => {
      if (committed) return
      await ensureImageReadableWithRetry(stagedOutputPath, `${stageLabel} 临时输出`, sendLog)
      await mkdir(dirname(normalizedOutputPath), { recursive: true })
      await copyFileWithRetry(stagedOutputPath, normalizedOutputPath)
      committed = true
    },
    cleanup: async () => {
      await rm(stageDir, { recursive: true, force: true }).catch(() => void 0)
    }
  }
}

async function ensureImageReadableWithRetry(
  filePath: string,
  stageLabel: string,
  sendLog?: ProcessLogFn,
  attempts = 4,
  retryDelayMs = 220
): Promise<void> {
  const rawPath = String(filePath ?? '').trim()
  if (!rawPath) throw new Error(`[ImageLab] ${stageLabel} 输出不可读：路径为空。`)
  const normalizedPath = resolve(rawPath)

  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (!existsSync(normalizedPath)) {
        throw new Error('file not found')
      }
      const s = await stat(normalizedPath)
      if (!s.isFile()) throw new Error('not a regular file')
      if (s.size <= 0) throw new Error('empty file')

      const meta = await sharp(normalizedPath, { failOn: 'none' }).metadata()
      const width = Number(meta.width ?? 0)
      const height = Number(meta.height ?? 0)
      if (width <= 0 || height <= 0) throw new Error('invalid image dimensions')
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        sendLog?.('info', `[ImageLab] ${stageLabel} 输出校验重试 ${attempt}/${attempts - 1}：${basename(normalizedPath)}`)
        await sleepMs(retryDelayMs)
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`[ImageLab] ${stageLabel} 输出不可读：${normalizedPath} (${message})`)
}

function sendLogToRenderer(type: 'info' | 'warn' | 'error', message: string): void {
  if (!is.dev) return
  const payload = { type, message, timestamp: Date.now() }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed()) continue
      win.webContents.send('system-log', payload)
    } catch (error) {
      void error
    }
  }
}

function inferTempImageExtension(imageUrl: string, contentType: string): string {
  const lowerType = String(contentType ?? '').toLowerCase()
  if (lowerType.includes('png')) return 'png'
  if (lowerType.includes('webp')) return 'webp'
  if (lowerType.includes('avif')) return 'avif'
  if (lowerType.includes('gif')) return 'gif'
  if (lowerType.includes('bmp')) return 'bmp'
  if (lowerType.includes('jpg') || lowerType.includes('jpeg')) return 'jpg'
  const cleanUrl = String(imageUrl ?? '').split('?')[0] ?? ''
  const match = cleanUrl.match(/\.([a-z0-9]{2,5})$/i)
  if (!match) return 'jpg'
  const ext = String(match[1] ?? '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'jpg'
}

async function downloadImageToTempForSourcing(imageUrl: string): Promise<string> {
  const normalized = String(imageUrl ?? '').trim()
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error('image_url_invalid')
  }
  const response = await fetch(normalized, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    }
  })
  if (!response.ok) {
    throw new Error(`image_download_failed_${response.status}`)
  }
  const contentType = String(response.headers.get('content-type') ?? '')
  if (contentType && !contentType.toLowerCase().includes('image')) {
    throw new Error('image_content_type_invalid')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer || buffer.length <= 0) {
    throw new Error('image_download_empty')
  }
  const tempDir = join(tmpdir(), 'super-cms-sourcing')
  await mkdir(tempDir, { recursive: true })
  const ext = inferTempImageExtension(normalized, contentType)
  const fileName = `temp_search_${Date.now()}_${createHash('sha1').update(normalized).digest('hex').slice(0, 10)}.${ext}`
  const targetPath = join(tempDir, fileName)
  await writeFile(targetPath, buffer)
  return targetPath
}

type ElectronStoreCtor = new <T extends Record<string, unknown> = Record<string, unknown>>() => ElectronStore<T>
const StoreCtor = ((ElectronStore as unknown as { default?: ElectronStoreCtor }).default ??
  (ElectronStore as unknown as ElectronStoreCtor)) as ElectronStoreCtor

// 开发环境隔离：必须在 configStore 初始化之前设置，否则 electron-store 会读生产配置
if (is.dev) {
  app.setName('super-cms-dev')
  app.setPath('userData', join(app.getPath('appData'), 'super-cms-dev'))
}

const defaultWatermarkBox = { x: 0.905, y: 0.927, width: 0.055, height: 0.05 }
const defaultDynamicWatermarkEnabled = false
const defaultDynamicWatermarkOpacity = 15
const defaultDynamicWatermarkSize = 5
const defaultDynamicWatermarkTrajectory = 'pseudoRandom'
type DynamicWatermarkTrajectory = 'smoothSine' | 'figureEight' | 'diagonalWrap' | 'largeEllipse' | 'pseudoRandom'

function isValidWatermarkBox(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.x === 'number' &&
    typeof record.y === 'number' &&
    typeof record.width === 'number' &&
    typeof record.height === 'number'
  )
}

function normalizeDynamicWatermarkEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') return defaultDynamicWatermarkEnabled
  return value
}

function normalizeDynamicWatermarkOpacity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return defaultDynamicWatermarkOpacity
  return Math.max(0, Math.min(100, Math.round(parsed)))
}

function normalizeDynamicWatermarkSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return defaultDynamicWatermarkSize
  return Math.max(2, Math.min(10, Math.round(parsed)))
}

function normalizeDynamicWatermarkTrajectory(value: unknown): DynamicWatermarkTrajectory {
  const normalized = String(value ?? '').trim()
  const available: DynamicWatermarkTrajectory[] = [
    'smoothSine',
    'figureEight',
    'diagonalWrap',
    'largeEllipse',
    'pseudoRandom'
  ]
  return (available.includes(normalized as DynamicWatermarkTrajectory)
    ? normalized
    : defaultDynamicWatermarkTrajectory) as DynamicWatermarkTrajectory
}

const configStore = new StoreCtor<{
  feishuConfig: { appId: string; appSecret: string; baseToken: string; tableId: string }
  realEsrganPath: string
  pythonPath: string
  watermarkScriptPath: string
  dynamicWatermarkEnabled?: boolean
  dynamicWatermarkOpacity?: number
  dynamicWatermarkSize?: number
  dynamicWatermarkTrajectory?: DynamicWatermarkTrajectory
  scoutDashboardAutoImportDir?: string
  scoutDashboardAutoImportSince?: number
  watermarkBox: { x: number; y: number; width: number; height: number }
  defaultStartTime?: string
  defaultInterval?: number
  workspacePath?: string
  queueConfig?: {
    taskIntervalMinMs?: number
    taskIntervalMaxMs?: number
    dailyLimitPerAccount?: number
    cooldownAfterNTasks?: number
    cooldownDurationMs?: number
  }
}>()

async function readFeishuJson<T>(res: Response): Promise<{ data: T; logId: string | null }> {
  const logId = res.headers.get('x-tt-logid')
  const json = (await res.json()) as T
  return { data: json, logId }
}

function getFeishuErrorMsg(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const maybe = payload as { msg?: unknown; message?: unknown }
    if (typeof maybe.msg === 'string' && maybe.msg) return maybe.msg
    if (typeof maybe.message === 'string' && maybe.message) return maybe.message
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const normalizedAppId = appId.trim()
  const normalizedSecret = appSecret.trim()
  if (!normalizedAppId || !normalizedSecret) {
    throw new Error('[Feishu] appId/appSecret 不能为空。')
  }

  const cacheKey = `${normalizedAppId}:${normalizedSecret}`
  const cached = tenantTokenCache.get(cacheKey)
  if (cached && cached.expireAt > Date.now()) return cached.token

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: normalizedAppId,
      app_secret: normalizedSecret
    })
  })

  const { data, logId } = await readFeishuJson<TenantAccessTokenResponse>(res)
  const token = data.tenant_access_token
  if (!res.ok || data.code !== 0 || !token) {
    throw new Error(
      `[Feishu] 获取 tenant_access_token 失败：${getFeishuErrorMsg(data) || res.statusText} (${logId ?? 'no-logid'})`
    )
  }

  const expireSeconds = Math.max(0, Number(data.expire) || 0)
  const safetyMs = 60_000
  tenantTokenCache.set(cacheKey, {
    token,
    expireAt: Date.now() + Math.max(0, expireSeconds * 1000 - safetyMs)
  })

  return token
}

function normalizeBitableAttachmentFields(fields: Record<string, unknown>): Record<string, unknown> {
  let changed = false

  const normalizeAttachmentItem = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item
    const record = item as Record<string, unknown>

    const fileToken = record['file_token']
    if (typeof fileToken === 'string' && fileToken.trim()) return item

    const imageKey = record['image_key']
    if (typeof imageKey !== 'string' || !imageKey.trim()) return item

    const next: Record<string, unknown> = { ...record, file_token: imageKey }
    delete next['image_key']
    changed = true
    return next
  }

  const nextFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      const normalized = value.map(normalizeAttachmentItem)
      nextFields[key] = normalized
      continue
    }

    nextFields[key] = normalizeAttachmentItem(value)
  }

  return changed ? nextFields : fields
}

async function scanDirectory(folderPath: string): Promise<string[]> {
  const normalizedPath = folderPath.trim()
  if (!normalizedPath) return []

  const stats = await stat(normalizedPath)
  if (!stats.isDirectory()) return []

  const entries = await readdir(normalizedPath, { withFileTypes: true })
  const allowedExt = IMAGE_SOURCE_EXTENSIONS
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(normalizedPath, entry.name))
    .filter((absolutePath) => {
      const ext = extname(absolutePath).toLowerCase()
      return allowedExt.has(ext)
    })
}

async function scanDirectoryRecursive(folderPath: string): Promise<string[]> {
  const normalizedPath = folderPath.trim()
  if (!normalizedPath) return []

  const rootStats = await stat(normalizedPath)
  if (!rootStats.isDirectory()) return []

  const allowedExt = IMAGE_SOURCE_EXTENSIONS
  const queue: string[] = [normalizedPath]
  const results: string[] = []

  while (queue.length > 0) {
    const currentDir = queue.shift()
    if (!currentDir) continue

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = await readdir(currentDir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(absolutePath).toLowerCase()
      if (allowedExt.has(ext)) results.push(absolutePath)
    }
  }

  return results
}

const IMAGE_SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic'])
const VIDEO_SOURCE_EXTENSIONS = new Set(['.mp4', '.mov'])
const MIXED_SOURCE_EXTENSIONS = new Set([...IMAGE_SOURCE_EXTENSIONS, ...VIDEO_SOURCE_EXTENSIONS])

async function scanMediaDirectoryRecursive(folderPath: string): Promise<string[]> {
  const normalizedPath = folderPath.trim()
  if (!normalizedPath) return []

  const rootStats = await stat(normalizedPath)
  if (!rootStats.isDirectory()) return []

  const queue: string[] = [normalizedPath]
  const results: string[] = []

  while (queue.length > 0) {
    const currentDir = queue.shift()
    if (!currentDir) continue

    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
    try {
      entries = await readdir(currentDir, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(absolutePath).toLowerCase()
      if (MIXED_SOURCE_EXTENSIONS.has(ext)) results.push(absolutePath)
    }
  }

  return results
}

type DashboardExcelFileCandidate = {
  filePath: string
  mtimeMs: number
}

function buildDashboardAutoImportSignature(candidate: DashboardExcelFileCandidate): string {
  return `${candidate.filePath}::${Math.floor(candidate.mtimeMs)}`
}

async function listDashboardExcelFilesRecursive(rootDir: string): Promise<DashboardExcelFileCandidate[]> {
  const normalizedRoot = resolve(String(rootDir ?? '').trim())
  if (!normalizedRoot) return []

  const rootStats = await stat(normalizedRoot).catch(() => null)
  if (!rootStats || !rootStats.isDirectory()) return []

  const pendingDirs: string[] = [normalizedRoot]
  const candidates: DashboardExcelFileCandidate[] = []

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()
    if (!currentDir) continue

    const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const name = String(entry.name ?? '').trim()
      if (!name) continue

      const absolutePath = resolve(currentDir, name)
      if (entry.isDirectory()) {
        pendingDirs.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      if (name.startsWith('~$')) continue

      const ext = extname(name).toLowerCase()
      if (!DASHBOARD_AUTO_IMPORT_EXTENSIONS.has(ext)) continue

      const fileStats = await stat(absolutePath).catch(() => null)
      if (!fileStats || !fileStats.isFile()) continue

      const normalizedMtimeMs =
        typeof fileStats.mtimeMs === 'number' && Number.isFinite(fileStats.mtimeMs)
          ? fileStats.mtimeMs
          : fileStats.mtime.getTime()
      const normalizedBirthtimeMs =
        typeof fileStats.birthtimeMs === 'number' && Number.isFinite(fileStats.birthtimeMs)
          ? fileStats.birthtimeMs
          : fileStats.birthtime.getTime()
      const normalizedCtimeMs =
        typeof fileStats.ctimeMs === 'number' && Number.isFinite(fileStats.ctimeMs)
          ? fileStats.ctimeMs
          : fileStats.ctime.getTime()

      candidates.push({
        filePath: absolutePath,
        mtimeMs: Math.max(normalizedMtimeMs, normalizedBirthtimeMs, normalizedCtimeMs)
      })
    }
  }

  return candidates
}

function resolveBundledResourcePath(...parts: string[]): string {
  return join(process.resourcesPath, ...parts)
}

function resolveCmsEngineExecutablePath(): string {
  const basePath = resolveBundledResourcePath('cms_engine')
  if (process.platform === 'win32') {
    const exePath = `${basePath}.exe`
    if (existsSync(exePath)) return exePath
  }
  return basePath
}

function resolveRealEsrganExecutablePath(): string {
  const baseDir = resolveBundledResourcePath('realesrgan')
  if (process.platform === 'win32') {
    const winExe = join(baseDir, 'realesrgan-ncnn-vulkan.exe')
    if (existsSync(winExe)) return winExe
  }
  return join(baseDir, 'realesrgan-ncnn-vulkan')
}

async function createWindow(): Promise<void> {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    title: is.dev ? 'Super CMS [DEV]' : 'Super CMS',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // macOS：点 X 关窗口只是隐藏，不退出 app，后台任务继续执行
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // 阻止 HTML <title> 覆盖窗口标题，保持 [DEV] 标识
  if (is.dev) {
    mainWindow.on('page-title-updated', (event) => {
      event.preventDefault()
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 渲染进程热更新：开发环境加载 dev server，生产环境加载本地文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (is.dev && process.env['CMS_OPEN_DEVTOOLS'] === '1') {
    try {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    } catch (error) {
      void error
    }
  }
}

// Electron 初始化完成后触发：创建窗口等操作应在此之后执行
app.whenReady().then(async () => {
  // 开发模式使用独立 Dock 图标，避免和 Release 产物混淆
  if (is.dev && process.platform === 'darwin') {
    try {
      app.dock?.setIcon(devDockIcon)
    } catch (error) {
      void error
    }
  }

  try {
    await performBackup()
  } catch (error) {
    console.error('[Backup] 备份失败：', error)
  }

  try {
    await cleanupTempPreviews({ maxFiles: 60, maxAgeDays: 7 })
  } catch (error) {
    void error
  }

  const workspaceService = new WorkspaceService(configStore)
  const workspaceInit = await workspaceService.init()
  let sqliteReady = false
  if (workspaceInit.status === 'initialized' && workspaceInit.path) {
    try {
      const sqlite = SqliteService.getInstance()
      const initResult = await sqlite.init(workspaceInit.path)
      QueueService.getInstance().markStalledTasksAsFailed()
      sqliteReady = true

      // 迁移结果弹窗
      if (initResult.migrationResult) {
        const mr = initResult.migrationResult
        const { accounts, tasks, products } = mr.inserted
        if (mr.migrated) {
          dialog.showMessageBox({
            type: 'info',
            title: '数据迁移完成',
            message: `已从 ${mr.source} 成功导入数据`,
            detail: `账号：${accounts} 个\n任务：${tasks} 条\n商品：${products} 个\n\n原始文件已备份为 db.json.bak`,
            buttons: ['确定']
          })
        } else if (accounts === 0 && tasks === 0 && products === 0) {
          dialog.showMessageBox({
            type: 'warning',
            title: '数据迁移警告',
            message: `检测到 ${mr.source}，但未导入任何数据`,
            detail: '可能原因：\n1. db.json 格式不正确或为空\n2. 数据已存在于 SQLite 中（重复导入）\n\n请检查 db.json 文件内容是否完整。',
            buttons: ['确定']
          })
        }
      }
    } catch (error) {
      const err = error as { code?: unknown; message?: unknown; stack?: unknown }
      const code = typeof err?.code === 'string' ? err.code : err?.code != null ? String(err.code) : ''
      const message = typeof err?.message === 'string' ? err.message : String(err?.message ?? '')
      const stack = typeof err?.stack === 'string' ? err.stack : String(err?.stack ?? '')
      const attempted = join(workspaceInit.path, 'cms.sqlite')
      dialog.showErrorBox(
        'SQLite 初始化失败 (Debug)',
        `路径: ${workspaceInit.path}\n尝试写入: ${attempted}\n错误代码: ${code}\n错误信息: ${message}\n堆栈: ${stack}`
      )
      console.error('[Sqlite] init/migrate failed:', error)
      if (scheduleHeartbeatTimer) {
        clearInterval(scheduleHeartbeatTimer)
        scheduleHeartbeatTimer = null
      }
      runningScheduleByAccount.clear()
    }
  }

  const scoutService = new ScoutService()
  if (sqliteReady) {
    try { scoutService.ensureSchema() } catch (e) { console.error('[Scout] ensureSchema failed:', e) }
  }

  const autoImportProcessedSignatures = new Set<string>()
  const autoImportBaselineSignatures = new Set<string>()
  const autoImportRetryAtBySignature = new Map<string, number>()
  let autoImportScanTimer: NodeJS.Timeout | null = null
  let autoImportScanInFlight: Promise<ScoutDashboardAutoImportScanSummary | null> | null = null
  let autoImportBaselineReady = false
  let autoImportWatchDir = ''
  let autoImportSinceTs = 0
  let autoImportMissingDirLogged = false

  type ScoutDashboardAutoImportScanMode = 'auto' | 'manual'
  type ScoutDashboardAutoImportScanFailure = {
    sourceFile: string
    message: string
  }
  type ScoutDashboardAutoImportScanSummary = {
    mode: ScoutDashboardAutoImportScanMode
    watchDir: string
    scannedFiles: number
    processedFiles: number
    importedFiles: number
    failedFiles: number
    skippedBaselineFiles: number
    skippedProcessedFiles: number
    skippedRetryFiles: number
    busy: boolean
    failures: ScoutDashboardAutoImportScanFailure[]
  }
  type ScoutDashboardAutoImportScanProgress = {
    mode: ScoutDashboardAutoImportScanMode
    phase: 'start' | 'progress' | 'done' | 'error'
    watchDir: string
    scannedFiles: number
    processedFiles: number
    importedFiles: number
    failedFiles: number
    skippedBaselineFiles: number
    skippedProcessedFiles: number
    skippedRetryFiles: number
    currentFile: string | null
    message?: string
  }

  const createScoutDashboardAutoImportScanSummary = (
    mode: ScoutDashboardAutoImportScanMode
  ): ScoutDashboardAutoImportScanSummary => ({
    mode,
    watchDir: autoImportWatchDir,
    scannedFiles: 0,
    processedFiles: 0,
    importedFiles: 0,
    failedFiles: 0,
    skippedBaselineFiles: 0,
    skippedProcessedFiles: 0,
    skippedRetryFiles: 0,
    busy: false,
    failures: []
  })
  const sendScoutDashboardAutoImportScanProgress = (payload: ScoutDashboardAutoImportScanProgress): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('cms.scout.dashboard.autoImportScanProgress', payload)
  }

  const stopScoutDashboardAutoImportWatcher = (): void => {
    if (autoImportScanTimer) {
      clearInterval(autoImportScanTimer)
      autoImportScanTimer = null
    }
    autoImportProcessedSignatures.clear()
    autoImportBaselineSignatures.clear()
    autoImportRetryAtBySignature.clear()
    autoImportBaselineReady = false
    autoImportWatchDir = ''
    autoImportSinceTs = 0
    autoImportMissingDirLogged = false
  }

  const readScoutDashboardAutoImportConfig = (): {
    watchDir: string
    sinceTs: number
  } => {
    const rawDir = configStore.get('scoutDashboardAutoImportDir')
    const watchDir = typeof rawDir === 'string' ? rawDir.trim() : ''
    const rawSince = configStore.get('scoutDashboardAutoImportSince')
    const parsedSince = typeof rawSince === 'number' ? rawSince : Number(rawSince)
    const sinceTs = Number.isFinite(parsedSince) && parsedSince > 0 ? Math.floor(parsedSince) : 0
    return { watchDir, sinceTs }
  }

  const runScoutDashboardAutoImportScan = async (
    mode: ScoutDashboardAutoImportScanMode = 'auto'
  ): Promise<ScoutDashboardAutoImportScanSummary | null> => {
    if (mode === 'manual' && autoImportScanInFlight) {
      sendLogToRenderer('info', '[热度看板] 手动扫描已排队，等待当前扫描任务完成。')
      await autoImportScanInFlight.catch(() => void 0)
    } else if (mode !== 'manual' && autoImportScanInFlight) {
      return null
    }

    if (!sqliteReady || !autoImportWatchDir) {
      if (mode !== 'manual') return null
      throw new Error('请先在设置中选择可用的自动导入目录。')
    }

    const scanTask = (async (): Promise<ScoutDashboardAutoImportScanSummary | null> => {
      const summary = createScoutDashboardAutoImportScanSummary(mode)
      const emitProgress = (
        phase: ScoutDashboardAutoImportScanProgress['phase'],
        currentFile: string | null,
        message?: string
      ): void => {
        sendScoutDashboardAutoImportScanProgress({
          mode,
          phase,
          watchDir: summary.watchDir,
          scannedFiles: summary.scannedFiles,
          processedFiles: summary.processedFiles,
          importedFiles: summary.importedFiles,
          failedFiles: summary.failedFiles,
          skippedBaselineFiles: summary.skippedBaselineFiles,
          skippedProcessedFiles: summary.skippedProcessedFiles,
          skippedRetryFiles: summary.skippedRetryFiles,
          currentFile,
          message
        })
      }

      try {
        const dirStats = await stat(autoImportWatchDir).catch(() => null)
        if (!dirStats || !dirStats.isDirectory()) {
          if (!autoImportMissingDirLogged) {
            sendLogToRenderer('warn', `[热度看板] 自动导入目录不可用：${autoImportWatchDir}`)
            autoImportMissingDirLogged = true
          }
          if (mode === 'manual') {
            const message = `自动导入目录不可用：${autoImportWatchDir}`
            emitProgress('error', null, message)
            throw new Error(message)
          }
          emitProgress('error', null, `自动导入目录不可用：${autoImportWatchDir}`)
          return summary
        }
        autoImportMissingDirLogged = false

        const candidates = await listDashboardExcelFilesRecursive(autoImportWatchDir)
        summary.scannedFiles = candidates.length
        emitProgress('start', null, mode === 'manual' ? '开始扫描目录...' : undefined)
        if (candidates.length === 0) {
          emitProgress('done', null)
          return summary
        }

        candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
        if (!autoImportBaselineReady) {
          for (const candidate of candidates) {
            if (candidate.mtimeMs >= autoImportSinceTs) continue
            autoImportBaselineSignatures.add(buildDashboardAutoImportSignature(candidate))
          }
          autoImportBaselineReady = true
        }

        for (const candidate of candidates) {
          const signature = buildDashboardAutoImportSignature(candidate)
          const sourceFile = basename(candidate.filePath)
          if (mode === 'auto' && autoImportBaselineSignatures.has(signature)) {
            summary.skippedBaselineFiles += 1
            summary.processedFiles += 1
            emitProgress('progress', sourceFile)
            continue
          }
          if (autoImportProcessedSignatures.has(signature)) {
            summary.skippedProcessedFiles += 1
            summary.processedFiles += 1
            emitProgress('progress', sourceFile)
            continue
          }

          const retryAt = autoImportRetryAtBySignature.get(signature) ?? 0
          if (mode === 'auto' && retryAt > Date.now()) {
            summary.skippedRetryFiles += 1
            summary.processedFiles += 1
            emitProgress('progress', sourceFile)
            continue
          }

          try {
            const result = await scoutService.importExcelSnapshotFromFile(candidate.filePath)
            autoImportProcessedSignatures.add(signature)
            autoImportRetryAtBySignature.delete(signature)
            summary.importedFiles += 1
            sendLogToRenderer(
              'info',
              `${mode === 'manual' ? '[热度看板] 手动扫描导入成功' : '[热度看板] 自动导入成功'}：${sourceFile}（日期 ${result.snapshotDates.join(', ')}）`
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            autoImportRetryAtBySignature.set(signature, Date.now() + DASHBOARD_AUTO_IMPORT_RETRY_DELAY_MS)
            summary.failedFiles += 1
            if (summary.failures.length < 20) {
              summary.failures.push({ sourceFile, message })
            }
            sendLogToRenderer(
              'warn',
              `${mode === 'manual' ? '[热度看板] 手动扫描导入失败' : '[热度看板] 自动导入失败'}：${sourceFile}，${message}`
            )
          } finally {
            summary.processedFiles += 1
            emitProgress('progress', sourceFile)
          }
        }
        if (mode === 'manual') {
          sendLogToRenderer(
            'info',
            `[热度看板] 手动扫描完成：扫描 ${summary.scannedFiles} 个文件，导入 ${summary.importedFiles} 个，失败 ${summary.failedFiles} 个。`
          )
        }
        emitProgress('done', null)
        return summary
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        emitProgress('error', null, message)
        if (mode === 'manual') {
          sendLogToRenderer('warn', `[热度看板] 手动扫描失败：${message}`)
          throw error
        }
        sendLogToRenderer('warn', `[热度看板] 自动导入扫描失败：${message}`)
        return summary
      }
    })()

    autoImportScanInFlight = scanTask
    try {
      return await scanTask
    } finally {
      if (autoImportScanInFlight === scanTask) autoImportScanInFlight = null
    }
  }

  const ensureScoutDashboardAutoImportWatcher = (): void => {
    if (!sqliteReady) {
      stopScoutDashboardAutoImportWatcher()
      return
    }

    const current = readScoutDashboardAutoImportConfig()
    if (!current.watchDir) {
      stopScoutDashboardAutoImportWatcher()
      return
    }

    const sinceTs = current.sinceTs > 0 ? current.sinceTs : Date.now()
    if (current.sinceTs <= 0) {
      configStore.set('scoutDashboardAutoImportSince', sinceTs)
    }

    const changed = current.watchDir !== autoImportWatchDir || sinceTs !== autoImportSinceTs
    if (changed) {
      autoImportWatchDir = current.watchDir
      autoImportSinceTs = sinceTs
      autoImportMissingDirLogged = false
      autoImportProcessedSignatures.clear()
      autoImportBaselineSignatures.clear()
      autoImportRetryAtBySignature.clear()
      autoImportBaselineReady = false
      sendLogToRenderer(
        'info',
        `[热度看板] 已开启爆款表自动导入：${autoImportWatchDir}（按配置生效时目录快照识别后续新增/变更文件）`
      )
    }

    if (!autoImportScanTimer) {
      autoImportScanTimer = setInterval(() => {
        void runScoutDashboardAutoImportScan()
      }, DASHBOARD_AUTO_IMPORT_SCAN_INTERVAL_MS)
    }

    void runScoutDashboardAutoImportScan()
  }

  disposeScoutDashboardAutoImportWatcher = stopScoutDashboardAutoImportWatcher
  ensureScoutDashboardAutoImportWatcher()

  const accountManager = new AccountManager()

  const resolveLoggedInXhsPartitionKey = async (): Promise<string | null> => {
    const accounts = accountManager.listAccounts()
    if (accounts.length === 0) return null

    // Prefer accounts already marked as logged in, then fallback to probing others.
    const ordered = [
      ...accounts.filter((item) => item.status === 'logged_in'),
      ...accounts.filter((item) => item.status !== 'logged_in')
    ]

    for (const account of ordered) {
      try {
        const ok = await accountManager.checkLoginStatus(account.id)
        if (!ok) continue
        const partitionKey = String(account.partitionKey ?? '').trim()
        if (!partitionKey) continue
        return partitionKey
      } catch {
        // ignore probe error and continue next account
      }
    }
    return null
  }

  type XhsImageQueueItem = {
    productId: string
    xiaohongshuUrl: string
    retryCount: number
  }
  const imageFetchQueue: XhsImageQueueItem[] = []
  const queuedOrRunningProductIds = new Set<string>()
  let isProcessingImageQueue = false

  const isLikelyPlaceholderImage = (value: string): boolean => {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (!normalized) return true
    if (normalized.includes('placeholder') || normalized.includes('default') || normalized.includes('sprite')) {
      return true
    }
    return false
  }

  const broadcastImageUpdated = (payload: { productId: string; imageUrl: string }): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win.isDestroyed()) continue
        win.webContents.send(IPC_IMAGE_UPDATED, payload)
      } catch (error) {
        void error
      }
    }
  }

  const broadcastImageFetchFailed = (payload: {
    productId: string
    reason: string
    retryable: boolean
  }): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win.isDestroyed()) continue
        win.webContents.send(IPC_IMAGE_FETCH_FAILED, payload)
      } catch (error) {
        void error
      }
    }
  }

  const processImageFetchQueue = async (): Promise<void> => {
    if (isProcessingImageQueue || imageFetchQueue.length === 0) return
    const next = imageFetchQueue.shift()
    if (!next) return

    isProcessingImageQueue = true
    try {
      const preferredPartitionKey = await resolveLoggedInXhsPartitionKey()
      if (preferredPartitionKey) {
        appendCoverFetchDebugLog(`session productId=${next.productId} partition=${preferredPartitionKey}`)
      } else {
        appendCoverFetchDebugLog(`session productId=${next.productId} partition=isolated-default`)
      }
      const imageUrl = await scoutService.getXhsCoverImage(next.xiaohongshuUrl, {
        preferredPartitionKey: preferredPartitionKey ?? undefined
      })
      if (!imageUrl || isLikelyPlaceholderImage(imageUrl)) {
        throw new Error('未解析到有效商品主图')
      }
      const savedImageUrl =
        scoutService.saveDashboardProductCover(next.productId, next.xiaohongshuUrl, imageUrl) ?? imageUrl
      broadcastImageUpdated({ productId: next.productId, imageUrl: savedImageUrl })
      sendLogToRenderer('info', `[XHS Cover Queue] updated productId=${next.productId}`)
      appendCoverFetchDebugLog(
        `ok productId=${next.productId} url=${next.xiaohongshuUrl} image=${String(savedImageUrl).slice(0, 180)}`
      )
      queuedOrRunningProductIds.delete(next.productId)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      appendCoverFetchDebugLog(
        `fail productId=${next.productId} url=${next.xiaohongshuUrl} msg=${msg} retry=${next.retryCount}`
      )
      if (msg.includes('ANTI_SPIDER_DETECTED')) {
        sendLogToRenderer('warn', `[XHS Cover Queue] failed productId=${next.productId} msg=${msg}`)
        broadcastImageFetchFailed({
          productId: next.productId,
          reason: '触发反爬限制（ANTI_SPIDER），请稍后重试',
          retryable: true
        })
        queuedOrRunningProductIds.delete(next.productId)
        // Do not retry immediately; treat as soft-block and let user retry later.
      } else if (next.retryCount < 1) {
        imageFetchQueue.push({ ...next, retryCount: next.retryCount + 1 })
        sendLogToRenderer('warn', `[XHS Cover Queue] retry productId=${next.productId}`)
      } else {
        sendLogToRenderer('warn', `[XHS Cover Queue] failed productId=${next.productId} msg=${msg}`)
        broadcastImageFetchFailed({
          productId: next.productId,
          reason: msg || '封面抓取失败',
          retryable: false
        })
        queuedOrRunningProductIds.delete(next.productId)
      }
    } finally {
      imageFetchProcessedCount += 1

      if (imageFetchQueue.length > 0) {
        const jitterMs = 2000 + Math.floor(Math.random() * 3001)
        await sleepMs(jitterMs)

        if (imageFetchProcessedCount % 15 === 0) {
          const cooldownMs = 60000 + Math.floor(Math.random() * 30001)
          sendLogToRenderer('info', '[System] taking a short break to release resources...')
          await sleepMs(cooldownMs)
        }
      }

      isProcessingImageQueue = false
      void processImageFetchQueue()
    }
  }

  ipcMain.on(IPC_FETCH_XHS_IMAGE, (_event, payload: unknown) => {
    const row = (payload ?? {}) as Record<string, unknown>
    const productId = typeof row.productId === 'string' ? row.productId.trim() : ''
    const xiaohongshuUrl = typeof row.xiaohongshuUrl === 'string' ? row.xiaohongshuUrl.trim() : ''
    if (!productId || !xiaohongshuUrl) return
    if (queuedOrRunningProductIds.has(productId)) return
    queuedOrRunningProductIds.add(productId)
    imageFetchQueue.push({ productId, xiaohongshuUrl, retryCount: 0 })
    void processImageFetchQueue()
  })

  const publisherService = new PublisherService(accountManager)
  const productManager = new ProductManager()
  const taskManager = new TaskManager(undefined, {
    workspacePath: workspaceInit.status === 'initialized' ? workspaceInit.path : '',
    configStore,
    resolveAccountNameById: (accountId: string) => {
      try {
        const account = accountManager.getAccount(accountId)
        return account?.name ?? null
      } catch {
        return null
      }
    }
  })
  if (sqliteReady) {
    const migrated = taskManager.normalizeLegacyDraftTasks()
    if (migrated.modeUpdated > 0 || migrated.statusUpdated > 0) {
      console.log(
        `[TaskManager] normalized legacy draft tasks: modeUpdated=${migrated.modeUpdated}, statusUpdated=${migrated.statusUpdated}`
      )
    }
  }

  registerQueueRunnerIpc({ publisherService, taskManager })

  if (sqliteReady && !scheduleHeartbeatTimer) {
    scheduleHeartbeatTimer = setInterval(() => {
      if (!SqliteService.getInstance().isInitialized) {
        console.warn('DB not ready, skipping task check')
        return
      }
      const now = Date.now()
      const dueTasks = taskManager.listDueTasks(now)

      if (dueTasks.length === 0) return

      const accountIds = new Set<string>()
      for (const task of dueTasks) {
        const accountId = task.accountId.trim()
        if (accountId) accountIds.add(accountId)
      }

      for (const accountId of accountIds) {
        if (runningScheduleByAccount.has(accountId)) continue
        const runner = runQueue({ accountId, publisherService, taskManager }).finally(() => {
          runningScheduleByAccount.delete(accountId)
        })

        const runnerVoid = runner.then(() => void 0)
        runningScheduleByAccount.set(accountId, runnerVoid)
        runnerVoid.catch(() => void 0)
      }
    }, 5_000)
  }

  // 设置 Windows 的 App User Model ID
  electronApp.setAppUserModelId('com.electron')

  protocol.handle('safe-file', async (request) => {
    const url = new URL(request.url)
    const filePath = (() => {
      if (process.platform === 'win32') {
        if (url.host && /^[A-Za-z]:$/.test(url.host)) {
          return fileURLToPath(new URL(`file:///${url.host}${url.pathname}`))
        }
        if (url.host) {
          return fileURLToPath(new URL(`file:////${url.host}${url.pathname}`))
        }
        if (/^\/+[A-Za-z]:\//.test(url.pathname)) {
          return fileURLToPath(new URL(`file://${url.pathname}`))
        }
        return path.normalize(decodeURIComponent(url.pathname))
      }

      const rawPath = url.host ? `//${url.host}${url.pathname}` : url.pathname
      return path.normalize(decodeURIComponent(rawPath))
    })()

    const contentTypeByExt = (ext: string): string => {
      if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
      if (ext === '.png') return 'image/png'
      if (ext === '.webp') return 'image/webp'
      if (ext === '.heic') return 'image/heic'
      if (ext === '.mp4') return 'video/mp4'
      if (ext === '.mov') return 'video/quicktime'
      if (ext === '.m4v') return 'video/x-m4v'
      if (ext === '.webm') return 'video/webm'
      return 'application/octet-stream'
    }

    try {
      const tryResolveMacLocalizedPath = (inputPath: string): string => {
        const p = String(inputPath ?? '')
        if (!p.startsWith('/Users/')) return p
        const pairs: Array<[string, string]> = [
          ['/桌面/', '/Desktop/'],
          ['/文稿/', '/Documents/'],
          ['/下载/', '/Downloads/'],
          ['/图片/', '/Pictures/'],
          ['/影片/', '/Movies/'],
          ['/音乐/', '/Music/']
        ]
        for (const [from, to] of pairs) {
          if (!p.includes(from)) continue
          const candidate = p.replace(from, to)
          if (candidate !== p && existsSync(candidate)) return candidate
        }
        return p
      }

      let resolvedFilePath = filePath
      let exists = existsSync(resolvedFilePath)
      if (!exists && process.platform === 'darwin') {
        resolvedFilePath = tryResolveMacLocalizedPath(resolvedFilePath)
        exists = existsSync(resolvedFilePath)
      }
      if (!exists) {
        let workspacePath = String(workspaceService.currentPath ?? '').trim()
        if (!workspacePath) {
          workspacePath = join(app.getPath('documents'), 'SuperCMS_Data')
          console.log('[SafeFile] WorkspaceService not ready, using default workspace:', workspacePath)
        }
        if (workspacePath) {
          const fileName = basename(filePath)
          const userDataPath = app.getPath('userData')
          const normalizedFileName = String(fileName ?? '').trim()
          const lookupKey = normalizedFileName.toLowerCase()
          const cached = lookupKey ? safeFileRecoveredByName.get(lookupKey) : undefined
          if (cached && existsSync(cached)) {
            console.log(`[SafeFile] Recovered (cache): ${normalizedFileName} -> ${cached}`)
            resolvedFilePath = cached
            exists = true
          } else if (normalizedFileName) {
            const dotIndex = normalizedFileName.lastIndexOf('.')
            const base = dotIndex > 0 ? normalizedFileName.slice(0, dotIndex) : normalizedFileName
            const ext = dotIndex > 0 ? normalizedFileName.slice(dotIndex) : ''
            const variants = Array.from(
              new Set([
                normalizedFileName,
                ext ? base + ext.toLowerCase() : normalizedFileName,
                ext ? base + ext.toUpperCase() : normalizedFileName
              ])
            )
            const candidates: string[] = []
            for (const v of variants) {
              candidates.push(join(workspacePath, 'assets', 'images', v))
              candidates.push(join(workspacePath, 'assets', 'videos', v))
              candidates.push(join(workspacePath, 'assets', v))
              candidates.push(join(userDataPath, 'generated_assets', v))
            }

            for (const candidate of candidates) {
              if (!candidate) continue
              if (!existsSync(candidate)) continue
              console.log(`[SafeFile] Recovered at fallback: ${normalizedFileName} -> ${candidate}`)
              safeFileRecoveredByName.set(lookupKey, candidate)
              resolvedFilePath = candidate
              exists = true
              break
            }

            const findCaseInsensitiveInDir = async (dirPath: string, fileLower: string): Promise<string | null> => {
              try {
                const entries = await readdir(dirPath, { withFileTypes: true })
                for (const entry of entries) {
                  if (!entry.isFile()) continue
                  const name = String(entry.name ?? '')
                  if (name.toLowerCase() !== fileLower) continue
                  const full = join(dirPath, name)
                  try {
                    const s = await stat(full)
                    if (s.isFile()) return full
                  } catch {
                    void 0
                  }
                }
              } catch {
                void 0
              }
              return null
            }

            const searchRecursive = async (
              rootDir: string,
              fileLower: string,
              maxDepth = 4,
              maxVisited = 6000
            ): Promise<string | null> => {
              const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]
              let visited = 0
              while (queue.length > 0 && visited < maxVisited) {
                const current = queue.shift()!
                visited += 1
                let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }> = []
                try {
                  entries = (await readdir(current.dir, { withFileTypes: true })) as unknown as typeof entries
                } catch {
                  continue
                }
                for (const entry of entries) {
                  const name = String(entry.name ?? '')
                  if (!name) continue
                  const full = join(current.dir, name)
                  if (entry.isFile()) {
                    if (name.toLowerCase() === fileLower) return full
                    continue
                  }
                  if (entry.isDirectory() && current.depth < maxDepth) {
                    queue.push({ dir: full, depth: current.depth + 1 })
                  }
                }
              }
              return null
            }

            if (!exists && lookupKey) {
              const directDirs = [
                join(workspacePath, 'assets', 'images'),
                join(workspacePath, 'assets', 'videos'),
                join(workspacePath, 'assets'),
                join(userDataPath, 'generated_assets')
              ]
              for (const dir of directDirs) {
                const found = await findCaseInsensitiveInDir(dir, lookupKey)
                if (found) {
                  console.log(`[SafeFile] Recovered at fallback (case-insensitive): ${normalizedFileName} -> ${found}`)
                  safeFileRecoveredByName.set(lookupKey, found)
                  resolvedFilePath = found
                  exists = true
                  break
                }
              }
            }

            if (!exists && lookupKey) {
              const found = await searchRecursive(join(workspacePath, 'assets'), lookupKey)
              if (found) {
                console.log(`[SafeFile] Recovered at fallback (recursive): ${normalizedFileName} -> ${found}`)
                safeFileRecoveredByName.set(lookupKey, found)
                resolvedFilePath = found
                exists = true
              }
            }
          }
        }
      }
      if (!exists) {
        return new Response('File not found', { status: 404 })
      }

      const info = statSync(resolvedFilePath)
      if (!info.isFile()) return new Response(null, { status: 404 })

      const size = info.size
      const ext = extname(resolvedFilePath).toLowerCase()
      const contentType = contentTypeByExt(ext)

      const range = request.headers.get('range') ?? request.headers.get('Range')
      const isHead = String(request.method ?? '').toUpperCase() === 'HEAD'

      if (!range) {
        const headers = new Headers()
        headers.set('Content-Type', contentType)
        headers.set('Content-Length', String(size))
        headers.set('Accept-Ranges', 'bytes')
        if (isHead) return new Response(null, { status: 200, headers })
        return new Response(Readable.toWeb(createReadStream(resolvedFilePath)) as unknown as ReadableStream, {
          status: 200,
          headers
        })
      }

      const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
      if (!match) {
        const headers = new Headers()
        headers.set('Content-Range', `bytes */${size}`)
        headers.set('Accept-Ranges', 'bytes')
        return new Response(null, { status: 416, headers })
      }

      const startText = match[1]
      const endText = match[2]
      let start = startText ? Number(startText) : Number.NaN
      let end = endText ? Number(endText) : Number.NaN

      if (!Number.isFinite(start) && Number.isFinite(end)) {
        const suffix = Math.floor(end)
        if (suffix <= 0) {
          const headers = new Headers()
          headers.set('Content-Range', `bytes */${size}`)
          headers.set('Accept-Ranges', 'bytes')
          return new Response(null, { status: 416, headers })
        }
        start = Math.max(0, size - suffix)
        end = size - 1
      } else {
        start = Number.isFinite(start) ? Math.floor(start) : 0
        end = Number.isFinite(end) ? Math.floor(end) : size - 1
      }

      if (start < 0 || start >= size || end < start || end >= size) {
        const headers = new Headers()
        headers.set('Content-Range', `bytes */${size}`)
        headers.set('Accept-Ranges', 'bytes')
        return new Response(null, { status: 416, headers })
      }

      const chunkSize = end - start + 1
      const headers = new Headers()
      headers.set('Content-Type', contentType)
      headers.set('Content-Length', String(chunkSize))
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
      headers.set('Accept-Ranges', 'bytes')

      if (isHead) return new Response(null, { status: 206, headers })
      const stream = createReadStream(resolvedFilePath, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status: 206, headers })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code
      const message = err instanceof Error ? err.message : String(err)
      sendLogToRenderer('error', `[SafeFile] Error: ${code ? String(code) : 'UNKNOWN'} ${message}`)
      if (code === 'ENOENT') return new Response(null, { status: 404 })
      return new Response(null, { status: 500 })
    }
  })

  ipcMain.handle('GET /accounts', async () => {
    return accountManager.listAccounts()
  })

  ipcMain.handle('POST /accounts', async (_event, payload: { name?: string }) => {
    const name = typeof payload?.name === 'string' ? payload.name : ''
    return accountManager.createAccount(name)
  })

  ipcMain.handle('POST /login-window', async (_event, payload: { accountId?: string; url?: string }) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    const url = typeof payload?.url === 'string' ? payload.url : undefined
    return accountManager.openLoginWindow({ accountId, url })
  })

  ipcMain.handle('cms.account.checkStatus', async (_event, payload: { accountId?: string }) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    return accountManager.checkLoginStatus(accountId)
  })

  ipcMain.handle('cms.account.rename', async (_event, payload: { accountId?: string; name?: string }) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    const name = typeof payload?.name === 'string' ? payload.name : ''
    return accountManager.renameAccount(accountId, name)
  })

  ipcMain.handle('cms.account.delete', async (_event, payload: { accountId?: string }) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    return accountManager.deleteAccount(accountId)
  })

  ipcMain.handle('cms.product.list', async (_event, payload?: { accountId?: string } | string) => {
    const accountId =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object' && typeof payload.accountId === 'string'
          ? payload.accountId
          : ''
    return productManager.list(accountId)
  })

  ipcMain.handle('cms.product.save', async (_event, payload: unknown) => {
    return productManager.save(payload)
  })

  ipcMain.handle('cms.product.sync', async (_event, payload: { accountId?: string }) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    const products = await publisherService.syncProducts(accountId)
    return productManager.saveForAccount(accountId, products)
  })

  ipcMain.handle('cms.task.createBatch', async (event, payload: unknown) => {
    const body =
      payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null
    const requestId = body && typeof body.requestId === 'string' ? body.requestId.trim() : ''
    const tasksPayload = Array.isArray(body?.tasks) ? body.tasks : Array.isArray(payload) ? payload : []
    return await taskManager.createBatch(
      tasksPayload.map((task) => {
        const record = (task ?? {}) as Record<string, unknown>
        let images =
          Array.isArray(record.images) && record.images.length > 0
            ? record.images.filter((p): p is string => typeof p === 'string')
            : []
        const tags =
          Array.isArray(record.tags) && record.tags.length > 0
            ? record.tags.filter((t): t is string => typeof t === 'string')
            : undefined
        const explicitVideoPath = typeof record.videoPath === 'string' ? record.videoPath : ''
        let inferredVideoPath = ''
        if (!explicitVideoPath) {
          const index = images.findIndex((p) => {
            const ext = extname(String(p ?? '')).toLowerCase()
            return ext === '.mp4' || ext === '.mov'
          })
          if (index >= 0) {
            inferredVideoPath = images[index] ?? ''
            images = images.filter((_p, i) => i !== index)
          }
        }
        const videoPath = (explicitVideoPath || inferredVideoPath).trim()
        const isRemix = record.isRemix === true
        const videoClips = Array.isArray(record.videoClips)
          ? Array.from(
              new Set(
                record.videoClips
                  .filter((value): value is string => typeof value === 'string')
                  .map((value) => value.trim())
                  .filter(Boolean)
              )
            )
          : undefined
        const bgmPath = typeof record.bgmPath === 'string' ? record.bgmPath.trim() : ''
        const mediaType =
          record.mediaType === 'video' || Boolean(videoPath) || Boolean(videoClips && videoClips.length > 0)
            ? 'video'
            : 'image'
        const transformPolicy = record.transformPolicy === 'remix_v1' ? 'remix_v1' : 'none'
        const remixSessionId = typeof record.remixSessionId === 'string' ? record.remixSessionId.trim() : ''
        const remixSourceTaskIds = Array.isArray(record.remixSourceTaskIds)
          ? record.remixSourceTaskIds.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          : undefined
        const remixSeed =
          typeof record.remixSeed === 'string'
            ? record.remixSeed.trim()
            : Number.isFinite(record.remixSeed)
              ? String(Math.floor(record.remixSeed as number))
              : ''
        return {
          accountId: typeof record.accountId === 'string' ? record.accountId : '',
          images,
          imagePath: typeof record.imagePath === 'string' ? record.imagePath : '',
          title: typeof record.title === 'string' ? record.title : '',
          content: typeof record.content === 'string' ? record.content : '',
          tags,
          productId: typeof record.productId === 'string' ? record.productId : undefined,
          productName: typeof record.productName === 'string' ? record.productName : undefined,
          publishMode: 'immediate',
          transformPolicy,
          remixSessionId: remixSessionId || undefined,
          remixSourceTaskIds,
          remixSeed: remixSeed || undefined,
          mediaType,
          videoPath: videoPath || undefined,
          videoPreviewPath: typeof record.videoPreviewPath === 'string' ? record.videoPreviewPath : undefined,
          isRemix,
          videoClips,
          bgmPath: bgmPath || undefined
        }
      }),
      {
        requestId: requestId || undefined,
        onProgress: (progress) => {
          event.sender.send('cms.task.createBatch.progress', progress)
        },
        onLog: (level, message) => {
          sendLogToRenderer(level, message)
        }
      }
    )
  })

  ipcMain.handle('cms.task.list', async (_event, accountId: unknown) => {
    return taskManager.listByAccount(typeof accountId === 'string' ? accountId : '')
  })

  ipcMain.handle('cms.task.updateBatch', async (_event, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const updatesPayload = Array.isArray(body.updates) ? body.updates : null
    if (updatesPayload) {
      const patches = updatesPayload
        .filter((v): v is { id: string; updates: unknown } => Boolean(v) && typeof v === 'object')
        .map((patch) => {
          const record = patch as unknown as Record<string, unknown>
          return { id: typeof record.id === 'string' ? record.id : '', updates: record.updates }
        })
      return taskManager.updateMany(patches)
    }

    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
    const updates = body.updates && typeof body.updates === 'object' ? body.updates : {}
    return taskManager.updateBatch(ids, updates)
  })

  ipcMain.handle('cms.task.cancelSchedule', async (_event, payload: unknown) => {
    const ids = Array.isArray(payload) ? payload.filter((v): v is string => typeof v === 'string') : []
    if (ids.length === 0) return []
    return taskManager.updateBatch(ids, { scheduledAt: null })
  })

  ipcMain.handle('cms.task.deleteBatch', async (_event, payload: unknown) => {
    const ids = Array.isArray(payload) ? payload.filter((v): v is string => typeof v === 'string') : []
    return taskManager.deleteBatch(ids)
  })

  ipcMain.handle('cms.task.deleteByRemixSession', async (_event, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''
    return taskManager.deleteByRemixSession(sessionId, { accountId: accountId || undefined })
  })

  ipcMain.handle('cms.task.delete', async (_event, taskId: unknown) => {
    const ok = taskManager.delete(typeof taskId === 'string' ? taskId : '')
    return { success: ok }
  })

  ipcMain.handle('cms.task.updateStatus', async (_event, payload: { taskId?: unknown; status?: unknown }) => {
    const taskId = typeof payload?.taskId === 'string' ? payload.taskId : ''
    const status = typeof payload?.status === 'string' ? payload.status : ''
    const normalizedStatus = status === 'success' ? 'published' : status
    if (
      normalizedStatus !== 'pending' &&
      normalizedStatus !== 'processing' &&
      normalizedStatus !== 'failed' &&
      normalizedStatus !== 'scheduled' &&
      normalizedStatus !== 'published'
    )
      return null
    return taskManager.updateStatus(taskId, normalizedStatus)
  })

  // 导入图片到工作区（用于 TaskDetailModal 添加新图片）
  ipcMain.handle(
    'cms.task.importImages',
    async (_event, payload: { filePaths?: unknown }): Promise<string[]> => {
      const rawPaths = Array.isArray(payload?.filePaths) ? payload.filePaths : []
      const filePaths = rawPaths.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      if (filePaths.length === 0) return []

      let wsPath = String(workspaceService.currentPath ?? '').trim()
      if (!wsPath) {
        wsPath = join(app.getPath('documents'), 'SuperCMS_Data')
      }
      const assetsImagesDir = join(wsPath, 'assets', 'images')
      await mkdir(assetsImagesDir, { recursive: true })

      const results: string[] = []
      for (const filePath of filePaths) {
        try {
          const extLower = extname(filePath).toLowerCase()
          const isHeic = extLower === '.heic'
          let fileHash: string
          let heicJpeg: Buffer | null = null

          if (isHeic) {
            const raw = await readFile(filePath)
            const imported = (await import('heic-convert')) as unknown as { default?: unknown }
            const convert = (imported.default ?? imported) as unknown as (options: {
              buffer: Buffer
              format: 'JPEG' | 'PNG'
              quality?: number
            }) => Promise<Buffer | Uint8Array | ArrayBuffer>
            const output = await convert({ buffer: raw, format: 'JPEG', quality: 1 })
            heicJpeg = Buffer.isBuffer(output)
              ? output
              : output instanceof ArrayBuffer
                ? Buffer.from(new Uint8Array(output))
                : Buffer.from(output)
            const hash = createHash('sha1')
            hash.update(heicJpeg)
            fileHash = hash.digest('hex')
          } else {
            fileHash = await new Promise<string>((res, rej) => {
              const hash = createHash('sha1')
              const stream = createReadStream(filePath)
              stream.on('data', (chunk) => hash.update(chunk))
              stream.on('error', (err) => rej(err))
              stream.on('end', () => res(hash.digest('hex')))
            })
          }

          const fileName = isHeic ? `${fileHash}.jpg` : `${fileHash}${extLower}`
          const destAbsPath = join(assetsImagesDir, fileName)

          // 如果目标已存在且有效则跳过拷贝
          let needCopy = true
          if (existsSync(destAbsPath)) {
            const info = await stat(destAbsPath)
            if (info.isFile() && info.size > 0) needCopy = false
          }
          if (needCopy) {
            if (isHeic && heicJpeg) {
              await writeFile(destAbsPath, heicJpeg)
            } else {
              await copyFile(filePath, destAbsPath)
            }
          }

          const rel = path.posix.join('assets', 'images', fileName)
          results.push(rel)
        } catch (err) {
          console.error(`[importImages] Failed to import: ${filePath}`, err)
        }
      }
      return results
    }
  )

  ipcMain.handle('publisher.publish', async (_event, payload: { accountId?: string; taskData?: unknown }) => {
    const accountId = typeof payload?.accountId === 'string' ? payload.accountId : ''
    const taskData = (payload?.taskData ?? {}) as unknown as {
      title?: unknown
      content?: unknown
      mediaType?: unknown
      videoPath?: unknown
      images?: unknown
      imagePath?: unknown
      productId?: unknown
      productName?: unknown
      dryRun?: unknown
      mode?: unknown
    }

    return publisherService.publishTask(accountId, {
      title: typeof taskData.title === 'string' ? taskData.title : undefined,
      content: typeof taskData.content === 'string' ? taskData.content : undefined,
      mediaType: taskData.mediaType === 'video' ? 'video' : taskData.mediaType === 'image' ? 'image' : undefined,
      videoPath: typeof taskData.videoPath === 'string' ? taskData.videoPath : undefined,
      images: Array.isArray(taskData.images) ? taskData.images.filter((p): p is string => typeof p === 'string') : undefined,
      imagePath: typeof taskData.imagePath === 'string' ? taskData.imagePath : undefined,
      productId: typeof taskData.productId === 'string' ? taskData.productId : undefined,
      productName: typeof taskData.productName === 'string' ? taskData.productName : undefined,
      dryRun: taskData.dryRun === false ? false : true,
      mode: 'immediate'
    })
  })

  ipcMain.handle('cms.xhs.sendKey', async (event, payload: { key?: unknown }) => {
    const key = typeof payload?.key === 'string' ? payload.key : ''
    if (key !== 'Enter') return false
    try {
      event.sender.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
      event.sender.sendInputEvent({ type: 'char', keyCode: '\r' })
      event.sender.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      return true
    } catch (error) {
      void error
      return false
    }
  })

  ipcMain.handle('cms.xhs.nativeClickAt', async (event, payload: { x?: unknown; y?: unknown }) => {
    const x = Number(payload?.x)
    const y = Number(payload?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const ix = Math.max(0, Math.round(x))
    const iy = Math.max(0, Math.round(y))
    try {
      event.sender.sendInputEvent({ type: 'mouseMove', x: ix, y: iy })
      event.sender.sendInputEvent({ type: 'mouseDown', x: ix, y: iy, button: 'left', clickCount: 1 })
      event.sender.sendInputEvent({ type: 'mouseUp', x: ix, y: iy, button: 'left', clickCount: 1 })
      return true
    } catch (error) {
      void error
      return false
    }
  })

  ipcMain.on('cms.xhs.paste', (event, text: unknown) => {
    const payload = typeof text === 'string' ? text : ''
    clipboard.writeText(payload)
    try {
      event.sender.paste()
    } catch (error) {
      void error
    }
  })

  ipcMain.handle('cms.xhs.nativeDialogPickFile', async (_event, payload: { filePath?: unknown }) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : ''
    if (!filePath) return { ok: false, reason: 'empty-path' }
    return pickFileInMacNativeDialog(filePath)
  })

  ipcMain.handle('dialog:openDirectory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:openMediaFiles', async (event, payload?: { multiSelections?: unknown; accept?: unknown }) => {
    const allowMulti = payload?.multiSelections === true
    const accept = payload?.accept === 'image' ? 'image' : payload?.accept === 'video' ? 'video' : 'all'
    const window = BrowserWindow.fromWebContents(event.sender)
    const properties = allowMulti ? (['openFile', 'multiSelections'] as const) : (['openFile'] as const)
    const extensions =
      accept === 'image'
        ? ['jpg', 'jpeg', 'png', 'webp', 'heic']
        : accept === 'video'
          ? ['mp4', 'mov']
          : ['jpg', 'jpeg', 'png', 'webp', 'heic', 'mp4', 'mov']
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: [...properties],
          filters: [{ name: 'Media', extensions }]
        })
      : await dialog.showOpenDialog({
          properties: [...properties],
          filters: [{ name: 'Media', extensions }]
        })
    if (result.canceled || result.filePaths.length === 0) return allowMulti ? [] : null

    const isVideoFile = (filePath: string): boolean => {
      const ext = extname(String(filePath ?? '')).toLowerCase()
      return ext === '.mp4' || ext === '.mov'
    }

    const toSelectionItem = async (
      filePath: string
    ): Promise<{
      originalPath: string
      previewPath: string | null
      mediaType: 'image' | 'video'
      isCompatible?: boolean
      codecName?: string
      error?: string
    }> => {
      const originalPath = String(filePath ?? '').trim()
      if (!originalPath) {
        return { originalPath: '', previewPath: null, mediaType: 'image', error: 'empty path' }
      }
      if (!isVideoFile(originalPath)) {
        return { originalPath, previewPath: originalPath, mediaType: 'image', isCompatible: true }
      }

      const prepared = await prepareVideoPreview(originalPath)
      return {
        originalPath: prepared.originalPath,
        previewPath: prepared.previewPath,
        mediaType: 'video',
        isCompatible: prepared.isCompatible,
        codecName: prepared.codecName,
        error: prepared.error
      }
    }

    if (allowMulti) {
      const items = await Promise.all(result.filePaths.map((p) => toSelectionItem(p)))
      return items.filter((item) => item.originalPath)
    }

    const first = result.filePaths[0] ?? ''
    if (!first.trim()) return null
    return await toSelectionItem(first)
  })

  ipcMain.handle('dialog:openMediaFilePaths', async (event, payload?: { multiSelections?: unknown; accept?: unknown }) => {
    const allowMulti = payload?.multiSelections === true
    const accept = payload?.accept === 'image' ? 'image' : payload?.accept === 'video' ? 'video' : 'all'
    const window = BrowserWindow.fromWebContents(event.sender)
    const properties = allowMulti ? (['openFile', 'multiSelections'] as const) : (['openFile'] as const)
    const extensions =
      accept === 'image'
        ? ['jpg', 'jpeg', 'png', 'webp', 'heic']
        : accept === 'video'
          ? ['mp4', 'mov']
          : ['jpg', 'jpeg', 'png', 'webp', 'heic', 'mp4', 'mov']
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: [...properties],
          filters: [{ name: 'Media', extensions }]
        })
      : await dialog.showOpenDialog({
          properties: [...properties],
          filters: [{ name: 'Media', extensions }]
        })

    if (result.canceled || result.filePaths.length === 0) return allowMulti ? [] : null
    const normalized = Array.from(
      new Set(
        result.filePaths
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      )
    )
    if (allowMulti) return normalized
    return normalized[0] ?? null
  })

  ipcMain.handle('dialog:openAudioFile', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const properties: Array<'openFile'> = ['openFile']
    const options = {
      properties,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const first = result.filePaths[0] ?? ''
    return first.trim() ? first : null
  })

  ipcMain.handle('cms.image.saveBase64', async (_event, payload: { dataUrl?: unknown; filename?: unknown }) => {
    const dataUrl = typeof payload?.dataUrl === 'string' ? payload.dataUrl : ''
    const rawFilename = typeof payload?.filename === 'string' ? payload.filename : ''
    const safeFilename = basename(rawFilename.trim() || `cover_${Date.now()}`)

    const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.*)$/.exec(dataUrl)
    if (!match) throw new Error('[cms.image.saveBase64] invalid dataUrl')

    const mime = match[1] ?? 'image/jpeg'
    const base64 = match[2] ?? ''
    if (!base64.trim()) throw new Error('[cms.image.saveBase64] empty base64 payload')

    const extFromMime = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'
    const filename = extname(safeFilename) ? safeFilename : `${safeFilename}${extFromMime}`

    const dirPath = join(app.getPath('userData'), 'temp_covers')
    await mkdir(dirPath, { recursive: true })

    const buffer = Buffer.from(base64, 'base64')
    const outputPath = join(dirPath, filename)
    await writeFile(outputPath, buffer)
    return outputPath
  })

  ipcMain.handle('media:prepareVideoPreview', async (_event, payload: { filePath?: unknown }) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath : ''
    return prepareVideoPreview(filePath)
  })

  ipcMain.handle('media:captureVideoFrame', async (_event, payload: { filePath?: unknown; timeSec?: unknown }) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath : ''
    const timeSec = Number(payload?.timeSec)
    return captureVideoFrame(filePath, Number.isFinite(timeSec) ? timeSec : 0)
  })

  ipcMain.handle('media:composeVideoFromImages', async (_event, payload: unknown) => {
    const body = (payload ?? {}) as Record<string, unknown>
    const batchIndexRaw = Number(body.batchIndex)
    const batchTotalRaw = Number(body.batchTotal)
    const batchIndex = Number.isFinite(batchIndexRaw) ? Math.max(1, Math.floor(batchIndexRaw)) : 1
    const batchTotal = Number.isFinite(batchTotalRaw) ? Math.max(1, Math.floor(batchTotalRaw)) : 1

    return composeVideoFromImages(body, {
      onProgress: (progress) => {
        _event.sender.send('media:composeVideoFromImagesProgress', {
          percent: progress.percent,
          batchIndex,
          batchTotal
        })
      }
    })
  })

  ipcMain.handle('media:composeVideoBatchFromImages', async (_event, payload: unknown) => {
    const body = (payload ?? {}) as Record<string, unknown>
    const batchCountRaw = Number(body.batchCount)
    const batchCount = Number.isFinite(batchCountRaw) ? Math.max(1, Math.min(20, Math.floor(batchCountRaw))) : 1
    const debugLogPath = getVideoComposerDebugLogPath()
    const sourceRootPath = typeof body.sourceRootPath === 'string' ? body.sourceRootPath.trim() : ''
    const renderModeRaw = typeof body.renderMode === 'string' ? body.renderMode.trim().toLowerCase() : ''
    const lowLoadMode = renderModeRaw === 'hd' ? false : body.lowLoadMode !== false
    const outputAspectRaw = typeof body.outputAspect === 'string' ? body.outputAspect.trim() : ''
    const outputAspect: VideoOutputAspect = outputAspectRaw === '3:4' ? '3:4' : '9:16'

    const splitMediaPaths = (paths: string[]): { images: string[]; videos: string[] } => {
      const images: string[] = []
      const videos: string[] = []
      for (const item of paths) {
        const normalized = String(item ?? '').trim()
        if (!normalized) continue
        const ext = extname(normalized).toLowerCase()
        if (IMAGE_SOURCE_EXTENSIONS.has(ext)) {
          images.push(normalized)
          continue
        }
        if (VIDEO_SOURCE_EXTENSIONS.has(ext)) {
          videos.push(normalized)
        }
      }
      return {
        images: normalizeImagePaths(images),
        videos: normalizeVideoPaths(videos)
      }
    }

    let sourceImages = normalizeImagePaths(body.sourceImages)
    let sourceVideos = normalizeVideoPaths(body.sourceVideos)
    if (sourceImages.length === 0 && sourceVideos.length === 0 && sourceRootPath) {
      _event.sender.send('media:composeVideoFromImagesProgress', {
        percent: 0,
        batchIndex: 0,
        batchTotal: batchCount,
        message: '正在扫描素材目录...'
      })
      const scanned = await scanMediaDirectoryRecursive(sourceRootPath)
      const split = splitMediaPaths(scanned)
      sourceImages = split.images
      sourceVideos = split.videos
    }

    sourceImages = normalizeImagePaths(sourceImages)
    sourceVideos = normalizeVideoPaths(sourceVideos)
    if (sourceImages.length === 0 && sourceVideos.length === 0) {
      const error = '[videoComposer] 未找到可用图片或视频素材。'
      const details = formatVideoComposerFailureDetails({
        batchIndex: 1,
        batchTotal: batchCount,
        seed: 0,
        sourceImageCount: 0,
        sourceVideoCount: 0,
        error
      })
      appendVideoComposerDebugLog(details)
      return {
        success: false,
        successCount: 0,
        failedCount: 1,
        sourceImageCount: 0,
        sourceVideoCount: 0,
        sourceMediaCount: 0,
        outputs: [],
        failures: [{ index: 1, error, details }],
        debugLogPath
      }
    }

    const bgmModeRaw = typeof body.bgmMode === 'string' ? body.bgmMode.trim().toLowerCase() : 'none'
    const bgmMode: 'none' | 'fixed' | 'random' =
      bgmModeRaw === 'fixed' || bgmModeRaw === 'random' ? bgmModeRaw : 'none'
    const fixedBgmPath = typeof body.bgmPath === 'string' ? body.bgmPath.trim() : ''
    const bgmOptions = Array.isArray(body.bgmOptions)
      ? Array.from(
          new Set(
            body.bgmOptions
              .map((item) => (typeof item === 'string' ? item.trim() : ''))
              .filter((item) => item && existsSync(item))
          )
        )
      : []

    const seedBaseRaw = Number(body.seedBase)
    const seedBase = Number.isFinite(seedBaseRaw) ? Math.floor(seedBaseRaw) : Date.now()
    const outputs: string[] = []
    const failures: Array<{ index: number; error: string; details?: string }> = []
    const lowLoadImageProxyCache = new Map<string, string>()
    const imageReadableCache = new Map<string, boolean>()
    const imageProxyCacheDir = join(
      app.getPath('temp'),
      `super-cms-video-proxy-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`
    )

    await mkdir(imageProxyCacheDir, { recursive: true }).catch(() => void 0)

    try {
      for (let index = 0; index < batchCount; index += 1) {
        const batchIndex = index + 1
        const seed = seedBase + index

        let effectiveBgmPath: string | undefined
        if (bgmMode === 'fixed') {
          if (fixedBgmPath && existsSync(fixedBgmPath)) effectiveBgmPath = fixedBgmPath
        } else if (bgmMode === 'random' && bgmOptions.length > 0) {
          const selectedIndex = Math.abs(Math.floor(seed)) % bgmOptions.length
          effectiveBgmPath = bgmOptions[selectedIndex]
        }

        _event.sender.send('media:composeVideoFromImagesProgress', {
          percent: 0,
          batchIndex,
          batchTotal: batchCount
        })

        const result = await composeVideoFromPreparedImagePool(
          {
            sourceImages,
            sourceVideos,
            template: (body.template ?? {}) as Record<string, unknown>,
            bgmPath: effectiveBgmPath,
            seed
          },
          {
            lowLoadMode,
            hdAspect: outputAspect,
            lowLoadCacheDir: imageProxyCacheDir,
            lowLoadImageProxyCache,
            imageReadableCache,
            onProgress: (progress) => {
              _event.sender.send('media:composeVideoFromImagesProgress', {
                percent: progress.percent,
                batchIndex,
                batchTotal: batchCount
              })
            }
          }
        )

        if (result.success && result.outputPath) {
          outputs.push(result.outputPath)
        } else {
          const error = result.error ?? '未知错误'
          const details = formatVideoComposerFailureDetails({
            batchIndex,
            batchTotal: batchCount,
            seed,
            sourceImageCount: sourceImages.length,
            sourceVideoCount: sourceVideos.length,
            error,
            bgmPath: effectiveBgmPath,
            debug: result.debug
          })
          failures.push({ index: batchIndex, error, details })
          appendVideoComposerDebugLog(details)
        }
      }
    } finally {
      await rm(imageProxyCacheDir, { recursive: true, force: true }).catch(() => void 0)
    }

    return {
      success: outputs.length > 0,
      successCount: outputs.length,
      failedCount: failures.length,
      sourceImageCount: sourceImages.length,
      sourceVideoCount: sourceVideos.length,
      sourceMediaCount: sourceImages.length + sourceVideos.length,
      outputs,
      failures,
      debugLogPath
    }
  })

  ipcMain.handle('media:syncDouyinHotMusic', async (_event, payload: unknown) => {
    return syncDouyinHotMusic((payload ?? {}) as Record<string, unknown>)
  })

  ipcMain.handle('media:listDouyinHotMusicTracks', async (_event, payload: unknown) => {
    return listDouyinHotMusicTracks((payload ?? {}) as Record<string, unknown>)
  })

  ipcMain.handle('app:getReleaseMeta', async () => getAppReleaseMeta())

  ipcMain.handle(
    'dialog:showMessageBox',
    async (
      event,
      payload: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
        defaultId?: number
        cancelId?: number
      }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const type = payload?.type ?? 'question'
      const title = typeof payload?.title === 'string' ? payload.title : undefined
      const message = typeof payload?.message === 'string' ? payload.message : ''
      const detail = typeof payload?.detail === 'string' ? payload.detail : undefined
      const buttons = Array.isArray(payload?.buttons) && payload.buttons.length > 0 ? payload.buttons : ['确定']
      const defaultId = Number.isFinite(payload?.defaultId) ? Number(payload.defaultId) : 0
      const cancelId =
        Number.isFinite(payload?.cancelId) && Number(payload.cancelId) >= 0 ? Number(payload.cancelId) : undefined

      if (!message.trim()) throw new Error('[dialog:showMessageBox] message is required.')

      const result = window
        ? await dialog.showMessageBox(window, { type, title, message, detail, buttons, defaultId, cancelId })
        : await dialog.showMessageBox({ type, title, message, detail, buttons, defaultId, cancelId })
      return { response: result.response, checkboxChecked: result.checkboxChecked }
    }
  )

  ipcMain.handle('workspace.getPath', async () => {
    return { path: workspaceService.currentPath, status: workspaceService.status }
  })

  ipcMain.handle('workspace.pickPath', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('workspace.setPath', async (_event, newPath: unknown) => {
    const path = typeof newPath === 'string' ? newPath : ''
    if (!path.trim()) throw new Error('[Workspace] newPath is required.')
    return workspaceService.setPath(path)
  })

  ipcMain.handle('workspace.relaunch', async () => {
    setTimeout(() => {
      try {
        app.relaunch()
        app.exit(0)
      } catch {
        app.exit(0)
      }
    }, 50)
    return { success: true }
  })

  ipcMain.handle('scan-directory', async (_event, folderPath: string) => {
    try {
      const files = await scanDirectory(folderPath)
      console.log(`[Super CMS] scan-directory: ${folderPath} -> ${files.length} files`)
      return files
    } catch (error) {
      console.error('[Super CMS] scan-directory failed:', error)
      return []
    }
  })

  ipcMain.handle('scan-directory-recursive', async (_event, folderPath: string) => {
    try {
      const files = await scanDirectoryRecursive(folderPath)
      console.log(`[Super CMS] scan-directory-recursive: ${folderPath} -> ${files.length} files`)
      return files
    } catch (error) {
      console.error('[Super CMS] scan-directory-recursive failed:', error)
      return []
    }
  })

  ipcMain.handle('scan-media-directory-recursive', async (_event, folderPath: string) => {
    try {
      const files = await scanMediaDirectoryRecursive(folderPath)
      console.log(`[Super CMS] scan-media-directory-recursive: ${folderPath} -> ${files.length} files`)
      return files
    } catch (error) {
      console.error('[Super CMS] scan-media-directory-recursive failed:', error)
      return []
    }
  })

  ipcMain.handle(
    'process-grid-split',
    async (
      _event,
      payload: {
        sourceFiles: string[]
        rows: number
        cols: number
      }
    ) => {
      try {
        const sourceFiles = Array.isArray(payload?.sourceFiles) ? payload.sourceFiles : []
        const rows = Number.isFinite(payload?.rows) ? Math.floor(payload.rows) : 0
        const cols = Number.isFinite(payload?.cols) ? Math.floor(payload.cols) : 0

        if (sourceFiles.length === 0) throw new Error('[ImageLab] sourceFiles 不能为空。')
        if (rows <= 0 || cols <= 0) throw new Error('[ImageLab] rows/cols 必须为正整数。')

        const firstValidSource = sourceFiles.map((p) => String(p ?? '').trim()).find((p) => Boolean(p))
        if (!firstValidSource) throw new Error('[ImageLab] sourceFiles 不能为空。')

        const timestamp = Date.now()
        const masterFolderName = `SuperCMS_Batch_${timestamp}`
        const outDir = join(dirname(firstValidSource), masterFolderName)
        await mkdir(outDir, { recursive: true })

        const prefixCounters = new Map<string, number>()
        const sources = sourceFiles
          .map((rawPath, sourceIndex) => {
            const filePath = String(rawPath ?? '').trim()
            if (!filePath) return null

            const ext = extname(filePath).toLowerCase()
            const baseName = basename(filePath, ext)
            const basePrefix = baseName || `Source${sourceIndex + 1}`
            const seen = prefixCounters.get(basePrefix) ?? 0
            prefixCounters.set(basePrefix, seen + 1)
            const uniquePrefix = seen === 0 ? basePrefix : `${basePrefix}__${seen + 1}`
            return { filePath, uniquePrefix }
          })
          .filter((v): v is { filePath: string; uniquePrefix: string } => Boolean(v))

        const perSource = await Promise.all(
          sources.map(async ({ filePath, uniquePrefix }) => {
            let inputPlan: LocalInputPlan | null = null
            try {
              if (!existsSync(filePath)) {
                console.error(`[ImageLab] Input file for splitting not found: ${filePath}`)
                throw new Error(`Input file for splitting not found`)
              }

              inputPlan = await createLocalInputPlan(filePath, '网格切片输入')
              const processingInputPath = inputPlan.inputPath
              await ensureImageReadableWithRetry(processingInputPath, '网格切片输入')

              const ext = extname(filePath).toLowerCase()

              const meta = await sharp(processingInputPath, { failOn: 'none' }).metadata()
              const width = meta.width ?? 0
              const height = meta.height ?? 0
              if (width <= 0 || height <= 0) {
                throw new Error(`无法读取图片尺寸`)
              }

              const baseTileWidth = Math.floor(width / cols)
              const baseTileHeight = Math.floor(height / rows)
              if (baseTileWidth <= 0 || baseTileHeight <= 0) {
                throw new Error(`切片尺寸无效：${width}x${height} -> ${rows}x${cols}`)
              }

              const outputExt =
                ext === '.jpg' || ext === '.jpeg'
                  ? '.jpg'
                  : ext === '.png'
                    ? '.png'
                    : ext === '.webp'
                      ? '.webp'
                      : '.png'

              const tileJobs: Array<Promise<string>> = []
              for (let r = 0; r < rows; r += 1) {
                for (let c = 0; c < cols; c += 1) {
                  const left = c * baseTileWidth
                  const top = r * baseTileHeight
                  const tileWidth = c === cols - 1 ? width - left : baseTileWidth
                  const tileHeight = r === rows - 1 ? height - top : baseTileHeight

                  const tileIndex = r * cols + c
                  const tileName = `${uniquePrefix}_tile_${tileIndex}${outputExt}`
                  const outPath = join(outDir, tileName)

                  tileJobs.push(
                    (async () => {
                      let pipeline = sharp(processingInputPath, { failOn: 'none' }).extract({
                        left,
                        top,
                        width: tileWidth,
                        height: tileHeight
                      })
                      if (outputExt === '.jpg') pipeline = pipeline.jpeg({ quality: 92 })
                      if (outputExt === '.webp') pipeline = pipeline.webp({ quality: 92 })
                      await pipeline.toFile(outPath)
                      return outPath
                    })()
                  )
                }
              }

              const tileOutputs = await Promise.all(tileJobs)
              return tileOutputs
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              throw new Error(`[ImageLab] 网格切片失败：${filePath} (${message})`)
            } finally {
              if (inputPlan) {
                await inputPlan.cleanup()
              }
            }
          })
        )

        return perSource.flat()
      } catch (error) {
        console.error('[ImageLab] process-grid-split failed:', error)
        throw error
      }
    }
  )

  ipcMain.handle(
    'process-hd-upscale',
    async (
      event,
      payload: {
        files: string[]
        exePath: string
      }
    ) => {
      return gpuLimit(async () => {
        const files = Array.isArray(payload?.files) ? payload.files : []
        const exePath = String(payload?.exePath ?? '').trim()

        const resolvedExePath = app.isPackaged
          ? existsSync(exePath)
            ? exePath
            : resolveRealEsrganExecutablePath()
          : exePath

        if (!resolvedExePath) throw new Error('[ImageLab] Real-ESRGAN 未配置：请先在 Settings 设置可执行文件路径。')
        if (!existsSync(resolvedExePath)) {
          throw new Error(`[ImageLab] Real-ESRGAN 可执行文件不存在：${resolvedExePath}`)
        }
        if (files.length === 0) throw new Error('[ImageLab] files 不能为空。')

        const exeDir = path.dirname(resolvedExePath)

        const sendLog = (level: 'stdout' | 'stderr' | 'info' | 'error', message: string): void => {
          if (event.sender.isDestroyed()) return
          event.sender.send('process-log', { level, message, timestamp: Date.now() })
        }

        const runOne = async (inputPath: string, outputPath: string): Promise<void> => {
          await new Promise<void>((resolve, reject) => {
            const child = spawn(resolvedExePath, ['-i', inputPath, '-o', outputPath, '-n', 'realesrgan-x4plus'], {
              cwd: exeDir,
              stdio: ['ignore', 'pipe', 'pipe']
            })

            let stdoutBuffer = ''
            let stderrBuffer = ''

            const flushLines = (level: 'stdout' | 'stderr', isFinal = false): void => {
              const buffer = level === 'stdout' ? stdoutBuffer : stderrBuffer
              const parts = buffer.split(/\r?\n/)
              const complete = isFinal ? parts : parts.slice(0, -1)
              const rest = isFinal ? '' : (parts[parts.length - 1] ?? '')
              for (const line of complete) {
                const trimmed = line.trimEnd()
                if (trimmed) sendLog(level, trimmed)
              }
              if (level === 'stdout') stdoutBuffer = rest
              else stderrBuffer = rest
            }

            child.stdout?.on('data', (chunk: Buffer) => {
              stdoutBuffer += chunk.toString('utf8')
              flushLines('stdout')
            })

            child.stderr?.on('data', (chunk: Buffer) => {
              stderrBuffer += chunk.toString('utf8')
              flushLines('stderr')
            })

            child.on('error', (error) => {
              sendLog('error', `[HD Upscale] 进程启动失败：${error.message}`)
              reject(error)
            })

            child.on('close', (code, signal) => {
              flushLines('stdout', true)
              flushLines('stderr', true)
              if (code === 0) {
                resolve()
                return
              }
              reject(new Error(`[HD Upscale] 处理失败：exit=${code ?? 'null'} signal=${signal ?? 'null'}`))
            })
          })
        }

        const outputs: string[] = []
        sendLog('info', `[HD Upscale] 开始：${files.length} 张；模型 realesrgan-x4plus`)

        for (const rawPath of files) {
          const rawInput = String(rawPath ?? '').trim()
          if (!rawInput) continue
          const inputPath = resolve(rawInput)
          if (!existsSync(inputPath)) {
            throw new Error(`[ImageLab] Input file is missing: ${inputPath}`)
          }

          const ext = extname(inputPath)
          const baseName = basename(inputPath, ext)
          const outPath = resolve(join(dirname(inputPath), `${baseName}_HD${ext || '.png'}`))
          const processingPlan = await createLocalProcessingPlan(inputPath, outPath, '画质重生', sendLog)
          try {
            sendLog('info', `[HD Upscale] 处理：${basename(inputPath)} -> ${basename(outPath)}`)
            await runOne(processingPlan.inputPath, processingPlan.outputPath)
            if (!existsSync(processingPlan.outputPath)) {
              await new Promise((r) => setTimeout(r, 500))
              if (!existsSync(processingPlan.outputPath)) {
                throw new Error(`[ImageLab] HD Upscale output missing: ${outPath}`)
              }
            }
            await ensureImageReadableWithRetry(processingPlan.outputPath, '画质重生', sendLog)
            await processingPlan.commit()
            await ensureImageReadableWithRetry(outPath, '画质重生', sendLog)
            outputs.push(outPath)
            sendLog('info', `[HD Upscale] 完成：${basename(outPath)}`)
          } finally {
            await processingPlan.cleanup()
          }
        }

        sendLog('info', `[HD Upscale] 全部完成：${outputs.length} 张`)
        return outputs
      })
    }
  )

  ipcMain.handle(
    'process-watermark',
    async (
      event,
      payload: {
        files: string[]
        pythonPath: string
        scriptPath: string
        watermarkBox?: { x: number; y: number; width: number; height: number }
      }
    ) => {
      return gpuLimit(async () => {
        const files = Array.isArray(payload?.files) ? payload.files : []
        const pythonPath = String(payload?.pythonPath ?? '').trim()
        const scriptPath = String(payload?.scriptPath ?? '').trim()
        const storedBox = configStore.get('watermarkBox')
        const resolvedBox = isValidWatermarkBox(payload?.watermarkBox)
          ? payload.watermarkBox
          : isValidWatermarkBox(storedBox)
            ? storedBox
            : defaultWatermarkBox
        const boxArg = `${resolvedBox.x},${resolvedBox.y},${resolvedBox.width},${resolvedBox.height}`

        const cmsEnginePath = resolveCmsEngineExecutablePath()
        const shouldUseBundledEngine = app.isPackaged

        if (shouldUseBundledEngine) {
          if (!existsSync(cmsEnginePath)) {
            throw new Error(`[ImageLab] 缺少内置 cms_engine：${cmsEnginePath}`)
          }
        } else {
          if (!pythonPath) throw new Error('[ImageLab] Python 未配置：请先在 Settings 设置 Python Interpreter Path。')
          if (!scriptPath) throw new Error('[ImageLab] Watermark Script 未配置：请先在 Settings 设置 Watermark Script Path。')
        }
        if (files.length === 0) throw new Error('[ImageLab] files 不能为空。')

        const scriptDir = shouldUseBundledEngine ? path.dirname(cmsEnginePath) : path.dirname(scriptPath)

        const sendLog = (level: 'stdout' | 'stderr' | 'info' | 'error', message: string): void => {
          if (event.sender.isDestroyed()) return
          event.sender.send('process-log', { level, message, timestamp: Date.now() })
        }

        const runOne = async (inputPath: string, outputPath: string): Promise<void> => {
          await new Promise<void>((resolve, reject) => {
            const command = shouldUseBundledEngine ? cmsEnginePath : pythonPath
            const args = shouldUseBundledEngine
              ? ['-i', inputPath, '-o', outputPath, '--box', boxArg]
              : [scriptPath, '-i', inputPath, '-o', outputPath, '--box', boxArg]

            const child = spawn(command, args, {
              cwd: scriptDir,
              stdio: ['ignore', 'pipe', 'pipe']
            })

            let stdoutBuffer = ''
            let stderrBuffer = ''

            const flushLines = (level: 'stdout' | 'stderr', isFinal = false): void => {
              const buffer = level === 'stdout' ? stdoutBuffer : stderrBuffer
              const parts = buffer.split(/\r?\n/)
              const complete = isFinal ? parts : parts.slice(0, -1)
              const rest = isFinal ? '' : (parts[parts.length - 1] ?? '')
              for (const line of complete) {
                const trimmed = line.trimEnd()
                if (trimmed) sendLog(level, trimmed)
              }
              if (level === 'stdout') stdoutBuffer = rest
              else stderrBuffer = rest
            }

            child.stdout?.on('data', (chunk: Buffer) => {
              stdoutBuffer += chunk.toString('utf8')
              flushLines('stdout')
            })

            child.stderr?.on('data', (chunk: Buffer) => {
              stderrBuffer += chunk.toString('utf8')
              flushLines('stderr')
            })

            child.on('error', (error) => {
              sendLog('error', `[Watermark] 进程启动失败：${error.message}`)
              reject(error)
            })

            child.on('close', (code, signal) => {
              flushLines('stdout', true)
              flushLines('stderr', true)
              if (code === 0) {
                resolve()
                return
              }
              reject(new Error(`[Watermark] 处理失败：exit=${code ?? 'null'} signal=${signal ?? 'null'}`))
            })
          })
        }

        const outputs: string[] = []
        sendLog(
          'info',
          shouldUseBundledEngine
            ? `[Watermark] 开始：${files.length} 张；Using bundled cms_engine...`
            : `[Watermark] 开始：${files.length} 张；Running AI Inpainting...`
        )

        for (const rawPath of files) {
          const rawInput = String(rawPath ?? '').trim()
          if (!rawInput) continue
          const inputPath = resolve(rawInput)
          if (!existsSync(inputPath)) {
            throw new Error(`[ImageLab] Input file is missing: ${inputPath}`)
          }

          const ext = extname(inputPath)
          const baseName = basename(inputPath, ext)
          const outPath = resolve(join(dirname(inputPath), `${baseName}_Clean${ext || '.png'}`))
          const processingPlan = await createLocalProcessingPlan(inputPath, outPath, '魔法去印', sendLog)
          try {
            sendLog('info', `[Watermark] 处理：${basename(inputPath)} -> ${basename(outPath)}`)
            await runOne(processingPlan.inputPath, processingPlan.outputPath)
            if (!existsSync(processingPlan.outputPath)) {
              sendLog('error', `[Watermark] 输出文件不存在：${outPath}`)
              continue
            }
            await ensureImageReadableWithRetry(processingPlan.outputPath, '魔法去印', sendLog)
            await processingPlan.commit()
            await ensureImageReadableWithRetry(outPath, '魔法去印', sendLog)
            outputs.push(outPath)
            sendLog('info', `[Watermark] 完成：${basename(outPath)}`)
          } finally {
            await processingPlan.cleanup()
          }
        }

        sendLog('info', `[Watermark] 全部完成：${outputs.length} 张`)
        return outputs
      })
    }
  )

  ipcMain.handle('delete-file', async (_event, filePath: string) => {
    const normalized = String(filePath ?? '').trim()
    if (!normalized) return { success: false, error: 'filePath 不能为空。' }

    try {
      await shell.trashItem(normalized)
      return { success: true }
    } catch (error) {
      try {
        await unlink(normalized)
        return { success: true }
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
      }
    }
  })

  ipcMain.handle('shell-showItemInFolder', async (_event, filePath: string) => {
    const normalized = String(filePath ?? '').trim()
    if (!normalized) return { success: false, error: 'filePath 不能为空。' }

    try {
      shell.showItemInFolder(normalized)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  })

  ipcMain.handle('cms.system.openExternal', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const rawUrl = typeof query.url === 'string' ? query.url.trim() : ''
    if (!rawUrl) return false
    let target: URL
    try {
      target = new URL(rawUrl)
    } catch {
      return false
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
    try {
      await shell.openExternal(target.toString())
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('export-files', async (event, filePaths: string[]) => {
    const inputs = Array.isArray(filePaths) ? filePaths.map((p) => String(p ?? '').trim()).filter(Boolean) : []
    if (inputs.length === 0) return { success: false, error: 'filePaths 不能为空。' }

    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: app.getPath('desktop')
        })
      : await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: app.getPath('desktop')
        })

    if (result.canceled || result.filePaths.length === 0) return null
    const destinationDir = result.filePaths[0]
    if (!destinationDir) return null

    const makeUniquePath = (desiredPath: string): string => {
      if (!existsSync(desiredPath)) return desiredPath
      const ext = extname(desiredPath)
      const name = basename(desiredPath, ext)
      const dir = dirname(desiredPath)
      for (let i = 1; i <= 10_000; i += 1) {
        const candidate = join(dir, `${name} (${i})${ext}`)
        if (!existsSync(candidate)) return candidate
      }
      return join(dir, `${name} (${Date.now()})${ext}`)
    }

    let copied = 0
    for (const inputPath of inputs) {
      if (!existsSync(inputPath)) continue
      const fileName = basename(inputPath)
      if (!fileName) continue
      const outPath = makeUniquePath(join(destinationDir, fileName))
      await copyFile(inputPath, outPath)
      copied += 1
    }

    return { success: true, copied, destinationDir }
  })

  ipcMain.handle('get-feishu-config', async () => {
    return configStore.get('feishuConfig') ?? null
  })

  ipcMain.handle('get-config', async () => {
    const storedBox = configStore.get('watermarkBox')
    const watermarkBox = isValidWatermarkBox(storedBox) ? storedBox : defaultWatermarkBox
    if (!isValidWatermarkBox(storedBox)) {
      configStore.set('watermarkBox', watermarkBox)
    }
    const storedImportStrategy = configStore.get('importStrategy')
    const importStrategy = storedImportStrategy === 'move' ? 'move' : 'copy'
    if (storedImportStrategy !== importStrategy) {
      configStore.set('importStrategy', importStrategy)
    }
    const storedDefaultStartTime = configStore.get('defaultStartTime')
    const defaultStartTime =
      typeof storedDefaultStartTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(storedDefaultStartTime)
        ? storedDefaultStartTime
        : '10:00'
    if (storedDefaultStartTime !== defaultStartTime) {
      configStore.set('defaultStartTime', defaultStartTime)
    }
    const storedDefaultInterval = configStore.get('defaultInterval')
    const parsedDefaultInterval =
      typeof storedDefaultInterval === 'number' ? storedDefaultInterval : Number(storedDefaultInterval)
    const defaultInterval = Number.isFinite(parsedDefaultInterval) ? Math.max(0, Math.floor(parsedDefaultInterval)) : 30
    if (storedDefaultInterval !== defaultInterval) {
      configStore.set('defaultInterval', defaultInterval)
    }
    const storedDynamicWatermarkEnabled = configStore.get('dynamicWatermarkEnabled')
    const dynamicWatermarkEnabled = normalizeDynamicWatermarkEnabled(storedDynamicWatermarkEnabled)
    if (storedDynamicWatermarkEnabled !== dynamicWatermarkEnabled) {
      configStore.set('dynamicWatermarkEnabled', dynamicWatermarkEnabled)
    }
    const storedDynamicWatermarkOpacity = configStore.get('dynamicWatermarkOpacity')
    const dynamicWatermarkOpacity = normalizeDynamicWatermarkOpacity(storedDynamicWatermarkOpacity)
    if (storedDynamicWatermarkOpacity !== dynamicWatermarkOpacity) {
      configStore.set('dynamicWatermarkOpacity', dynamicWatermarkOpacity)
    }
    const storedDynamicWatermarkSize = configStore.get('dynamicWatermarkSize')
    const dynamicWatermarkSize = normalizeDynamicWatermarkSize(storedDynamicWatermarkSize)
    if (storedDynamicWatermarkSize !== dynamicWatermarkSize) {
      configStore.set('dynamicWatermarkSize', dynamicWatermarkSize)
    }
    const storedDynamicWatermarkTrajectory = configStore.get('dynamicWatermarkTrajectory')
    const dynamicWatermarkTrajectory = normalizeDynamicWatermarkTrajectory(storedDynamicWatermarkTrajectory)
    if (storedDynamicWatermarkTrajectory !== dynamicWatermarkTrajectory) {
      configStore.set('dynamicWatermarkTrajectory', dynamicWatermarkTrajectory)
    }
    const storedAutoImportDir = configStore.get('scoutDashboardAutoImportDir')
    const scoutDashboardAutoImportDir = typeof storedAutoImportDir === 'string' ? storedAutoImportDir.trim() : ''
    if (storedAutoImportDir !== scoutDashboardAutoImportDir) {
      configStore.set('scoutDashboardAutoImportDir', scoutDashboardAutoImportDir)
    }
    const storedAutoImportSince = configStore.get('scoutDashboardAutoImportSince')
    const parsedAutoImportSince =
      typeof storedAutoImportSince === 'number' ? storedAutoImportSince : Number(storedAutoImportSince)
    const normalizedAutoImportSince =
      Number.isFinite(parsedAutoImportSince) && parsedAutoImportSince > 0 ? Math.floor(parsedAutoImportSince) : 0
    if (scoutDashboardAutoImportDir && normalizedAutoImportSince <= 0) {
      configStore.set('scoutDashboardAutoImportSince', Date.now())
    } else if (!scoutDashboardAutoImportDir && normalizedAutoImportSince !== 0) {
      configStore.set('scoutDashboardAutoImportSince', 0)
    }
    const storedQueueConfig = configStore.get('queueConfig')
    const queueConfig = {
      taskIntervalMinMs: Math.max(0, Math.floor(Number(storedQueueConfig?.taskIntervalMinMs) || 30000)),
      taskIntervalMaxMs: Math.max(0, Math.floor(Number(storedQueueConfig?.taskIntervalMaxMs) || 90000)),
      dailyLimitPerAccount: Math.max(0, Math.floor(Number(storedQueueConfig?.dailyLimitPerAccount) || 20)),
      cooldownAfterNTasks: Math.max(1, Math.floor(Number(storedQueueConfig?.cooldownAfterNTasks) || 5)),
      cooldownDurationMs: Math.max(0, Math.floor(Number(storedQueueConfig?.cooldownDurationMs) || 300000))
    }

    return {
      importStrategy,
      realEsrganPath: configStore.get('realEsrganPath') ?? '',
      pythonPath: configStore.get('pythonPath') ?? '',
      watermarkScriptPath: configStore.get('watermarkScriptPath') ?? '',
      scoutDashboardAutoImportDir,
      watermarkBox,
      defaultStartTime,
      defaultInterval,
      dynamicWatermarkEnabled,
      dynamicWatermarkOpacity,
      dynamicWatermarkSize,
      dynamicWatermarkTrajectory,
      queueConfig
    }
  })

  ipcMain.handle(
    'save-config',
    async (
      _event,
      patch:
        | {
            importStrategy?: 'copy' | 'move'
            realEsrganPath?: string
            pythonPath?: string
            watermarkScriptPath?: string
            dynamicWatermarkEnabled?: boolean
            dynamicWatermarkOpacity?: number
            dynamicWatermarkSize?: number
            dynamicWatermarkTrajectory?: DynamicWatermarkTrajectory
            scoutDashboardAutoImportDir?: string
            watermarkBox?: { x: number; y: number; width: number; height: number }
            defaultStartTime?: string
            defaultInterval?: number
            queueConfig?: {
              taskIntervalMinMs?: number
              taskIntervalMaxMs?: number
              dailyLimitPerAccount?: number
              cooldownAfterNTasks?: number
              cooldownDurationMs?: number
            }
          }
        | null
        | undefined
    ) => {
    if (patch?.importStrategy === 'copy' || patch?.importStrategy === 'move') {
      configStore.set('importStrategy', patch.importStrategy)
    }
    const nextRealEsrganPath = typeof patch?.realEsrganPath === 'string' ? patch.realEsrganPath.trim() : undefined
    if (nextRealEsrganPath !== undefined) {
      configStore.set('realEsrganPath', nextRealEsrganPath)
    }
    const nextPythonPath = typeof patch?.pythonPath === 'string' ? patch.pythonPath.trim() : undefined
    if (nextPythonPath !== undefined) {
      configStore.set('pythonPath', nextPythonPath)
    }
    const nextWatermarkScriptPath =
      typeof patch?.watermarkScriptPath === 'string' ? patch.watermarkScriptPath.trim() : undefined
    if (nextWatermarkScriptPath !== undefined) {
      configStore.set('watermarkScriptPath', nextWatermarkScriptPath)
    }
    if (typeof patch?.dynamicWatermarkEnabled === 'boolean') {
      configStore.set('dynamicWatermarkEnabled', patch.dynamicWatermarkEnabled)
    }
    if (typeof patch?.dynamicWatermarkOpacity === 'number' && Number.isFinite(patch.dynamicWatermarkOpacity)) {
      configStore.set('dynamicWatermarkOpacity', normalizeDynamicWatermarkOpacity(patch.dynamicWatermarkOpacity))
    }
    if (typeof patch?.dynamicWatermarkSize === 'number' && Number.isFinite(patch.dynamicWatermarkSize)) {
      configStore.set('dynamicWatermarkSize', normalizeDynamicWatermarkSize(patch.dynamicWatermarkSize))
    }
    if (typeof patch?.dynamicWatermarkTrajectory === 'string') {
      configStore.set('dynamicWatermarkTrajectory', normalizeDynamicWatermarkTrajectory(patch.dynamicWatermarkTrajectory))
    }
    const nextScoutDashboardAutoImportDir =
      typeof patch?.scoutDashboardAutoImportDir === 'string'
        ? patch.scoutDashboardAutoImportDir.trim()
        : undefined
    if (nextScoutDashboardAutoImportDir !== undefined) {
      const currentDirRaw = configStore.get('scoutDashboardAutoImportDir')
      const currentDir = typeof currentDirRaw === 'string' ? currentDirRaw.trim() : ''
      configStore.set('scoutDashboardAutoImportDir', nextScoutDashboardAutoImportDir)
      if (!nextScoutDashboardAutoImportDir) {
        configStore.set('scoutDashboardAutoImportSince', 0)
      } else if (nextScoutDashboardAutoImportDir !== currentDir) {
        configStore.set('scoutDashboardAutoImportSince', Date.now())
      } else {
        const rawSince = configStore.get('scoutDashboardAutoImportSince')
        const parsedSince = typeof rawSince === 'number' ? rawSince : Number(rawSince)
        if (!Number.isFinite(parsedSince) || parsedSince <= 0) {
          configStore.set('scoutDashboardAutoImportSince', Date.now())
        }
      }
      ensureScoutDashboardAutoImportWatcher()
    }
    if (isValidWatermarkBox(patch?.watermarkBox)) {
      configStore.set('watermarkBox', patch.watermarkBox)
    }
    const nextDefaultStartTime = typeof patch?.defaultStartTime === 'string' ? patch.defaultStartTime.trim() : undefined
    if (nextDefaultStartTime !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(nextDefaultStartTime)) {
      configStore.set('defaultStartTime', nextDefaultStartTime)
    }
    const nextDefaultInterval = typeof patch?.defaultInterval === 'number' ? patch.defaultInterval : undefined
    if (nextDefaultInterval !== undefined && Number.isFinite(nextDefaultInterval)) {
      configStore.set('defaultInterval', Math.max(0, Math.floor(nextDefaultInterval)))
    }
    if (patch?.queueConfig && typeof patch.queueConfig === 'object') {
      const qc = patch.queueConfig
      const merged = {
        taskIntervalMinMs: typeof qc.taskIntervalMinMs === 'number' && Number.isFinite(qc.taskIntervalMinMs) ? Math.max(0, Math.floor(qc.taskIntervalMinMs)) : 30000,
        taskIntervalMaxMs: typeof qc.taskIntervalMaxMs === 'number' && Number.isFinite(qc.taskIntervalMaxMs) ? Math.max(0, Math.floor(qc.taskIntervalMaxMs)) : 90000,
        dailyLimitPerAccount: typeof qc.dailyLimitPerAccount === 'number' && Number.isFinite(qc.dailyLimitPerAccount) ? Math.max(0, Math.floor(qc.dailyLimitPerAccount)) : 20,
        cooldownAfterNTasks: typeof qc.cooldownAfterNTasks === 'number' && Number.isFinite(qc.cooldownAfterNTasks) ? Math.max(1, Math.floor(qc.cooldownAfterNTasks)) : 5,
        cooldownDurationMs: typeof qc.cooldownDurationMs === 'number' && Number.isFinite(qc.cooldownDurationMs) ? Math.max(0, Math.floor(qc.cooldownDurationMs)) : 300000
      }
      configStore.set('queueConfig', merged)
    }
    return { success: true }
  })


  ipcMain.handle(
    'feishu-upload-image',
    async (_event, filePath: string, appId: string, appSecret: string, baseToken: string) => {
    const normalizedPath = filePath.trim()
    if (!normalizedPath) throw new Error('[Feishu] filePath 不能为空。')

    const normalizedBaseToken = baseToken.trim()
    if (!normalizedBaseToken) throw new Error('[Feishu] baseToken 不能为空。')

    const fileStats = await stat(normalizedPath)
    const fileSize = fileStats.size
    const token = await getTenantAccessToken(appId, appSecret)
    const blob = await openAsBlob(normalizedPath)
    const fileName = basename(normalizedPath)

    const form = new FormData()
    form.append('file_name', fileName)
    form.append('parent_type', 'bitable_image')
    form.append('parent_node', normalizedBaseToken)
    form.append('size', String(fileSize))
    form.append('file', blob, fileName)

    const res = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form
    })

    const { data, logId } = await readFeishuJson<UploadImageResponse>(res)
    const payload =
      (() => {
        try {
          return JSON.stringify(data)
        } catch {
          return String(data)
        }
      })()

    const fileToken = data.data?.file_token ?? data.data?.fileToken ?? data.data?.image_key ?? data.data?.imageKey
    if (!res.ok || data.code !== 0 || !fileToken) {
      throw new Error(
        `[Feishu] 上传图片失败：${getFeishuErrorMsg(data) || res.statusText} (${logId ?? 'no-logid'}) ${payload}`
      )
    }

    return fileToken
  })

  ipcMain.handle(
    'feishu-create-record',
    async (
      _event,
      fields: Record<string, unknown>,
      appId: string,
      appSecret: string,
      baseToken: string,
      tableId: string
    ) => {
      const normalizedBaseToken = baseToken.trim()
      const normalizedTableId = tableId.trim()
      if (!normalizedBaseToken || !normalizedTableId) throw new Error('[Feishu] baseToken/tableId 不能为空。')

      const normalizedFields = normalizeBitableAttachmentFields(fields)
      const token = await getTenantAccessToken(appId, appSecret)
      const res = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(
          normalizedBaseToken
        )}/tables/${encodeURIComponent(normalizedTableId)}/records`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({ fields: normalizedFields })
        }
      )

      const { data, logId } = await readFeishuJson<CreateRecordResponse>(res)
      const recordId = data.data?.record?.record_id
      if (!res.ok || data.code !== 0 || !recordId) {
        throw new Error(`[Feishu] 新增记录失败：${getFeishuErrorMsg(data) || res.statusText} (${logId ?? 'no-logid'})`)
      }

      return recordId
    }
  )

  ipcMain.handle(
    'feishu-test-connection',
    async (_event, appId: string, appSecret: string, baseToken: string, tableId: string) => {
      const normalizedAppId = appId.trim()
      const normalizedSecret = appSecret.trim()
      const normalizedBaseToken = baseToken.trim()
      const normalizedTableId = tableId.trim()

      if (!normalizedAppId || !normalizedSecret) {
        throw new Error('[Token Error] appId/appSecret 不能为空。')
      }
      if (!normalizedBaseToken || !normalizedTableId) {
        throw new Error('[Table Error] baseToken/tableId 不能为空。')
      }

      let token = ''
      try {
        token = await getTenantAccessToken(normalizedAppId, normalizedSecret)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[Token Error] ${message}`)
      }

      try {
        const res = await fetch(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(
            normalizedBaseToken
          )}/tables/${encodeURIComponent(normalizedTableId)}/records?page_size=1`,
          {
            method: 'GET',
            headers: { authorization: `Bearer ${token}` }
          }
        )

        const { data, logId } = await readFeishuJson<ListRecordsResponse>(res)

        let raw = ''
        try {
          raw = JSON.stringify(data)
        } catch {
          raw = String(data)
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}: ${raw}${logId ? ` (${logId})` : ''}`)
        }

        if (data.code !== 0) {
          throw new Error(`Code ${data.code}: ${raw}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`[Table Error] ${message}`)
      }

      configStore.set('feishuConfig', {
        appId: normalizedAppId,
        appSecret: normalizedSecret,
        baseToken: normalizedBaseToken,
        tableId: normalizedTableId
      })
      return { success: true }
    }
  )

  // ============================================================
  // Scout: 选品数据模块 IPC
  // ============================================================

  ipcMain.handle('cms.scout.keyword.list', async () => scoutService.listKeywords())

  ipcMain.handle('cms.scout.keyword.add', async (_event, payload: { keyword?: string; sortMode?: string }) => {
    const keyword = typeof payload?.keyword === 'string' ? payload.keyword : ''
    const sortMode = typeof payload?.sortMode === 'string' ? payload.sortMode : 'comprehensive'
    return scoutService.addKeyword(keyword, sortMode)
  })

  ipcMain.handle('cms.scout.keyword.remove', async (_event, payload: { id?: string }) => {
    const id = typeof payload?.id === 'string' ? payload.id : ''
    return scoutService.removeKeyword(id)
  })

  ipcMain.handle('cms.scout.keyword.toggle', async (_event, payload: { id?: string; isActive?: boolean }) => {
    const id = typeof payload?.id === 'string' ? payload.id : ''
    const isActive = payload?.isActive === true
    return scoutService.toggleKeyword(id, isActive)
  })

  ipcMain.handle('cms.scout.product.list', async (_event, payload: unknown) => {
    const opts = (payload ?? {}) as Record<string, unknown>
    return scoutService.listProducts({
      keywordId: typeof opts.keywordId === 'string' ? opts.keywordId : '',
      sortBy: typeof opts.sortBy === 'string' ? opts.sortBy : undefined,
      sortOrder: opts.sortOrder === 'ASC' ? 'ASC' : 'DESC',
      limit: typeof opts.limit === 'number' ? opts.limit : undefined,
      offset: typeof opts.offset === 'number' ? opts.offset : undefined
    })
  })

  ipcMain.handle('cms.scout.sync.importFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }]
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return scoutService.importFromFile(result.filePaths[0]!)
  })

  ipcMain.handle('cms.scout.sync.importData', async (_event, data: unknown) => {
    return scoutService.importSyncData(data)
  })

  ipcMain.handle('cms.scout.sync.history', async () => scoutService.getSyncHistory())

  ipcMain.handle('cms.scout.export.excel', async (event, payload: { keywordId?: string }) => {
    const keywordId = typeof payload?.keywordId === 'string' ? payload.keywordId : ''
    const products = keywordId ? scoutService.listProducts({ keywordId, limit: 5000 }) : []
    if (products.length === 0) return null

    const win = BrowserWindow.fromWebContents(event.sender)
    const saveResult = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: `scout_export_${Date.now()}.xlsx`,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath: `scout_export_${Date.now()}.xlsx`,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        })
    if (saveResult.canceled || !saveResult.filePath) return null

    const mod = await import('exceljs')
    const WorkbookCtor =
      (mod as { Workbook?: new () => unknown }).Workbook ??
      (mod as { default?: { Workbook?: new () => unknown } }).default?.Workbook
    if (!WorkbookCtor) {
      throw new Error('ExcelJS.Workbook 构造器不可用')
    }
    const workbook = new WorkbookCtor() as {
      addWorksheet: (name: string) => {
        columns: Array<{ header: string; key: string; width?: number }>
        addRow: (row: Record<string, unknown>) => void
      }
      xlsx: { writeFile: (filePath: string) => Promise<void> }
    }
    const sheet = workbook.addWorksheet('选品数据')
    sheet.columns = [
      { header: '商品名称', key: 'productName', width: 30 },
      { header: '商品链接', key: 'productUrl', width: 20 },
      { header: '价格', key: 'price', width: 10 },
      { header: '24h加购', key: 'addCart24h', width: 15 },
      { header: '销量', key: 'totalSales', width: 12 },
      { header: '3个月购买人数', key: 'threeMonthBuyers', width: 15 },
      { header: '加购标签', key: 'addCartTag', width: 15 },
      { header: '好评标签', key: 'positiveReviewTag', width: 15 },
      { header: '收藏标签', key: 'collectionTag', width: 15 },
      { header: '店铺名称', key: 'shopName', width: 20 },
      { header: '店铺链接', key: 'shopUrl', width: 20 },
      { header: '店铺粉丝', key: 'shopFans', width: 12 },
      { header: '店铺销量', key: 'shopSales', width: 12 },
      { header: '店铺评分', key: 'shopRating', width: 10 },
      { header: '评价数', key: 'reviewCount', width: 10 },
      { header: '商品评分', key: 'productRating', width: 10 },
      { header: '首次发现时间', key: 'firstSeenAt', width: 18 },
      { header: '最后更新时间', key: 'lastUpdatedAt', width: 18 }
    ]
    for (const p of products) {
      sheet.addRow({
        ...p,
        firstSeenAt: new Date(p.firstSeenAt).toLocaleString('zh-CN'),
        lastUpdatedAt: new Date(p.lastUpdatedAt).toLocaleString('zh-CN')
      })
    }
    await workbook.xlsx.writeFile(saveResult.filePath)
    return saveResult.filePath
  })

  ipcMain.handle('cms.scout.dashboard.importExcelFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls'] }]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls'] }]
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return scoutService.importExcelSnapshotFromFile(result.filePaths[0]!)
  })

  ipcMain.handle('cms.scout.dashboard.autoImportScanNow', async () => {
    ensureScoutDashboardAutoImportWatcher()
    return runScoutDashboardAutoImportScan('manual')
  })

  ipcMain.handle('cms.scout.dashboard.deleteSnapshot', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const snapshotDate = typeof query.snapshotDate === 'string' ? query.snapshotDate : ''
    return scoutService.deleteDashboardSnapshot(snapshotDate)
  })

  ipcMain.handle('cms.scout.dashboard.deleteKeywordSnapshot', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const snapshotDate = typeof query.snapshotDate === 'string' ? query.snapshotDate : ''
    const keyword = typeof query.keyword === 'string' ? query.keyword : ''
    return scoutService.deleteDashboardSnapshotKeyword(snapshotDate, keyword)
  })

  ipcMain.handle('cms.scout.dashboard.coverDebugState', async () => {
    return readCoverDebugState()
  })

  ipcMain.handle('cms.scout.dashboard.setCoverDebugState', async (_event, payload: unknown) => {
    const row = (payload ?? {}) as Record<string, unknown>
    const visual = parseOptionalBool(row.visual)
    const keepWindowOpen = parseOptionalBool(row.keepWindowOpen)
    const openDevTools = parseOptionalBool(row.openDevTools)

    if (visual != null) {
      const value = visual ? '1' : '0'
      process.env.CMS_SCOUT_COVER_VISUAL = value
      process.env.CMS_SCOUT_SOURCING_VISUAL = value
    }
    if (keepWindowOpen != null) {
      const value = keepWindowOpen ? '1' : '0'
      process.env.CMS_SCOUT_COVER_KEEP_OPEN = value
      process.env.CMS_SCOUT_KEEP_WINDOW_OPEN = value
    }
    if (openDevTools != null) {
      const value = openDevTools ? '1' : '0'
      process.env.CMS_SCOUT_COVER_OPEN_DEVTOOLS = value
      process.env.CMS_SCOUT_OPEN_DEVTOOLS = value
    }

    const state = readCoverDebugState()
    appendCoverFetchDebugLog(
      `debug-switch visual=${state.visual ? 1 : 0} keep=${state.keepWindowOpen ? 1 : 0} devtools=${state.openDevTools ? 1 : 0}`
    )
    return state
  })

  ipcMain.handle('cms.scout.dashboard.coverDebugLog', async (_event, payload: unknown) => {
    const row = (payload ?? {}) as Record<string, unknown>
    const parsedLimit = typeof row.limit === 'number' ? row.limit : Number(row.limit)
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(20, Math.min(500, Math.floor(parsedLimit)))
      : 120
    const logPath = getCoverFetchDebugLogPath()
    const content = await readFile(logPath, 'utf-8').catch(() => '')
    const lines = content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(-limit)
    return { logPath, lines }
  })

  ipcMain.handle('cms.scout.dashboard.meta', async () => scoutService.getDashboardMeta())

  ipcMain.handle('cms.scout.dashboard.keywordHeat', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    return scoutService.listDashboardKeywordHeat({
      snapshotDate: typeof query.snapshotDate === 'string' ? query.snapshotDate : undefined,
      keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
      onlyAlerts: query.onlyAlerts === true,
      limit: typeof query.limit === 'number' ? query.limit : undefined
    })
  })

  ipcMain.handle('cms.scout.dashboard.potentialProducts', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    return scoutService.listDashboardPotentialProducts({
      snapshotDate: typeof query.snapshotDate === 'string' ? query.snapshotDate : undefined,
      keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
      onlyNew: query.onlyNew === true,
      limit: typeof query.limit === 'number' ? query.limit : undefined,
      sortBy:
        query.sortBy === 'potentialScore' ||
        query.sortBy === 'addCart24hValue' ||
        query.sortBy === 'deltaAddCart24h' ||
        query.sortBy === 'shopFans' ||
        query.sortBy === 'lastUpdatedAt'
          ? query.sortBy
          : undefined,
      sortOrder: query.sortOrder === 'ASC' ? 'ASC' : 'DESC'
    })
  })

  ipcMain.handle('cms.scout.dashboard.trends', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    return scoutService.getDashboardKeywordTrends({
      snapshotDate: typeof query.snapshotDate === 'string' ? query.snapshotDate : undefined,
      keyword: typeof query.keyword === 'string' ? query.keyword : undefined,
      days: typeof query.days === 'number' ? query.days : undefined,
      limit: typeof query.limit === 'number' ? query.limit : undefined
    })
  })

  ipcMain.handle('cms.scout.dashboard.productDetail', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const snapshotDate = typeof query.snapshotDate === 'string' ? query.snapshotDate : ''
    const productKey = typeof query.productKey === 'string' ? query.productKey : ''
    return scoutService.getDashboardProductDetail(snapshotDate, productKey)
  })

  ipcMain.handle('cms.scout.dashboard.markPotential', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const snapshotDate = typeof query.snapshotDate === 'string' ? query.snapshotDate : ''
    const products = Array.isArray(query.products) ? query.products : []
    return scoutService.markDashboardPotentialProducts({
      snapshotDate,
      products: products.map((item) => {
        const row = (item ?? {}) as Record<string, unknown>
        return {
          snapshotDate,
          productKey: typeof row.productKey === 'string' ? row.productKey : '',
          keyword: typeof row.keyword === 'string' ? row.keyword : '',
          productName: typeof row.productName === 'string' ? row.productName : '',
          productUrl: typeof row.productUrl === 'string' ? row.productUrl : null,
          salePrice: typeof row.salePrice === 'number' ? row.salePrice : null
        }
      })
    })
  })

  ipcMain.handle('cms.scout.dashboard.markedProducts', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    return scoutService.listDashboardMarkedProducts({
      snapshotDate: typeof query.snapshotDate === 'string' ? query.snapshotDate : undefined,
      keyword: typeof query.keyword === 'string' ? query.keyword : undefined
    })
  })

  ipcMain.handle('cms.scout.dashboard.bindSupplier', async (_event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    return scoutService.bindDashboardSupplier({
      snapshotDate: typeof query.snapshotDate === 'string' ? query.snapshotDate : '',
      productKey: typeof query.productKey === 'string' ? query.productKey : '',
      supplierName: typeof query.supplierName === 'string' ? query.supplierName : null,
      companyName: typeof query.companyName === 'string' ? query.companyName : null,
      supplierUrl: typeof query.supplierUrl === 'string' ? query.supplierUrl : null,
      supplierPrice: typeof query.supplierPrice === 'number' ? query.supplierPrice : Number(query.supplierPrice),
      supplierNetProfit:
        typeof query.supplierNetProfit === 'number' ? query.supplierNetProfit : Number(query.supplierNetProfit),
      supplierMoq: typeof query.supplierMoq === 'string' ? query.supplierMoq : null,
      supplierFreightPrice:
        typeof query.supplierFreightPrice === 'number' ? query.supplierFreightPrice : Number(query.supplierFreightPrice),
      supplierServiceRateLabel:
        typeof query.supplierServiceRateLabel === 'string' ? query.supplierServiceRateLabel : null,
      sourceImage1: typeof query.sourceImage1 === 'string' ? query.sourceImage1 : null
    })
  })

  ipcMain.handle(IPC_SEARCH_1688_BY_IMAGE, async (event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const imageUrl = typeof query.imageUrl === 'string' ? query.imageUrl.trim() : ''
    const targetPrice =
      typeof query.targetPrice === 'number' && Number.isFinite(query.targetPrice)
        ? query.targetPrice
        : Number(query.targetPrice)
    const productId = typeof query.productId === 'string' ? query.productId : ''
    const keyword = typeof query.keyword === 'string' ? query.keyword : ''
    let tempFilePath = ''
    let localImagePath = ''
    if (/^https?:\/\//i.test(imageUrl)) {
      try {
        tempFilePath = await downloadImageToTempForSourcing(imageUrl)
        localImagePath = tempFilePath
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        sendLogToRenderer('warn', `[Sourcing] image download failed, fallback to keyword: ${msg}`)
      }
    }
    try {
      return await scoutService.search1688ByImage(
        {
          localImagePath,
          targetPrice,
          productId,
          keyword
        },
        {
          onCaptchaNeeded: () => {
            event.sender.send(IPC_SOURCING_CAPTCHA_NEEDED)
          },
          onLoginNeeded: () => {
            event.sender.send(IPC_SOURCING_LOGIN_NEEDED)
          }
        }
      )
    } finally {
      if (tempFilePath) {
        await unlink(tempFilePath).catch(() => void 0)
      }
    }
  })

  ipcMain.handle('cms.scout.dashboard.open1688Login', async () => {
    if (sourcingLoginWindow && !sourcingLoginWindow.isDestroyed()) {
      sourcingLoginWindow.show()
      sourcingLoginWindow.focus()
      return true
    }
    sourcingLoginWindow = new BrowserWindow({
      width: 1260,
      height: 860,
      title: '1688 登录窗口',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:scout-sourcing',
        sandbox: false
      }
    })
    sourcingLoginWindow.on('closed', () => {
      sourcingLoginWindow = null
    })
    await sourcingLoginWindow.loadURL('https://www.1688.com/')
    return true
  })

  ipcMain.handle('cms.scout.dashboard.check1688Login', async () => {
    const s = session.fromPartition('persist:scout-sourcing')
    const cookies = await s.cookies.get({})
    const hasLoginCookie = cookies.some((item) => {
      const domain = String(item.domain ?? '')
      if (!/1688\.com|taobao\.com|alibaba\.com/i.test(domain)) return false
      const name = String(item.name ?? '')
      return (
        name === '_m_h5_tk' ||
        name === 'cookie2' ||
        name === 'xman_us_t' ||
        name === '_tb_token_'
      )
    })
    sendLogToRenderer('info', `[Sourcing] 1688 login status: ${hasLoginCookie ? 'logged-in' : 'not-logged'}`)
    return hasLoginCookie
  })

  ipcMain.handle('cms.scout.dashboard.exportExcel', async (event, payload: unknown) => {
    const query = (payload ?? {}) as Record<string, unknown>
    const snapshotDate = typeof query.snapshotDate === 'string' ? query.snapshotDate : undefined
    const keyword = typeof query.keyword === 'string' ? query.keyword : undefined
    const onlyAlerts = query.onlyAlerts === true
    const onlyNew = query.onlyNew === true

    const win = BrowserWindow.fromWebContents(event.sender)
    const saveResult = win
      ? await dialog.showSaveDialog(win, {
          defaultPath: `heat_dashboard_${Date.now()}.xlsx`,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath: `heat_dashboard_${Date.now()}.xlsx`,
          filters: [{ name: 'Excel', extensions: ['xlsx'] }]
        })

    if (saveResult.canceled || !saveResult.filePath) return null
    return scoutService.exportDashboardExcel(saveResult.filePath, {
      snapshotDate,
      keyword,
      onlyAlerts,
      onlyNew
    })
  })

  // 开发环境默认用 F12 打开 DevTools；生产环境屏蔽 Cmd/Ctrl + R 刷新
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 防止系统自动休眠，确保排期任务能按时执行
  const powerSaveId = powerSaveBlocker.start('prevent-app-suspension')
  console.log(`[PowerSave] Blocker started (id=${powerSaveId})`)

  void createWindow()
  initAutoUpdate()

  app.on('activate', function () {
    // macOS：点击 Dock 图标时显示已隐藏的窗口，或重新创建窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    } else if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

// 除 macOS 外，所有窗口关闭时退出应用；macOS 通常保持菜单栏直到 Cmd + Q 退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (isQuitting) return
  isQuitting = true
  try {
    disposeScoutDashboardAutoImportWatcher?.()
  } catch (error) {
    void error
  }
  disposeScoutDashboardAutoImportWatcher = null
  app.quit()
})

// 其余主进程逻辑可在此文件继续扩展，或拆分到独立模块后引入
