import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { promisify } from 'node:util'
import puppeteer from 'puppeteer'

import {
  assessPipeModeSupport,
  cleanupSingletonArtifacts,
  getChromeUserDataDir,
  getSingletonLockPathForUserDataDir,
  inspectChromeSingletonLock,
  parseChromeMajorVersion,
  summarizeLoginState,
  validateCmsNickname
} from './chrome-profile-utils.ts'

const execFileAsync = promisify(execFile)

export type ChromeVersionDetails = {
  profilePath: string
  userDataDir: string
}

export type LoginCheckResult = {
  finalUrl: string
  loggedIn: boolean
  reason: string
}

export type ChromeWindowMode = 'visible' | 'minimized' | 'offscreen' | 'edge-visible'

export type WindowPlacementResult = {
  mode: ChromeWindowMode
  applied: boolean
  fallbackApplied: boolean
  message: string
}

const XHS_REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function readChromeMajorVersion(executablePath: string): Promise<number> {
  const { stdout, stderr } = await execFileAsync(executablePath, ['--version'])
  return parseChromeMajorVersion(`${stdout}\n${stderr}`.trim())
}

export async function prepareCmsUserDataDirForLaunch(userDataDir: string): Promise<void> {
  const singletonLockPath = getSingletonLockPathForUserDataDir(userDataDir)
  const singletonStatus = inspectChromeSingletonLock(singletonLockPath)

  if (singletonStatus.status === 'active') {
    throw new Error('检测到 CMS 专用 Chrome 正在运行，请先关闭对应窗口再执行')
  }

  if (singletonStatus.status === 'stale') {
    console.log('检测到陈旧的 CMS 锁文件，正在清理后继续启动')
    cleanupSingletonArtifacts(userDataDir)
  }
}

export async function assertPipeModeSupported(
  executablePath: string,
  userDataDir: string
): Promise<void> {
  const chromeMajorVersion = await readChromeMajorVersion(executablePath)
  const support = assessPipeModeSupport({
    chromeMajorVersion,
    userDataDir,
    defaultUserDataDir: getChromeUserDataDir()
  })

  if (!support.supported) {
    throw new Error(support.reason)
  }
}

export async function launchCmsProfileBrowser(input: {
  executablePath: string
  userDataDir: string
  profileDir: string
}): Promise<import('puppeteer').Browser> {
  await prepareCmsUserDataDirForLaunch(input.userDataDir)
  await assertPipeModeSupported(input.executablePath, input.userDataDir)

  return puppeteer.launch({
    executablePath: input.executablePath,
    userDataDir: input.userDataDir,
    args: [
      `--profile-directory=${input.profileDir}`,
      '--window-size=1440,960',
      '--disable-blink-features=AutomationControlled'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    pipe: true,
    headless: false,
    defaultViewport: null,
    waitForInitialPage: false
  })
}

export async function prepareStealthPage(page: import('puppeteer').Page): Promise<void> {
  await page.setUserAgent(XHS_REAL_UA)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', {
      configurable: true,
      get: () => false
    })

    const hideSiteProcessPolyfill = () => {
      const win = window as typeof window & { process?: unknown }
      const processCarrier = win as { process?: unknown }
      const current = processCarrier.process
      if (!current || typeof current !== 'object') return
      const keys = Object.keys(current)
      if (!(keys.length === 1 && keys[0] === 'env')) return

      try {
        delete processCarrier.process
      } catch {
        void 0
      }

      try {
        Object.defineProperty(window, 'process', {
          configurable: true,
          enumerable: false,
          get: () => undefined,
          set: () => undefined
        })
      } catch {
        void 0
      }
    }

    const scheduleHide = () => {
      hideSiteProcessPolyfill()
      setTimeout(hideSiteProcessPolyfill, 0)
      setTimeout(hideSiteProcessPolyfill, 250)
      setTimeout(hideSiteProcessPolyfill, 500)
    }

    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        scheduleHide()
      }
    })

    window.addEventListener('load', scheduleHide)
  })
}

