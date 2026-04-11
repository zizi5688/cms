import os from 'node:os'
import { resolve } from 'node:path'

import type { Page } from 'puppeteer'

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
type TargetInfo = {
  found: boolean
  strategy: string
  selector: string
  summary: string
  centerX: number
  centerY: number
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profileId = parseOptionalProfile(argv)
  const videoPath = parseOptionalVideoPath(argv)
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

    const login = await checkCreatorLogin(page)
    if (!login.loggedIn) throw new Error(`登录态无效: ${login.reason}`)

    const uploadSelector = await markVideoUploadInput(page)
    if (!uploadSelector) throw new Error('未找到视频上传 input')
    await setFilesWithCdp(client, uploadSelector, [videoPath])
    await waitForVideoReady(page)
    await waitForCoverSectionReady(page)

    const candidates = await inspectCoverOpenCandidates(page)
    console.log('\n=== 候选入口 ===')
    console.log(JSON.stringify(candidates, null, 2))

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const target = await pickCurrentCoverTarget(page)
      console.log(`\n=== 尝试 ${attempt} ===`)
      console.log(JSON.stringify(target, null, 2))
      if (!target.found) throw new Error('未找到封面入口 target')

      mouse = await humanClick(client, mouse, target.centerX, target.centerY)
      await delay(900)

      const modalState = await inspectModalState(page)
      console.log(JSON.stringify(modalState, null, 2))
      if (modalState.hasModal) {
        console.log('已成功打开封面弹窗。')
        await delay(10_000)
        return
      }
      await delay(1_200)
    }

    throw new Error('3 次点击后仍未打开封面弹窗')
  } finally {
    await closeBrowserSafely(browser)
  }
}

function parseOptionalProfile(argv: string[]): string {
  const index = argv.indexOf('--profile')
  if (index === -1) return DEFAULT_PROFILE
  return parseProfileArgument(argv)
}

function parseOptionalVideoPath(argv: string[]): string {
  const index = argv.indexOf('--video')
  if (index === -1) return DEFAULT_VIDEO_PATH
  const value = argv[index + 1]?.trim()
  if (!value) throw new Error('缺少 --video 参数值')
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

async function setFilesWithCdp(
  client: import('puppeteer').CDPSession,
  selector: string,
  files: string[]
): Promise<void> {
  const documentNode = await client.send('DOM.getDocument', { depth: 2 })
  const node = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  if (!node.nodeId) throw new Error(`未能定位上传元素: ${selector}`)
  await client.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files })
  await delay(1_000)
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
      const hasClickableCover = Boolean(
        document.querySelector(
          '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover-frame"], [class*="coverFrame"], [class*="cover"] img, [class*="cover"] canvas'
        )
      )
      return hasCoverText && (hasPreviewText || hasClickableCover)
    })
    if (ready) return
    await delay(300)
  }
  throw new Error('封面区未就绪')
}

