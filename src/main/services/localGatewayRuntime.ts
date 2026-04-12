import { join } from 'path'

export const DEFAULT_LOCAL_GATEWAY_CHROME_DEBUG_PORT = 9333

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = Math.floor(Number(value) || 0)
  return normalized > 0 ? normalized : fallback
}

export function resolveLocalGatewayChromeDebugPort(): number {
  return normalizePositiveInteger(
    process.env.LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT,
    DEFAULT_LOCAL_GATEWAY_CHROME_DEBUG_PORT
  )
}

export function resolveLocalGatewayDedicatedChromeUserDataDir(bundlePath: string): string {
  return join(bundlePath, 'runtime', 'chrome-remote-debug-user-data')
}
