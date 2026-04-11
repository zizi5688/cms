import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import type { Browser, CDPSession, Page } from 'puppeteer'
import type { CmsPublishSafetyCheck } from '../shared/cmsChromeProfileTypes'

import {
  checkCreatorLogin,
  prepareStealthPage,
  setChromeWindowMode,
  type ChromeWindowMode
} from './chrome-launcher.ts'
import { humanClick, type MouseState } from './human-input.ts'

/**
 * CDP parity progress against src/main/preload/xhs-automation.ts
 * [x] Step 1: video upload (robustVideoUpload + checkVideoReady)
 * [x] Step 2: title/content/topics
 * [x] Step 3: cover modal full close-loop
 * [~] Step 4: product binding (flow ported; live validation currently blocked by missing 商品/组件入口 on cms-profile-2)
 * [x] Step 5: publish pre-check + dryRun highlight + guarded real click/retry
 * [ ] Step 6: draft publish flow
 */

const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'

type EditorTarget = {
  found: boolean
  selector: string
  centerX: number
  centerY: number
  tagName: string
  isContentEditable: boolean
  isTextInput: boolean
}

type UploadTarget = {
  found: boolean
  selector: string
}

type SelectorViewportSnapshot = {
  found: boolean
  selector: string
  centerX: number
  centerY: number
  tagName: string
  rect: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }
  viewport: {
    width: number
    height: number
  }
}

type SafetyEventRecord = {
  type: string
  isTrusted: boolean
  timestamp?: number
  x?: number
  y?: number
}

type SafetyDetectionProbeResult = {
  isTrusted: boolean
  webdriver: boolean
  hasProcess: boolean
  headless: boolean
}

export type CdpPublishTaskInput = {
  title?: string
  content?: string
  tags?: string[]
  mediaType?: 'image' | 'video'
  videoPath?: string
  videoCoverMode?: 'auto' | 'manual'
  images?: string[]
  productId?: string
  productName?: string
  linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
}

export type CdpPublishRunOptions = {
  browser: Browser
  task: CdpPublishTaskInput
  workspacePath?: string
  dryRun?: boolean
  windowMode?: ChromeWindowMode
  onLog?: (message: string) => void
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? '').trim())
}

function isAbsoluteFilePath(value: string): boolean {
  const normalized = String(value ?? '').trim()
  if (!normalized) return false
  if (isWindowsAbsolutePath(normalized)) return true
  return isAbsolute(normalized)
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function jitterDelay(minMs = 2000, maxMs = 5000): Promise<void> {
  const ms = randomInt(minMs, maxMs)
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function gaussianRandom(mean: number, standardDeviation: number): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  return z * standardDeviation + mean
}

function gaussianDuration(minMs: number, meanMs: number, maxMs: number): number {
  const spread = Math.max((maxMs - minMs) / 6, 1)
  const sampled = gaussianRandom(meanMs, spread)
  return Math.max(minMs, Math.min(maxMs, Math.round(sampled)))
}

async function observationDelay(
  minMs: number,
  meanMs: number,
  maxMs: number,
  onLog?: (message: string) => void,
  label?: string
): Promise<number> {
  const duration = gaussianDuration(minMs, meanMs, maxMs)
  if (label) {
    logLine(onLog, `${label}：等待 ${duration}ms`)
  }
  await new Promise((resolve) => setTimeout(resolve, duration))
  return duration
}

function logLine(onLog: ((message: string) => void) | undefined, message: string): void {
  onLog?.(message)
}

type CoverModalUploadSnapshot = {
  text: string
  imageSources: string[]
  selectedFileCount: number
  fileValues: string[]
}

type SelectCoverOptions = {
  onLog?: (message: string) => void
}

async function waitForCondition<T>(
  producer: () => Promise<T | null>,
  timeoutMs: number,
  intervalMs: number,
  errorMessage: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let value: T | null = null
    try {
      value = await producer()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const recoverable =
        message.includes('Execution context was destroyed') ||
        message.includes('Attempted to use detached Frame') ||
        message.includes('Cannot find context with specified id')
      if (!recoverable) {
        throw error
      }
    }
    if (value !== null) return value
    await jitterDelay(intervalMs, intervalMs + 80)
  }
  throw new Error(errorMessage)
}

async function installSafetyEventLog(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(() => {
    const win = window as typeof window & {
      __cmsSafetyEventLog?: unknown[]
      __cmsSafetyEventLogInstalled?: boolean
    }

    const pushEntry = (entry: unknown) => {
      if (!Array.isArray(win.__cmsSafetyEventLog)) {
        win.__cmsSafetyEventLog = []
      }
      win.__cmsSafetyEventLog.push(entry)
    }

    if (!win.__cmsSafetyEventLogInstalled) {
      document.addEventListener(
        'mousemove',
        (event) => {
          pushEntry({
            type: 'mousemove',
            isTrusted: event.isTrusted,
            timestamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY
          })
        },
        true
      )
      document.addEventListener(
        'mousedown',
        (event) => {
          pushEntry({
            type: 'mousedown',
            isTrusted: event.isTrusted,
            timestamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY
          })
        },
        true
      )
      document.addEventListener(
        'click',
        (event) => {
          pushEntry({
            type: 'click',
            isTrusted: event.isTrusted,
            timestamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY
          })
        },
        true
      )
      win.__cmsSafetyEventLogInstalled = true
    }

    win.__cmsSafetyEventLog = []
  })

  await page.evaluate(() => {
    const win = window as typeof window & {
      __cmsSafetyEventLog?: unknown[]
      __cmsSafetyEventLogInstalled?: boolean
    }

    const pushEntry = (entry: unknown) => {
      if (!Array.isArray(win.__cmsSafetyEventLog)) {
        win.__cmsSafetyEventLog = []
      }
      win.__cmsSafetyEventLog.push(entry)
    }

    if (!win.__cmsSafetyEventLogInstalled) {
      document.addEventListener(
        'mousemove',
        (event) => {
          pushEntry({
            type: 'mousemove',
            isTrusted: event.isTrusted,
            timestamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY
          })
        },
        true
      )
      document.addEventListener(
        'mousedown',
        (event) => {
          pushEntry({
            type: 'mousedown',
            isTrusted: event.isTrusted,
            timestamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY
          })
        },
        true
      )
      document.addEventListener(
        'click',
        (event) => {
          pushEntry({
            type: 'click',
            isTrusted: event.isTrusted,
            timestamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY
          })
        },
        true
      )
      win.__cmsSafetyEventLogInstalled = true
    }

    win.__cmsSafetyEventLog = []
  })
}

async function readSafetyEventLog(page: Page): Promise<SafetyEventRecord[]> {
  return page.evaluate(() => {
    return ((window as typeof window & { __cmsSafetyEventLog?: unknown[] }).__cmsSafetyEventLog ?? []) as SafetyEventRecord[]
  })
}

async function runSafetyDetectionProbe(page: Page, client: CDPSession): Promise<SafetyDetectionProbeResult> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __cmsSafetyDetectionTrusted?: boolean | null
      __cmsSafetyDetectionInstalled?: boolean
      process?: unknown
    }

    if (!win.__cmsSafetyDetectionInstalled) {
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target
          if (target instanceof HTMLElement && target.dataset.cmsSafetyDetectionProbe === 'true') {
            win.__cmsSafetyDetectionTrusted = event.isTrusted
          }
        },
        true
      )
      win.__cmsSafetyDetectionInstalled = true
    }

    win.__cmsSafetyDetectionTrusted = null
    document.querySelector('[data-cms-safety-detection-probe="true"]')?.remove()

    const probe = document.createElement('button')
    probe.type = 'button'
    probe.dataset.cmsSafetyDetectionProbe = 'true'
    probe.setAttribute('data-cms-safety-detection-probe', 'true')
    probe.textContent = 'Safety Detection Probe'
    probe.style.position = 'fixed'
    probe.style.right = '24px'
    probe.style.bottom = '24px'
    probe.style.width = '160px'
    probe.style.height = '40px'
    probe.style.zIndex = '2147483647'
    probe.style.opacity = '0.01'
    probe.style.pointerEvents = 'auto'
    probe.style.background = '#111827'
    probe.style.color = '#111827'
    probe.style.border = '0'
    document.body.appendChild(probe)
  })

  const target = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('[data-cms-safety-detection-probe="true"]')
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    }
  })

  if (!target) {
    throw new Error('未找到安全检测探针')
  }

  await humanClick(client, { x: 40, y: 40 }, target.centerX, target.centerY)
  await jitterDelay(220, 320)

  return page.evaluate(() => {
    const win = window as typeof window & {
      __cmsSafetyDetectionTrusted?: boolean | null
      process?: unknown
    }

    return {
      isTrusted: win.__cmsSafetyDetectionTrusted === true,
      webdriver: Boolean(navigator.webdriver),
      hasProcess: typeof win.process !== 'undefined',
      headless: /HeadlessChrome/i.test(navigator.userAgent)
    }
  })
}

