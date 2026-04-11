import os from 'node:os'

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
  moveWindowOffscreenOrMinimize,
  prepareStealthPage
} from './cms-profile-runtime.ts'
import { humanClick, type MouseState } from './lib/human-input.ts'

const DEFAULT_PROFILE = 'cms-profile-1'
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'

type DetectionResult = {
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
  stackTrace: string
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profileId = parseOptionalProfile(argv)
  const shouldHideWindow = argv.includes('--hide-window')
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
    await page.goto(PUBLISH_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    })
    await delay(5_500)

    const login = await checkCreatorLogin(page)
    if (!login.loggedIn) {
      throw new Error(`当前 Profile 登录态无效，无法进入发布页: ${login.reason}`)
    }

    if (shouldHideWindow) {
      const firstPage = (await browser.pages())[0] ?? page
      await moveWindowOffscreenOrMinimize(firstPage)
    }

    await installDetectionProbe(page)
    const baseline = await readDetection(page)

    const probeTarget = await readProbeTarget(page)
    if (!probeTarget) {
      throw new Error('未找到检测探针按钮')
    }
    mouse = await humanClick(client, mouse, probeTarget.centerX, probeTarget.centerY)
    await delay(500)

    const afterCdpClick = await readDetection(page)

    console.log(`模式: CDP`)
    console.log(`Profile: ${profile.profileDir}`)
    console.log(`页面: ${page.url()}`)
    console.log('基线检测:')
    console.log(JSON.stringify(baseline, null, 2))
    console.log('CDP 点击后检测:')
    console.log(JSON.stringify(afterCdpClick, null, 2))
    console.log('差异摘要:')
    console.log(
      JSON.stringify(
        buildDiffSummary(baseline, afterCdpClick),
        null,
        2
      )
    )

    await delay(2_000)
  } finally {
    await closeBrowserSafely(browser)
  }
}

function parseOptionalProfile(argv: string[]): string {
  const index = argv.indexOf('--profile')
  if (index === -1) return DEFAULT_PROFILE
  return parseProfileArgument(argv)
}

async function installDetectionProbe(page: import('puppeteer').Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as typeof window & {
      __cmsDetectionLastTrusted?: boolean | null
      __cmsDetectionProbeInstalled?: boolean
    }

    if (!win.__cmsDetectionProbeInstalled) {
      document.addEventListener(
        'click',
        (event) => {
          win.__cmsDetectionLastTrusted = event.isTrusted
        },
        true
      )
      win.__cmsDetectionProbeInstalled = true
    }

    win.__cmsDetectionLastTrusted = null

    const existing = document.getElementById('cms-detection-probe')
    if (existing) {
      existing.remove()
    }

    const probe = document.createElement('button')
    probe.id = 'cms-detection-probe'
    probe.type = 'button'
    probe.textContent = 'CDP Detection Probe'
    probe.style.position = 'fixed'
    probe.style.right = '24px'
    probe.style.bottom = '24px'
    probe.style.zIndex = '2147483647'
    probe.style.padding = '10px 14px'
    probe.style.borderRadius = '999px'
    probe.style.border = '2px solid #111827'
    probe.style.background = '#fde68a'
    probe.style.color = '#111827'
    probe.style.fontSize = '14px'
    probe.style.fontWeight = '700'
    probe.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)'
    probe.style.pointerEvents = 'auto'
    document.body.appendChild(probe)
  })
}

async function readProbeTarget(
  page: import('puppeteer').Page
): Promise<{ centerX: number; centerY: number } | null> {
  return page.evaluate(() => {
    const element = document.getElementById('cms-detection-probe')
    if (!(element instanceof HTMLElement)) return null
    const rect = element.getBoundingClientRect()
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2
    }
  })
}

async function readDetection(page: import('puppeteer').Page): Promise<DetectionResult> {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __cmsDetectionLastTrusted?: boolean | null
      process?: unknown
      require?: unknown
      __electron?: unknown
      cdc_adoQpoasnfa76pfcZLmcfl_?: unknown
      domAutomation?: unknown
      domAutomationController?: unknown
      chrome?: { runtime?: unknown }
    }

    return {
      isTrusted: win.__cmsDetectionLastTrusted ?? null,
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
      languages: Array.from(navigator.languages ?? []),
      stackTrace: String(new Error().stack ?? '')
    }
  })
}

function buildDiffSummary(
  before: DetectionResult,
  after: DetectionResult
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    const beforeValue = before[key as keyof DetectionResult]
    const afterValue = after[key as keyof DetectionResult]
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue
    diff[key] = {
      before: beforeValue,
      after: afterValue
    }
  }
  return diff
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
