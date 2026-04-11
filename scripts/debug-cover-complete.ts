import os from 'node:os'
import { resolve } from 'node:path'

import type { CDPSession, Page } from 'puppeteer'

import {
  findCmsProfileRecord,
  getCmsChromeDataDir,
  loadCmsAccountsConfig,
  parseProfileArgument
} from './chrome-profile-utils.ts'
import {
  checkCreatorLogin,
  closeBrowserSafely,
  delay,
  launchCmsProfileBrowser,
  prepareStealthPage
} from './cms-profile-runtime.ts'
import { humanClick, type MouseState } from './lib/human-input.ts'

const DEFAULT_PROFILE = 'cms-profile-2'
const DEFAULT_VIDEO_PATH = resolve('/Users/z/图片中转站/手机包/IMG_1009.MOV')
const DEFAULT_COVER_PATH = resolve('assets/images/4fa84b849c8b15a88329470a7ddd63e79398852b.jpg')
type CoverModalUploadSnapshot = {
  text: string
  imageSources: string[]
  selectedFileCount: number
  fileValues: string[]
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profileId = parseOptionalProfile(argv)
  const videoPath = parseOptionalValue(argv, '--video', DEFAULT_VIDEO_PATH)
  const coverPath = parseOptionalValue(argv, '--cover', DEFAULT_COVER_PATH)
  const homeDir = os.homedir()
  const config = await loadCmsAccountsConfig(homeDir)
  if (!config) throw new Error('未找到 cms-accounts.json')
  const profile = findCmsProfileRecord(config, profileId)

  const browser = await launchCmsProfileBrowser({
    executablePath: config.chromeExecutable,
    userDataDir: getCmsChromeDataDir(homeDir),
    profileDir: profile.profileDir
  })

  try {
    const page = await browser.newPage()
    const client = await page.target().createCDPSession()
    let mouse: MouseState = { x: 40, y: 40 }

    await prepareStealthPage(page)
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    })
    await delay(5_500)
    await injectTrustedEventLog(page)

    const login = await checkCreatorLogin(page)
    if (!login.loggedIn) throw new Error(`登录态无效: ${login.reason}`)

    const videoSelector = await markVideoUploadInput(page)
    if (!videoSelector) throw new Error('未找到视频上传 input[type=file]')
    await setFilesWithCdp(client, videoSelector, [videoPath])
    await waitForVideoReady(page)
    await waitForCoverSectionReady(page)
    await delay(500)

    let coverTarget = await markCompactCoverButton(page)
    if (!coverTarget) throw new Error('未找到修改封面入口')
    coverTarget = await ensureDebugTargetInViewport(page, coverTarget.selector)
    console.log(`封面入口: ${coverTarget.summary}`)
    let modalOpened = false
    let lastOpenError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      mouse = await humanClick(client, mouse, coverTarget.centerX, coverTarget.centerY)
      try {
        await waitForCoverModal(page)
        modalOpened = true
        break
      } catch (error) {
        lastOpenError = error
        await delay(900)
      }
    }
    if (!modalOpened) {
      throw lastOpenError instanceof Error ? lastOpenError : new Error(String(lastOpenError))
    }
    console.log('封面弹窗已出现')

    const beforeUpload = await snapshotCoverModalUploadState(page)
    const coverInputSelector = await waitForCoverUploadInput(page)
    await setFilesWithCdp(client, coverInputSelector, [coverPath])
    await dispatchFileInputEvents(page, coverInputSelector)
    await waitForCoverFileSelection(page, coverInputSelector)
    await waitForCoverSelectionSignal(page, coverPath, beforeUpload)
    console.log('封面文件已被页面接受')

    let confirmButton = await markCoverConfirmButton(page)
    if (!confirmButton) throw new Error('未找到封面确认按钮')
    confirmButton = await ensureDebugTargetInViewport(page, confirmButton.selector)
    console.log(`确认按钮: ${confirmButton.summary}`)
    await delay(1_000)
    let closed = false
    let lastCloseError: unknown = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const beforeConfirm = await inspectConfirmHitTarget(page, confirmButton.centerX, confirmButton.centerY)
      console.log(JSON.stringify({ confirmAttempt: attempt, confirmBeforeState: beforeConfirm }, null, 2))
      mouse = await humanClick(client, mouse, confirmButton.centerX, confirmButton.centerY)
      try {
        await waitForCoverModalClose(page)
        closed = true
        break
      } catch (error) {
        lastCloseError = error
        const modalState = await inspectModalDetails(page)
        const eventLog = await readTrustedEventLog(page)
        console.log(JSON.stringify({ confirmAttempt: attempt, confirmAfterState: modalState, recentEvents: eventLog.slice(-20) }, null, 2))
        await delay(800)
      }
    }
    if (!closed) {
      const domClickState = await tryDomConfirmClick(page)
      console.log(JSON.stringify({ domClickFallback: domClickState }, null, 2))
      if (domClickState.closed) {
        closed = true
      }
    }
    if (!closed) {
      throw lastCloseError instanceof Error ? lastCloseError : new Error(String(lastCloseError))
    }
    console.log('封面弹窗已关闭')

    const finalState = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      return {
        url: location.href,
        hasCoverModal: Boolean(
          document.querySelector('[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root')
        ),
        hints: text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /封面|重新上传|上传图片|智能推荐封面|封面预览/.test(line))
          .slice(0, 20)
      }
    })
    console.log(JSON.stringify({ ok: true, finalState }, null, 2))

    await delay(5_000)
  } finally {
    await closeBrowserSafely(browser)
  }
}