async function tryCollectSafetyCheck(
  page: Page,
  client: CDPSession,
  onLog?: (message: string) => void
): Promise<CmsPublishSafetyCheck | undefined> {
  try {
    const eventLog = await readSafetyEventLog(page)
    const mouseMoveCount = eventLog.filter((event) => event.type === 'mousemove').length
    const detection = await runSafetyDetectionProbe(page, client)
    return {
      isTrusted: detection.isTrusted,
      webdriver: detection.webdriver,
      hasProcess: detection.hasProcess,
      mouseMoveCount,
      headless: detection.headless,
      allPassed:
        detection.isTrusted &&
        detection.webdriver === false &&
        detection.hasProcess === false &&
        mouseMoveCount >= 15 &&
        detection.headless === false
    }
  } catch (error) {
    logLine(onLog, `[安全检测] 采集失败：${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function normalizeTagList(content: string): string[] {
  const fullText = String(content ?? '')
  const out: string[] = []
  const seen = new Set<string>()
  const tagRegex = /#([^#\s]+)/g
  let match: RegExpExecArray | null = null
  while ((match = tagRegex.exec(fullText)) !== null) {
    const tag = String(match[1] ?? '').trim().replace(/^#+/, '')
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

function normalizeExplicitTags(raw: unknown): string[] {
  if (!raw) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const tag = String(item ?? '').trim().replace(/^#+/, '')
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

function hasProductBinding(task: CdpPublishTaskInput): boolean {
  const linked = Array.isArray(task.linkedProducts) ? task.linkedProducts : []
  return linked.length > 0 || Boolean(String(task.productId ?? '').trim()) || Boolean(String(task.productName ?? '').trim())
}

function resolveUploadFilePath(filePath: string, workspacePath?: string): string {
  const raw = String(filePath ?? '').trim()
  if (!raw) throw new Error('上传文件路径为空')
  if (isHttpUrl(raw)) throw new Error(`不支持上传网络文件: ${raw}`)

  const normalized = raw.replace(/\\/g, '/')
  const resolvedPath = isAbsoluteFilePath(raw)
    ? resolve(raw)
    : workspacePath
      ? join(workspacePath, normalized.replace(/^\/+/, ''))
      : resolve(raw)

  if (!existsSync(resolvedPath)) {
    throw new Error(`待上传文件不存在: ${raw}`)
  }

  return resolvedPath
}

async function markVideoUploadInput(page: Page, mediaType: 'image' | 'video'): Promise<UploadTarget> {
  return page.evaluate((kind) => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    const scoreInput = (input: HTMLInputElement, index: number): number => {
      const attrs = [
        input.accept,
        input.name,
        input.id,
        input.className,
        input.getAttribute('capture') ?? ''
      ]
        .join(' ')
        .toLowerCase()

      let score = 0
      if (kind === 'video') {
        if (attrs.includes('video')) score += 10
        if (attrs.includes('mp4') || attrs.includes('mov')) score += 5
        if (input.multiple) score += 1
      } else {
        if (attrs.includes('image')) score += 10
        if (attrs.includes('png') || attrs.includes('jpg') || attrs.includes('jpeg') || attrs.includes('webp')) {
          score += 5
        }
        if (input.multiple) score += 3
      }
      score -= index
      return score
    }

    const ranked = inputs
      .map((input, index) => ({ input, score: scoreInput(input, index) }))
      .sort((a, b) => b.score - a.score)
    const target = ranked[0]?.input
    if (!target) return { found: false, selector: '' }
    target.setAttribute('data-cms-cdp-upload-target', kind)
    return {
      found: true,
      selector: `input[type="file"][data-cms-cdp-upload-target="${kind}"]`
    }
  }, mediaType)
}

async function queryNodeIdBySelector(client: CDPSession, selector: string): Promise<number> {
  const documentNode = await client.send('DOM.getDocument', { depth: 2 })
  const result = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  return result.nodeId
}

async function setFilesWithCdp(
  client: CDPSession,
  selector: string,
  files: string[]
): Promise<void> {
  const nodeId = await queryNodeIdBySelector(client, selector)
  if (!nodeId) throw new Error(`未能定位上传元素: ${selector}`)
  await client.send('DOM.setFileInputFiles', { nodeId, files })
  await jitterDelay(1000, 1500)
}

async function dispatchFileInputEvents(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const input = document.querySelector<HTMLInputElement>(targetSelector)
    if (!input) return
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector)
}

async function waitForUploadReady(page: Page, mediaType: 'image' | 'video', expectedCount: number): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await page.evaluate((kind, expectedUploads) => {
      const pageText = document.body?.innerText ?? ''
      const hasUploadingText = /上传中|处理中|转码中|上传失败/.test(pageText)
      if (kind === 'video') {
        return {
          ready:
            Boolean(
              document.querySelector(
                '.d-input input[type="text"], .d-input input:not([type]), .tiptap.ProseMirror[contenteditable="true"]'
              )
            ) &&
            (document.querySelectorAll('video').length > 0 ||
              /重新上传|更换视频|替换视频|裁剪封面/.test(pageText)),
          hasUploadingText
        }
      }

      const imagePreviewCount = document.querySelectorAll(
        'img, [class*="upload"] [class*="item"], [class*="dragger"] [class*="item"]'
      ).length
      return {
        ready: imagePreviewCount >= expectedUploads && !hasUploadingText,
        hasUploadingText
      }
    }, mediaType, expectedCount)

    if (state.ready && !state.hasUploadingText) {
      return
    }
    await jitterDelay(1500, 2200)
  }

  throw new Error(mediaType === 'video' ? '视频上传后编辑器未就绪' : '图片上传结果未就绪')
}

async function waitForPublishPageReady(page: Page): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate(() => {
        const isVisible = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false
          const style = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 24 && rect.height > 18
        }

        const hasSidebar = Array.from(document.querySelectorAll<HTMLElement>('div, span, a, button')).some((element) => {
          if (!isVisible(element)) return false
          const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
          return text.includes('发布笔记')
        })

        const hasMainSignal =
          Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).length > 0 ||
          Array.from(document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], div, span, button')).some((element) => {
            if (!isVisible(element)) return false
            const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
            return text.includes('上传视频') || text.includes('上传图文')
          })

        return hasSidebar || hasMainSignal ? true : null
      }),
    60_000,
    250,
    '发布页面未就绪（可能未登录或页面加载异常）。'
  )
}

async function markImageUploadTab(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: Element | null): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const intersectsViewport =
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 20 &&
        rect.height > 18 &&
        intersectsViewport
      )
    }

    const textNodes = Array.from(document.querySelectorAll<HTMLElement>('button, [role="tab"], [role="button"], a, div, span'))
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        if (text !== '上传图文') return null
        const clickable =
          (element.closest('.creator-tab, button, [role="tab"], [role="button"], a, div[tabindex], span[tabindex]') as HTMLElement | null) || element
        if (!isVisible(clickable)) return null
        const rect = clickable.getBoundingClientRect()
        const className = `${element.className ?? ''} ${clickable.className ?? ''}`.toLowerCase()
        let score = 0
        if (clickable.getAttribute('role') === 'tab') score += 20
        if (className.includes('creator-tab')) score += 18
        if (className.includes('tab')) score += 12
        if (className.includes('upload')) score += 8
        score -= index
        return { clickable, rect, score }
      })
      .filter((item): item is { clickable: HTMLElement; rect: DOMRect; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score)

    const match = textNodes[0]
    if (!match) return null
    match.clickable.setAttribute('data-cms-cdp-image-upload-tab', 'true')
    return {
      found: true,
      selector: '[data-cms-cdp-image-upload-tab="true"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.clickable.tagName,
      isContentEditable: false,
      isTextInput: false
    }
  })

  return (
    target ?? {
      found: false,
      selector: '',
      centerX: 0,
      centerY: 0,
      tagName: '',
      isContentEditable: false,
      isTextInput: false
    }
  )
}

async function waitForImageUploadTab(page: Page): Promise<EditorTarget> {
  return waitForCondition(
    async () => {
      const target = await markImageUploadTab(page)
      return target.found ? target : null
    },
    10_000,
    250,
    '未找到“上传图文”入口（可能页面结构变化）。'
  )
}

async function waitForImageUploadSurface(page: Page): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate(() => {
        const isVisible = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false
          const style = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 120 && rect.height >= 60
        }

        const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
        const imageInput = fileInputs.find((element) => {
          const accept = String(element.getAttribute('accept') || '').toLowerCase()
          if (!accept) return false
          if (accept.includes('video')) return false
          return accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp')
        })

        if (imageInput) {
          const container =
            imageInput.closest('.upload-dragger') ||
            imageInput.closest('[class*="upload"]') ||
            imageInput.closest('div,section,main,form') ||
            imageInput.parentElement
          if (container && isVisible(container)) return true
        }

        const hints = ['拖拽图片', '点击上传', '上传图片', '上传图文']
        const hasHint = Array.from(document.querySelectorAll<HTMLElement>('div, span, button, p')).some((element) => {
          if (!isVisible(element)) return false
          const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
          return hints.some((hint) => text.includes(hint))
        })

        return hasHint ? true : null
      }),
    20_000,
    250,
    '未检测到图文上传界面（可能页面结构变化）。'
  )
}

async function switchToImageUploadTab(page: Page, client: CDPSession): Promise<void> {
  await waitForPublishPageReady(page)
  const tab = await waitForImageUploadTab(page)
  const clickable = await ensureSelectorReachableForMouse(page, client, tab.selector)
  if (!clickable.found) {
    throw new Error('未找到“上传图文”入口（可能页面结构变化）。')
  }
  await humanClick(client, { x: 40, y: 40 }, clickable.centerX, clickable.centerY)
  await waitForImageUploadSurface(page)
  await jitterDelay(420, 620)
}

async function waitForVideoUploadInput(page: Page): Promise<UploadTarget> {
  return waitForCondition(
    async () => {
      const target = await markVideoUploadInput(page, 'video')
      return target.found ? target : null
    },
    20_000,
    250,
    '未找到视频上传 input（可能页面结构变化）。'
  )
}

type VideoReadySnapshot = {
  hasFailureText: boolean
  failureText: string
  hasIndicator: boolean
  indicatorText: string
  hasPublishButton: boolean
  publishDisabled: boolean
  publishLoading: boolean
  publishText: string
  videoCount: number
  pageTextSignals: string[]
}

async function readVideoReadySnapshot(page: Page): Promise<VideoReadySnapshot> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 20 && rect.height >= 20
    }
    const parseRgb = (value: string): { r: number; g: number; b: number } | null => {
      const match = String(value ?? '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
      if (!match) return null
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
    }
    const isLikelyRedButton = (element: HTMLElement): boolean => {
      const rgb = parseRgb(window.getComputedStyle(element).backgroundColor || '')
      return Boolean(rgb && rgb.r >= 170 && rgb.g <= 120 && rgb.b <= 120)
    }
    const isDisabledLike = (element: HTMLElement): boolean => {
      const anyElement = element as HTMLElement & { disabled?: boolean }
      return (
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('disabled') !== null ||
        anyElement.disabled === true
      )
    }

    const fullText = normalizeText(document.body?.innerText || document.body?.textContent || '')
    const failureMatch = ['上传失败', '失败', '请重试'].find((text) => fullText.includes(text)) ?? ''

    const indicatorTexts = ['检测为高清视频', '检测为清晰视频']
    const indicatorText =
      indicatorTexts.find((text) =>
        Array.from(document.querySelectorAll<HTMLElement>('div, span, p, strong')).some(
          (element) => isVisible(element) && normalizeText(element.innerText || element.textContent || '').includes(text)
        )
      ) ?? ''

    const rawDirectButton =
      (document.querySelector('#publish-container .publish-btn') as HTMLElement | null) ||
      (document.querySelector('#publish-container button.publish-btn') as HTMLElement | null) ||
      (document.querySelector('#publish-container button') as HTMLElement | null) ||
      (document.querySelector('button.publish-btn') as HTMLElement | null) ||
      null
    const directButton =
      rawDirectButton && isVisible(rawDirectButton)
        ? ((rawDirectButton.closest('button') as HTMLElement | null) || rawDirectButton)
        : null

    let bestButton: HTMLElement | null = null
    let bestScore = Number.NEGATIVE_INFINITY

    const candidates = Array.from(document.querySelectorAll('button')).filter(
      (element): element is HTMLButtonElement => element instanceof HTMLButtonElement && isVisible(element)
    )
    for (const button of candidates) {
      const text = normalizeText(button.innerText || button.textContent || '')
      if (!text || !text.includes('发布')) continue
      if (text.includes('定时') || text.includes('计划') || text.includes('草稿')) continue
      if (button.closest('[role="radio"], [role="radiogroup"], label')) continue
      const rect = button.getBoundingClientRect()
      if (rect.width < 72 || rect.height < 28) continue

      const className = typeof button.className === 'string' ? button.className : ''
      let score = 0
      if (text === '发布') score += 2000
      else if (text.includes('发布')) score += 800
      if (className.includes('publish') || className.includes('Publish')) score += 400
      if (className.includes('primary') || className.includes('Primary') || className.includes('ant-btn-primary')) {
        score += 250
      }
      if (isLikelyRedButton(button)) score += 600
      if (!isDisabledLike(button)) score += 200
      score += Math.min(200, rect.width * rect.height * 0.01)
      score += Math.max(0, 1200 - rect.top) * 0.01
      if (button.closest('#publish-container')) score += 500

      if (score > bestScore) {
        bestScore = score
        bestButton = button
      }
    }

    const publishButton =
      (directButton && isVisible(directButton) ? (directButton.closest('button') as HTMLElement | null) || directButton : null) ||
      bestButton

    const publishText = publishButton ? normalizeText(publishButton.innerText || publishButton.textContent || '') : ''
    const publishClassName = publishButton && typeof publishButton.className === 'string' ? publishButton.className : ''
    const publishDisabled = publishButton ? isDisabledLike(publishButton) : true
    const publishLoading = publishButton ? publishClassName.includes('loading') || publishClassName.includes('ant-btn-loading') : false

    const pageTextSignals = [
      '重新上传',
      '更换视频',
      '替换视频',
      '裁剪封面',
      '设置封面'
    ].filter((text) => fullText.includes(text))

    return {
      hasFailureText: Boolean(failureMatch),
      failureText: failureMatch,
      hasIndicator: Boolean(indicatorText),
      indicatorText,
      hasPublishButton: Boolean(publishButton),
      publishDisabled,
      publishLoading,
      publishText,
      videoCount: document.querySelectorAll('video').length,
      pageTextSignals
    }
  })
}

export async function robustVideoUpload(page: Page, client: CDPSession, filePath: string): Promise<true> {
  const target = await waitForVideoUploadInput(page)
  await setFilesWithCdp(client, target.selector, [filePath])
  await dispatchFileInputEvents(page, target.selector)
  return true
}

export async function checkVideoReady(
  page: Page,
  options?: { onLog?: (message: string) => void }
): Promise<void> {
  const startedAt = Date.now()
  const timeoutMs = 120_000
  const intervalMs = 2_000

  while (Date.now() - startedAt <= timeoutMs) {
    const snapshot = await readVideoReadySnapshot(page)

    if (snapshot.hasFailureText) {
      throw new Error(`视频上传失败：检测到“${snapshot.failureText}”提示。`)
    }

    if (snapshot.hasIndicator && snapshot.hasPublishButton && !snapshot.publishDisabled) {
      logLine(
        options?.onLog,
        `[视频就绪] 检测到视频清晰度提示（${snapshot.indicatorText}），发布按钮已可用。`
      )
      return
    }

    if (snapshot.hasPublishButton && !snapshot.publishDisabled) {
      logLine(options?.onLog, '[视频就绪] 发布按钮已可用（未检测到清晰度提示，继续尝试发布）。')
      return
    }

    logLine(
      options?.onLog,
      `[视频就绪] 尚未就绪，等待 2 秒后重试... ${JSON.stringify({
        hasIndicator: snapshot.hasIndicator,
        indicatorText: snapshot.indicatorText,
        hasPublishButton: snapshot.hasPublishButton,
        publishDisabled: snapshot.publishDisabled,
        publishLoading: snapshot.publishLoading,
        publishText: snapshot.publishText,
        videoCount: snapshot.videoCount,
        pageTextSignals: snapshot.pageTextSignals
      })}`
    )
    await jitterDelay(intervalMs, intervalMs + 120)
  }

  throw new Error('视频上传未就绪：120 秒内未检测到“清晰度提示”且发布按钮仍不可用。')
}

async function markTitleEditor(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 18
    }

    const selectors = [
      'input[placeholder*="填写标题"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      'input[aria-label*="标题"]',
      'textarea[aria-label*="标题"]',
      'div.title-input input',
      'div.title-input textarea',
      'div.title-input [contenteditable="true"]',
      'div.title-input'
    ]

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      .map((rawElement, index) => {
        const element =
          rawElement.matches('input, textarea, [contenteditable="true"]')
            ? rawElement
            : rawElement.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]') ?? rawElement
        if (!isVisible(element)) return null

        const rect = element.getBoundingClientRect()
        const text = normalizeText(
          [
            element.getAttribute('placeholder') ?? '',
            element.getAttribute('aria-label') ?? '',
            element.className ?? '',
            element.parentElement?.className ?? '',
            rawElement.className ?? ''
          ].join(' ')
        )
        let score = 0
        if (text.includes('标题')) score += 20
        if (element.closest('.d-input')) score += 10
        if (element.closest('.title-input')) score += 10
        if (rect.width >= 320) score += 5
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') score += 3
        return { element, index, score, rect }
      })
      .filter((item): item is { element: HTMLElement; index: number; score: number; rect: DOMRect } => Boolean(item))
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cdp-editor-target', 'title')
    return {
      found: true,
      selector: '[data-cms-cdp-editor-target="title"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.element.tagName,
      isContentEditable: match.element.getAttribute('contenteditable') === 'true',
      isTextInput: match.element instanceof HTMLInputElement || match.element instanceof HTMLTextAreaElement
    }
  })

  if (target) return target
  return markEditorByKeywords(page, 'title', ['标题', '请输入标题', '填写标题'])
}

async function markBodyEditor(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 18
    }

    const selectors = [
      'textarea[placeholder*="正文"]',
      'textarea[placeholder*="内容"]',
      'textarea[aria-label*="正文"]',
      'textarea[aria-label*="内容"]',
      '.editor-content .tiptap.ProseMirror[contenteditable="true"]',
      '.tiptap.ProseMirror[contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"]'
    ]

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        const raw = [
          element.getAttribute('placeholder') ?? '',
          element.getAttribute('aria-label') ?? '',
          element.getAttribute('data-placeholder') ?? '',
          element.className ?? '',
          element.id ?? ''
        ]
          .join(' ')
          .toLowerCase()
        let score = 0
        if (raw.includes('正文') || raw.includes('内容') || raw.includes('描述')) score += 20
        if (element.className.includes('ProseMirror')) score += 18
        if (element.getAttribute('contenteditable') === 'true') score += 8
        if (element.tagName === 'TEXTAREA') score += 5
        return { element, index, score, rect }
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cdp-editor-target', 'body')
    return {
      found: true,
      selector: '[data-cms-cdp-editor-target="body"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.element.tagName,
      isContentEditable: match.element.getAttribute('contenteditable') === 'true',
      isTextInput: match.element instanceof HTMLInputElement || match.element instanceof HTMLTextAreaElement
    }
  })

  if (target) return target
  return markEditorByKeywords(page, 'body', ['正文', '内容', '描述', '添加正文', '输入正文'])
}

async function markEditorByKeywords(
  page: Page,
  kind: 'title' | 'body',
  keywords: string[]
): Promise<EditorTarget> {
  const target = await page.evaluate(
    ({ targetKind, targetKeywords }) => {
      const selectors = [
        'textarea',
        'input[type="text"]',
        'input:not([type])',
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]'
      ]

      const isVisible = (element: HTMLElement | null): element is HTMLElement => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 18
      }

      const scoreElement = (element: HTMLElement): number => {
        const raw = [
          element.getAttribute('placeholder') ?? '',
          element.getAttribute('aria-label') ?? '',
          element.getAttribute('data-placeholder') ?? '',
          element.textContent ?? '',
          element.className ?? '',
          element.id ?? '',
          element.parentElement?.className ?? '',
          element.parentElement?.textContent ?? ''
        ].join(' ')
        const text = raw.toLowerCase()
        let score = 0
        for (const keyword of targetKeywords) {
          if (text.includes(String(keyword).toLowerCase())) score += 10
        }
        if (element.tagName === 'TEXTAREA') score += 3
        if (element.getAttribute('contenteditable')) score += 2
        return score
      }

      const candidates = selectors
        .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
        .filter((element) => isVisible(element))
        .map((element, index) => ({ element, index, score: scoreElement(element) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)

      const match = candidates[0]?.element
      if (!match) return null

      match.setAttribute('data-cms-cdp-editor-target', targetKind)
      const rect = match.getBoundingClientRect()
      return {
        found: true,
        selector: `[data-cms-cdp-editor-target="${targetKind}"]`,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        tagName: match.tagName,
        isContentEditable: match.getAttribute('contenteditable') === 'true',
        isTextInput: match instanceof HTMLInputElement || match instanceof HTMLTextAreaElement
      }
    },
    { targetKind: kind, targetKeywords: keywords }
  )

  return (
    target ?? {
      found: false,
      selector: '',
      centerX: 0,
      centerY: 0,
      tagName: '',
      isContentEditable: false,
      isTextInput: false
    }
  )
}

async function focusSelectorWithCdp(client: CDPSession, selector: string): Promise<void> {
  const nodeId = await queryNodeIdBySelector(client, selector)
  if (!nodeId) return
  await client.send('DOM.focus', { nodeId })
}

async function isTargetFocused(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    const active = document.activeElement as HTMLElement | null
    if (!target || !active) return false
    return active === target || target.contains(active)
  }, selector)
}

async function focusEditorTarget(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  target: EditorTarget
): Promise<MouseState> {
  const nextMouse = await humanClick(client, mouse, target.centerX, target.centerY)
  await jitterDelay(120, 220)
  if (await isTargetFocused(page, target.selector)) return nextMouse
  await focusSelectorWithCdp(client, target.selector)
  await jitterDelay(80, 140)
  if (await isTargetFocused(page, target.selector)) return nextMouse
  await page.evaluate((selector) => {
    const element = document.querySelector<HTMLElement>(selector)
    element?.focus()
  }, target.selector)
  await jitterDelay(80, 140)
  return nextMouse
}

async function dispatchReactInputEvents(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector)
}

async function clearEditor(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return

    const dispatchEvents = (element: HTMLElement) => {
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.focus()
      target.value = ''
      dispatchEvents(target)
      return
    }

    if (target.getAttribute('contenteditable') === 'true') {
      target.focus()
      target.textContent = ''
      dispatchEvents(target)
      return
    }

    const inner = target.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')
    if (!inner) return
    if (inner instanceof HTMLInputElement || inner instanceof HTMLTextAreaElement) {
      inner.focus()
      inner.value = ''
      dispatchEvents(inner)
      return
    }
    inner.focus()
    inner.textContent = ''
    dispatchEvents(inner)
  }, selector)
}

async function moveCaretToEnd(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return
    target.focus()

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const len = target.value?.length ?? 0
      try {
        target.setSelectionRange(len, len)
      } catch (error) {
        void error
      }
      return
    }

    if (target.getAttribute('contenteditable') !== 'true') return

    try {
      const range = document.createRange()
      range.selectNodeContents(target)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    } catch (error) {
      void error
    }
  }, selector)
}

async function readEditorText(page: Page, selector: string): Promise<string> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return ''

    const descendants = Array.from(target.querySelectorAll<HTMLElement>('[contenteditable], input, textarea, [role="textbox"]'))
    const descendantText = descendants
      .flatMap((element) => {
        const value = (element as HTMLInputElement | HTMLTextAreaElement).value
        return [value, element.innerText, element.textContent].filter(Boolean)
      })
      .join('\n')
    const value = (target as HTMLInputElement | HTMLTextAreaElement).value
    return [value, target.innerText, target.textContent, descendantText].filter(Boolean).join('\n')
  }, selector)
}

async function verifyEditorContains(page: Page, selector: string, expectedText: string): Promise<boolean> {
  const normalizeComparableText = (value: string): string =>
    String(value ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s+/g, ' ')
      .trim()

  const combined = await readEditorText(page, selector)
  return normalizeComparableText(combined).includes(normalizeComparableText(expectedText))
}

async function insertTextByDomFallback(page: Page, selector: string, text: string): Promise<void> {
  await page.evaluate(
    ({ targetSelector, nextText }) => {
      const target = document.querySelector<HTMLElement>(targetSelector)
      if (!target) return
      target.focus()

      const dispatchEvents = (element: HTMLElement) => {
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      }

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length
        const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start
        try {
          target.setRangeText(nextText, start, end, 'end')
        } catch (error) {
          const before = target.value.slice(0, start)
          const after = target.value.slice(end)
          target.value = `${before}${nextText}${after}`
        }
        dispatchEvents(target)
        return
      }

      if (target.getAttribute('contenteditable') === 'true') {
        try {
          document.execCommand('insertText', false, nextText)
        } catch (error) {
          target.textContent = `${target.textContent || ''}${nextText}`
        }
        dispatchEvents(target)
      }
    },
    { targetSelector: selector, nextText: text }
  )
}

async function insertTextWithRetry(page: Page, client: CDPSession, target: EditorTarget, text: string): Promise<string> {
  await client.send('Input.insertText', { text })
  if (await verifyEditorContains(page, target.selector, text)) {
    return 'Input.insertText'
  }

  await insertTextByDomFallback(page, target.selector, text)
  if (await verifyEditorContains(page, target.selector, text)) {
    return target.isContentEditable ? 'document.execCommand(insertText)' : 'value + input/change event'
  }

  throw new Error(target.isContentEditable ? '正文填充失败' : '标题填充失败')
}

async function dispatchCharacterKey(client: CDPSession, char: string, delayMs = 90): Promise<void> {
  const key = String(char ?? '')
  if (!key) return
  await client.send('Input.dispatchKeyEvent', {
    type: 'char',
    text: key,
    unmodifiedText: key
  })
  await jitterDelay(delayMs, delayMs + 40)
}

async function dispatchSpecialKey(page: Page, key: 'Enter' | 'Space'): Promise<void> {
  await page.keyboard.press(key === 'Enter' ? 'Enter' : 'Space')
  await jitterDelay(80, 120)
}

async function captureTopicDropdownBaseline(
  page: Page,
  selector: string
): Promise<Array<{ containerId: string; textDigest: string }>> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return []
    const topicDropdownNodeSelector = [
      'body [role="option"]',
      'body li',
      'body button',
      'body a',
      'body [class*="option"]',
      'body [class*="Option"]',
      'body [class*="topic"]',
      'body [class*="Topic"]',
      'body [data-tippy-root] *',
      'body .tippy-box *',
      'body .tippy-content *'
    ].join(', ')
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 20 && rect.height < 480
    }
    const isLikelyTopicDropdownContainerSignature = (root: HTMLElement): boolean => {
      const role = String(root.getAttribute('role') ?? '').trim().toLowerCase()
      if (role === 'listbox' || role === 'menu' || role === 'dialog' || role === 'tooltip') return true
      if (root.hasAttribute('data-tippy-root')) return true
      const className = String(root.className ?? '').toLowerCase()
      if (
        className.includes('dropdown') ||
        className.includes('popover') ||
        className.includes('menu') ||
        className.includes('option') ||
        className.includes('list') ||
        className.includes('tippy') ||
        className.includes('tooltip')
      ) {
        return true
      }
      const tagName = String(root.tagName ?? '').toLowerCase()
      if (tagName === 'ul' || tagName === 'ol') return true
      return root.querySelectorAll('li, [role="option"], [class*="option"], [class*="Option"]').length >= 2
    }
    const isTopicDropdownContainer = (root: HTMLElement): boolean => {
      if (!isVisible(root)) return false
      if (root === document.body || root === document.documentElement) return false
      if (root.contains(target)) return false
      const rect = root.getBoundingClientRect()
      if (rect.width <= 40 || rect.height <= 20 || rect.height > 480) return false
      return isLikelyTopicDropdownContainerSignature(root)
    }
    const findTopicDropdownContainer = (node: HTMLElement): HTMLElement | null => {
      let current: HTMLElement | null = node
      while (current && current !== document.body) {
        if (isTopicDropdownContainer(current)) return current
        current = current.parentElement
      }
      return null
    }
    const getContainerId = (container: HTMLElement): string => {
      const existing = container.getAttribute('data-cms-topic-dropdown-id')
      if (existing) return existing
      const nextSeq =
        ((window as typeof window & { __cmsTopicDropdownSeq?: number }).__cmsTopicDropdownSeq ?? 0) + 1
      ;(window as typeof window & { __cmsTopicDropdownSeq: number }).__cmsTopicDropdownSeq = nextSeq
      const nextId = `topic-dropdown-${nextSeq}`
      container.setAttribute('data-cms-topic-dropdown-id', nextId)
      return nextId
    }
    const groups = new Map<string, string[]>()
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(topicDropdownNodeSelector))) {
      if (!isVisible(node)) continue
      if (node.isContentEditable || node.closest('[contenteditable]')) continue
      const text = normalizeText(node.innerText || node.textContent || '')
      if (!text) continue
      const clickable =
        (node.closest('.item, [role="option"], li, button, a') as HTMLElement | null) ||
        (node.closest('div') as HTMLElement | null) ||
        node
      const candidate = clickable && isVisible(clickable) ? clickable : node
      if (candidate.isContentEditable || candidate.closest('[contenteditable]')) continue
      const container = findTopicDropdownContainer(candidate)
      if (!container) continue
      const containerId = getContainerId(container)
      const candidateText = normalizeText(candidate.innerText || candidate.textContent || '')
      if (!candidateText) continue
      const current = groups.get(containerId)
      if (current) current.push(candidateText)
      else groups.set(containerId, [candidateText])
    }
    return Array.from(groups.entries()).map(([containerId, texts]) => ({
      containerId,
      textDigest: texts.join(' | ')
    }))
  }, selector)
}

async function readTopicDropdownCandidates(
  page: Page,
  selector: string,
  topicName: string,
  baseline: Array<{ containerId: string; textDigest: string }>
): Promise<string[]> {
  return page.evaluate(
    ({ targetSelector, wantedTopic, baselineTexts }) => {
      const target = document.querySelector<HTMLElement>(targetSelector)
      if (!target) return []
      const topicDropdownNodeSelector = [
        'body [role="option"]',
        'body li',
        'body button',
        'body a',
        'body [class*="option"]',
        'body [class*="Option"]',
        'body [class*="topic"]',
        'body [class*="Topic"]',
        'body [data-tippy-root] *',
        'body .tippy-box *',
        'body .tippy-content *'
      ].join(', ')
      const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
      const isVisible = (element: HTMLElement | null): element is HTMLElement => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 20 && rect.height < 480
      }
      const isLikelyTopicDropdownContainerSignature = (root: HTMLElement): boolean => {
        const role = String(root.getAttribute('role') ?? '').trim().toLowerCase()
        if (role === 'listbox' || role === 'menu' || role === 'dialog' || role === 'tooltip') return true
        if (root.hasAttribute('data-tippy-root')) return true
        const className = String(root.className ?? '').toLowerCase()
        if (
          className.includes('dropdown') ||
          className.includes('popover') ||
          className.includes('menu') ||
          className.includes('option') ||
          className.includes('list') ||
          className.includes('tippy') ||
          className.includes('tooltip')
        ) {
          return true
        }
        const tagName = String(root.tagName ?? '').toLowerCase()
        if (tagName === 'ul' || tagName === 'ol') return true
        return root.querySelectorAll('li, [role="option"], [class*="option"], [class*="Option"]').length >= 2
      }
      const isTopicDropdownContainer = (root: HTMLElement): boolean => {
        if (!isVisible(root)) return false
        if (root === document.body || root === document.documentElement) return false
        if (root.contains(target)) return false
        const rect = root.getBoundingClientRect()
        if (rect.width <= 40 || rect.height <= 20 || rect.height > 480) return false
        return isLikelyTopicDropdownContainerSignature(root)
      }
      const findTopicDropdownContainer = (node: HTMLElement): HTMLElement | null => {
        let current: HTMLElement | null = node
        while (current && current !== document.body) {
          if (isTopicDropdownContainer(current)) return current
          current = current.parentElement
        }
        return null
      }
      const normalizedTopic = String(wantedTopic ?? '').trim().replace(/^#+/, '')
      const wantedTexts = [`#${normalizedTopic}`, normalizedTopic].filter(Boolean)
      const baselineMap = new Map(
        (baselineTexts ?? []).map((item) => [String(item.containerId ?? ''), normalizeText(String(item.textDigest ?? ''))])
      )
      const groups = new Map<string, { texts: string[]; order: number; changed: boolean }>()
      let order = 0
      for (const node of Array.from(document.querySelectorAll<HTMLElement>(topicDropdownNodeSelector))) {
        if (!isVisible(node)) continue
        if (node.isContentEditable || node.closest('[contenteditable]')) continue
        const text = normalizeText(node.innerText || node.textContent || '')
        if (!text) continue
        if (!wantedTexts.some((wanted) => text.includes(wanted))) continue
        const clickable =
          (node.closest('.item, [role="option"], li, button, a') as HTMLElement | null) ||
          (node.closest('div') as HTMLElement | null) ||
          node
        const candidate = clickable && isVisible(clickable) ? clickable : node
        if (candidate.isContentEditable || candidate.closest('[contenteditable]')) continue
        const container = findTopicDropdownContainer(candidate)
        if (!container) continue
        const containerId = String(container.getAttribute('data-cms-topic-dropdown-id') ?? '')
        if (!containerId) continue
        const candidateText = normalizeText(candidate.innerText || candidate.textContent || '')
        if (!candidateText) continue
        const current = groups.get(containerId)
        if (current) {
          current.texts.push(candidateText)
        } else {
          order += 1
          groups.set(containerId, { texts: [candidateText], order, changed: false })
        }
      }

      const ranked = Array.from(groups.entries())
        .map(([containerId, meta]) => {
          const digest = meta.texts.join(' | ')
          const baselineDigest = baselineMap.get(containerId) ?? ''
          return {
            containerId,
            texts: meta.texts,
            order: meta.order,
            changed: digest !== baselineDigest
          }
        })
        .sort((a, b) => {
          if (a.changed !== b.changed) return a.changed ? -1 : 1
          if (a.texts.length !== b.texts.length) return b.texts.length - a.texts.length
          return b.order - a.order
        })

      if (ranked[0]?.texts.length) {
        return ranked[0].texts.slice(0, 20)
      }

      const targetRect = target.getBoundingClientRect()
      return Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => isVisible(element))
        .filter((element) => !element.isContentEditable && !element.closest('[contenteditable]'))
        .map((element) => {
          const text = normalizeText(element.innerText || element.textContent || '')
          const rect = element.getBoundingClientRect()
          return { text, rect }
        })
        .filter(({ text, rect }) => {
          if (!text) return false
          if (!wantedTexts.some((wanted) => text.includes(wanted))) return false
          if (!/浏览|话题|创建|新建/.test(text)) return false
          if (rect.height < 20 || rect.height > 120) return false
          if (rect.width < 120 || rect.width > 900) return false
          if (rect.top < targetRect.top - 120 || rect.top > targetRect.bottom + 420) return false
          if (rect.left < targetRect.left - 120 || rect.left > targetRect.right + 420) return false
          return true
        })
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
        .map(({ text }) => text)
        .slice(0, 20)
    },
    { targetSelector: selector, wantedTopic: topicName, baselineTexts: baseline }
  )
}

