import { contextBridge, ipcRenderer } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  simulateClick,
  scrollToBottom,
  gaussianDelay
} from './xhs-shared/interaction'
import {
  sleep as _sharedSleep,
  normalizeText as _sharedNormalizeText,
  isVisible as _sharedIsVisible,
  isVisibleForWait as _sharedIsVisibleForWait,
  waitFor as _sharedWaitFor,
  queryFirstVisible as _sharedQueryFirstVisible,
  findByText as _sharedFindByText,
  describeElement as _sharedDescribeElement
} from './xhs-shared/dom-helpers'
import {
  buildTopicDropdownContainerTextIndex,
  TOPIC_DROPDOWN_NODE_SELECTOR,
  isLikelyTopicDropdownContainerSignature,
  orderTopicDropdownCandidates
} from './xhs-shared/topicDropdownHelpers'

const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'

let cachedWorkspacePath: string | null = null

async function getWorkspacePath(): Promise<string> {
  if (cachedWorkspacePath !== null) return cachedWorkspacePath
  try {
    const result = await ipcRenderer.invoke('workspace.getPath')
    cachedWorkspacePath = result && typeof result === 'object' && typeof (result as { path?: unknown }).path === 'string' ? (result as { path: string }).path : ''
  } catch (error) {
    void error
    cachedWorkspacePath = ''
  }
  return cachedWorkspacePath
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? '').trim())
}

function isAbsoluteFilePath(value: string): boolean {
  const v = String(value ?? '').trim()
  if (!v) return false
  if (isWindowsAbsolutePath(v)) return true
  return path.isAbsolute(v)
}

function filePathFromFileUrl(value: string): string {
  const v = String(value ?? '').trim()
  if (!v.toLowerCase().startsWith('file://')) return v
  try {
    const url = new URL(v)
    return decodeURIComponent(url.pathname)
  } catch (error) {
    void error
    return v
  }
}

async function resolveWorkspaceFilePath(value: string): Promise<string> {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (isHttpUrl(raw)) return raw

  const normalized = filePathFromFileUrl(raw)
  if (isAbsoluteFilePath(normalized)) return normalized

  const workspacePath = await getWorkspacePath()
  if (!workspacePath) return normalized
  const rel = normalized.replace(/\\/g, '/').replace(/^\/+/, '')
  return path.join(workspacePath, rel)
}

const sleep = _sharedSleep
const isVisible = _sharedIsVisible
const isVisibleForWait = _sharedIsVisibleForWait

function emitAutomationLog(message: string): void {
  const line = String(message ?? '').trim()
  if (!line) return
  try {
    ipcRenderer.send('automation-log', line)
  } catch (error) {
    void error
  }
}

function formatTimestamp(date: Date = new Date()): string {
  const pad2 = (n: number): string => String(n).padStart(2, '0')
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function formatLogLine(message: string): string {
  const normalized = String(message ?? '').trim()
  return `[${formatTimestamp()}] [小红书助手] ${normalized}`
}

function logPlain(message: string, extra?: unknown): void {
  const line = formatLogLine(message)
  try {
    if (typeof extra === 'undefined') console.log(line)
    else console.log(line, extra)
  } catch (error) {
    void error
  }
  emitAutomationLog(line)
}

function logStep(step: number, message: string, extra?: unknown): void {
  const line = formatLogLine(`[步骤 ${step}] ${message}`)
  try {
    if (typeof extra === 'undefined') console.log(line)
    else console.log(line, extra)
  } catch (error) {
    void error
  }
  emitAutomationLog(line)
}

function logAction(message: string, extra?: unknown): void {
  const line = formatLogLine(`[动作] ${message}`)
  try {
    if (typeof extra === 'undefined') console.log(line)
    else console.log(line, extra)
  } catch (error) {
    void error
  }
  emitAutomationLog(line)
}

const describeElement = _sharedDescribeElement

function safeOuterHtml(el: Element | null | undefined): string {
  if (!el) return ''
  try {
    return typeof (el as HTMLElement).outerHTML === 'string' ? (el as HTMLElement).outerHTML : ''
  } catch (error) {
    void error
    return ''
  }
}

function domSnapshot(options?: { htmlMax?: number; textMax?: number }): {
  url: string
  title: string
  html: string
  text: string
} {
  const htmlMax = Math.max(500, Math.floor(options?.htmlMax ?? 24_000))
  const textMax = Math.max(200, Math.floor(options?.textMax ?? 6_000))
  const url = String(location?.href || '')
  const title = String(document?.title || '')
  let html = ''
  let text = ''
  try {
    html = String(document?.documentElement?.outerHTML || '')
  } catch (error) {
    void error
  }
  try {
    text = normalizeText(document?.body?.innerText || document?.body?.textContent || '')
  } catch (error) {
    void error
  }
  if (html.length > htmlMax) html = html.slice(0, htmlMax) + '...(truncated)'
  if (text.length > textMax) text = text.slice(0, textMax) + '...(truncated)'
  return { url, title, html, text }
}

function findLikelyErrorNode(scope?: ParentNode | null): HTMLElement | null {
  const root = (scope as ParentNode | null) || document.body
  const selectors = [
    '.ant-form-item-explain-error',
    '.ant-message-error',
    '.ant-notification-notice-error',
    '[role="alert"]',
    '[aria-invalid="true"]'
  ]
  for (const sel of selectors) {
    try {
      const el = (root as ParentNode).querySelector?.(sel)
      if (el && el instanceof HTMLElement && isVisible(el)) return el
    } catch (error) {
      void error
    }
  }
  try {
    const nodes = Array.from((root as ParentNode).querySelectorAll?.('*') || []) as Element[]
    const matched = nodes
      .filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el))
      .filter((el) => {
        const t = normalizeText(el.innerText || el.textContent || '')
        if (!t) return false
        if (t.length > 120) return false
        return (
          (t.includes('标题') && (t.includes('过长') || t.includes('太长'))) ||
          t.includes('请完善') ||
          t.includes('不能为空') ||
          t.includes('失败') ||
          t.includes('错误')
        )
      })
    return matched[0] || null
  } catch (error) {
    void error
    return null
  }
}

function formatStepError(stepName: string, error: unknown, node?: HTMLElement | null): string {
  const message = error instanceof Error ? error.message : String(error)
  const snapshot = domSnapshot()
  const nodeInfo = node ? describeElement(node) : null
  const nodeHtml = node ? safeOuterHtml(node).slice(0, 4000) : ''
  const likelyError = findLikelyErrorNode(document.body)
  const likelyErrorInfo = likelyError ? describeElement(likelyError) : null
  const likelyErrorHtml = likelyError ? safeOuterHtml(likelyError).slice(0, 4000) : ''
  const payload = {
    step: stepName,
    message,
    url: snapshot.url,
    title: snapshot.title,
    node: nodeInfo,
    nodeHtml,
    likelyError: likelyErrorInfo,
    likelyErrorHtml,
    text: snapshot.text
  }
  return `[XHS Automation] StepFailed: ${stepName} - ${message}\n${JSON.stringify(payload)}`
}

async function runStep<T>(stepName: string, fn: () => Promise<T>, node?: HTMLElement | null): Promise<T> {
  try {
    logPlain(`开始：${stepName}`)
    const res = await fn()
    logPlain(`完成：${stepName}`)
    return res
  } catch (error) {
    const formatted = formatStepError(stepName, error, node)
    logPlain(formatted)
    throw new Error(formatted)
  }
}

const waitFor = _sharedWaitFor
const normalizeText = _sharedNormalizeText
const queryFirstVisible = _sharedQueryFirstVisible
const findByText = _sharedFindByText

const SyncHumanizer = {
  sleep: async (min: number, max: number): Promise<void> => {
    const delay = gaussianDelay(min, max)
    logPlain(`人类化等待 ${delay}ms...`)
    await sleep(delay)
  },

  click: async (element: HTMLElement, description: string): Promise<void> => {
    if (!(element instanceof HTMLElement)) return
    logPlain(`准备点击：${description}`, { element: describeElement(element) })
    await simulateClick(element, {
      description,
      highlightColor: '#ef4444',
      preDelayRange: [400, 1200],
      log: false
    })
  }
}

const Humanizer = {
  sleep: async (min: number, max: number): Promise<void> => {
    const delay = gaussianDelay(min, max)
    console.log(`[Humanizer] Sleeping for ${delay}ms...`)
    await sleep(delay)
  },

  click: async (element: HTMLElement, description: string): Promise<void> => {
    if (!(element instanceof HTMLElement)) return
    console.log(`[Humanizer] Preparing to click: ${description}`)
    await simulateClick(element, {
      description,
      highlightColor: '#ef4444',
      preDelayRange: [500, 1500],
      log: false
    })
  }
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.m4v') return 'video/x-m4v'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

function getValueSetter(el: HTMLInputElement | HTMLTextAreaElement): ((this: HTMLInputElement | HTMLTextAreaElement, value: string) => void) | null {
  const proto = Object.getPrototypeOf(el) as unknown
  const desc = proto ? (Object.getOwnPropertyDescriptor(proto as object, 'value') as PropertyDescriptor | undefined) : undefined
  const setter = desc?.set
  return typeof setter === 'function' ? (setter as (this: HTMLInputElement | HTMLTextAreaElement, value: string) => void) : null
}

function dispatchReactInputEvents(el: Element): void {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }))
  } catch (error) {
    void error
  }
  try {
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }))
  } catch (error) {
    void error
  }
  try {
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } catch (error) {
    void error
  }
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  logAction('向输入框写入内容', { element: describeElement(el), value })
  el.focus?.()
  const lastValue = el.value
  const setter = getValueSetter(el)
  if (setter) setter.call(el, value)
  else el.value = value

  const tracker = (el as unknown as { _valueTracker?: { setValue?: (v: string) => void } })._valueTracker
  if (tracker && typeof tracker.setValue === 'function') {
    try {
      tracker.setValue(lastValue)
    } catch (error) {
      void error
    }
  }

  dispatchReactInputEvents(el)
}

function setContentEditableValue(el: HTMLElement, value: string): void {
  logAction('向可编辑区域写入内容', { element: describeElement(el), value })
  el.focus?.()
  try {
    document.execCommand('selectAll', false, '')
    document.execCommand('insertText', false, value)
  } catch (error) {
    void error
    el.textContent = value
  }
  dispatchReactInputEvents(el)
}

function isLikelyLoginUrl(url: string): boolean {
  const lower = String(url ?? '').toLowerCase()
  return lower.includes('login') || lower.includes('passport') || lower.includes('signin')
}

function findImageUploadDropTarget(): HTMLElement | null {
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
  const imageInput = fileInputs.find((el) => {
    const accept = String(el.getAttribute('accept') || '').toLowerCase()
    if (!accept) return false
    if (accept.includes('video')) return false
    return accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp')
  })
  if (imageInput) {
    const preferred =
      (imageInput.closest('.upload-dragger') as HTMLElement | null) ||
      (imageInput.closest('[class*="upload"]') as HTMLElement | null) ||
      (imageInput.closest('div,section,main,form') as HTMLElement | null) ||
      imageInput.parentElement ||
      imageInput
    return preferred && isVisible(preferred) ? preferred : (preferred as HTMLElement | null)
  }

  const hint =
    findByText('拖拽图片', { match: 'contains' }) || findByText('点击上传', { match: 'contains' }) || findByText('上传图片', { match: 'contains' })
  if (hint) return (hint.closest('div,section,main,form') as HTMLElement | null) || hint.parentElement || hint

  const candidates = Array.from(document.querySelectorAll('div,section,main'))
    .filter((el): el is HTMLElement => isVisible(el))
    .map((el) => ({ el, text: normalizeText(el.innerText || el.textContent || '') }))
    .filter(({ text }) => text.includes('拖拽') || text.includes('上传') || text.includes('点击上传'))
    .map(({ el }) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width >= 240 && rect.height >= 120)
    .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)

  return candidates[0]?.el || null
}

function findImageFileInput(): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
  const preferred = inputs.find((el) => {
    const accept = String(el.getAttribute('accept') || '').toLowerCase()
    if (!accept) return false
    if (accept.includes('video')) return false
    return accept.includes('image')
  })
  if (preferred) return preferred
  return (
    inputs.find((el) => {
      const accept = String(el.getAttribute('accept') || '').toLowerCase()
      if (!accept) return false
      if (accept.includes('video')) return false
      return accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp')
    }) || null
  )
}

function findImageFileInputInScope(scope: ParentNode): HTMLInputElement | null {
  const inputs = Array.from(scope.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
  const preferred = inputs.find((el) => {
    const accept = String(el.getAttribute('accept') || '').toLowerCase()
    if (!accept) return false
    if (accept.includes('video')) return false
    return accept.includes('image')
  })
  if (preferred) return preferred
  return (
    inputs.find((el) => {
      const accept = String(el.getAttribute('accept') || '').toLowerCase()
      if (!accept) return false
      if (accept.includes('video')) return false
      return accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp')
    }) || null
  )
}

async function createDataTransferForImages(imagePaths: string[]): Promise<DataTransfer> {
  const dt = new DataTransfer()
  for (const imagePath of imagePaths) {
    const normalizedPath = String(imagePath ?? '').trim()
    if (!normalizedPath) continue
    const resolvedPath = await resolveWorkspaceFilePath(normalizedPath)
    if (!resolvedPath || isHttpUrl(resolvedPath)) {
      throw new Error(`不支持上传网络图片: ${normalizedPath}`)
    }
    await fs.promises.access(resolvedPath, fs.constants.R_OK)
    const buffer = await fs.promises.readFile(resolvedPath)
    const filename = path.basename(resolvedPath)
    const mime = guessMimeType(resolvedPath)
    const file = new File([buffer], filename, { type: mime })
    dt.items.add(file)
  }
  return dt
}

function trySetInputFiles(input: HTMLInputElement, fileList: FileList): boolean {
  try {
    ;(input as unknown as { files: FileList }).files = fileList
    return true
  } catch (error) {
    void error
  }
  try {
    Object.defineProperty(input, 'files', { value: fileList, configurable: true })
    return true
  } catch (error) {
    void error
  }
  return false
}

function dispatchUploadEventsToInput(input: HTMLInputElement, dt: DataTransfer): void {
  logAction('设置上传文件到 input', {
    element: describeElement(input),
    fileCount: dt.files?.length ?? 0,
    filenames: Array.from(dt.files || []).map((f) => f.name)
  })
  trySetInputFiles(input, dt.files)
  try {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  } catch (error) {
    void error
  }
  try {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  } catch (error) {
    void error
  }
}

function findPreferredDropZone(): HTMLElement | null {
  const preferred =
    queryFirstVisible<HTMLElement>('.upload-dragger') ||
    queryFirstVisible<HTMLElement>('[class*="upload"] .upload-dragger') ||
    queryFirstVisible<HTMLElement>('[class*="upload"][class*="dragger"]') ||
    queryFirstVisible<HTMLElement>('[class*="upload"] [class*="dragger"]')
  if (preferred) return preferred
  return findImageUploadDropTarget()
}

function dispatchDragAndDropToTarget(target: HTMLElement, dt: DataTransfer): void {
  logAction('执行拖拽上传事件', {
    target: describeElement(target),
    fileCount: dt.files?.length ?? 0,
    filenames: Array.from(dt.files || []).map((f) => f.name)
  })
  const dragEnter = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })
  const dragOver = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
  const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
  target.dispatchEvent(dragEnter)
  target.dispatchEvent(dragOver)
  target.dispatchEvent(drop)
}

