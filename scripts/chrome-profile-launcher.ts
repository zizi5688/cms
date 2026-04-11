import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import puppeteer from 'puppeteer'

import {
  assessPipeModeSupport,
  cleanupSingletonArtifacts,
  getChromeExecutablePath,
  getChromeLocalStatePath,
  getChromeSingletonLockPath,
  getChromeUserDataDir,
  inspectChromeSingletonLock,
  parseChromeMajorVersion,
  parseChromeProfilesFromLocalState,
  parseProfileArgument,
  resolveRequestedProfile,
  summarizeLoginState
} from './chrome-profile-utils.ts'

const execFileAsync = promisify(execFile)

async function readProfiles() {
  const userDataDir = getChromeUserDataDir()
  const rawLocalState = await readFile(getChromeLocalStatePath(), 'utf8')
  return parseChromeProfilesFromLocalState(rawLocalState, userDataDir)
}

async function readChromeMajorVersion(executablePath: string): Promise<number> {
  const { stdout, stderr } = await execFileAsync(executablePath, ['--version'])
  const output = `${stdout}\n${stderr}`.trim()
  return parseChromeMajorVersion(output)
}

async function moveWindowOffscreenOrMinimize(page: import('puppeteer').Page): Promise<void> {
  const session = await page.createCDPSession()
  const { windowId } = await session.send('Browser.getWindowForTarget')

  try {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: -2000,
        top: 0
      }
    })
    console.log('已尝试将 Chrome 窗口移到屏幕外')
  } catch (error) {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        windowState: 'minimized'
      }
    })
    const message = error instanceof Error ? error.message : String(error)
    console.log(`离屏移动失败，已最小化窗口: ${message}`)
  }
}

async function readProfilePath(page: import('puppeteer').Page): Promise<string> {
  console.log('正在打开 chrome://version')
  await page.goto('chrome://version', {
    waitUntil: 'domcontentloaded',
    timeout: 15_000
  })
  await new Promise((resolve) => setTimeout(resolve, 1_000))

  const profilePath = await page.evaluate(() => {
    const direct = document.querySelector<HTMLElement>('#profile_path')?.innerText?.trim()
    if (direct) return direct

    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tr'))
    for (const row of rows) {
      const label = row.querySelector('td.label')?.textContent?.trim()
      if (label === 'Profile Path') {
        return row.querySelector('td.version')?.textContent?.trim() ?? ''
      }
    }

    return ''
  })

  if (!profilePath) {
    throw new Error('未能从 chrome://version 读取 Profile Path')
  }

  return profilePath
}

async function checkXiaohongshuLogin(page: import('puppeteer').Page): Promise<void> {
  console.log('正在打开小红书创作者中心')
  await page.goto('https://creator.xiaohongshu.com', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  })
  await new Promise((resolve) => setTimeout(resolve, 3_000))

  const finalUrl = page.url()
  const cookies = await page.cookies('https://creator.xiaohongshu.com')
  const summary = summarizeLoginState({ finalUrl, cookies })

  console.log(`创作者中心最终 URL: ${finalUrl}`)
  console.log(`创作者中心登录态: ${summary.loggedIn ? '已登录' : '未登录'} (${summary.reason})`)
}

async function main(): Promise<void> {
  const requestedProfile = parseProfileArgument(process.argv.slice(2))
  const singletonLockPath = getChromeSingletonLockPath()
  const userDataDir = getChromeUserDataDir()
  const executablePath = getChromeExecutablePath()
  const singletonStatus = inspectChromeSingletonLock(singletonLockPath)

  if (singletonStatus.status === 'active') {
    console.error('检测到 Chrome 正在运行，请先关闭所有 Chrome 窗口再执行')
    process.exit(1)
  }

  if (singletonStatus.status === 'stale') {
    console.log('检测到陈旧的 Chrome 锁文件，正在清理后继续启动')
    cleanupSingletonArtifacts(userDataDir)
  }

  const chromeMajorVersion = await readChromeMajorVersion(executablePath)
  const pipeModeSupport = assessPipeModeSupport({
    chromeMajorVersion,
    userDataDir,
    defaultUserDataDir: getChromeUserDataDir()
  })

  if (!pipeModeSupport.supported) {
    console.error(pipeModeSupport.reason)
    process.exit(1)
  }

  const profiles = await readProfiles()
  const profile = resolveRequestedProfile(profiles, requestedProfile)

  console.log(`准备启动 Profile: ${profile.directoryName} (${profile.fullPath})`)

  const browser = await puppeteer.launch({
    executablePath,
    userDataDir,
    args: [`--profile-directory=${profile.directoryName}`],
    pipe: true,
    headless: false,
    defaultViewport: null,
    waitForInitialPage: false
  })

  try {
    console.log('浏览器已启动')
    const pages = await browser.pages()
    const firstPage = pages[0] ?? (await browser.newPage())

    console.log('正在调整窗口位置')
    await moveWindowOffscreenOrMinimize(firstPage)

    const versionPage = await browser.newPage()
    const effectiveProfilePath = await readProfilePath(versionPage)
    console.log(`Profile Path: ${effectiveProfilePath}`)

    const creatorPage = await browser.newPage()
    await checkXiaohongshuLogin(creatorPage)

    await new Promise((resolve) => setTimeout(resolve, 5_000))
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
