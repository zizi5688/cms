const GRSAI_DEFAULT_BASE_URL = 'https://grsaiapi.com'
const DEFAULT_IMAGE_MODEL = 'nano-banana-fast'
const LEGACY_DEFAULT_IMAGE_MODEL = 'image-default'

type AiStudioProviderModelProfile = {
  id: string
  modelName: string
  endpointPath: string
}

type AiStudioProviderProfile = {
  id: string
  providerName: string
  baseUrl: string
  apiKey: string
  models: AiStudioProviderModelProfile[]
  defaultModelId: string | null
}

type AiStudioProviderConfigInput = {
  provider?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  defaultImageModel?: unknown
  endpointPath?: unknown
  providerProfiles?: unknown
}

type AiStudioTaskProviderInput = {
  provider?: unknown
  model?: unknown
  metadata?: unknown
}

export type ResolvedAiStudioProviderConfig = {
  provider: string
  baseUrl: string
  apiKey: string
  defaultImageModel: string
  endpointPath: string
  providerProfiles?: unknown
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeConfiguredModel(value: unknown): string {
  const normalized = normalizeText(value)
  return normalized === LEGACY_DEFAULT_IMAGE_MODEL ? '' : normalized
}

function resolveConfiguredModel(value: unknown, fallback = DEFAULT_IMAGE_MODEL): string {
  return normalizeConfiguredModel(value) || fallback
}

function sanitizeBaseUrl(baseUrl: string): string {
  const normalized = normalizeText(baseUrl).replace(/\/+$/, '')
  return normalized || GRSAI_DEFAULT_BASE_URL
}

function normalizeProviderProfiles(value: unknown): AiStudioProviderProfile[] {
  if (!Array.isArray(value)) return []

  const profiles: AiStudioProviderProfile[] = []
  value.forEach((item, index) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const providerName = normalizeText(record.providerName ?? record.name)
    if (!providerName) return

    const models: AiStudioProviderModelProfile[] = []
    if (Array.isArray(record.models)) {
      record.models.forEach((modelItem, modelIndex) => {
        const modelRecord =
          modelItem && typeof modelItem === 'object' ? (modelItem as Record<string, unknown>) : {}
        const modelName = normalizeText(modelRecord.modelName ?? modelRecord.name)
        if (!modelName) return
        models.push({
          id: normalizeText(modelRecord.id) || `${providerName}:${modelIndex}`,
          modelName,
          endpointPath: normalizeText(modelRecord.endpointPath)
        })
      })
    }

    const requestedDefaultModelId = normalizeNullableText(record.defaultModelId)
    profiles.push({
      id: normalizeText(record.id) || `${providerName}:${index}`,
      providerName,
      baseUrl: normalizeText(record.baseUrl),
      apiKey: normalizeText(record.apiKey),
      models,
      defaultModelId:
        requestedDefaultModelId && models.some((model) => model.id === requestedDefaultModelId)
          ? requestedDefaultModelId
          : (models[0]?.id ?? null)
    })
  })

  return profiles
}

function findProviderProfile(
  profiles: AiStudioProviderProfile[],
  providerName: string
): AiStudioProviderProfile | null {
  const normalized = normalizeText(providerName).toLowerCase()
  if (!normalized) return null
  return profiles.find((profile) => profile.providerName.toLowerCase() === normalized) ?? null
}

function findProviderModelProfile(
  providerProfile: AiStudioProviderProfile | null,
  modelName: string
): AiStudioProviderModelProfile | null {
  if (!providerProfile) return null
  const normalized = normalizeText(modelName).toLowerCase()
  if (!normalized) return null
  return (
    providerProfile.models.find((model) => model.modelName.toLowerCase() === normalized) ?? null
  )
}

function resolveProviderModelProfile(
  providerProfile: AiStudioProviderProfile | null,
  preferredModelName: string
): AiStudioProviderModelProfile | null {
  const preferred = findProviderModelProfile(providerProfile, preferredModelName)
  if (preferred) return preferred
  if (providerProfile?.defaultModelId) {
    return (
      providerProfile.models.find((model) => model.id === providerProfile.defaultModelId) ?? null
    )
  }
  return providerProfile?.models[0] ?? null
}

export function resolveAiStudioProviderConfig(
  provided: AiStudioProviderConfigInput = {},
  task?: AiStudioTaskProviderInput | null
): ResolvedAiStudioProviderConfig {
  const fallback: ResolvedAiStudioProviderConfig = {
    provider: normalizeText(provided.provider) || 'grsai',
    baseUrl: sanitizeBaseUrl(normalizeText(provided.baseUrl)),
    apiKey: normalizeText(provided.apiKey),
    defaultImageModel: resolveConfiguredModel(provided.defaultImageModel, DEFAULT_IMAGE_MODEL),
    endpointPath: normalizeText(provided.endpointPath),
    providerProfiles: provided.providerProfiles
  }

  const providerProfiles = normalizeProviderProfiles(provided.providerProfiles)
  const taskProviderName = normalizeText(task?.provider)
  const taskModelName = normalizeConfiguredModel(task?.model)
  const taskProviderProfile = findProviderProfile(providerProfiles, taskProviderName)
  const activeProvider =
    taskProviderProfile ?? findProviderProfile(providerProfiles, fallback.provider)

  if (taskProviderName && !taskProviderProfile) {
    return {
      ...fallback,
      provider: taskProviderName,
      defaultImageModel: resolveConfiguredModel(taskModelName, fallback.defaultImageModel)
    }
  }

  if (!activeProvider) {
    return {
      ...fallback,
      provider: taskProviderName || fallback.provider,
      defaultImageModel: resolveConfiguredModel(taskModelName, fallback.defaultImageModel)
    }
  }

  const modelProfile = resolveProviderModelProfile(
    activeProvider,
    taskModelName || fallback.defaultImageModel
  )

  return {
    provider: activeProvider.providerName,
    baseUrl: sanitizeBaseUrl(activeProvider.baseUrl || fallback.baseUrl),
    apiKey: normalizeText(activeProvider.apiKey) || fallback.apiKey,
    defaultImageModel: resolveConfiguredModel(
      modelProfile?.modelName ?? taskModelName,
      fallback.defaultImageModel
    ),
    endpointPath: normalizeText(modelProfile?.endpointPath) || fallback.endpointPath,
    providerProfiles: provided.providerProfiles
  }
}
