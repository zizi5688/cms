import os from 'node:os'
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import ElectronStore from 'electron-store'
import puppeteer, { type Browser, type Page } from 'puppeteer'

import type {
  CmsChromeAccountsConfig,
  CmsChromeLoginVerificationResult,
  CmsChromeProfilePurpose,
  CmsChromeProfileRecord
} from '../shared/cmsChromeProfileTypes'

type ElectronStoreCtor = new <T extends Record<string, unknown> = Record<string, unknown>>() => ElectronStore<T>
const StoreCtor = ((ElectronStore as unknown as { default?: ElectronStoreCtor }).default ??
  (ElectronStore as unknown as ElectronStoreCtor)) as ElectronStoreCtor
const execFileAsync = promisify(execFile)

const DEFAULT_CHROME_EXECUTABLE =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PRODUCTION_CMS_DATA_DIR = join(os.homedir(), 'chrome-cms-data')
const DEVELOPMENT_CMS_DATA_DIR = join(os.homedir(), 'chrome-cms-data-dev')
const CMS_ACCOUNTS_FILENAME = 'cms-accounts.json'
const DEFAULT_GATEWAY_PROFILE_ID = 'cms-gateway-profile'
type PublishRuntimeStore = {
  publishMode?: 'electron' | 'cdp'
  chromeExecutablePath?: string
  cmsChromeDataDir?: string
}

type SingletonLockStatus = {
  status: 'missing' | 'active' | 'stale'
  pid: number | null
}

type LaunchChromeOptions = {
  executablePath?: string
  userDataDir?: string
  interactive?: boolean
  activeLockMessage?: string
}

export type ChromeWindowMode = 'visible' | 'minimized' | 'offscreen' | 'edge-visible'

export type WindowPlacementResult = {
  mode: ChromeWindowMode
  applied: boolean
  fallbackApplied: boolean
  message: string
}