async function hasRichTopicInEditor(page: Page, selector: string, topicName: string): Promise<boolean> {
  return page.evaluate(
    ({ targetSelector, wantedTopic }) => {
      const editor = document.querySelector<HTMLElement>(targetSelector)
      if (!editor || editor.getAttribute('contenteditable') !== 'true') return true
      const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
      const wanted = `#${String(wantedTopic ?? '').trim().replace(/^#+/, '')}`
      const isLikelyBlueText = (element: HTMLElement): boolean => {
        const match = String(window.getComputedStyle(element).color || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
        if (!match) return false
        const r = Number(match[1])
        const g = Number(match[2])
        const b = Number(match[3])
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && b >= 140 && b >= r + 30 && b >= g + 30
      }
      const nodes = Array.from(editor.querySelectorAll<HTMLElement>('a, span, [class*="topic"], [class*="Topic"]'))
      return nodes.some((element) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        if (!text.includes(wanted)) return false
        if (element.tagName === 'A') return true
        const className = typeof element.className === 'string' ? element.className : ''
        return className.includes('topic') || className.includes('Topic') || isLikelyBlueText(element)
      })
    },
    { targetSelector: selector, wantedTopic: topicName }
  )
}

async function confirmTopicRendered(page: Page, target: EditorTarget, topicName: string): Promise<boolean> {
  if (!target.isContentEditable) return true
  return waitForCondition(
    async () => ((await hasRichTopicInEditor(page, target.selector, topicName)) ? true : null),
    2_500,
    250,
    '话题未渲染为富文本（蓝字）'
  )
    .then(() => true)
    .catch(() => false)
}