async function robustImageUpload(imagePaths: string[]): Promise<void> {
  const paths = Array.isArray(imagePaths) ? imagePaths.filter((p) => typeof p === 'string' && p.trim()) : []
  if (paths.length === 0) throw new Error('缺少图片。')

  logPlain(`正在上传图片（${paths.length} 张）...`)
  logStep(1, `开始上传（${paths.length} 张）...`)

  const dt = await createDataTransferForImages(paths)
  if (!dt.files || dt.files.length === 0) throw new Error('构造上传 FileList 失败。')

  const fileInput = await waitFor(() => findImageFileInput(), {
    timeoutMs: 20_000,
    intervalMs: 250,
    timeoutMessage: '未找到图片上传 input（可能页面结构变化）。'
  })

  logStep(1, '已找到图片上传输入框', { accept: fileInput.getAttribute('accept') || '' })

  dispatchUploadEventsToInput(fileInput, dt)
  await sleep(400)

  const quickSignal = await waitFor(
    () => {
      const hasAnyThumb = Array.from(document.querySelectorAll('img')).some((img) => {
        const src = String((img as HTMLImageElement).src || '')
        return src.startsWith('blob:') || src.includes('xhs')
      })
      const hasProgress = normalizeText(document.body?.innerText || '').includes('上传')
      return hasAnyThumb || hasProgress || null
    },
    { timeoutMs: 2500, intervalMs: 200, timeoutMessage: '未检测到信号' }
  ).catch(() => null)

  if (quickSignal) {
    logStep(1, '已检测到上传信号（输入事件后）。')
    return
  }

  logStep(1, '输入事件后未检测到上传信号，改用拖拽方式。')
  const dropTarget = await waitFor(() => findPreferredDropZone(), {
    timeoutMs: 20_000,
    intervalMs: 250,
    timeoutMessage: '未找到上传拖拽区域（可能页面结构变化）。'
  })

  dispatchDragAndDropToTarget(dropTarget, dt)
  await sleep(400)
}

function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, '')
}

function isImageUploadingMessage(text: string): boolean {
  const normalized = compactText(text)
  if (!normalized) return false
  if (/图片上传中[，,]?(请稍后|请稍候)/.test(normalized)) return true
  return false
}

function findImageUploadingMessage(): string | null {
  const selectors = [
    '.ant-message-notice-content',
    '.ant-message-custom-content',
    '.ant-notification-notice-message',
    '.ant-notification-notice-description',
    '[role="alert"]'
  ]

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector)).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el)
    )
    for (const el of nodes) {
      const text = normalizeText(el.innerText || el.textContent || '')
      if (!text) continue
      if (!isImageUploadingMessage(text)) continue
      return text
    }
  }

  const bodyText = normalizeText(document.body?.innerText || '')
  if (isImageUploadingMessage(bodyText)) return '图片上传中，请稍后'
  return null
}

function isLikelyUploadedImagePreview(img: HTMLImageElement): boolean {
  if (!isVisible(img)) return false
  const src = String(img.src || '').trim().toLowerCase()
  if (!src) return false
  if (src.startsWith('data:image/svg')) return false
  if (src.includes('logo') || src.includes('icon') || src.includes('avatar') || src.includes('sprite')) return false

  const rect = img.getBoundingClientRect()
  if (rect.width < 48 || rect.height < 48) return false
  if (rect.width > 420 || rect.height > 420) return false

  if (src.startsWith('blob:')) return true
  if (src.includes('xhscdn') || src.includes('xhs')) return true
  if (/^https?:\/\//.test(src)) return true
  return false
}

function countUploadedImagePreviews(expectedCount: number): number {
  const input = findImageFileInput()
  const scope =
    (input?.closest('#publish-container') as HTMLElement | null) ||
    (input?.closest('[class*="upload"]') as HTMLElement | null) ||
    (document.querySelector('#publish-container') as HTMLElement | null) ||
    document.body

  const preferred = Array.from(
    scope.querySelectorAll(
      '[class*="upload"] img, [class*="dragger"] img, [class*="image"] img, [class*="img"] img'
    )
  ).filter((el): el is HTMLImageElement => el instanceof HTMLImageElement && isLikelyUploadedImagePreview(el))

  if (preferred.length >= expectedCount) return preferred.length

  const fallback = Array.from(scope.querySelectorAll('img')).filter(
    (el): el is HTMLImageElement => el instanceof HTMLImageElement && isLikelyUploadedImagePreview(el)
  )
  return fallback.length
}

async function checkImageReady(
  expectedCount: number,
  options?: { timeoutMs?: number; stableMs?: number; intervalMs?: number }
): Promise<void> {
  const timeoutMs = Math.max(10_000, Math.floor(options?.timeoutMs ?? 180_000))
  const stableMs = Math.max(1_000, Math.floor(options?.stableMs ?? 3_000))
  const intervalMs = Math.max(200, Math.floor(options?.intervalMs ?? 800))
  const startedAt = Date.now()

  let readySince: number | null = null
  let lastLogAt = 0
  let latestCount = 0
  let latestDisabled = true
  let latestBlockingMessage = ''

  while (Date.now() - startedAt <= timeoutMs) {
    const blockingMessage = findImageUploadingMessage()
    const uploadedCount = countUploadedImagePreviews(expectedCount)
    const publishButton = findPublishButtonAnyState() || findPublishSubmitButton()
    const publishDisabled = publishButton ? isDisabledLike(publishButton) : true

    latestCount = uploadedCount
    latestDisabled = publishDisabled
    latestBlockingMessage = blockingMessage || ''

    const ready = !blockingMessage && !publishDisabled && uploadedCount >= expectedCount
    if (ready) {
      if (readySince == null) {
        readySince = Date.now()
        logPlain('[图文就绪] 条件首次满足，进入稳定观察...')
      }
      if (Date.now() - readySince >= stableMs) {
        logPlain('[图文就绪] 上传已完成，可执行发布。', {
          uploadedCount,
          expectedCount
        })
        return
      }
    } else {
      readySince = null
    }

    if (Date.now() - lastLogAt >= 5_000) {
      logPlain('[图文就绪] 等待上传完成...', {
        uploadedCount,
        expectedCount,
        hasPublishButton: Boolean(publishButton),
        publishDisabled,
        blockingMessage: blockingMessage || ''
      })
      lastLogAt = Date.now()
    }

    await sleep(intervalMs)
  }

  throw new Error(
    `图片上传未就绪：期望 ${expectedCount} 张，当前识别 ${latestCount} 张，` +
      `发布按钮${latestDisabled ? '不可用' : '可用'}` +
      (latestBlockingMessage ? `，提示：${latestBlockingMessage}` : '')
  )
}

async function publishImageWithReadyGuard(expectedCount: number): Promise<void> {
  const startedAt = Date.now()
  const totalTimeoutMs = 180_000
  let attempts = 0

  while (Date.now() - startedAt <= totalTimeoutMs) {
    attempts += 1
    const remainingMs = Math.max(5_000, totalTimeoutMs - (Date.now() - startedAt))

    await checkImageReady(expectedCount, { timeoutMs: Math.min(remainingMs, 60_000) })

    const publishButton = await waitFor(() => findPublishSubmitButton(), {
      timeoutMs: Math.min(30_000, remainingMs),
      intervalMs: 250,
      timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
    })
    highlightWithRedBorder(publishButton)
    try {
      publishButton.scrollIntoView({ block: 'center', inline: 'center' })
    } catch (error) {
      void error
    }
    await sleep(200)
    await clickPublish(publishButton)

    const immediateBlock = await waitFor(() => findImageUploadingMessage() || null, {
      timeoutMs: 2_000,
      intervalMs: 200,
      timeoutMessage: '未出现上传中拦截提示'
    }).catch(() => null)

    if (typeof immediateBlock === 'string' && immediateBlock) {
      logPlain(`[发布] 第 ${attempts} 次点击后被拦截：${immediateBlock}，继续等待上传完成后重试。`)
      await sleep(1200)
      continue
    }

    const outcome = await waitFor(
      () => {
        const blocked = findImageUploadingMessage()
        if (blocked) return { kind: 'blocked', message: blocked } as const

        const success =
          findByText('发布成功', { match: 'contains' }) ||
          findByText('已发布', { match: 'contains' }) ||
          queryFirstVisible('.ant-message-success') ||
          queryFirstVisible('.ant-notification-notice-success') ||
          null
        if (success) return { kind: 'success' } as const

        const maybeStillHasPublish = findPublishSubmitButton()
        if (!maybeStillHasPublish && !isLikelyLoginUrl(location.href)) return { kind: 'success' } as const
        return null
      },
      { timeoutMs: Math.min(60_000, remainingMs), intervalMs: 500, timeoutMessage: '发布结果未确认（可能页面结构变化或网络异常）。' }
    ).catch(() => null)

    if (outcome?.kind === 'success') return

    if (outcome?.kind === 'blocked') {
      logPlain(`[发布] 第 ${attempts} 次点击后出现拦截提示：${outcome.message}，继续等待并重试。`)
      await sleep(1200)
      continue
    }

    throw new Error('发布结果未确认（可能页面结构变化或网络异常）。')
  }

  throw new Error('图片上传未就绪：180 秒内多次尝试发布仍提示“图片上传中，请稍后”。')
}

async function fillTitle(title: string): Promise<void> {
  const el = await waitFor(
    () => {
      return (
        queryFirstVisible<HTMLInputElement>('input[placeholder*="填写标题"]') ||
        queryFirstVisible<HTMLInputElement>('input[placeholder*="标题"]') ||
        queryFirstVisible<HTMLTextAreaElement>('textarea[placeholder*="标题"]') ||
        queryFirstVisible<HTMLInputElement>('input[aria-label*="标题"]') ||
        queryFirstVisible<HTMLTextAreaElement>('textarea[aria-label*="标题"]') ||
        queryFirstVisible<HTMLElement>('div.title-input input') ||
        queryFirstVisible<HTMLElement>('div.title-input textarea') ||
        queryFirstVisible<HTMLElement>('div.title-input [contenteditable="true"]') ||
        queryFirstVisible<HTMLElement>('div.title-input')
      )
    },
    { timeoutMs: 20_000, intervalMs: 250, timeoutMessage: '未找到标题输入框（可能页面结构变化）。' }
  )

  const value = String(title ?? '').trim()
  if (el instanceof HTMLElement && el.getAttribute('contenteditable') === 'true') setContentEditableValue(el, value)
  else if (el instanceof HTMLElement && el.querySelector) {
    const inner = (el.querySelector('input') ||
      el.querySelector('textarea') ||
      el.querySelector('[contenteditable="true"]')) as HTMLElement | null
    if (inner && inner.getAttribute('contenteditable') === 'true') setContentEditableValue(inner, value)
    else if (inner && (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement)) setInputValue(inner, value)
    else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setInputValue(el, value)
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setInputValue(el, value)
  }
}

type EditorElement = HTMLElement | HTMLTextAreaElement | HTMLInputElement
type ContentEditableElement = HTMLElement & { contentEditable: 'true' }

function isContentEditable(el: EditorElement): el is ContentEditableElement {
  return el instanceof HTMLElement && el.getAttribute('contenteditable') === 'true'
}

function focusAndMoveCaretToEnd(el: EditorElement): void {
  el.focus?.()

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const len = el.value?.length ?? 0
    try {
      el.setSelectionRange?.(len, len)
    } catch (error) {
      void error
    }
    return
  }

  if (!isContentEditable(el)) return

  try {
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  } catch (error) {
    void error
  }
}

function insertTextAtCursor(el: EditorElement, text: string): void {
  const value = String(text ?? '')
  if (!value) return

  el.focus?.()

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start
    try {
      el.setRangeText(value, start, end, 'end')
      dispatchReactInputEvents(el)
      return
    } catch (error) {
      void error
    }

    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    setInputValue(el, `${before}${value}${after}`)
    try {
      const next = (before + value).length
      el.setSelectionRange?.(next, next)
    } catch (error) {
      void error
    }
    return
  }

  if (isContentEditable(el)) {
    try {
      document.execCommand('insertText', false, value)
    } catch (error) {
      void error
      el.textContent = `${el.textContent || ''}${value}`
    }
    dispatchReactInputEvents(el)
  }
}

function dispatchCharKeyboardEvents(el: HTMLElement, char: string): void {
  const key = String(char ?? '')
  if (!key) return
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, key }))
    el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, composed: true, key }))
  } catch (error) {
    void error
  }
}

function dispatchCharKeyboardEventsUp(el: HTMLElement, char: string): void {
  const key = String(char ?? '')
  if (!key) return
  try {
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, composed: true, key }))
  } catch (error) {
    void error
  }
}

async function typeChar(editor: EditorElement, char: string, { delayMs = 90 }: { delayMs?: number } = {}): Promise<void> {
  const c = String(char ?? '')
  if (!c) return
  const target = editor instanceof HTMLElement ? editor : editor
  if (target instanceof HTMLElement) dispatchCharKeyboardEvents(target, c)
  insertTextAtCursor(editor, c)
  if (target instanceof HTMLElement) dispatchCharKeyboardEventsUp(target, c)
  await sleep(Math.max(0, Math.floor(delayMs)))
}

async function sendInputKey(key: 'Enter' | 'Space'): Promise<boolean> {
  try {
    const ok = await ipcRenderer.invoke('cms.xhs.sendKey', { key })
    return ok === true
  } catch (error) {
    void error
    return false
  }
}

function isLikelyBlueText(el: HTMLElement): boolean {
  try {
    const color = String(window.getComputedStyle(el).color || '').trim()
    const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
    if (!m) return false
    const r = Number(m[1])
    const g = Number(m[2])
    const b = Number(m[3])
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return false
    return b >= 140 && b >= r + 30 && b >= g + 30
  } catch (error) {
    void error
  }
  return false
}