function parseOptionalProfile(argv: string[]): string {
  const index = argv.indexOf('--profile')
  if (index === -1) return DEFAULT_PROFILE
  return parseProfileArgument(argv)
}

function parseOptionalValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag)
  if (index === -1) return fallback
  const value = argv[index + 1]?.trim()
  if (!value) throw new Error(`缺少 ${flag} 参数值`)
  return resolve(value)
}

async function markVideoUploadInput(page: Page): Promise<string> {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    const scored = inputs
      .map((input, index) => {
        const attrs = [input.accept, input.name, input.id, input.className].join(' ').toLowerCase()
        let score = 0
        if (attrs.includes('video')) score += 10
        if (attrs.includes('mp4') || attrs.includes('mov')) score += 5
        score -= index
        return { input, score }
      })
      .sort((a, b) => b.score - a.score)
    const target = scored[0]?.input
    if (!target) return ''
    target.setAttribute('data-cms-debug-video-upload', 'true')
    return 'input[type="file"][data-cms-debug-video-upload="true"]'
  })
}

async function markCompactCoverButton(page: Page): Promise<{
  selector: string
  summary: string
  centerX: number
  centerY: number
} | null> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
    const summarize = (element: HTMLElement): string => {
      const rect = element.getBoundingClientRect()
      const text = normalizeText(element.innerText || element.textContent || '')
      return `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${text.slice(0, 100)}"`
    }

    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')
    )
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        let score = 0
        if (text.includes('修改封面')) score += 160
        if (text.includes('替换封面') || text.includes('更换封面')) score += 140
        if (text.includes('设置封面')) score += 80
        if (element.tagName === 'BUTTON') score += 20
        if (rect.width >= 48 && rect.width <= 260) score += 30
        if (rect.height >= 32 && rect.height <= 220) score += 20
        if (text.length <= 40) score += 20
        if (text.length > 120) score -= 80
        if (rect.width > 320 || rect.height > 240) score -= 120
        if (style.display === 'none' || style.visibility === 'hidden') score -= 400
        return { element, index, rect, score }
      })
      .filter((item) => item.score > 0 && item.rect.width > 16 && item.rect.height > 16)
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-debug-cover-open', 'true')
    return {
      selector: '[data-cms-debug-cover-open="true"]',
      summary: summarize(match.element),
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2
    }
  })
}

async function markCoverUploadInput(page: Page): Promise<string> {
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
    if (!target || scored[0]!.score <= 0) return ''
    target.setAttribute('data-cms-debug-cover-upload', 'true')
    return 'input[type="file"][data-cms-debug-cover-upload="true"]'
  })
}

async function waitForCoverUploadInput(page: Page): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    const selector = await markCoverUploadInput(page)
    if (selector) return selector
    await delay(200)
  }
  throw new Error('未找到封面上传 input[type=file]')
}

async function markCoverConfirmButton(page: Page): Promise<{
  selector: string
  summary: string
  centerX: number
  centerY: number
} | null> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
    const summarize = (element: HTMLElement): string => {
      const rect = element.getBoundingClientRect()
      const text = normalizeText(element.innerText || element.textContent || '')
      return `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${text.slice(0, 100)}"`
    }

    const modal = document.querySelector<HTMLElement>(
      '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
    )
    if (!modal) return null
    const candidates = Array.from(
      modal.querySelectorAll<HTMLElement>('button, [role="button"], a, div[tabindex], span[tabindex]')
    )
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
        return { element, index, rect, score, disabled }
      })
      .filter((item) => item.score > 0 && item.rect.width > 24 && item.rect.height > 24 && !item.disabled)
      .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left)
    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-debug-cover-confirm', 'true')
    return {
      selector: '[data-cms-debug-cover-confirm="true"]',
      summary: summarize(match.element),
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2
    }
  })
}

async function setFilesWithCdp(client: CDPSession, selector: string, files: string[]): Promise<void> {
  const documentNode = await client.send('DOM.getDocument', { depth: 2 })
  const node = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  if (!node.nodeId) throw new Error(`未能定位上传元素: ${selector}`)
  await client.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files })
  await delay(1_000)
}

