import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { basename, join, resolve } from 'node:path'

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
  prepareStealthPage,
  setChromeWindowMode,
  type ChromeWindowMode
} from './cms-profile-runtime.ts'
import { selectCover as productionSelectCover } from '../src/cdp/xhs-publisher.ts'
import { humanClick, type MouseState } from './lib/human-input.ts'
import {
  analyzeMouseInteractionQuality,
  summarizePublishResult,
  validateTrustedMouseEvents
} from './publish-test-helpers.ts'

const DEFAULT_PROFILE = 'cms-profile-1'
const DEFAULT_VIDEO_PATH = resolve('scripts/test-assets/test-video.mov')
const DEFAULT_COVER_PATH = resolve('assets/images/4fa84b849c8b15a88329470a7ddd63e79398852b.jpg')
const APP_CONFIG_CANDIDATES = [
  resolve(os.homedir(), 'Library/Application Support/super-cms-dev/config.json'),
  resolve(os.homedir(), 'Library/Application Support/super-cms/config.json')
]
const PRODUCT_MODAL_SELECTOR = '[role="dialog"], .ant-modal, .ant-modal-content, .d-modal'

type SamplePublishCopy = {
  taskId: string
  title: string
  content: string
  workspacePath: string
  databasePath: string
  images: string[]
  videoCoverMode: 'auto' | 'manual'
  productId?: string
  productName?: string
  linkedProducts: Array<{ id: string; name: string; cover: string; productUrl: string }>
}

type SampleQueryRow = {
  id?: unknown
  title?: unknown
  content?: unknown
  images?: unknown
  productId?: unknown
  productName?: unknown
  linkedProductsJson?: unknown
  videoCoverMode?: unknown
}

type EditorTarget = {
  found: boolean
  selector: string
  tagName: string
  role: string
  placeholder: string
  text: string
  centerX: number
  centerY: number
  isContentEditable: boolean
  isTextInput: boolean
}

type UploadTarget = {
  found: boolean
  selector: string
  accept: string
  multiple: boolean
}

type CoverModalUploadSnapshot = {
  text: string
  imageSources: string[]
  selectedFileCount: number
  fileValues: string[]
}

type PublishTestStage = 'full' | 'video' | 'product' | 'dryrun' | 'publish'
type PublishTestStep =
  | 'bootstrap'
  | 'open-page'
  | 'login-check'
  | 'window-mode'
  | 'event-log'
  | 'video-upload'
  | 'video-ready'
  | 'cover'
  | 'title'
  | 'body'
  | 'product'
  | 'dryrun'
  | 'detection'
  | 'complete'

type ViewportSnapshot = {
  width: number
  height: number
}

type PublishTestReport = {
  ok: boolean
  profileId: string
  stage: PublishTestStage
  currentStep?: PublishTestStep
  failureStep?: PublishTestStep
  errorMessage?: string
  windowMode: ChromeWindowMode
  windowPlacementMessage: string
  screenshotPath: string
  tagsScreenshotPath?: string
  eventLogPath?: string
  debugLogPath?: string
  reportPath?: string
  failureScreenshotPath?: string
  failureModalScreenshotPath?: string
  viewportAtFailure?: ViewportSnapshot
  videoUploaded: boolean
  coverStatus: string
  titleFilled: boolean
  bodyFilled: boolean
  topicsRendered: boolean
  productBound: boolean
  publishDryRunReady: boolean
  trustedEvents: { ok: boolean; reason: string }
  mouseQuality: { ok: boolean; reason: string }
  finalDetection: FinalDetectionResult
  sampleTaskId: string
  durationMs: number
}

type FinalDetectionResult = {
  isTrusted: boolean | null
  hasProcess: boolean
  hasRequire: boolean
  hasElectron: boolean
  uaContainsElectron: boolean
  webdriver: boolean
  hasChromeCdc: boolean
  hasDomAutomation: boolean
  hasDomAutomationController: boolean
  hasChrome: boolean
  hasChromeRuntime: boolean
  pluginCount: number
  languages: string[]
}

function createEmptyFinalDetection(): FinalDetectionResult {
  return {
    isTrusted: null,
    hasProcess: false,
    hasRequire: false,
    hasElectron: false,
    uaContainsElectron: false,
    webdriver: false,
    hasChromeCdc: false,
    hasDomAutomation: false,
    hasDomAutomationController: false,
    hasChrome: true,
    hasChromeRuntime: false,
    pluginCount: 0,
    languages: []
  }
}

function appendDebugLog(lines: string[], message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  lines.push(line)
  console.log(line)
}