export async function setChromeWindowMode(
  page: import('puppeteer').Page,
  mode: ChromeWindowMode
): Promise<WindowPlacementResult> {
  if (mode === 'visible') {
    return {
      mode,
      applied: true,
      fallbackApplied: false,
      message: '窗口保持可见'
    }
  }

  const session = await page.createCDPSession()
  const { windowId } = await session.send('Browser.getWindowForTarget')

  if (mode === 'minimized') {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' }
    })
    return {
      mode,
      applied: true,
      fallbackApplied: false,
      message: '窗口已最小化到 Dock'
    }
  }

  if (mode === 'edge-visible') {
    try {
      const { bounds } = await session.send('Browser.getWindowForTarget')
      const metrics = await page.evaluate(() => ({
        availWidth: window.screen.availWidth || window.screen.width || window.innerWidth || 1280,
        availHeight: window.screen.availHeight || window.screen.height || window.innerHeight || 900
      }))
      const width = Math.max(
        1100,
        Math.min(Math.round(bounds.width ?? metrics.availWidth), metrics.availWidth - 24)
      )
      const height = Math.max(
        780,
        Math.min(Math.round(bounds.height ?? metrics.availHeight), metrics.availHeight - 48)
      )
      const left = Math.max(0, Math.round(metrics.availWidth - width - 24))
      const top = Math.max(0, Math.round(metrics.availHeight - height - 48))
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left,
          top,
          width,
          height
        }
      })
      return {
        mode,
        applied: true,
        fallbackApplied: false,
        message: `窗口已调整到右下角可见区域 (${width}x${height} @ ${left},${top})`
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        mode,
        applied: false,
        fallbackApplied: true,
        message: `右下角可见模式设置失败，保持原窗口位置: ${message}`
      }
    }
  }

  try {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: 10000, top: 0 }
    })
    await page.bringToFront().catch(() => void 0)
    return {
      mode,
      applied: true,
      fallbackApplied: false,
      message: '窗口已移到屏幕外'
    }
  } catch (error) {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'minimized' }
    })
    const message = error instanceof Error ? error.message : String(error)
    return {
      mode,
      applied: true,
      fallbackApplied: true,
      message: `离屏失败，已回退到最小化: ${message}`
    }
  }
}

export async function moveWindowOffscreenOrMinimize(
  page: import('puppeteer').Page
): Promise<void> {
  const result = await setChromeWindowMode(page, 'offscreen')
  console.log(result.message)
}

export async function closeBrowserSafely(
  browser: import('puppeteer').Browser | null | undefined
): Promise<void> {
  if (!browser) return
  const processHandle = browser.process()
  const pid = processHandle?.pid ?? null
  try {
    await browser.close()
  } catch {
    void 0
  }

  if (!pid) return

  try {
    process.kill(pid, 0)
  } catch {
    return
  }

  try {
    processHandle?.kill('SIGTERM')
  } catch {
    void 0
  }
}

export async function readChromeVersionDetails(
  page: import('puppeteer').Page
): Promise<ChromeVersionDetails> {
  await page.goto('chrome://version', {
    waitUntil: 'domcontentloaded',
    timeout: 15_000
  })
  await delay(1_000)

  const details = await page.evaluate(() => {
    const readValueById = (id: string): string =>
      document.querySelector<HTMLElement>(`#${id}`)?.innerText?.trim() ?? ''

    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
    const rowMap = new Map<string, string>()
    for (const row of rows) {
      const label = row.querySelector('td.label')?.textContent?.trim() ?? ''
      const value = row.querySelector('td.version')?.textContent?.trim() ?? ''
      if (label) rowMap.set(label, value)
    }

    return {
      profilePath: readValueById('profile_path') || rowMap.get('Profile Path') || '',
      userDataDir: readValueById('user_data_dir') || rowMap.get('User Data Dir') || ''
    }
  })

  if (!details.profilePath) {
    throw new Error('未能从 chrome://version 读取 Profile Path')
  }

  return {
    profilePath: details.profilePath,
    userDataDir: details.userDataDir || dirname(details.profilePath)
  }
}

export async function openCreatorCenter(page: import('puppeteer').Page): Promise<void> {
  await page.goto('https://creator.xiaohongshu.com', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  })
  await delay(3_000)
}

export async function checkCreatorLogin(
  page: import('puppeteer').Page
): Promise<LoginCheckResult> {
  const finalUrl = page.url()
  const cookies = await page.cookies('https://creator.xiaohongshu.com')
  const summary = summarizeLoginState({ finalUrl, cookies })

  return {
    finalUrl,
    loggedIn: summary.loggedIn,
    reason: summary.reason
  }
}

export async function waitForEnter(promptText: string): Promise<void> {
  const rl = createInterface({ input, output })
  try {
    await rl.question(promptText)
  } finally {
    rl.close()
  }
}

export async function promptForNickname(profileId: string, currentNickname: string): Promise<string> {
  const rl = createInterface({ input, output })
  try {
    while (true) {
      const prompt =
        currentNickname.trim().length > 0
          ? `请输入 ${profileId} 的昵称（当前：${currentNickname}）: `
          : `请输入 ${profileId} 的昵称: `
      const answer = await rl.question(prompt)
      try {
        return validateCmsNickname(answer)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.log(message)
      }
    }
  } finally {
    rl.close()
  }
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