async function insertTopic(page: Page, client: CDPSession, target: EditorTarget, topicName: string): Promise<void> {
  const normalized = String(topicName ?? '').trim().replace(/^#+/, '')
  if (!normalized) return

  await focusSelectorWithCdp(client, target.selector)
  await moveCaretToEnd(page, target.selector)

  const existingText = await readEditorText(page, target.selector)
  const lastChar = existingText.slice(-1)
  if (existingText && lastChar && !/\s/.test(lastChar)) {
    await client.send('Input.insertText', { text: ' ' })
  }

  const dropdownBaseline = await captureTopicDropdownBaseline(page, target.selector)

  await dispatchCharacterKey(client, '#', 120)
  for (const char of normalized) {
    await dispatchCharacterKey(client, char, 60)
  }

  const candidates = await waitForCondition(
    async () => {
      const list = await readTopicDropdownCandidates(page, target.selector, normalized, dropdownBaseline)
      return list.length > 0 ? list : null
    },
    6_000,
    250,
    '未找到话题下拉项。'
  ).catch(() => null)

  if (candidates && candidates.length > 0) {
    await moveCaretToEnd(page, target.selector)
    await dispatchSpecialKey(page, 'Space')
    await confirmTopicRendered(page, target, normalized)
  }

  await jitterDelay(300, 360)
}

export async function fillTagsAsBlueTopics(page: Page, client: CDPSession, tags: string[]): Promise<void> {
  if (!Array.isArray(tags) || tags.length === 0) return
  for (const tag of tags) {
    const target = await markBodyEditor(page)
    if (!target.found) throw new Error('未找到正文输入框（话题插入阶段）。')
    await insertTopic(page, client, target, tag)
  }
}

export async function fillTitle(page: Page, client: CDPSession, text: string): Promise<string> {
  const target = await markTitleEditor(page)
  if (!target.found) throw new Error('未找到标题输入区域')

  let mouse: MouseState = { x: 40, y: 40 }
  mouse = await focusEditorTarget(page, client, mouse, target)
  await clearEditor(page, target.selector)
  await jitterDelay(80, 140)
  await moveCaretToEnd(page, target.selector)
  return insertTextWithRetry(page, client, target, String(text ?? '').trim())
}

export async function safeFillTitle(page: Page, client: CDPSession, text: string): Promise<string> {
  try {
    return await fillTitle(page, client, text)
  } catch (error) {
    await jitterDelay(800, 820)
    return fillTitle(page, client, text)
  }
}

export async function fillContent(page: Page, client: CDPSession, text: string): Promise<string> {
  const target = await markBodyEditor(page)
  if (!target.found) throw new Error('未找到正文编辑区域')

  let mouse: MouseState = { x: 40, y: 40 }
  mouse = await focusEditorTarget(page, client, mouse, target)

  const rawText = String(text ?? '')
  const fullText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const topics = normalizeTagList(fullText)
  const cleanText = fullText
    .replace(/#([^#\s]+)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  await clearEditor(page, target.selector)
  await jitterDelay(100, 150)
  await moveCaretToEnd(page, target.selector)

  let method = '空正文'
  if (cleanText) {
    method = await insertTextWithRetry(page, client, target, cleanText)
    await dispatchReactInputEvents(page, target.selector)
    await jitterDelay(100, 150)
    await moveCaretToEnd(page, target.selector)
  }

  if (topics.length > 0 && cleanText) {
    await dispatchSpecialKey(page, 'Enter')
    await jitterDelay(80, 120)
    await moveCaretToEnd(page, target.selector)
  }

  for (const topic of topics) {
    await insertTopic(page, client, target, topic)
  }

  return method
}

export async function safeFillContentAndTags(page: Page, client: CDPSession, text: string, tags: string[]): Promise<string> {
  try {
    const method = await fillContent(page, client, text)
    await fillTagsAsBlueTopics(page, client, tags)
    return method
  } catch (error) {
    await jitterDelay(800, 820)
    const method = await fillContent(page, client, text)
    await fillTagsAsBlueTopics(page, client, tags)
    return method
  }
}

async function markFirstCoverEntry(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 48 && rect.height >= 48
    }

    const findClickableAncestor = (element: HTMLElement | null): HTMLElement | null => {
      if (!element) return null
      const clickable =
        element.closest<HTMLElement>('button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn, label') ?? element
      if (!clickable) return null
      if (!isVisible(clickable)) return isVisible(element) ? element : null
      return clickable
    }

    const findLeafByTextIncludes = (needle: string, root: ParentNode): HTMLElement | null => {
      const wanted = normalizeText(needle)
      const all = Array.from(root.querySelectorAll<HTMLElement>('body * , div, span, p, strong, em, button, a, li, h1, h2, h3, h4'))
      const matched: HTMLElement[] = []
      for (const el of all) {
        if (!isVisible(el)) continue
        const text = normalizeText(el.innerText || el.textContent || '')
        if (!text || !text.includes(wanted)) continue
        matched.push(el)
      }
      matched.sort((a, b) => {
        const al = a.querySelectorAll('*').length
        const bl = b.querySelectorAll('*').length
        if (al !== bl) return al - bl
        const at = normalizeText(a.innerText || a.textContent || '').length
        const bt = normalizeText(b.innerText || b.textContent || '').length
        return at - bt
      })
      return matched[0] ?? null
    }

    const findCoverSectionRoot = (): { root: HTMLElement; anchor: HTMLElement } | null => {
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

    const section = findCoverSectionRoot()
    const anchorRect = section?.anchor?.getBoundingClientRect?.() || null
    const searchRoots = [section?.root || null, document.querySelector<HTMLElement>('#publish-container'), document.body]
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
      '[class*="poster"]',
      '[data-testid*="cover"]',
      '[data-test*="cover"]'
    ].join(', ')

    const collectCoverFrameCandidates = (root: ParentNode): HTMLElement[] => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el): el is HTMLElement => el instanceof HTMLElement)
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

    const scoreCoverFrameCandidate = (target: HTMLElement, anchorRectValue: DOMRect | null): number => {
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
      if (anchorRectValue) {
        const dy = rect.top - anchorRectValue.top
        if (dy >= -30) score += 120
        if (dy >= -30 && dy <= 900) score += 150
        const distance = Math.abs(rect.top - anchorRectValue.bottom)
        score += Math.max(0, 600 - distance) * 0.2
      }
      return score
    }

    const pickFirstCoverFrameCandidate = (candidates: HTMLElement[], anchorRectValue: DOMRect | null): HTMLElement | null => {
      const scored = candidates
        .map((candidate) => ({
          target: candidate,
          rect: candidate.getBoundingClientRect(),
          score: scoreCoverFrameCandidate(candidate, anchorRectValue)
        }))
        .filter((item) => item.score > 0)
      if (scored.length === 0) return null
      scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.rect.top !== b.rect.top ? a.rect.top - b.rect.top : a.rect.left - b.rect.left))
      const bestScore = scored[0]?.score ?? 0
      const nearBest = scored.filter((item) => item.score >= bestScore - 120)
      nearBest.sort((a, b) => (a.rect.top !== b.rect.top ? a.rect.top - b.rect.top : a.rect.left - b.rect.left))
      return nearBest[0]?.target ?? scored[0]?.target ?? null
    }

    const visited = new Set<ParentNode>()
    for (const root of searchRoots) {
      if (!root || visited.has(root)) continue
      visited.add(root)
      const candidates = collectCoverFrameCandidates(root)
      const picked = pickFirstCoverFrameCandidate(candidates, anchorRect)
      if (!picked) continue
      const rect = picked.getBoundingClientRect()
      picked.setAttribute('data-cms-cdp-cover-open', 'true')
      return {
        found: true,
        selector: '[data-cms-cdp-cover-open="true"]',
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        tagName: picked.tagName,
        isContentEditable: false,
        isTextInput: false
      }
    }
    return null
  })

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function inspectCoverEntryCandidates(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
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
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const samples = nodes
      .slice(0, 12)
      .map((node, index) => {
        const rect = node.getBoundingClientRect()
        const closest = node.closest<HTMLElement>(
          '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover"], [class*="Cover"], [class*="thumbnail"], [class*="poster"], li'
        )
        return {
          index,
          tag: node.tagName,
          visible: isVisible(node),
          rect: `${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.left)},${Math.round(rect.top)}`,
          className: String(node.className || '').slice(0, 120),
          text: normalizeText(node.innerText || node.textContent || '').slice(0, 80),
          closestTag: closest?.tagName ?? '',
          closestClass: String(closest?.className || '').slice(0, 120)
        }
      })
    return JSON.stringify(
      {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        nodeCount: nodes.length,
        samples
      },
      null,
      2
    )
  })
}

async function waitForCoverSectionReady(page: Page): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate(() => {
        const text = document.body?.innerText ?? ''
        const hasCoverText = text.includes('设置封面')
        const hasPreviewText =
          text.includes('封面预览') ||
          text.includes('智能推荐封面') ||
          text.includes('优质封面示例') ||
          text.includes('默认截取第一帧作为封面')
        const hasClickableCover = Boolean(
          document.querySelector(
            '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover-frame"], [class*="coverFrame"], [class*="cover"] img, [class*="cover"] canvas'
          )
        )
        return hasCoverText && (hasPreviewText || hasClickableCover) ? true : null
      }),
    20_000,
    300,
    '视频上传后封面区域未就绪。'
  )
  await jitterDelay(350, 650)
}

async function waitForCoverModal(page: Page, timeoutMs = 8_000): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate(() => {
        const isVisible = (element: HTMLElement | null): element is HTMLElement => {
          if (!element) return false
          const style = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 80 && rect.height > 80
        }
        const dialogs = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')
        ).filter((element) => isVisible(element))
        if (dialogs.length === 0) return null
        let modal = dialogs[0] ?? null
        let bestZ = Number.NEGATIVE_INFINITY
        for (const candidate of dialogs) {
          const z = Number.parseInt(window.getComputedStyle(candidate).zIndex || '0', 10)
          const zValue = Number.isFinite(z) ? z : 0
          if (zValue >= bestZ) {
            bestZ = zValue
            modal = candidate
          }
        }
        if (!modal) return null
        const inputs = Array.from(modal.querySelectorAll<HTMLInputElement>('input[type="file"]'))
        const hasImageInput = inputs.some((input) => {
          const accept = String(input.getAttribute('accept') || '').toLowerCase()
          if (!accept) return false
          if (accept.includes('video')) return false
          return accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp')
        })
        if (hasImageInput) return true
        const candidates = Array.from(
          modal.querySelectorAll<HTMLElement>('button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn')
        ).filter((element) => isVisible(element))
        const hasUploadButton = candidates.some((element) => {
          const text = String(element.innerText || element.textContent || '').replace(/\s+/g, '')
          return text.includes('上传图片')
        })
        return hasUploadButton ? true : null
      }),
    timeoutMs,
    220,
    '未出现封面弹窗（含上传图片入口）。'
  )
}

async function hoverCoverEntry(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return
    const rect = target.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const options = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }
    try {
      target.dispatchEvent(new MouseEvent('mouseenter', options))
    } catch {
      void 0
    }
    try {
      target.dispatchEvent(new MouseEvent('mouseover', options))
    } catch {
      void 0
    }
    try {
      target.dispatchEvent(new MouseEvent('mousemove', options))
    } catch {
      void 0
    }
  }, selector)
}

async function markCoverUploadInput(page: Page): Promise<UploadTarget> {
  return page.evaluate(() => {
    const modalSelectors = '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
    const modalRoots = Array.from(document.querySelectorAll<HTMLElement>(modalSelectors)).filter((modal) => {
      const style = window.getComputedStyle(modal)
      const rect = modal.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 80 && rect.height > 80
    })
    const inputs = [
      ...modalRoots.flatMap((modal) => Array.from(modal.querySelectorAll<HTMLInputElement>('input[type="file"]'))),
      ...Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((input) =>
        Boolean(input.closest(modalSelectors))
      )
    ]
    const scored = inputs
      .map((input, index) => {
        const attrs = [
          input.accept,
          input.id,
          input.name,
          input.className,
          input.parentElement?.className ?? '',
          input.closest('[class*="cover"], [class*="Cover"]')?.className ?? '',
          input.closest(modalSelectors)?.className ?? ''
        ]
          .join(' ')
          .toLowerCase()

        let score = 0
        if (attrs.includes('image')) score += 50
        if (attrs.includes('.jpg') || attrs.includes('.jpeg') || attrs.includes('.png') || attrs.includes('.webp')) {
          score += 30
        }
        if (attrs.includes('cover')) score += 15
        if (attrs.includes('video')) score -= 60
        score -= index
        return { input, score }
      })
      .sort((a, b) => b.score - a.score)

    const target = scored[0]?.input
    if (!target || scored[0]!.score <= 0) {
      return { found: false, selector: '' }
    }
    target.setAttribute('data-cms-cdp-cover-upload', 'true')
    return {
      found: true,
      selector: 'input[type="file"][data-cms-cdp-cover-upload="true"]'
    }
  })
}