async function withStepTimeout<T>(label: string, timeoutMs: number, task: () => Promise<T>): Promise<T> {
  return Promise.race([
    task(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} 超时（>${timeoutMs}ms）`)), timeoutMs)
    })
  ])
}

async function readViewportSnapshot(page: import('puppeteer').Page): Promise<ViewportSnapshot> {
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
}

async function captureFailureArtifacts(
  page: import('puppeteer').Page | null,
  profileId: string,
  failureStep: PublishTestStep
): Promise<{
  failureScreenshotPath?: string
  failureModalScreenshotPath?: string
  viewportAtFailure?: ViewportSnapshot
}> {
  if (!page || page.isClosed()) return {}

  const suffix = `${profileId}-${failureStep}-${Date.now()}`
  const failureScreenshotPath = join(os.tmpdir(), `publish-test-failure-${suffix}.png`)
  const failureModalScreenshotPath = join(os.tmpdir(), `publish-test-failure-modal-${suffix}.png`)

  try {
    await page.screenshot({ path: failureScreenshotPath, fullPage: true })
  } catch {
    void 0
  }

  try {
    const modal = await page.$('[role="dialog"], .ant-modal, .d-modal, .cover-modal')
    if (modal) {
      await modal.screenshot({ path: failureModalScreenshotPath })
    }
  } catch {
    void 0
  }

  try {
    return {
      failureScreenshotPath: existsSync(failureScreenshotPath) ? failureScreenshotPath : undefined,
      failureModalScreenshotPath: existsSync(failureModalScreenshotPath) ? failureModalScreenshotPath : undefined,
      viewportAtFailure: await readViewportSnapshot(page)
    }
  } catch {
    return {
      failureScreenshotPath: existsSync(failureScreenshotPath) ? failureScreenshotPath : undefined,
      failureModalScreenshotPath: existsSync(failureModalScreenshotPath) ? failureModalScreenshotPath : undefined
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profileId = parseOptionalProfile(argv)
  const videoPath = parseOptionalVideoPath(argv)
  const stage = parseOptionalStage(argv)
  const tagCount = parseOptionalTagCount(argv)
  const sampleTaskId = parseOptionalSampleTaskId(argv)
  const allowRealPublish = argv.includes('--real-publish')
  const shouldHideWindow = argv.includes('--hide-window')
  const verboseEventLog = argv.includes('--verbose-event-log')
  const windowMode = parseOptionalWindowMode(argv, shouldHideWindow)
  const holdMs = parseOptionalHoldMs(argv)
  const explicitReportPath = parseOptionalReportPath(argv)
  const sample = loadSamplePublishCopy(stage, tagCount, sampleTaskId)
  const startedAt = Date.now()
  const debugLogs: string[] = []
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

  const screenshotPath = join(os.tmpdir(), `publish-test-${profile.id}-${Date.now()}.png`)
  const tagsScreenshotPath = join(os.tmpdir(), `publish-test-tags-${profile.id}-${Date.now()}.png`)
  const eventLogPath = join(os.tmpdir(), `publish-test-events-${profile.id}-${Date.now()}.json`)
  const debugLogPath = join(os.tmpdir(), `publish-test-debug-${profile.id}-${Date.now()}.log`)
  const reportPath =
    explicitReportPath ||
    join(os.tmpdir(), `publish-test-report-${profile.id}-${Date.now()}.json`)

  let page: import('puppeteer').Page | null = null
  let currentStep: PublishTestStep = 'bootstrap'
  let windowPlacementMessage = ''
  let videoUploaded = false
  let coverStatus = '未执行'
  let titleFilled = false
  let bodyFilled = false
  let topicsRendered = false
  let productBound = false
  let publishDryRunReady = false
  let titleMethod = '未执行'
  let bodyMethod = '未执行'
  let finalDetection = createEmptyFinalDetection()

  const writeDebugLogFile = (): void => {
    writeFileSync(debugLogPath, `${debugLogs.join('\n')}\n`)
  }

  try {
    page = await browser.newPage()
    const client = await page.target().createCDPSession()
    let mouse: MouseState = { x: 40, y: 40 }

    currentStep = 'open-page'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    await prepareStealthPage(page)
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    })
    await jitterDelay(5_500, 6_500)

    currentStep = 'login-check'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    const loginResult = await checkCreatorLogin(page)
    if (!loginResult.loggedIn) {
      throw new Error(`当前 Profile 登录态无效，无法进入发布页: ${loginResult.reason}`)
    }

    currentStep = 'window-mode'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    const firstPage = (await browser.pages())[0] ?? page
    const placement = await setChromeWindowMode(firstPage, windowMode)
    windowPlacementMessage = placement.message
    appendDebugLog(debugLogs, `[窗口] ${placement.message}`)
    const initialViewport = await readViewportSnapshot(page)
    appendDebugLog(debugLogs, `[窗口] 实际视口 ${initialViewport.width}x${initialViewport.height}`)

    currentStep = 'event-log'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    await injectTrustedEventLog(page)

    currentStep = 'video-upload'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    await withStepTimeout('视频上传', 90_000, () => robustVideoUpload(page!, client, videoPath))

    currentStep = 'video-ready'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    videoUploaded = await withStepTimeout('视频编辑器就绪', 60_000, () => waitForPublishEditorReady(page!))
    await withStepTimeout('视频就绪校验', 130_000, () =>
      checkVideoReady(page!, {
        onLog: (message) => appendDebugLog(debugLogs, message)
      })
    )

    writeDebugLogFile()

    if (stage === 'video') {
      await page.screenshot({ path: screenshotPath, fullPage: true })
      const report: PublishTestReport = {
        ok: videoUploaded,
        profileId: profile.id,
        stage,
        currentStep: 'complete',
        windowMode,
        windowPlacementMessage,
        screenshotPath,
        debugLogPath,
        videoUploaded,
        coverStatus: '未执行',
        titleFilled: false,
        bodyFilled: false,
        topicsRendered: false,
        productBound: false,
        publishDryRunReady: false,
        trustedEvents: { ok: true, reason: '当前阶段未校验' },
        mouseQuality: { ok: true, reason: '当前阶段未校验' },
        finalDetection,
        sampleTaskId: sample.taskId,
        durationMs: Date.now() - startedAt
      }
      writeFileSync(reportPath, JSON.stringify(report, null, 2))
      console.log(`截图已保存: ${screenshotPath}`)
      console.log(`调试日志已保存: ${debugLogPath}`)
      console.log(`报告已保存: ${reportPath}`)
      console.log(`视频文件: ${basename(videoPath)}`)
      console.log(`阶段: 仅验证视频上传`)
      console.log(`视频上传: ${videoUploaded ? '成功' : '失败'}`)
      console.log('标题填写: 未执行（当前阶段跳过）')
      console.log('正文填写: 未执行（当前阶段跳过）')
      console.log('就绪校验: 成功')
      if (holdMs > 0) await delay(holdMs)
      return
    }

    if (stage === 'full' || stage === 'dryrun' || stage === 'publish') {
      currentStep = 'cover'
      appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
      const coverViewport = await readViewportSnapshot(page)
      appendDebugLog(debugLogs, `[cover] 点击前视口 ${coverViewport.width}x${coverViewport.height}`)
      const coverPath = resolveSampleCoverPath(sample)
      if (coverPath) {
        mouse = await withStepTimeout('封面流程', 60_000, () =>
          selectCoverForTest(page!, client, mouse, coverPath, debugLogs)
        )
        coverStatus = `成功 (${basename(coverPath)})`
      } else {
        coverStatus = '当前样本无可用封面，跳过'
      }
    }

    currentStep = 'title'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    const titleViewport = await readViewportSnapshot(page)
    appendDebugLog(debugLogs, `[title] 点击前视口 ${titleViewport.width}x${titleViewport.height}`)
    const titleTarget = await markTitleEditor(page)
    if (!titleTarget.found) {
      throw new Error('未找到标题输入区域')
    }
    mouse = await focusEditorTarget(page, client, mouse, titleTarget)
    titleMethod = await withStepTimeout('标题填写', 30_000, () => fillTitleEditor(page!, client, titleTarget, sample.title))
    titleFilled = await verifyEditorContains(page, titleTarget.selector, sample.title)

    currentStep = 'body'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    const bodyViewport = await readViewportSnapshot(page)
    appendDebugLog(debugLogs, `[body] 点击前视口 ${bodyViewport.width}x${bodyViewport.height}`)
    const bodyTarget = await markBodyEditor(page)
    if (!bodyTarget.found) {
      throw new Error('未找到正文编辑区域')
    }
    mouse = await focusEditorTarget(page, client, mouse, bodyTarget)
    bodyMethod = await withStepTimeout('正文填写', 45_000, () => fillBodyEditor(page!, client, bodyTarget, sample.content))
    const cleanBodyText = normalizeBodyText(sample.content)
    bodyFilled = bodyMethod !== '未成功' || (await verifyBodyPlainText(page, bodyTarget.selector, cleanBodyText))
    const topicNames = normalizeTagList(sample.content)
    topicsRendered = await verifyTopicsRendered(page, bodyTarget.selector, topicNames)
    if (stage === 'full' || stage === 'dryrun') {
      await scrollSelectorIntoView(page, bodyTarget.selector, 'start')
      await page.screenshot({ path: tagsScreenshotPath, fullPage: false })
    }

    if ((stage === 'product' || stage === 'full' || stage === 'dryrun' || stage === 'publish') && hasSampleProductBinding(sample)) {
      currentStep = 'product'
      appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
      const productViewport = await readViewportSnapshot(page)
      appendDebugLog(debugLogs, `[product] 点击前视口 ${productViewport.width}x${productViewport.height}`)
      await ensureCoverModalDismissed(page, client, mouse)
      await withStepTimeout('挂车流程', 60_000, () => addProductsIfNeededForTest(page!, client, sample))
      productBound = await detectProductAddedIndicator(page)
    }

    if (stage === 'full' || stage === 'dryrun' || stage === 'publish') {
      currentStep = 'dryrun'
      appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
      const publishViewport = await readViewportSnapshot(page)
      appendDebugLog(debugLogs, `[dryrun] 点击前视口 ${publishViewport.width}x${publishViewport.height}`)
      publishDryRunReady = await withStepTimeout('发布按钮定位', 30_000, () =>
        runDryRunPublishCheck(page!, taskMediaTypeForStage(sample))
      )
      if (stage === 'publish') {
        if (!allowRealPublish) {
          throw new Error('真实发布已被安全门禁拦截。若确需验证真实点击，请显式追加 --real-publish。')
        }
        throw new Error('真实发布代码路径已接通，但本轮按约定未执行自动实发。需要时我再陪你一起做。')
      }
    }

    currentStep = 'detection'
    appendDebugLog(debugLogs, `开始阶段: ${currentStep}`)
    const eventLog = await readTrustedEventLog(page)
    const trustedResult = validateTrustedMouseEvents(eventLog)
    const mouseQuality = analyzeMouseInteractionQuality(eventLog)

    await page.screenshot({ path: screenshotPath, fullPage: true })
    finalDetection = await runFinalDetectionProbe(page, client, mouse)
    writeFileSync(eventLogPath, JSON.stringify(eventLog, null, 2))
    writeDebugLogFile()
    const report: PublishTestReport = {
      ok:
        titleFilled &&
        bodyFilled &&
        topicsRendered &&
        videoUploaded &&
        trustedResult.ok &&
        mouseQuality.ok &&
        finalDetection.isTrusted === true &&
        finalDetection.webdriver === false &&
        finalDetection.hasProcess === false &&
        (stage === 'dryrun' || stage === 'full' || stage === 'publish' ? publishDryRunReady : true),
      profileId: profile.id,
      stage,
      currentStep: 'complete',
      windowMode,
      windowPlacementMessage,
      screenshotPath,
      tagsScreenshotPath:
        stage === 'full' || stage === 'dryrun' || stage === 'publish' ? tagsScreenshotPath : undefined,
      eventLogPath,
      debugLogPath,
      reportPath,
      videoUploaded,
      coverStatus,
      titleFilled,
      bodyFilled,
      topicsRendered,
      productBound,
      publishDryRunReady,
      trustedEvents: trustedResult,
      mouseQuality: {
        ok: mouseQuality.ok,
        reason: mouseQuality.reason
      },
      finalDetection,
      sampleTaskId: sample.taskId,
      durationMs: Date.now() - startedAt
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`截图已保存: ${screenshotPath}`)
    if (stage === 'full' || stage === 'dryrun' || stage === 'publish') {
      console.log(`标签截图已保存: ${tagsScreenshotPath}`)
    }
    console.log(`事件日志已保存: ${eventLogPath}`)
    console.log(`调试日志已保存: ${debugLogPath}`)
    console.log(`报告已保存: ${reportPath}`)
    console.log(`视频文件: ${basename(videoPath)}`)
    console.log(`文案来源任务: ${sample.taskId}`)
    console.log(`文案来源数据库: ${sample.databasePath}`)
    if (stage === 'full' || stage === 'dryrun' || stage === 'publish') {
      console.log(`封面设置: ${coverStatus}`)
    }
    console.log(`标题填充方案: ${titleMethod}`)
    console.log(`正文填充方案: ${bodyMethod}`)
    console.log(`蓝字话题: ${topicsRendered ? '成功' : '失败'}`)
    if (stage === 'product' || stage === 'full' || stage === 'dryrun' || stage === 'publish') {
      console.log(`挂车商品: ${hasSampleProductBinding(sample) ? (productBound ? '成功' : '失败') : '当前样本无商品，跳过'}`)
    }
    if (stage === 'full' || stage === 'dryrun' || stage === 'publish') {
      console.log(`dryRun 发布定位: ${publishDryRunReady ? '成功（已高亮，未点击）' : '失败'}`)
    }
    console.log(summarizePublishResult({
      titleFilled,
      bodyFilled: bodyFilled && topicsRendered,
      videoUploaded,
      trustedEventsOk: trustedResult.ok
    }))
    console.log(`isTrusted 细节: ${trustedResult.reason}`)
    console.log(`鼠标质量: ${mouseQuality.ok ? '通过' : '失败'} (${mouseQuality.reason})`)
    console.log('流程末尾 detection:')
    console.log(JSON.stringify(finalDetection, null, 2))
    if (verboseEventLog) {
      console.log('事件日志:')
      console.log(JSON.stringify(eventLog, null, 2))
    } else {
      console.log('事件日志: 已写入 JSON 文件')
    }

    if (holdMs > 0) await delay(holdMs)
  } catch (error) {
    const artifacts = await captureFailureArtifacts(page, profile.id, currentStep)
    appendDebugLog(debugLogs, `失败阶段: ${currentStep}`)
    appendDebugLog(debugLogs, `失败原因: ${error instanceof Error ? error.message : String(error)}`)
    if (artifacts.viewportAtFailure) {
      appendDebugLog(
        debugLogs,
        `[失败视口] ${artifacts.viewportAtFailure.width}x${artifacts.viewportAtFailure.height}`
      )
    }
    if (artifacts.failureScreenshotPath) {
      appendDebugLog(debugLogs, `失败截图: ${artifacts.failureScreenshotPath}`)
    }
    if (artifacts.failureModalScreenshotPath) {
      appendDebugLog(debugLogs, `失败弹窗截图: ${artifacts.failureModalScreenshotPath}`)
    }
    writeDebugLogFile()
    const failureReport: PublishTestReport = {
      ok: false,
      profileId: profile.id,
      stage,
      currentStep,
      failureStep: currentStep,
      errorMessage: error instanceof Error ? error.message : String(error),
      windowMode,
      windowPlacementMessage,
      screenshotPath,
      tagsScreenshotPath:
        stage === 'full' || stage === 'dryrun' || stage === 'publish' ? tagsScreenshotPath : undefined,
      eventLogPath: existsSync(eventLogPath) ? eventLogPath : undefined,
      debugLogPath,
      reportPath,
      failureScreenshotPath: artifacts.failureScreenshotPath,
      failureModalScreenshotPath: artifacts.failureModalScreenshotPath,
      viewportAtFailure: artifacts.viewportAtFailure,
      videoUploaded,
      coverStatus,
      titleFilled,
      bodyFilled,
      topicsRendered,
      productBound,
      publishDryRunReady,
      trustedEvents: { ok: false, reason: '流程提前失败，未完成 trusted 校验' },
      mouseQuality: { ok: false, reason: '流程提前失败，未完成鼠标质量校验' },
      finalDetection,
      sampleTaskId: sample.taskId,
      durationMs: Date.now() - startedAt
    }
    writeFileSync(reportPath, JSON.stringify(failureReport, null, 2))
    throw error
  } finally {
    await closeBrowserSafely(browser)
  }
}

function loadSamplePublishCopy(stage: PublishTestStage, tagCount = 2, sampleTaskId?: string): SamplePublishCopy {
  const configPath = APP_CONFIG_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!configPath) {
    throw new Error('未找到 super-cms 配置文件，无法定位工作区数据库。')
  }

  const configRaw = readFileSync(configPath, 'utf-8')
  const config = JSON.parse(configRaw) as { workspacePath?: unknown }
  const workspacePath = String(config.workspacePath ?? '').trim()
  if (!workspacePath) {
    throw new Error(`配置文件未包含 workspacePath: ${configPath}`)
  }

  const databasePath = resolve(workspacePath, 'cms.sqlite')
  if (!existsSync(databasePath)) {
    throw new Error(`未找到 CMS 数据库: ${databasePath}`)
  }

  const query = `
    SELECT id, title, content, images, productId, productName, linkedProductsJson, videoCoverMode
    FROM tasks
    WHERE mediaType = 'video'
      AND TRIM(title) <> ''
      AND TRIM(content) <> ''
      AND content LIKE '%#%'
    ORDER BY createdAt DESC
    LIMIT 20;
  `
  const raw = execFileSync('sqlite3', ['-json', databasePath, query], {
    encoding: 'utf-8'
  }).trim()
  const rows = raw ? (JSON.parse(raw) as SampleQueryRow[]) : []
  const explicitRow = sampleTaskId
    ? rows.find((item) => String(item?.id ?? '').trim() === sampleTaskId)
    : null
  const row =
    explicitRow ??
    (stage === 'product' || stage === 'full' || stage === 'dryrun'
      ? rows.find((item) => {
          const productId = String(item?.productId ?? '').trim()
          const productName = String(item?.productName ?? '').trim()
          const linkedProductsJson = String(item?.linkedProductsJson ?? '').trim()
          return Boolean(productId || productName || linkedProductsJson)
        })
      : null) ?? rows[0]
  const taskId = String(row?.id ?? '').trim()
  const title = String(row?.title ?? '').trim()
  const rawContent = String(row?.content ?? '').trim()
  const images = parseStringArrayJson(row?.images)
  const productId = String(row?.productId ?? '').trim() || undefined
  const productName = String(row?.productName ?? '').trim() || undefined
  const linkedProducts = parseLinkedProductsJson(row?.linkedProductsJson)
  const videoCoverMode = String(row?.videoCoverMode ?? '').trim() === 'auto' ? 'auto' : 'manual'

  if (!taskId || !title || !rawContent) {
    throw new Error(`数据库中未找到带话题的可用视频任务: ${databasePath}`)
  }

  const selectedTags = collectPreferredTags(rows, rawContent, Math.max(1, tagCount))
  const tagRegex = /#([^#\s]+)/g
  const cleanContent = rawContent
    .replace(tagRegex, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  const content = selectedTags.length > 0 ? `${cleanContent}\n\n${selectedTags.map((tag) => `#${tag}`).join(' ')}` : cleanContent

  return {
    taskId,
    title,
    content,
    workspacePath,
    databasePath,
    images,
    videoCoverMode,
    productId,
    productName,
    linkedProducts
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
    throw new Error('缺少 --video 参数值，例如：--video "/path/to/test-video.mov"')
  }
  return value
}

function parseOptionalStage(argv: string[]): PublishTestStage {
  const index = argv.indexOf('--stage')
  if (index === -1) return 'full'
  const value = argv[index + 1]?.trim().toLowerCase()
  if (value === 'video') return 'video'
  if (value === 'product') return 'product'
  if (value === 'dryrun') return 'dryrun'
  if (value === 'publish') return 'publish'
  return 'full'
}

function parseOptionalTagCount(argv: string[]): number {
  const index = argv.indexOf('--tag-count')
  if (index === -1) return 2
  const raw = argv[index + 1]?.trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('缺少有效的 --tag-count 参数值，例如：--tag-count 10')
  }
  return Math.max(1, Math.min(10, Math.floor(parsed)))
}

function parseOptionalSampleTaskId(argv: string[]): string | undefined {
  const index = argv.indexOf('--sample-task-id')
  if (index === -1) return undefined
  const raw = argv[index + 1]?.trim()
  if (!raw) {
    throw new Error('缺少有效的 --sample-task-id 参数值')
  }
  return raw
}

function parseOptionalWindowMode(argv: string[], shouldHideWindow: boolean): ChromeWindowMode {
  const index = argv.indexOf('--window-mode')
  const value = index === -1 ? '' : String(argv[index + 1] ?? '').trim().toLowerCase()
  if (value === 'visible' || value === 'minimized' || value === 'offscreen' || value === 'edge-visible') {
    return value
  }
  return shouldHideWindow ? 'offscreen' : 'visible'
}

function parseOptionalHoldMs(argv: string[]): number {
  const index = argv.indexOf('--hold-ms')
  if (index === -1) return 10_000
  const raw = String(argv[index + 1] ?? '').trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('缺少有效的 --hold-ms 参数值，例如：--hold-ms 0')
  }
  return Math.floor(parsed)
}

function parseOptionalReportPath(argv: string[]): string | undefined {
  const index = argv.indexOf('--report-path')
  if (index === -1) return undefined
  const raw = String(argv[index + 1] ?? '').trim()
  if (!raw) {
    throw new Error('缺少 --report-path 参数值，例如：--report-path /tmp/report.json')
  }
  return resolve(raw)
}

function parseStringArrayJson(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function extractTagsFromContent(content: string): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  const tagRegex = /#([^#\s]+)/g
  let match: RegExpExecArray | null = null
  while ((match = tagRegex.exec(String(content ?? ''))) !== null) {
    const tag = String(match[1] ?? '').trim().replace(/^#+/, '')
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

function collectPreferredTags(rows: SampleQueryRow[], primaryContent: string, wantedCount: number): string[] {
  const selected: string[] = []
  const seen = new Set<string>()
  const append = (tag: string) => {
    const normalized = String(tag ?? '').trim().replace(/^#+/, '')
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    selected.push(normalized)
  }

  for (const tag of extractTagsFromContent(primaryContent)) {
    append(tag)
    if (selected.length >= wantedCount) return selected
  }
  for (const row of rows) {
    for (const tag of extractTagsFromContent(String(row?.content ?? ''))) {
      append(tag)
      if (selected.length >= wantedCount) return selected
    }
  }
  return selected
}

function parseLinkedProductsJson(value: unknown): Array<{ id: string; name: string; cover: string; productUrl: string }> {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({
        id: String(item?.id ?? '').trim(),
        name: String(item?.name ?? '').trim(),
        cover: String(item?.cover ?? '').trim(),
        productUrl: String(item?.productUrl ?? '').trim()
      }))
      .filter((item) => Boolean(item.id))
  } catch {
    return []
  }
}

function hasSampleProductBinding(sample: SamplePublishCopy): boolean {
  return Boolean(sample.productId || sample.productName || sample.linkedProducts.length > 0)
}

function resolveSampleAssetPath(sample: SamplePublishCopy, rawPath: string): string | null {
  const value = String(rawPath ?? '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return null
  return value.startsWith('/') ? value : resolve(sample.workspacePath, value)
}

function resolveSampleCoverPath(sample: SamplePublishCopy): string | null {
  if (sample.videoCoverMode !== 'manual') {
    return null
  }
  if (sample.videoCoverMode === 'manual') {
    const fromSample = resolveSampleAssetPath(sample, sample.images[0] ?? '')
    if (fromSample && existsSync(fromSample)) return fromSample
  }
  return existsSync(DEFAULT_COVER_PATH) ? DEFAULT_COVER_PATH : null
}

function taskMediaTypeForStage(_sample: SamplePublishCopy): 'video' {
  return 'video'
}

async function detectProductAddedIndicator(page: import('puppeteer').Page): Promise<boolean> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8
    }

    const fullText = normalizeText(document.body?.innerText || document.body?.textContent || '')
    if (/已添加\s*\d+\s*(个|件)?\s*商品/.test(fullText)) return true
    if (fullText.includes('已添加') && fullText.includes('商品')) return true

    const shopSectionMatched = Array.from(document.querySelectorAll<HTMLElement>('div, section, article'))
      .filter((element) => isVisible(element))
      .some((element) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        if (!text.includes('店内商品')) return false
        if (!/商品id[:：]/i.test(text)) return false
        const hasPrice = /[¥￥]\s*\d/.test(text)
        const hasAction = /(删除|改规格)/.test(text)
        const hasImage = Array.from(element.querySelectorAll('img')).some((img) => {
          const rect = img.getBoundingClientRect()
          return rect.width > 24 && rect.height > 24
        })
        return hasPrice && hasAction && hasImage
      })
    if (shopSectionMatched) return true

    return Array.from(
      document.querySelectorAll<HTMLElement>('.ant-tag, .ant-badge, [class*="tag"], [class*="badge"], [aria-label], [title]')
    ).some((element) => {
      if (!isVisible(element)) return false
      const text = normalizeText(
        element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || element.textContent || ''
      )
      return text.includes('已添加') || text.includes('删除') || text.includes('编辑')
    })
  })
}

async function selectCoverForTest(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState,
  coverPath: string,
  debugLogs?: string[]
): Promise<MouseState> {
  await productionSelectCover(page, client, coverPath, {
    onLog: debugLogs ? (message) => appendDebugLog(debugLogs, message) : undefined
  })
  await delay(600)
  return mouse
}

async function ensureCoverModalDismissed(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState
): Promise<MouseState> {
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
    if (confirmButton) {
      const clickable = await ensureTargetInViewport(page, confirmButton.selector)
      mouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
      await delay(600)
    } else {
      await page.keyboard.press('Escape').catch(() => void 0)
      await delay(400)
    }
    if (!(await isCoverModalVisible())) return mouse
  }

  return mouse
}

async function runDryRunPublishCheck(
  page: import('puppeteer').Page,
  mediaType: 'video' | 'image'
): Promise<boolean> {
  if (mediaType === 'image') {
    await scrollPublishAreaToBottom(page)
  }
  await assertNoPublishFormErrors(page)
  const publishButton = await waitForPublishButton(page)
  await highlightSelector(page, publishButton.selector, '#ef4444')
  return true
}

async function assertNoPublishFormErrors(page: import('puppeteer').Page): Promise<void> {
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

async function waitForPublishButton(page: import('puppeteer').Page): Promise<EditorTarget> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    const button = await markPublishButton(page)
    if (button.found) return button
    await delay(250)
  }
  throw new Error('未找到发布按钮（可能页面结构变化）。')
}

async function markPublishButton(page: import('puppeteer').Page): Promise<EditorTarget> {
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
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && isVisible(element)
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
    publishButton.setAttribute('data-cms-dryrun-publish-button', 'true')
    return {
      found: true,
      selector: '[data-cms-dryrun-publish-button="true"]',
      tagName: publishButton.tagName,
      role: publishButton.getAttribute('role') ?? '',
      placeholder: '',
      text: normalizeText(publishButton.innerText || publishButton.textContent || ''),
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  })

  return target ?? {
    found: false,
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
}

async function highlightSelector(
  page: import('puppeteer').Page,
  selector: string,
  color: string
): Promise<void> {
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
  await delay(200)
}

async function markCompactCoverButton(
  page: import('puppeteer').Page
): Promise<EditorTarget | null> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
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
        return { element, index, rect, score, text }
      })
      .filter((item) => item.score > 0 && item.rect.width > 16 && item.rect.height > 16)
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cover-open', 'true')
    return {
      found: true,
      selector: '[data-cms-cover-open="true"]',
      tagName: match.element.tagName,
      role: match.element.getAttribute('role') ?? '',
      placeholder: '',
      text: match.text,
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  })
}

async function markFirstCoverEntry(
  page: import('puppeteer').Page
): Promise<EditorTarget | null> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 48 && rect.height >= 48
    }

    const anchorTexts = ['设置封面', '智能推荐封面', '推荐封面']
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('div, span, button, h1, h2, h3')).find(
      (element) => anchorTexts.some((text) => (element.innerText || '').includes(text))
    )
    const anchorRect = anchor?.getBoundingClientRect?.() ?? null
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
      '[class*="cover"]',
      '[class*="Cover"]',
      '[class*="thumbnail"]',
      '[class*="poster"]'
    ].join(', ')

    const scoredTargets: Array<{ element: HTMLElement; score: number; rect: DOMRect }> = []
    const seen = new Set<HTMLElement>()
    for (const root of searchRoots) {
      if (!root) continue
      for (const node of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        if (seen.has(node) || !isVisible(node)) continue
        if (node.closest('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')) continue
        const rect = node.getBoundingClientRect()
        const classNames = String(node.className || '').toLowerCase()
        const text = normalizeText(node.innerText || node.textContent || '')
        let score = 0
        if (classNames.includes('cover')) score += 200
        if (text.includes('智能推荐封面')) score += 160
        if (text.includes('修改封面') || text.includes('设置封面')) score += 120
        if (node.querySelector('img, canvas, video')) score += 60
        if (rect.width >= 120 && rect.width <= 720) score += 50
        if (rect.height >= 80 && rect.height <= 280) score += 40
        if (anchorRect) {
          const distance = Math.abs(rect.top - anchorRect.bottom)
          score += Math.max(0, 500 - distance) * 0.2
        }
        seen.add(node)
        scoredTargets.push({ element: node, score, rect })
      }
    }

    scoredTargets.sort((a, b) => b.score - a.score || a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    const best = scoredTargets[0]
    if (!best) return null
    best.element.setAttribute('data-cms-cover-entry', 'true')
    return {
      found: true,
      selector: '[data-cms-cover-entry="true"]',
      tagName: best.element.tagName,
      role: best.element.getAttribute('role') ?? '',
      placeholder: '',
      text: normalizeText(best.element.innerText || best.element.textContent || ''),
      centerX: best.rect.left + best.rect.width / 2,
      centerY: best.rect.top + best.rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  })
}

async function markCoverUploadInput(page: import('puppeteer').Page): Promise<string> {
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
        if (attrs.includes('.jpg') || attrs.includes('.jpeg') || attrs.includes('.png') || attrs.includes('.webp')) score += 30
        if (attrs.includes('cover')) score += 15
        if (attrs.includes('video')) score -= 60
        score -= index
        return { input, score }
      })
      .sort((a, b) => b.score - a.score)
    const target = scored[0]?.input
    if (!target || scored[0]!.score <= 0) return ''
    target.setAttribute('data-cms-cover-upload', 'true')
    return 'input[type="file"][data-cms-cover-upload="true"]'
  })
}

async function waitForCoverUploadInput(page: import('puppeteer').Page): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    const selector = await markCoverUploadInput(page)
    if (selector) return selector
    await delay(200)
  }
  throw new Error('未找到封面上传 input[type=file]')
}

async function markCoverConfirmButton(
  page: import('puppeteer').Page
): Promise<EditorTarget | null> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim()
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
        return { element, index, rect, score, disabled, text }
      })
      .filter((item) => item.score > 0 && item.rect.width > 24 && item.rect.height > 24 && !item.disabled)
      .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left)
    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-cover-confirm', 'true')
    return {
      found: true,
      selector: '[data-cms-cover-confirm="true"]',
      tagName: match.element.tagName,
      role: match.element.getAttribute('role') ?? '',
      placeholder: '',
      text: match.text,
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  })
}

async function waitForCoverSectionReady(page: import('puppeteer').Page): Promise<void> {
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

async function waitForCoverModal(page: import('puppeteer').Page): Promise<void> {
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

async function waitForCoverModalClose(page: import('puppeteer').Page): Promise<void> {
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

async function snapshotCoverModalUploadState(page: import('puppeteer').Page): Promise<CoverModalUploadSnapshot> {
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

async function waitForCoverFileSelection(
  page: import('puppeteer').Page,
  selector: string
): Promise<void> {
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
  page: import('puppeteer').Page,
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

async function injectTrustedEventLog(page: import('puppeteer').Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as typeof window & { __eventLog?: unknown[] }).__eventLog = []
    const push = (entry: Record<string, unknown>) => {
      ;(window as typeof window & { __eventLog: unknown[] }).__eventLog.push(entry)
    }
    document.addEventListener(
      'click',
      (event) => {
        push({
          type: 'click',
          isTrusted: event.isTrusted,
          target: (event.target as HTMLElement | null)?.tagName ?? '',
          timestamp: Math.round(event.timeStamp),
          x: Math.round(event.clientX),
          y: Math.round(event.clientY)
        })
      },
      true
    )
    document.addEventListener(
      'mousedown',
      (event) => {
        push({
          type: 'mousedown',
          isTrusted: event.isTrusted,
          target: (event.target as HTMLElement | null)?.tagName ?? '',
          timestamp: Math.round(event.timeStamp),
          x: Math.round(event.clientX),
          y: Math.round(event.clientY)
        })
      },
      true
    )
    document.addEventListener(
      'mousemove',
      (event) => {
        push({
          type: 'mousemove',
          isTrusted: event.isTrusted,
          target: (event.target as HTMLElement | null)?.tagName ?? '',
          timestamp: Math.round(event.timeStamp),
          x: Math.round(event.clientX),
          y: Math.round(event.clientY)
        })
      },
      true
    )
  })
}

async function markVideoUploadInput(page: import('puppeteer').Page): Promise<UploadTarget> {
  return page.evaluate(() => {
    const scoreInput = (input: HTMLInputElement): number => {
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
      if (attrs.includes('mp4') || attrs.includes('mov')) score += 5
      if (input.multiple) score += 1
      return score
    }

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    if (inputs.length === 0) {
      return { found: false, selector: '', accept: '', multiple: false }
    }

    const ranked = inputs
      .map((input, index) => ({ input, index, score: scoreInput(input) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const target = ranked[0]?.input
    if (!target) {
      return { found: false, selector: '', accept: '', multiple: false }
    }

    target.setAttribute('data-cms-video-upload-target', 'true')
    return {
      found: true,
      selector: 'input[type="file"][data-cms-video-upload-target="true"]',
      accept: target.accept,
      multiple: target.multiple
    }
  })
}

async function markTitleEditor(page: import('puppeteer').Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.d-input input[type="text"], .d-input input:not([type]), input[placeholder*="标题"]'
      )
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 180 && rect.height > 18
      })
      .map((element, index) => {
        const rect = element.getBoundingClientRect()
        const text = [
          element.placeholder,
          element.className,
          element.parentElement?.className ?? ''
        ]
          .join(' ')
          .toLowerCase()
        let score = 0
        if (text.includes('标题')) score += 20
        if (element.closest('.d-input')) score += 10
        if (rect.width >= 320) score += 5
        return { element, index, score, rect }
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const match = candidates[0]
    if (!match) {
      return null
    }

    match.element.setAttribute('data-cms-editor-target', 'title')
    return {
      found: true,
      selector: 'input[data-cms-editor-target="title"]',
      tagName: match.element.tagName,
      role: match.element.getAttribute('role') ?? '',
      placeholder: match.element.getAttribute('placeholder') ?? '',
      text: match.element.value ?? '',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2
    }
  })

  if (target) {
    return target
  }

  return markEditor(page, ['标题', '请输入标题'])
}

async function markBodyEditor(page: import('puppeteer').Page): Promise<EditorTarget> {
  const target = await page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>(
      '.editor-content .tiptap.ProseMirror[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"]'
    )
    if (!editor) {
      return null
    }

    const rect = editor.getBoundingClientRect()
    if (rect.width <= 40 || rect.height <= 40) {
      return null
    }

    editor.setAttribute('data-cms-editor-target', 'body')
    return {
      found: true,
      selector: '[data-cms-editor-target="body"]',
      tagName: editor.tagName,
      role: editor.getAttribute('role') ?? '',
      placeholder: editor.getAttribute('data-placeholder') ?? '',
      text: editor.textContent ?? '',
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    }
  })

  if (target) {
    return target
  }

  return markEditor(page, ['正文', '描述', '添加正文', '输入正文'])
}

async function markEditor(
  page: import('puppeteer').Page,
  keywords: string[]
): Promise<EditorTarget> {
  return page.evaluate((needleList) => {
    const selectors = [
      'textarea',
      'input[type="text"]',
      'input:not([type])',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]'
    ]

    const scoreElement = (element: HTMLElement): number => {
      const raw = [
        element.getAttribute('placeholder') ?? '',
        element.getAttribute('aria-label') ?? '',
        element.getAttribute('data-placeholder') ?? '',
        element.textContent ?? '',
        element.className ?? '',
        element.id ?? ''
      ].join(' ')
      const text = raw.toLowerCase()
      let score = 0
      for (const keyword of needleList) {
        if (text.includes(String(keyword).toLowerCase())) score += 10
      }
      if (element.tagName === 'TEXTAREA') score += 3
      if (element.getAttribute('contenteditable')) score += 2
      return score
    }

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 40 && rect.height > 18
      })
      .map((element, index) => ({ element, index, score: scoreElement(element) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const target = candidates[0]?.element
    if (!target) {
      return {
        found: false,
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
    }

    target.setAttribute('data-cms-editor-target', needleList[0] === '标题' ? 'title' : 'body')
    const rect = target.getBoundingClientRect()
    const selector =
      needleList[0] === '标题'
        ? '[data-cms-editor-target="title"]'
        : '[data-cms-editor-target="body"]'

    return {
      found: true,
      selector,
      tagName: target.tagName,
      role: target.getAttribute('role') ?? '',
      placeholder: target.getAttribute('placeholder') ?? '',
      text: target.textContent ?? '',
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      isContentEditable: target.getAttribute('contenteditable') === 'true',
      isTextInput: target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    }
  }, keywords)
}

async function setFilesWithCdp(
  client: import('puppeteer').CDPSession,
  selector: string,
  files: string[]
): Promise<void> {
  const documentNode = await client.send('DOM.getDocument', { depth: 2 })
  const nodeId = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  if (!nodeId.nodeId) {
    throw new Error(`未能定位上传元素: ${selector}`)
  }
  await client.send('DOM.setFileInputFiles', {
    nodeId: nodeId.nodeId,
    files
  })
  await delay(1_000)
}

async function dispatchFileInputEvents(
  page: import('puppeteer').Page,
  selector: string
): Promise<void> {
  await page.evaluate((targetSelector) => {
    const input = document.querySelector<HTMLInputElement>(targetSelector)
    if (!input) return
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector)
}

async function robustVideoUpload(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  videoPath: string
): Promise<void> {
  const uploadTarget = await markVideoUploadInput(page)
  if (!uploadTarget.found) {
    throw new Error('未找到视频上传 input[type=file]')
  }

  await setFilesWithCdp(client, uploadTarget.selector, [videoPath])
  await dispatchFileInputEvents(page, uploadTarget.selector)
}

async function waitForPublishEditorReady(page: import('puppeteer').Page): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = await page.evaluate(() => {
      const pageText = document.body?.innerText ?? ''
      const videoCount = document.querySelectorAll('video').length
      const hasUploadingText = /上传中|处理中|转码中|上传失败/.test(pageText)
      const hasPreviewText = /重新上传|更换视频|替换视频|裁剪封面/.test(pageText)
      const titleReady = Boolean(
        document.querySelector('.d-input input[type="text"], .d-input input:not([type]), input[placeholder*="标题"]')
      )
      const bodyReady = Boolean(
        document.querySelector(
          '.editor-content .tiptap.ProseMirror[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"]'
        )
      )
      return {
        videoCount,
        hasUploadingText,
        hasPreviewText,
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
      return true
    }

    await delay(2_000)
  }

  return false
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

async function readVideoReadySnapshot(
  page: import('puppeteer').Page
): Promise<VideoReadySnapshot> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string =>
      String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width >= 20 &&
        rect.height >= 20
      )
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
    const failureText = ['上传失败', '失败', '请重试'].find((text) => fullText.includes(text)) ?? ''

    const indicatorText =
      ['检测为高清视频', '检测为清晰视频'].find((text) =>
        Array.from(document.querySelectorAll<HTMLElement>('div, span, p, strong')).some(
          (element) =>
            isVisible(element) &&
            normalizeText(element.innerText || element.textContent || '').includes(text)
        )
      ) ?? ''

    const directButton =
      (document.querySelector('#publish-container .publish-btn') as HTMLElement | null) ||
      (document.querySelector('#publish-container button.publish-btn') as HTMLElement | null) ||
      (document.querySelector('#publish-container button') as HTMLElement | null) ||
      (document.querySelector('button.publish-btn') as HTMLElement | null) ||
      null

    let bestButton: HTMLElement | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    const buttons = Array.from(document.querySelectorAll('button')).filter(
      (element): element is HTMLButtonElement =>
        element instanceof HTMLButtonElement && isVisible(element)
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

    const publishButton =
      (directButton && isVisible(directButton)
        ? (directButton.closest('button') as HTMLElement | null) || directButton
        : null) || bestButton
    const publishClassName =
      publishButton && typeof publishButton.className === 'string'
        ? publishButton.className
        : ''

    return {
      hasFailureText: Boolean(failureText),
      failureText,
      hasIndicator: Boolean(indicatorText),
      indicatorText,
      hasPublishButton: Boolean(publishButton),
      publishDisabled: publishButton ? isDisabledLike(publishButton) : true,
      publishLoading: Boolean(
        publishButton &&
          (publishClassName.includes('loading') || publishClassName.includes('ant-btn-loading'))
      ),
      publishText: publishButton
        ? normalizeText(publishButton.innerText || publishButton.textContent || '')
        : '',
      videoCount: document.querySelectorAll('video').length,
      pageTextSignals: ['重新上传', '更换视频', '替换视频', '裁剪封面', '设置封面'].filter((text) =>
        fullText.includes(text)
      )
    }
  })
}

async function checkVideoReady(page: import('puppeteer').Page): Promise<void> {
  const startedAt = Date.now()
  const timeoutMs = 120_000

  while (Date.now() - startedAt <= timeoutMs) {
    const snapshot = await readVideoReadySnapshot(page)

    if (snapshot.hasFailureText) {
      throw new Error(`视频上传失败：检测到“${snapshot.failureText}”提示。`)
    }

    if (snapshot.hasIndicator && snapshot.hasPublishButton && !snapshot.publishDisabled) {
      console.log(
        `[视频就绪] 检测到视频清晰度提示（${snapshot.indicatorText}），发布按钮已可用。`
      )
      return
    }

    if (snapshot.hasPublishButton && !snapshot.publishDisabled) {
      console.log('[视频就绪] 发布按钮已可用（未检测到清晰度提示，继续尝试发布）。')
      return
    }

    console.log(
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
    await delay(2_000)
  }

  throw new Error('视频上传未就绪：120 秒内未检测到“清晰度提示”且发布按钮仍不可用。')
}

async function focusEditorTarget(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState,
  target: EditorTarget
): Promise<MouseState> {
  const nextMouse = await humanClick(client, mouse, target.centerX, target.centerY)
  await delay(200)
  if (await isTargetFocused(page, target.selector)) {
    return nextMouse
  }

  await focusSelectorWithCdp(client, target.selector)
  await delay(100)
  if (await isTargetFocused(page, target.selector)) {
    return nextMouse
  }

  await page.evaluate((selector) => {
    const element = document.querySelector<HTMLElement>(selector)
    element?.focus()
  }, target.selector)
  await delay(100)
  return nextMouse
}

async function scrollSelectorIntoView(
  page: import('puppeteer').Page,
  selector: string,
  block: ScrollLogicalPosition = 'center'
): Promise<void> {
  await page.evaluate(
    ({ targetSelector, targetBlock }) => {
      const element = document.querySelector<HTMLElement>(targetSelector)
      if (!element) return
      try {
        element.scrollIntoView({ block: targetBlock, inline: 'center' })
      } catch (error) {
        void error
      }
    },
    { targetSelector: selector, targetBlock: block }
  )
  await delay(160)
}

async function focusSelectorWithCdp(
  client: import('puppeteer').CDPSession,
  selector: string
): Promise<void> {
  const documentNode = await client.send('DOM.getDocument', { depth: 2 })
  const queryResult = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector
  })
  if (!queryResult.nodeId) {
    return
  }

  await client.send('DOM.focus', { nodeId: queryResult.nodeId })
}

async function isTargetFocused(
  page: import('puppeteer').Page,
  selector: string
): Promise<boolean> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    const active = document.activeElement as HTMLElement | null
    if (!target || !active) {
      return false
    }

    return active === target || target.contains(active)
  }, selector)
}

async function fillTitleEditor(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  target: EditorTarget,
  text: string
): Promise<string> {
  await clearEditor(page, target.selector)
  await delay(120)
  await moveCaretToEnd(page, target.selector)
  await client.send('Input.insertText', { text })
  if (await verifyEditorContains(page, target.selector, text)) {
    return 'Input.insertText'
  }

  await page.evaluate(
    ({ targetSelector, targetText }) => {
      const target = document.querySelector<HTMLElement>(targetSelector)
      if (!target) return
      target.focus()
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        target.value = targetText
        target.dispatchEvent(new Event('input', { bubbles: true }))
        target.dispatchEvent(new Event('change', { bubbles: true }))
      }
    },
    { targetSelector: target.selector, targetText: text }
  )
  if (await verifyEditorContains(page, target.selector, text)) {
    return 'value + input/change event'
  }

  return '未成功'
}

async function fillBodyEditor(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  target: EditorTarget,
  text: string
): Promise<string> {
  const cleanText = normalizeBodyText(text)
  const topics = normalizeTagList(text)

  await clearEditor(page, target.selector)
  await delay(120)
  await moveCaretToEnd(page, target.selector)

  let method = '空正文'
  if (cleanText) {
    await client.send('Input.insertText', { text: cleanText })
    if (await verifyEditorContains(page, target.selector, cleanText)) {
      method = 'Input.insertText'
    } else {
      await page.evaluate(
        ({ targetSelector, targetText }) => {
          const target = document.querySelector<HTMLElement>(targetSelector)
          if (!target) return
          target.focus()
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            target.value = targetText
            target.dispatchEvent(new Event('input', { bubbles: true }))
            target.dispatchEvent(new Event('change', { bubbles: true }))
            return
          }
          document.execCommand('insertText', false, targetText)
          target.dispatchEvent(new Event('input', { bubbles: true }))
          target.dispatchEvent(new Event('change', { bubbles: true }))
        },
        { targetSelector: target.selector, targetText: cleanText }
      )
      if (await verifyEditorContains(page, target.selector, cleanText)) {
        method = 'document.execCommand(insertText)'
      } else {
        method = '未成功'
      }
    }
  }

  if (topics.length > 0 && cleanText) {
    await dispatchSpecialKey(page, 'Enter')
    await delay(100)
    await moveCaretToEnd(page, target.selector)
  }

  for (const topic of topics) {
    await insertTopic(page, client, target, topic)
  }

  return method
}

async function clearEditor(
  page: import('puppeteer').Page,
  selector: string
): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return
    target.focus()
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.value = ''
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }
    target.textContent = ''
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector)
}

async function moveCaretToEnd(
  page: import('puppeteer').Page,
  selector: string
): Promise<void> {
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

function normalizeBodyText(content: string): string {
  return String(content ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/#([^#\s]+)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeTagList(content: string): string[] {
  const fullText = String(content ?? '')
  const tags: string[] = []
  const seen = new Set<string>()
  const tagRegex = /#([^#\s]+)/g
  let match: RegExpExecArray | null = null
  while ((match = tagRegex.exec(fullText)) !== null) {
    const tag = String(match[1] ?? '').trim().replace(/^#+/, '')
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

async function dispatchCharacterKey(
  client: import('puppeteer').CDPSession,
  char: string,
  delayMs = 90
): Promise<void> {
  await client.send('Input.dispatchKeyEvent', {
    type: 'char',
    text: char,
    unmodifiedText: char
  })
  await delay(delayMs)
}

async function dispatchSpecialKey(
  page: import('puppeteer').Page,
  key: 'Enter' | 'Space'
): Promise<void> {
  await page.keyboard.press(key === 'Enter' ? 'Enter' : 'Space')
  await delay(80)
}

async function captureTopicDropdownBaseline(
  page: import('puppeteer').Page,
  selector: string
): Promise<Array<{ containerId: string; textDigest: string }>> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return []
    const TOPIC_DROPDOWN_NODE_SELECTOR = [
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
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(TOPIC_DROPDOWN_NODE_SELECTOR))) {
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
  page: import('puppeteer').Page,
  selector: string,
  topicName: string,
  baseline: Array<{ containerId: string; textDigest: string }>
): Promise<string[]> {
  return page.evaluate(
    ({ targetSelector, wantedTopic, baselineTexts }) => {
      const target = document.querySelector<HTMLElement>(targetSelector)
      if (!target) return []
      const TOPIC_DROPDOWN_NODE_SELECTOR = [
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
      const groups = new Map<string, { texts: string[]; changed: boolean; order: number }>()
      let order = 0

      for (const node of Array.from(document.querySelectorAll<HTMLElement>(TOPIC_DROPDOWN_NODE_SELECTOR))) {
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
          groups.set(containerId, { texts: [candidateText], changed: false, order })
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
      const fallback = Array.from(document.querySelectorAll<HTMLElement>('body *'))
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

      return fallback.slice(0, 20)
    },
    { targetSelector: selector, wantedTopic: topicName, baselineTexts: baseline }
  )
}

async function insertTopic(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  target: EditorTarget,
  topicName: string
): Promise<void> {
  const normalized = String(topicName ?? '').trim().replace(/^#+/, '')
  if (!normalized) return

  await moveCaretToEnd(page, target.selector)
  const currentText = await readEditorText(page, target.selector)
  const lastChar = currentText.slice(-1)
  if (currentText && lastChar && !/\s/.test(lastChar)) {
    await client.send('Input.insertText', { text: ' ' })
  }

  const baseline = await captureTopicDropdownBaseline(page, target.selector)

  await dispatchCharacterKey(client, '#', 120)
  for (const char of normalized) {
    await dispatchCharacterKey(client, char, 60)
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidates = await readTopicDropdownCandidates(page, target.selector, normalized, baseline)
    if (candidates.length > 0) {
      console.log(`[话题调试] ${normalized} 候选项: ${JSON.stringify(candidates.slice(0, 6))}`)
      await moveCaretToEnd(page, target.selector)
      await dispatchSpecialKey(page, 'Space')
      await delay(400)
      const rendered = await hasRichTopicInEditor(page, target.selector, normalized)
      const editorHtml = await readEditorHtml(page, target.selector)
      console.log(
        `[话题调试] ${normalized} 空格确认后: rendered=${rendered} html=${JSON.stringify(editorHtml.slice(0, 260))}`
      )
      return
    }
    await delay(250)
  }

  const matchDump = await dumpTopicMatchElements(page, normalized)
  console.log(`[话题调试] ${normalized} 未识别到下拉候选，匹配节点: ${JSON.stringify(matchDump, null, 2)}`)
}

async function hasRichTopicInEditor(
  page: import('puppeteer').Page,
  selector: string,
  topicName: string
): Promise<boolean> {
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

async function readEditorHtml(
  page: import('puppeteer').Page,
  selector: string
): Promise<string> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    return typeof target?.innerHTML === 'string' ? target.innerHTML : ''
  }, selector)
}

async function dumpTopicMatchElements(
  page: import('puppeteer').Page,
  topicName: string
): Promise<
  Array<{
    tagName: string
    role: string
    className: string
    text: string
    rect: { top: number; left: number; width: number; height: number }
    parents: string[]
  }>
> {
  return page.evaluate((wantedTopic) => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const wanted = `#${String(wantedTopic ?? '').trim().replace(/^#+/, '')}`
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 18
    }
    const describeParent = (element: HTMLElement | null): string => {
      if (!element) return ''
      const id = element.id ? `#${element.id}` : ''
      const className = typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, '.') : ''
      return `${element.tagName}${id}${className ? `.${className}` : ''}`
    }
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => isVisible(element))
      .map((element) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        return { element, text }
      })
      .filter(({ text }) => text.includes(wanted))
      .slice(0, 15)
      .map(({ element, text }) => {
        const rect = element.getBoundingClientRect()
        const parents: string[] = []
        let current = element.parentElement
        for (let depth = 0; current && depth < 5; depth += 1) {
          parents.push(describeParent(current))
          current = current.parentElement
        }
        return {
          tagName: element.tagName,
          role: element.getAttribute('role') ?? '',
          className: typeof element.className === 'string' ? element.className : '',
          text: text.slice(0, 180),
          rect: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          parents
        }
      })
  }, topicName)
}

