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
const DEFAULT_VIDEO_PATH = resolve(
  'assets/videos/4a243be27ae980de5ca9d10da0b423f1ee1ef985_wm_7d24001aa8.mp4'
)
type UploadTarget = {
  found: boolean
  selector: string
}

type ClickTarget = {
  found: boolean
  selector: string
  label: string
  centerX: number
  centerY: number
}

type FileInputSnapshot = {
  index: number
  accept: string
  id: string
  name: string
  className: string
  multiple: boolean
  disabled: boolean
  hiddenAttribute: boolean
  fileCount: number
  valuePresent: boolean
  display: string
  visibility: string
  opacity: string
  isDisplayNone: boolean
  rect: { left: number; top: number; width: number; height: number }
  parentSummary: string
  grandParentSummary: string
  closestDialogSummary: string
  closestUploadSummary: string
  closestCoverSummary: string
}

type PageSnapshot = {
  label: string
  url: string
  bodyHints: string[]
  dialogSummaries: string[]
  uploadButtonSummaries: string[]
  fileInputs: FileInputSnapshot[]
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profileId = parseOptionalProfile(argv)
  const videoPath = parseOptionalVideoPath(argv)
  const homeDir = os.homedir()
  const config = await loadCmsAccountsConfig(homeDir)
  if (!config) {
    throw new Error('未找到 cms-accounts.json，请先运行 setup-cms-profiles.ts')
  }

  const profile = findCmsProfileRecord(config, profileId)
  if (!profile.xhsLoggedIn) {
    throw new Error(`${profile.id} 尚未完成登录，请先运行 cms-login.ts`)
  }

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
    await jitterDelay(5_000, 6_000)

    const login = await checkCreatorLogin(page)
    if (!login.loggedIn) {
      throw new Error(`当前 Profile 登录态无效: ${login.reason}`)
    }

    const beforeUpload = await collectPageSnapshot(page, '页面初始状态')
    printSnapshot(beforeUpload)

    const uploadTarget = await markVideoUploadInput(page)
    if (!uploadTarget.found) {
      throw new Error('未找到视频上传 input[type=file]')
    }

    await setFilesWithCdp(client, uploadTarget.selector, [videoPath])
    await waitForVideoUploadReady(page)

    const afterVideoUpload = await collectPageSnapshot(page, '视频上传后（未打开封面弹窗）')
    printSnapshot(afterVideoUpload)

    const coverEntry = await markCoverEntry(page)
    if (!coverEntry.found) {
      throw new Error('未找到封面编辑入口')
    }

    mouse = await humanClick(client, mouse, coverEntry.centerX, coverEntry.centerY)
    await jitterDelay(1_200, 1_800)
    await waitForCoverModal(page)

    const afterModalOpen = await collectPageSnapshot(page, '封面弹窗打开后')
    printSnapshot(afterModalOpen)

    console.log('\n=== 结论建议 ===')
    console.log(describeLikelyCoverInput(afterVideoUpload, afterModalOpen))

    await delay(8_000)
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
  if (!value) {
    throw new Error('缺少 --video 参数值，例如：--video "/path/to/test-video.mp4"')
  }
  return resolve(value)
}

async function markVideoUploadInput(page: Page): Promise<UploadTarget> {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    const scored = inputs
      .map((input, index) => {
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
        if (attrs.includes('video')) score += 10
        if (attrs.includes('mp4') || attrs.includes('mov') || attrs.includes('m4v')) score += 5
        if (input.multiple) score += 1
        return { input, index, score }
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const target = scored[0]?.input
    if (!target) return { found: false, selector: '' }
    target.setAttribute('data-cms-cover-debug-video-input', 'true')
    return {
      found: true,
      selector: 'input[type="file"][data-cms-cover-debug-video-input="true"]'
    }
  })
}

async function setFilesWithCdp(
  client: CDPSession,
  selector: string,
  files: string[]
): Promise<void> {
  const documentNode = await client.send('DOM.getDocument', { depth: 2 })
  const node = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  if (!node.nodeId) {
    throw new Error(`未能定位上传元素: ${selector}`)
  }
  await client.send('DOM.setFileInputFiles', {
    nodeId: node.nodeId,
    files
  })
  await delay(1_000)
}

async function waitForVideoUploadReady(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await page.evaluate(() => {
      const pageText = document.body?.innerText ?? ''
      const hasUploadingText = /上传中|处理中|转码中|上传失败/.test(pageText)
      const hasPreviewText = /重新上传|更换视频|替换视频|裁剪封面/.test(pageText)
      const titleReady = Boolean(
        document.querySelector(
          '.d-input input[type="text"], .d-input input:not([type]), input[placeholder*="标题"]'
        )
      )
      const bodyReady = Boolean(
        document.querySelector(
          '.editor-content .tiptap.ProseMirror[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"]'
        )
      )
      return {
        hasUploadingText,
        hasPreviewText,
        videoCount: document.querySelectorAll('video').length,
        titleReady,
        bodyReady
      }
    })

    if (
      (state.videoCount > 0 || state.hasPreviewText) &&
      state.titleReady &&
      state.bodyReady &&
      !state.hasUploadingText
    ) {
      return
    }

    await delay(2_000)
  }

  throw new Error('视频上传后发布页未就绪')
}

