import type { LocalGatewayConfig } from '../../shared/localGatewayTypes.ts'

export const DEFAULT_LOCAL_GATEWAY_BUNDLE_PATH = '/Users/z/Ai 工具/Local AI Gateway'

export function createDefaultLocalGatewayConfig(): LocalGatewayConfig {
  return {
    enabled: false,
    bundlePath: DEFAULT_LOCAL_GATEWAY_BUNDLE_PATH,
    autoStartOnAppLaunch: true,
    startAdminUi: true,
    startCdpProxy: true,
    allowDedicatedChrome: false,
    chromeProfileDirectory: '',
    prewarmImageOnLaunch: false
  }
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeLocalGatewayConfig(value: unknown): LocalGatewayConfig {
  const fallback = createDefaultLocalGatewayConfig()
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

  return {
    enabled: normalizeBool(record.enabled, fallback.enabled),
    bundlePath:
      typeof record.bundlePath === 'string' && record.bundlePath.trim()
        ? record.bundlePath.trim()
        : fallback.bundlePath,
    autoStartOnAppLaunch: normalizeBool(record.autoStartOnAppLaunch, fallback.autoStartOnAppLaunch),
    startAdminUi: normalizeBool(record.startAdminUi, fallback.startAdminUi),
    startCdpProxy: normalizeBool(record.startCdpProxy, fallback.startCdpProxy),
    allowDedicatedChrome: normalizeBool(record.allowDedicatedChrome, fallback.allowDedicatedChrome),
    chromeProfileDirectory:
      typeof record.chromeProfileDirectory === 'string'
        ? record.chromeProfileDirectory.trim()
        : fallback.chromeProfileDirectory,
    prewarmImageOnLaunch: normalizeBool(record.prewarmImageOnLaunch, fallback.prewarmImageOnLaunch)
  }
}

export function mergeLocalGatewayConfig(
  current: LocalGatewayConfig,
  patch: Partial<LocalGatewayConfig> | null | undefined
): LocalGatewayConfig {
  return normalizeLocalGatewayConfig({
    ...current,
    ...(patch && typeof patch === 'object' ? patch : {})
  })
}

export function readLocalGatewayConfigFromStore(store: {
  get: (key: string) => unknown
  set?: (key: string, value: unknown) => void
}): LocalGatewayConfig {
  const config = normalizeLocalGatewayConfig(store.get('localGateway'))
  store.set?.('localGateway', config)
  return config
}