function hasRichTopicInEditor(editorEl: HTMLElement, topic: string): boolean {
  const normalized = String(topic ?? '').trim().replace(/^#+/, '')
  if (!normalized) return false
  const wanted = `#${normalized}`
  const nodes = Array.from(editorEl.querySelectorAll('a, span, [class*="topic"], [class*="Topic"]')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  )
  for (const el of nodes) {
    const t = normalizeText(el.innerText || el.textContent || '')
    if (!t) continue
    if (!t.includes(wanted)) continue
    const className = typeof el.className === 'string' ? el.className : ''
    if (el.tagName === 'A') return true
    if (className.includes('topic') || className.includes('Topic')) return true
    if (isLikelyBlueText(el)) return true
  }
  return false
}

const topicDropdownContainerIds = new WeakMap<HTMLElement, string>()
let topicDropdownContainerSeq = 0

function getTopicDropdownContainerId(container: HTMLElement): string {
  const current = topicDropdownContainerIds.get(container)
  if (current) return current
  topicDropdownContainerSeq += 1
  const next = `topic-dropdown-${topicDropdownContainerSeq}`
  topicDropdownContainerIds.set(container, next)
  return next
}

function isTopicDropdownContainer(root: HTMLElement, editorEl: HTMLElement): boolean {
  if (!isVisible(root)) return false
  if (root === document.body || root === document.documentElement) return false
  if (root.contains(editorEl)) return false

  const rect = root.getBoundingClientRect()
  if (rect.width <= 40 || rect.height <= 20 || rect.height > 480) return false

  try {
    const optionCount = root.querySelectorAll('li, [role="option"], [class*="option"], [class*="Option"]').length
    return isLikelyTopicDropdownContainerSignature({
      role: root.getAttribute('role'),
      className: typeof root.className === 'string' ? root.className : '',
      tagName: root.tagName,
      optionCount,
      hasTippyRootAttr: root.hasAttribute('data-tippy-root')
    })
  } catch (error) {
    void error
    return false
  }
}

function findTopicDropdownContainer(node: HTMLElement, editorEl: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = node
  while (current && current !== document.body) {
    if (isTopicDropdownContainer(current, editorEl)) return current
    current = current.parentElement
  }
  return null
}

function collectTopicDropdownCandidates(
  editorEl: HTMLElement,
  options?: { topicName?: string }
): Array<{
  id: string
  el: HTMLElement
  text: string
  containerId: string | null
  domOrder: number
  rect: { top: number; left: number; width: number; height: number }
  isCreate: boolean
}> {
  const name = String(options?.topicName ?? '').trim().replace(/^#+/, '')
  const wanted = name ? `#${name}` : ''
  const nodes = Array.from(document.querySelectorAll(TOPIC_DROPDOWN_NODE_SELECTOR))

  const matches: Array<{
    id: string
    el: HTMLElement
    text: string
    containerId: string | null
    domOrder: number
    rect: { top: number; left: number; width: number; height: number }
    isCreate: boolean
  }> = []
  const seen = new Set<HTMLElement>()
  let domOrder = 0

  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue
    if (!node.offsetParent) continue
    if (node.isContentEditable || node.closest('[contenteditable]')) continue
    if (!isVisible(node)) continue

    const text = normalizeText(node.innerText || node.textContent || '')
    if (!text) continue
    if (wanted && !text.includes(wanted)) continue

    const clickable =
      (node.closest('.item, [role="option"], li, button, a') as HTMLElement | null) ||
      (node.closest('div') as HTMLElement | null) ||
      node
    const candidate = clickable && isVisible(clickable) ? clickable : node
    if (candidate.isContentEditable || candidate.closest('[contenteditable]')) continue

    if (seen.has(candidate)) continue
    const container = findTopicDropdownContainer(candidate, editorEl)
    if (!container) continue

    seen.add(candidate)
    const candidateText = normalizeText(candidate.innerText || candidate.textContent || '')
    if (!candidateText) continue
    if (wanted && !candidateText.includes(wanted)) continue
    const isCreate = candidateText.includes('新建话题') || candidateText.includes('创建')
    const candidateRect = candidate.getBoundingClientRect()
    domOrder += 1
    matches.push({
      id: `candidate-${domOrder}`,
      el: candidate,
      text: candidateText || text,
      containerId: container ? getTopicDropdownContainerId(container) : null,
      domOrder,
      rect: {
        top: candidateRect.top,
        left: candidateRect.left,
        width: candidateRect.width,
        height: candidateRect.height
      },
      isCreate
    })
  }

  return matches
}

function captureTopicDropdownBaseline(editorEl: HTMLElement): Map<string, string> {
  return buildTopicDropdownContainerTextIndex(collectTopicDropdownCandidates(editorEl))
}

function findDropdownItems(
  topicName: string,
  editorEl: HTMLElement,
  options?: { baselineTextByContainerId?: ReadonlyMap<string, string> | null }
): HTMLElement[] {
  const name = String(topicName ?? '').trim().replace(/^#+/, '')
  if (!name) return []

  const matches = collectTopicDropdownCandidates(editorEl, { topicName: name })
  const ordered = orderTopicDropdownCandidates(matches, {
    baselineTextByContainerId: options?.baselineTextByContainerId ?? null
  })
  const targetMap = new Map(matches.map((item) => [item.id, item.el]))
  return ordered.map((item) => targetMap.get(item.id)).filter((item): item is HTMLElement => Boolean(item))
}

async function confirmTopicRendered(editor: EditorElement, topicName: string): Promise<boolean> {
  if (!isContentEditable(editor)) return true
  return waitFor(() => (hasRichTopicInEditor(editor, topicName) ? true : null), {
    timeoutMs: 2500,
    intervalMs: 250,
    timeoutMessage: '话题未渲染为富文本（蓝字）'
  })
    .then(() => true)
    .catch(() => false)
}

async function insertTopic(editor: EditorElement, topicName: string): Promise<void> {
  const normalized = String(topicName ?? '').trim().replace(/^#+/, '')
  if (!normalized) return

  focusAndMoveCaretToEnd(editor)

  const existingText =
    editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      ? editor.value
      : String((editor as HTMLElement).innerText || (editor as HTMLElement).textContent || '')
  const lastChar = existingText.slice(-1)
  if (existingText && lastChar && !/\s/.test(lastChar)) insertTextAtCursor(editor, ' ')
  const dropdownBaseline = editor instanceof HTMLElement ? captureTopicDropdownBaseline(editor) : new Map<string, string>()

  logAction(`[Tag] 正在输入话题: #${normalized}`)

  await typeChar(editor, '#', { delayMs: 120 })
  for (const ch of normalized) {
    await typeChar(editor, ch, { delayMs: 60 })
  }

  const initialCandidates = await waitFor(() => {
    const list = findDropdownItems(normalized, editor, {
      baselineTextByContainerId: dropdownBaseline
    })
    return list.length > 0 ? list : null
  }, {
    timeoutMs: 6000,
    intervalMs: 250,
    timeoutMessage: '未找到话题下拉项。'
  }).catch(() => null)

  if (initialCandidates && initialCandidates.length > 0) {
    const preview = initialCandidates
      .slice(0, 4)
      .map((item) => `"${normalizeText(item.innerText || item.textContent || '')}"`)
      .join(' | ')
    logPlain(`[Tag] 下拉候选顺序: ${preview}`)

    focusAndMoveCaretToEnd(editor)
    logPlain('[Tag] 发送空格，交给小红书确认弹层第一项')
    const sent = await sendInputKey('Space')
    const applied = sent ? await confirmTopicRendered(editor, normalized) : false
    if (!sent) {
      logPlain('[Tag] ❌ 空格按键发送失败，未能触发小红书第一项确认。')
    } else if (!applied) {
      logPlain(`[Tag] ⚠️ 话题可能未变为蓝字: #${normalized}`)
    }
  } else {
    logPlain('[Tag] ❌ 未找到下拉选项，可能无法生成蓝色话题标签。')
  }

  await sleep(300)
}

async function fillContent(
  content: string
): Promise<void> {
  const el = await waitFor(
    () => {
      return (
        queryFirstVisible<HTMLTextAreaElement>('textarea[placeholder*="正文"]') ||
        queryFirstVisible<HTMLTextAreaElement>('textarea[placeholder*="内容"]') ||
        queryFirstVisible<HTMLTextAreaElement>('textarea[aria-label*="正文"]') ||
        queryFirstVisible<HTMLTextAreaElement>('textarea[aria-label*="内容"]') ||
        queryFirstVisible<HTMLElement>('[contenteditable="true"]')
      )
    },
    { timeoutMs: 20_000, intervalMs: 250, timeoutMessage: '未找到正文输入框（可能页面结构变化）。' }
  )

  const rawText = String(content ?? '')
  const lineBreakCount = (rawText.match(/\n/g) || []).length
  logPlain(`[Debug] 收到正文长度: ${rawText.length}, 包含换行符数量: ${lineBreakCount}`)

  const fullText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const tagRegex = /#([^#\s]+)/g
  const topics: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = tagRegex.exec(fullText)) !== null) {
    const topic = String(match[1] ?? '').trim()
    if (!topic) continue
    if (seen.has(topic)) continue
    seen.add(topic)
    topics.push(topic)
  }

  const cleanText = fullText
    .replace(tagRegex, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  if (isContentEditable(el)) {
    const pressEnter = async (): Promise<void> => {
      if (await sendInputKey('Enter')) return
      try {
        document.execCommand('insertText', false, '\n')
      } catch (error) {
        void error
      }
    }

    setContentEditableValue(el, '')
    await sleep(120)
    focusAndMoveCaretToEnd(el)
    if (cleanText) {
      logPlain(`[Content] 使用原生粘贴写入正文 (Length: ${cleanText.length})`)
      ipcRenderer.send('cms.xhs.paste', cleanText)
      await sleep(1000)
      dispatchReactInputEvents(el)
      await sleep(120)
      focusAndMoveCaretToEnd(el)
    }

    if (topics.length > 0 && cleanText) {
      await pressEnter()
      await sleep(80)
      focusAndMoveCaretToEnd(el)
    }
    for (let index = 0; index < topics.length; index++) {
      const topic = topics[index]!
      logPlain(`[文案] 正在智能输入话题：#${topic}`)
      await insertTopic(el, topic)
      await sleep(120)
    }
    return
  }

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setInputValue(el, cleanText)
    await sleep(120)
    focusAndMoveCaretToEnd(el)
    if (topics.length > 0 && cleanText) insertTextAtCursor(el, '\n')
    for (let index = 0; index < topics.length; index++) {
      const topic = topics[index]!
      logPlain(`[文案] 正在智能输入话题：#${topic}`)
      await insertTopic(el, topic)
      await sleep(120)
    }
  }
}

function findClickableByText(textCandidates: string[]): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll('button, [role="button"], div[tabindex], span[tabindex]')).filter(
    (el): el is HTMLElement => isVisible(el)
  )
  const wanted = textCandidates.map((t) => normalizeText(t))

  for (const el of candidates) {
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (!wanted.some((w) => text.includes(w))) continue

    const disabled =
      el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null || (el as unknown as { disabled?: boolean }).disabled === true
    if (!disabled) return el
  }

  return null
}

function parseRgb(value: string): { r: number; g: number; b: number } | null {
  const v = String(value ?? '').trim()
  if (!v) return null
  const m = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
  if (!m) return null
  const r = Number(m[1])
  const g = Number(m[2])
  const b = Number(m[3])
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return { r, g, b }
}

function isLikelyRedButton(el: HTMLElement): boolean {
  try {
    const style = window.getComputedStyle(el)
    const bg = parseRgb(style.backgroundColor || '')
    if (bg && bg.r >= 170 && bg.g <= 120 && bg.b <= 120) return true
  } catch (error) {
    void error
  }
  return false
}

function findPublishSubmitButton(): HTMLElement | null {
  const direct =
    queryFirstVisible<HTMLButtonElement>('#publish-container .publish-btn') ||
    queryFirstVisible<HTMLButtonElement>('#publish-container button.publish-btn') ||
    queryFirstVisible<HTMLButtonElement>('#publish-container button') ||
    queryFirstVisible<HTMLButtonElement>('button.publish-btn') ||
    null
  if (direct && direct.tagName.toLowerCase() === 'button') {
    const text = normalizeText(direct.innerText || direct.textContent || '')
    const disabled = direct.disabled || direct.getAttribute('aria-disabled') === 'true' || direct.getAttribute('disabled') !== null
    if (text.includes('发布') && !disabled) return direct
  }

  const buttons = Array.from(document.querySelectorAll('button')).filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement)
  const candidates = buttons
    .filter((btn) => isVisible(btn))
    .filter((btn) => {
      const text = normalizeText(btn.innerText || btn.textContent || '')
      if (!text) return false
      if (!text.includes('发布')) return false
      if (text.includes('定时')) return false
      if (text.includes('计划')) return false
      if (text.includes('草稿')) return false
      const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true'
      if (disabled) return false
      if (btn.closest('[role="radio"], [role="radiogroup"], label')) return false
      const rect = btn.getBoundingClientRect()
      return rect.width >= 72 && rect.height >= 28
    })
    .map((btn) => {
      const text = normalizeText(btn.innerText || btn.textContent || '')
      const className = typeof btn.className === 'string' ? btn.className : ''
      const rect = btn.getBoundingClientRect()
      let score = 0
      if (text === '发布') score += 2000
      else if (text.includes('发布')) score += 800
      if (className.includes('publish') || className.includes('Publish')) score += 400
      if (className.includes('primary') || className.includes('Primary') || className.includes('ant-btn-primary')) score += 250
      if (isLikelyRedButton(btn)) score += 600
      score += Math.min(200, rect.width * rect.height * 0.01)
      score += Math.max(0, 1200 - rect.top) * 0.01
      if (btn.closest('#publish-container')) score += 500
      return { btn, score }
    })

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]?.btn ?? null
  if (best) return best

  const isDisabled = (el: HTMLElement): boolean => {
    const any = el as unknown as { disabled?: boolean }
    return el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null || any.disabled === true
  }

  try {
    const container = document.querySelector('#publish-container') as HTMLElement | null
    if (container) {
      const underContainer = Array.from(container.querySelectorAll('button')).filter(
        (el): el is HTMLButtonElement => el instanceof HTMLButtonElement
      )
      const fallbackCandidates = underContainer
        .filter((btn) => !isDisabled(btn))
        .filter((btn) => {
          const text = normalizeText(btn.innerText || btn.textContent || '')
          return Boolean(text) && text.includes('发布')
        })
        .map((btn) => {
          const text = normalizeText(btn.innerText || btn.textContent || '')
          const className = typeof btn.className === 'string' ? btn.className : ''
          let score = 0
          if (className.includes('publish-btn')) score += 300
          if (className.includes('publish') || className.includes('Publish')) score += 200
          if (text === '发布') score += 500
          return { btn, score }
        })

      fallbackCandidates.sort((a, b) => b.score - a.score)
      const picked = fallbackCandidates[0]?.btn ?? null
      if (picked) return picked
    }
  } catch (error) {
    void error
  }

  try {
    const byClass = document.querySelector('.publish-btn') as HTMLElement | null
    const btn = byClass ? ((byClass.closest('button') as HTMLElement | null) || byClass) : null
    if (btn && !isDisabled(btn)) {
      const text = normalizeText(btn.innerText || btn.textContent || '')
      if (text.includes('发布')) return btn
    }
  } catch (error) {
    void error
  }

  return null
}

function highlightWithRedBorder(el: HTMLElement): void {
  try {
    el.style.outline = '8px solid #ff0000'
    el.style.outlineOffset = '4px'
    el.style.borderRadius = '8px'
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
  } catch (error) {
    void error
  }
}

function clickElement(el: HTMLElement): void {
  logAction('点击元素', { element: describeElement(el) })
  el.click?.()
  try {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  } catch (error) {
    void error
  }
}

async function scrollPageToBottom(retries = 4): Promise<void> {
  await scrollToBottom(null, retries)
}

function getModalRoot(fromEl: HTMLElement): HTMLElement | null {
  if (!fromEl) return null
  const candidates = [
    (fromEl.closest?.('[role="dialog"]') as HTMLElement | null) ?? null,
    (fromEl.closest?.('[class*="modal"]') as HTMLElement | null) ?? null,
    (fromEl.closest?.('[class*="Modal"]') as HTMLElement | null) ?? null,
    (fromEl.closest?.('[class*="Dialog"]') as HTMLElement | null) ?? null
  ].filter((x): x is HTMLElement => Boolean(x))
  return candidates[0] ?? null
}

function getHtmlLength(el: HTMLElement | null | undefined): number {
  try {
    const html = typeof el?.innerHTML === 'string' ? el.innerHTML : ''
    return html.length
  } catch (error) {
    void error
    return Number.POSITIVE_INFINITY
  }
}

function findLeafByTextIncludes(keyword: string, root?: HTMLElement | null): HTMLElement | null {
  const wanted = normalizeText(keyword)
  if (!wanted) return null

  const base = root || document.body

  let allCandidates: Element[] = []
  try {
    allCandidates = Array.from(base.querySelectorAll('*'))
  } catch (error) {
    void error
  }

  const matched: HTMLElement[] = []
  for (const el of allCandidates) {
    if (!(el instanceof HTMLElement)) continue
    if (!isVisibleForWait(el)) continue
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (!text.includes(wanted)) continue
    matched.push(el)
  }

  if (matched.length === 0) return null

  matched.sort((a, b) => {
    const al = getHtmlLength(a)
    const bl = getHtmlLength(b)
    if (al !== bl) return al - bl
    const ac = a.querySelectorAll ? a.querySelectorAll('*').length : 0
    const bc = b.querySelectorAll ? b.querySelectorAll('*').length : 0
    if (ac !== bc) return ac - bc
    return 0
  })

  const target = matched[0] || null
  if (!target) return null
  if (!isVisibleForWait(target)) return null
  return target
}