async function verifyTopicsRendered(
  page: import('puppeteer').Page,
  selector: string,
  topics: string[]
): Promise<boolean> {
  if (topics.length === 0) return true
  return page.evaluate(
    ({ targetSelector, wantedTopics }) => {
      const editor = document.querySelector<HTMLElement>(targetSelector)
      if (!editor || editor.getAttribute('contenteditable') !== 'true') return true
      const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
      const isLikelyBlueText = (element: HTMLElement): boolean => {
        const match = String(window.getComputedStyle(element).color || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i)
        if (!match) return false
        const r = Number(match[1])
        const g = Number(match[2])
        const b = Number(match[3])
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && b >= 140 && b >= r + 30 && b >= g + 30
      }

      return wantedTopics.every((topic) => {
        const wanted = `#${String(topic ?? '').trim().replace(/^#+/, '')}`
        const nodes = Array.from(editor.querySelectorAll<HTMLElement>('a, span, [class*="topic"], [class*="Topic"]'))
        return nodes.some((element) => {
          const text = normalizeText(element.innerText || element.textContent || '')
          if (!text.includes(wanted)) return false
          if (element.tagName === 'A') return true
          const className = typeof element.className === 'string' ? element.className : ''
          return className.includes('topic') || className.includes('Topic') || isLikelyBlueText(element)
        })
      })
    },
    { targetSelector: selector, wantedTopics: topics }
  )
}