async function dispatchFileInputEvents(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const input = document.querySelector<HTMLInputElement>(targetSelector)
    if (!input) return
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector)
  await delay(300)
}

async function waitForVideoReady(page: Page): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 120_000) {
    const state = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      const hasUploading = /上传中|处理中|转码中|上传失败/.test(text)
      const hasCoverText =
        text.includes('设置封面') &&
        (text.includes('封面预览') ||
          text.includes('智能推荐封面') ||
          text.includes('默认截取第一帧作为封面'))
      const hasVideo = document.querySelectorAll('video').length > 0 || /重新上传|更换视频|替换视频/.test(text)
      return { hasUploading, hasCoverText, hasVideo }
    })
    if (state.hasVideo && state.hasCoverText && !state.hasUploading) return
    await delay(2_000)
  }
  throw new Error('等待视频与封面区就绪超时')
}

async function waitForCoverSectionReady(page: Page): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const ready = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      const hasCoverText = text.includes('设置封面')
      const hasPreviewText =
        text.includes('封面预览') ||
        text.includes('智能推荐封面') ||
        text.includes('优质封面示例') ||
        text.includes('默认截取第一帧作为封面')
      return hasCoverText && hasPreviewText
    })
    if (ready) return
    await delay(300)
  }
  throw new Error('封面区未就绪')
}

async function waitForCoverModal(page: Page): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    const hasModal = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>(
        '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
      )
      if (!modal) return false
      const style = window.getComputedStyle(modal)
      const rect = modal.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 80 && rect.height > 80
    })
    if (hasModal) return
    await delay(220)
  }
  throw new Error('未出现封面弹窗（含上传图片入口）。')
}

async function waitForCoverModalClose(page: Page): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    const hasModal = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>(
        '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
      )
      if (!modal) return false
      const style = window.getComputedStyle(modal)
      const rect = modal.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 20
    })
    if (!hasModal) return
    await delay(220)
  }
  throw new Error('封面弹窗未关闭')
}

async function inspectModalDetails(page: Page): Promise<{
  hasModal: boolean
  modalText: string
  buttons: string[]
  fileInputCount: number
}> {
  return page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>(
      '[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root'
    )
    const text = (modal?.innerText || modal?.textContent || '').replace(/\s+/g, ' ').trim()
    const buttons = Array.from(
      modal?.querySelectorAll<HTMLElement>('button, [role="button"], a, div[tabindex], span[tabindex]') ?? []
    ).map((element) => {
      const rect = element.getBoundingClientRect()
      const label = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      return `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${label.slice(0, 80)}"`
    })
    return {
      hasModal: Boolean(modal),
      modalText: text.slice(0, 500),
      buttons,
      fileInputCount: document.querySelectorAll('input[type="file"]').length
    }
  })
}

async function ensureDebugTargetInViewport(
  page: Page,
  selector: string
): Promise<{
  selector: string
  summary: string
  centerX: number
  centerY: number
}> {
  const scrollTargetIntoView = async (): Promise<void> => {
    await page.evaluate((targetSelector) => {
      const element = document.querySelector<HTMLElement>(targetSelector)
      if (!element) return
      try {
        element.scrollIntoView({ block: 'center', inline: 'center' })
      } catch (error) {
        void error
      }
    }, selector)
  }

  const readSnapshot = async (): Promise<{
    selector: string
    summary: string
    centerX: number
    centerY: number
    rect: { right: number; bottom: number }
    viewport: { width: number; height: number }
  }> =>
    page.evaluate((targetSelector) => {
      const element = document.querySelector<HTMLElement>(targetSelector)
      if (!element) {
        throw new Error(`未找到调试目标: ${targetSelector}`)
      }
      const rect = element.getBoundingClientRect()
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      return {
        selector: targetSelector,
        summary: `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${text.slice(0, 100)}"`,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        rect: {
          right: rect.right,
          bottom: rect.bottom
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight
        }
      }
    }, selector)

  await scrollTargetIntoView()
  await delay(150)
  let snapshot = await readSnapshot()

  if (snapshot.rect.right > snapshot.viewport.width - 8 || snapshot.rect.bottom > snapshot.viewport.height - 8) {
    await page.setViewport({
      width: Math.min(1800, Math.max(1280, Math.round(Math.max(snapshot.viewport.width, snapshot.rect.right + 120)))),
      height: Math.min(1400, Math.max(900, Math.round(Math.max(snapshot.viewport.height, snapshot.rect.bottom + 160))))
    })
    await delay(180)
    await scrollTargetIntoView()
    await delay(150)
    snapshot = await readSnapshot()
  }

  return {
    selector: snapshot.selector,
    summary: snapshot.summary,
    centerX: snapshot.centerX,
    centerY: snapshot.centerY
  }
}

