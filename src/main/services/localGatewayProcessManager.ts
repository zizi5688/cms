import { spawn, type ChildProcess } from 'child_process'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import process from 'node:process'
import { join } from 'path'

import type { LocalGatewayConfig } from '../../shared/localGatewayTypes.ts'
import {
  resolveLocalGatewayChromeDebugPort,
  resolveLocalGatewayDedicatedChromeUserDataDir
} from './localGatewayRuntime.ts'

type ManagedServiceName = 'adapter' | 'gateway' | 'adminUi' | 'cdpProxy'

type ManagedServiceRecord = {
  name: ManagedServiceName
  pid: number | null
  startedByApp: boolean
  logPath: string
  child: ChildProcess | null
}

type ServiceDefinition = {
  name: ManagedServiceName
  command: string
  cwd: string
  healthUrl: string
}

type CreateLocalGatewayProcessManagerOptions = {
  logsDir: string
  fetchImpl?: typeof fetch
  shellPath?: string
  spawnImpl?: typeof spawn
  waitTimeoutMs?: number
}

type SpawnLike = typeof spawn

async function waitForService(
  healthUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = '服务未就绪。'

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(healthUrl)
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : '服务未就绪。'
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(lastError)
}

function buildServiceDefinitions(config: LocalGatewayConfig): ServiceDefinition[] {
  const bundleRoot = config.bundlePath
  const gatewayRoot = join(bundleRoot, 'local-ai-gateway')
  const pythonRoot = join(gatewayRoot, 'python_adapter')
  const definitions: ServiceDefinition[] = [
    {
      name: 'adapter',
      command: '.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8766',
      cwd: pythonRoot,
      healthUrl: 'http://127.0.0.1:8766/health'
    },
    {
      name: 'gateway',
      command: 'npm run dev:server',
      cwd: gatewayRoot,
      healthUrl: 'http://127.0.0.1:4174/health'
    }
  ]

  if (config.startAdminUi) {
    definitions.push({
      name: 'adminUi',
      command: 'npm run dev:web -- --host 127.0.0.1 --port 4175',
      cwd: gatewayRoot,
      healthUrl: 'http://127.0.0.1:4175'
    })
  }

  if (config.startCdpProxy) {
    definitions.push({
      name: 'cdpProxy',
      command: `node "${join(bundleRoot, 'tools', 'cdp-proxy.mjs')}"`,
      cwd: bundleRoot,
      healthUrl: 'http://127.0.0.1:3456/health'
    })
  }

  return definitions
}

export class LocalGatewayProcessManager {
  private readonly logsDir: string
  private readonly fetchImpl: typeof fetch
  private readonly shellPath: string
  private readonly spawnImpl: SpawnLike
  private readonly waitTimeoutMs: number
  private readonly records = new Map<ManagedServiceName, ManagedServiceRecord>()

  constructor(options: CreateLocalGatewayProcessManagerOptions) {
    this.logsDir = options.logsDir
    this.fetchImpl = options.fetchImpl ?? fetch
    this.shellPath = options.shellPath ?? '/bin/zsh'
    this.spawnImpl = options.spawnImpl ?? spawn
    this.waitTimeoutMs = options.waitTimeoutMs ?? 30_000
  }

  async ensureServices(config: LocalGatewayConfig): Promise<void> {
    mkdirSync(this.logsDir, { recursive: true })

    for (const definition of buildServiceDefinitions(config)) {
      try {
        const healthy = await this.fetchImpl(definition.healthUrl).then((response) => response.ok).catch(() => false)
        if (healthy) continue
      } catch {
        // noop
      }

      if (!existsSync(definition.cwd)) {
        throw new Error(`本地网关目录不存在：${definition.cwd}`)
      }

      const logPath = join(this.logsDir, `${definition.name}.log`)
      const stream = createWriteStream(logPath, { flags: 'a' })
      const dedicatedChromePort = String(resolveLocalGatewayChromeDebugPort())
      const dedicatedChromeUserDataDir = resolveLocalGatewayDedicatedChromeUserDataDir(config.bundlePath)
      const childEnv =
        definition.name === 'gateway'
          ? {
              ...process.env,
              CHROME_PROFILE_DIRECTORY: config.chromeProfileDirectory
            }
          : definition.name === 'cdpProxy'
            ? {
                ...process.env,
                CDP_PROXY_CHROME_PORT: dedicatedChromePort,
                CDP_PROXY_CHROME_USER_DATA_DIR: dedicatedChromeUserDataDir,
                LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT: dedicatedChromePort
              }
          : process.env
      const child = this.spawnImpl(this.shellPath, ['-lc', definition.command], {
        cwd: definition.cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      child.stdout?.pipe(stream)
      child.stderr?.pipe(stream)

      this.records.set(definition.name, {
        name: definition.name,
        pid: child.pid ?? null,
        startedByApp: true,
        logPath,
        child
      })

      try {
        await waitForService(definition.healthUrl, this.fetchImpl, this.waitTimeoutMs)
      } catch (error) {
        throw new Error(
          `[${definition.name}] 启动后健康检查失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  }

  dispose(): void {
    for (const record of this.records.values()) {
      if (!record.startedByApp || !record.child || record.child.killed) continue
      try {
        record.child.kill()
      } catch {
        // noop
      }
    }
    this.records.clear()
  }
}