async function verifyEditorContains(
  page: import('puppeteer').Page,
  selector: string,
  expectedText: string
): Promise<boolean> {
  return page.evaluate(
    ({ targetSelector, targetText }) => {
      const target = document.querySelector<HTMLElement>(targetSelector)
      if (!target) return false
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

      const descendants = Array.from(
        target.querySelectorAll<HTMLElement>('[contenteditable], input, textarea, [role="textbox"]')
      )
      const descendantText = descendants
        .flatMap((element) => {
          const value = (element as HTMLInputElement | HTMLTextAreaElement).value
          return [value, element.innerText, element.textContent].filter(Boolean)
        })
        .join('\n')
      const value = (target as HTMLInputElement | HTMLTextAreaElement).value
      const combined = [value, target.innerText, target.textContent, descendantText]
        .filter(Boolean)
        .join('\n')
      return normalizeComparableText(combined).includes(normalizeComparableText(targetText))
    },
    { targetSelector: selector, targetText: expectedText }
  )
}

async function verifyBodyPlainText(
  page: import('puppeteer').Page,
  selector: string,
  expectedText: string
): Promise<boolean> {
  return page.evaluate(
    ({ targetSelector, targetText }) => {
      const target = document.querySelector<HTMLElement>(targetSelector)
      if (!target) return false
      const normalizeComparableText = (value: string): string =>
        String(value ?? '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .replace(/#([^#\s]+)/g, '')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n[ \t]+/g, '\n')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\n{2,}/g, '\n')
          .replace(/\s+/g, ' ')
          .trim()

      const cloned = target.cloneNode(true) as HTMLElement
      cloned.querySelectorAll('a, [class*="topic"], [class*="Topic"]').forEach((element) => element.remove())
      const combined = [cloned.innerText, cloned.textContent].filter(Boolean).join('\n')
      return normalizeComparableText(combined).includes(normalizeComparableText(targetText))
    },
    { targetSelector: selector, targetText: expectedText }
  )
}

async function readEditorText(
  page: import('puppeteer').Page,
  selector: string
): Promise<string> {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector<HTMLElement>(targetSelector)
    if (!target) return ''

    const descendants = Array.from(
      target.querySelectorAll<HTMLElement>('[contenteditable], input, textarea, [role="textbox"]')
    )
    const descendantText = descendants
      .flatMap((element) => {
        const value = (element as HTMLInputElement | HTMLTextAreaElement).value
        return [value, element.innerText, element.textContent].filter(Boolean)
      })
      .join('\n')
    const value = (target as HTMLInputElement | HTMLTextAreaElement).value
    return [value, target.innerText, target.textContent, descendantText]
      .filter(Boolean)
      .join('\n')
  }, selector)
}