async function waitForCoverUploadInput(page: Page): Promise<UploadTarget> {
  return waitForCondition(
    async () => {
      const target = await markCoverUploadInput(page)
      return target.found ? target : null
    },
    8_000,
    200,
    '未找到封面上传 input[type=file]'
  )
}

async function waitForCoverFileSelection(page: Page, selector: string): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate((targetSelector) => {
        const input = document.querySelector<HTMLInputElement>(targetSelector)
        if (!input) return null
        return (input.files?.length ?? 0) > 0 ? true : null
      }, selector),
    6_000,
    180,
    '未确认封面文件已注入到上传 input。'
  )
}

function normalizeImageSrcForCompare(src: string): string {
  const raw = String(src ?? '').trim()
  if (!raw) return ''
  return raw.replace(/[?#].*$/, '')
}

function hasCoverSelectionSignal(
  now: CoverModalUploadSnapshot,
  coverAbsPath: string,
  baseline: CoverModalUploadSnapshot
): boolean {
  const coverBase = coverAbsPath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const coverStem = coverBase.includes('.') ? coverBase.slice(0, coverBase.lastIndexOf('.')) : coverBase

  if (now.selectedFileCount > baseline.selectedFileCount) return true
  if (coverBase && now.fileValues.some((value) => value.includes(coverBase))) return true
  if (coverBase && now.text.includes(coverBase)) return true
  if (coverStem && coverStem.length >= 6 && now.text.includes(coverStem)) return true

  const imageChanged = now.imageSources.join('|') !== baseline.imageSources.join('|')
  const textChanged = now.text !== baseline.text
  const uploadWords = ['上传中', '处理中', '已上传', '上传成功', '重新上传', '替换', '更换']
  if (uploadWords.some((word) => now.text.includes(word)) && (imageChanged || textChanged)) {
    return true
  }

  return false
}

async function snapshotCoverModalUploadState(page: Page): Promise<CoverModalUploadSnapshot> {
  return page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(
      '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
    )
    const text = (modal?.innerText || modal?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const imageSources = Array.from(modal?.querySelectorAll('img') ?? [])
      .filter((element): element is HTMLImageElement => element instanceof HTMLImageElement)
      .map((img) => String(img.currentSrc || img.src || ''))
      .filter(Boolean)
    const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    const selectedFileCount = fileInputs.reduce((sum, input) => sum + (input.files?.length ?? 0), 0)
    const fileValues = fileInputs
      .map((input) => String(input.value || '').trim().toLowerCase())
      .filter(Boolean)

    return {
      text,
      imageSources,
      selectedFileCount,
      fileValues
    }
  })
}

async function waitForCoverSelectionSignal(page: Page, coverPath: string, baseline: CoverModalUploadSnapshot): Promise<void> {
  await waitForCondition(
    async () => {
      const current = await snapshotCoverModalUploadState(page)
      const normalizedCurrent: CoverModalUploadSnapshot = {
        ...current,
        imageSources: current.imageSources.map((src) => normalizeImageSrcForCompare(src))
      }
      const normalizedBaseline: CoverModalUploadSnapshot = {
        ...baseline,
        imageSources: baseline.imageSources.map((src) => normalizeImageSrcForCompare(src))
      }
      return hasCoverSelectionSignal(normalizedCurrent, coverPath, normalizedBaseline) ? true : null
    },
    7_000,
    180,
    '未确认封面已选中，已停止后续“确定”点击。'
  )
}

async function markCoverConfirmButton(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(
      '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
    )
    if (!modal) return null

    const candidates = Array.from(
      modal.querySelectorAll<HTMLElement>('button, [role="button"], a, div[tabindex], span[tabindex]')
    )
      .map((element, index) => {
        const text = (element.innerText || element.textContent || '').trim()
        const rect = element.getBoundingClientRect()
        const className = String(element.className || '').toLowerCase()
        const disabled =
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true' ||
          className.includes('disabled')
        let score = 0
        if (text === '确定') score += 500
        else if (text.includes('确定')) score += 320
        else if (text.includes('完成')) score += 220
        else if (text.includes('保存')) score += 180
        if (text.includes('取消')) score -= 400
        if (className.includes('primary') || className.includes('ant-btn-primary')) score += 200
        return { element, index, rect, score, disabled }
      })
      .filter((item) => item.score > 0 && item.rect.width > 24 && item.rect.height > 24 && !item.disabled)
      .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cdp-cover-confirm', 'true')
    return {
      found: true,
      selector: '[data-cms-cdp-cover-confirm="true"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.element.tagName,
      isContentEditable: false,
      isTextInput: false
    }
  })

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function waitForCoverModalClose(page: Page): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>(
          '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
        )
        if (!modal) return true
        const style = window.getComputedStyle(modal)
        const rect = modal.getBoundingClientRect()
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          rect.width < 20 ||
          rect.height < 20
        ) {
          return true
        }
        return null
      }),
    8_000,
    220,
    '封面弹窗未关闭。'
  )
}

async function scrollSelectorIntoView(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const element = document.querySelector<HTMLElement>(targetSelector)
    if (!element) return
    try {
      element.scrollIntoView({ block: 'center', inline: 'center' })
    } catch (error) {
      void error
    }
  }, selector)
  await jitterDelay(120, 180)
}

async function readSelectorViewportSnapshot(page: Page, selector: string): Promise<SelectorViewportSnapshot> {
  const snapshot = await page.evaluate((targetSelector) => {
    const element = document.querySelector<HTMLElement>(targetSelector)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      found: true,
      selector: targetSelector,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      tagName: element.tagName,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    }
  }, selector)

  return (
    snapshot ?? {
      found: false,
      selector,
      centerX: 0,
      centerY: 0,
      tagName: '',
      rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
      viewport: { width: 0, height: 0 }
    }
  )
}

async function ensureSelectorReachableForMouse(
  page: Page,
  client: CDPSession,
  selector: string
): Promise<EditorTarget> {
  await scrollSelectorIntoView(page, selector)

  let snapshot = await readSelectorViewportSnapshot(page, selector)
  if (!snapshot.found) {
    return { found: false, selector, centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
  }

  const isOutsideViewport = (): boolean =>
    snapshot.rect.left < 8 ||
    snapshot.rect.top < 8 ||
    snapshot.rect.right > snapshot.viewport.width - 8 ||
    snapshot.rect.bottom > snapshot.viewport.height - 8

  if (isOutsideViewport()) {
    try {
      const { windowId, bounds } = await client.send('Browser.getWindowForTarget')
      const width = Math.min(
        1800,
        Math.max(
          Math.round(bounds.width ?? snapshot.viewport.width),
          Math.round(Math.max(snapshot.viewport.width + 120, snapshot.rect.right + 120, 1280))
        )
      )
      const height = Math.min(
        1400,
        Math.max(
          Math.round(bounds.height ?? snapshot.viewport.height),
          Math.round(Math.max(snapshot.viewport.height + 160, snapshot.rect.bottom + 160, 900))
        )
      )
      await client.send('Browser.setWindowBounds', {
        windowId,
        bounds: { width, height }
      })
      await jitterDelay(220, 320)
      await scrollSelectorIntoView(page, selector)
      snapshot = await readSelectorViewportSnapshot(page, selector)
    } catch (error) {
      void error
    }
  }

  if (isOutsideViewport()) {
    try {
      await page.setViewport({
        width: Math.min(1800, Math.max(1280, Math.round(Math.max(snapshot.viewport.width, snapshot.rect.right + 120)))),
        height: Math.min(1400, Math.max(900, Math.round(Math.max(snapshot.viewport.height, snapshot.rect.bottom + 160))))
      })
      await jitterDelay(160, 220)
      await scrollSelectorIntoView(page, selector)
      snapshot = await readSelectorViewportSnapshot(page, selector)
    } catch (error) {
      void error
    }
  }

  return {
    found: snapshot.found,
    selector,
    centerX: snapshot.centerX,
    centerY: snapshot.centerY,
    tagName: snapshot.tagName,
    isContentEditable: false,
    isTextInput: false
  }
}

export async function uploadVideo(page: Page, client: CDPSession, filePath: string): Promise<void> {
  await robustVideoUpload(page, client, filePath)
  await waitForUploadReady(page, 'video', 1)
}

export async function uploadImages(page: Page, client: CDPSession, filePaths: string[]): Promise<void> {
  await switchToImageUploadTab(page, client)
  const target = await markVideoUploadInput(page, 'image')
  if (!target.found) throw new Error('未找到图片上传 input[type=file]')
  await setFilesWithCdp(client, target.selector, filePaths)
  await dispatchFileInputEvents(page, target.selector)
  await waitForUploadReady(page, 'image', filePaths.length)
}

const PRODUCT_MODAL_SELECTOR = '[role="dialog"], .ant-modal, .ant-modal-content, .d-modal'

async function dismissPotentialPopups(page: Page, client: CDPSession, mouse: MouseState): Promise<MouseState> {
  const target = await markNeutralDismissTarget(page)
  if (!target.shouldClick || !target.found) {
    return mouse
  }

  const clickable = await ensureSelectorReachableForMouse(page, client, target.selector)
  if (!clickable.found) {
    return mouse
  }

  const nextMouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
  await jitterDelay(600, 900)
  return nextMouse
}

async function markNeutralDismissTarget(page: Page): Promise<EditorTarget & { shouldClick: boolean }> {
  const target = await page.evaluate(() => {
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8
    }

    const overlaySelectors = [
      '.ant-modal-mask',
      '.ant-modal-wrap',
      '.ant-popover',
      '.ant-tooltip',
      '.ant-dropdown',
      '.ant-select-dropdown',
      '[role="dialog"]',
      '[class*="modal"]',
      '[class*="popover"]',
      '[class*="tooltip"]',
      '[class*="dropdown"]'
    ]
    const hasOverlay = overlaySelectors.some((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).some((element) => isVisible(element))
    )

    const neutral =
      document.querySelector<HTMLElement>('.title-label') ||
      Array.from(document.querySelectorAll<HTMLElement>('div, span, label')).find(
        (element) => isVisible(element) && /填写标题/.test((element.innerText || element.textContent || '').trim())
      ) ||
      document.querySelector<HTMLElement>('input[placeholder*="填写标题"]') ||
      document.querySelector<HTMLElement>('input[placeholder*="标题"]') ||
      document.querySelector<HTMLElement>(
        '.editor-content .tiptap.ProseMirror[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"]'
      ) ||
      document.querySelector<HTMLElement>('main') ||
      document.body

    const clickable =
      (neutral?.closest('div, section, main, form, article') as HTMLElement | null) ||
      neutral ||
      document.body
    if (!clickable || !isVisible(clickable)) {
      return null
    }

    clickable.setAttribute('data-cms-cdp-neutral-dismiss-target', 'true')
    const rect = clickable.getBoundingClientRect()
    return {
      found: true,
      shouldClick: hasOverlay,
      selector: '[data-cms-cdp-neutral-dismiss-target="true"]',
      tagName: clickable.tagName,
      role: clickable.getAttribute('role') ?? '',
      placeholder: '',
      text: (clickable.innerText || clickable.textContent || '').trim(),
      centerX: rect.left + Math.max(24, Math.min(rect.width - 24, rect.width * 0.5)),
      centerY: rect.top + Math.max(24, Math.min(rect.height - 24, Math.min(rect.height * 0.2, 120))),
      isContentEditable: clickable.getAttribute('contenteditable') === 'true',
      isTextInput: clickable instanceof HTMLInputElement || clickable instanceof HTMLTextAreaElement
    }
  })

  return (
    target ?? {
      found: false,
      shouldClick: false,
      selector: '',
      tagName: '',
      role: '',
      placeholder: '',
      text: '',
      centerX: 0,
      centerY: 0,
      isContentEditable: false,
      isTextInput: false
    }
  )
}

async function scrollPublishAreaToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidates = [
      document.querySelector<HTMLElement>('.content-input'),
      document.querySelector<HTMLElement>('[class*="content-input"]'),
      document.querySelector<HTMLElement>('[class*="content"]'),
      document.querySelector<HTMLElement>('main'),
      document.scrollingElement as HTMLElement | null,
      document.body
    ].filter((item): item is HTMLElement => Boolean(item))

    for (const element of candidates) {
      try {
        element.scrollTop = element.scrollHeight
      } catch (error) {
        void error
      }
    }
    try {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior })
    } catch (error) {
      void error
      window.scrollTo(0, document.body.scrollHeight)
    }
  })
  await jitterDelay(220, 320)
}

async function markProductModalSearchInput(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 80 && rect.height > 16
    }

    const selectors = [
      'input.ant-input[placeholder*="搜索"]',
      'input.ant-input[placeholder*="ID"]',
      '.ant-input-affix-wrapper input.ant-input',
      'input.ant-input',
      'input[placeholder*="搜索商品ID"]',
      'input[placeholder*="搜索"][placeholder*="ID"]',
      'input[placeholder*="搜索"]',
      'input[type="search"]'
    ]

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll<HTMLInputElement>(selector)))
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        const text = normalizeText(
          [
            element.placeholder,
            element.className,
            element.parentElement?.className ?? '',
            element.closest('[role="dialog"], .ant-modal, .ant-modal-content, .d-modal, [class*="drawer"], [class*="Drawer"]')
              ?.className ?? ''
          ].join(' ')
        )
        let score = 0
        if (text.includes('搜索')) score += 40
        if (text.includes('id')) score += 20
        if (text.includes('商品')) score += 18
        if (element.className.includes('ant-input')) score += 10
        return { element, index, rect, score }
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cdp-product-search', 'true')
    return {
      found: true,
      selector: 'input[data-cms-cdp-product-search="true"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.element.tagName,
      isContentEditable: false,
      isTextInput: true
    }
  })

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function waitForProductModalSearchInput(page: Page): Promise<EditorTarget> {
  return waitForCondition(
    async () => {
      const input = await markProductModalSearchInput(page)
      return input.found ? input : null
    },
    25_000,
    250,
    '商品弹窗未打开（未找到搜索输入框）。'
  )
}

async function clearAndFillTextInput(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  target: EditorTarget,
  text: string
): Promise<MouseState> {
  const reachable = await ensureSelectorReachableForMouse(page, client, target.selector)
  if (!reachable.found) throw new Error('未找到可点击的输入框')
  let nextMouse = await focusEditorTarget(page, client, mouse, {
    ...target,
    centerX: reachable.centerX,
    centerY: reachable.centerY
  })
  await clearEditor(page, target.selector)
  await jitterDelay(100, 150)
  await moveCaretToEnd(page, target.selector)
  if (text) {
    await client.send('Input.insertText', { text })
    await dispatchReactInputEvents(page, target.selector)
    await jitterDelay(120, 180)
  }
  return nextMouse
}