type ResolvedChromeRuntimeConfig = {
  executablePath: string
  userDataDir: string
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function getCmsAccountsConfigPath(userDataDir: string): string {
  return join(userDataDir, CMS_ACCOUNTS_FILENAME)
}

function normalizeCmsChromeProfilePurpose(value: unknown): CmsChromeProfilePurpose {
  return value === 'gateway' || value === 'shared' ? value : 'publisher'
}

function normalizeCmsChromeProfileRecord(profile: Partial<CmsChromeProfileRecord>): CmsChromeProfileRecord {
  return {
    id: typeof profile.id === 'string' ? profile.id.trim() : '',
    nickname: typeof profile.nickname === 'string' ? profile.nickname : '',
    profileDir:
      typeof profile.profileDir === 'string' && profile.profileDir.trim()
        ? profile.profileDir.trim()
        : typeof profile.id === 'string'
          ? profile.id.trim()
          : '',
    purpose: normalizeCmsChromeProfilePurpose(profile.purpose),
    xhsLoggedIn: profile.xhsLoggedIn === true,
    lastLoginCheck:
      typeof profile.lastLoginCheck === 'string' && profile.lastLoginCheck.trim()
        ? profile.lastLoginCheck
        : null
  }
}

function createDefaultCmsAccountsConfig(runtime: ResolvedChromeRuntimeConfig): CmsChromeAccountsConfig {
  return {
    profiles: [],
    chromeExecutable: runtime.executablePath,
    cmsDataDir: runtime.userDataDir
  }
}

async function ensureCmsAccountsConfigExists(
  userDataDir?: string
): Promise<CmsChromeAccountsConfig> {
  const runtime = resolveRuntimeConfigFromStore()
  const dataDir = ensureDirectory(
    userDataDir ? normalizeCmsDataDirValue(userDataDir) : runtime.userDataDir
  )
  const configPath = getCmsAccountsConfigPath(dataDir)
  if (!existsSync(configPath)) {
    const config = createDefaultCmsAccountsConfig({
      executablePath: runtime.executablePath,
      userDataDir: dataDir
    })
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
    return config
  }

  const existing = await readCmsAccountsConfig(dataDir)
  return (
    existing ?? {
      profiles: [],
      chromeExecutable: runtime.executablePath,
      cmsDataDir: dataDir
    }
  )
}

function normalizeProfileNickname(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildDefaultGatewayProfileRecord(): CmsChromeProfileRecord {
  return {
    id: DEFAULT_GATEWAY_PROFILE_ID,
    nickname: '本地网关专用',
    profileDir: DEFAULT_GATEWAY_PROFILE_ID,
    purpose: 'gateway',
    xhsLoggedIn: false,
    lastLoginCheck: null
  }
}

function parseSingletonPid(target: string): number | null {
  const match = /-(\d+)$/.exec(String(target ?? '').trim())
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function inspectSingletonLock(lockPath: string): SingletonLockStatus {
  if (!existsSync(lockPath)) {
    return { status: 'missing', pid: null }
  }

  try {
    lstatSync(lockPath)
  } catch {
    return { status: 'missing', pid: null }
  }

  let target = ''
  try {
    target = readlinkSync(lockPath)
  } catch {
    return { status: 'active', pid: null }
  }

  const pid = parseSingletonPid(target)
  if (!pid) return { status: 'active', pid: null }
  return { status: isProcessRunning(pid) ? 'active' : 'stale', pid }
}

function cleanupSingletonArtifacts(userDataDir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    rmSync(join(userDataDir, name), { force: true })
  }
}

function parseChromeMajorVersion(versionOutput: string): number {
  const match = /(\d+)\./.exec(versionOutput)
  if (!match) throw new Error(`无法解析 Chrome 版本号: ${versionOutput}`)
  return Number.parseInt(match[1], 10)
}

async function readChromeMajorVersion(executablePath: string): Promise<number> {
  const { stdout, stderr } = await execFileAsync(executablePath, ['--version'])
  return parseChromeMajorVersion(`${stdout}\n${stderr}`.trim())
}

async function hasRunningChromeProcessForUserDataDir(userDataDir: string): Promise<boolean> {
  const normalizedUserDataDir = resolve(userDataDir)
  try {
    const { stdout } = await execFileAsync('ps', ['-ax', '-o', 'pid=,command='])
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .some((line) => line.includes('Google Chrome') && line.includes(`--user-data-dir=${normalizedUserDataDir}`))
  } catch {
    return false
  }
}

async function assertPipeModeSupported(executablePath: string, userDataDir: string): Promise<void> {
  const major = await readChromeMajorVersion(executablePath)
  const defaultUserDataDir = join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
  if (major >= 136 && resolve(userDataDir) === resolve(defaultUserDataDir)) {
    throw new Error(
      '当前系统 Chrome 为 136+，官方已禁止对默认 Chrome user-data-dir 使用 --remote-debugging-pipe；请改用 CMS 专用目录。'
    )
  }
}

function normalizePathValue(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return fallback
  if (raw.startsWith('~/')) return join(os.homedir(), raw.slice(2))
  return raw
}

function isDevelopmentRuntime(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    typeof process.env.ELECTRON_RENDERER_URL === 'string' ||
    process.defaultApp === true
  )
}

function getDefaultCmsDataDir(): string {
  return isDevelopmentRuntime() ? DEVELOPMENT_CMS_DATA_DIR : PRODUCTION_CMS_DATA_DIR
}

function normalizeCmsDataDirValue(value: unknown): string {
  const defaultDir = getDefaultCmsDataDir()
  const resolved = normalizePathValue(value, defaultDir)
  if (isDevelopmentRuntime() && resolve(resolved) === resolve(PRODUCTION_CMS_DATA_DIR)) {
    return DEVELOPMENT_CMS_DATA_DIR
  }
  return resolved
}

function ensureDirectory(pathValue: string): string {
  const resolved = resolve(pathValue)
  mkdirSync(resolved, { recursive: true })
  return resolved
}

function resolveRuntimeConfigFromStore(): ResolvedChromeRuntimeConfig {
  const store = new StoreCtor<PublishRuntimeStore>()
  const executablePath = normalizePathValue(store.get('chromeExecutablePath'), DEFAULT_CHROME_EXECUTABLE)
  const userDataDir = ensureDirectory(normalizeCmsDataDirValue(store.get('cmsChromeDataDir')))
  return { executablePath, userDataDir }
}

export function getDefaultCmsChromeDataDir(): string {
  return getDefaultCmsDataDir()
}

export function getDefaultGatewayProfileId(): string {
  return DEFAULT_GATEWAY_PROFILE_ID
}

export async function readCmsAccountsConfig(
  userDataDir?: string
): Promise<CmsChromeAccountsConfig | null> {
  const runtime = resolveRuntimeConfigFromStore()
  const dataDir = ensureDirectory(userDataDir ? normalizePathValue(userDataDir, runtime.userDataDir) : runtime.userDataDir)
  const configPath = getCmsAccountsConfigPath(dataDir)
  if (!existsSync(configPath)) return null
  const raw = await readFile(configPath, 'utf-8')
  const parsed = JSON.parse(raw) as Partial<CmsChromeAccountsConfig>
  const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : []
  return {
    profiles: profiles
      .filter((profile): profile is CmsChromeProfileRecord => Boolean(profile && typeof profile === 'object'))
      .map((profile) => normalizeCmsChromeProfileRecord(profile))
      .filter((profile) => Boolean(profile.id) && Boolean(profile.profileDir)),
    chromeExecutable: normalizePathValue(parsed.chromeExecutable, runtime.executablePath),
    cmsDataDir: ensureDirectory(normalizeCmsDataDirValue(parsed.cmsDataDir ?? dataDir))
  }
}

export async function writeCmsAccountsConfig(
  config: CmsChromeAccountsConfig,
  userDataDir?: string
): Promise<void> {
  const runtime = resolveRuntimeConfigFromStore()
  const dataDir = ensureDirectory(userDataDir ? normalizePathValue(userDataDir, runtime.userDataDir) : runtime.userDataDir)
  const configPath = getCmsAccountsConfigPath(dataDir)
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

export async function listCmsChromeProfiles(): Promise<CmsChromeProfileRecord[]> {
  const config = await ensureCmsAccountsConfigExists()
  return config.profiles
}

export async function createCmsChromeProfile(input?: {
  nickname?: string
  purpose?: CmsChromeProfilePurpose
}): Promise<CmsChromeProfileRecord> {
  const runtime = resolveRuntimeConfigFromStore()
  const dataDir = runtime.userDataDir
  const existing = await ensureCmsAccountsConfigExists(dataDir)
  const usedIds = new Set(existing.profiles.map((profile) => profile.id))
  let nextIndex = 1
  while (usedIds.has(`cms-profile-${nextIndex}`)) {
    nextIndex += 1
  }

  const id = `cms-profile-${nextIndex}`
  const profile: CmsChromeProfileRecord = {
    id,
    nickname: normalizeProfileNickname(input?.nickname),
    profileDir: id,
    purpose: input?.purpose === 'gateway' || input?.purpose === 'shared' ? input.purpose : 'publisher',
    xhsLoggedIn: false,
    lastLoginCheck: null
  }

  mkdirSync(join(dataDir, profile.profileDir), { recursive: true })
  const nextConfig: CmsChromeAccountsConfig = {
    ...existing,
    chromeExecutable: existing.chromeExecutable || runtime.executablePath,
    cmsDataDir: existing.cmsDataDir || dataDir,
    profiles: [...existing.profiles, profile]
  }
  await writeCmsAccountsConfig(nextConfig, dataDir)
  return profile
}

export async function renameCmsChromeProfile(
  profileId: string,
  nickname: string
): Promise<CmsChromeProfileRecord> {
  const runtime = resolveRuntimeConfigFromStore()
  const dataDir = runtime.userDataDir
  const existing = await ensureCmsAccountsConfigExists(dataDir)

  const normalizedProfileId = String(profileId ?? '').trim()
  if (!normalizedProfileId) {
    throw new Error('profileId 不能为空。')
  }

  const normalizedNickname = normalizeProfileNickname(nickname)
  if (!normalizedNickname) {
    throw new Error('Profile 昵称不能为空。')
  }

  const index = existing.profiles.findIndex(
    (profile) => profile.id === normalizedProfileId || profile.profileDir === normalizedProfileId
  )
  if (index < 0) {
    throw new Error(`未找到 CMS Chrome Profile: ${normalizedProfileId}`)
  }

  const updatedProfile: CmsChromeProfileRecord = {
    ...existing.profiles[index],
    nickname: normalizedNickname
  }
  const nextProfiles = [...existing.profiles]
  nextProfiles[index] = updatedProfile
  const nextConfig: CmsChromeAccountsConfig = {
    ...existing,
    profiles: nextProfiles
  }
  await writeCmsAccountsConfig(nextConfig, dataDir)
  return updatedProfile
}

export async function ensureCmsGatewayProfileRecord(): Promise<{
  profile: CmsChromeProfileRecord
  config: CmsChromeAccountsConfig
}> {
  const runtime = resolveRuntimeConfigFromStore()
  const dataDir = runtime.userDataDir
  const existing = await ensureCmsAccountsConfigExists(dataDir)
  const nextProfiles = [...existing.profiles]
  const index = nextProfiles.findIndex(
    (item) => item.id === DEFAULT_GATEWAY_PROFILE_ID || item.profileDir === DEFAULT_GATEWAY_PROFILE_ID
  )

  const gatewayProfile =
    index >= 0
      ? {
          ...nextProfiles[index],
          purpose: 'gateway' as const,
          nickname: nextProfiles[index].nickname || '本地网关专用',
          profileDir: nextProfiles[index].profileDir || DEFAULT_GATEWAY_PROFILE_ID
        }
      : buildDefaultGatewayProfileRecord()

  if (index >= 0) {
    nextProfiles[index] = gatewayProfile
  } else {
    nextProfiles.push(gatewayProfile)
  }

  const nextConfig: CmsChromeAccountsConfig = {
    ...existing,
    chromeExecutable: existing.chromeExecutable || runtime.executablePath,
    cmsDataDir: existing.cmsDataDir || dataDir,
    profiles: nextProfiles
  }
  await writeCmsAccountsConfig(nextConfig, dataDir)
  return {
    profile: gatewayProfile,
    config: nextConfig
  }
}

export async function listGatewayCmsChromeProfiles(): Promise<CmsChromeProfileRecord[]> {
  const config = await readCmsAccountsConfig()
  if (!config) return []
  return config.profiles.filter((profile) => profile.purpose === 'gateway' || profile.purpose === 'shared')
}

export async function resolveCmsChromeProfile(profileId: string): Promise<{
  profile: CmsChromeProfileRecord
  runtime: ResolvedChromeRuntimeConfig
}> {
  const runtime = resolveRuntimeConfigFromStore()
  const config = await ensureCmsAccountsConfigExists(runtime.userDataDir)

  const normalizedProfileId = String(profileId ?? '').trim()
  const profile =
    config.profiles.find((item) => item.id === normalizedProfileId) ??
    config.profiles.find((item) => item.profileDir === normalizedProfileId)
  if (!profile) {
    throw new Error(`未找到 CMS Chrome Profile: ${normalizedProfileId}`)
  }

  return {
    profile,
    runtime: {
      executablePath: normalizePathValue(config.chromeExecutable, runtime.executablePath),
      userDataDir: ensureDirectory(normalizePathValue(config.cmsDataDir, runtime.userDataDir))
    }
  }
}

async function prepareUserDataDirForLaunch(
  userDataDir: string,
  activeLockMessage: string
): Promise<void> {
  const lockPath = join(userDataDir, 'SingletonLock')
  const status = inspectSingletonLock(lockPath)
  if (status.status === 'active') {
    throw new Error(activeLockMessage)
  }
  if (status.status === 'missing' && (await hasRunningChromeProcessForUserDataDir(userDataDir))) {
    throw new Error(activeLockMessage)
  }
  if (status.status === 'stale') {
    cleanupSingletonArtifacts(userDataDir)
  }
}

function viewportForSession(): { width: number; height: number } {
  return {
    width: randomInt(1280, 1600),
    height: randomInt(800, 1000)
  }
}

export async function prepareStealthPage(page: Page): Promise<void> {
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

export async function launchChrome(
  profileDir: string,
  options: LaunchChromeOptions = {}
): Promise<Browser> {
  const runtime = resolveRuntimeConfigFromStore()
  const executablePath = normalizePathValue(options.executablePath, runtime.executablePath)
  const userDataDir = ensureDirectory(normalizePathValue(options.userDataDir, runtime.userDataDir))
  await prepareUserDataDirForLaunch(
    userDataDir,
    options.activeLockMessage ?? 'CMS 已有一个发布任务正在执行，请等待完成后再试。'
  )
  await assertPipeModeSupported(executablePath, userDataDir)
  const viewport = viewportForSession()

  return puppeteer.launch({
    executablePath,
    userDataDir,
    args: [
      `--profile-directory=${profileDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
      '--disable-blink-features=AutomationControlled'
    ],
    pipe: true,
    headless: false,
    defaultViewport: null,
    waitForInitialPage: false
  })
}

export async function closeChrome(browser: Browser | null | undefined): Promise<void> {
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
    try {
      browser.process()?.kill('SIGTERM')
    } catch {
      void 0
    }
  }
}

export async function setChromeWindowMode(
  page: Page,
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

export async function moveWindowOffscreenOrMinimize(page: Page): Promise<void> {
  await setChromeWindowMode(page, 'offscreen')
}

function summarizeCreatorLogin(input: {
  finalUrl: string
  cookies: Array<{ name: string; value?: string }>
}): { loggedIn: boolean; reason: string } {
  const finalUrl = String(input.finalUrl ?? '')
  const cookies = Array.isArray(input.cookies) ? input.cookies : []
  const cookieNames = new Set(
    cookies
      .filter((cookie) => typeof cookie?.name === 'string' && String(cookie.value ?? '').trim())
      .map((cookie) => String(cookie.name).trim())
  )
  const hasSessionCookie =
    cookieNames.has('web_session') ||
    cookieNames.has('galaxy_creator_session_id') ||
    cookieNames.has('access-token-creator.xiaohongshu.com') ||
    cookieNames.has('customer-sso-sid')
  if (/\/login/i.test(finalUrl)) {
    return { loggedIn: false, reason: '已跳转到登录页' }
  }
  if (hasSessionCookie) {
    return { loggedIn: true, reason: '检测到创作者中心会话 cookie，判定为已登录' }
  }
  return { loggedIn: false, reason: '未检测到创作者中心登录态 cookie' }
}

export async function checkCreatorLogin(page: Page): Promise<{
  loggedIn: boolean
  reason: string
  finalUrl: string
}> {
  const finalUrl = page.url()
  const cookies = await page.cookies('https://creator.xiaohongshu.com')
  const summary = summarizeCreatorLogin({ finalUrl, cookies })
  return {
    loggedIn: summary.loggedIn,
    reason: summary.reason,
    finalUrl
  }
}

export async function openCmsProfileLoginBrowser(input: {
  profileId: string
  url?: string
}): Promise<Browser> {
  const { profile, runtime } = await resolveCmsChromeProfile(input.profileId)
  const browser = await launchChrome(profile.profileDir, {
    executablePath: runtime.executablePath,
    userDataDir: runtime.userDataDir,
    interactive: true,
    activeLockMessage: '对应 CMS Chrome Profile 已在运行，请先关闭已有窗口后再试。'
  })
  const page = await browser.newPage()
  await prepareStealthPage(page)
  await page.goto(
    typeof input.url === 'string' && input.url.trim()
      ? input.url.trim()
      : 'https://creator.xiaohongshu.com/',
    { waitUntil: 'domcontentloaded', timeout: 60_000 }
  )
  return browser
}

export async function verifyCmsProfileLogin(input: {
  accountId: string
  profileId: string
}): Promise<CmsChromeLoginVerificationResult> {
  const { profile, runtime } = await resolveCmsChromeProfile(input.profileId)
  const browser = await launchChrome(profile.profileDir, {
    executablePath: runtime.executablePath,
    userDataDir: runtime.userDataDir,
    activeLockMessage: 'CMS 专用 Chrome 正在运行，请先关闭对应窗口后再验证登录态。'
  })
  try {
    const page = await browser.newPage()
    await prepareStealthPage(page)
    await moveWindowOffscreenOrMinimize(page)
    await page.goto('https://creator.xiaohongshu.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    })
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const login = await checkCreatorLogin(page)
    const checkedAt = new Date().toISOString()

    const config = await readCmsAccountsConfig(runtime.userDataDir)
    if (config) {
      const nextConfig: CmsChromeAccountsConfig = {
        ...config,
        profiles: config.profiles.map((item) =>
          item.id === profile.id
            ? {
                ...item,
                xhsLoggedIn: login.loggedIn,
                lastLoginCheck: checkedAt
              }
            : item
        )
      }
      await writeCmsAccountsConfig(nextConfig, runtime.userDataDir)
    }

    return {
      accountId: input.accountId,
      profileId: profile.id,
      profileDir: profile.profileDir,
      loggedIn: login.loggedIn,
      reason: login.reason,
      finalUrl: login.finalUrl,
      checkedAt
    }
  } finally {
    await closeChrome(browser)
  }
}
