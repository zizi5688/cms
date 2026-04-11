import os from 'node:os'
import { lstatSync, readlinkSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ChromeProfileRow = {
  directoryName: string
  nickname: string
  fullPath: string
}

export type LoginCookie = {
  name: string
  value?: string
}

export type LoginStateSummary = {
  loggedIn: boolean
  reason: string
}

export type SingletonLockStatus = {
  status: 'missing' | 'active' | 'stale'
  target: string | null
  pid: number | null
}

export type PipeModeSupportResult = {
  supported: boolean
  reason: string
}

export type CmsProfileRecord = {
  id: string
  nickname: string
  profileDir: string
  xhsLoggedIn: boolean
  lastLoginCheck: string | null
}

export type CmsAccountsConfig = {
  profiles: CmsProfileRecord[]
  chromeExecutable: string
  cmsDataDir: string
}

const CHROME_USER_DATA_DIR = join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
const SYSTEM_CHROME_EXECUTABLE =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PRODUCTION_CMS_DATA_DIR_NAME = 'chrome-cms-data'
const DEVELOPMENT_CMS_DATA_DIR_NAME = 'chrome-cms-data-dev'

export function getChromeUserDataDir(): string {
  return CHROME_USER_DATA_DIR
}

export function getChromeLocalStatePath(): string {
  return join(CHROME_USER_DATA_DIR, 'Local State')
}

export function getChromeSingletonLockPath(): string {
  return join(CHROME_USER_DATA_DIR, 'SingletonLock')
}

export function getChromeExecutablePath(): string {
  return SYSTEM_CHROME_EXECUTABLE
}

export function getCmsRuntimeEnvironment(): 'development' | 'production' {
  return process.env.NODE_ENV === 'production' ? 'production' : 'development'
}

export function hasFilesystemEntry(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

export function inspectChromeSingletonLock(
  lockPath: string,
  isProcessRunning: (pid: number) => boolean = defaultIsProcessRunning
): SingletonLockStatus {
  if (!hasFilesystemEntry(lockPath)) {
    return {
      status: 'missing',
      target: null,
      pid: null
    }
  }

  let target: string | null = null
  try {
    target = readlinkSync(lockPath)
  } catch {
    return {
      status: 'active',
      target: null,
      pid: null
    }
  }

  const pid = parseSingletonPid(target)
  if (pid === null) {
    return {
      status: 'active',
      target,
      pid: null
    }
  }

  return {
    status: isProcessRunning(pid) ? 'active' : 'stale',
    target,
    pid
  }
}

export function cleanupSingletonArtifacts(userDataDir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const artifactPath = join(userDataDir, name)
    if (!hasFilesystemEntry(artifactPath)) continue
    rmSync(artifactPath, { force: true })
  }
}

export function parseChromeMajorVersion(versionOutput: string): number {
  const match = /(\d+)\./.exec(versionOutput)
  if (!match) {
    throw new Error(`无法解析 Chrome 版本号: ${versionOutput}`)
  }

  return Number.parseInt(match[1], 10)
}

export function assessPipeModeSupport(input: {
  chromeMajorVersion: number
  userDataDir: string
  defaultUserDataDir: string
}): PipeModeSupportResult {
  if (
    input.chromeMajorVersion >= 136 &&
    input.userDataDir === input.defaultUserDataDir
  ) {
    return {
      supported: false,
      reason:
        '当前系统 Chrome 为 136+，官方已禁止对默认 Chrome user-data-dir 使用 --remote-debugging-pipe；因此不能直接接管真实登录 Profile。'
    }
  }

  return {
    supported: true,
    reason: '当前环境允许尝试 pipe 模式启动。'
  }
}

export function parseChromeProfilesFromLocalState(
  rawLocalState: string,
  userDataDir: string
): ChromeProfileRow[] {
  const parsed = JSON.parse(rawLocalState) as {
    profile?: {
      info_cache?: Record<string, { name?: string }>
    }
  }

  const infoCache = parsed.profile?.info_cache ?? {}

  return Object.entries(infoCache)
    .map(([directoryName, profile]) => ({
      directoryName,
      nickname: String(profile?.name ?? '').trim() || '(未命名)',
      fullPath: join(userDataDir, directoryName)
    }))
    .sort((a, b) => a.directoryName.localeCompare(b.directoryName))
}

export function parseProfileArgument(argv: string[]): string {
  const index = argv.indexOf('--profile')
  if (index === -1) {
    throw new Error('缺少 --profile 参数，例如：--profile "Profile 3"')
  }

  const value = argv[index + 1]?.trim()
  if (!value) {
    throw new Error('缺少 --profile 参数值，例如：--profile "Profile 3"')
  }

  return value
}

export function resolveRequestedProfile(
  profiles: ChromeProfileRow[],
  requestedProfile: string
): ChromeProfileRow {
  const matched = profiles.find((profile) => profile.directoryName === requestedProfile)
  if (!matched) {
    throw new Error(`未找到指定 Profile: ${requestedProfile}`)
  }

  return matched
}

export function renderProfileTable(profiles: ChromeProfileRow[]): string {
  const headers = ['Profile 目录名', '昵称', '完整路径']
  const rows = profiles.map((profile) => [
    profile.directoryName,
    profile.nickname,
    profile.fullPath
  ])

  const widths = headers.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...rows.map((row) => Array.from(row[columnIndex] ?? '').length)
    )
  )

  const divider = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`
  const formatRow = (columns: string[]) =>
    `| ${columns
      .map((value, index) => value.padEnd(widths[index], ' '))
      .join(' | ')} |`

  return [formatRow(headers), divider, ...rows.map(formatRow)].join('\n')
}

export function getChromeProfilesOutputPath(): string {
  return join(os.homedir(), 'chrome-profiles.json')
}

export function getCmsChromeDataDir(
  homeDir: string = os.homedir(),
  environment: 'development' | 'production' = getCmsRuntimeEnvironment()
): string {
  return join(homeDir, environment === 'production' ? PRODUCTION_CMS_DATA_DIR_NAME : DEVELOPMENT_CMS_DATA_DIR_NAME)
}

export function getCmsAccountsConfigPath(
  homeDir: string = os.homedir(),
  environment: 'development' | 'production' = getCmsRuntimeEnvironment()
): string {
  return join(getCmsChromeDataDir(homeDir, environment), 'cms-accounts.json')
}

export function getSingletonLockPathForUserDataDir(userDataDir: string): string {
  return join(userDataDir, 'SingletonLock')
}

export function buildCmsAccountsConfig(input: {
  homeDir?: string
  count: number
  existingProfiles: CmsProfileRecord[]
}): CmsAccountsConfig {
  const homeDir = input.homeDir ?? os.homedir()
  const existingById = new Map(input.existingProfiles.map((profile) => [profile.id, profile]))
  const profiles: CmsProfileRecord[] = []

  for (let index = 1; index <= input.count; index += 1) {
    const id = `cms-profile-${index}`
    const existing = existingById.get(id)
    profiles.push(
      existing ?? {
        id,
        nickname: '',
        profileDir: id,
        xhsLoggedIn: false,
        lastLoginCheck: null
      }
    )
  }

  return {
    profiles,
    chromeExecutable: getChromeExecutablePath(),
    cmsDataDir: getCmsChromeDataDir(homeDir)
  }
}

export async function loadCmsAccountsConfig(
  homeDir: string = os.homedir()
): Promise<CmsAccountsConfig | null> {
  const environment = getCmsRuntimeEnvironment()
  const configPath = getCmsAccountsConfigPath(homeDir, environment)

  try {
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as CmsAccountsConfig
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      chromeExecutable:
        typeof parsed.chromeExecutable === 'string' && parsed.chromeExecutable.trim()
          ? parsed.chromeExecutable
          : getChromeExecutablePath(),
      cmsDataDir: getCmsChromeDataDir(homeDir, environment)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function saveCmsAccountsConfig(
  config: CmsAccountsConfig,
  homeDir: string = os.homedir()
): Promise<void> {
  const environment = getCmsRuntimeEnvironment()
  const configPath = getCmsAccountsConfigPath(homeDir, environment)
  await mkdir(getCmsChromeDataDir(homeDir, environment), { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify({ ...config, cmsDataDir: getCmsChromeDataDir(homeDir, environment) }, null, 2)}\n`,
    'utf8'
  )
}