async function markCoverEntry(page: Page): Promise<ClickTarget> {
  const direct = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')
    )
      .map((element, index) => {
        const text = (element.innerText || element.textContent || '').trim()
        const rect = element.getBoundingClientRect()
        let score = 0
        if (text.includes('修改封面')) score += 100
        if (text.includes('设置封面')) score += 90
        if (text.includes('替换封面') || text.includes('更换封面')) score += 80
        if (element.tagName === 'BUTTON') score += 10
        return { element, index, text, rect, score }
      })
      .filter((item) => item.score > 0 && item.rect.width > 24 && item.rect.height > 24)
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const target = candidates[0]
    if (!target) return null
    target.element.setAttribute('data-cms-cover-debug-open', 'true')
    return {
      found: true,
      selector: '[data-cms-cover-debug-open="true"]',
      label: target.text,
      centerX: target.rect.left + target.rect.width / 2,
      centerY: target.rect.top + target.rect.height / 2
    }
  })

  if (direct) return direct

  const fallback = await page.evaluate(() => {
    const anchorTexts = ['设置封面', '智能推荐封面', '推荐封面']
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width >= 48 &&
        rect.height >= 48
      )
    }

    const anchor = Array.from(document.querySelectorAll<HTMLElement>('div, span, button, h1, h2, h3'))
      .find((element) => anchorTexts.some((text) => (element.innerText || '').includes(text)))

    const root =
      anchor?.closest('#publish-container, section, article, form, main, div') ?? document.body
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover-frame"], [class*="coverFrame"], [class*="cover"] img, [class*="cover"] canvas'
      )
    )
      .map((element) => {
        const target =
          element.closest<HTMLElement>(
            '[class*="cover-item"], [class*="coverItem"], [class*="cover_item"], [class*="cover"], [class*="Cover"], li'
          ) ?? element
        const rect = target.getBoundingClientRect()
        const className = `${target.className} ${target.parentElement?.className ?? ''}`.toLowerCase()
        let score = 0
        if (className.includes('cover')) score += 40
        if (className.includes('recommend')) score += 10
        if (target.querySelector('img, canvas, video')) score += 10
        return { target, rect, score }
      })
      .filter((item) => isVisible(item.target))
      .sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left)

    const target = candidates[0]
    if (!target) return null
    target.target.setAttribute('data-cms-cover-debug-open', 'true')
    return {
      found: true,
      selector: '[data-cms-cover-debug-open="true"]',
      label: 'fallback-cover-entry',
      centerX: target.rect.left + target.rect.width / 2,
      centerY: target.rect.top + target.rect.height / 2
    }
  })

  return fallback ?? { found: false, selector: '', label: '', centerX: 0, centerY: 0 }
}

async function waitForCoverModal(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('[role="dialog"], .ant-modal, .ant-modal-root, .cover-modal')
      const modalText = modal?.innerText || modal?.textContent || ''
      const hasDialog = Boolean(modal && modal.getBoundingClientRect().width > 40)
      const hasUpload = /上传图片|确定|完成|保存/.test(modalText)
      return hasDialog || hasUpload
    })
    if (ready) return
    await delay(300)
  }
  throw new Error('未等到封面弹窗出现')
}