function findTopMostVisibleModal(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')
  ).filter((el): el is HTMLElement => isVisible(el))
  if (dialogs.length === 0) return null

  let best = dialogs[0]!
  let bestZ = Number.NEGATIVE_INFINITY
  for (const el of dialogs) {
    const z = Number.parseInt(window.getComputedStyle(el).zIndex || '0', 10)
    const zValue = Number.isFinite(z) ? z : 0
    if (zValue >= bestZ) {
      bestZ = zValue
      best = el
    }
  }
  return best
}

function getElementLabel(el: HTMLElement): { tagName: string; className: string; text: string } {
  const tagName = String(el?.tagName || '')
  const className = typeof el?.className === 'string' ? el.className : ''
  const text = normalizeText(el?.innerText || el?.textContent || '')
  return { tagName, className, text }
}

async function syncVisualWaitFor(keyword: string, timeoutMs: number, root?: HTMLElement | null): Promise<HTMLElement> {
  const wanted = normalizeText(keyword)
  if (!wanted) throw new Error('syncVisualWaitFor 需要 keyword。')

  const startedAt = Date.now()
  while (Date.now() - startedAt < Math.max(0, timeoutMs)) {
    const searchRoot = root || findTopMostVisibleModal() || document.body
    const el =
      findLeafByTextIncludes(wanted, searchRoot) ||
      (searchRoot !== document.body ? findLeafByTextIncludes(wanted, document.body) : null)

    if (el) {
      const tagName = String(el?.tagName || '')
      const className = typeof el?.className === 'string' ? el.className : ''
      logPlain(`已定位文本目标【${wanted}】`, { tagName, className: className || '' })
      try {
        el.scrollIntoView?.({ block: 'center', inline: 'nearest' })
      } catch (error) {
        void error
      }
      await SyncHumanizer.click(el, `关键词：${wanted}`)
      return el
    }

    await sleep(350 + Math.floor(Math.random() * 300))
  }

  throw new Error(`定位超时：${wanted}`)
}

async function visualWaitFor(keyword: string, timeoutMs: number, root?: HTMLElement | null): Promise<HTMLElement> {
  const wanted = normalizeText(keyword)
  if (!wanted) throw new Error('[XHS] visualWaitFor requires keyword.')

  const startedAt = Date.now()
  while (Date.now() - startedAt < Math.max(0, timeoutMs)) {
    const searchRoot = root || findTopMostVisibleModal() || document.body
    const el =
      findLeafByTextIncludes(wanted, searchRoot) || (searchRoot !== document.body ? findLeafByTextIncludes(wanted, document.body) : null)

    if (el) {
      const label = getElementLabel(el)
      console.log(`Found [${wanted}] tag=${label.tagName} class=${label.className || '(none)'}`)
      try {
        el.scrollIntoView?.({ block: 'center', inline: 'nearest' })
      } catch (error) {
        void error
      }
      await Humanizer.click(el, `keyword:${wanted}`)
      return el
    }

    await sleep(350 + Math.floor(Math.random() * 300))
  }

  throw new Error(`[XHS] visualWaitFor timeout: ${wanted}`)
}

function findNeutralClickTarget(): HTMLElement {
  const titleLabel =
    queryFirstVisible<HTMLElement>('.title-label') ||
    findByText('填写标题', { selector: 'div, span, label', match: 'contains' }) ||
    queryFirstVisible<HTMLElement>('input[placeholder*="填写标题"]') ||
    queryFirstVisible<HTMLElement>('input[placeholder*="标题"]') ||
    null

  const clickable =
    (titleLabel?.closest('div, section, main, form') as HTMLElement | null) || titleLabel || document.body
  return clickable
}

async function dismissPotentialPopups(): Promise<void> {
  logPlain('正在尝试关闭可能遮挡的弹窗/提示...')
  const target = findNeutralClickTarget()
  try {
    clickElement(target)
  } catch (error) {
    void error
  }
  await sleep(1000)
}

function findProductModalSearchInput(): HTMLInputElement | null {
  return (
    queryFirstVisible<HTMLInputElement>('input.ant-input[placeholder*="搜索"]') ||
    queryFirstVisible<HTMLInputElement>('input.ant-input[placeholder*="ID"]') ||
    queryFirstVisible<HTMLInputElement>('input.ant-input') ||
    queryFirstVisible<HTMLInputElement>('input[placeholder*="搜索商品ID"]') ||
    queryFirstVisible<HTMLInputElement>('input[placeholder*="搜索"][placeholder*="ID"]') ||
    queryFirstVisible<HTMLInputElement>('input[placeholder*="搜索"]') ||
    null
  )
}

function findFirstProductItem(modalRoot: HTMLElement): HTMLElement | null {
  const items = Array.from(
    modalRoot.querySelectorAll('li, [role="option"], [class*="goods"], [class*="product"], [class*="item"]')
  ).filter((el): el is HTMLElement => isVisible(el))

  const preferred = items.find((el) => {
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) return false
    const hasPrice = /[¥￥]\s*\d+/.test(text)
    const hasImage = Boolean(el.querySelector('img'))
    return hasPrice || hasImage
  })

  return preferred || items[0] || null
}

function findProductItemById(modalRoot: HTMLElement, productId: string): HTMLElement | null {
  const wanted = normalizeText(productId)
  if (!wanted) return null
  const items = Array.from(
    modalRoot.querySelectorAll('li, [role="option"], [class*="goods"], [class*="product"], [class*="item"], .product-item, .product-card')
  ).filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el))
  for (const el of items) {
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (text.includes(wanted)) return el
  }
  return null
}

function findSaveButton(modalRoot: HTMLElement): HTMLElement | null {
  const nodes = Array.from(modalRoot.querySelectorAll('button, [role="button"], a, div, span')).filter((el): el is HTMLElement =>
    isVisible(el)
  )
  const wanted = normalizeText('保存')

  const scored = nodes
    .map((el) => {
      const text = normalizeText(el.innerText || el.textContent || '')
      if (!text) return null
      if (!text.includes(wanted)) return null
      const rect = el.getBoundingClientRect()
      const tag = el.tagName.toLowerCase()
      const className = typeof el.className === 'string' ? el.className : ''
      let score = 0
      if (text === wanted) score += 1000
      if (tag === 'button') score += 200
      if (el.getAttribute('role') === 'button') score += 150
      if (className.includes('primary') || className.includes('Primary') || className.includes('ant-btn-primary')) score += 80
      score += Math.max(0, rect.top)
      score += Math.max(0, rect.left) * 0.01
      return { el, score }
    })
    .filter((x): x is { el: HTMLElement; score: number } => Boolean(x))

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]?.el ?? null
  if (!best) return null
  return (best.closest('button, [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || best
}

function resolveProductModalScope(searchInput: HTMLElement): HTMLElement {
  const byRole = searchInput.closest('div[role="dialog"]') as HTMLElement | null
  if (byRole) return byRole
  const byAnt = searchInput.closest('.ant-modal-content') as HTMLElement | null
  if (byAnt) return byAnt
  return document.body
}

function findSaveButtonFuzzyInScope(modal: HTMLElement): HTMLElement | null {
  const candidates = Array.from(modal.querySelectorAll('button, div[role="button"], span, div.ant-btn')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null
  )
  const wanted = '保存'
  for (const el of candidates) {
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (!text.includes(wanted)) continue
    const clickable =
      (el.closest('button, div[role="button"], a, div.ant-btn, [role="button"], div[tabindex], span[tabindex]') as HTMLElement | null) ||
      el
    if (clickable.offsetParent === null) continue
    return clickable
  }
  return null
}

function dumpSaveCandidates(modal: HTMLElement): void {
  const candidates = Array.from(modal.querySelectorAll('button, div[role="button"], span, div.ant-btn')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement
  )
  for (const el of candidates) {
    const text = normalizeText(el.innerText || el.textContent || '')
    const className = typeof el.className === 'string' ? el.className : ''
    try {
      console.log('[Debug] 候选元素：', { text, className })
    } catch (error) {
      void error
    }
    logPlain(`[调试] 候选元素：${text || '(无文本)'}`, { className })
  }
}

function findFirstProductCheckbox(modalRoot: HTMLElement): HTMLElement | null {
  const inputs = Array.from(modalRoot.querySelectorAll('input[type="checkbox"]')).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement
  )
  const first = inputs[0]
  if (!first) return null
  const clickable = (first.closest('label, .ant-checkbox-wrapper, [role="checkbox"], div, span') as HTMLElement | null) || first
  return isVisible(clickable) ? clickable : null
}

async function openProductModalWithRetry(): Promise<HTMLInputElement> {
  const candidates = [
    queryFirstVisible<HTMLElement>('.content-input'),
    queryFirstVisible<HTMLElement>('[class*="content-input"]'),
    queryFirstVisible<HTMLElement>('[class*="content"]'),
    queryFirstVisible<HTMLElement>('main'),
    queryFirstVisible<HTMLElement>('body')
  ].filter((x): x is HTMLElement => Boolean(x))

  for (const el of candidates) {
    try {
      el.scrollTop = 999999
    } catch (error) {
      void error
    }
  }

  await scrollPageToBottom(4)
  await syncVisualWaitFor('添加商品', 2500, document.body).catch(async () => {
    const addComponent =
      findClickableByText(['添加组件']) ||
      (() => {
        const leaf = findByText('添加组件', { match: 'contains' }) || null
        if (!leaf) return null
        return (leaf.closest('button, [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || (leaf as HTMLElement)
      })()
    if (addComponent) {
      await SyncHumanizer.click(addComponent, '添加组件')
      await sleep(400)
    }
    await syncVisualWaitFor('添加商品', 5000, document.body)
  })

  return waitFor(() => findProductModalSearchInput() || null, {
    timeoutMs: 25_000,
    intervalMs: 250,
    timeoutMessage: '商品弹窗未打开（未找到搜索输入框）。'
  })
}

async function addProductById(productId: string): Promise<boolean> {
  const normalizedId = String(productId ?? '').trim()
  if (!normalizedId) return true

  await dismissPotentialPopups()

  logPlain('准备添加商品...')
  logPlain('正在打开“添加商品”弹窗（同步脚本同源逻辑）...')

  const searchInput = await openProductModalWithRetry()
  const modalRoot = getModalRoot(searchInput)
  if (!modalRoot) throw new Error('无法定位商品弹窗根节点。')

  logPlain('弹窗已打开，等待列表初始化（2秒）...')
  await sleep(2000)

  logPlain(`开始输入商品ID：${normalizedId}`)
  setInputValue(searchInput, '')
  setInputValue(searchInput, normalizedId)
  logPlain('已输入 ID，等待搜索结果加载（2秒）...')
  await sleep(2000)

  const matchedById = await waitFor(() => findProductItemById(modalRoot, normalizedId) || null, {
    timeoutMs: 8000,
    intervalMs: 250,
    timeoutMessage: '未在列表中匹配到商品ID。'
  }).catch(() => null)

  const firstSelectable = (() => {
    if (matchedById) return matchedById
    const candidates = Array.from(
      modalRoot.querySelectorAll('li, [role="option"], [class*="goods"], [class*="product"], [class*="item"], .product-item, .product-card')
    ).filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el))
    if (candidates.length === 1) return candidates[0] || null
    return null
  })()
  if (!firstSelectable) {
    throw new Error(`未在商品列表中找到商品ID: ${normalizedId}`)
  }

  const checkbox = findFirstProductCheckbox(modalRoot)
  if (checkbox) {
    logPlain('选中第一个商品（勾选框）...')
    await SyncHumanizer.click(checkbox, '第一个商品勾选框')
  } else {
    logPlain('未找到勾选框，改为点击第一条商品卡片/行容器...')
    logPlain('选中第一个商品（行容器）...')
    await SyncHumanizer.click(firstSelectable, '第一个商品行容器')
  }
  await sleep(300)

  const modal = resolveProductModalScope(searchInput)

  const saveButton = await waitFor(() => findConfirmButtonInScope(modal) || findSaveButtonFuzzyInScope(modal) || findSaveButton(modalRoot) || null, {
    timeoutMs: 20_000,
    intervalMs: 250,
    timeoutMessage: '未找到“确定/完成/保存”按钮（弹窗内）。'
  }).catch((error) => {
    logPlain('未能定位到“确定/完成/保存”按钮，开始输出弹窗内候选元素列表用于排查...')
    dumpSaveCandidates(modal)
    throw error
  })

  logPlain('已定位确认按钮，准备点击...')
  await SyncHumanizer.click(saveButton, '弹窗内确认按钮')
  await waitFor(() => (isVisible(modalRoot) ? null : true), { timeoutMs: 20_000, intervalMs: 250, timeoutMessage: '商品弹窗未关闭。' }).catch(() => void 0)

  logPlain('商品添加流程结束。')
  return true
}

async function selectProduct(productName: string): Promise<boolean> {
  const normalizedName = String(productName ?? '').trim()
  if (!normalizedName) return true

  logPlain('准备添加商品...')
  logStep(4, '按名称选择商品...', { productName: normalizedName })

  const searchInput = await openProductModalWithRetry()
  const modalRoot = getModalRoot(searchInput)
  if (!modalRoot) throw new Error('无法定位商品弹窗根节点。')

  setInputValue(searchInput, normalizedName)
  await sleep(500)

  const firstItem = await waitFor(() => findFirstProductItem(modalRoot), {
    timeoutMs: 20_000,
    intervalMs: 250,
    timeoutMessage: '未找到商品搜索结果。'
  })
  await SyncHumanizer.click(firstItem, '第一个商品结果')
  await sleep(300)

  const modal = resolveProductModalScope(searchInput)
  const saveButton = await waitFor(() => findConfirmButtonInScope(modal) || findSaveButtonFuzzyInScope(modal) || findSaveButton(modalRoot) || null, {
    timeoutMs: 20_000,
    intervalMs: 250,
    timeoutMessage: '未找到“确定/完成/保存”按钮（弹窗内）。'
  }).catch((error) => {
    logPlain('未能定位到“确定/完成/保存”按钮，开始输出弹窗内候选元素列表用于排查...')
    dumpSaveCandidates(modal)
    throw error
  })
  logPlain('已定位确认按钮，准备点击...')
  await SyncHumanizer.click(saveButton, '弹窗内确认按钮')
  await waitFor(() => (isVisible(modalRoot) ? null : true), { timeoutMs: 20_000, intervalMs: 250, timeoutMessage: '商品弹窗未关闭。' }).catch(() => void 0)
  logPlain('[时间] 点击保存完成，等待 3 秒缓冲...')
  await sleep(3000)
  logPlain('商品添加流程结束。')
  return true
}

async function waitForPageReady(): Promise<void> {
  await waitFor(
    () => {
      const sidebar = findByText('发布笔记', { match: 'contains' })
      if (sidebar) return sidebar
      const mainSignals =
        queryFirstVisible('input[type="file"]') ||
        queryFirstVisible('textarea') ||
        queryFirstVisible('[contenteditable="true"]') ||
        findByText('上传视频', { match: 'contains' }) ||
        findByText('上传图文', { match: 'contains' })
      return mainSignals || null
    },
    { timeoutMs: 60_000, intervalMs: 250, timeoutMessage: '发布页面未就绪（可能未登录或页面加载异常）。' }
  )
}

