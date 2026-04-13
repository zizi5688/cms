export type AiStudioProviderCapability = 'image' | 'video' | 'chat'

export type AiStudioProviderReadinessConfig = {
  baseUrl: string
}

export type AiStudioEnsureProviderReady =
  | ((
      config: AiStudioProviderReadinessConfig,
      capability: AiStudioProviderCapability
    ) => Promise<void> | void)
  | null
  | undefined

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

export function isLocalGatewayAiStudioBaseUrl(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl)
  return (
    normalized === 'http://127.0.0.1:4174' ||
    normalized === 'http://localhost:4174' ||
    normalized === 'http://0.0.0.0:4174'
  )
}

export async function ensureAiStudioProviderReady(input: {
  config: AiStudioProviderReadinessConfig
  capability: AiStudioProviderCapability
  ensureReady?: AiStudioEnsureProviderReady
}): Promise<void> {
  if (!input.ensureReady || !isLocalGatewayAiStudioBaseUrl(input.config.baseUrl)) {
    return
  }
  await input.ensureReady(input.config, input.capability)
}