async function ensureMinimumWindowLayout(
  page: Page,
  client: CDPSession,
  minWidth: number,
  minHeight: number
): Promise<void> {
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  if (viewport.width >= minWidth && viewport.height >= minHeight) return
  try {
    const { windowId, bounds } = await client.send('Browser.getWindowForTarget')
    await client.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        width: Math.max(Math.round(bounds.width ?? viewport.width), minWidth),
        height: Math.max(Math.round(bounds.height ?? viewport.height), minHeight)
      }
    })
  } catch (error) {
    void error
  }
  try {
    await page.setViewport({ width: minWidth, height: minHeight })
  } catch (error) {
    void error
  }
  await jitterDelay(240, 320)
}

async function markKeywordClickTarget(page: Page, keyword: string, marker: string): Promise<EditorTarget> {
  const target = await page.evaluate(
    ({ wantedKeyword, markerName }) => {
      const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
      const isVisible = (element: HTMLElement | null): element is HTMLElement => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8
      }
      const clickableAncestor = (element: HTMLElement | null): HTMLElement | null =>
        (element?.closest('button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn, label') as HTMLElement | null) ||
        element

      const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span, p, li'))
        .filter((element) => isVisible(element))
        .map((element, index) => {
          const text = normalizeText(element.innerText || element.textContent || '')
          if (!text || !text.includes(wantedKeyword)) return null
          const clickable = clickableAncestor(element)
          if (!clickable || !isVisible(clickable)) return null
          const rect = clickable.getBoundingClientRect()
          let score = 0
          if (text === wantedKeyword) score += 200
          score -= text.length * 0.5
          if (clickable.tagName === 'BUTTON') score += 20
          return { clickable, rect, score, index, text }
        })
        .filter((item): item is { clickable: HTMLElement; rect: DOMRect; score: number; index: number; text: string } => Boolean(item))
        .sort((a, b) => b.score - a.score || a.index - b.index)

      const match = candidates[0]
      if (!match) return null
      match.clickable.setAttribute(markerName, 'true')
      return {
        found: true,
        selector: `[${markerName}="true"]`,
        centerX: match.rect.left + match.rect.width / 2,
        centerY: match.rect.top + match.rect.height / 2,
        tagName: match.clickable.tagName,
        isContentEditable: false,
        isTextInput: false
      }
    },
    { wantedKeyword: keyword, markerName: marker }
  )

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function markLeafByTextContains(page: Page, keyword: string, marker: string): Promise<EditorTarget> {
  const target = await page.evaluate(
    ({ wantedKeyword, markerName }) => {
      const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
      const isVisibleForWait = (element: HTMLElement | null): element is HTMLElement => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
        if (rect.width <= 0 || rect.height <= 0) return false
        return element.offsetParent !== null
      }
      const getHtmlLength = (element: HTMLElement): number => {
        try {
          return typeof element.innerHTML === 'string' ? element.innerHTML.length : Number.POSITIVE_INFINITY
        } catch {
          return Number.POSITIVE_INFINITY
        }
      }

      const matched: HTMLElement[] = []
      for (const node of Array.from(document.body.querySelectorAll('*'))) {
        if (!(node instanceof HTMLElement)) continue
        if (!isVisibleForWait(node)) continue
        const text = normalizeText(node.innerText || node.textContent || '')
        if (!text || !text.includes(wantedKeyword)) continue
        matched.push(node)
      }

      matched.sort((a, b) => {
        const al = getHtmlLength(a)
        const bl = getHtmlLength(b)
        if (al !== bl) return al - bl
        const ac = a.querySelectorAll('*').length
        const bc = b.querySelectorAll('*').length
        if (ac !== bc) return ac - bc
        return 0
      })

      const leaf = matched[0]
      if (!leaf || !isVisibleForWait(leaf)) return null
      leaf.setAttribute(markerName, 'true')
      const rect = leaf.getBoundingClientRect()
      return {
        found: true,
        selector: `[${markerName}="true"]`,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        tagName: leaf.tagName,
        isContentEditable: false,
        isTextInput: false
      }
    },
    { wantedKeyword: keyword, markerName: marker }
  )

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function clickKeywordLikeLegacy(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  keyword: string,
  timeoutMs: number,
  marker: string
): Promise<{ found: boolean; mouse: MouseState }> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const leaf = await markLeafByTextContains(page, keyword, marker)
    if (leaf.found) {
      const clickable = await ensureSelectorReachableForMouse(page, client, leaf.selector)
      const nextMouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
      return { found: true, mouse: nextMouse }
    }
    await jitterDelay(350, 650)
  }
  return { found: false, mouse }
}

async function markProductActionButton(
  page: Page,
  texts: string[],
  marker: string
): Promise<EditorTarget> {
  const target = await page.evaluate(
    ({ wantedTexts, markerName }) => {
      const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
      const isVisible = (element: HTMLElement | null): element is HTMLElement => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 20
      }

      const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span'))
        .filter((element) => isVisible(element))
        .map((element, index) => {
          const text = normalizeText(element.innerText || element.textContent || '')
          const rect = element.getBoundingClientRect()
          const className = String(element.className || '').toLowerCase()
          let score = 0
          for (const wanted of wantedTexts) {
            if (text.includes(wanted)) score += 80
          }
          if (element.tagName === 'BUTTON') score += 20
          if (className.includes('button') || className.includes('btn')) score += 12
          if (className.includes('product') || className.includes('goods') || className.includes('component')) score += 8
          score += Math.max(0, rect.top) * 0.002
          return { element, index, rect, score }
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)

      const match = candidates[0]
      if (!match) return null
      match.element.setAttribute(markerName, 'true')
      return {
        found: true,
        selector: `[${markerName}="true"]`,
        centerX: match.rect.left + match.rect.width / 2,
        centerY: match.rect.top + match.rect.height / 2,
        tagName: match.element.tagName,
        isContentEditable: false,
        isTextInput: false
      }
    },
    { wantedTexts: texts, markerName: marker }
  )

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function openProductModalWithRetry(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  onLog?: (message: string) => void
): Promise<{ input: EditorTarget; mouse: MouseState }> {
  await ensureMinimumWindowLayout(page, client, 1280, 900)
  logLine(onLog, '开始滚到底部')
  await scrollPublishAreaToBottom(page)
  logLine(onLog, '滚到底部完成')

  logLine(onLog, '开始点击添加商品')
  const directAddProduct = await clickKeywordLikeLegacy(page, client, mouse, '添加商品', 2_500, 'data-cms-cdp-add-product-leaf')
  mouse = directAddProduct.mouse

  if (!directAddProduct.found) {
    const addComponentButton = await markKeywordClickTarget(page, '添加组件', 'data-cms-cdp-add-component')
    const fallbackAddComponent =
      addComponentButton.found
        ? addComponentButton
        : await markProductActionButton(page, ['添加组件'], 'data-cms-cdp-add-component')
    if (fallbackAddComponent.found) {
      const clickable = await ensureSelectorReachableForMouse(page, client, fallbackAddComponent.selector)
      mouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
      await jitterDelay(350, 500)
    }
    const secondTry = await clickKeywordLikeLegacy(page, client, mouse, '添加商品', 5_000, 'data-cms-cdp-add-product-leaf')
    mouse = secondTry.mouse
    if (!secondTry.found) {
      throw new Error('未找到“添加商品”按钮。')
    }
  }
  logLine(onLog, '点击添加商品完成')

  await jitterDelay(500, 700)

  logLine(onLog, '开始等待商品弹窗搜索框')
  const input = await waitForProductModalSearchInput(page).catch((error) => {
    logLine(onLog, '搜索框未出现超时')
    throw error
  })
  logLine(onLog, '搜索框已出现')
  return { input, mouse }
}

async function countVisibleProductModalCandidates(page: Page): Promise<number> {
  return page.evaluate((modalSelector) => {
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 30
    }
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        `${modalSelector} li, ${modalSelector} [role="option"], ${modalSelector} [class*="goods"], ${modalSelector} [class*="product"], ${modalSelector} [class*="item"], ${modalSelector} .product-item, ${modalSelector} .product-card`
      )
    ).filter((element) => isVisible(element)).length
  }, PRODUCT_MODAL_SELECTOR)
}

async function inspectProductModalCandidateDom(page: Page): Promise<{
  candidateCount: number
  checkboxCount: number
  checkboxLikeCount: number
  items: Array<{
    index: number
    text: string
    className: string
    hasNativeCheckbox: boolean
    nativeCheckboxCount: number
    hasCheckboxLike: boolean
    checkboxLikeClasses: string[]
    outerHTML: string
  }>
}> {
  return page.evaluate((modalSelector) => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 30
    }

    const modal =
      document.querySelector<HTMLElement>('[role="dialog"]') ||
      document.querySelector<HTMLElement>('.ant-modal') ||
      document.querySelector<HTMLElement>('.ant-modal-content') ||
      document.querySelector<HTMLElement>('.d-modal')

    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        `${modalSelector} li, ${modalSelector} [role="option"], ${modalSelector} [class*="goods"], ${modalSelector} [class*="product"], ${modalSelector} [class*="item"], ${modalSelector} .product-item, ${modalSelector} .product-card`
      )
    ).filter((element) => isVisible(element))

    return {
      candidateCount: items.length,
      checkboxCount: modal?.querySelectorAll('input[type="checkbox"]').length ?? 0,
      checkboxLikeCount: modal?.querySelectorAll('[role="checkbox"], .ant-checkbox, .ant-checkbox-wrapper, [class*="checkbox"]').length ?? 0,
      items: items.slice(0, 10).map((element, index) => ({
        index,
        text: normalizeText(element.innerText || element.textContent || '').slice(0, 220),
        className: String(element.className || ''),
        hasNativeCheckbox: Boolean(element.querySelector('input[type="checkbox"]')),
        nativeCheckboxCount: element.querySelectorAll('input[type="checkbox"]').length,
        hasCheckboxLike: Boolean(element.querySelector('[role="checkbox"], .ant-checkbox, .ant-checkbox-wrapper, [class*="checkbox"]')),
        checkboxLikeClasses: Array.from(
          element.querySelectorAll<HTMLElement>('[role="checkbox"], .ant-checkbox, .ant-checkbox-wrapper, [class*="checkbox"]')
        )
          .slice(0, 8)
          .map((node) => String(node.className || node.getAttribute('role') || '')),
        outerHTML: element.outerHTML.slice(0, 500)
      }))
    }
  }, PRODUCT_MODAL_SELECTOR)
}

async function markProductModalItemById(page: Page, productId: string): Promise<EditorTarget> {
  const normalizedId = String(productId ?? '').trim()
  const target = await page.evaluate(({ wantedId, modalSelector }) => {
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 30
    }
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        `${modalSelector} li, ${modalSelector} [role="option"], ${modalSelector} [class*="goods"], ${modalSelector} [class*="product"], ${modalSelector} [class*="item"], ${modalSelector} .product-item, ${modalSelector} .product-card`
      )
    ).filter((element) => isVisible(element))

    for (const element of items) {
      const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text || !text.includes(wantedId)) continue
      const rect = element.getBoundingClientRect()
      element.setAttribute('data-cms-cdp-product-row-id', 'true')
      return {
        found: true,
        selector: '[data-cms-cdp-product-row-id="true"]',
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        tagName: element.tagName,
        isContentEditable: false,
        isTextInput: false
      }
    }
    return null
  }, { wantedId: normalizedId, modalSelector: PRODUCT_MODAL_SELECTOR })

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function markFirstProductModalItem(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate((modalSelector) => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 30
    }
    const items = Array.from(
      document.querySelectorAll<HTMLElement>(
        `${modalSelector} li, ${modalSelector} [role="option"], ${modalSelector} [class*="goods"], ${modalSelector} [class*="product"], ${modalSelector} [class*="item"]`
      )
    )
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        const rect = element.getBoundingClientRect()
        const hasPrice = /[¥￥]\s*\d+/.test(text)
        const hasImage = Boolean(element.querySelector('img'))
        let score = 0
        if (hasPrice) score += 50
        if (hasImage) score += 20
        score -= index
        return { element, rect, score }
      })
      .sort((a, b) => b.score - a.score)

    const match = items[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cdp-product-row-first', 'true')
    return {
      found: true,
      selector: '[data-cms-cdp-product-row-first="true"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.element.tagName,
      isContentEditable: false,
      isTextInput: false
    }
  }, PRODUCT_MODAL_SELECTOR)

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function markProductCheckboxWithinTarget(page: Page, rowSelector: string): Promise<EditorTarget> {
  const target = await page.evaluate((targetSelector) => {
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 12 && rect.height > 12
    }

    const row = document.querySelector<HTMLElement>(targetSelector)
    if (!row) return null

    const preferredClickable =
      row.querySelector<HTMLElement>(
        '.d-checkbox.d-checkbox-main, .d-grid.d-checkbox, [role="checkbox"], .ant-checkbox-wrapper, .ant-checkbox'
      ) || null
    const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const clickable =
      preferredClickable ||
      (input
        ? ((input.closest('label, .ant-checkbox-wrapper, [role="checkbox"], .d-checkbox, .d-grid.d-checkbox, div, span') as HTMLElement | null) ||
            input)
        : null)
    if (!clickable) return null
    if (!isVisible(clickable)) return null
    const rect = clickable.getBoundingClientRect()
    clickable.setAttribute('data-cms-cdp-product-checkbox', 'true')
    return {
      found: true,
      selector: '[data-cms-cdp-product-checkbox="true"]',
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      tagName: clickable.tagName,
      isContentEditable: false,
      isTextInput: false
    }
  }, rowSelector)

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function markProductModalConfirmButton(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate((modalSelector) => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 24 && rect.height > 24
    }
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        `${modalSelector} button, ${modalSelector} [role="button"], ${modalSelector} a, ${modalSelector} div[tabindex], ${modalSelector} span[tabindex]`
      )
    )
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        const rect = element.getBoundingClientRect()
        const className = String(element.className || '').toLowerCase()
        const disabled =
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true' ||
          className.includes('disabled')
        let score = 0
        if (text === '确定') score += 500
        else if (text.includes('确定')) score += 320
        else if (text.includes('完成')) score += 220
        else if (text.includes('保存')) score += 180
        if (text.includes('取消')) score -= 400
        if (className.includes('primary') || className.includes('ant-btn-primary')) score += 200
        score += rect.top * 0.01 + rect.left * 0.01
        return { element, index, rect, score, disabled }
      })
      .filter((item) => item.score > 0 && !item.disabled)
      .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cdp-product-confirm', 'true')
    return {
      found: true,
      selector: '[data-cms-cdp-product-confirm="true"]',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      tagName: match.element.tagName,
      isContentEditable: false,
      isTextInput: false
    }
  }, PRODUCT_MODAL_SELECTOR)

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function waitForProductModalClose(page: Page): Promise<void> {
  await waitForCondition(
    async () =>
      page.evaluate((modalSelector) => {
        const input = document.querySelector<HTMLInputElement>(
          `${modalSelector} input.ant-input[placeholder*="搜索"], ${modalSelector} input[placeholder*="搜索"], ${modalSelector} input.ant-input`
        )
        if (!input) return true
        const style = window.getComputedStyle(input)
        const rect = input.getBoundingClientRect()
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 20 || rect.height < 20) return true
        return null
      }, PRODUCT_MODAL_SELECTOR),
    20_000,
    250,
    '商品弹窗未关闭。'
  )
}

