import {
  AI_CAPABILITIES,
  createEmptyAiCapabilityProfile,
  createEmptyAiProviderCapabilities,
  type AiCapability,
  type AiCapabilityProfile,
  type AiModelProfile,
  type AiModelProtocol,
  type AiProviderProfile,
  type AiProviderSource
} from '../../shared/ai/aiProviderTypes.ts'
import { BUILTIN_AI_PROVIDER_CATALOG } from '../../shared/ai/providerCatalog.ts'

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized || null
}

function sanitizeBaseUrl(baseUrl: unknown): string {
  return normalizeText(baseUrl).replace(/\/+$/, '')
}

function normalizeEndpointPath(value: unknown): string {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, '')
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function toProviderId(providerName: string, fallbackIndex: number): string {
  const normalized = providerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized ? `provider-${normalized}` : `provider-${fallbackIndex + 1}`
}

function toModelId(modelName: string, capability: AiCapability, fallbackIndex: number): string {
  const normalized = modelName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized ? `model-${normalized}` : `model-${capability}-${fallbackIndex + 1}`
}

function normalizeProtocol(value: unknown): AiModelProtocol {
  const normalized = normalizeText(value)
  if (normalized === 'google-genai' || normalized === 'vendor-custom') return normalized
  return 'openai'
}

function normalizeModelProfiles(
  value: unknown,
  capability: AiCapability,
  providerName: string
): AiModelProfile[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const models: AiModelProfile[] = []
  value.forEach((item, index) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const modelName = normalizeText(record.modelName ?? record.name)
    if (!modelName) return
    const id = normalizeText(record.id) || toModelId(modelName, capability, index)
    const dedupeKey = `${providerName}:${capability}:${id}`.toLowerCase()
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    models.push({
      id,
      modelName,
      endpointPath: normalizeEndpointPath(record.endpointPath),
      protocol: normalizeProtocol(record.protocol),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      tags: Array.isArray(record.tags)
        ? record.tags.map((tag) => normalizeText(tag)).filter(Boolean)
        : undefined
    })
  })
  return models
}

function normalizeCapabilityProfile(
  providerRecord: Record<string, unknown>,
  capability: AiCapability,
  providerName: string
): AiCapabilityProfile {
  const rawCapabilities =
    providerRecord.capabilities && typeof providerRecord.capabilities === 'object'
      ? (providerRecord.capabilities as Record<string, unknown>)
      : {}
  const rawCapability =
    rawCapabilities[capability] && typeof rawCapabilities[capability] === 'object'
      ? (rawCapabilities[capability] as Record<string, unknown>)
      : {}
  const legacyImageModels = capability === 'image' ? providerRecord.models : undefined
  const models = normalizeModelProfiles(
    rawCapability.models ?? legacyImageModels,
    capability,
    providerName
  )
  const requestedDefaultModelId = normalizeNullableText(
    rawCapability.defaultModelId ?? (capability === 'image' ? providerRecord.defaultModelId : null)
  )
  return {
    enabled:
      typeof rawCapability.enabled === 'boolean'
        ? rawCapability.enabled
        : capability === 'image'
          ? models.length > 0 || Boolean(providerRecord.models)
          : models.length > 0,
    defaultModelId:
      requestedDefaultModelId && models.some((model) => model.id === requestedDefaultModelId)
        ? requestedDefaultModelId
        : (models[0]?.id ?? null),
    models
  }
}

function normalizeProviderProfile(
  item: unknown,
  index: number,
  sourceFallback: AiProviderSource
): AiProviderProfile | null {
  const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
  const providerName = normalizeText(record.providerName ?? record.name)
  if (!providerName) return null

  const capabilities = createEmptyAiProviderCapabilities()
  AI_CAPABILITIES.forEach((capability) => {
    capabilities[capability] = normalizeCapabilityProfile(record, capability, providerName)
  })

  const imageCapability = capabilities.image

  return {
    id: normalizeText(record.id) || toProviderId(providerName, index),
    providerName,
    baseUrl: sanitizeBaseUrl(record.baseUrl),
    apiKey: normalizeText(record.apiKey),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    deleted: typeof record.deleted === 'boolean' ? record.deleted : false,
    source:
      normalizeText(record.source) === 'builtin' || normalizeText(record.source) === 'custom'
        ? (normalizeText(record.source) as AiProviderSource)
        : sourceFallback,
    capabilities,
    models: imageCapability.models.map((model) => ({ ...model })),
    defaultModelId: imageCapability.defaultModelId
  }
}

export function normalizeAiProviderProfiles(value: unknown): AiProviderProfile[] {
  if (!Array.isArray(value)) return []

  const profiles: AiProviderProfile[] = []
  const seen = new Set<string>()

  value.forEach((item, index) => {
    const normalized = normalizeProviderProfile(item, index, 'custom')
    if (!normalized) return
    const dedupeKey = normalized.id.toLowerCase()
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)
    profiles.push(normalized)
  })

  return profiles
}

export function getBuiltinAiProviderCatalog(): AiProviderProfile[] {
  return BUILTIN_AI_PROVIDER_CATALOG.map((provider) => {
    const normalized = normalizeProviderProfile(provider, 0, 'builtin')
    if (!normalized) return null
    normalized.source = 'builtin'
    normalized.deleted = false
    if (!normalized.capabilities.chat.models.length) {
      normalized.capabilities.chat = createEmptyAiCapabilityProfile(false)
    }
    return normalized
  }).filter((provider): provider is AiProviderProfile => Boolean(provider))
}
