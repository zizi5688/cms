import { existsSync } from 'fs'
import net from 'node:net'
import { join } from 'path'

import type { LocalGatewayConfig, LocalGatewayState } from '../../shared/localGatewayTypes.ts'
import {
  createLocalGatewayState,
  collectLocalGatewayServiceStatuses,
  type LocalGatewayHealthDependency
} from './localGatewayHealth.ts'
import { readLocalGatewayConfigFromStore } from './localGatewayConfig.ts'
import { LocalGatewayProcessManager } from './localGatewayProcessManager.ts'

type LocalGatewayStore = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type CreateLocalGatewayManagerOptions = {
  store: LocalGatewayStore
  logsDir: string
  healthDeps?: Partial<LocalGatewayHealthDependency>
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
  if (!bundlePath) return '本地网关目录未设置。'
  if (!existsSync(bundlePath)) return `本地网关目录不存在：${bundlePath}`

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
  private readonly processManager: LocalGatewayProcessManager
  private readonly fetchImpl: typeof fetch
  private readonly isPortListening: (port: number) => Promise<boolean>
  private state: LocalGatewayState
  private starting = false
  private lastStartedAt: number | null = null
  private lastError: string | null = null

  constructor(options: CreateLocalGatewayManagerOptions) {
    this.store = options.store
    this.fetchImpl = options.healthDeps?.fetch ?? fetch
    this.isPortListening = options.healthDeps?.isPortListening ?? defaultPortListeningCheck
    this.processManager = new LocalGatewayProcessManager({
      logsDir: options.logsDir,
      fetchImpl: this.fetchImpl
    })
    const config = readLocalGatewayConfigFromStore(this.store)
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
      this.lastError = getBundleConfigurationError(config) ?? '本地网关目录或依赖不完整，请先完成初始化。'
      return this.refreshState()
    }

    this.starting = true
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
}