function findImageTab(): HTMLElement | null {
  const exact = findByText('上传图文', { selector: 'div, span', match: 'exact' })
  if (!exact) return null
  return (exact.closest('button, [role="tab"], [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || exact
}

async function switchToImageUploadTab(): Promise<void> {
  const tab = await waitFor(() => findImageTab(), { timeoutMs: 10_000, intervalMs: 250, timeoutMessage: '未找到图文入口' }).catch(() => null)

  if (!tab) {
    throw new Error('未找到“上传图文”入口（可能页面结构变化）。')
  }

  clickElement(tab)
  await waitFor(() => findImageUploadDropTarget(), { timeoutMs: 20_000, intervalMs: 250, timeoutMessage: '未检测到上传界面（可能页面结构变化）。' })
  await sleep(500)
}

function findVideoTab(): HTMLElement | null {
  const exact = findByText('发布视频', { selector: 'div, span', match: 'exact' }) || findByText('上传视频', { selector: 'div, span', match: 'exact' })
  if (!exact) {
    const fuzzy = findByText('发布视频', { selector: 'div, span, button, a', match: 'contains' }) || findByText('上传视频', { selector: 'div, span, button, a', match: 'contains' })
    if (!fuzzy) return null
    return (fuzzy.closest('button, [role="tab"], [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || fuzzy
  }
  return (exact.closest('button, [role="tab"], [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || exact
}

function findVideoFileInput(scope?: ParentNode | null): HTMLInputElement | null {
  const root = (scope as ParentNode | null) || document
  const inputs = Array.from(root.querySelectorAll?.('input[type="file"]') || []) as HTMLInputElement[]
  const preferred = inputs.find((el) => {
    const accept = String(el.getAttribute('accept') || '').toLowerCase()
    if (!accept) return false
    return accept.includes('video') || accept.includes('.mp4') || accept.includes('.mov') || accept.includes('.m4v') || accept.includes('.webm')
  })
  if (preferred) return preferred
  const withHint = inputs.find((el) => {
    const accept = String(el.getAttribute('accept') || '').toLowerCase()
    if (accept && accept.includes('image')) return false
    return true
  })
  return withHint || null
}

async function switchToVideoUploadTab(): Promise<void> {
  const hasVideoInput = findVideoFileInput(document) !== null
  if (hasVideoInput && (findByText('上传视频', { match: 'contains' }) || findByText('发布视频', { match: 'contains' }))) {
    await waitFor(() => findVideoFileInput(document), { timeoutMs: 10_000, intervalMs: 250, timeoutMessage: '未检测到视频上传组件。' })
    return
  }
  const tab = await waitFor(() => findVideoTab(), { timeoutMs: 10_000, intervalMs: 250, timeoutMessage: '未找到视频入口' }).catch(() => null)
  if (!tab) throw new Error('未找到“发布视频”入口（可能页面结构变化）。')
  clickElement(tab)
  await waitFor(() => findVideoFileInput(document), { timeoutMs: 20_000, intervalMs: 250, timeoutMessage: '未检测到视频上传组件加载完成。' })
  await sleep(500)
}

async function createDataTransferForFile(filePath: string): Promise<DataTransfer> {
  const normalizedPath = String(filePath ?? '').trim()
  if (!normalizedPath) throw new Error('文件路径为空。')
  const resolvedPath = await resolveWorkspaceFilePath(normalizedPath)
  if (!resolvedPath || isHttpUrl(resolvedPath)) {
    throw new Error(`不支持上传网络文件: ${normalizedPath}`)
  }
  const abs = path.resolve(resolvedPath)
  await fs.promises.access(abs, fs.constants.R_OK)
  const buffer = await fs.promises.readFile(abs)
  const filename = path.basename(abs)
  const mime = guessMimeType(abs)
  const dt = new DataTransfer()
  dt.items.add(new File([buffer], filename, { type: mime }))
  return dt
}

function hasVideoUploadFailureText(): boolean {
  const text = normalizeText(document.body?.innerText || document.body?.textContent || '')
  if (!text) return false
  return text.includes('上传失败') || text.includes('失败') || text.includes('请重试')
}

async function robustVideoUpload(videoPath: string): Promise<true> {
  const normalizedPath = String(videoPath ?? '').trim()
  if (!normalizedPath) throw new Error('缺少视频路径。')
  const fileInput = await waitFor(() => findVideoFileInput(document), {
    timeoutMs: 20_000,
    intervalMs: 250,
    timeoutMessage: '未找到视频上传 input（可能页面结构变化）。'
  })
  const dt = await createDataTransferForFile(normalizedPath)
  if (!dt.files || dt.files.length === 0) throw new Error('构造视频上传 FileList 失败。')
  dispatchUploadEventsToInput(fileInput, dt)
  return true
}

function findVideoQualityDetectedIndicator(): HTMLElement | null {
  const hd = findByText('检测为高清视频', { match: 'contains' })
  if (hd && isVisible(hd)) return hd
  const clear = findByText('检测为清晰视频', { match: 'contains' })
  if (clear && isVisible(clear)) return clear
  return null
}

function isDisabledLike(el: HTMLElement): boolean {
  const any = el as unknown as { disabled?: boolean }
  return el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null || any.disabled === true
}

function findPublishButtonAnyState(): HTMLElement | null {
  const direct =
    queryFirstVisible<HTMLElement>('#publish-container .publish-btn') ||
    queryFirstVisible<HTMLElement>('#publish-container button.publish-btn') ||
    queryFirstVisible<HTMLElement>('#publish-container button') ||
    queryFirstVisible<HTMLElement>('button.publish-btn') ||
    null
  if (direct) {
    const btn = (direct.closest('button') as HTMLElement | null) || direct
    if (btn && isVisible(btn)) return btn
  }

  const buttons = Array.from(document.querySelectorAll('button')).filter((el): el is HTMLButtonElement => el instanceof HTMLButtonElement)
  const candidates = buttons
    .filter((btn) => isVisible(btn))
    .filter((btn) => {
      const text = normalizeText(btn.innerText || btn.textContent || '')
      if (!text) return false
      if (!text.includes('发布')) return false
      if (text.includes('定时')) return false
      if (text.includes('计划')) return false
      if (text.includes('草稿')) return false
      if (btn.closest('[role="radio"], [role="radiogroup"], label')) return false
      const rect = btn.getBoundingClientRect()
      return rect.width >= 72 && rect.height >= 28
    })
    .map((btn) => {
      const text = normalizeText(btn.innerText || btn.textContent || '')
      const className = typeof btn.className === 'string' ? btn.className : ''
      const rect = btn.getBoundingClientRect()
      let score = 0
      if (text === '发布') score += 2000
      else if (text.includes('发布')) score += 800
      if (className.includes('publish') || className.includes('Publish')) score += 400
      if (className.includes('primary') || className.includes('Primary') || className.includes('ant-btn-primary')) score += 250
      if (isLikelyRedButton(btn)) score += 600
      if (!isDisabledLike(btn)) score += 200
      score += Math.min(200, rect.width * rect.height * 0.01)
      score += Math.max(0, 1200 - rect.top) * 0.01
      if (btn.closest('#publish-container')) score += 500
      return { btn, score }
    })

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.btn ?? null
}

async function checkVideoReady(): Promise<void> {
  const startedAt = Date.now()
  const timeoutMs = 120_000
  const intervalMs = 2000

  while (Date.now() - startedAt <= timeoutMs) {
    if (hasVideoUploadFailureText()) {
      throw new Error('视频上传失败：检测到“上传失败”提示。')
    }

    const indicator = findVideoQualityDetectedIndicator()
    const publishBtn = findPublishButtonAnyState()
    const disabled = publishBtn ? isDisabledLike(publishBtn) : true

    if (indicator && publishBtn && !disabled) {
      logPlain('[视频就绪] 检测到视频清晰度提示，发布按钮已可用。')
      return
    }

    if (publishBtn && !disabled) {
      logPlain('[视频就绪] 发布按钮已可用（未检测到清晰度提示，继续尝试发布）。')
      return
    }

    logPlain('[视频就绪] 尚未就绪，等待 2 秒后重试...', {
      hasIndicator: Boolean(indicator),
      hasPublishButton: Boolean(publishBtn),
      publishDisabled: disabled
    })
    await sleep(intervalMs)
  }

  throw new Error('视频上传未就绪：120 秒内未检测到“清晰度提示”且发布按钮仍不可用。')
}

function normalizeTaskTags(raw: unknown): string[] {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const v = typeof item === 'string' ? item : String(item ?? '')
    const tag = v.trim().replace(/^#+/, '')
    if (!tag) continue
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

function findContentEditorAny(): EditorElement | null {
  return (
    queryFirstVisible<HTMLTextAreaElement>('textarea[placeholder*="正文"]') ||
    queryFirstVisible<HTMLTextAreaElement>('textarea[placeholder*="内容"]') ||
    queryFirstVisible<HTMLTextAreaElement>('textarea[aria-label*="正文"]') ||
    queryFirstVisible<HTMLTextAreaElement>('textarea[aria-label*="内容"]') ||
    queryFirstVisible<HTMLElement>('[contenteditable="true"]') ||
    null
  )
}

async function fillTagsAsBlueTopics(tags: string[]): Promise<void> {
  if (!tags || tags.length === 0) return
  for (const tag of tags) {
    const editor = await waitFor(() => findContentEditorAny() || null, {
      timeoutMs: 30_000,
      intervalMs: 250,
      timeoutMessage: '未找到正文输入框（话题插入阶段）。'
    })
    await insertTopic(editor, tag)
  }
}

async function safeFillTitle(title: string): Promise<void> {
  try {
    await fillTitle(title)
  } catch (error) {
    await sleep(800)
    await fillTitle(title)
  }
}

async function safeFillContentAndTags(content: string, tags: string[]): Promise<void> {
  try {
    await fillContent(content)
    await fillTagsAsBlueTopics(tags)
  } catch (error) {
    await sleep(800)
    await fillContent(content)
    await fillTagsAsBlueTopics(tags)
  }
}

async function clickPublish(publishButton?: HTMLElement): Promise<void> {
  const button =
    publishButton ||
    (await waitFor(() => findPublishSubmitButton(), {
    timeoutMs: 30_000,
    intervalMs: 250,
    timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
  }))
  const label = '发布按钮 (Publish Button)'
  const tryConfirmClickWorked = async (): Promise<boolean> => {
    const ok = await waitFor(
      () => {
        const success =
          findByText('发布成功', { match: 'contains' }) ||
          findByText('已发布', { match: 'contains' }) ||
          queryFirstVisible('.ant-message-success') ||
          queryFirstVisible('.ant-notification-notice-success') ||
          null
        if (success) return true

        const btn = findPublishSubmitButton()
        if (!btn) return true
        if (isDisabledLike(btn)) return true
        const className = typeof btn.className === 'string' ? btn.className : ''
        if (className.includes('loading') || className.includes('ant-btn-loading')) return true
        return null
      },
      { timeoutMs: 1500, intervalMs: 250, timeoutMessage: '发布点击未生效（将尝试清除遮罩并重试）。' }
    ).catch(() => null)
    return Boolean(ok)
  }

  await SyncHumanizer.click(button, label)
  const worked = await tryConfirmClickWorked()
  if (worked) return

  logPlain('[发布] 首次点击可能被遮罩拦截，尝试点空白处清除并重试...')
  try {
    const neutral = findNeutralClickTarget()
    clickElement(neutral)
  } catch (error) {
    void error
  }
  await sleep(500)

  const refreshed = await waitFor(() => findPublishSubmitButton(), {
    timeoutMs: 30_000,
    intervalMs: 250,
    timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
  })
  await SyncHumanizer.click(refreshed, label)
}

function findConfirmButtonInScope(scope: ParentNode): HTMLElement | null {
  const candidates = Array.from(scope.querySelectorAll('button, [role="button"], a, div[tabindex], span[tabindex]')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el)
  )
  const wanted = ['确定', '完成', '保存']
  for (const el of candidates) {
    const t = normalizeText(el.innerText || el.textContent || '')
    if (!t) continue
    if (!wanted.some((w) => t.includes(w))) continue
    const disabled =
      el.getAttribute('aria-disabled') === 'true' || el.getAttribute('disabled') !== null || (el as unknown as { disabled?: boolean }).disabled === true
    if (!disabled) return el
  }
  return null
}

function findClickableAncestor(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null
  const clickable =
    (el.closest('button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn, label') as HTMLElement | null) || el
  if (!clickable) return null
  if (!isVisible(clickable)) return isVisible(el) ? el : null
  return clickable
}

function rectToPlain(rect: DOMRect): { top: number; left: number; width: number; height: number } {
  return {
    top: Math.round(rect.top),
    left: Math.round(rect.left),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

function markDebugTarget(el: HTMLElement | null, label: string): void {
  if (!el) return
  try {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
    } catch (error) {
      void error
    }

    const rect = el.getBoundingClientRect()
    const prevOutline = el.style.outline
    const prevOutlineOffset = el.style.outlineOffset
    const prevBoxShadow = el.style.boxShadow
    const prevBorderRadius = el.style.borderRadius

    el.style.outline = '4px solid #ff2d2d'
    el.style.outlineOffset = '2px'
    el.style.boxShadow = '0 0 0 2px rgba(255,45,45,0.35)'
    el.style.borderRadius = '6px'

    const overlay = document.createElement('div')
    overlay.setAttribute('data-cms-xhs-cover-debug', '1')
    overlay.style.position = 'fixed'
    overlay.style.left = `${Math.max(0, rect.left - 3)}px`
    overlay.style.top = `${Math.max(0, rect.top - 3)}px`
    overlay.style.width = `${Math.max(14, rect.width + 6)}px`
    overlay.style.height = `${Math.max(14, rect.height + 6)}px`
    overlay.style.border = '3px solid #ff2d2d'
    overlay.style.background = 'rgba(255,45,45,0.06)'
    overlay.style.borderRadius = '8px'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '2147483647'

    const badge = document.createElement('div')
    badge.textContent = label
    badge.style.position = 'absolute'
    badge.style.left = '0'
    badge.style.top = '-24px'
    badge.style.maxWidth = '320px'
    badge.style.padding = '2px 6px'
    badge.style.whiteSpace = 'nowrap'
    badge.style.overflow = 'hidden'
    badge.style.textOverflow = 'ellipsis'
    badge.style.color = '#fff'
    badge.style.background = '#ff2d2d'
    badge.style.fontSize = '12px'
    badge.style.fontWeight = '700'
    badge.style.lineHeight = '18px'
    badge.style.borderRadius = '4px'
    overlay.appendChild(badge)
    document.body.appendChild(overlay)

    logPlain(`[封面Debug] 红框定位: ${label}`, { element: describeElement(el), rect: rectToPlain(rect) })
    window.setTimeout(() => {
      try {
        el.style.outline = prevOutline
        el.style.outlineOffset = prevOutlineOffset
        el.style.boxShadow = prevBoxShadow
        el.style.borderRadius = prevBorderRadius
        overlay.remove()
      } catch (error) {
        void error
      }
    }, 2200)
  } catch (error) {
    void error
  }
}

function findCoverSectionRoot(): { root: HTMLElement; anchor: HTMLElement } | null {
  const anchor =
    findLeafByTextIncludes('设置封面', document.body) ||
    findLeafByTextIncludes('智能推荐封面', document.body) ||
    findLeafByTextIncludes('推荐封面', document.body) ||
    null
  if (!anchor) return null

  const scoped =
    (anchor.closest('#publish-container') as HTMLElement | null) ||
    (anchor.closest('section, article, form, main') as HTMLElement | null) ||
    (anchor.closest('div') as HTMLElement | null) ||
    document.body

  return { root: scoped, anchor }
}

function collectCoverFrameCandidates(root: ParentNode): HTMLElement[] {
  const selector = [
    '[class*="cover-item"]',
    '[class*="coverItem"]',
    '[class*="cover_item"]',
    '[class*="cover-frame"]',
    '[class*="coverFrame"]',
    '[class*="cover"] img',
    '[class*="Cover"] img',
    '[class*="cover"] canvas',
    '[class*="Cover"] canvas',
    '[class*="thumbnail"]',
    '[class*="Thumbnail"]',
    '[class*="poster"]',
    '[class*="Poster"]',
    '[data-testid*="cover"]',
    '[data-test*="cover"]'
  ].join(', ')
  const nodes = Array.from(root.querySelectorAll(selector)).filter((el): el is HTMLElement => el instanceof HTMLElement)
  const picked: HTMLElement[] = []
  const seen = new Set<HTMLElement>()

  for (const node of nodes) {
    const isMediaNode = node.tagName === 'IMG' || node.tagName === 'CANVAS' || node.tagName === 'VIDEO'
    const rawTarget = isMediaNode
      ? ((node.closest(
          '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover"], [class*="Cover"], [class*="thumbnail"], [class*="poster"], li'
        ) as HTMLElement | null) ||
        (node.parentElement as HTMLElement | null) ||
        node)
      : node
    const target = findClickableAncestor(rawTarget) || rawTarget
    if (!target || seen.has(target)) continue
    if (!isVisible(target)) continue
    if (target.closest('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')) continue
    if (target.closest('header, nav, aside, footer')) continue

    const rect = target.getBoundingClientRect()
    if (rect.width < 56 || rect.height < 56) continue
    if (rect.width > 420 || rect.height > 420) continue
    if (rect.bottom < 0 || rect.top > window.innerHeight + 200) continue

    seen.add(target)
    picked.push(target)
  }
  return picked
}

function scoreCoverFrameCandidate(target: HTMLElement, anchorRect: DOMRect | null): number {
  const rect = target.getBoundingClientRect()
  const classNames = `${String(target.className || '')} ${String(target.parentElement?.className || '')}`.toLowerCase()
  const text = normalizeText(target.innerText || target.textContent || '')
  const aspect = rect.width / Math.max(1, rect.height)
  const area = rect.width * rect.height
  let score = 0

  if (classNames.includes('cover')) score += 360
  if (classNames.includes('recommend')) score += 120
  if (classNames.includes('poster') || classNames.includes('thumbnail')) score += 120
  if (text.includes('修改封面') || text.includes('替换封面') || text.includes('更换封面')) score += 320
  if (target.closest('#publish-container')) score += 120
  if (rect.top >= 20 && rect.top <= window.innerHeight + 120) score += 90
  if (rect.left >= 0 && rect.left <= window.innerWidth + 60) score += 40
  if (area >= 4_000 && area <= 120_000) score += 120
  if (aspect >= 0.45 && aspect <= 1.8) score += 60
  if (target.closest('[role="list"], ul, ol, [class*="list"], [class*="List"]')) score += 50
  if (target.querySelector('img, canvas, video')) score += 40
  if (target.closest('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')) score -= 480
  if (target.closest('header, nav, aside, footer')) score -= 420

  if (anchorRect) {
    const dy = rect.top - anchorRect.top
    if (dy >= -30) score += 120
    if (dy >= -30 && dy <= 900) score += 150
    const distance = Math.abs(rect.top - anchorRect.bottom)
    score += Math.max(0, 600 - distance) * 0.2
  }

  return score
}

function pickFirstCoverFrameCandidate(candidates: HTMLElement[], anchorRect: DOMRect | null): HTMLElement | null {
  const scored = candidates
    .map((target) => ({ target, rect: target.getBoundingClientRect(), score: scoreCoverFrameCandidate(target, anchorRect) }))
    .filter((item) => item.score > 0)

  if (scored.length === 0) return null
  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.rect.top !== b.rect.top ? a.rect.top - b.rect.top : a.rect.left - b.rect.left))

  const bestScore = scored[0]?.score ?? 0
  const nearBest = scored.filter((item) => item.score >= bestScore - 120)
  nearBest.sort((a, b) => (a.rect.top !== b.rect.top ? a.rect.top - b.rect.top : a.rect.left - b.rect.left))
  return nearBest[0]?.target ?? scored[0]?.target ?? null
}

function summarizeCoverCandidates(candidates: HTMLElement[]): Array<{ element: Record<string, unknown> | null; rect: { top: number; left: number; width: number; height: number } }> {
  return candidates.slice(0, 6).map((target) => ({ element: describeElement(target), rect: rectToPlain(target.getBoundingClientRect()) }))
}

function findFirstCoverFrameUnderSettingSection(): HTMLElement | null {
  const section = findCoverSectionRoot()
  const anchorRect = section?.anchor?.getBoundingClientRect?.() || null
  const searchRoots = [section?.root || null, document.querySelector('#publish-container') as HTMLElement | null, document.body]
  const visited = new Set<ParentNode>()

  for (const root of searchRoots) {
    if (!root || visited.has(root)) continue
    visited.add(root)
    const candidates = collectCoverFrameCandidates(root)
    const picked = pickFirstCoverFrameCandidate(candidates, anchorRect)
    if (picked) return picked
  }
  return null
}

function findCoverModalUploadButton(modalRoot: HTMLElement): HTMLElement | null {
  const directLeaf = findLeafByTextIncludes('上传图片', modalRoot)
  if (directLeaf) {
    const clickable = findClickableAncestor(directLeaf)
    if (clickable && isVisible(clickable) && !isDisabledLike(clickable)) return clickable
  }

  const candidates = Array.from(
    modalRoot.querySelectorAll('button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn')
  ).filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el))

  const scored = candidates
    .map((el) => {
      const text = normalizeText(el.innerText || el.textContent || '').replace(/\s+/g, '')
      if (!text) return null
      if (!text.includes('上传图片')) return null
      if (isDisabledLike(el)) return null
      const rect = el.getBoundingClientRect()
      const className = typeof el.className === 'string' ? el.className : ''
      let score = 0
      if (text === '上传图片' || text === '+上传图片') score += 400
      if (className.includes('upload') || className.includes('Upload')) score += 120
      if (className.includes('btn') || className.includes('Btn')) score += 60
      if (rect.width >= 80 && rect.width <= 260) score += 40
      score += Math.max(0, 2000 - rect.top) * 0.01
      return { el, score }
    })
    .filter((x): x is { el: HTMLElement; score: number } => Boolean(x))

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.el ?? null
}

function findCoverModalConfirmButton(modalRoot: HTMLElement): HTMLElement | null {
  const candidates = Array.from(modalRoot.querySelectorAll('button, [role="button"], a, div[tabindex], span[tabindex]')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && isVisible(el)
  )

  const scored = candidates
    .map((el) => {
      const text = normalizeText(el.innerText || el.textContent || '')
      if (!text) return null
      if (!(text.includes('确定') || text.includes('完成') || text.includes('保存'))) return null
      if (text.includes('取消')) return null
      if (isDisabledLike(el)) return null
      const className = typeof el.className === 'string' ? el.className : ''
      let score = 0
      if (text === '确定') score += 500
      else if (text.includes('确定')) score += 320
      else if (text.includes('完成')) score += 220
      else if (text.includes('保存')) score += 180
      if (className.includes('primary') || className.includes('Primary') || className.includes('ant-btn-primary')) score += 260
      if (isLikelyRedButton(el)) score += 240
      const rect = el.getBoundingClientRect()
      // 通常在弹窗底部靠右
      score += Math.max(0, rect.top) * 0.01
      score += Math.max(0, rect.left) * 0.01
      return { el, score }
    })
    .filter((x): x is { el: HTMLElement; score: number } => Boolean(x))

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.el ?? null
}

function stringifyUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch (e) {
    void e
  }
  return String(error)
}

function dispatchHoverEventChain(target: HTMLElement): void {
  const rect = target.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }
  try {
    target.dispatchEvent(new MouseEvent('mouseenter', opts))
  } catch (error) {
    void error
  }
  try {
    target.dispatchEvent(new MouseEvent('mouseover', opts))
  } catch (error) {
    void error
  }
  try {
    target.dispatchEvent(new MouseEvent('mousemove', opts))
  } catch (error) {
    void error
  }
}

function getElementCenterPoint(target: HTMLElement): { x: number; y: number } {
  const rect = target.getBoundingClientRect()
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2)
  }
}

