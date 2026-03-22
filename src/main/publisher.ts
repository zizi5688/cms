import { app, BrowserWindow, ipcMain, Notification, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { join } from 'path'
import ElectronStore from 'electron-store'
import { is } from '@electron-toolkit/utils'
import type { AccountManager } from './services/accountManager'
import type { TaskManager } from './taskManager'
import { QueueService } from './services/queueService'
import { DiagnosticsService } from './services/diagnostics'
import {
  buildPublishNotificationPayload,
  buildPublishWorkerWindowOptions,
  readPublishDebugState,
  runWithTimeout
} from './publisherHelpers'
import {
  applyPublishStageUpdate,
  buildPublishFailureSummary,
  completePublishSession,
  createPublishSessionSnapshot,
  derivePublishStageUpdate,
  failPublishSession,
  type PublishSessionSnapshot
} from './publishSessionHelpers'
import { createPublishQueueScheduler, type PublishQueueRunResult } from './publishQueueScheduler'

type ElectronStoreCtor = new <T extends Record<string, unknown> = Record<string, unknown>>() => ElectronStore<T>
const StoreCtor = ((ElectronStore as unknown as { default?: ElectronStoreCtor }).default ??
  (ElectronStore as unknown as ElectronStoreCtor)) as ElectronStoreCtor

type QueueConfig = {
  taskIntervalMinMs: number
  taskIntervalMaxMs: number
  dailyLimitPerAccount: number
  cooldownAfterNTasks: number
  cooldownDurationMs: number
}

const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  taskIntervalMinMs: 30_000,
  taskIntervalMaxMs: 90_000,
  dailyLimitPerAccount: 20,
  cooldownAfterNTasks: 5,
  cooldownDurationMs: 300_000
}

function resolveWorkspacePath(): string {
  const store = new StoreCtor<{ workspacePath?: string }>()
  const stored = store.get('workspacePath')
  const normalized = typeof stored === 'string' ? stored.trim() : ''
  return normalized || join(app.getPath('documents'), is.dev ? 'SuperCMS_Data_Dev' : 'SuperCMS_Data')
}

function resolveQueueConfig(): QueueConfig {
  const store = new StoreCtor<{ queueConfig?: Partial<QueueConfig> }>()
  const stored = store.get('queueConfig')
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_QUEUE_CONFIG }
  return {
    taskIntervalMinMs: Math.max(0, Math.floor(Number(stored.taskIntervalMinMs) || DEFAULT_QUEUE_CONFIG.taskIntervalMinMs)),
    taskIntervalMaxMs: Math.max(0, Math.floor(Number(stored.taskIntervalMaxMs) || DEFAULT_QUEUE_CONFIG.taskIntervalMaxMs)),
    dailyLimitPerAccount: Math.max(0, Math.floor(Number(stored.dailyLimitPerAccount) || DEFAULT_QUEUE_CONFIG.dailyLimitPerAccount)),
    cooldownAfterNTasks: Math.max(1, Math.floor(Number(stored.cooldownAfterNTasks) || DEFAULT_QUEUE_CONFIG.cooldownAfterNTasks)),
    cooldownDurationMs: Math.max(0, Math.floor(Number(stored.cooldownDurationMs) || DEFAULT_QUEUE_CONFIG.cooldownDurationMs))
  }
}

/** Box-Muller 高斯随机延迟 */
function gaussianDelay(minMs: number, maxMs: number): number {
  const u1 = Math.random() || 1e-10
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const mean = (minMs + maxMs) / 2
  const stddev = (maxMs - minMs) / 6
  return Math.max(minMs, Math.min(maxMs, Math.round(mean + z * stddev)))
}

export type PublisherTaskData = {
  queueTaskId?: string
  title?: string
  content?: string
  mediaType?: 'image' | 'video'
  videoPath?: string
  videoCoverMode?: 'auto' | 'manual'
  images?: string[]
  imagePath?: string
  productId?: string
  productName?: string
  linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
  dryRun?: boolean
  mode?: 'immediate'
}

export type XhsProductRecord = {
  id: string
  name: string
  price: string
  cover: string
  productUrl: string
}

export type PublisherResult = { success: boolean; time?: string; error?: string }

type AutomationTaskPayload = {
  taskId: string
  taskData: {
    title: string
    content: string
    mediaType?: 'image' | 'video'
    videoPath?: string
    videoCoverMode?: 'auto' | 'manual'
    images: string[]
    productId?: string
    productName?: string
    linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
  }
  dryRun?: boolean
  mode?: 'immediate'
}

