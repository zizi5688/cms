import { homedir } from 'node:os'
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

export function resolveLocalGatewayRuntimeDir(_bundlePath?: string): string {
  const override = String(process.env.LOCAL_AI_GATEWAY_RUNTIME_DIR || '').trim()
  if (override) return override

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Local AI Gateway', 'runtime')
  }

  if (process.platform === 'win32') {
    return join(
      process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
      'Local AI Gateway',
      'runtime'
    )
  }

  return join(
    process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
    'local-ai-gateway',
    'runtime'
  )
}

export function resolveLocalGatewayDedicatedChromeUserDataDir(bundlePath: string): string {
  return join(resolveLocalGatewayRuntimeDir(bundlePath), 'chrome-remote-debug-user-data')
}
