import {
  createEmptyAiProviderCapabilities,
  createEmptyAiRuntimeDefaults,
  isAiProviderDeleted,
  type AiCapability,
  type AiModelProfile,
  type AiProviderProfile,
  type AiRuntimeDefaults
} from '../../../../../shared/ai/aiProviderTypes.ts'

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneModel(model: AiModelProfile): AiModelProfile {
  return {
    ...model,
    tags: model.tags ? [...model.tags] : undefined
  }
}

function cloneCapabilities(provider: Pick<AiProviderProfile, 'capabilities'>) {
  return {
    chat: {
      ...provider.capabilities.chat,
      models: provider.capabilities.chat.models.map(cloneModel)
    },
    image: {
      ...provider.capabilities.image,
      models: provider.capabilities.image.models.map(cloneModel)
    },
    video: {
      ...provider.capabilities.video,
      models: provider.capabilities.video.models.map(cloneModel)
    }
  }
}

function cloneProvider(provider: AiProviderProfile): AiProviderProfile {
  return {
    ...provider,
    models: provider.models.map(cloneModel),
    capabilities: cloneCapabilities(provider)
  }
}

function syncImageMirror(provider: AiProviderProfile): AiProviderProfile {
  const imageModels = provider.capabilities.image.models.map(cloneModel)
  return {
    ...provider,
    models: imageModels,
    defaultModelId: provider.capabilities.image.defaultModelId
  }
}

function mergeProviderCapabilities(
  builtin: AiProviderProfile,
  configured: Partial<AiProviderProfile>
): AiProviderProfile['capabilities'] {
  const base = cloneCapabilities(builtin)
  const configuredCapabilities =
    configured.capabilities && typeof configured.capabilities === 'object'
      ? configured.capabilities
      : createEmptyAiProviderCapabilities()

  return {
    chat: {
      ...base.chat,
      ...configuredCapabilities.chat,
      models: (configuredCapabilities.chat?.models ?? base.chat.models).map(cloneModel)
    },
    image: {
      ...base.image,
      ...configuredCapabilities.image,
      models: (configuredCapabilities.image?.models ?? base.image.models).map(cloneModel)
    },
    video: {
      ...base.video,
      ...configuredCapabilities.video,
      models: (configuredCapabilities.video?.models ?? base.video.models).map(cloneModel)
    }
  }
}

export function createCustomAiProviderProfile(
  overrides: Partial<AiProviderProfile> = {}
): AiProviderProfile {
  const baseCapabilities = createEmptyAiProviderCapabilities()
  const requestedCapabilities =
    overrides.capabilities && typeof overrides.capabilities === 'object'
      ? overrides.capabilities
      : baseCapabilities
  const base: AiProviderProfile = {
    id: overrides.id ?? createUuid(),
    providerName: overrides.providerName ?? '',
    baseUrl: overrides.baseUrl ?? '',
    apiKey: overrides.apiKey ?? '',
    enabled: overrides.enabled ?? true,
    deleted: overrides.deleted ?? false,
    source: overrides.source ?? 'custom',
    capabilities: {
      chat: {
        ...baseCapabilities.chat,
        ...requestedCapabilities.chat,
        models: (requestedCapabilities.chat?.models ?? []).map(cloneModel)
      },
      image: {
        ...baseCapabilities.image,
        ...requestedCapabilities.image,
        models: (requestedCapabilities.image?.models ?? overrides.models ?? []).map(cloneModel)
      },
      video: {
        ...baseCapabilities.video,
        ...requestedCapabilities.video,
        models: (requestedCapabilities.video?.models ?? []).map(cloneModel)
      }
    },
    models: overrides.models ?? [],
    defaultModelId: overrides.defaultModelId ?? null
  }
  return syncImageMirror(base)
}

export function mergeAiProviderProfilesWithCatalog(
  builtinProfiles: AiProviderProfile[],
  configuredProfiles: AiProviderProfile[]
): AiProviderProfile[] {
  const configuredById = new Map(configuredProfiles.map((profile) => [profile.id, profile]))
  const configuredByProviderName = new Map(
    configuredProfiles.map((profile) => [profile.providerName.trim().toLowerCase(), profile])
  )
  const mergedBuiltin = builtinProfiles.flatMap((builtin) => {
    const configured =
      configuredById.get(builtin.id) ??
      configuredByProviderName.get(builtin.providerName.trim().toLowerCase())
    if (isAiProviderDeleted(configured)) return []
    if (!configured) return [cloneProvider(builtin)]
    return [
      syncImageMirror(
        createCustomAiProviderProfile({
          ...cloneProvider(builtin),
          ...cloneProvider(configured),
          deleted: false,
          capabilities: mergeProviderCapabilities(builtin, configured),
          source: builtin.source
        })
      )
    ]
  })

  const builtinIds = new Set(builtinProfiles.map((profile) => profile.id))
  const builtinNames = new Set(
    builtinProfiles.map((profile) => profile.providerName.trim().toLowerCase()).filter(Boolean)
  )
  const customOnly = configuredProfiles
    .filter((profile) => {
      if (isAiProviderDeleted(profile)) return false
      if (builtinIds.has(profile.id)) return false
      return !builtinNames.has(profile.providerName.trim().toLowerCase())
    })
    .map((profile) => syncImageMirror(cloneProvider(profile)))

  return [...mergedBuiltin, ...customOnly]
}