async function pickCurrentCoverTarget(page: Page): Promise<TargetInfo> {
  return page.evaluate(() => {
    const summarizeElement = (element: HTMLElement | null): string => {
      if (!element) return ''
      const rect = element.getBoundingClientRect()
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      return [
        element.tagName.toLowerCase(),
        element.id ? `#${element.id}` : '',
        typeof element.className === 'string' && element.className
          ? `.${element.className.replace(/\s+/g, '.')}`
          : '',
        `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)}`,
        text ? `text="${text.slice(0, 120)}"` : ''
      ]
        .filter(Boolean)
        .join(' ')
    }

    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 24 && rect.height >= 24
    }

    const findClickableAncestor = (element: HTMLElement | null): HTMLElement | null => {
      if (!element) return null
      return (
        element.closest<HTMLElement>(
          'button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn, label'
        ) ?? element
      )
    }

    const anchorTexts = ['设置封面', '智能推荐封面', '推荐封面']
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('div, span, button, h1, h2, h3'))
      .find((element) => anchorTexts.some((text) => (element.innerText || '').includes(text)))

    const textButtons = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')
    )
      .map((element, index) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        const rect = element.getBoundingClientRect()
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
        return { element, rect, index, score }
      })
      .filter((item) => item.score > 0 && isVisible(item.element))
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const bestButton = textButtons[0]
    if (bestButton) {
      return {
        found: true,
        strategy: 'text-button',
        selector: 'button, [role="button"], a, div, span',
        summary: summarizeElement(bestButton.element),
        centerX: bestButton.rect.left + bestButton.rect.width / 2,
        centerY: bestButton.rect.top + bestButton.rect.height / 2
      }
    }

    const searchRoots = [
      anchor?.closest<HTMLElement>('#publish-container, section, article, form, main, div') ?? null,
      document.querySelector<HTMLElement>('#publish-container'),
      document.body
    ]
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

    const scoredTargets: Array<{ element: HTMLElement; score: number; rect: DOMRect }> = []
    const seen = new Set<HTMLElement>()
    for (const root of searchRoots) {
      if (!root) continue
      const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector))
      for (const node of nodes) {
        const target = findClickableAncestor(
          node.closest<HTMLElement>(
            '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover"], [class*="Cover"], [class*="thumbnail"], [class*="poster"], li'
          ) ?? node
        )
        if (!target || seen.has(target) || !isVisible(target)) continue
        if (target.closest('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')) continue

        const rect = target.getBoundingClientRect()
        const classNames = `${String(target.className || '')} ${String(target.parentElement?.className || '')}`.toLowerCase()
        const text = normalizeText(target.innerText || target.textContent || '')
        let score = 0
        if (classNames.includes('cover')) score += 360
        if (classNames.includes('recommend')) score += 120
        if (classNames.includes('poster') || classNames.includes('thumbnail')) score += 120
        if (text.includes('修改封面') || text.includes('替换封面') || text.includes('更换封面')) score += 320
        if (target.closest('#publish-container')) score += 120
        if (target.querySelector('img, canvas, video')) score += 40
        seen.add(target)
        scoredTargets.push({ element: target, score, rect })
      }
    }
    scoredTargets.sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    const bestCover = scoredTargets[0]
    if (bestCover) {
      return {
        found: true,
        strategy: 'cover-entry',
        selector,
        summary: summarizeElement(bestCover.element),
        centerX: bestCover.rect.left + bestCover.rect.width / 2,
        centerY: bestCover.rect.top + bestCover.rect.height / 2
      }
    }

    return { found: false, strategy: 'none', selector: '', summary: '', centerX: 0, centerY: 0 }
  })
}

async function inspectModalState(page: Page): Promise<{
  hasModal: boolean
  modalSummaries: string[]
  fileInputCount: number
}> {
  return page.evaluate(() => {
    const summarize = (element: HTMLElement): string => {
      const rect = element.getBoundingClientRect()
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      return `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${text.slice(0, 120)}"`
    }
    const modals = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"], .d-modal.cover-modal, .cover-modal, .ant-modal, .ant-modal-root')
    ).filter((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 40 && rect.height > 40
    })
    return {
      hasModal: modals.length > 0,
      modalSummaries: modals.map(summarize),
      fileInputCount: document.querySelectorAll('input[type="file"]').length
    }
  })
}

async function inspectCoverOpenCandidates(page: Page): Promise<{
  textButtons: string[]
  clickableCoverNodes: string[]
}> {
  return page.evaluate(() => {
    const summarize = (element: HTMLElement): string => {
      const rect = element.getBoundingClientRect()
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      return `${element.tagName.toLowerCase()} .${String(element.className || '').replace(/\s+/g, '.')} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} text="${text.slice(0, 100)}"`
    }

    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 16 && rect.height >= 16
    }

    const textButtons = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')
    )
      .map((element, index) => {
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
        const rect = element.getBoundingClientRect()
        let score = 0
        if (text.includes('修改封面')) score += 100
        if (text.includes('设置封面')) score += 90
        if (text.includes('替换封面') || text.includes('更换封面')) score += 80
        if (element.tagName === 'BUTTON') score += 10
        return { element, index, score, rect }
      })
      .filter((item) => item.score > 0 && isVisible(item.element))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 10)
      .map((item) => summarize(item.element))

    const clickableCoverNodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover-frame"], [class*="coverFrame"], [class*="cover"] img, [class*="Cover"] img, [class*="cover"] canvas, [class*="Cover"] canvas, [class*="thumbnail"], [class*="poster"], [data-testid*="cover"], [data-test*="cover"]'
      )
    )
      .map((element) => {
        const target =
          element.closest<HTMLElement>(
            'button, [role="button"], a, div[tabindex], span[tabindex], .ant-btn, label, [class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover"], [class*="Cover"], li'
          ) ?? element
        return target
      })
      .filter((element, index, list) => list.indexOf(element) === index)
      .filter((element) => isVisible(element))
      .slice(0, 12)
      .map((element) => summarize(element))

    return { textButtons, clickableCoverNodes }
  })
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`调试失败: ${message}`)
  process.exitCode = 1
})
