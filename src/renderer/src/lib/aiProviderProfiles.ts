import type {
  AiCapability,
  AiCapabilityProfile,
  AiModelProfile,
  AiProviderProfile,
  AiRuntimeDefaults
} from '../../../shared/ai/aiProviderTypes'
import { isAiProviderDeleted } from '../../../shared/ai/aiProviderTypes.ts'

export type AiCapabilityRouteOption = {
  value: string
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  label: string
}

export type AiProviderRouteCandidate = {
  providerId: string
  providerName: string
  modelId: string
  modelName: string
  endpointPath: string
  baseUrl: string
  apiKey: string
  protocol: AiModelProfile['protocol']
}

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
  const visibleProfiles = profiles.filter((profile) => !isAiProviderDeleted(profile))
  if (!normalized) return visibleProfiles[0] ?? null
  return (
    visibleProfiles.find(
      (profile) =>
        profile.providerName.toLowerCase() === normalized || profile.id.toLowerCase() === normalized
    ) ?? null
  )
}

function findAiProviderProfileById(
  profiles: AiProviderProfile[],
  providerId: string
): AiProviderProfile | null {
  const normalized = normalizeAiProviderValue(providerId).toLowerCase()
  if (!normalized) return null
  return (
    profiles.find(
      (profile) => !isAiProviderDeleted(profile) && profile.id.toLowerCase() === normalized
    ) ?? null
  )
}

function getCapabilityProfile(
  providerProfile: AiProviderProfile | null,
  capability: AiCapability
): AiCapabilityProfile {
  if (!providerProfile) {
    return {
      enabled: false,
      defaultModelId: null,
      models: []
    }
  }
  if (providerProfile.capabilities?.[capability]) {
    return providerProfile.capabilities[capability]
  }
  if (capability === 'image') {
    return {
      enabled: providerProfile.enabled,
      defaultModelId: providerProfile.defaultModelId,
      models: providerProfile.models
    }
  }
  return {
    enabled: false,
    defaultModelId: null,
    models: []
  }
}

function resolveEnabledCapabilityModel(
  providerProfile: AiProviderProfile | null,
  capability: AiCapability
): AiModelProfile | null {
  const capabilityProfile = getCapabilityProfile(providerProfile, capability)
  if (!capabilityProfile.enabled) return null
  const enabledModels = capabilityProfile.models.filter((model) => model.enabled)
  if (enabledModels.length <= 0) return null
  if (capabilityProfile.defaultModelId) {
    const defaultModel =
      enabledModels.find((model) => model.id === capabilityProfile.defaultModelId) ?? null
    if (defaultModel) return defaultModel
  }
  return enabledModels[0] ?? null
}

function buildCapabilityRouteCandidate(
  providerProfile: AiProviderProfile | null,
  capability: AiCapability
): AiProviderRouteCandidate | null {
  if (!providerProfile || isAiProviderDeleted(providerProfile) || !providerProfile.enabled) return null
  const apiKey = normalizeAiProviderValue(providerProfile.apiKey)
  if (!apiKey) return null
  const modelProfile = resolveEnabledCapabilityModel(providerProfile, capability)
  if (!modelProfile) return null
  const endpointPath = normalizeAiEndpointPath(modelProfile.endpointPath)
  if (!endpointPath) return null
  return {
    providerId: providerProfile.id,
    providerName: providerProfile.providerName,
    modelId: modelProfile.id,
    modelName: modelProfile.modelName,
    endpointPath,
    baseUrl: providerProfile.baseUrl,
    apiKey,
    protocol: modelProfile.protocol
  }
}

export function buildAiCapabilityRouteOptions(
  profiles: AiProviderProfile[],
  capability: AiCapability
): AiCapabilityRouteOption[] {
  return profiles
    .filter((profile) => !isAiProviderDeleted(profile) && profile.enabled)
    .flatMap((profile) => {
      const capabilityProfile = getCapabilityProfile(profile, capability)
      if (!capabilityProfile.enabled) return []
      return capabilityProfile.models
        .filter((model) => model.enabled)
        .map((model) => ({
          value: `${profile.id}:${model.id}`,
          providerId: profile.id,
          providerName: profile.providerName,
          modelId: model.id,
          modelName: model.modelName,
          label: `${profile.providerName} - ${model.modelName}`
        }))
    })
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'))
}