type CoverModalUploadSnapshot = {
  text: string
  imageSources: string[]
  selectedFileCount: number
  fileValues: string[]
}

function normalizeImageSrcForCompare(src: string): string {
  const raw = String(src ?? '').trim()
  if (!raw) return ''
  return raw.replace(/[?#].*$/, '')
}

function snapshotCoverModalUploadState(modalRoot: HTMLElement): CoverModalUploadSnapshot {
  const text = normalizeText(modalRoot.innerText || modalRoot.textContent || '').toLowerCase()
  const imageSources = Array.from(modalRoot.querySelectorAll('img'))
    .filter((el): el is HTMLImageElement => el instanceof HTMLImageElement)
    .map((img) => normalizeImageSrcForCompare(String(img.currentSrc || img.src || '')))
    .filter(Boolean)
    .slice(0, 40)
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement
  )
  const selectedFileCount = fileInputs.reduce((sum, input) => sum + (input.files?.length ?? 0), 0)
  const fileValues = fileInputs
    .map((input) => String(input.value || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20)
  return { text, imageSources, selectedFileCount, fileValues }
}

function hasCoverSelectionSignal(modalRoot: HTMLElement, coverAbsPath: string, baseline: CoverModalUploadSnapshot): boolean {
  const now = snapshotCoverModalUploadState(modalRoot)
  const coverBase = path.basename(coverAbsPath).toLowerCase()
  const coverStem = coverBase.includes('.') ? coverBase.slice(0, coverBase.lastIndexOf('.')) : coverBase

  if (now.selectedFileCount > baseline.selectedFileCount) return true
  if (coverBase && now.fileValues.some((v) => v.includes(coverBase))) return true
  if (coverBase && now.text.includes(coverBase)) return true
  if (coverStem && coverStem.length >= 6 && now.text.includes(coverStem)) return true

  const imageChanged = now.imageSources.join('|') !== baseline.imageSources.join('|')
  const textChanged = now.text !== baseline.text
  const uploadWords = ['上传中', '处理中', '已上传', '上传成功', '重新上传', '替换', '更换']
  if (uploadWords.some((w) => now.text.includes(w)) && (imageChanged || textChanged)) return true

  return false
}

async function setVideoCover(coverImagePath: string): Promise<void> {
  const coverPath = String(coverImagePath ?? '').trim()
  if (!coverPath) return

  const deadline = Date.now() + 25_000
  const timeLeft = (): number => Math.max(0, deadline - Date.now())
  const ensureTime = (): void => {
    if (timeLeft() <= 0) throw new Error('封面设置超时')
  }

  try {
    const resolvedCoverPath = await resolveWorkspaceFilePath(coverPath)
    if (!resolvedCoverPath || isHttpUrl(resolvedCoverPath)) {
      throw new Error(`封面路径无效: ${coverPath}`)
    }
    ensureTime()

    const firstCoverEntry = await waitFor(() => findFirstCoverFrameUnderSettingSection() || null, {
      timeoutMs: Math.min(10_000, timeLeft()),
      intervalMs: 180,
      timeoutMessage: '未找到“设置封面”区域下第一个封面框。'
    }).catch((error) => {
      const debugCandidates = summarizeCoverCandidates(collectCoverFrameCandidates(document.body))
      logPlain('[封面Debug] 首个封面框定位失败', {
        error: stringifyUnknownError(error),
        candidates: debugCandidates
      })
      throw error
    })
    ensureTime()
    try {
      firstCoverEntry.scrollIntoView({ block: 'center', inline: 'nearest' })
    } catch (error) {
      void error
    }
    markDebugTarget(firstCoverEntry, '设置封面区域第一个封面框')
    await Humanizer.sleep(120, Math.min(420, Math.max(120, timeLeft())))
    ensureTime()

    dispatchHoverEventChain(firstCoverEntry)
    await Humanizer.sleep(180, Math.min(520, Math.max(180, timeLeft())))
    ensureTime()
    await SyncHumanizer.click(firstCoverEntry, '首个封面框（触发修改封面）')

    const modalRoot = await waitFor(
      () => {
        const modal = findTopMostVisibleModal()
        if (!modal || !isVisible(modal)) return null
        if (findCoverModalUploadButton(modal)) return modal
        if (findImageFileInputInScope(modal)) return modal
        return null
      },
      {
        timeoutMs: Math.min(8_000, timeLeft()),
        intervalMs: 180,
        timeoutMessage: '未出现封面弹窗（含上传图片入口）。'
      }
    )
    ensureTime()

    const uploadBtn = await waitFor(() => findCoverModalUploadButton(modalRoot) || null, {
      timeoutMs: Math.min(5_000, timeLeft()),
      intervalMs: 180,
      timeoutMessage: '未找到“上传图片”按钮。'
    })
    markDebugTarget(uploadBtn, '封面弹窗上传图片按钮')
    const beforeUploadState = snapshotCoverModalUploadState(modalRoot)
    let lastPickResult: unknown = null
    let nativePickSuccess = false

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      dispatchHoverEventChain(uploadBtn)
      await Humanizer.sleep(90, Math.min(260, Math.max(90, timeLeft())))
      ensureTime()

      const point = getElementCenterPoint(uploadBtn)
      const nativeClickOk = await ipcRenderer
        .invoke('cms.xhs.nativeClickAt', { x: point.x, y: point.y })
        .catch(() => false)
      logPlain(`[封面] 上传按钮点击尝试 #${attempt}`, {
        nativeClickOk,
        point,
        element: describeElement(uploadBtn)
      })

      if (!nativeClickOk) {
        await SyncHumanizer.click(uploadBtn, `封面弹窗上传图片按钮（备用点击 #${attempt}）`)
        clickElement(uploadBtn)
      }

      await Humanizer.sleep(150, Math.min(520, Math.max(150, timeLeft())))
      ensureTime()

      const pickResult = await ipcRenderer
        .invoke('cms.xhs.nativeDialogPickFile', { filePath: resolvedCoverPath })
        .catch((error) => ({ ok: false, reason: 'ipc-error', detail: stringifyUnknownError(error) }))
      lastPickResult = pickResult
      const pickOk = Boolean(pickResult && typeof pickResult === 'object' && (pickResult as { ok?: unknown }).ok === true)

      if (pickOk) {
        nativePickSuccess = true
        logPlain('[封面] 系统文件选择器已自动按路径完成选图。', { attempt, pickResult })
        break
      }

      logPlain(`[封面] 系统选图尝试 #${attempt} 未成功，将重试一次点击。`, pickResult)
      await sleep(Math.min(380, Math.max(180, timeLeft())))
      ensureTime()
    }

    if (!nativePickSuccess) {
      throw new Error(
        `系统文件选择器自动选图失败：${stringifyUnknownError(lastPickResult)}。请检查“系统设置 > 隐私与安全性 > 辅助功能/自动化”是否允许 Super CMS 控制 System Events。`
      )
    }

    const selectionReady = await waitFor(
      () => (hasCoverSelectionSignal(modalRoot, resolvedCoverPath, beforeUploadState) ? true : null),
      {
        timeoutMs: Math.min(7_000, timeLeft()),
        intervalMs: 180,
        timeoutMessage: '系统文件选择器未确认选中封面文件，停止点击确定。'
      }
    ).catch(() => null)
    if (!selectionReady) {
      throw new Error('系统文件选择器未确认封面已选中，已停止后续“确定”点击。')
    }
    logPlain('[封面] 已检测到封面文件选中信号，继续点击确定。')

    await sleep(Math.min(900, Math.max(320, timeLeft())))
    ensureTime()

    const confirmBtn = await waitFor(() => findCoverModalConfirmButton(modalRoot) || findConfirmButtonInScope(modalRoot) || null, {
      timeoutMs: Math.min(6_000, timeLeft()),
      intervalMs: 180,
      timeoutMessage: '未找到封面弹窗“确定”按钮。'
    })
    markDebugTarget(confirmBtn, '封面弹窗确定按钮')
    await SyncHumanizer.click(confirmBtn, '封面弹窗确认按钮')

    await waitFor(() => (isVisible(modalRoot) ? null : true), {
      timeoutMs: Math.min(8_000, timeLeft()),
      intervalMs: 180,
      timeoutMessage: '封面弹窗未关闭。'
    }).catch(() => void 0)
  } catch (error) {
    logPlain('[Warning] 封面设置失败，转为人工接管', { error: stringifyUnknownError(error) })
    return
  }
}

function hasProductAddedIndicator(): boolean {
  const findAddProductButton = (): HTMLElement | null => {
    const leaf =
      findLeafByTextIncludes('添加商品', document.body) ||
      (findByText('添加商品', { selector: 'button, span, div, a', match: 'contains' }) as HTMLElement | null) ||
      null
    if (!leaf) return null
    return (leaf.closest('button, [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || leaf
  }

  const isNear = (a: DOMRect, b: DOMRect, { maxDx = 260, maxDy = 140 }: { maxDx?: number; maxDy?: number } = {}): boolean => {
    const ax = a.left + a.width / 2
    const ay = a.top + a.height / 2
    const bx = b.left + b.width / 2
    const by = b.top + b.height / 2
    return Math.abs(ax - bx) <= maxDx && Math.abs(ay - by) <= maxDy
  }

  const addBtn = findAddProductButton()
  if (addBtn && isVisible(addBtn)) {
    const btnRect = addBtn.getBoundingClientRect()
    const scope =
      (addBtn.closest(
        '[class*="goods"], [class*="product"], [class*="component"], [class*="shop"], .ant-form-item, .ant-space, .ant-row, .ant-col, section, article, main, form'
      ) as HTMLElement | null) ||
      (addBtn.parentElement as HTMLElement | null) ||
      document.body

    const badgeCandidates = Array.from(
      scope.querySelectorAll<HTMLElement>('.ant-tag, .ant-badge, [class*="tag"], [class*="badge"], [class*="Tag"], [class*="Badge"]')
    ).filter((el) => el instanceof HTMLElement && isVisible(el))

    for (const el of badgeCandidates) {
      const rect = el.getBoundingClientRect()
      if (!isNear(btnRect, rect)) continue
      const t = normalizeText(el.innerText || el.textContent || '')
      if (!t) continue
      if (t.includes('已添加')) return true
      if (t.includes('1')) return true
      if (/已添加\s*\d+/.test(t)) return true
    }

    const actionCandidates = Array.from(scope.querySelectorAll('button, [role="button"], a, [aria-label], [title], i, svg, span'))

    for (const raw of actionCandidates) {
      const el =
        (raw instanceof HTMLElement ? raw : ((raw.closest('button, [role="button"], a, i, span') as HTMLElement | null) || null)) || null
      if (!el) continue
      if (!isVisible(el)) continue
      if (el === addBtn) continue
      const rect = el.getBoundingClientRect()
      if (!isNear(btnRect, rect)) continue
      const t = normalizeText(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || '')
      if (!t) continue
      if (t.includes('删除') || t.includes('编辑')) return true
    }
  }

  const leaf = findLeafByTextIncludes('已添加', document.body) || null
  if (!leaf) return false
  const scope = (leaf.closest('div, section, main, form') as HTMLElement | null) || leaf
  const t = normalizeText(scope.innerText || scope.textContent || '')
  if (!t) return false
  if (/已添加\s*\d+\s*(个|件)?\s*商品/.test(t)) return true
  if (t.includes('已添加') && t.includes('商品')) return true
  if (t.includes('已添加') && /\d+/.test(t)) return true
  return false
}

async function addProductIfNeeded(productId: string, productName: string): Promise<void> {
  const id = String(productId ?? '').trim()
  const name = String(productName ?? '').trim()
  if (!id && !name) return

  if (hasProductAddedIndicator()) {
    logPlain('检测到已挂车标识，跳过添加商品。')
    return
  }

  const softCheck = async (source: string): Promise<void> => {
    if (hasProductAddedIndicator()) return
    const ok = await waitFor(() => (hasProductAddedIndicator() ? true : null), {
      timeoutMs: 4000,
      intervalMs: 400,
      timeoutMessage: 'soft-check-timeout'
    }).catch(() => null)
    if (ok) return
    try {
      console.warn('[XHS] 挂车后未检测到“已添加”标识（已继续流程）。', { source })
    } catch (error) {
      void error
    }
  }

  if (id) {
    try {
      await addProductById(id)
      const modalClosed = await waitFor(() => (findProductModalSearchInput() ? null : true), {
        timeoutMs: 4000,
        intervalMs: 250,
        timeoutMessage: '商品弹窗仍可见（将继续流程）。'
      }).catch(() => null)
      if (modalClosed) return
      await softCheck('addProductById')
      return
    } catch (error) {
      if (!name) throw error
      logPlain('按商品ID添加失败，尝试按商品名称搜索...', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  if (name) {
    await selectProduct(name)
    await softCheck('selectProduct')
  }
}

async function waitForEditScreen({ timeoutMs = 10_000 }: { timeoutMs?: number } = {}): Promise<void> {
  const startedUrl = location.href
  logStep(2, '等待进入编辑界面...')
  await waitFor(
    () => {
      if (location.href && location.href !== startedUrl && !isLikelyLoginUrl(location.href)) return true
      return (
        queryFirstVisible('input[placeholder*="填写标题"]') ||
        queryFirstVisible('input[placeholder*="标题"]') ||
        queryFirstVisible('div.title-input') ||
        null
      )
    },
    {
      timeoutMs: Math.max(1000, Math.floor(timeoutMs)),
      intervalMs: 200,
      timeoutMessage: '上传可能失败：未跳转到编辑界面。'
    }
  )
  logStep(2, '已进入编辑界面。')
}

type TaskData = {
  title?: unknown
  content?: unknown
  tags?: unknown
  images?: unknown
  imagePath?: unknown
  mediaType?: unknown
  videoPath?: unknown
  productId?: unknown
  productName?: unknown
}

type PublishMode = 'immediate'

type RunTaskResult = { success: true; published: boolean; time?: string }

async function runTask(
  taskData: TaskData,
  { dryRun = false, mode = 'immediate' }: { dryRun?: boolean; mode?: PublishMode } = {}
): Promise<RunTaskResult> {
  try {
    void mode
    const imagesFromArray = Array.isArray(taskData?.images)
      ? (taskData.images as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : []
    const singleImage = typeof taskData?.imagePath === 'string' ? taskData.imagePath.trim() : ''
    const images = imagesFromArray.length > 0 ? imagesFromArray : singleImage ? [singleImage] : []
    const title = typeof taskData?.title === 'string' ? taskData.title : ''
    const content = typeof taskData?.content === 'string' ? taskData.content : ''
    const productId = typeof taskData?.productId === 'string' ? taskData.productId.trim() : ''
    const productName = typeof taskData?.productName === 'string' ? taskData.productName.trim() : ''

    if (isLikelyLoginUrl(location.href)) {
      throw new Error('未登录或登录态失效。')
    }

    if (images.length === 0) throw new Error('缺少图片。')

    logStep(0, '开始执行发布任务', {
      images: images.length,
      hasTitle: !!title,
      hasContent: !!content,
      hasProduct: !!productId || !!productName,
      dryRun,
      url: location.href
    })

    await runStep('初始化并切换到上传图文 Tab', async () => {
      await waitForPageReady()
      await switchToImageUploadTab()
    })

    await runStep('图片上传并进入编辑界面', async () => {
      await robustImageUpload(images)
      await waitForEditScreen({ timeoutMs: 10_000 })
    })

    await runStep('填写标题与正文', async () => {
      logStep(3, '开始填写文案...')
      await Humanizer.sleep(500, 1500)
      if (title) {
        logStep(3, '正在填写标题...')
        logAction('填写标题', title)
        await fillTitle(title)
        await Humanizer.sleep(500, 1500)
      }
      if (content) {
        logStep(3, '正在填写正文...')
        logAction('填写正文', content)
        await fillContent(content)
      }
      await dismissPotentialPopups()
    })

    await runStep('自动挂车（添加商品组件）', async () => {
      await addProductIfNeeded(productId, productName)
      await sleep(1500)
    })

    if (dryRun) {
      await scrollPageToBottom()
      const btn = await waitFor(() => findPublishSubmitButton(), {
        timeoutMs: 30_000,
        intervalMs: 250,
        timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
      })
      highlightWithRedBorder(btn)
      logPlain('[时间] [干跑] 模式:立即发布。已定位发布按钮（未点击）。', { target: '发布按钮 (Publish Button)' })
      return { success: true, published: false }
    }

    await runStep('发布前校验', async () => {
      const errNode = findLikelyErrorNode(document.body)
      if (errNode) {
        const t = normalizeText(errNode.innerText || errNode.textContent || '')
        if (t.includes('标题') || t.includes('过长') || t.includes('不能为空') || t.includes('失败') || t.includes('错误')) {
          throw new Error(`检测到表单错误提示：${t}`)
        }
      }
    })

    await runStep('点击发布并等待成功', async () => {
      logPlain('[时间] 正在点击发布按钮...')
      await scrollPageToBottom()
      await sleep(300)
      await publishImageWithReadyGuard(images.length)
    })
    const time = new Date().toISOString()
    logPlain('[时间] 已确认发布成功。', { time })
    return { success: true, published: true, time }
  } catch (error) {
    logPlain('脚本发生异常，已停止执行（避免误点击）。')
    const message = error instanceof Error ? error.message : String(error)
    logPlain(`关键错误：${message}`)
    throw error
  }
}

type PublishTaskResult = RunTaskResult

async function publishVideoTask(
  taskData: TaskData,
  { dryRun = false, mode = 'immediate' }: { dryRun?: boolean; mode?: PublishMode } = {}
): Promise<PublishTaskResult> {
  const mediaType = typeof taskData?.mediaType === 'string' ? String(taskData.mediaType).trim() : ''
  const videoPath = typeof taskData?.videoPath === 'string' ? String(taskData.videoPath).trim() : ''
  const title = typeof taskData?.title === 'string' ? taskData.title : ''
  const content = typeof taskData?.content === 'string' ? taskData.content : ''
  const tags = normalizeTaskTags(taskData?.tags)
  const productId = typeof taskData?.productId === 'string' ? taskData.productId.trim() : ''
  const productName = typeof taskData?.productName === 'string' ? taskData.productName.trim() : ''
  const coverFromArray = Array.isArray(taskData?.images)
    ? (taskData.images as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : []

  if (isLikelyLoginUrl(location.href)) throw new Error('未登录或登录态失效。')
  if (!videoPath) throw new Error('缺少视频路径 videoPath。')

  logStep(0, '开始执行视频发布任务', {
    mediaType: mediaType || 'video',
    hasVideo: Boolean(videoPath),
    hasCover: coverFromArray.length > 0,
    hasTitle: !!title,
    hasContent: !!content,
    tags: tags.length,
    hasProduct: !!productId || !!productName,
    dryRun,
    url: location.href
  })

  await runStep('初始化并切换到发布视频 Tab', async () => {
    await waitForPageReady()
    await switchToVideoUploadTab()
  })

  await runStep('上传视频', async () => {
    await robustVideoUpload(videoPath)
    await sleep(350)
  })

  await runStep('上传视频封面（先封面后文案）', async () => {
    if (coverFromArray.length === 0) {
      logPlain('未提供封面路径，跳过设置封面。')
      return
    }
    await setVideoCover(coverFromArray[0]!)
  })

  await runStep('填写文案与挂车', async () => {
    await Humanizer.sleep(500, 1500)
    if (title) {
      logAction('填写标题', title)
      await safeFillTitle(title)
      await Humanizer.sleep(500, 1500)
    }
    if (content) {
      logAction('填写正文', content)
      await safeFillContentAndTags(content, tags)
    } else if (tags.length > 0) {
      await fillTagsAsBlueTopics(tags)
    }
    await dismissPotentialPopups()

    if (productId || productName) {
      await addProductIfNeeded(productId, productName)
    }
  })

  void mode

  await runStep('发布前校验', async () => {
    const errNode = findLikelyErrorNode(document.body)
    if (errNode) {
      const t = normalizeText(errNode.innerText || errNode.textContent || '')
      if (t.includes('标题') || t.includes('过长') || t.includes('不能为空') || t.includes('失败') || t.includes('错误')) {
        throw new Error(`检测到表单错误提示：${t}`)
      }
    }
  })

  if (dryRun) {
    const btn = await waitFor(() => findPublishSubmitButton(), {
      timeoutMs: 30_000,
      intervalMs: 250,
      timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
    })
    highlightWithRedBorder(btn)
    logPlain('[时间] [干跑] 模式:立即发布。已定位发布按钮（未点击）。')
    return { success: true, published: false }
  }

  await runStep('点击发布并等待成功', async () => {
    await checkVideoReady()
    await scrollPageToBottom(2)
    await sleep(300)
    const publishButton = await waitFor(() => findPublishSubmitButton(), {
      timeoutMs: 30_000,
      intervalMs: 250,
      timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
    })
    highlightWithRedBorder(publishButton)
    try {
      publishButton.scrollIntoView({ block: 'center', inline: 'center' })
    } catch (error) {
      void error
    }
    await sleep(200)
    await clickPublish(publishButton)
    await waitFor(
      () => {
        const success =
          findByText('发布成功', { match: 'contains' }) ||
          findByText('已发布', { match: 'contains' }) ||
          queryFirstVisible('.ant-message-success') ||
          queryFirstVisible('.ant-notification-notice-success') ||
          null
        if (success) return true
        const maybeStillHasPublish = findPublishSubmitButton()
        if (!maybeStillHasPublish && !isLikelyLoginUrl(location.href)) return true
        return null
      },
      { timeoutMs: 60_000, intervalMs: 500, timeoutMessage: '发布结果未确认（可能页面结构变化或网络异常）。' }
    )
  })

  const time = new Date().toISOString()
  logPlain('[时间] 已确认发布成功。', { time })
  return { success: true, published: true, time }
}

async function publishTask(
  taskData: TaskData,
  { dryRun = false, mode = 'immediate' }: { dryRun?: boolean; mode?: PublishMode } = {}
): Promise<PublishTaskResult> {
  if (taskData?.mediaType === 'video') return publishVideoTask(taskData, { dryRun, mode })
  return runTask(taskData, { dryRun, mode })
}

function detectDraftModalRoot(): HTMLElement | null {
  const candidates = [findLeafByTextIncludes('图文笔记', document.body), findLeafByTextIncludes('视频笔记', document.body)].filter(
    (x): x is HTMLElement => Boolean(x)
  )

  const classCandidates = Array.from(
    document.querySelectorAll('[class*="draft"][class*="modal"], [class*="Draft"][class*="Modal"], [class*="draft-modal"]')
  ).filter((el): el is HTMLElement => el instanceof HTMLElement && isVisible(el))

  const picked = candidates[0] || classCandidates[0] || null
  if (!picked) return null
  return getModalRoot(picked) || picked
}

async function waitForDraftModalVisible(): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const modalRoot = detectDraftModalRoot()
      if (modalRoot) {
        clearInterval(timer)
        resolve(modalRoot)
        return
      }

      if (Date.now() - startedAt > 120_000) {
        clearInterval(timer)
        reject(new Error('[XHS] Draft modal not detected (timeout).'))
      }
    }, 500)
  })
}

async function ensureOnPublishPage(): Promise<void> {
  const url = normalizeText(location.href)
  if (url.startsWith(XHS_PUBLISH_URL)) return
  try {
    location.href = XHS_PUBLISH_URL
  } catch (error) {
    void error
  }
  await waitFor(
    () => {
      const u = normalizeText(location.href)
      if (!u.includes('/publish/publish')) return null
      const hasUpload = document.querySelector('input[type="file"]')
      return hasUpload ? true : null
    },
    { timeoutMs: 60_000, intervalMs: 250, timeoutMessage: '[XHS] Publish page not ready.' }
  )
}

async function openDraftBoxAutoOrManual(): Promise<HTMLElement> {
  try {
    await visualWaitFor('草稿箱', 15_000, document.body)
  } catch (error) {
    void error
    console.log(`[Manual Request] Could not find '草稿箱' button automatically.`)
    try {
      window.alert('🤖 Lyra: 我没找到【草稿箱】按钮。\n\n请您手动点击一下右上角的草稿箱，点击后我会自动继续！')
    } catch (error2) {
      void error2
    }
  }
  const modalRoot = await waitForDraftModalVisible()
  return modalRoot
}

async function clickDraftImageTab(modalRoot: HTMLElement): Promise<void> {
  await visualWaitFor('图文笔记', 10_000, modalRoot)
}

function findDraftListRoot(modalRoot: HTMLElement | null): HTMLElement | null {
  const base = modalRoot || document.body
  const candidates = [
    ...Array.from(base.querySelectorAll('ul, [role="list"]')),
    ...Array.from(base.querySelectorAll('[class*="list"], [class*="List"]'))
  ]
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue
    if (!isVisibleForWait(el)) continue
    if (!el.querySelector) continue
    const hasEdit = Boolean(findLeafByTextIncludes('编辑', el))
    if (hasEdit) return el
  }
  return null
}

function findScrollableListContainer(root: HTMLElement): HTMLElement {
  const candidates = Array.from(document.querySelectorAll('div, ul, section'))
  let bestContainer: HTMLElement = document.body
  let maxArea = 0

  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue

    const isScrollable =
      el.scrollHeight > el.clientHeight + 20 &&
      (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto')

    if (isScrollable) {
      const rect = el.getBoundingClientRect()
      const area = rect.width * rect.height
      if (area > maxArea && rect.height > 200 && rect.width > 300) {
        maxArea = area
        bestContainer = el
      }
    }
  }

  if (bestContainer !== document.body) {
    const cls = bestContainer.className || '(no-class)'
    logPlain(`[调试] 自动锁定主滚动容器: <${bestContainer.tagName}> .${cls.slice(0, 30)}...`)
    return bestContainer
  }

  return root
}

async function findAndClickDraftByTitle(searchScope: HTMLElement, targetTitle: string): Promise<void> {
  const scrollContainer = findScrollableListContainer(searchScope)
  const wanted = normalizeText(targetTitle)
  logStep(2, `开始精确查找草稿：${wanted}`)

  const MAX_ATTEMPTS = 20

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = Array.from(scrollContainer.querySelectorAll('*')).filter((el) => {
      if (!(el instanceof HTMLElement) || !isVisible(el)) return false
      if (el.childElementCount > 1) return false

      const text = normalizeText(el.innerText)
      if (!text) return false
      const cleanText = text.replace(/\.\.\.$|…$/, '').trim()
      return text.includes(wanted) || (cleanText.length > 4 && wanted.startsWith(cleanText))
    }) as HTMLElement[]

    logPlain(`[Debug] 扫描 #${attempt + 1}: 发现 ${candidates.length} 个标题节点`)

    for (const titleEl of candidates) {
      let cardScope: HTMLElement | null = titleEl
      let foundBtn: HTMLElement | null = null

      for (let i = 0; i < 5; i++) {
        cardScope = cardScope.parentElement
        if (!cardScope) break

        const btnCandidates = Array.from(cardScope.querySelectorAll('*')).filter((el) => {
          if (!(el instanceof HTMLElement) || !isVisible(el)) return false
          const t = normalizeText(el.innerText)
          if (!t.includes('编辑')) return false
          if (t.length > 8) return false
          return el.tagName === 'BUTTON' || el.childElementCount === 0
        })

        if (btnCandidates.length > 0) {
          foundBtn = btnCandidates[0] as HTMLElement
          break
        }
      }

      if (foundBtn) {
        logStep(2, `✅ 匹配成功！\n标题: "${titleEl.innerText}"\n按钮: <${foundBtn.tagName}> "${foundBtn.innerText}"`)

        foundBtn.scrollIntoView({ block: 'center', behavior: 'smooth' })
        await sleep(500)

        await SyncHumanizer.click(foundBtn, '目标草稿编辑按钮')
        return
      }
    }

    logPlain('[Debug] 当前屏幕未找到，向下滚动...')
    const prevTop = scrollContainer.scrollTop
    scrollContainer.scrollBy({ top: 600, behavior: 'smooth' })
    await sleep(1500)

    if (Math.abs(scrollContainer.scrollTop - prevTop) < 2) {
      logPlain('[Debug] 已滚动到底部。')
      break
    }
  }

  throw new Error(`未在草稿箱中找到标题为 "${targetTitle}" 的草稿`)
}

async function clickFirstEditInDraftModal(modalRoot: HTMLElement): Promise<void> {
  const listRoot = findDraftListRoot(modalRoot)
  await visualWaitFor('编辑', 5000, listRoot || modalRoot)
}

async function waitForEditorReady(startUrl: string): Promise<void> {
  await waitFor(
    () => {
      const url = normalizeText(location.href)
      if (url && startUrl && url !== startUrl) return true

      const hasAddProduct = Boolean(findLeafByTextIncludes('添加商品', document.body))
      const draftModal = detectDraftModalRoot()
      if (!draftModal && hasAddProduct) return true
      return null
    },
    { timeoutMs: 60_000, intervalMs: 250, timeoutMessage: '[XHS] Editor not ready after opening draft.' }
  )
}

function getPathToRoot(el: HTMLElement): string {
  const path: string[] = []
  let curr: HTMLElement | null = el
  while (curr && curr !== document.body && path.length < 5) {
    let name = curr.tagName.toLowerCase()
    if (curr.className) name += `.${curr.className.split(' ').join('.')}`
    path.push(name)
    curr = curr.parentElement
  }
  return path.join(' > ')
}

function findLca(a: HTMLElement, b: HTMLElement): { lca: HTMLElement | null; aUp: number; bUp: number } {
  const seen = new Map<HTMLElement, number>()
  let currA: HTMLElement | null = a
  let aUp = 0
  while (currA) {
    seen.set(currA, aUp)
    currA = currA.parentElement
    aUp += 1
  }

  let currB: HTMLElement | null = b
  let bUp = 0
  while (currB) {
    const hit = seen.get(currB)
    if (typeof hit === 'number') return { lca: currB, aUp: hit, bUp }
    currB = currB.parentElement
    bUp += 1
  }
  return { lca: null, aUp: -1, bUp: -1 }
}

function describeEl(el: HTMLElement | null): string {
  if (!el) return '(null)'
  const cls = typeof el.className === 'string' ? el.className : String(el.className ?? '')
  return `<${el.tagName.toLowerCase()}> class="${cls}"`
}

function distanceBetweenRects(a: DOMRect, b: DOMRect): { dx: number; dy: number; d: number } {
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  const bx = b.left + b.width / 2
  const by = b.top + b.height / 2
  const dx = bx - ax
  const dy = by - ay
  return { dx, dy, d: Math.sqrt(dx * dx + dy * dy) }
}

async function inspectDraftListStructure(modalRoot: HTMLElement, targetTitle: string): Promise<void> {
  const wanted = normalizeText(targetTitle).slice(0, 5)
  logPlain(`[探针] 开始分析 DOM 结构... 目标关键词: "${wanted}"`)

  const editBtns = Array.from(modalRoot.querySelectorAll('*')).filter(
    (el) => isVisible(el) && normalizeText((el as HTMLElement).innerText).includes('编辑')
  )
  logPlain(`[探针] 找到 ${editBtns.length} 个包含"编辑"的可见元素`)
  editBtns.forEach((btn, i) => {
    logPlain(`  [Edit #${i}] <${btn.tagName}> class="${(btn as HTMLElement).className}" | Path: ${getPathToRoot(btn as HTMLElement)}`)
  })

  const titleEls = Array.from(modalRoot.querySelectorAll('*')).filter(
    (el) => isVisible(el) && normalizeText((el as HTMLElement).innerText).includes(wanted)
  )
  logPlain(`[探针] 找到 ${titleEls.length} 个包含"${wanted}"的可见元素`)
  titleEls.forEach((el, i) => {
    logPlain(`  [Title #${i}] "${(el as HTMLElement).innerText}" | <${el.tagName}> | Path: ${getPathToRoot(el as HTMLElement)}`)
  })

  if (editBtns.length > 0 && titleEls.length > 0) {
    const firstTitle = titleEls[0] as HTMLElement
    let nearestBtn = editBtns[0] as HTMLElement
    let minDiff = 9999

    editBtns.forEach((btn) => {
      const dist = Math.abs((btn as HTMLElement).getBoundingClientRect().top - firstTitle.getBoundingClientRect().top)
      if (dist < minDiff) {
        minDiff = dist
        nearestBtn = btn as HTMLElement
      }
    })

    const titleRect = firstTitle.getBoundingClientRect()
    const btnRect = nearestBtn.getBoundingClientRect()
    const dist = distanceBetweenRects(titleRect, btnRect)
    const { lca, aUp, bUp } = findLca(firstTitle, nearestBtn)

    logPlain(`[探针] 假设匹配: Title[0] vs Edit(distTop=${Math.round(minDiff)}px)`)
    logPlain(
      `[探针] 坐标距离: centerDist=${Math.round(dist.d)}px (dx=${Math.round(dist.dx)}px, dy=${Math.round(dist.dy)}px) | titleTop=${Math.round(
        titleRect.top
      )} btnTop=${Math.round(btnRect.top)}`
    )
    logPlain(`[探针] LCA: ${describeEl(lca)} | titleUp=${aUp} editUp=${bUp} | LCA Path: ${lca ? getPathToRoot(lca) : '(null)'}`)

    firstTitle.style.border = '2px dashed orange'
    nearestBtn.style.border = '2px dashed purple'
    await sleep(5000)
  }
}

async function MapsToDraftEditor(targetTitle: string | null = null): Promise<void> {
  logStep(1, '正在进入草稿编辑页...', { targetTitle })
  await ensureOnPublishPage()
  const startUrl = normalizeText(location.href)

  const draftModalRoot = await openDraftBoxAutoOrManual()
  await clickDraftImageTab(draftModalRoot)

  logPlain('[等待] 正在等待草稿列表渲染 (3s)...')
  await sleep(3000)

  if (targetTitle) {
    logPlain('[调试] 启动全局搜索模式 (Scope: document.body)...')
    await findAndClickDraftByTitle(document.body, targetTitle)
  } else {
    logPlain('[提示] 未提供标题，默认点击第一个草稿')
    await clickFirstEditInDraftModal(draftModalRoot)
  }

  await waitForEditorReady(startUrl)
}


async function publishDraftByTitle(title: string, dryRun = true): Promise<RunTaskResult> {
  const normalizedTitle = normalizeText(title)

  logStep(0, '准备发布草稿（通过共享导航逻辑）', { title: normalizedTitle || '', dryRun })

  await MapsToDraftEditor(normalizedTitle)

  const publishButton = await waitFor(() => findPublishSubmitButton(), {
    timeoutMs: 60_000,
    intervalMs: 250,
    timeoutMessage: '未找到发布按钮（可能页面结构变化）。'
  })

  highlightWithRedBorder(publishButton)

  if (dryRun) {
    logPlain('[模拟成功] 定时/立即发布：已定位发布按钮（干跑模式，未点击）。')
    return { success: true, published: false }
  }

  logPlain('已定位发布按钮，准备点击...')
  await SyncHumanizer.click(publishButton, '发布按钮 (Publish Button)')

  await waitFor(
    () => {
      const success =
        findByText('发布成功', { match: 'contains' }) ||
        findByText('已发布', { match: 'contains' }) ||
        queryFirstVisible('.ant-message-success') ||
        null
      if (success) return true
      const maybeStillHasPublish = findPublishSubmitButton()
      if (!maybeStillHasPublish && !isLikelyLoginUrl(location.href)) return true
      return null
    },
    { timeoutMs: 60_000, intervalMs: 500, timeoutMessage: '发布结果未确认（可能页面结构变化或网络异常）。' }
  )

  logPlain('草稿发布流程结束。')
  return { success: true, published: true, time: new Date().toISOString() }
}

async function handlePublishDraft(payload: unknown): Promise<RunTaskResult> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const title = typeof record.title === 'string' ? record.title : String(record.title ?? '')
  const dryRun = record.dryRun === false ? false : true
  return publishDraftByTitle(title, dryRun)
}

