import { spawn } from 'child_process'
import { existsSync } from 'fs'
import net from 'node:net'
import { join } from 'path'

import type { AiCapability } from '../../shared/ai/aiProviderTypes.ts'
import type {
  LocalGatewayChromeProfile,
  LocalGatewayConfig,
  LocalGatewayInitializationResult,
  LocalGatewayServiceName,
  LocalGatewayState
} from '../../shared/localGatewayTypes.ts'
import {
  createLocalGatewayState,
  collectLocalGatewayServiceStatuses,
  type LocalGatewayHealthDependency
} from './localGatewayHealth.ts'
import { listLocalGatewayChromeProfiles } from './localGatewayChromeProfiles.ts'
import { readLocalGatewayConfigFromStore } from './localGatewayConfig.ts'
import { LocalGatewayProcessManager } from './localGatewayProcessManager.ts'
import {
  resolveLocalGatewayChromeDebugPort,
  resolveLocalGatewayDedicatedChromeUserDataDir
} from './localGatewayRuntime.ts'

type LocalGatewayStore = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type LocalGatewayProcessManagerHandle = Pick<LocalGatewayProcessManager, 'ensureServices' | 'dispose'>

type CreateLocalGatewayManagerOptions = {
  store: LocalGatewayStore
  logsDir: string
  healthDeps?: Partial<LocalGatewayHealthDependency>
  processManager?: LocalGatewayProcessManagerHandle
}

function createReadinessConfigKey(config: LocalGatewayConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    bundlePath: config.bundlePath.trim(),
    chromeProfileDirectory: config.chromeProfileDirectory.trim(),
    allowDedicatedChrome: config.allowDedicatedChrome,
    prewarmImageOnLaunch: config.prewarmImageOnLaunch
  })
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

  const pythonActivate = join(gatewayRoot, 'python_adapter', '.venv', 'bin', 'activate')
  if (!existsSync(pythonActivate)) {
    return `未找到 Python 虚拟环境：${pythonActivate}`
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
  private readonly fetchImpl: typeof fetch
  private readonly isPortListening: (port: number) => Promise<boolean>
  private state: LocalGatewayState
  private starting = false
  private lastStartedAt: number | null = null
  private lastError: string | null = null
  private readonly ensuredCapabilities = new Set<AiCapability>()
  private readinessConfigKey: string | null = null

  constructor(options: CreateLocalGatewayManagerOptions) {
    this.store = options.store
    this.fetchImpl = options.healthDeps?.fetch ?? fetch
    this.isPortListening = options.healthDeps?.isPortListening ?? defaultPortListeningCheck
    this.processManager =
      options.processManager ??
      new LocalGatewayProcessManager({
        logsDir: options.logsDir,
        fetchImpl: this.fetchImpl
      })
    const config = readLocalGatewayConfigFromStore(this.store)
    this.readinessConfigKey = createReadinessConfigKey(config)
    this.state = createLocalGatewayState({
      config,
      services: [],
      bundlePath: config.bundlePath,
      isConfigured: isBundleConfigured(config),
      lastStartedAt: null,
      lastError: null
    })
  }

  getState(): LocalGatewayState {
    return this.state
  }

  async refreshState(): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    const nextReadinessConfigKey = createReadinessConfigKey(config)
    if (this.readinessConfigKey !== nextReadinessConfigKey) {
      this.ensuredCapabilities.clear()
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
      bundlePath: config.bundlePath,
      isConfigured: configured,
      isStarting: this.starting,
      lastStartedAt: this.lastStartedAt,
      lastError: this.lastError ?? configError
    })
    if (!areGatewayBaseServicesReady(this.state) || this.state.lastError) {
      this.ensuredCapabilities.clear()
    }
    return this.state
  }

  async autoStartIfEnabled(): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    if (!config.enabled || !config.autoStartOnAppLaunch) {
      return this.refreshState()
    }
    return this.retryStart()
  }

  async retryStart(): Promise<LocalGatewayState> {
    const config = readLocalGatewayConfigFromStore(this.store)
    if (!config.enabled) {
      return this.refreshState()
    }
    const configured = isBundleConfigured(config)
    if (!configured) {
      this.lastError = getBundleConfigurationError(config) ?? '本地网关安装目录或依赖不完整，请先完成初始化。'
      return this.refreshState()
    }

    this.starting = true
    this.ensuredCapabilities.clear()
    await this.refreshState()
    try {
      await this.processManager.ensureServices(config)
      this.lastStartedAt = Date.now()
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
    } finally {
      this.starting = false
    }
    return this.refreshState()
  }

  dispose(): void {
    this.processManager.dispose()
  }

  async listChromeProfiles(): Promise<LocalGatewayChromeProfile[]> {
    return listLocalGatewayChromeProfiles()
  }

  private getServiceOk(name: LocalGatewayServiceName): boolean {
    return this.state.services.find((service) => service.name === name)?.ok === true
  }

  private markCapabilityEnsured(capability: AiCapability): void {
    if (capability === 'image') {
      this.ensuredCapabilities.add('chat')
      this.ensuredCapabilities.add('image')
      return
    }
    if (capability === 'chat') {
      this.ensuredCapabilities.add('chat')
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

      const chromeReady = this.getServiceOk('chromeDebug')
      const cdpReady = this.getServiceOk('cdpProxy')
      if (chromeReady && cdpReady) {
        this.markCapabilityEnsured('chat')
        return this.getState()
      }

      if (!config.chromeProfileDirectory.trim()) {
        throw new Error('本地网关聊天能力未就绪：请先在设置中选择 Chrome Profile，并执行一次初始化。')
      }

      await this.initializeGateway({
        smokeImage: false
      })
      return this.getState()
    }

    if (this.ensuredCapabilities.has('image')) {
      return state
    }

    if (!config.chromeProfileDirectory.trim()) {
      throw new Error('本地网关图片能力首次使用前，请先在设置中选择 Chrome Profile，并执行一次初始化。')
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
    const profileDirectory = config.chromeProfileDirectory.trim()
    const bundlePath = config.bundlePath.trim()
    const scriptPath = join(bundlePath, 'local-ai-gateway-startup', 'scripts', 'bootstrap_local_ai_gateway.sh')

    if (!config.enabled) {
      throw new Error('请先启用本地网关管理。')
    }
    if (!profileDirectory) {
      throw new Error('请先选择一个 Chrome Profile。')
    }
    const configError = getBundleConfigurationError(config)
    if (configError) {
      this.lastError = configError
      await this.refreshState()
      throw new Error(configError)
    }
    if (!existsSync(scriptPath)) {
      this.lastError = `未找到初始化脚本：${scriptPath}`
      await this.refreshState()
      throw new Error(this.lastError)
    }

    const env = {
      ...process.env,
      CHROME_PROFILE_DIRECTORY: profileDirectory,
      LOCAL_AI_GATEWAY_ALLOW_DEDICATED_CHROME: config.allowDedicatedChrome ? '1' : '0',
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
      profileDirectory,
      output
    }
  }
}