async function hasProductAddedIndicator(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8
    }

    const text = normalizeText(document.body?.innerText || document.body?.textContent || '')
    if (/已添加\s*\d+\s*(个|件)?\s*商品/.test(text)) return true
    if (text.includes('已添加') && text.includes('商品')) return true
    if (text.includes('已添加') && /\d+/.test(text)) return true
    const shopSectionMatched = Array.from(document.querySelectorAll<HTMLElement>('div, section, article'))
      .filter((element) => isVisible(element))
      .some((element) => {
        const sectionText = normalizeText(element.innerText || element.textContent || '')
        if (!sectionText.includes('店内商品')) return false
        if (!/商品id[:：]/i.test(sectionText)) return false
        const hasPrice = /[¥￥]\s*\d/.test(sectionText)
        const hasAction = /(删除|改规格)/.test(sectionText)
        const hasImage = Array.from(element.querySelectorAll('img')).some((img) => {
          const rect = img.getBoundingClientRect()
          return rect.width > 24 && rect.height > 24
        })
        return hasPrice && hasAction && hasImage
      })
    if (shopSectionMatched) return true

    const addProductNode = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')).find((element) => {
      if (!isVisible(element)) return false
      const value = normalizeText(element.innerText || element.textContent || '')
      return value.includes('添加商品')
    })

    if (!addProductNode) return false
    const buttonRect = addProductNode.getBoundingClientRect()
    const scope =
      addProductNode.closest<HTMLElement>(
        '[class*="goods"], [class*="product"], [class*="component"], [class*="shop"], .ant-form-item, .ant-space, .ant-row, .ant-col, section, article, main, form'
      ) ||
      addProductNode.parentElement ||
      document.body

    const near = (rect: DOMRect): boolean => {
      const ax = buttonRect.left + buttonRect.width / 2
      const ay = buttonRect.top + buttonRect.height / 2
      const bx = rect.left + rect.width / 2
      const by = rect.top + rect.height / 2
      return Math.abs(ax - bx) <= 260 && Math.abs(ay - by) <= 140
    }

    for (const element of Array.from(
      scope.querySelectorAll<HTMLElement>('.ant-tag, .ant-badge, [class*="tag"], [class*="badge"], [class*="Tag"], [class*="Badge"]')
    )) {
      if (!isVisible(element)) continue
      const value = normalizeText(element.innerText || element.textContent || '')
      if (!value || !near(element.getBoundingClientRect())) continue
      if (value.includes('已添加') || value.includes('1') || /已添加\s*\d+/.test(value)) return true
    }

    for (const raw of Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"], a, [aria-label], [title], i, span'))) {
      const element = raw instanceof HTMLElement ? raw : null
      if (!element || !isVisible(element) || element === addProductNode) continue
      if (!near(element.getBoundingClientRect())) continue
      const value = normalizeText(
        element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || ''
      )
      if (value.includes('删除') || value.includes('编辑')) return true
    }

    return false
  })
}

async function softCheckProductAdded(page: Page): Promise<void> {
  if (await hasProductAddedIndicator(page)) return
  await waitForCondition(async () => ((await hasProductAddedIndicator(page)) ? true : null), 4_000, 400, 'soft-check-timeout').catch(
    () => null
  )
}

export async function addProductById(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  productId: string,
  onLog?: (message: string) => void
): Promise<MouseState> {
  const normalizedId = String(productId ?? '').trim()
  if (!normalizedId) return mouse

  mouse = await dismissPotentialPopups(page, client, mouse)
  const opened = await openProductModalWithRetry(page, client, mouse, onLog)
  mouse = opened.mouse
  await jitterDelay(2_000, 2_050)

  logLine(onLog, `开始输入商品ID: ${normalizedId}`)
  mouse = await clearAndFillTextInput(page, client, mouse, opened.input, normalizedId)
  logLine(onLog, '输入完成')
  await jitterDelay(2_000, 2_050)

  logLine(onLog, '开始等待搜索结果')
  const matchedById = await waitForCondition(
    async () => {
      const match = await markProductModalItemById(page, normalizedId)
      return match.found ? match : null
    },
    8_000,
      250,
      '未在列表中匹配到商品ID。'
    ).catch(() => null)

  const firstSelectable =
    matchedById ??
    (await waitForCondition(
      async () => {
        const item = await markFirstProductModalItem(page)
        return item.found ? item : null
      },
      2_000,
      250,
      '未找到可选商品行。'
    ).catch(() => null))

  const candidateCount = await countVisibleProductModalCandidates(page).catch(() => 0)
  logLine(onLog, `搜索结果出现，候选数量: ${candidateCount}`)
  const candidateDom = await inspectProductModalCandidateDom(page).catch(() => null)
  if (candidateDom) {
    logLine(onLog, `[挂车DOM] ${JSON.stringify(candidateDom)}`)
  }

  if (!firstSelectable) {
    throw new Error(`未在商品列表中找到商品ID: ${normalizedId}`)
  }

  logLine(onLog, '开始勾选商品')
  const checkbox = await markProductCheckboxWithinTarget(page, firstSelectable.selector)
  if (!checkbox.found) {
    logLine(onLog, '未找到可勾选的元素')
  }
  const selectionTarget = checkbox.found ? checkbox : firstSelectable
  const clickableSelection = await ensureSelectorReachableForMouse(page, client, selectionTarget.selector)
  mouse = await humanClick(client, mouse, clickableSelection.centerX, clickableSelection.centerY)
  await jitterDelay(300, 360)
  logLine(onLog, '勾选完成')

  logLine(onLog, '开始点击确认按钮')
  const confirm = await waitForCondition(
    async () => {
      const button = await markProductModalConfirmButton(page)
      return button.found ? button : null
    },
    20_000,
    250,
    '未找到“确定/完成/保存”按钮（弹窗内）。'
  )
  const clickableConfirm = await ensureSelectorReachableForMouse(page, client, confirm.selector)
  mouse = await humanClick(client, mouse, clickableConfirm.centerX, clickableConfirm.centerY)
  logLine(onLog, '确认按钮已点击')
  logLine(onLog, '开始等待弹窗关闭')
  await waitForProductModalClose(page)
    .then(() => {
      logLine(onLog, '弹窗已关闭')
    })
    .catch((error) => {
      logLine(onLog, '弹窗未关闭超时')
      throw error
    })
  return mouse
}

export async function selectProduct(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  productName: string,
  onLog?: (message: string) => void
): Promise<MouseState> {
  const normalizedName = String(productName ?? '').trim()
  if (!normalizedName) return mouse

  const opened = await openProductModalWithRetry(page, client, mouse, onLog)
  mouse = opened.mouse
  logLine(onLog, `开始输入商品ID: ${normalizedName}`)
  mouse = await clearAndFillTextInput(page, client, mouse, opened.input, normalizedName)
  logLine(onLog, '输入完成')
  await jitterDelay(500, 620)

  logLine(onLog, '开始等待搜索结果')
  const firstItem = await waitForCondition(
    async () => {
      const item = await markFirstProductModalItem(page)
      return item.found ? item : null
    },
    20_000,
    250,
    '未找到商品搜索结果。'
  )
  const candidateCount = await countVisibleProductModalCandidates(page).catch(() => 0)
  logLine(onLog, `搜索结果出现，候选数量: ${candidateCount}`)
  const candidateDom = await inspectProductModalCandidateDom(page).catch(() => null)
  if (candidateDom) {
    logLine(onLog, `[挂车DOM] ${JSON.stringify(candidateDom)}`)
  }
  logLine(onLog, '开始勾选商品')
  const checkbox = await markProductCheckboxWithinTarget(page, firstItem.selector)
  if (!checkbox.found) {
    logLine(onLog, '未找到可勾选的元素')
  }
  const selectionTarget = checkbox.found ? checkbox : firstItem
  const clickableItem = await ensureSelectorReachableForMouse(page, client, selectionTarget.selector)
  mouse = await humanClick(client, mouse, clickableItem.centerX, clickableItem.centerY)
  await jitterDelay(300, 360)
  logLine(onLog, '勾选完成')

  logLine(onLog, '开始点击确认按钮')
  const confirm = await waitForCondition(
    async () => {
      const button = await markProductModalConfirmButton(page)
      return button.found ? button : null
    },
    20_000,
    250,
    '未找到“确定/完成/保存”按钮（弹窗内）。'
  )
  const clickableConfirm = await ensureSelectorReachableForMouse(page, client, confirm.selector)
  mouse = await humanClick(client, mouse, clickableConfirm.centerX, clickableConfirm.centerY)
  logLine(onLog, '确认按钮已点击')
  logLine(onLog, '开始等待弹窗关闭')
  await waitForProductModalClose(page)
    .then(() => {
      logLine(onLog, '弹窗已关闭')
    })
    .catch((error) => {
      logLine(onLog, '弹窗未关闭超时')
      throw error
    })
  await jitterDelay(3_000, 3_050)
  return mouse
}

async function addProductCore(
  page: Page,
  client: CDPSession,
  mouse: MouseState,
  productId: string,
  productName: string,
  options: { skipIfAlreadyAdded: boolean; onLog?: (message: string) => void }
): Promise<MouseState> {
  const id = String(productId ?? '').trim()
  const name = String(productName ?? '').trim()
  if (!id && !name) return mouse

  if (options.skipIfAlreadyAdded && (await hasProductAddedIndicator(page))) {
    return mouse
  }

  if (id) {
    try {
      mouse = await addProductById(page, client, mouse, id, options.onLog)
      await softCheckProductAdded(page)
      return mouse
    } catch (error) {
      if (!name) throw error
    }
  }

  if (name) {
    mouse = await selectProduct(page, client, mouse, name, options.onLog)
    await softCheckProductAdded(page)
  }

  return mouse
}

export async function addProductsIfNeeded(
  page: Page,
  client: CDPSession,
  task: CdpPublishTaskInput,
  onLog?: (message: string) => void
): Promise<void> {
  let mouse: MouseState = { x: 40, y: 40 }
  const linkedProducts = Array.isArray(task.linkedProducts)
    ? task.linkedProducts.map((item) => ({
        id: String(item?.id ?? '').trim(),
        name: String(item?.name ?? '').trim()
      }))
    : []

  if (linkedProducts.length === 0) {
    await addProductCore(page, client, mouse, String(task.productId ?? ''), String(task.productName ?? ''), {
      skipIfAlreadyAdded: true,
      onLog
    })
    return
  }

  for (const product of linkedProducts) {
    mouse = await addProductCore(page, client, mouse, product.id, product.name, {
      skipIfAlreadyAdded: false,
      onLog
    })
    await jitterDelay(900, 960)
  }
}

export async function selectCover(
  page: Page,
  client: CDPSession,
  coverPath: string,
  options: SelectCoverOptions = {}
): Promise<void> {
  let mouse: MouseState = { x: 40, y: 40 }
  await ensureMinimumWindowLayout(page, client, 1280, 900)
  const coverViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  logLine(options.onLog, `[封面] 入口前视口 ${coverViewport.width}x${coverViewport.height}`)
  logLine(options.onLog, '[封面] 等待封面区域出现')
  await waitForCoverSectionReady(page)

  let modalOpened = false
  let lastOpenError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    logLine(options.onLog, `[封面] 尝试打开封面弹窗 (${attempt}/3)`)
    const coverEntry = await waitForCondition(
      async () => {
        const target = await markFirstCoverEntry(page)
        return target.found ? target : null
      },
      10_000,
      180,
      '未找到“设置封面”区域下第一个封面框'
    ).catch(async () => {
      const inspection = await inspectCoverEntryCandidates(page).catch((error) =>
        `inspect-failed: ${error instanceof Error ? error.message : String(error)}`
      )
      logLine(options.onLog, `[封面] 候选检查: ${inspection}`)
      return null
    })
    if (!coverEntry?.found) {
      throw new Error('未找到“设置封面”区域下第一个封面框')
    }
    logLine(options.onLog, `[封面] 已锁定候选入口: ${coverEntry.selector}`)
    await scrollSelectorIntoView(page, coverEntry.selector)
    await jitterDelay(120, 420)
    logLine(options.onLog, '[封面] 执行 hover 预热')
    await hoverCoverEntry(page, coverEntry.selector)
    await jitterDelay(180, 520)
    const openButton = await ensureSelectorReachableForMouse(page, client, coverEntry.selector)
    if (!openButton.found) {
      throw new Error('未找到可点击的封面编辑入口')
    }
    logLine(
      options.onLog,
      `[封面] 已计算点击坐标: (${Math.round(openButton.centerX)}, ${Math.round(openButton.centerY)})`
    )

    logLine(options.onLog, '[封面] 开始点击封面入口')
    mouse = await humanClick(client, mouse, openButton.centerX, openButton.centerY)
    logLine(options.onLog, '[封面] 封面入口点击完成')
    await jitterDelay(700, 1200)

    try {
      logLine(options.onLog, '[封面] 等待弹窗可见')
      await waitForCoverModal(page, 2600)
      modalOpened = true
      logLine(options.onLog, '[封面] 已检测到弹窗')
      break
    } catch (error) {
      lastOpenError = error instanceof Error ? error : new Error(String(error))
      logLine(options.onLog, `[封面] 本次打开失败: ${lastOpenError.message}`)
      await jitterDelay(1200, 1800)
    }
  }

  if (!modalOpened) {
    throw lastOpenError ?? new Error('未出现封面弹窗（含上传图片入口）。')
  }

  logLine(options.onLog, '[封面] 记录上传前快照')
  const beforeUploadState = await snapshotCoverModalUploadState(page)
  logLine(options.onLog, '[封面] 定位弹窗内上传 input')
  const modalUploadInput = await waitForCoverUploadInput(page)
  logLine(options.onLog, `[封面] 注入封面文件: ${coverPath}`)
  await setFilesWithCdp(client, modalUploadInput.selector, [coverPath])
  logLine(options.onLog, '[封面] 等待 input.files 生效')
  await waitForCoverFileSelection(page, modalUploadInput.selector)
  logLine(options.onLog, '[封面] 等待“已选中”信号')
  await waitForCoverSelectionSignal(page, coverPath, beforeUploadState)

  logLine(options.onLog, '[封面] 定位确认按钮')
  const confirmButton = await markCoverConfirmButton(page)
  if (!confirmButton.found) {
    throw new Error('未找到封面确认按钮')
  }
  const clickableConfirmButton = await ensureSelectorReachableForMouse(page, client, confirmButton.selector)
  if (!clickableConfirmButton.found) {
    throw new Error('未找到可点击的封面确认按钮')
  }
  mouse = await humanClick(client, mouse, clickableConfirmButton.centerX, clickableConfirmButton.centerY)
  logLine(options.onLog, '[封面] 已点击确认，等待弹窗关闭')
  await waitForCoverModalClose(page)
  logLine(options.onLog, '[封面] 弹窗已关闭')
}

