import type { AiModelProfile, AiProviderProfile } from '@renderer/store/useCmsStore'

export function normalizeAiProviderValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeAiEndpointPath(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return ''
  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, '')
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function findAiProviderProfile(
  profiles: AiProviderProfile[],
  providerName: string
): AiProviderProfile | null {
  const normalized = normalizeAiProviderValue(providerName).toLowerCase()
  if (!normalized) return profiles[0] ?? null
  return profiles.find((profile) => profile.providerName.toLowerCase() === normalized) ?? null
}

export function findAiModelProfile(
  providerProfile: AiProviderProfile | null,
  modelName: string
): AiModelProfile | null {
  if (!providerProfile) return null
  const normalized = normalizeAiProviderValue(modelName).toLowerCase()
  if (!normalized) return null
  return providerProfile.models.find((model) => model.modelName.toLowerCase() === normalized) ?? null
}

export function resolveAiProviderModel(
  providerProfile: AiProviderProfile | null,
  preferredModelName: string
): AiModelProfile | null {
  const preferred = findAiModelProfile(providerProfile, preferredModelName)
  if (preferred) return preferred
  if (providerProfile?.defaultModelId) {
    return providerProfile.models.find((model) => model.id === providerProfile.defaultModelId) ?? null
  }
  return providerProfile?.models[0] ?? null
}

export function buildAiConfigPatch(
  profiles: AiProviderProfile[],
  providerName: string,
  preferredModelName = ''
): {
  aiProviderProfiles: AiProviderProfile[]
  aiProvider: string
  aiBaseUrl: string
  aiApiKey: string
  aiDefaultImageModel: string
  aiEndpointPath: string
} {
  const activeProvider = findAiProviderProfile(profiles, providerName)
  const activeModel = resolveAiProviderModel(activeProvider, preferredModelName)
  return {
    aiProviderProfiles: profiles,
    aiProvider: activeProvider?.providerName || normalizeAiProviderValue(providerName) || 'grsai',
    aiBaseUrl: activeProvider?.baseUrl ?? '',
    aiApiKey: activeProvider?.apiKey ?? '',
    aiDefaultImageModel: activeModel?.modelName ?? '',
    aiEndpointPath: activeModel?.endpointPath ?? ''
  }
}

export function resolveAiTaskProviderSelection(
  profiles: AiProviderProfile[],
  options?: {
    taskProviderName?: string | null
    taskModelName?: string | null
    taskEndpointPath?: string | null
    fallbackProviderName?: string | null
    fallbackModelName?: string | null
  }
): {
  providerProfile: AiProviderProfile | null
  providerName: string
  modelProfile: AiModelProfile | null
  modelName: string
  endpointPath: string
  baseUrl: string
  apiKey: string
} {
  const normalizedFallbackProviderName = normalizeAiProviderValue(options?.fallbackProviderName)
  const fallbackProvider =
    (normalizedFallbackProviderName
      ? findAiProviderProfile(profiles, normalizedFallbackProviderName)
      : null) ??
    profiles[0] ??
    null
  const normalizedTaskProviderName = normalizeAiProviderValue(options?.taskProviderName)
  const taskProviderProfile = normalizedTaskProviderName
    ? findAiProviderProfile(profiles, normalizedTaskProviderName)
    : null
  if (normalizedTaskProviderName && !taskProviderProfile) {
    const fallbackModelName = normalizeAiProviderValue(options?.fallbackModelName)
    const modelName =
      normalizeAiProviderValue(options?.taskModelName) || fallbackModelName
    return {
      providerProfile: null,
      providerName: normalizedTaskProviderName,
      modelProfile: null,
      modelName,
      endpointPath: normalizeAiEndpointPath(options?.taskEndpointPath) || '',
      baseUrl: '',
      apiKey: ''
    }
  }
  const providerProfile =
    taskProviderProfile ?? fallbackProvider
  const providerName =
    providerProfile?.providerName ||
    normalizedTaskProviderName ||
    normalizedFallbackProviderName

  const preferredTaskModelName = normalizeAiProviderValue(options?.taskModelName)
  const fallbackModelName = normalizeAiProviderValue(options?.fallbackModelName)
  const modelProfile = resolveAiProviderModel(
    providerProfile,
    preferredTaskModelName || fallbackModelName
  )
  const modelName = preferredTaskModelName || modelProfile?.modelName || fallbackModelName
  const endpointPath =
    normalizeAiEndpointPath(options?.taskEndpointPath) ||
    normalizeAiEndpointPath(modelProfile?.endpointPath) ||
    ''

  return {
    providerProfile,
    providerName,
    modelProfile,
    modelName,
    endpointPath,
    baseUrl: providerProfile?.baseUrl ?? '',
    apiKey: providerProfile?.apiKey ?? ''
  }
}

export function buildVideoEndpointPair(endpointPath: unknown): {
  submitPath: string
  queryPath: string
} {
  const submitPath = normalizeAiEndpointPath(endpointPath) || '/v1/video/create'
  if (/\/volc\/v1\/contents\/generations\/tasks(?:$|\?.*$)/i.test(submitPath)) {
    return {
      submitPath,
      queryPath: `${submitPath.replace(/\/+$/, '')}/{task_id}`
    }
  }
  if (/\/create(?:\?.*)?$/i.test(submitPath)) {
    return {
      submitPath,
      queryPath: submitPath.replace(/\/create(?=\?.*$|$)/i, '/query')
    }
  }
  if (/\/submit(?:\?.*)?$/i.test(submitPath)) {
    return {
      submitPath,
      queryPath: submitPath.replace(/\/submit(?=\?.*$|$)/i, '/query')
    }
  }
  return {
    submitPath,
    queryPath: '/v1/video/query'
  }
}