async function ensureTargetInViewport(
  page: import('puppeteer').Page,
  selector: string
): Promise<EditorTarget> {
  const scrollIntoView = async (): Promise<void> => {
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

  const readSnapshot = async (): Promise<EditorTarget & { right: number; bottom: number; viewportWidth: number; viewportHeight: number }> =>
    page.evaluate((targetSelector) => {
      const element = document.querySelector<HTMLElement>(targetSelector)
      if (!element) {
        return {
          found: false,
          selector: targetSelector,
          tagName: '',
          role: '',
          placeholder: '',
          text: '',
          centerX: 0,
          centerY: 0,
          isContentEditable: false,
          isTextInput: false,
          right: 0,
          bottom: 0,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        }
      }
      const rect = element.getBoundingClientRect()
      return {
        found: true,
        selector: targetSelector,
        tagName: element.tagName,
        role: element.getAttribute('role') ?? '',
        placeholder: element.getAttribute('placeholder') ?? '',
        text: (element.innerText || element.textContent || '').trim(),
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        isContentEditable: element.getAttribute('contenteditable') === 'true',
        isTextInput: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    }, selector)

  await scrollIntoView()
  await delay(120)
  let snapshot = await readSnapshot()

  if (!snapshot.found) return snapshot
  if (snapshot.right > snapshot.viewportWidth - 8 || snapshot.bottom > snapshot.viewportHeight - 8) {
    await page.setViewport({
      width: Math.min(1800, Math.max(1280, Math.round(Math.max(snapshot.viewportWidth, snapshot.right + 120)))),
      height: Math.min(1400, Math.max(900, Math.round(Math.max(snapshot.viewportHeight, snapshot.bottom + 160))))
    })
    await delay(180)
    await scrollIntoView()
    await delay(120)
    snapshot = await readSnapshot()
  }

  return snapshot
}

async function markProductActionButton(
  page: import('puppeteer').Page,
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
          return { element, rect, score, index }
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)

      const match = candidates[0]
      if (!match) return null
      match.element.setAttribute(markerName, 'true')
      return {
        found: true,
        selector: `[${markerName}="true"]`,
        tagName: match.element.tagName,
        role: match.element.getAttribute('role') ?? '',
        placeholder: '',
        text: normalizeText(match.element.innerText || match.element.textContent || ''),
        centerX: match.rect.left + match.rect.width / 2,
        centerY: match.rect.top + match.rect.height / 2,
        isContentEditable: false,
        isTextInput: false
      }
    },
    { wantedTexts: texts, markerName: marker }
  )

  return (
    target ?? {
      found: false,
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

async function markKeywordClickTarget(
  page: import('puppeteer').Page,
  keyword: string,
  marker: string
): Promise<EditorTarget> {
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
          const rect = element.getBoundingClientRect()
          const clickable = clickableAncestor(element)
          if (!clickable || !isVisible(clickable)) return null
          const clickableRect = clickable.getBoundingClientRect()
          let score = 0
          if (text === wantedKeyword) score += 200
          score -= text.length * 0.5
          if (clickable.tagName === 'BUTTON') score += 20
          return { clickable, rect: clickableRect, score, index, text }
        })
        .filter((item): item is { clickable: HTMLElement; rect: DOMRect; score: number; index: number; text: string } => Boolean(item))
        .sort((a, b) => b.score - a.score || a.index - b.index)

      const match = candidates[0]
      if (!match) return null
      match.clickable.setAttribute(markerName, 'true')
      return {
        found: true,
        selector: `[${markerName}="true"]`,
        tagName: match.clickable.tagName,
        role: match.clickable.getAttribute('role') ?? '',
        placeholder: '',
        text: match.text,
        centerX: match.rect.left + match.rect.width / 2,
        centerY: match.rect.top + match.rect.height / 2,
        isContentEditable: false,
        isTextInput: false
      }
    },
    { wantedKeyword: keyword, markerName: marker }
  )

  return target ?? {
    found: false,
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
}

