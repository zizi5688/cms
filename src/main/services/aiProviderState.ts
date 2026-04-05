import { randomUUID } from 'crypto'

import type {
  AiCapability,
  AiCapabilityProfile,
  AiModelProfile,
  AiProviderProfile,
  AiRuntimeDefaults
} from '../../shared/ai/aiProviderTypes.ts'
import { createEmptyAiRuntimeDefaults, isAiProviderDeleted } from '../../shared/ai/aiProviderTypes.ts'
import { normalizeAiProviderProfiles } from './aiProviderCatalogHelpers.ts'

export type LegacyAiSelection = {
  provider: string
  baseUrl: string
  apiKey: string
  modelName: string
  endpointPath: string
}

export type ResolvedAiProviderState = {
  aiProvider: string
  aiBaseUrl: string
  aiApiKey: string
  aiDefaultImageModel: string
  aiEndpointPath: string
  aiProviderProfiles: AiProviderProfile[]
  aiRuntimeDefaults: AiRuntimeDefaults
}

export type AiProviderStateStore = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

export type AiProviderStatePatch = Partial<{
  aiProvider: string
  aiBaseUrl: string
  aiApiKey: string
  aiDefaultImageModel: string
  aiEndpointPath: string
  aiProviderProfiles: AiProviderProfile[]
  aiRuntimeDefaults: AiRuntimeDefaults
}>

export function normalizeAiProvider(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || 'grsai'
}