export function resolveOrderedChatProviderCandidates(
  profiles: AiProviderProfile[],
  options?: {
    chatProviderId?: string | null
  }
): AiProviderRouteCandidate[] {
  const candidates: AiProviderRouteCandidate[] = []
  const seenProviderIds = new Set<string>()
  const pushCandidate = (candidate: AiProviderRouteCandidate | null): void => {
    if (!candidate || seenProviderIds.has(candidate.providerId)) return
    seenProviderIds.add(candidate.providerId)
    candidates.push(candidate)
  }

  pushCandidate(
    buildCapabilityRouteCandidate(
      findAiProviderProfileById(profiles, normalizeAiProviderValue(options?.chatProviderId)),
      'chat'
    )
  )

  for (const profile of profiles) {
    pushCandidate(buildCapabilityRouteCandidate(profile, 'chat'))
    if (candidates.length >= 2) break
  }

  return candidates.slice(0, 2)
}

export function findAiModelProfile(
  providerProfile: AiProviderProfile | null,
  modelName: string,
  capability: AiCapability = 'image'
): AiModelProfile | null {
  if (!providerProfile) return null
  const normalized = normalizeAiProviderValue(modelName).toLowerCase()
  if (!normalized) return null
  return (
    getCapabilityProfile(providerProfile, capability).models.find(
      (model) => model.modelName.toLowerCase() === normalized
    ) ?? null
  )
}

export function resolveAiProviderModel(
  providerProfile: AiProviderProfile | null,
  preferredModelName: string,
  capability: AiCapability = 'image'
): AiModelProfile | null {
  const capabilityProfile = getCapabilityProfile(providerProfile, capability)
  const preferred = findAiModelProfile(providerProfile, preferredModelName, capability)
  if (preferred) return preferred
  if (capabilityProfile.defaultModelId) {
    return capabilityProfile.models.find((model) => model.id === capabilityProfile.defaultModelId) ?? null
  }
  return capabilityProfile.models[0] ?? null
}

export function buildAiConfigPatch(
  profiles: AiProviderProfile[],
  runtimeDefaultsOrProviderName: AiRuntimeDefaults | string,
  providerNameOrPreferredModel = '',
  maybePreferredModelName = ''
): {
  aiProviderProfiles: AiProviderProfile[]
  aiRuntimeDefaults: AiRuntimeDefaults
  aiProvider: string
  aiBaseUrl: string
  aiApiKey: string
  aiDefaultImageModel: string
  aiEndpointPath: string
} {
  const hasRuntimeDefaults =
    typeof runtimeDefaultsOrProviderName === 'object' && runtimeDefaultsOrProviderName !== null
  const aiRuntimeDefaults = hasRuntimeDefaults
    ? (runtimeDefaultsOrProviderName as AiRuntimeDefaults)
    : {
        chatProviderId: null,
        imageProviderId: null,
        videoProviderId: null
      }
  const providerName = hasRuntimeDefaults
    ? providerNameOrPreferredModel
    : String(runtimeDefaultsOrProviderName ?? '')
  const preferredModelName = hasRuntimeDefaults ? maybePreferredModelName : providerNameOrPreferredModel
  const activeProvider = findAiProviderProfile(profiles, providerName)
  const activeModel = resolveAiProviderModel(activeProvider, preferredModelName, 'image')
  return {
    aiProviderProfiles: profiles,
    aiRuntimeDefaults: {
      ...aiRuntimeDefaults,
      imageProviderId: aiRuntimeDefaults.imageProviderId ?? activeProvider?.id ?? null
    },
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
    capability?: AiCapability
    taskProviderName?: string | null
    taskModelName?: string | null
    fallbackProviderId?: string | null
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
  const capability = options?.capability ?? 'image'
  const normalizedFallbackProviderName = normalizeAiProviderValue(options?.fallbackProviderName)
  const fallbackProvider =
    findAiProviderProfileById(profiles, normalizeAiProviderValue(options?.fallbackProviderId)) ??
    (normalizedFallbackProviderName ? findAiProviderProfile(profiles, normalizedFallbackProviderName) : null) ??
    profiles.find((profile) => !isAiProviderDeleted(profile)) ??
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
    preferredTaskModelName || fallbackModelName,
    capability
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