const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'
const PUBLISH_UI_READY_TIMEOUT_MS = 5_000
const PUBLISH_PAGE_LOAD_TIMEOUT_MS = 60_000
const QUEUE_DRY_RUN_ENABLED = process.env.CMS_QUEUE_DRY_RUN === '1'

function resolveWorkerPreloadPath(): string {
  return join(__dirname, '../preload/xhs-automation.js')
}

function resolveProductSyncPreloadPath(): string {
  return join(__dirname, '../preload/xhs-product-sync.js')
}

function normalizeVideoCoverMode(value: unknown): 'auto' | 'manual' {
  return value === 'auto' ? 'auto' : 'manual'
}

function normalizeTask(taskData: PublisherTaskData): {
  queueTaskId?: string
  title: string
  content: string
  mediaType: 'image' | 'video'
  videoPath?: string
  videoCoverMode?: 'auto' | 'manual'
  images: string[]
  productId?: string
  productName?: string
  linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
  dryRun: boolean
  mode: 'immediate'
} {
  const queueTaskId = typeof taskData?.queueTaskId === 'string' && taskData.queueTaskId.trim() ? taskData.queueTaskId.trim() : undefined
  const title = typeof taskData?.title === 'string' ? taskData.title : ''
  const content = typeof taskData?.content === 'string' ? taskData.content : ''
  const mediaType = taskData?.mediaType === 'video' || (typeof taskData?.videoPath === 'string' && taskData.videoPath.trim()) ? 'video' : 'image'
  const videoPath = typeof taskData?.videoPath === 'string' && taskData.videoPath.trim() ? taskData.videoPath.trim() : undefined
  const videoCoverMode = mediaType === 'video' ? normalizeVideoCoverMode(taskData?.videoCoverMode) : undefined
  const imagesFromArray = Array.isArray(taskData?.images) ? taskData.images.filter((p) => typeof p === 'string') : []
  const imagePath = typeof taskData?.imagePath === 'string' ? taskData.imagePath : ''
  const images = imagesFromArray.length > 0 ? imagesFromArray : imagePath ? [imagePath] : []
  const productId = typeof taskData?.productId === 'string' && taskData.productId.trim() ? taskData.productId.trim() : undefined
  const productName = typeof taskData?.productName === 'string' && taskData.productName.trim() ? taskData.productName.trim() : undefined
  const linkedProducts = Array.isArray(taskData?.linkedProducts)
    ? taskData.linkedProducts
        .filter((item): item is { id: string; name: string; cover: string; productUrl: string } => {
          return Boolean(item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
        })
        .map((item) => ({
          id: item.id.trim(),
          name: typeof item.name === 'string' ? item.name.trim() : '',
          cover: typeof item.cover === 'string' ? item.cover.trim() : '',
          productUrl: typeof item.productUrl === 'string' ? item.productUrl.trim() : ''
        }))
    : undefined
  const dryRun = taskData?.dryRun === false ? false : true
  const mode: 'immediate' = 'immediate'
  return { queueTaskId, title, content, mediaType, videoPath, videoCoverMode, images, productId, productName, linkedProducts, dryRun, mode }
}

function isLikelyLoginUrl(url: string): boolean {
  const lower = url.toLowerCase()
  return lower.includes('login') || lower.includes('passport') || lower.includes('signin')
}

function notifyPublishPhase(input: {
  phase: 'start' | 'finish'
  accountName?: string
  taskTitle?: string
  success?: boolean
  error?: string
}): void {
  try {
    if (!Notification.isSupported()) return
    const payload = buildPublishNotificationPayload(input)
    new Notification(payload).show()
  } catch (error) {
    void error
  }
}

function extractAutomationLogMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload.trim()
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return typeof record.message === 'string' ? record.message.trim() : ''
  }
  return ''
}

function broadcastPublishSession(snapshot: PublishSessionSnapshot): void {
  broadcastToRenderers('publisher:session', snapshot)
}

async function waitForPublishUiReady(webContents: WebContents, timeoutMs: number): Promise<void> {
  const resolvedTimeout = Math.max(1_000, Math.floor(timeoutMs))
  await webContents.executeJavaScript(
    `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const startedAt = Date.now();
      while (Date.now() - startedAt < ${resolvedTimeout}) {
        const root = document.querySelector('#root') || document.querySelector('.side-nav') || document.querySelector('input[type="file"]');
        if (root) return true;
        await sleep(250);
      }
      throw new Error('timeout');
    })()`,
    true
  )
}