export function normalizeConfigText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeAiEndpointPath(value: unknown): string {
  const normalized = normalizeConfigText(value)
  if (!normalized) return ''
  if (/^https?:\/\//i.test(normalized)) {
    return normalized.replace(/\/+$/, '')
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function getAiCapabilityProfile(
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
  return providerProfile.capabilities[capability]
}

export function findAiProviderProfile(
  profiles: AiProviderProfile[],
  providerKey: string
): AiProviderProfile | null {
  const normalized = normalizeConfigText(providerKey).toLowerCase()
  if (!normalized) return null
  return (
    profiles.find(
      (profile) =>
        !isAiProviderDeleted(profile) &&
        (profile.id.toLowerCase() === normalized || profile.providerName.toLowerCase() === normalized)
    ) ?? null
  )
}

export function findAiCapabilityModel(
  providerProfile: AiProviderProfile | null,
  capability: AiCapability,
  modelName: string
): AiModelProfile | null {
  if (!providerProfile) return null
  const normalized = normalizeConfigText(modelName).toLowerCase()
  if (!normalized) return null
  return (
    getAiCapabilityProfile(providerProfile, capability).models.find(
      (model) => model.modelName.toLowerCase() === normalized
    ) ?? null
  )
}

function shouldMaterializeLegacyAiProvider(selection: LegacyAiSelection): boolean {
  const providerName = normalizeAiProvider(selection.provider)
  const baseUrl = normalizeConfigText(selection.baseUrl)
  const apiKey = normalizeConfigText(selection.apiKey)
  const modelName = normalizeConfigText(selection.modelName)
  const endpointPath = normalizeAiEndpointPath(selection.endpointPath)

  if (baseUrl || apiKey || modelName || endpointPath) return true
  return providerName !== 'grsai'
}

function createLegacyProviderProfile(selection: LegacyAiSelection): AiProviderProfile {
  const providerName = normalizeAiProvider(selection.provider)
  const modelName = normalizeConfigText(selection.modelName)
  const endpointPath = normalizeAiEndpointPath(selection.endpointPath)
  const models: AiModelProfile[] = modelName
    ? [
        {
          id: randomUUID(),
          modelName,
          endpointPath,
          protocol: 'openai',
          enabled: true
        }
      ]
    : []
  const defaultModelId = models[0]?.id ?? null
  return {
    id: randomUUID(),
    providerName,
    baseUrl: normalizeConfigText(selection.baseUrl),
    apiKey: normalizeConfigText(selection.apiKey),
    enabled: true,
    deleted: false,
    source: 'custom',
    capabilities: {
      chat: { enabled: false, defaultModelId: null, models: [] },
      image: {
        enabled: models.length > 0,
        defaultModelId,
        models
      },
      video: { enabled: false, defaultModelId: null, models: [] }
    },
    models,
    defaultModelId
  }
}

function normalizeAiRuntimeDefaults(
  value: unknown,
  profiles: AiProviderProfile[],
  fallbackImageProviderId: string | null
): AiRuntimeDefaults {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const next = createEmptyAiRuntimeDefaults()

  next.chatProviderId =
    findAiProviderProfile(profiles, normalizeConfigText(record.chatProviderId))?.id ?? null
  next.imageProviderId =
    findAiProviderProfile(profiles, normalizeConfigText(record.imageProviderId))?.id ??
    fallbackImageProviderId
  next.videoProviderId =
    findAiProviderProfile(profiles, normalizeConfigText(record.videoProviderId))?.id ?? null

  return next
}

function resolveImageMirrorFromState(
  profiles: AiProviderProfile[],
  runtimeDefaults: AiRuntimeDefaults,
  legacy: LegacyAiSelection
): {
  providerProfile: AiProviderProfile | null
  modelProfile: AiModelProfile | null
} {
  const activeImageProvider =
    findAiProviderProfile(profiles, runtimeDefaults.imageProviderId ?? '') ??
    findAiProviderProfile(profiles, legacy.provider) ??
    profiles.find(
      (profile) =>
        !isAiProviderDeleted(profile) && getAiCapabilityProfile(profile, 'image').models.length > 0
    ) ??
    profiles.find((profile) => !isAiProviderDeleted(profile)) ??
    null

  const imageCapability = getAiCapabilityProfile(activeImageProvider, 'image')
  let activeImageModel = findAiCapabilityModel(activeImageProvider, 'image', legacy.modelName)
  if (!activeImageModel && imageCapability.defaultModelId) {
    activeImageModel =
      imageCapability.models.find((model) => model.id === imageCapability.defaultModelId) ?? null
  }
  if (!activeImageModel) {
    activeImageModel = imageCapability.models[0] ?? null
  }

  return {
    providerProfile: activeImageProvider,
    modelProfile: activeImageModel
  }
}

export function resolveAiProviderState(
  rawProfiles: unknown,
  selection: LegacyAiSelection,
  rawRuntimeDefaults?: unknown
): ResolvedAiProviderState {
  const legacy = {
    provider: normalizeAiProvider(selection.provider),
    baseUrl: normalizeConfigText(selection.baseUrl),
    apiKey: normalizeConfigText(selection.apiKey),
    modelName: normalizeConfigText(selection.modelName),
    endpointPath: normalizeAiEndpointPath(selection.endpointPath)
  }

  let aiProviderProfiles = normalizeAiProviderProfiles(rawProfiles)
  if (aiProviderProfiles.length === 0 && shouldMaterializeLegacyAiProvider(legacy)) {
    aiProviderProfiles = [createLegacyProviderProfile(legacy)]
  }

  const fallbackImageProviderId =
    findAiProviderProfile(aiProviderProfiles, legacy.provider)?.id ??
    aiProviderProfiles.find(
      (profile) =>
        !isAiProviderDeleted(profile) && getAiCapabilityProfile(profile, 'image').models.length > 0
    )?.id ??
    null
  const aiRuntimeDefaults = normalizeAiRuntimeDefaults(
    rawRuntimeDefaults,
    aiProviderProfiles,
    fallbackImageProviderId
  )

  const { providerProfile, modelProfile } = resolveImageMirrorFromState(
    aiProviderProfiles,
    aiRuntimeDefaults,
    legacy
  )

  return {
    aiProvider: providerProfile?.providerName ?? legacy.provider,
    aiBaseUrl: providerProfile?.baseUrl ?? legacy.baseUrl,
    aiApiKey: providerProfile?.apiKey ?? legacy.apiKey,
    aiDefaultImageModel: modelProfile?.modelName ?? legacy.modelName,
    aiEndpointPath: modelProfile?.endpointPath ?? legacy.endpointPath,
    aiProviderProfiles,
    aiRuntimeDefaults: {
      ...aiRuntimeDefaults,
      imageProviderId: providerProfile?.id ?? aiRuntimeDefaults.imageProviderId
    }
  }
}

export function resolveUpdatedAiProviderState(
  currentState: ResolvedAiProviderState,
  patch: AiProviderStatePatch | null | undefined
): ResolvedAiProviderState {
  const desiredLegacy = {
    provider:
      typeof patch?.aiProvider === 'string' ? normalizeAiProvider(patch.aiProvider) : currentState.aiProvider,
    baseUrl:
      typeof patch?.aiBaseUrl === 'string' ? normalizeConfigText(patch.aiBaseUrl) : currentState.aiBaseUrl,
    apiKey:
      typeof patch?.aiApiKey === 'string' ? normalizeConfigText(patch.aiApiKey) : currentState.aiApiKey,
    modelName:
      typeof patch?.aiDefaultImageModel === 'string'
        ? normalizeConfigText(patch.aiDefaultImageModel)
        : currentState.aiDefaultImageModel,
    endpointPath:
      typeof patch?.aiEndpointPath === 'string'
        ? normalizeAiEndpointPath(patch.aiEndpointPath)
        : currentState.aiEndpointPath
  }

  let aiProviderProfiles =
    patch?.aiProviderProfiles !== undefined
      ? normalizeAiProviderProfiles(patch.aiProviderProfiles)
      : currentState.aiProviderProfiles.map((profile) => ({ ...profile }))

  let activeProvider = findAiProviderProfile(aiProviderProfiles, desiredLegacy.provider)
  if (!activeProvider && shouldMaterializeLegacyAiProvider(desiredLegacy)) {
    aiProviderProfiles = normalizeAiProviderProfiles([
      ...aiProviderProfiles,
      createLegacyProviderProfile(desiredLegacy)
    ])
    activeProvider = findAiProviderProfile(aiProviderProfiles, desiredLegacy.provider)
  }

  if (activeProvider) {
    const imageCapability = getAiCapabilityProfile(activeProvider, 'image')
    const nextModels = imageCapability.models.map((model) => ({ ...model }))
    let defaultModelId = imageCapability.defaultModelId
    const existingModel = findAiCapabilityModel(activeProvider, 'image', desiredLegacy.modelName)

    if (desiredLegacy.modelName) {
      if (existingModel) {
        const target = nextModels.find((model) => model.id === existingModel.id)
        if (target) {
          target.endpointPath = desiredLegacy.endpointPath || target.endpointPath
          defaultModelId = target.id
        }
      } else {
        const createdModel: AiModelProfile = {
          id: randomUUID(),
          modelName: desiredLegacy.modelName,
          endpointPath: desiredLegacy.endpointPath,
          protocol: 'openai',
          enabled: true
        }
        nextModels.push(createdModel)
        defaultModelId = createdModel.id
      }
    } else if (defaultModelId && !nextModels.some((model) => model.id === defaultModelId)) {
      defaultModelId = nextModels[0]?.id ?? null
    }

    aiProviderProfiles = normalizeAiProviderProfiles(
      aiProviderProfiles.map((profile) =>
        profile.id === activeProvider?.id
          ? {
              ...profile,
              baseUrl: desiredLegacy.baseUrl,
              apiKey: desiredLegacy.apiKey,
              capabilities: {
                ...profile.capabilities,
                image: {
                  ...profile.capabilities.image,
                  enabled: nextModels.length > 0,
                  models: nextModels,
                  defaultModelId
                }
              },
              models: nextModels,
              defaultModelId
            }
          : profile
      )
    )
  }

  const activeImageProviderId =
    findAiProviderProfile(aiProviderProfiles, desiredLegacy.provider)?.id ??
    currentState.aiRuntimeDefaults.imageProviderId ??
    null
  const desiredRuntimeDefaults =
    patch?.aiRuntimeDefaults !== undefined
      ? patch.aiRuntimeDefaults
      : {
          ...currentState.aiRuntimeDefaults,
          imageProviderId: activeImageProviderId
        }

  return resolveAiProviderState(aiProviderProfiles, desiredLegacy, desiredRuntimeDefaults)
}

export function readResolvedAiProviderStateFromStore(
  store: AiProviderStateStore
): ResolvedAiProviderState {
  return resolveAiProviderState(
    store.get('aiProviderProfiles'),
    {
      provider: normalizeAiProvider(store.get('aiProvider')),
      baseUrl: normalizeConfigText(store.get('aiBaseUrl')),
      apiKey: normalizeConfigText(store.get('aiApiKey')),
      modelName: normalizeConfigText(store.get('aiDefaultImageModel')),
      endpointPath: normalizeAiEndpointPath(store.get('aiEndpointPath'))
    },
    store.get('aiRuntimeDefaults')
  )
}

export function syncResolvedAiProviderStateToStore(
  store: AiProviderStateStore,
  state: ResolvedAiProviderState
): void {
  store.set('aiProviderProfiles', state.aiProviderProfiles)
  store.set('aiRuntimeDefaults', state.aiRuntimeDefaults)
  store.set('aiProvider', state.aiProvider)
  store.set('aiBaseUrl', state.aiBaseUrl)
  store.set('aiApiKey', state.aiApiKey)
  store.set('aiDefaultImageModel', state.aiDefaultImageModel)
  store.set('aiEndpointPath', state.aiEndpointPath)
}