export async function ensureCoverModalDismissed(page: Page, client: CDPSession, mouse: MouseState): Promise<MouseState> {
  const isCoverModalVisible = async (): Promise<boolean> =>
    page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>(
        '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
      )
      if (!modal) return false
      const style = window.getComputedStyle(modal)
      const rect = modal.getBoundingClientRect()
      const text = String(modal.innerText || modal.textContent || '')
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 80 || rect.height < 80) {
        return false
      }
      return /上传封面|裁剪比例|截取封面|设置封面/.test(text)
    })

  if (!(await isCoverModalVisible())) return mouse

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const confirmButton = await markCoverConfirmButton(page)
    if (confirmButton.found) {
      const clickable = await ensureSelectorReachableForMouse(page, client, confirmButton.selector)
      mouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
      await jitterDelay(500, 700)
    } else {
      await page.keyboard.press('Escape').catch(() => void 0)
      await jitterDelay(350, 500)
    }
    if (!(await isCoverModalVisible())) return mouse
  }

  return mouse
}

async function assertNoPublishFormErrors(page: Page): Promise<void> {
  const errorMessage = await page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 4 && rect.height > 4
    }

    const selectors = [
      '.ant-form-item-explain-error',
      '.ant-message-error',
      '.ant-notification-notice-error',
      '[role="alert"]',
      '[aria-invalid="true"]'
    ]
    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector)
      if (!isVisible(element)) continue
      const text = normalizeText(element.innerText || element.textContent || '')
      if (!text) continue
      if (text.includes('标题') || text.includes('过长') || text.includes('不能为空') || text.includes('失败') || text.includes('错误')) {
        return text
      }
    }

    const matched = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .filter((element) => isVisible(element))
      .map((element) => normalizeText(element.innerText || element.textContent || ''))
      .find((text) => {
        if (!text || text.length > 120) return false
        return (
          (text.includes('标题') && (text.includes('过长') || text.includes('太长'))) ||
          text.includes('请完善') ||
          text.includes('不能为空') ||
          text.includes('失败') ||
          text.includes('错误')
        )
      })

    return matched ?? ''
  })

  if (errorMessage) {
    throw new Error(`检测到表单错误提示：${errorMessage}`)
  }
}

async function markPublishButton(page: Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const parseRgb = (value: string): { r: number; g: number; b: number } | null => {
      const match = String(value ?? '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
      if (!match) return null
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }
    }
    const isLikelyRedButton = (element: HTMLElement): boolean => {
      const rgb = parseRgb(window.getComputedStyle(element).backgroundColor || '')
      return Boolean(rgb && rgb.r >= 170 && rgb.g <= 120 && rgb.b <= 120)
    }
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 24 && rect.height > 24
    }
    const isDisabledLike = (element: HTMLElement): boolean => {
      const anyElement = element as HTMLElement & { disabled?: boolean }
      return (
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('disabled') !== null ||
        anyElement.disabled === true
      )
    }

    const directButton =
      (document.querySelector('#publish-container .publish-btn') as HTMLElement | null) ||
      (document.querySelector('#publish-container button.publish-btn') as HTMLElement | null) ||
      (document.querySelector('#publish-container button') as HTMLElement | null) ||
      (document.querySelector('button.publish-btn') as HTMLElement | null) ||
      null

    let bestButton: HTMLElement | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (element): element is HTMLButtonElement => element instanceof HTMLButtonElement && isVisible(element)
    )
    for (const button of buttons) {
      const text = normalizeText(button.innerText || button.textContent || '')
      if (!text || !text.includes('发布')) continue
      if (text.includes('定时') || text.includes('计划') || text.includes('草稿')) continue
      if (button.closest('[role="radio"], [role="radiogroup"], label')) continue
      const rect = button.getBoundingClientRect()
      if (rect.width < 72 || rect.height < 28) continue

      const className = typeof button.className === 'string' ? button.className : ''
      let score = 0
      if (text === '发布') score += 2000
      else if (text.includes('发布')) score += 800
      if (className.includes('publish') || className.includes('Publish')) score += 400
      if (
        className.includes('primary') ||
        className.includes('Primary') ||
        className.includes('ant-btn-primary')
      ) {
        score += 250
      }
      if (isLikelyRedButton(button)) score += 600
      if (!isDisabledLike(button)) score += 200
      score += Math.min(200, rect.width * rect.height * 0.01)
      score += Math.max(0, 1200 - rect.top) * 0.01
      if (button.closest('#publish-container')) score += 500

      if (score > bestScore) {
        bestScore = score
        bestButton = button
      }
    }

    const directText = directButton
      ? normalizeText(directButton.innerText || directButton.textContent || '')
      : ''
    const publishButton =
      (directButton && directText.includes('发布') && !isDisabledLike(directButton)
        ? directButton
        : null) || bestButton
    if (!publishButton || isDisabledLike(publishButton)) return null
    const rect = publishButton.getBoundingClientRect()
    publishButton.setAttribute('data-cms-cdp-publish-button', 'true')
    return {
      found: true,
      selector: '[data-cms-cdp-publish-button="true"]',
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      tagName: publishButton.tagName,
      isContentEditable: false,
      isTextInput: false
    }
  })

  return target ?? { found: false, selector: '', centerX: 0, centerY: 0, tagName: '', isContentEditable: false, isTextInput: false }
}

async function waitForPublishButton(page: Page): Promise<EditorTarget> {
  return waitForCondition(
    async () => {
      const target = await markPublishButton(page)
      return target.found ? target : null
    },
    30_000,
    250,
    '未找到发布按钮（可能页面结构变化）。'
  )
}

async function highlightSelector(page: Page, selector: string, color = '#ef4444'): Promise<void> {
  await page.evaluate(
    ({ targetSelector, targetColor }) => {
      const element = document.querySelector<HTMLElement>(targetSelector)
      if (!element) return
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.style.outline = `8px solid ${targetColor}`
      element.style.outlineOffset = '4px'
      element.style.borderRadius = '8px'
      element.style.boxShadow = `0 0 0 4px rgba(255,255,255,0.65), 0 0 18px ${targetColor}`
    },
    { targetSelector: selector, targetColor: color }
  )
}

async function prepareDryRunPublish(page: Page, mediaType: 'video' | 'image', onLog?: (message: string) => void): Promise<void> {
  logLine(onLog, '开始：发布前校验')
  if (mediaType === 'image') {
    await scrollPublishAreaToBottom(page)
  }
  await assertNoPublishFormErrors(page)
  const publishButton = await waitForPublishButton(page)
  await highlightSelector(page, publishButton.selector)
  logLine(onLog, '[干跑] 已定位发布按钮（高亮，未点击）')
  logLine(onLog, '完成：发布前校验')
}

async function didPublishClickTakeEffect(page: Page): Promise<boolean> {
  const result = await waitForCondition(
    async () => {
      const state = await page.evaluate(() => {
        const text = String(document.body?.innerText ?? '')
        const button = document.querySelector<HTMLElement>('[data-cms-cdp-publish-button="true"]')
        if (/发布成功|已发布/.test(text)) return true
        if (!button) return true
        const className = typeof button.className === 'string' ? button.className.toLowerCase() : ''
        const disabled =
          button.getAttribute('aria-disabled') === 'true' ||
          button.getAttribute('disabled') !== null ||
          (button as HTMLElement & { disabled?: boolean }).disabled === true
        if (disabled) return true
        if (className.includes('loading') || className.includes('ant-btn-loading')) return true
        return null
      })
      return state ? true : null
    },
    1_500,
    250,
    '发布点击未生效（将尝试清除遮罩并重试）。'
  ).catch(() => null)

  return Boolean(result)
}

export async function clickPublish(page: Page, client: CDPSession): Promise<void> {
  const button = await waitForPublishButton(page)
  await highlightSelector(page, button.selector)
  let mouse: MouseState = { x: 40, y: 40 }
  mouse = await humanClick(client, mouse, button.centerX, button.centerY)
  if (await didPublishClickTakeEffect(page)) return

  const neutral = await markNeutralDismissTarget(page)
  if (neutral.found) {
    const clickableNeutral = await ensureSelectorReachableForMouse(page, client, neutral.selector)
    if (clickableNeutral.found) {
      mouse = await humanClick(client, mouse, clickableNeutral.centerX, clickableNeutral.centerY)
      await jitterDelay(450, 650)
    }
  }

  const refreshed = await waitForPublishButton(page)
  await highlightSelector(page, refreshed.selector)
  mouse = await humanClick(client, mouse, refreshed.centerX, refreshed.centerY)
  await jitterDelay(1_200, 1_800)
}

async function waitForPublishSuccess(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      return {
        success:
          /发布成功|已发布/.test(text) ||
          (!document.querySelector('[data-cms-cdp-publish-button="true"]') &&
            !/\/login/i.test(location.href)),
        finalUrl: location.href
      }
    })
    if (state.success) return new Date().toISOString()
    await jitterDelay(500, 900)
  }
  throw new Error('发布结果未确认（可能页面结构变化或网络异常）。')
}

type SharedPostUploadFlowOptions = {
  page: Page
  client: CDPSession
  task: CdpPublishTaskInput
  mediaType: 'video' | 'image'
  title: string
  content: string
  tagsInContent: string[]
  extraTags: string[]
  dryRun: boolean
  onLog?: (message: string) => void
}

async function runSharedPostUploadEditorFlow(options: SharedPostUploadFlowOptions): Promise<{
  published: boolean
  time?: string
  safetyCheck?: CmsPublishSafetyCheck
}> {
  const { page, client, task, mediaType, title, content, tagsInContent, extraTags, dryRun, onLog } = options

  const beforeViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  if (beforeViewport.width !== 1280 || beforeViewport.height !== 900) {
    logLine(onLog, `[共享流程] 进入前视口 ${beforeViewport.width}x${beforeViewport.height}，恢复到 1280x900`)
  }
  await page.setViewport({ width: 1280, height: 900 })
  await jitterDelay(120, 180)
  const restoredViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  logLine(onLog, `[共享流程] 当前视口 ${restoredViewport.width}x${restoredViewport.height}`)

  logLine(onLog, '开始：填写文案')
  if (title) {
    await safeFillTitle(page, client, title)
    await observationDelay(1_000, 1_900, 3_000, onLog, '标题填写后停顿')
  }
  if (content) {
    await safeFillContentAndTags(page, client, content, extraTags)
    await observationDelay(1_000, 1_400, 2_000, onLog, '正文填写后检查')
  }
  if (!content && extraTags.length > 0) {
    await fillTagsAsBlueTopics(page, client, extraTags)
  }
  if (extraTags.length > 0 || tagsInContent.length > 0) {
    await observationDelay(1_000, 1_500, 2_000, onLog, '话题渲染后确认')
  }
  logLine(onLog, '完成：填写文案')

  if (hasProductBinding(task)) {
    logLine(onLog, '开始：挂车商品')
    let productMouse: MouseState = { x: 40, y: 40 }
    productMouse = await ensureCoverModalDismissed(page, client, productMouse)
    await addProductsIfNeeded(page, client, task, onLog)
    logLine(onLog, '完成：挂车商品')
  }

  if (dryRun) {
    await prepareDryRunPublish(page, mediaType, onLog)
    const safetyCheck = await tryCollectSafetyCheck(page, client, onLog)
    return { published: false, safetyCheck }
  }

  logLine(onLog, '开始：点击发布')
  if (mediaType === 'video') {
    await checkVideoReady(page, { onLog })
  }
  await observationDelay(2_000, 2_900, 4_000, onLog, '发布前最后确认')
  await clickPublish(page, client)
  const time = await waitForPublishSuccess(page)
  logLine(onLog, '完成：点击发布')
  const safetyCheck = await tryCollectSafetyCheck(page, client, onLog)
  return { published: true, time, safetyCheck }
}

export async function runXhsPublishWithCdp(input: CdpPublishRunOptions): Promise<{
  published: boolean
  time?: string
  safetyCheck?: CmsPublishSafetyCheck
}> {
  const { browser, task, workspacePath, dryRun = true, windowMode = dryRun ? 'visible' : 'offscreen', onLog } = input
  const page = await browser.newPage()
  const client = await page.target().createCDPSession()

  await prepareStealthPage(page)
  await page.goto(XHS_PUBLISH_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  })
  await jitterDelay(1000, 1800)

  const login = await checkCreatorLogin(page)
  if (!login.loggedIn) {
    throw new Error(`当前 CMS Profile 登录态无效：${login.reason}`)
  }

  await installSafetyEventLog(page)

  const windowPlacement = await setChromeWindowMode(page, windowMode)
  logLine(onLog, `[窗口模式] ${windowPlacement.message}`)

  const mediaType = task.mediaType === 'video' ? 'video' : 'image'
  const title = String(task.title ?? '').trim()
  const content = String(task.content ?? '').trim()
  const tagsInContent = normalizeTagList(content)
  const extraTags = normalizeExplicitTags(task.tags).filter((tag) => !tagsInContent.includes(tag))
  const images = Array.isArray(task.images)
    ? task.images
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => resolveUploadFilePath(item, workspacePath))
    : []

  logLine(onLog, '开始：初始化')
  logLine(onLog, '完成：初始化')

  if (mediaType === 'video') {
    const videoPath = resolveUploadFilePath(String(task.videoPath ?? '').trim(), workspacePath)
    logLine(onLog, '开始：上传视频')
    await uploadVideo(page, client, videoPath)
    logLine(onLog, '完成：上传视频')
    await observationDelay(2_000, 3_400, 5_000, onLog, '上传视频后观察预览')

    logLine(onLog, '开始：上传视频封面')
    if (task.videoCoverMode === 'manual' && images[0]) {
      await selectCover(page, client, images[0], { onLog })
    } else {
      logLine(onLog, '使用默认首帧，跳过手动设置封面')
    }
    logLine(onLog, '完成：上传视频封面')
  } else {
    if (images.length === 0) throw new Error('图文任务缺少 images')
    logLine(onLog, '开始：图片上传')
    await uploadImages(page, client, images)
    logLine(onLog, '完成：图片上传')
  }

  return runSharedPostUploadEditorFlow({
    page,
    client,
    task,
    mediaType,
    title,
    content,
    tagsInContent,
    extraTags,
    dryRun,
    onLog
  })
}
