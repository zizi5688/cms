import type { AiCapability, AiModelProfile, AiProviderProfile } from '../../shared/ai/aiProviderTypes.ts'
import { createEmptyAiRuntimeDefaults } from '../../shared/ai/aiProviderTypes.ts'
import { normalizeAiProviderProfiles } from './aiProviderCatalogHelpers.ts'
import {
  findAiProviderProfile,
  getAiCapabilityProfile,
  type ResolvedAiProviderState
} from './aiProviderState.ts'

const GRSAI_DEFAULT_BASE_URL = 'https://grsaiapi.com'
const DEFAULT_IMAGE_MODEL = 'nano-banana-fast'
const LEGACY_DEFAULT_IMAGE_MODEL = 'image-default'
const AI_STUDIO_IMAGE_ROUTE_MODE_KEY = 'imageRouteMode'
const AI_STUDIO_IMAGE_ROUTE_MODE_TASK_PINNED = 'task-pinned'

type AiStudioProviderConfigInput = Partial<
  Pick<
    ResolvedAiProviderState,
    | 'aiProvider'
    | 'aiBaseUrl'
    | 'aiApiKey'
    | 'aiDefaultImageModel'
    | 'aiEndpointPath'
    | 'aiProviderProfiles'
    | 'aiRuntimeDefaults'
  >
