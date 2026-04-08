import type {
  LocalGatewayConfig,
  LocalGatewayOverallStatus,
  LocalGatewayServiceStatus,
  LocalGatewayState
} from '../../shared/localGatewayTypes.ts'

export type LocalGatewayHealthDependency = {
  fetch: typeof fetch
  isPortListening: (port: number) => Promise<boolean>
}

const DEFAULT_ERROR_MESSAGE = '服务未就绪。'

async function getHttpStatus(
  url: string,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; message: string | null }> {
  try {
    const response = await fetchImpl(url)
    if (response.ok) return { ok: true, message: null }
    return { ok: false, message: `HTTP ${response.status}` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : DEFAULT_ERROR_MESSAGE
    }
  }
}

export async function collectLocalGatewayServiceStatuses(
  config: LocalGatewayConfig,
  deps: LocalGatewayHealthDependency
): Promise<LocalGatewayServiceStatus[]> {
  const adapter = await getHttpStatus('http://127.0.0.1:8766/health', deps.fetch)
  const gateway = await getHttpStatus('http://127.0.0.1:4174/health', deps.fetch)
  const adminUi = config.startAdminUi
    ? await getHttpStatus('http://127.0.0.1:4175', deps.fetch)
    : { ok: false, message: '未启用管理后台。' }
  const cdpProxy = config.startCdpProxy
    ? await getHttpStatus('http://127.0.0.1:3456/health', deps.fetch)
    : { ok: false, message: '未启用 CDP 代理。' }
  const chromeDebugListening = await deps.isPortListening(9222)

  return [
    { name: 'adapter', ok: adapter.ok, port: 8766, message: adapter.message },
    { name: 'gateway', ok: gateway.ok, port: 4174, message: gateway.message },
    {
      name: 'adminUi',
      ok: config.startAdminUi ? adminUi.ok : false,
      port: 4175,
      message: config.startAdminUi ? adminUi.message : '未启用管理后台。'
    },
    {
      name: 'cdpProxy',
      ok: config.startCdpProxy ? cdpProxy.ok : false,
      port: 3456,
      message: config.startCdpProxy ? cdpProxy.message : '未启用 CDP 代理。'
    },
    {
      name: 'chromeDebug',
      ok: chromeDebugListening,
      port: 9222,
      message: chromeDebugListening ? null : 'Chrome 未开启远程调试端口。'
    }
  ]
}

export function resolveLocalGatewayOverallStatus(input: {
  config: LocalGatewayConfig
  services: LocalGatewayServiceStatus[]
  isStarting?: boolean
  isConfigured?: boolean
  lastError?: string | null
}): LocalGatewayOverallStatus {
  if (!input.config.enabled) return 'disabled'
  if (!input.isConfigured) return 'unconfigured'
  if (input.isStarting) return 'starting'

  const adapter = input.services.find((service) => service.name === 'adapter')
  const gateway = input.services.find((service) => service.name === 'gateway')
  const adminUi = input.services.find((service) => service.name === 'adminUi')
  const cdpProxy = input.services.find((service) => service.name === 'cdpProxy')

  if (!adapter?.ok || !gateway?.ok) return 'failed'

  const optionalFailures = [
    input.config.startAdminUi ? !adminUi?.ok : false,
    input.config.startCdpProxy ? !cdpProxy?.ok : false
  ]
  if (optionalFailures.some(Boolean) || input.lastError) return 'degraded'

  return 'services_ready'
}

export function createLocalGatewayState(input: {
  config: LocalGatewayConfig
  services: LocalGatewayServiceStatus[]
  bundlePath: string
  isConfigured: boolean
  isStarting?: boolean
  lastStartedAt?: number | null
  lastError?: string | null
}): LocalGatewayState {
  return {
    overallStatus: resolveLocalGatewayOverallStatus({
      config: input.config,
      services: input.services,
      isConfigured: input.isConfigured,
      isStarting: input.isStarting,
      lastError: input.lastError
    }),
    services: input.services,
    bundlePath: input.bundlePath,
    lastStartedAt: input.lastStartedAt ?? null,
    lastError: input.lastError ?? null
  }
}