function waitForAutomationResult(options: {
  webContents: WebContents
  taskId: string
  timeoutMs: number
}): Promise<{ published?: boolean; time?: string }> {
  const { webContents, taskId, timeoutMs } = options
  const targetWebContentsId = webContents.id

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('[XHS] Automation timeout.'))
    }, Math.max(1_000, timeoutMs))

    const handler = (
      event: Electron.IpcMainEvent,
      payload: { taskId?: string; ok?: boolean; error?: string; published?: boolean; time?: string }
    ): void => {
      if (event.sender.id !== targetWebContentsId) return
      if (!payload || typeof payload !== 'object') return
      if (payload.taskId !== taskId) return

      cleanup()

      if (payload.ok === true) {
        resolve({
          published: typeof payload.published === 'boolean' ? payload.published : undefined,
          time: typeof payload.time === 'string' && payload.time.trim().length > 0 ? payload.time : undefined
        })
        return
      }

      const message = typeof payload.error === 'string' && payload.error ? payload.error : '[XHS] Publish failed.'
      reject(new Error(message))
    }

    const cleanup = (): void => {
      clearTimeout(timer)
      ipcMain.off('publisher:result', handler)
    }

    ipcMain.on('publisher:result', handler)
  })
}

function waitForProductSyncResult(options: {
  webContents: WebContents
  taskId: string
  timeoutMs: number
}): Promise<XhsProductRecord[]> {
  const { webContents, taskId, timeoutMs } = options
  const targetWebContentsId = webContents.id

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('[XHS] Product sync timeout.'))
    }, Math.max(1_000, timeoutMs))

    const handler = (
      event: Electron.IpcMainEvent,
      payload: { taskId?: string; ok?: boolean; error?: string; products?: unknown }
    ): void => {
      if (event.sender.id !== targetWebContentsId) return
      if (!payload || typeof payload !== 'object') return
      if (payload.taskId !== taskId) return

      cleanup()

      if (payload.ok !== true) {
        const message = typeof payload.error === 'string' && payload.error ? payload.error : '[XHS] Product sync failed.'
        reject(new Error(message))
        return
      }

      const list = Array.isArray(payload.products) ? payload.products : []
      const products: XhsProductRecord[] = list
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          const id = typeof record.id === 'string' ? record.id.trim() : ''
          const name = typeof record.name === 'string' ? record.name.trim() : ''
          if (!id || !name) return null
          return {
            id,
            name,
            price: typeof record.price === 'string' ? record.price : '',
            cover: typeof record.cover === 'string' ? record.cover : '',
            productUrl: typeof record.productUrl === 'string' ? record.productUrl : ''
          }
        })
        .filter((p): p is XhsProductRecord => Boolean(p))

      resolve(products)
    }

    const cleanup = (): void => {
      clearTimeout(timer)
      ipcMain.off('productSync:result', handler)
    }

    ipcMain.on('productSync:result', handler)
  })
}

export class PublisherService {
  private accountManager: AccountManager
  private queueScheduler: {
    enqueue: (options: {
      taskManager: TaskManager
      accountId?: string
      taskIds?: string[]
    }) => Promise<PublishQueueRunResult>
    isBusy: () => boolean
  }

  constructor(accountManager: AccountManager) {
    this.accountManager = accountManager
    this.queueScheduler = createPublishQueueScheduler((options) => this.runQueueInternal(options))
  }

  isQueueRunning(): boolean {
    return this.queueScheduler.isBusy()
  }

  async syncProducts(accountId: string): Promise<XhsProductRecord[]> {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      throw new Error('[Product Sync] accountId is required.')
    }

    const account = this.accountManager.getAccount(normalizedAccountId)
    if (!account) {
      throw new Error(`[Product Sync] Account not found: ${normalizedAccountId}`)
    }

