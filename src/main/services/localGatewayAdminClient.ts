import type {
  LocalGatewayAccountStatus,
  LocalGatewayAccountSummary,
  LocalGatewaySystemChromeProfile
} from '../../shared/localGatewayTypes.ts'

const LOCAL_GATEWAY_ADMIN_BASE_URL = 'http://127.0.0.1:4174'

type GatewayAccountResponse = {
  id: string
  accountLabel: string
  status: LocalGatewayAccountStatus
  chromeProfileDirectory: string | null
  lastFailedAt: number | null
  consecutiveFailures: number
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function mapGatewayAccount(payload: Partial<GatewayAccountResponse>): LocalGatewayAccountSummary {
  return {
    id: String(payload.id ?? ''),
    accountLabel: String(payload.accountLabel ?? ''),
    status:
      payload.status === 'cooldown' || payload.status === 'disabled' ? payload.status : 'active',
    chromeProfileDirectory: normalizeNullableString(payload.chromeProfileDirectory),
    lastFailedAt: Number.isFinite(Number(payload.lastFailedAt)) ? Number(payload.lastFailedAt) : null,
    consecutiveFailures: Math.max(0, Math.floor(Number(payload.consecutiveFailures) || 0))
  }
}

async function requestGatewayJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetchImpl(`${LOCAL_GATEWAY_ADMIN_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : `Request failed: ${response.status}`)
  }

  return payload as T
}

export async function listLocalGatewayAccounts(
  fetchImpl: typeof fetch
): Promise<LocalGatewayAccountSummary[]> {
  const payload = await requestGatewayJson<{ accounts: GatewayAccountResponse[] }>(
    fetchImpl,
    '/admin/accounts'
  )
  return Array.isArray(payload.accounts) ? payload.accounts.map(mapGatewayAccount) : []
}

export async function syncLocalGatewayAccounts(
  fetchImpl: typeof fetch,
  profiles: LocalGatewaySystemChromeProfile[]
): Promise<LocalGatewayAccountSummary[]> {
  const payload = await requestGatewayJson<{ accounts: GatewayAccountResponse[] }>(fetchImpl, '/admin/accounts/sync', {
    method: 'POST',
    body: JSON.stringify({
      profiles: profiles.map((profile) => ({
        profileDirectory: profile.profileDirectory,
        label: profile.displayName,
        email: profile.email
      }))
    })
  })

  return Array.isArray(payload.accounts) ? payload.accounts.map(mapGatewayAccount) : []
}