> & {
  provider?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  defaultImageModel?: unknown
  endpointPath?: unknown
  providerProfiles?: unknown
  aiRuntimeDefaults?: unknown
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

function isLoopbackGatewayBaseUrl(baseUrl: string): boolean {
  const normalized = sanitizeBaseUrl(baseUrl).toLowerCase()
  return (
    normalized === 'http://127.0.0.1:4174' ||
    normalized === 'http://localhost:4174' ||
    normalized === 'http://0.0.0.0:4174'
  )
}

function normalizeLocalGatewayEndpointPath(
  capability: AiCapability,
  baseUrl: string,
  modelName: string,
  endpointPath: string
): string {
  if (!isLoopbackGatewayBaseUrl(baseUrl)) return endpointPath

  const normalizedModel = normalizeText(modelName).toLowerCase()
  if (capability === 'image' && normalizedModel === 'flow-web-image') {
    return '/v1beta/models/flow-web-image:generateContent'
  }
  if (capability === 'chat' && normalizedModel === 'gemini-web-chat') {
    return '/v1beta/models/gemini-web-chat:generateContent'
  }

  return endpointPath
}

function shouldTaskPreferRuntimeDefault(
  task: AiStudioTaskProviderInput | null | undefined,
  capability: AiCapability
): boolean {
  if (capability !== 'image') return false
  const metadata =
    task?.metadata && typeof task.metadata === 'object'
      ? (task.metadata as Record<string, unknown>)
      : {}
  return metadata[AI_STUDIO_IMAGE_ROUTE_MODE_KEY] !== AI_STUDIO_IMAGE_ROUTE_MODE_TASK_PINNED
}

function resolveDefaultProviderId(
  rawRuntimeDefaults: unknown,
  capability: AiCapability
): string | null {
  const record =
    rawRuntimeDefaults && typeof rawRuntimeDefaults === 'object'
      ? (rawRuntimeDefaults as Record<string, unknown>)
      : createEmptyAiRuntimeDefaults()
  if (capability === 'chat') return normalizeText(record.chatProviderId) || null
  if (capability === 'video') return normalizeText(record.videoProviderId) || null
  return normalizeText(record.imageProviderId) || null
}

function findProviderModelProfile(
  providerProfile: AiProviderProfile | null,
  capability: AiCapability,
  modelName: string
): AiModelProfile | null {
  if (!providerProfile) return null
  const normalized = normalizeText(modelName).toLowerCase()
  if (!normalized) return null
  return (
    getAiCapabilityProfile(providerProfile, capability).models.find(
      (model) => model.modelName.toLowerCase() === normalized
    ) ?? null
  )
}

function resolveProviderModelProfile(
  providerProfile: AiProviderProfile | null,
  capability: AiCapability,
  preferredModelName: string
): AiModelProfile | null {
  const preferred = findProviderModelProfile(providerProfile, capability, preferredModelName)
  if (preferred) return preferred
  const capabilityProfile = getAiCapabilityProfile(providerProfile, capability)
  if (capabilityProfile.defaultModelId) {
    return (
      capabilityProfile.models.find((model) => model.id === capabilityProfile.defaultModelId) ?? null
    )
  }
  return capabilityProfile.models[0] ?? null
}

function findFirstProviderForCapability(
  profiles: AiProviderProfile[],
  capability: AiCapability
): AiProviderProfile | null {
  return (
    profiles.find((profile) => {
      const capabilityProfile = getAiCapabilityProfile(profile, capability)
      return profile.enabled && capabilityProfile.enabled && capabilityProfile.models.length > 0
    }) ?? null
  )
}

export function resolveAiStudioProviderConfig(
  provided: AiStudioProviderConfigInput = {},
  task?: AiStudioTaskProviderInput | null,
  capability: AiCapability = 'image'
): ResolvedAiStudioProviderConfig {
  const fallback: ResolvedAiStudioProviderConfig = {
    provider: normalizeText(provided.provider ?? provided.aiProvider) || 'grsai',
    baseUrl: sanitizeBaseUrl(normalizeText(provided.baseUrl ?? provided.aiBaseUrl)),
    apiKey: normalizeText(provided.apiKey ?? provided.aiApiKey),
    defaultImageModel: resolveConfiguredModel(
      provided.defaultImageModel ?? provided.aiDefaultImageModel,
      DEFAULT_IMAGE_MODEL
    ),
    endpointPath: normalizeText(provided.endpointPath ?? provided.aiEndpointPath),
    providerProfiles: provided.providerProfiles ?? provided.aiProviderProfiles
  }

  const providerProfiles = normalizeAiProviderProfiles(
    provided.providerProfiles ?? provided.aiProviderProfiles
  )
  const runtimeDefaultProviderId = resolveDefaultProviderId(
    provided.aiRuntimeDefaults,
    capability
  )
  const preferRuntimeDefault = shouldTaskPreferRuntimeDefault(task, capability)
  const taskProviderName = preferRuntimeDefault ? '' : normalizeText(task?.provider)
  const taskModelName = preferRuntimeDefault ? '' : normalizeConfiguredModel(task?.model)
  const taskProviderProfile = taskProviderName
    ? findAiProviderProfile(providerProfiles, taskProviderName)
    : null

  if (taskProviderName && !taskProviderProfile) {
    const baseUrl = sanitizeBaseUrl(fallback.baseUrl)
    const defaultImageModel = resolveConfiguredModel(taskModelName, fallback.defaultImageModel)
    return {
      ...fallback,
      provider: taskProviderName,
      baseUrl,
      defaultImageModel,
      endpointPath: normalizeLocalGatewayEndpointPath(
        capability,
        baseUrl,
        defaultImageModel,
        normalizeText(fallback.endpointPath)
      )
    }
  }

  const activeProvider =
    taskProviderProfile ??
    findAiProviderProfile(providerProfiles, runtimeDefaultProviderId ?? '') ??
    findAiProviderProfile(providerProfiles, fallback.provider) ??
    findFirstProviderForCapability(providerProfiles, capability)

  if (!activeProvider) {
    const baseUrl = sanitizeBaseUrl(fallback.baseUrl)
    const defaultImageModel = resolveConfiguredModel(taskModelName, fallback.defaultImageModel)
    return {
      ...fallback,
      provider: taskProviderName || fallback.provider,
      baseUrl,
      defaultImageModel,
      endpointPath: normalizeLocalGatewayEndpointPath(
        capability,
        baseUrl,
        defaultImageModel,
        normalizeText(fallback.endpointPath)
      )
    }
  }

  const modelProfile = resolveProviderModelProfile(
    activeProvider,
    capability,
    taskModelName || fallback.defaultImageModel
  )

  const baseUrl = sanitizeBaseUrl(activeProvider.baseUrl || fallback.baseUrl)
  const defaultImageModel = resolveConfiguredModel(
    modelProfile?.modelName ?? taskModelName,
    fallback.defaultImageModel
  )

  return {
    provider: activeProvider.providerName,
    baseUrl,
    apiKey: normalizeText(activeProvider.apiKey) || fallback.apiKey,
    defaultImageModel,
    endpointPath: normalizeLocalGatewayEndpointPath(
      capability,
      baseUrl,
      defaultImageModel,
      normalizeText(modelProfile?.endpointPath) || fallback.endpointPath
    ),
    providerProfiles: fallback.providerProfiles
  }
}