    const taskId = randomUUID()
    const worker = new BrowserWindow({
      width: 1200,
      height: 900,
      show: true,
      autoHideMenuBar: true,
      webPreferences: {
        partition: account.partitionKey,
        preload: resolveProductSyncPreloadPath(),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    let didSucceed = false
    try {
      await runWithTimeout(worker.loadURL(XHS_PUBLISH_URL), PUBLISH_PAGE_LOAD_TIMEOUT_MS, '[XHS] Publish page load timeout.')

      const currentUrl = worker.webContents.getURL()
      if (!currentUrl) {
        throw new Error('[XHS] Page did not load.')
      }
      if (isLikelyLoginUrl(currentUrl)) {
        throw new Error('[XHS] Not logged in: redirected to login page.')
      }

      await waitForPublishUiReady(worker.webContents, PUBLISH_UI_READY_TIMEOUT_MS)

      const resultPromise = waitForProductSyncResult({
        webContents: worker.webContents,
        taskId,
        timeoutMs: 3 * 60_000
      })

      worker.webContents.send('productSync:run', { taskId })
      const products = await resultPromise
      didSucceed = true
      return products
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[Product Sync] Failed:', message)
      throw error
    } finally {
      if (didSucceed && !worker.isDestroyed()) worker.close()
    }
  }

  async publishTask(accountId: string, taskData: PublisherTaskData): Promise<PublisherResult> {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) {
      return { success: false, error: '[Publisher] accountId is required.' }
    }

    const account = this.accountManager.getAccount(normalizedAccountId)
    if (!account) {
      return { success: false, error: `[Publisher] Account not found: ${normalizedAccountId}` }
    }

    const normalizedTask = normalizeTask(taskData)
    if (normalizedTask.mediaType === 'image' && normalizedTask.images.length === 0) {
      return { success: false, error: '[Publisher] 图片任务 taskData.images 不能为空。' }
    }
    if (normalizedTask.mediaType === 'video' && !normalizedTask.videoPath) {
      return { success: false, error: '[Publisher] 视频任务 taskData.videoPath 不能为空。' }
    }

    const taskId = randomUUID()
    let session = createPublishSessionSnapshot({
      sessionId: taskId,
      queueTaskId: normalizedTask.queueTaskId,
      accountId: normalizedAccountId,
      accountName: account.name,
      taskTitle: normalizedTask.title,
      mediaType: normalizedTask.mediaType
    })
    broadcastPublishSession(session)
    notifyPublishPhase({
      phase: 'start',
      accountName: account.name,
      taskTitle: normalizedTask.title
    })

    const publishDebugState = readPublishDebugState()

    const worker = new BrowserWindow(
      buildPublishWorkerWindowOptions({
        partitionKey: account.partitionKey,
        preload: resolveWorkerPreloadPath(),
        showWindow: publishDebugState.visual
      })
    )

    worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    const diagnostics = new DiagnosticsService()
    const automationLogHandler = (event: Electron.IpcMainEvent, payload: unknown): void => {
      if (event.sender.id !== worker.webContents.id) return
      const message = extractAutomationLogMessage(payload)
      if (!message) return
      const stageUpdate = derivePublishStageUpdate(message, normalizedTask.mediaType)
      if (!stageUpdate) return
      session = applyPublishStageUpdate(session, stageUpdate)
      broadcastPublishSession(session)
    }
    ipcMain.on('automation-log', automationLogHandler)
    try {
      await runWithTimeout(worker.loadURL(XHS_PUBLISH_URL), PUBLISH_PAGE_LOAD_TIMEOUT_MS, '[XHS] Publish page load timeout.')
      if (publishDebugState.visual && !worker.isDestroyed()) {
        worker.show()
        worker.focus()
      }
      if (is.dev && publishDebugState.openDevTools && !worker.webContents.isDevToolsOpened()) {
        worker.webContents.openDevTools({ mode: 'detach' })
      }
      diagnostics.attach(worker.webContents)

      const currentUrl = worker.webContents.getURL()
      if (!currentUrl) {
        throw new Error('[XHS] Page did not load.')
      }
      if (isLikelyLoginUrl(currentUrl)) {
        throw new Error('[XHS] Not logged in: redirected to login page.')
      }

      await waitForPublishUiReady(worker.webContents, PUBLISH_UI_READY_TIMEOUT_MS)

      const payload: AutomationTaskPayload = {
        taskId,
        taskData: {
          title: normalizedTask.title,
          content: normalizedTask.content,
          mediaType: normalizedTask.mediaType,
          videoPath: normalizedTask.videoPath,
          videoCoverMode: normalizedTask.videoCoverMode,
          images: normalizedTask.images,
          productId: normalizedTask.productId,
          productName: normalizedTask.productName,
          linkedProducts: normalizedTask.linkedProducts
        },
        dryRun: normalizedTask.dryRun,
        mode: normalizedTask.mode
      }

      const resultPromise = waitForAutomationResult({
        webContents: worker.webContents,
        taskId,
        timeoutMs: 5 * 60_000
      })

      worker.webContents.send('publisher:task', payload)
      const automationResult = await resultPromise
      if (!normalizedTask.dryRun && !automationResult.time) {
        throw new Error('发布成功但未获取到 publishedAt 时间戳，请人工确认发布结果。')
      }
      session = completePublishSession(session)
      broadcastPublishSession(session)
      notifyPublishPhase({
        phase: 'finish',
        accountName: account.name,
        taskTitle: normalizedTask.title,
        success: true
      })
      return { success: true, time: automationResult.time }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failure = buildPublishFailureSummary(message, normalizedTask.mediaType)
      session = failPublishSession(session, failure)
      broadcastPublishSession(session)
      try {
        await diagnostics.saveDiagnostics({ taskId, workspacePath: resolveWorkspacePath(), errorMessage: message })
      } catch { /* 静默 */ }
      notifyPublishPhase({
        phase: 'finish',
        accountName: account.name,
        taskTitle: normalizedTask.title,
        success: false,
        error: failure.userMessage
      })
      return { success: false, error: failure.userMessage }
    } finally {
      ipcMain.off('automation-log', automationLogHandler)
      diagnostics.detach()
      if (!worker.isDestroyed() && !publishDebugState.keepWindowOpen) worker.close()
    }
  }

  async runQueue(options: {
    taskManager: TaskManager
    accountId?: string
    taskIds?: string[]
  }): Promise<PublishQueueRunResult> {
    return this.queueScheduler.enqueue(options)
  }

  private async runQueueInternal(options: {
    taskManager: TaskManager
    accountId?: string
    taskIds?: string[]
  }): Promise<PublishQueueRunResult> {
    const taskManager = options.taskManager
    const queueService = QueueService.getInstance()
    const queueConfig = resolveQueueConfig()

    let processed = 0
    let succeeded = 0
    let failed = 0
    let consecutiveTasks = 0

    let task = queueService.acquireNextTask({
      accountId: typeof options.accountId === 'string' ? options.accountId : undefined,
      taskIds: Array.isArray(options.taskIds) ? options.taskIds : undefined
    })

    while (task) {
      // 每日限额检查
      if (queueConfig.dailyLimitPerAccount > 0 && processed >= queueConfig.dailyLimitPerAccount) {
        console.log(`[Queue] Daily limit reached (${queueConfig.dailyLimitPerAccount}), stopping.`)
        break
      }

      if (task.mediaType === 'video' && !task.videoPath) {
        processed += 1
        failed += 1
        queueService.failTask(task.id, '视频任务缺少 videoPath，请补齐后重新排期。', {
          returnToPendingPool: true,
          status: 'publish_failed',
          resetRetryCount: true
        })
        const updated = taskManager.updateBatch([task.id], {})[0]
        if (updated) broadcastToRenderers('cms.task.updated', updated)
        task = queueService.acquireNextTask({
          accountId: typeof options.accountId === 'string' ? options.accountId : undefined,
          taskIds: Array.isArray(options.taskIds) ? options.taskIds : undefined
        })
        continue
      }

      processed += 1
      consecutiveTasks += 1
      broadcastToRenderers('cms.task.updated', task)

      const result = await this.publishTask(task.accountId, {
        queueTaskId: task.id,
        mediaType: task.mediaType,
        videoPath: task.videoPath,
        videoCoverMode: task.videoCoverMode,
        images: task.images,
        title: task.title,
        content: task.content,
        productId: task.productId,
        productName: task.productName,
        linkedProducts: task.linkedProducts,
        dryRun: QUEUE_DRY_RUN_ENABLED,
        mode: 'immediate'
      })

      if (result.success) {
        if (!result.time) {
          failed += 1
          queueService.failTask(task.id, '发布成功但未获取到 publishedAt 时间戳，请人工确认发布结果。', {
            returnToPendingPool: true,
            status: 'publish_failed',
            resetRetryCount: true
          })
          const updated = taskManager.updateBatch([task.id], {})[0]
          if (updated) broadcastToRenderers('cms.task.updated', updated)
        } else {
          succeeded += 1
          queueService.completeTask(task.id)
          const updated = taskManager.updateBatch([task.id], { publishedAt: result.time, errorMsg: '', scheduledAt: null })[0]
          if (updated) broadcastToRenderers('cms.task.updated', updated)
        }
      } else {
        failed += 1
        queueService.failTask(task.id, result.error ?? '发布失败，请检查后重新排期。', {
          returnToPendingPool: true,
          status: 'publish_failed',
          resetRetryCount: true
        })
        const updated = taskManager.updateBatch([task.id], {})[0]
        if (updated) broadcastToRenderers('cms.task.updated', updated)
      }

      // 冷却：每 N 个任务后休息
      if (queueConfig.cooldownAfterNTasks > 0 && consecutiveTasks >= queueConfig.cooldownAfterNTasks) {
        const cooldownMs = gaussianDelay(queueConfig.cooldownDurationMs * 0.8, queueConfig.cooldownDurationMs * 1.2)
        console.log(`[Queue] Cooldown after ${consecutiveTasks} tasks: resting ${Math.round(cooldownMs / 1000)}s...`)
        await sleep(cooldownMs)
        consecutiveTasks = 0
      } else {
        // 任务间高斯随机间隔
        const delayMs = gaussianDelay(queueConfig.taskIntervalMinMs, queueConfig.taskIntervalMaxMs)
        console.log(`[Queue] Next task in ${Math.round(delayMs / 1000)}s...`)
        await sleep(delayMs)
      }

      task = queueService.acquireNextTask({
        accountId: typeof options.accountId === 'string' ? options.accountId : undefined,
        taskIds: Array.isArray(options.taskIds) ? options.taskIds : undefined
      })
    }

    return { processed, succeeded, failed }
  }
}

function sleep(ms: number): Promise<void> {
  const resolved = Math.max(0, Math.floor(ms))
  return new Promise((resolve) => setTimeout(resolve, resolved))
}

function broadcastToRenderers(channel: string, payload: unknown, options?: { excludeWebContentsId?: number }): void {
  const excludeId = options?.excludeWebContentsId
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (win.isDestroyed()) continue
      if (excludeId && win.webContents.id === excludeId) continue
      win.webContents.send(channel, payload)
    } catch (error) {
      void error
    }
  }
}