ipcRenderer.on('publisher:task', async (_event, payload: unknown) => {
  const taskId = payload && typeof payload === 'object' ? (payload as { taskId?: unknown }).taskId : null
  if (typeof taskId !== 'string' || !taskId) return

  try {
    logStep(0, '收到任务指令', { taskId })
    const type = payload && typeof payload === 'object' ? (payload as { type?: unknown }).type : undefined
    if (type === 'publish_draft') {
      const result = await handlePublishDraft(payload)
      ipcRenderer.send('publisher:result', { taskId, ok: true, success: true, published: result.published, time: result.time })
      return
    }

    const taskData = payload && typeof payload === 'object' ? (payload as { taskData?: unknown }).taskData : null
    const dryRun = payload && typeof payload === 'object' ? (payload as { dryRun?: unknown }).dryRun : false
    let mode = payload && typeof payload === 'object' ? (payload as { mode?: unknown }).mode : undefined
    if (!mode && taskData && typeof taskData === 'object') {
      mode = (taskData as { publishMode?: unknown }).publishMode
    }
    logStep(0, '接收任务参数', { taskId, mode: mode || 'default(immediate)', originMode: (taskData as any)?.publishMode })
    const result = await publishTask(taskData as TaskData, {
      dryRun: dryRun === true,
      mode: 'immediate'
    })
    ipcRenderer.send('publisher:result', { taskId, ok: true, success: true, published: result.published, time: result.time })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ipcRenderer.send('publisher:result', { taskId, ok: false, success: false, error: message })
  }
})

contextBridge.exposeInMainWorld('__xhsAutomation', {
  publish: async (taskData: unknown) => {
    try {
      logStep(0, '主世界调用 publish()')
      const result = await publishTask(taskData as TaskData)
      return { ok: true, published: result.published, time: result.time }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  },
  publishDraftByTitle: async (title: unknown, dryRun: unknown = true) => {
    try {
      logStep(0, '主世界调用 publishDraftByTitle()')
      const result = await publishDraftByTitle(typeof title === 'string' ? title : String(title ?? ''), dryRun === false ? false : true)
      return { ok: true, published: result.published, time: result.time }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  }
})

export { inspectDraftListStructure }