async function markLeafByTextContains(
  page: import('puppeteer').Page,
  keyword: string,
  marker: string
): Promise<EditorTarget> {
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
        tagName: leaf.tagName,
        role: leaf.getAttribute('role') ?? '',
        placeholder: '',
        text: normalizeText(leaf.innerText || leaf.textContent || ''),
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        isContentEditable: false,
        isTextInput: false
      }
    },
    { wantedKeyword: keyword, markerName: marker }
  )

  return target ?? {
    found: false,
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
}

async function clickKeywordLikeLegacy(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState,
  keyword: string,
  timeoutMs: number,
  marker: string
): Promise<{ found: boolean; mouse: MouseState }> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const leaf = await markLeafByTextContains(page, keyword, marker)
    if (leaf.found) {
      console.log(
        `[挂车调试] 准备点击关键词 ${keyword}: ${JSON.stringify({
          selector: leaf.selector,
          tagName: leaf.tagName,
          role: leaf.role,
          text: leaf.text,
          centerX: Math.round(leaf.centerX),
          centerY: Math.round(leaf.centerY)
        })}`
      )
      const clickable = await ensureTargetInViewport(page, leaf.selector)
      const nextMouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
      return { found: true, mouse: nextMouse }
    }
    await delay(350 + Math.floor(Math.random() * 300))
  }
  return { found: false, mouse }
}