let didRegisterAutomationLogBridge = false

function registerAutomationLogBridge(): void {
  if (didRegisterAutomationLogBridge) return
  didRegisterAutomationLogBridge = true

  ipcMain.on('automation-log', (event, payload: unknown) => {
    const message = extractAutomationLogMessage(payload)
    if (!message) return
    try {
      console.log(message)
    } catch (error) {
      void error
    }
    broadcastToRenderers('automation-log', message, { excludeWebContentsId: event.sender.id })
  })
}

export async function runQueue(options: {
  accountId: string
  publisherService: PublisherService
  taskManager: TaskManager
  taskIds?: string[]
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const accountId = typeof options.accountId === 'string' ? options.accountId.trim() : ''
  if (!accountId) return { processed: 0, succeeded: 0, failed: 0 }
  return options.publisherService.runQueue({
    taskManager: options.taskManager,
    accountId,
    taskIds: Array.isArray(options.taskIds) ? options.taskIds : undefined
  })
}

export function registerQueueRunnerIpc(options: {
  publisherService: PublisherService
  taskManager: TaskManager
  canRun?: () => boolean
}): void {
  const { publisherService, taskManager, canRun } = options
  const runningByAccount = new Map<string, Promise<{ processed: number; succeeded: number; failed: number }>>()

  registerAutomationLogBridge()

  ipcMain.handle('cms.queue.start', async (_event, payload: unknown) => {
    if (typeof canRun === 'function' && !canRun()) {
      const error = new Error('[Queue] 存储维护进行中，暂不可启动队列。')
      ;(error as { code?: string }).code = 'STORAGE_MAINTENANCE_LOCKED'
      throw error
    }
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
    const accountIdFromBody = body && typeof body.accountId === 'string' ? body.accountId : ''
    const taskIdsFromBody = body && Array.isArray(body.taskIds) ? body.taskIds.filter((v): v is string => typeof v === 'string') : null
    const normalizedAccountId = typeof payload === 'string' ? payload.trim() : accountIdFromBody.trim()
    if (!normalizedAccountId) {
      throw new Error('[Queue] accountId is required.')
    }

    const existing = runningByAccount.get(normalizedAccountId)
    if (existing) return existing

    const runner = (async () => {
      console.log('[Queue] Starting queue for account:', normalizedAccountId)
      return runQueue({
        accountId: normalizedAccountId,
        publisherService,
        taskManager,
        taskIds: taskIdsFromBody ?? undefined
      })
    })()
      .finally(() => {
        runningByAccount.delete(normalizedAccountId)
      })

    runningByAccount.set(normalizedAccountId, runner)
    return runner
  })
}
