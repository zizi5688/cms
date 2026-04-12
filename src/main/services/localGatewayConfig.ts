import type { LocalGatewayConfig } from '../../shared/localGatewayTypes.ts'

export const DEFAULT_LOCAL_GATEWAY_BUNDLE_PATH = '/Users/z/Ai 工具/Local AI Gateway'

export function createDefaultLocalGatewayConfig(): LocalGatewayConfig {
  return {
    enabled: false,
    bundlePath: DEFAULT_LOCAL_GATEWAY_BUNDLE_PATH,
    autoStartOnAppLaunch: true,
    startAdminUi: true,
    startCdpProxy: true,
    allowDedicatedChrome: true,
    chromeProfileDirectories: [],
    gatewayCmsProfileId: '',
    prewarmImageOnLaunch: false
  }
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const values: string[] = []

  for (const item of value) {
    const normalized = typeof item === 'string' ? item.trim() : ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    values.push(normalized)
  }

  return values
}

export function normalizeLocalGatewayConfig(value: unknown): LocalGatewayConfig {
  const fallback = createDefaultLocalGatewayConfig()
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const chromeProfileDirectories = normalizeStringArray(record.chromeProfileDirectories)
  const legacyChromeProfileDirectory =
    typeof record.chromeProfileDirectory === 'string' ? record.chromeProfileDirectory.trim() : ''

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
    chromeProfileDirectories:
      chromeProfileDirectories.length > 0
        ? chromeProfileDirectories
        : legacyChromeProfileDirectory
          ? [legacyChromeProfileDirectory]
          : fallback.chromeProfileDirectories,
    gatewayCmsProfileId:
      typeof record.gatewayCmsProfileId === 'string'
        ? record.gatewayCmsProfileId.trim()
        : fallback.gatewayCmsProfileId,
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