async function dismissPotentialPopupsForProduct(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState
): Promise<MouseState> {
  const target = await markNeutralDismissTarget(page)
  if (!target.shouldClick || !target.found) {
    return mouse
  }

  const clickable = await ensureTargetInViewport(page, target.selector)
  const nextMouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
  await delay(900)
  return nextMouse
}

async function markNeutralDismissTarget(
  page: import('puppeteer').Page
): Promise<EditorTarget & { shouldClick: boolean }> {
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
      return {
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
    }

    clickable.setAttribute('data-cms-neutral-dismiss-target', 'true')
    const rect = clickable.getBoundingClientRect()
    return {
      found: true,
      shouldClick: hasOverlay,
      selector: '[data-cms-neutral-dismiss-target="true"]',
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

  return target ?? {
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
}

async function scrollPublishAreaToBottom(page: import('puppeteer').Page): Promise<void> {
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
    window.scrollTo(0, document.body.scrollHeight)
  })
  await delay(260)
}

async function ensureMinimumWindowLayout(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
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
  await delay(300)
}

async function markProductModalSearchInput(page: import('puppeteer').Page): Promise<EditorTarget> {
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
            element.closest('[role="dialog"], .ant-modal, .ant-modal-content, .d-modal, [class*=\"drawer\"], [class*=\"Drawer\"]')?.className ?? ''
          ].join(' ')
        )
        let score = 0
        if (text.includes('搜索')) score += 40
        if (text.includes('id')) score += 20
        if (text.includes('商品')) score += 18
        if (element.className.includes('ant-input')) score += 10
        return { element, rect, score, index }
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-product-search', 'true')
    return {
      found: true,
      selector: 'input[data-cms-product-search="true"]',
      tagName: match.element.tagName,
      role: match.element.getAttribute('role') ?? '',
      placeholder: match.element.placeholder ?? '',
      text: match.element.value ?? '',
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      isContentEditable: false,
      isTextInput: true
    }
  })

  return target ?? {
    found: false,
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
}

async function waitForProductModalSearchInput(page: import('puppeteer').Page): Promise<EditorTarget> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const input = await markProductModalSearchInput(page)
    if (input.found) return input
    await delay(250)
  }
  throw new Error('商品弹窗未打开（未找到搜索输入框）。')
}

async function fillProductSearchInput(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState,
  target: EditorTarget,
  text: string
): Promise<MouseState> {
  const reachable = await ensureTargetInViewport(page, target.selector)
  let nextMouse = await focusEditorTarget(page, client, mouse, reachable)
  await clearEditor(page, target.selector)
  await delay(120)
  await moveCaretToEnd(page, target.selector)
  await client.send('Input.insertText', { text })
  await page.evaluate((selector) => {
    const input = document.querySelector<HTMLElement>(selector)
    input?.dispatchEvent(new Event('input', { bubbles: true }))
    input?.dispatchEvent(new Event('change', { bubbles: true }))
  }, target.selector)
  return nextMouse
}

async function openProductModalWithRetry(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState
): Promise<{ input: EditorTarget; mouse: MouseState }> {
  await ensureMinimumWindowLayout(page, client, 1280, 900)
  await scrollPublishAreaToBottom(page)
  let opened = false
  const directAddProduct = await clickKeywordLikeLegacy(page, client, mouse, '添加商品', 2_500, 'data-cms-add-product-leaf')
  mouse = directAddProduct.mouse
  opened = directAddProduct.found
  if (!directAddProduct.found) {
    const addComponent = await markKeywordClickTarget(page, '添加组件', 'data-cms-add-component')
    if (addComponent.found) {
      const clickable = await ensureTargetInViewport(page, addComponent.selector)
      mouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
      await delay(400)
    } else {
      const legacyAddComponent = await clickKeywordLikeLegacy(page, client, mouse, '添加组件', 2_000, 'data-cms-add-component-leaf')
      mouse = legacyAddComponent.mouse
    }
    const secondTry = await clickKeywordLikeLegacy(page, client, mouse, '添加商品', 5_000, 'data-cms-add-product-leaf')
    mouse = secondTry.mouse
    opened = secondTry.found
    if (!secondTry.found) {
      const dump = await dumpProductEntryCandidates(page)
      console.log(`[挂车调试] 未找到添加商品入口，候选元素: ${JSON.stringify(dump, null, 2)}`)
      throw new Error('未找到“添加商品”按钮。')
    }
  }
  if (!opened) {
    const dump = await dumpProductEntryCandidates(page)
    console.log(`[挂车调试] 未找到添加商品入口，候选元素: ${JSON.stringify(dump, null, 2)}`)
  }
  await delay(600)
  try {
    return { input: await waitForProductModalSearchInput(page), mouse }
  } catch (error) {
    const pageState = await page.evaluate(() => {
      const text = String(document.body?.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
      const isVisible = (element: HTMLElement | null): element is HTMLElement => {
        if (!element) return false
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8
      }
      const inputs = Array.from(
        document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"], [role="textbox"]')
      )
        .filter((element) => isVisible(element))
        .map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            tagName: element.tagName,
            type:
              element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                ? element.type || ''
                : '',
            placeholder:
              element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
                ? element.placeholder || ''
                : '',
            className: String(element.className || ''),
            role: element.getAttribute('role') ?? '',
            text: String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            rect: {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          }
        })
        .slice(0, 40)
      return {
        url: location.href,
        title: document.title,
        textSample: text.slice(0, 1200),
        inputs
      }
    })
    console.log(`[挂车调试] 点击入口后未出现商品弹窗，页面状态: ${JSON.stringify(pageState, null, 2)}`)
    throw error
  }
}

