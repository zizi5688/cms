export const AI_CAPABILITIES = ['chat', 'image', 'video'] as const

export type AiCapability = (typeof AI_CAPABILITIES)[number]
export type AiModelProtocol = 'openai' | 'google-genai' | 'vendor-custom'
export type AiProviderSource = 'builtin' | 'custom'

export interface AiModelProfile {
  id: string
  modelName: string
  endpointPath: string
  protocol: AiModelProtocol
  enabled: boolean
  tags?: string[]
}

export interface AiCapabilityProfile {
  enabled: boolean
  defaultModelId: string | null
  models: AiModelProfile[]
}

export interface AiProviderProfile {
  id: string
  providerName: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  deleted?: boolean
  source: AiProviderSource
  capabilities: Record<AiCapability, AiCapabilityProfile>
  // Deprecated compatibility mirror for the legacy image-only editor.
  models: AiModelProfile[]
  defaultModelId: string | null
}

export interface AiRuntimeDefaults {
  chatProviderId: string | null
  imageProviderId: string | null
  videoProviderId: string | null
}

export function createEmptyAiCapabilityProfile(enabled = false): AiCapabilityProfile {
  return {
    enabled,
    defaultModelId: null,
    models: []
  }
}

export function createEmptyAiProviderCapabilities(): Record<AiCapability, AiCapabilityProfile> {
  return {
    chat: createEmptyAiCapabilityProfile(false),
    image: createEmptyAiCapabilityProfile(false),
    video: createEmptyAiCapabilityProfile(false)
  }
}

export function createEmptyAiRuntimeDefaults(): AiRuntimeDefaults {
  return {
    chatProviderId: null,
    imageProviderId: null,
    videoProviderId: null
  }
}

export function isAiProviderDeleted(
  provider: Pick<AiProviderProfile, 'deleted'> | null | undefined
): boolean {
  return provider?.deleted === true
}