async function collectPageSnapshot(page: Page, label: string): Promise<PageSnapshot> {
  return page.evaluate((snapshotLabel) => {
    const summarizeElement = (element: Element | null): string => {
      if (!element || !(element instanceof HTMLElement)) return ''
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
      return [
        element.tagName.toLowerCase(),
        element.id ? `#${element.id}` : '',
        typeof element.className === 'string' && element.className
          ? `.${element.className.replace(/\s+/g, '.')}`
          : '',
        text ? `text="${text.slice(0, 80)}"` : ''
      ]
        .filter(Boolean)
        .join(' ')
    }

    const bodyText = document.body?.innerText || ''
    const bodyHints = bodyText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /封面|上传图片|裁剪封面|修改封面|更换视频|替换视频|重新上传/.test(line))
      .slice(0, 20)

    const dialogSummaries = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"], .ant-modal, .ant-modal-root, .cover-modal')
    )
      .map((element) => summarizeElement(element))
      .filter(Boolean)
      .slice(0, 10)

    const uploadButtonSummaries = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span')
    )
      .map((element) => {
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()
        if (!text.includes('上传图片')) return ''
        return summarizeElement(element)
      })
      .filter(Boolean)
      .slice(0, 10)

    const fileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).map(
      (input, index) => {
        const style = window.getComputedStyle(input)
        const rect = input.getBoundingClientRect()
        return {
          index,
          accept: input.accept || '',
          id: input.id || '',
          name: input.name || '',
          className: typeof input.className === 'string' ? input.className : '',
          multiple: input.multiple,
          disabled: input.disabled,
          hiddenAttribute: input.hidden || input.getAttribute('hidden') !== null,
          fileCount: input.files?.length ?? 0,
          valuePresent: Boolean(String(input.value || '').trim()),
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          isDisplayNone: style.display === 'none',
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          parentSummary: summarizeElement(input.parentElement),
          grandParentSummary: summarizeElement(input.parentElement?.parentElement ?? null),
          closestDialogSummary: summarizeElement(
            input.closest('[role="dialog"], .ant-modal, .ant-modal-root, .cover-modal')
          ),
          closestUploadSummary: summarizeElement(
            input.closest('[class*="upload"], [class*="Upload"], label, .ant-upload, .upload-input')
          ),
          closestCoverSummary: summarizeElement(
            input.closest('[class*="cover"], [class*="Cover"], [data-testid*="cover"], [data-test*="cover"]')
          )
        }
      }
    )

    return {
      label: snapshotLabel,
      url: location.href,
      bodyHints,
      dialogSummaries,
      uploadButtonSummaries,
      fileInputs
    }
  }, label)
}

function printSnapshot(snapshot: PageSnapshot): void {
  console.log(`\n=== ${snapshot.label} ===`)
  console.log(`URL: ${snapshot.url}`)
  console.log(`相关文案: ${snapshot.bodyHints.length > 0 ? snapshot.bodyHints.join(' | ') : '(无)'}`)
  console.log(
    `弹窗: ${snapshot.dialogSummaries.length > 0 ? snapshot.dialogSummaries.join(' || ') : '(无)'}`
  )
  console.log(
    `“上传图片”按钮: ${
      snapshot.uploadButtonSummaries.length > 0
        ? snapshot.uploadButtonSummaries.join(' || ')
        : '(无)'
    }`
  )
  console.log(`input[type=file] 数量: ${snapshot.fileInputs.length}`)
  for (const input of snapshot.fileInputs) {
    console.log(JSON.stringify(input, null, 2))
  }
}

function describeLikelyCoverInput(
  beforeModal: PageSnapshot,
  afterModal: PageSnapshot
): string {
  const appeared = afterModal.fileInputs.filter((input) => {
    return !beforeModal.fileInputs.some((prev) => sameInput(prev, input))
  })
  const candidates = appeared.length > 0 ? appeared : afterModal.fileInputs
  const scored = candidates
    .map((input) => ({ input, score: scoreCoverInputCandidate(input) }))
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best || best.score <= 0) {
    return '没有观察到明确的封面图片 input。更像是当前页面仍通过按钮触发系统文件选择器，或者 input 被挂在了更深层的 shadow / portal 节点。'
  }

  return [
    `最像封面上传的是第 ${best.input.index} 个 input[type=file]。`,
    `原因：accept="${best.input.accept || '(空)'}"，`,
    best.input.closestDialogSummary ? '位于/邻近弹窗，' : '不在弹窗内，',
    best.input.closestUploadSummary ? '邻近 upload 容器，' : '',
    best.input.closestCoverSummary ? '邻近 cover 容器，' : '',
    best.input.isDisplayNone ? '自身是隐藏 input。' : '自身可见。'
  ].join('')
}

function sameInput(a: FileInputSnapshot, b: FileInputSnapshot): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.className === b.className &&
    a.accept === b.accept &&
    a.parentSummary === b.parentSummary &&
    a.grandParentSummary === b.grandParentSummary
  )
}

function scoreCoverInputCandidate(input: FileInputSnapshot): number {
  const text = [
    input.accept,
    input.id,
    input.name,
    input.className,
    input.parentSummary,
    input.grandParentSummary,
    input.closestDialogSummary,
    input.closestUploadSummary,
    input.closestCoverSummary
  ]
    .join(' ')
    .toLowerCase()

  let score = 0
  if (text.includes('image')) score += 30
  if (text.includes('.jpg') || text.includes('.jpeg') || text.includes('.png') || text.includes('.webp')) {
    score += 20
  }
  if (text.includes('cover')) score += 20
  if (text.includes('upload')) score += 10
  if (input.closestDialogSummary) score += 16
  if (input.closestUploadSummary) score += 8
  if (input.isDisplayNone) score += 6
  if (text.includes('video')) score -= 40
  return score
}

async function jitterDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.round(minMs + Math.random() * (maxMs - minMs))
  await delay(ms)
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`调试失败: ${message}`)
  process.exitCode = 1
})