async function dumpProductEntryCandidates(
  page: import('puppeteer').Page
): Promise<{
  viewport: { width: number; height: number }
  candidates: Array<{ tagName: string; className: string; text: string; rect: { top: number; left: number; width: number; height: number } }>
}> {
  return page.evaluate(() => {
    const normalizeText = (value: string): string => String(value ?? '').replace(/\s+/g, ' ').trim()
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 8 && rect.height > 8
    }
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span, p, li'))
      .filter((element) => isVisible(element))
      .map((element) => {
        const text = normalizeText(element.innerText || element.textContent || '')
        const rect = element.getBoundingClientRect()
        return {
          tagName: element.tagName,
          className: String(element.className || ''),
          text,
          rect: {
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        }
      })
      .filter((item) => /商品|组件|带货|橱窗/.test(item.text) || /goods|product|component/i.test(item.className))
      .slice(0, 60)
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      candidates
    }
  })
}

async function markProductItemById(page: import('puppeteer').Page, productId: string): Promise<EditorTarget> {
  const target = await page.evaluate(
    ({ wantedId, modalSelector }) => {
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
        element.setAttribute('data-cms-product-row-id', 'true')
        return {
          found: true,
          selector: '[data-cms-product-row-id="true"]',
          tagName: element.tagName,
          role: element.getAttribute('role') ?? '',
          placeholder: '',
          text,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
          isContentEditable: false,
          isTextInput: false
        }
      }
      return null
    },
    { wantedId: productId, modalSelector: PRODUCT_MODAL_SELECTOR }
  )
  return target ?? {
    found: false,
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
}

async function markFirstProductItem(page: import('puppeteer').Page): Promise<EditorTarget> {
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
        let score = 0
        if (/[¥￥]\s*\d+/.test(text)) score += 50
        if (element.querySelector('img')) score += 20
        score -= index
        return { element, rect, score }
      })
      .sort((a, b) => b.score - a.score)
    const match = items[0]
    if (!match) return null
    match.element.setAttribute('data-cms-product-row-first', 'true')
    return {
      found: true,
      selector: '[data-cms-product-row-first="true"]',
      tagName: match.element.tagName,
      role: match.element.getAttribute('role') ?? '',
      placeholder: '',
      text: normalizeText(match.element.innerText || match.element.textContent || ''),
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  }, PRODUCT_MODAL_SELECTOR)
  return target ?? {
    found: false,
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
}

async function markFirstProductCheckbox(page: import('puppeteer').Page): Promise<EditorTarget> {
  const target = await page.evaluate((modalSelector) => {
    const isVisible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element) return false
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 12 && rect.height > 12
    }
    const input = Array.from(document.querySelectorAll<HTMLInputElement>(`${modalSelector} input[type="checkbox"]`))[0]
    if (!input) return null
    const clickable = (input.closest('label, .ant-checkbox-wrapper, [role="checkbox"], div, span') as HTMLElement | null) || input
    if (!isVisible(clickable)) return null
    const rect = clickable.getBoundingClientRect()
    clickable.setAttribute('data-cms-product-checkbox', 'true')
    return {
      found: true,
      selector: '[data-cms-product-checkbox="true"]',
      tagName: clickable.tagName,
      role: clickable.getAttribute('role') ?? '',
      placeholder: '',
      text: (clickable.innerText || clickable.textContent || '').trim(),
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  }, PRODUCT_MODAL_SELECTOR)
  return target ?? {
    found: false,
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
}

async function markProductConfirmButton(page: import('puppeteer').Page): Promise<EditorTarget> {
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
        const disabled = element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true' || className.includes('disabled')
        let score = 0
        if (text === '确定') score += 500
        else if (text.includes('确定')) score += 320
        else if (text.includes('完成')) score += 220
        else if (text.includes('保存')) score += 180
        if (text.includes('取消')) score -= 400
        if (className.includes('primary') || className.includes('ant-btn-primary')) score += 200
        return { element, rect, score, index, disabled }
      })
      .filter((item) => item.score > 0 && !item.disabled)
      .sort((a, b) => b.score - a.score || b.rect.top - a.rect.top || b.rect.left - a.rect.left)
    const match = candidates[0]
    if (!match) return null
    match.element.setAttribute('data-cms-product-confirm', 'true')
    return {
      found: true,
      selector: '[data-cms-product-confirm="true"]',
      tagName: match.element.tagName,
      role: match.element.getAttribute('role') ?? '',
      placeholder: '',
      text: normalizeText(match.element.innerText || match.element.textContent || ''),
      centerX: match.rect.left + match.rect.width / 2,
      centerY: match.rect.top + match.rect.height / 2,
      isContentEditable: false,
      isTextInput: false
    }
  }, PRODUCT_MODAL_SELECTOR)
  return target ?? {
    found: false,
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
}

async function waitForProductModalClose(page: import('puppeteer').Page): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const visible = await page.evaluate((modalSelector) => {
      const input = document.querySelector<HTMLInputElement>(
        `${modalSelector} input.ant-input[placeholder*="搜索"], ${modalSelector} input[placeholder*="搜索"], ${modalSelector} input.ant-input`
      )
      if (!input) return false
      const style = window.getComputedStyle(input)
      const rect = input.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 20
    }, PRODUCT_MODAL_SELECTOR)
    if (!visible) return
    await delay(250)
  }
  throw new Error('商品弹窗未关闭。')
}

async function addProductsIfNeededForTest(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  sample: SamplePublishCopy
): Promise<void> {
  let mouse: MouseState = { x: 40, y: 40 }
  const products =
    sample.linkedProducts.length > 0
      ? sample.linkedProducts.map((item) => ({ id: item.id, name: item.name }))
      : [{ id: sample.productId ?? '', name: sample.productName ?? '' }]

  for (const product of products) {
    if (!product.id && !product.name) continue
    mouse = await dismissPotentialPopupsForProduct(page, client, mouse)
    const opened = await openProductModalWithRetry(page, client, mouse)
    mouse = opened.mouse
    await delay(2_000)

    if (product.id) {
      mouse = await fillProductSearchInput(page, client, mouse, opened.input, product.id)
      await delay(2_000)
      const byId = await markProductItemById(page, product.id)
      const row = byId.found ? byId : await markFirstProductItem(page)
      if (!row.found) throw new Error(`未找到商品 ID: ${product.id}`)
      const checkbox = await markFirstProductCheckbox(page)
      const selected = checkbox.found ? checkbox : row
      const clickable = await ensureTargetInViewport(page, selected.selector)
      mouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
    } else {
      mouse = await fillProductSearchInput(page, client, mouse, opened.input, product.name)
      await delay(600)
      const row = await markFirstProductItem(page)
      if (!row.found) throw new Error(`未找到商品名称: ${product.name}`)
      const clickable = await ensureTargetInViewport(page, row.selector)
      mouse = await humanClick(client, mouse, clickable.centerX, clickable.centerY)
    }

    await delay(300)
    const confirm = await markProductConfirmButton(page)
    if (!confirm.found) throw new Error('未找到商品弹窗确认按钮')
    const clickableConfirm = await ensureTargetInViewport(page, confirm.selector)
    mouse = await humanClick(client, mouse, clickableConfirm.centerX, clickableConfirm.centerY)
    await waitForProductModalClose(page).catch(() => void 0)
    await delay(900)
  }
}

async function readTrustedEventLog(page: import('puppeteer').Page) {
  return page.evaluate(() => {
    return ((window as typeof window & { __eventLog?: unknown[] }).__eventLog ?? []) as Array<{
      type: string
      isTrusted: boolean
      target?: string
      timestamp?: number
      x?: number
      y?: number
    }>
  })
}

async function runFinalDetectionProbe(
  page: import('puppeteer').Page,
  client: import('puppeteer').CDPSession,
  mouse: MouseState
): Promise<FinalDetectionResult> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __cmsFinalDetectionTrusted?: boolean | null
      __cmsFinalDetectionProbeInstalled?: boolean
    }

    if (!win.__cmsFinalDetectionProbeInstalled) {
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target
          if (
            target instanceof HTMLElement &&
            target.dataset.cmsFinalDetectionProbe === 'true'
          ) {
            win.__cmsFinalDetectionTrusted = event.isTrusted
          }
        },
        true
      )
      win.__cmsFinalDetectionProbeInstalled = true
    }

    win.__cmsFinalDetectionTrusted = null

    const previous = document.querySelector('[data-cms-final-detection-probe="true"]')
    previous?.remove()

    const probe = document.createElement('button')
    probe.type = 'button'
    probe.dataset.cmsFinalDetectionProbe = 'true'
    probe.textContent = 'Final Detection Probe'
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
    const element = document.querySelector<HTMLElement>('[data-cms-final-detection-probe="true"]')
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    }
  })

  if (!target) {
    throw new Error('未找到最终 detection 探针')
  }

  await humanClick(client, mouse, target.centerX, target.centerY)
  await delay(300)

  return page.evaluate(() => {
    const win = window as typeof window & {
      __cmsFinalDetectionTrusted?: boolean | null
      process?: unknown
      require?: unknown
      __electron?: unknown
      cdc_adoQpoasnfa76pfcZLmcfl_?: unknown
      domAutomation?: unknown
      domAutomationController?: unknown
      chrome?: { runtime?: unknown }
    }

    return {
      isTrusted: win.__cmsFinalDetectionTrusted ?? null,
      hasProcess: typeof win.process !== 'undefined',
      hasRequire: typeof win.require !== 'undefined',
      hasElectron: typeof win.__electron !== 'undefined',
      uaContainsElectron: navigator.userAgent.includes('Electron'),
      webdriver: Boolean(navigator.webdriver),
      hasChromeCdc: Boolean(win.cdc_adoQpoasnfa76pfcZLmcfl_),
      hasDomAutomation: Boolean(win.domAutomation),
      hasDomAutomationController: Boolean(win.domAutomationController),
      hasChrome: Boolean(win.chrome),
      hasChromeRuntime: Boolean(win.chrome?.runtime),
      pluginCount: navigator.plugins.length,
      languages: Array.from(navigator.languages ?? [])
    }
  })
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min))
}

async function jitterDelay(minMs: number, maxMs: number): Promise<void> {
  await delay(randomBetween(minMs, maxMs))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