export function findCmsProfileRecord(
  config: CmsAccountsConfig,
  profileId: string
): CmsProfileRecord {
  const matched = config.profiles.find((profile) => profile.id === profileId)
  if (!matched) {
    throw new Error(`未找到指定的 CMS Profile: ${profileId}`)
  }

  return matched
}

export function replaceCmsProfileRecord(
  config: CmsAccountsConfig,
  updatedProfile: CmsProfileRecord
): CmsAccountsConfig {
  return {
    ...config,
    profiles: config.profiles.map((profile) =>
      profile.id === updatedProfile.id ? updatedProfile : profile
    )
  }
}

export function parseCountArgument(argv: string[], defaultCount: number): number {
  const index = argv.indexOf('--count')
  if (index === -1) return defaultCount

  const rawValue = argv[index + 1]?.trim()
  const value = Number.parseInt(rawValue ?? '', 10)
  if (!rawValue || !Number.isInteger(value) || value <= 0) {
    throw new Error('缺少有效的 --count 参数值，例如：--count 10')
  }

  return value
}

export function validateCmsNickname(input: string): string {
  const nickname = input.trim()
  if (!nickname) {
    throw new Error('昵称不能为空，请输入一个易识别的账号名称')
  }

  return nickname
}

export function summarizeLoginState(input: {
  finalUrl: string
  cookies: LoginCookie[]
}): LoginStateSummary {
  const cookieNames = new Set(input.cookies.map((cookie) => cookie.name))
  const hasKnownSessionCookie =
    cookieNames.has('web_session') ||
    cookieNames.has('galaxy_creator_session_id') ||
    cookieNames.has('access-token-creator.xiaohongshu.com') ||
    cookieNames.has('customer-sso-sid')

  if (hasKnownSessionCookie) {
    return {
      loggedIn: true,
      reason: '检测到创作者中心会话 cookie，判定为已登录'
    }
  }

  if (/\/login(?:[/?#]|$)/i.test(input.finalUrl)) {
    return {
      loggedIn: false,
      reason: `页面跳转到了登录页: ${input.finalUrl}`
    }
  }

  if (/creator\.xiaohongshu\.com\/new\/home/i.test(input.finalUrl)) {
    return {
      loggedIn: true,
      reason: `最终页面已进入创作者中心首页: ${input.finalUrl}`
    }
  }

  return {
    loggedIn: false,
    reason: `未检测到 web_session cookie，最终页面为: ${input.finalUrl}`
  }
}

function parseSingletonPid(target: string): number | null {
  const match = /-(\d+)$/.exec(target.trim())
  if (!match) return null

  const pid = Number.parseInt(match[1], 10)
  return Number.isFinite(pid) ? pid : null
}

function defaultIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
