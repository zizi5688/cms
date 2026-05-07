import { spawn } from 'child_process'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import net from 'node:net'
import { join } from 'path'

import {
  ensureCmsGatewayProfileRecord,
  openCmsProfileLoginBrowser,
  resolveCmsChromeProfile
} from '../../cdp/chrome-launcher.ts'
import type { AiCapability } from '../../shared/ai/aiProviderTypes.ts'
import type {
  LocalGatewayCapabilityCheck,
  LocalGatewayCapabilityChecks,
  LocalGatewayAccountSummary,
  LocalGatewayChromeProfile,
  LocalGatewayConfig,
  LocalGatewayInitializationResult,
  LocalGatewayProbeMode,
  LocalGatewaySystemChromeProfile,
  LocalGatewayState
} from '../../shared/localGatewayTypes.ts'
import {
  createLocalGatewayState,
  collectLocalGatewayServiceStatuses,
  isLocalGatewayImageRuntimeReady,
  type LocalGatewayHealthDependency
} from './localGatewayHealth.ts'
import {
  createDefaultLocalGatewayCapabilityChecks,
  probeLocalGatewayChatCapability,
  probeLocalGatewayImageCapability
} from './localGatewayCapabilityChecks.ts'
import {
  listLocalGatewayAccounts as fetchLocalGatewayAccounts,
  syncLocalGatewayAccounts as pushLocalGatewayAccounts
} from './localGatewayAdminClient.ts'
import { listLocalGatewayChromeProfiles } from './localGatewayChromeProfiles.ts'
import { readLocalGatewayConfigFromStore } from './localGatewayConfig.ts'
import { LocalGatewayProcessManager } from './localGatewayProcessManager.ts'
import {
  resolveLocalGatewayChromeDebugPort,
  resolveLocalGatewayDedicatedChromeUserDataDir
} from './localGatewayRuntime.ts'
import {
  getChromeUserDataDir,
  listSystemChromeProfiles as readSystemChromeProfiles
} from './systemChromeProfiles.ts'

type LocalGatewayStore = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type LocalGatewayProcessManagerHandle = Pick<LocalGatewayProcessManager, 'ensureServices' | 'dispose'>

type CdpProxyTarget = {
  targetId?: unknown
  url?: unknown
  type?: unknown
}

type CdpProxyEvalResponse<T> = {
  value?: T
  error?: string
}

type FlowPageHealthPayload = {
  url?: unknown
  hasHook?: unknown
  hasProtection?: unknown
  isLoggedIn?: unknown
}

type FlowHookReinjectPayload = {
  ok?: unknown
  hasHook?: unknown
  error?: unknown
}

type CreateLocalGatewayManagerOptions = {
  store: LocalGatewayStore
  logsDir: string
  healthDeps?: Partial<LocalGatewayHealthDependency>
  processManager?: LocalGatewayProcessManagerHandle
  imageHealthPollIntervalMs?: number
  chromeDeps?: {
    ensureGatewayProfile?: typeof ensureCmsGatewayProfileRecord
    resolveCmsProfile?: typeof resolveCmsChromeProfile
    openCmsProfileLogin?: typeof openCmsProfileLoginBrowser
    openSystemProfileLogin?: (input: {
      profileDirectory: string
      executablePath: string
      url?: string
    }) => Promise<void>
  }
}