export function preserveDeletedAiProviderTombstones(
  nextProfiles: AiProviderProfile[],
  persistedProfiles: AiProviderProfile[]
): AiProviderProfile[] {
  const nextIds = new Set(nextProfiles.map((profile) => profile.id))
  const deletedProfiles = persistedProfiles
    .filter((profile) => isAiProviderDeleted(profile) && !nextIds.has(profile.id))
    .map((profile) => cloneProvider(profile))
  return [...nextProfiles.map((profile) => cloneProvider(profile)), ...deletedProfiles]
}

export function buildAiModelHealthCacheSignature(
  provider: Pick<AiProviderProfile, 'providerName' | 'baseUrl' | 'enabled'>,
  model: Pick<AiModelProfile, 'modelName' | 'endpointPath' | 'enabled'>
): string {
  return JSON.stringify({
    providerName: provider.providerName.trim(),
    baseUrl: provider.baseUrl.trim(),
    providerEnabled: provider.enabled,
    modelName: model.modelName.trim(),
    endpointPath: model.endpointPath.trim(),
    modelEnabled: model.enabled
  })
}

export function isAiModelHealthCacheFresh(
  checkedAt: number | null | undefined,
  now = Date.now()
): boolean {
  if (!Number.isFinite(checkedAt) || Number(checkedAt) <= 0) return false
  const checkedDate = new Date(Number(checkedAt))
  const nowDate = new Date(now)
  return (
    checkedDate.getFullYear() === nowDate.getFullYear() &&
    checkedDate.getMonth() === nowDate.getMonth() &&
    checkedDate.getDate() === nowDate.getDate()
  )
}

export function setAiRuntimeDefaultProvider(
  currentDefaults: AiRuntimeDefaults | null | undefined,
  capability: AiCapability,
  providerId: string | null
): AiRuntimeDefaults {
  const next = currentDefaults ? { ...currentDefaults } : createEmptyAiRuntimeDefaults()
  if (capability === 'chat') next.chatProviderId = providerId
  if (capability === 'image') next.imageProviderId = providerId
  if (capability === 'video') next.videoProviderId = providerId
  return next
}

export function applyAiCapabilityDefaultSelection(
  profiles: AiProviderProfile[],
  currentDefaults: AiRuntimeDefaults | null | undefined,
  providerId: string,
  capability: AiCapability,
  modelId: string
): {
  profiles: AiProviderProfile[]
  runtimeDefaults: AiRuntimeDefaults
} {
  const nextProfiles = profiles.map((provider) => {
    if (provider.id !== providerId) return cloneProvider(provider)
    const nextProvider = cloneProvider(provider)
    nextProvider.capabilities[capability] = {
      ...nextProvider.capabilities[capability],
      enabled: true,
      defaultModelId: modelId
    }
    return capability === 'image' ? syncImageMirror(nextProvider) : nextProvider
  })

  return {
    profiles: nextProfiles,
    runtimeDefaults: setAiRuntimeDefaultProvider(currentDefaults, capability, providerId)
  }
}

export function upsertAiCapabilityModel(
  profiles: AiProviderProfile[],
  providerId: string,
  capability: AiCapability,
  modelPatch: Partial<AiModelProfile> & { modelName: string; endpointPath: string }
): AiProviderProfile[] {
  return profiles.map((provider) => {
    if (provider.id !== providerId) return provider
    const nextProvider = cloneProvider(provider)
    const capabilityState = nextProvider.capabilities[capability]
    const nextModels = capabilityState.models.map(cloneModel)
    const requestedId = modelPatch.id ?? ''
    const existingIndex = nextModels.findIndex(
      (model) =>
        (requestedId && model.id === requestedId) ||
        model.modelName.toLowerCase() === modelPatch.modelName.trim().toLowerCase()
    )
    const nextModel: AiModelProfile = {
      id: requestedId || createUuid(),
      modelName: modelPatch.modelName.trim(),
      endpointPath: modelPatch.endpointPath.trim(),
      protocol: modelPatch.protocol ?? 'openai',
      enabled: modelPatch.enabled ?? true,
      tags: modelPatch.tags ? [...modelPatch.tags] : undefined
    }

    if (existingIndex >= 0) {
      nextModels[existingIndex] = { ...nextModels[existingIndex], ...nextModel }
    } else {
      nextModels.push(nextModel)
    }

    nextProvider.capabilities[capability] = {
      ...capabilityState,
      enabled: true,
      models: nextModels,
      defaultModelId: capabilityState.defaultModelId ?? nextModels[0]?.id ?? null
    }

    return capability === 'image' ? syncImageMirror(nextProvider) : nextProvider
  })
}

export function removeAiCapabilityModel(
  profiles: AiProviderProfile[],
  providerId: string,
  capability: AiCapability,
  modelId: string
): AiProviderProfile[] {
  return profiles.map((provider) => {
    if (provider.id !== providerId) return provider
    const nextProvider = cloneProvider(provider)
    const capabilityState = nextProvider.capabilities[capability]
    const nextModels = capabilityState.models.filter((model) => model.id !== modelId)
    const nextDefaultModelId =
      capabilityState.defaultModelId && nextModels.some((model) => model.id === capabilityState.defaultModelId)
        ? capabilityState.defaultModelId
        : (nextModels[0]?.id ?? null)

    nextProvider.capabilities[capability] = {
      ...capabilityState,
      enabled: nextModels.length > 0 ? capabilityState.enabled : false,
      models: nextModels,
      defaultModelId: nextDefaultModelId
    }

    return capability === 'image' ? syncImageMirror(nextProvider) : nextProvider
  })
}