async function injectTrustedEventLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as typeof window & { __cmsCoverEventLog?: unknown[] }).__cmsCoverEventLog = []
    const push = (entry: Record<string, unknown>) => {
      ;(window as typeof window & { __cmsCoverEventLog: unknown[] }).__cmsCoverEventLog.push({
        ...entry,
        ts: Date.now()
      })
    }
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null
        push({
          type: 'click',
          isTrusted: event.isTrusted,
          tag: target?.tagName ?? '',
          text: (target?.innerText || target?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          className: String(target?.className || '').slice(0, 120)
        })
      },
      true
    )
    document.addEventListener(
      'mousedown',
      (event) => {
        const target = event.target as HTMLElement | null
        push({
          type: 'mousedown',
          isTrusted: event.isTrusted,
          tag: target?.tagName ?? '',
          text: (target?.innerText || target?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          className: String(target?.className || '').slice(0, 120)
        })
      },
      true
    )
  })
}

async function readTrustedEventLog(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => ((window as typeof window & { __cmsCoverEventLog?: Array<Record<string, unknown>> }).__cmsCoverEventLog ?? []))
}

async function inspectConfirmHitTarget(
  page: Page,
  x: number,
  y: number
): Promise<{
  elementFromPoint: string
  buttonSummary: string
  buttonDisabled: boolean
  buttonPointerEvents: string
}> {
  return page.evaluate(
    ({ hitX, hitY }) => {
      const summarize = (element: HTMLElement | null): string => {
        if (!element) return ''
        const rect = element.getBoundingClientRect()
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
        return `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${text.slice(0, 80)}"`
      }
      const hit = document.elementFromPoint(hitX, hitY) as HTMLElement | null
      const button = document.querySelector<HTMLElement>('[data-cms-debug-cover-confirm="true"]')
      const buttonClassName = String(button?.className || '').toLowerCase()
      const buttonDisabled = Boolean(
        !button ||
          button.hasAttribute('disabled') ||
          button.getAttribute('aria-disabled') === 'true' ||
          buttonClassName.includes('disabled')
      )
      const buttonPointerEvents = button ? window.getComputedStyle(button).pointerEvents : ''
      return {
        elementFromPoint: summarize(hit),
        buttonSummary: summarize(button),
        buttonDisabled,
        buttonPointerEvents
      }
    },
    { hitX: x, hitY: y }
  )
}

async function tryDomConfirmClick(
  page: Page
): Promise<{ attempted: boolean; closed: boolean; error: string | null; recentEvents: Array<Record<string, unknown>> }> {
  try {
    const attempted = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[data-cms-debug-cover-confirm="true"]')
      if (!button) return false
      button.click()
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return true
    })
    if (!attempted) {
      return { attempted: false, closed: false, error: '未找到确认按钮', recentEvents: await readTrustedEventLog(page) }
    }
    let closed = false
    try {
      await waitForCoverModalClose(page)
      closed = true
    } catch (error) {
      void error
    }
    return {
      attempted: true,
      closed,
      error: null,
      recentEvents: (await readTrustedEventLog(page)).slice(-20)
    }
  } catch (error) {
    return {
      attempted: true,
      closed: false,
      error: error instanceof Error ? error.message : String(error),
      recentEvents: (await readTrustedEventLog(page)).slice(-20)
    }
  }
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
    return { text, imageSources, selectedFileCount, fileValues }
  })
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
  return uploadWords.some((word) => now.text.includes(word)) && (imageChanged || textChanged)
}

async function waitForCoverFileSelection(page: Page, selector: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 6_000) {
    const ready = await page.evaluate((targetSelector) => {
      const input = document.querySelector<HTMLInputElement>(targetSelector)
      return (input?.files?.length ?? 0) > 0
    }, selector)
    if (ready) return
    await delay(180)
  }
  throw new Error('未确认封面文件已注入到上传 input')
}

async function waitForCoverSelectionSignal(
  page: Page,
  coverPath: string,
  baseline: CoverModalUploadSnapshot
): Promise<void> {
  const normalizedBaseline: CoverModalUploadSnapshot = {
    ...baseline,
    imageSources: baseline.imageSources.map((src) => normalizeImageSrcForCompare(src))
  }
  const startedAt = Date.now()
  while (Date.now() - startedAt < 7_000) {
    const current = await snapshotCoverModalUploadState(page)
    const normalizedCurrent: CoverModalUploadSnapshot = {
      ...current,
      imageSources: current.imageSources.map((src) => normalizeImageSrcForCompare(src))
    }
    if (hasCoverSelectionSignal(normalizedCurrent, coverPath, normalizedBaseline)) return
    await delay(180)
  }
  throw new Error('未确认封面已选中，已停止后续“确定”点击。')
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`调试失败: ${message}`)
  process.exitCode = 1
})