const DEFAULT_IMAGE_HEALTH_POLL_INTERVAL_MS = 30_000
const FLOW_PAGE_HEALTH_TIMEOUT_MS = 5_000
const CDP_PROXY_BASE_URL = 'http://127.0.0.1:3456'
const DEFAULT_CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const LOCAL_GATEWAY_CHAT_PROBE_TTL_MS = 2 * 60 * 1000
const LOCAL_GATEWAY_IMAGE_PROBE_TTL_MS = 10 * 60 * 1000
const FLOW_PROJECT_URL_PATTERN = /\/tools\/flow\/project\/[^/?#]+/i
const FLOW_URL_PATTERN = /\/tools\/flow(?:\/|$|[?#])/i
const FLOW_PROTECTION_LAST_ERROR = 'Flow 当前命中风控，请在 Chrome 中手动处理验证后重试。'
const FLOW_LOGIN_EXPIRED_LAST_ERROR = 'Flow 登录已过期，请在当前 Chrome Profile 中重新登录后重试。'

type GatewayChromeTarget =
  | {
      kind: 'system'
      profileId: string
      profileDirectory: string
      executablePath: string
      userDataDir: string
    }
  | {
      kind: 'cms'
      profileId: string
      profileDirectory: string
      executablePath: string
      userDataDir: string
    }

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isFlowProjectUrl(value: unknown): boolean {
  return FLOW_PROJECT_URL_PATTERN.test(normalizeNonEmptyString(value))
}

function isFlowUrl(value: unknown): boolean {
  return FLOW_URL_PATTERN.test(normalizeNonEmptyString(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function resolveCdpProxyTargetId(target: CdpProxyTarget | null | undefined): string {
  return normalizeNonEmptyString(target?.targetId)
}

function pickFlowPageTarget(targets: CdpProxyTarget[]): CdpProxyTarget | null {
  const pages = [...targets].reverse().filter((target) => normalizeNonEmptyString(target.type) === 'page')
  return pages.find((target) => isFlowProjectUrl(target.url)) ?? pages.find((target) => isFlowUrl(target.url)) ?? null
}

function buildFlowPageHealthScript(): string {
  return `(() => ({
    url: window.location.href,
    hasHook: typeof window.__LOCAL_AI_FLOW_ORIGINAL_FETCH === 'function',
    hasProtection: !!document.querySelector('[data-testid="protection-error"], .challenge-container, iframe[src*="captcha"]'),
    isLoggedIn: !document.querySelector('[data-testid="sign-in-button"], a[href*="accounts.google.com/signin"]')
  }))()`
}

function buildFlowHealthHookScript(): string {
  return `(() => {
    const originalFetch =
      typeof window.__LOCAL_AI_FLOW_ORIGINAL_FETCH === 'function'
        ? window.__LOCAL_AI_FLOW_ORIGINAL_FETCH
        : typeof window.fetch === 'function'
          ? window.fetch.bind(window)
          : null;
    if (typeof originalFetch !== 'function') {
      return { ok: false, error: 'Flow fetch hook could not access window.fetch.' };
    }
    window.__LOCAL_AI_FLOW_ORIGINAL_FETCH = originalFetch;
    window.__LOCAL_AI_FLOW_LOGS = Array.isArray(window.__LOCAL_AI_FLOW_LOGS) ? window.__LOCAL_AI_FLOW_LOGS : [];
    window.__LOCAL_AI_FLOW_STATE =
      window.__LOCAL_AI_FLOW_STATE && typeof window.__LOCAL_AI_FLOW_STATE === 'object'
        ? window.__LOCAL_AI_FLOW_STATE
        : { nextRequestId: 1 };
    window.fetch = async (...args) => {
      const input = args[0];
      const init = args[1];
      const request = input instanceof Request ? input : null;
      const url = typeof input === 'string' ? input : request?.url || String(input);
      const method = String(init?.method || request?.method || 'GET').toUpperCase();
      const shouldLog = url.includes('flowMedia:batchGenerateImages');
      const state =
        window.__LOCAL_AI_FLOW_STATE && typeof window.__LOCAL_AI_FLOW_STATE === 'object'
          ? window.__LOCAL_AI_FLOW_STATE
          : { nextRequestId: 1 };
      const requestId = shouldLog ? Number(state.nextRequestId || 1) : null;
      if (shouldLog) {
        state.nextRequestId = Number(state.nextRequestId || 1) + 1;
        window.__LOCAL_AI_FLOW_LOGS.push({ ts: Date.now(), kind: 'fetch-start', requestId, url, method });
      }
      try {
        const response = await originalFetch(...args);
        if (shouldLog) {
          const responseText = await response.clone().text().catch(() => '');
          window.__LOCAL_AI_FLOW_LOGS.push({
            ts: Date.now(),
            kind: 'fetch',
            requestId,
            url,
            method,
            status: response.status,
            responseText
          });
        }
        window.__LOCAL_AI_FLOW_STATE = state;
        return response;
      } catch (error) {
        if (shouldLog) {
          window.__LOCAL_AI_FLOW_LOGS.push({
            ts: Date.now(),
            kind: 'fetch-error',
            requestId,
            url,
            method,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        window.__LOCAL_AI_FLOW_STATE = state;
        throw error;
      }
    };
    window.fetch.__flowHookActive = true;
    window.__LOCAL_AI_FLOW_HEALTH_HOOKED_AT = Date.now();
    return { ok: true, hasHook: typeof window.__LOCAL_AI_FLOW_ORIGINAL_FETCH === 'function' };
  })()`
}

function resolvePrimarySystemChromeProfileDirectory(config: LocalGatewayConfig): string {
  if (!Array.isArray(config.chromeProfileDirectories)) return ''
  return (
    config.chromeProfileDirectories.find(
      (value) => typeof value === 'string' && value.trim().length > 0
    ) ?? ''
  ).trim()
}

function hasGatewayChromeTarget(config: LocalGatewayConfig): boolean {
  return Boolean(
    resolvePrimarySystemChromeProfileDirectory(config) || config.gatewayCmsProfileId.trim()
  )
}

function resolveStoredChromeExecutablePath(store: LocalGatewayStore): string {
  return normalizeNonEmptyString(store.get('chromeExecutablePath')) || DEFAULT_CHROME_EXECUTABLE
}

function openSystemChromeProfileLogin(input: {
  profileDirectory: string
  executablePath: string
  url?: string
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [`--profile-directory=${input.profileDirectory}`]
    const targetUrl = normalizeNonEmptyString(input.url)
    if (targetUrl) {
      args.push(targetUrl)
    }

    const child = spawn(input.executablePath, args, {
      detached: true,
      stdio: 'ignore'
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function createReadinessConfigKey(config: LocalGatewayConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    bundlePath: config.bundlePath.trim(),
    startCdpProxy: config.startCdpProxy,
    primaryChromeProfileDirectory: resolvePrimarySystemChromeProfileDirectory(config),
    gatewayCmsProfileId: config.gatewayCmsProfileId.trim(),
    prewarmImageOnLaunch: config.prewarmImageOnLaunch
  })
}

function resolveStoredPublishMode(store: LocalGatewayStore): 'electron' | 'cdp' {
  return store.get('publishMode') === 'cdp' ? 'cdp' : 'electron'
}

function areGatewayBaseServicesReady(state: LocalGatewayState): boolean {
  const adapter = state.services.find((service) => service.name === 'adapter')
  const gateway = state.services.find((service) => service.name === 'gateway')
  return Boolean(adapter?.ok && gateway?.ok)
}

function defaultPortListeningCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1')
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

function isBundleConfigured(config: LocalGatewayConfig): boolean {
  return getBundleConfigurationError(config) === null
}

function getBundleConfigurationError(config: LocalGatewayConfig): string | null {
  const bundlePath = config.bundlePath.trim()
  if (!bundlePath) return '本地网关安装目录未设置。'
  if (!existsSync(bundlePath)) return `本地网关安装目录不存在：${bundlePath}`

  const gatewayRoot = join(bundlePath, 'local-ai-gateway')
  if (!existsSync(gatewayRoot)) {
    return `未找到网关代码目录：${gatewayRoot}`
  }

  const pythonAdapterRoot = join(gatewayRoot, 'python_adapter')
  if (!existsSync(pythonAdapterRoot)) {
    return `未找到 Python adapter 目录：${pythonAdapterRoot}`
  }

  const pythonRequirements = join(pythonAdapterRoot, 'requirements.txt')
  if (!existsSync(pythonRequirements)) {
    return `未找到 Python adapter 依赖清单：${pythonRequirements}`
  }

  const pythonApp = join(pythonAdapterRoot, 'app.py')
  if (!existsSync(pythonApp)) {
    return `未找到 Python adapter 应用入口：${pythonApp}`
  }

  if (config.startCdpProxy) {
    const cdpProxyScript = join(bundlePath, 'tools', 'cdp-proxy.mjs')
    if (!existsSync(cdpProxyScript)) {
      return `未找到 CDP 代理脚本：${cdpProxyScript}`
    }
  }

  return null
}

export class LocalGatewayManager {
  private readonly store: LocalGatewayStore
  private readonly processManager: LocalGatewayProcessManagerHandle
  private readonly ensureGatewayProfileImpl: typeof ensureCmsGatewayProfileRecord
  private readonly resolveCmsProfileImpl: typeof resolveCmsChromeProfile
  private readonly openCmsProfileLoginImpl: typeof openCmsProfileLoginBrowser
  private readonly openSystemProfileLoginImpl: (input: {
    profileDirectory: string
    executablePath: string
    url?: string
  }) => Promise<void>
  private readonly logsDir: string
  private readonly fetchImpl: typeof fetch
  private readonly isPortListening: (port: number) => Promise<boolean>
  private state: LocalGatewayState
  private starting = false
  private lastStartedAt: number | null = null
  private lastError: string | null = null
  private readonly ensuredCapabilities = new Set<AiCapability>()
  private readinessConfigKey: string | null = null
  private readonly imageHealthPollIntervalMs: number
  private imageHealthPollTimer: ReturnType<typeof setInterval> | null = null
  private imageHealthPollInFlight = false
  private imageCapabilityWanted = false
  private capabilityChecks: LocalGatewayCapabilityChecks = createDefaultLocalGatewayCapabilityChecks()
  private capabilityCheckInFlight: Promise<void> | null = null

  constructor(options: CreateLocalGatewayManagerOptions) {
    this.store = options.store
    this.logsDir = options.logsDir
    this.fetchImpl = options.healthDeps?.fetch ?? fetch
    this.isPortListening = options.healthDeps?.isPortListening ?? defaultPortListeningCheck
    this.ensureGatewayProfileImpl = options.chromeDeps?.ensureGatewayProfile ?? ensureCmsGatewayProfileRecord
    this.resolveCmsProfileImpl = options.chromeDeps?.resolveCmsProfile ?? resolveCmsChromeProfile
    this.openCmsProfileLoginImpl = options.chromeDeps?.openCmsProfileLogin ?? openCmsProfileLoginBrowser
    this.openSystemProfileLoginImpl =
      options.chromeDeps?.openSystemProfileLogin ?? openSystemChromeProfileLogin
    this.processManager =
      options.processManager ??
      new LocalGatewayProcessManager({
        logsDir: options.logsDir,
        fetchImpl: this.fetchImpl
      })
    this.imageHealthPollIntervalMs = options.imageHealthPollIntervalMs ?? DEFAULT_IMAGE_HEALTH_POLL_INTERVAL_MS
    const config = readLocalGatewayConfigFromStore(this.store)
    this.readinessConfigKey = createReadinessConfigKey(config)
    this.state = createLocalGatewayState({
      config,
      services: [],
      capabilityChecks: this.capabilityChecks,
      bundlePath: config.bundlePath,
      isConfigured: isBundleConfigured(config),
      lastStartedAt: null,
      lastError: null
    })
    this.startImageHealthPoll()
  }

  private async resolveGatewayChromeTarget(
    config: LocalGatewayConfig
  ): Promise<GatewayChromeTarget | null> {
    const systemProfileDirectory = resolvePrimarySystemChromeProfileDirectory(config)
    if (systemProfileDirectory) {
      return {
        kind: 'system',
        profileId: systemProfileDirectory,
        profileDirectory: systemProfileDirectory,
        executablePath: resolveStoredChromeExecutablePath(this.store),
        userDataDir: getChromeUserDataDir()
      }
    }

    const legacyProfileId = config.gatewayCmsProfileId.trim()
    if (!legacyProfileId) {
      return null
    }

    const { profile, runtime } = await this.resolveCmsProfileImpl(legacyProfileId)
    return {
      kind: 'cms',
      profileId: profile.id,
      profileDirectory: profile.profileDir,
      executablePath: runtime.executablePath,
      userDataDir: runtime.userDataDir
    }
  }

  getState(): LocalGatewayState {
    return this.state
  }

  async refreshState(): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    const nextReadinessConfigKey = createReadinessConfigKey(config)
    if (this.readinessConfigKey !== nextReadinessConfigKey) {
      this.ensuredCapabilities.clear()
      this.imageCapabilityWanted = false
      this.capabilityChecks = createDefaultLocalGatewayCapabilityChecks()
      this.readinessConfigKey = nextReadinessConfigKey
    }
    const configured = isBundleConfigured(config)
    const configError = configured ? null : getBundleConfigurationError(config)
    const services = configured
      ? await collectLocalGatewayServiceStatuses(config, {
          fetch: this.fetchImpl,
          isPortListening: this.isPortListening
        })
      : []

    this.state = createLocalGatewayState({
      config,
      services,
      capabilityChecks: this.capabilityChecks,
      bundlePath: config.bundlePath,
      isConfigured: configured,
      isStarting: this.starting,
      lastStartedAt: this.lastStartedAt,
      lastError: this.lastError ?? configError
    })
    if (!areGatewayBaseServicesReady(this.state) || this.state.lastError) {
      this.ensuredCapabilities.clear()
      if (!config.enabled) {
        this.imageCapabilityWanted = false
      }
    } else if (!isLocalGatewayImageRuntimeReady({ config, services: this.state.services })) {
      this.ensuredCapabilities.delete('image')
    }
    return this.state
  }

  async getUiState(options?: { probeMode?: LocalGatewayProbeMode }): Promise<LocalGatewayState> {
    const probeMode = options?.probeMode ?? 'none'
    const state = await this.refreshState()
    if (probeMode === 'none') {
      return state
    }
    await this.refreshCapabilityChecks(state, probeMode)
    return this.refreshState()
  }

  async autoStartIfEnabled(): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    if (!config.enabled || !config.autoStartOnAppLaunch) {
      return this.refreshState()
    }
    if (config.startCdpProxy && resolveStoredPublishMode(this.store) !== 'cdp') {
      return this.refreshState()
    }
    if (!hasGatewayChromeTarget(config)) {
      this.lastError = '本地网关已启用自动恢复，但尚未选择可复用的 Chrome Profile。'
      return this.refreshState()
    }
    try {
      await this.initializeGateway({
        smokeImage: config.prewarmImageOnLaunch
      })
    } catch {
      void 0
    }
    return this.getState()
  }

  async retryStart(): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    if (!config.enabled) {
      return this.refreshState()
    }
    if (!hasGatewayChromeTarget(config)) {
      this.lastError = '请先在 Chat 账号中选择一个真实 Chrome Profile。'
      return this.refreshState()
    }
    try {
      await this.initializeGateway({
        smokeImage: false
      })
    } catch {
      void 0
    }
    return this.getState()
  }

  dispose(): void {
    if (this.imageHealthPollTimer) {
      clearInterval(this.imageHealthPollTimer)
      this.imageHealthPollTimer = null
    }
    this.processManager.dispose()
  }

  async listChromeProfiles(): Promise<LocalGatewayChromeProfile[]> {
    return listLocalGatewayChromeProfiles()
  }

  async listSystemChromeProfiles(): Promise<LocalGatewaySystemChromeProfile[]> {
    return readSystemChromeProfiles()
  }

  async listGatewayAccounts(): Promise<LocalGatewayAccountSummary[]> {
    return fetchLocalGatewayAccounts(this.fetchImpl)
  }

  async syncGatewayAccounts(
    profiles: LocalGatewaySystemChromeProfile[]
  ): Promise<LocalGatewayAccountSummary[]> {
    return pushLocalGatewayAccounts(this.fetchImpl, profiles)
  }

  async ensureGatewayProfile(): Promise<LocalGatewayChromeProfile> {
    const { profile } = await this.ensureGatewayProfileImpl()
    const config = readLocalGatewayConfigFromStore(this.store)
    this.store.set('localGateway', {
      ...config,
      allowDedicatedChrome: true,
      gatewayCmsProfileId: profile.id
    })
    await this.refreshState()
    return {
      id: profile.id,
      profileDir: profile.profileDir,
      nickname: profile.nickname || profile.id,
      purpose: profile.purpose === 'shared' ? 'shared' : 'gateway',
      xhsLoggedIn: profile.xhsLoggedIn,
      lastLoginCheck: profile.lastLoginCheck,
      label: `${profile.nickname || profile.id} (${profile.profileDir}) · 网关专用 · ${profile.xhsLoggedIn ? '已登录' : '未登录'}`
    }
  }

  async openGatewayLogin(): Promise<{ success: true; profileId: string }> {
    const config = readLocalGatewayConfigFromStore(this.store)
    const target = await this.resolveGatewayChromeTarget(config)

    if (target?.kind === 'system') {
      await this.openSystemProfileLoginImpl({
        profileDirectory: target.profileDirectory,
        executablePath: target.executablePath,
        url: 'https://labs.google/fx/tools/flow'
      })
      return { success: true, profileId: target.profileId }
    }

    const profileId = target?.profileId || (await this.ensureGatewayProfile()).id
    await this.openCmsProfileLoginImpl({
      profileId,
      url: 'https://labs.google/fx/tools/flow'
    })
    return { success: true, profileId }
  }

  private markCapabilityEnsured(capability: AiCapability): void {
    if (capability === 'image') {
      this.imageCapabilityWanted = true
      this.ensuredCapabilities.add('chat')
      this.ensuredCapabilities.add('image')
      return
    }
    if (capability === 'chat') {
      this.ensuredCapabilities.add('chat')
    }
  }

  private startImageHealthPoll(): void {
    this.imageHealthPollTimer = setInterval(() => {
      void this.healImageCapabilityIfNeeded()
    }, this.imageHealthPollIntervalMs)
    this.imageHealthPollTimer.unref?.()
  }

  private async withFlowPageHealthTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | null = null

    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Flow 页面状态探测超时。'))
          }, FLOW_PAGE_HEALTH_TIMEOUT_MS)
        })
      ])
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  private async fetchCdpProxyJson<T>(
    path: string,
    init: RequestInit | undefined,
    signal: AbortSignal
  ): Promise<T> {
    const response = await this.fetchImpl(`${CDP_PROXY_BASE_URL}${path}`, {
      ...(init ?? {}),
      signal
    })
    const payload = typeof response.json === 'function' ? await response.json().catch(() => null) : null

    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error.trim() : ''
      throw new Error(message || `CDP proxy request failed: HTTP ${response.status}`)
    }

    return payload as T
  }

  private async listFlowCdpTargets(signal: AbortSignal): Promise<CdpProxyTarget[]> {
    const payload = await this.fetchCdpProxyJson<unknown[]>('/targets', undefined, signal)
    if (!Array.isArray(payload)) {
      throw new Error('CDP proxy targets response was not an array.')
    }
    return payload as CdpProxyTarget[]
  }

  private async evalFlowCdpValue<T>(
    targetId: string,
    expression: string,
    signal: AbortSignal
  ): Promise<T> {
    const payload = await this.fetchCdpProxyJson<CdpProxyEvalResponse<T>>(
      `/eval?target=${encodeURIComponent(targetId)}`,
      {
        method: 'POST',
        body: expression
      },
      signal
    )

    if (typeof payload?.error === 'string' && payload.error.trim()) {
      throw new Error(payload.error.trim())
    }

    return payload?.value as T
  }

  private writeHealthRecoveryLog(message: string): void {
    try {
      mkdirSync(this.logsDir, { recursive: true })
      appendFileSync(join(this.logsDir, 'health-recovery.log'), `${new Date().toISOString()} ${message}\n`)
    } catch {
      void 0
    }
  }

  private async probeFlowPageHealth(): Promise<void> {
    await this.withFlowPageHealthTimeout(async (signal) => {
      const targets = await this.listFlowCdpTargets(signal)
      const target = pickFlowPageTarget(targets)
      const targetId = resolveCdpProxyTargetId(target)

      if (!targetId || !isFlowProjectUrl(target?.url)) {
        throw new Error('Flow 项目页未就绪，需要重新初始化本地网关图片运行时。')
      }

      const health = await this.evalFlowCdpValue<FlowPageHealthPayload>(
        targetId,
        buildFlowPageHealthScript(),
        signal
      )

      if (!isFlowProjectUrl(health?.url)) {
        throw new Error('Flow 页面已离开项目路径，需要重新初始化本地网关图片运行时。')
      }

      if (health?.hasProtection === true) {
        this.lastError = FLOW_PROTECTION_LAST_ERROR
        await this.refreshState()
        return
      }

      if (health?.isLoggedIn === false) {
        this.lastError = FLOW_LOGIN_EXPIRED_LAST_ERROR
        await this.refreshState()
        return
      }

      if (health?.hasHook === false) {
        const reinjectResult = await this.evalFlowCdpValue<FlowHookReinjectPayload>(
          targetId,
          buildFlowHealthHookScript(),
          signal
        )
        if (reinjectResult?.ok !== true || reinjectResult?.hasHook !== true) {
          const message = normalizeNonEmptyString(reinjectResult?.error)
          throw new Error(message || 'Flow fetch hook 重注入失败。')
        }
        const message = '[LocalGateway] Flow fetch hook missing during health poll; re-injected via CDP.'
        console.info(message)
        this.writeHealthRecoveryLog(message)
      }

      if (this.lastError === FLOW_PROTECTION_LAST_ERROR || this.lastError === FLOW_LOGIN_EXPIRED_LAST_ERROR) {
        this.lastError = null
        await this.refreshState()
      }
    })
  }

  private shouldRefreshCapabilityCheck(
    check: LocalGatewayCapabilityCheck,
    probeMode: LocalGatewayProbeMode,
    ttlMs: number
  ): boolean {
    if (probeMode === 'force') return true
    if (probeMode !== 'auto') return false
    if (check.status === 'unknown' || check.checkedAt == null) return true
    return Date.now() - check.checkedAt >= ttlMs
  }

  private resolveBaseServiceError(
    state: LocalGatewayState,
    serviceNames: Array<LocalGatewayState['services'][number]['name']>,
    fallback: string
  ): string {
    for (const name of serviceNames) {
      const service = state.services.find((item) => item.name === name)
      if (service?.ok) continue
      const message = typeof service?.message === 'string' ? service.message.trim() : ''
      if (message) return message
    }
    return fallback
  }

  private async refreshCapabilityChecks(
    state: LocalGatewayState,
    probeMode: LocalGatewayProbeMode
  ): Promise<void> {
    const shouldCheckChat = this.shouldRefreshCapabilityCheck(
      this.capabilityChecks.chat,
      probeMode,
      LOCAL_GATEWAY_CHAT_PROBE_TTL_MS
    )
    const shouldCheckImage = this.shouldRefreshCapabilityCheck(
      this.capabilityChecks.image,
      probeMode,
      LOCAL_GATEWAY_IMAGE_PROBE_TTL_MS
    )

    if (!shouldCheckChat && !shouldCheckImage) {
      return
    }

    if (this.capabilityCheckInFlight) {
      await this.capabilityCheckInFlight
      return
    }

    this.capabilityCheckInFlight = (async () => {
      const config = readLocalGatewayConfigFromStore(this.store)
      const nextChecks = { ...this.capabilityChecks }

      if (shouldCheckChat) {
        nextChecks.chat = areGatewayBaseServicesReady(state)
          ? await probeLocalGatewayChatCapability({ fetch: this.fetchImpl })
          : {
              status: 'failing',
              ok: false,
              checkedAt: Date.now(),
              message: this.resolveBaseServiceError(state, ['adapter', 'gateway'], 'Chat 基础服务未就绪。')
            }
      }

      if (shouldCheckImage) {
        nextChecks.image = !config.startCdpProxy
          ? {
              status: 'failing',
              ok: false,
              checkedAt: Date.now(),
              message: '未启用 CDP 代理。'
            }
          : !areGatewayBaseServicesReady(state)
            ? {
                status: 'failing',
                ok: false,
                checkedAt: Date.now(),
                message: this.resolveBaseServiceError(
                  state,
                  ['adapter', 'gateway'],
                  '生图基础服务未就绪。'
                )
              }
            : !isLocalGatewayImageRuntimeReady({ config, services: state.services })
              ? {
                  status: 'failing',
                  ok: false,
                  checkedAt: Date.now(),
                  message: this.resolveBaseServiceError(
                    state,
                    ['cdpProxy', 'chromeDebug'],
                    '生图运行时未就绪。'
                  )
                }
              : await probeLocalGatewayImageCapability({ fetch: this.fetchImpl })
      }

      this.capabilityChecks = nextChecks
    })()

    try {
      await this.capabilityCheckInFlight
    } finally {
      this.capabilityCheckInFlight = null
    }
  }

  private async healImageCapabilityIfNeeded(): Promise<void> {
    if (this.starting || this.imageHealthPollInFlight || !this.imageCapabilityWanted) {
      return
    }

    const config = readLocalGatewayConfigFromStore(this.store)
    if (!config.enabled || !config.startCdpProxy || !hasGatewayChromeTarget(config)) {
      return
    }

    this.imageHealthPollInFlight = true
    try {
      const state = await this.refreshState()
      if (!areGatewayBaseServicesReady(state)) {
        return
      }
      if (isLocalGatewayImageRuntimeReady({ config, services: state.services })) {
        try {
          await this.probeFlowPageHealth()
        } catch {
          await this.initializeGateway({
            smokeImage: false
          })
        }
        return
      }
      await this.initializeGateway({
        smokeImage: config.prewarmImageOnLaunch
      })
    } catch {
      // refreshState/initializeGateway already recorded the latest error state
    } finally {
      this.imageHealthPollInFlight = false
    }
  }

  async ensureReadyForCapability(capability: AiCapability): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    if (!config.enabled || capability === 'video') {
      return this.refreshState()
    }

    let state = await this.refreshState()
    if (state.overallStatus === 'unconfigured') {
      throw new Error(state.lastError ?? '本地网关安装目录或依赖不完整，请先完成初始化。')
    }

    if (!areGatewayBaseServicesReady(state)) {
      state = await this.retryStart()
    }

    if (!areGatewayBaseServicesReady(state)) {
      throw new Error(state.lastError ?? '本地网关基础服务尚未就绪，请稍后重试。')
    }

    if (capability === 'chat') {
      if (this.ensuredCapabilities.has('chat')) {
        return state
      }
      this.markCapabilityEnsured('chat')
      return this.getState()
    }

    if (isLocalGatewayImageRuntimeReady({ config, services: state.services })) {
      this.markCapabilityEnsured('image')
      return this.getState()
    }

    if (this.ensuredCapabilities.has('image')) {
      return state
    }

    if (!hasGatewayChromeTarget(config)) {
      throw new Error('本地网关图片能力首次使用前，请先在 Chat 账号里选择一个真实 Chrome Profile。')
    }

    await this.initializeGateway({
      smokeImage: config.prewarmImageOnLaunch
    })
    return this.getState()
  }

  async initializeGateway(options?: {
    smokeImage?: boolean
  }): Promise<LocalGatewayInitializationResult> {
    const config = readLocalGatewayConfigFromStore(this.store)
    const bundlePath = config.bundlePath.trim()
    const scriptPath = join(bundlePath, 'local-ai-gateway-startup', 'scripts', 'bootstrap_local_ai_gateway.sh')

    if (!config.enabled) {
      throw new Error('请先启用本地网关管理。')
    }
    if (!hasGatewayChromeTarget(config)) {
      throw new Error('请先在 Chat 账号里选择一个真实 Chrome Profile。')
    }
    const configError = getBundleConfigurationError(config)
    if (configError) {
      this.lastError = configError
      await this.refreshState()
      throw new Error(configError)
    }
    const target = await this.resolveGatewayChromeTarget(config)
    if (!target) {
      throw new Error('请先在 Chat 账号里选择一个真实 Chrome Profile。')
    }
    if (!existsSync(scriptPath)) {
      this.lastError = `未找到初始化脚本：${scriptPath}`
      await this.refreshState()
      throw new Error(this.lastError)
    }

    const env = {
      ...process.env,
      CHROME_PROFILE_DIRECTORY: target.profileDirectory,
      CHROME_DEFAULT_USER_DATA_DIR: target.userDataDir,
      CHROME_APP_BIN: target.executablePath,
      CHROME_DEBUG_USER_DATA_DIR: resolveLocalGatewayDedicatedChromeUserDataDir(bundlePath),
      // System Chrome selections should stay on the real profile instead of silently mirroring into
      // the dedicated runtime copy. CMS-managed gateway profiles still allow the dedicated fallback.
      LOCAL_AI_GATEWAY_ALLOW_DEDICATED_CHROME:
        target.kind === 'cms' && config.allowDedicatedChrome ? '1' : '0',
      LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT: String(resolveLocalGatewayChromeDebugPort()),
      CDP_PROXY_CHROME_PORT: String(resolveLocalGatewayChromeDebugPort()),
      CDP_PROXY_CHROME_USER_DATA_DIR: resolveLocalGatewayDedicatedChromeUserDataDir(bundlePath),
      LOCAL_AI_GATEWAY_SMOKE_IMAGE:
        options?.smokeImage || config.prewarmImageOnLaunch ? '1' : '0'
    }

    let output = ''
    let failureMessage: string | null = null

    this.starting = true
    await this.refreshState()
    try {
      output = await new Promise<string>((resolve, reject) => {
        const child = spawn('/bin/zsh', ['-lc', `bash "${scriptPath}"`], {
          cwd: bundlePath,
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        let combined = ''

        child.stdout?.on('data', (chunk) => {
          combined += String(chunk)
        })
        child.stderr?.on('data', (chunk) => {
          combined += String(chunk)
        })
        child.on('error', (error) => {
          reject(error)
        })
        child.on('close', (code) => {
          if (code === 0) {
            resolve(combined.trim())
            return
          }
          reject(new Error(combined.trim() || `初始化脚本退出码：${code ?? 'unknown'}`))
        })
      })

      this.lastStartedAt = Date.now()
      this.lastError = null
      this.markCapabilityEnsured('image')
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error)
      this.lastError = failureMessage
      this.ensuredCapabilities.clear()
    } finally {
      this.starting = false
      await this.refreshState()
    }

    if (failureMessage) {
      throw new Error(failureMessage)
    }

    return {
      success: true,
      profileId: target.profileId,
      profileDirectory: target.profileDirectory,
      output
    }
  }
}
