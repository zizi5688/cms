import type { AiCapability, AiModelProtocol } from '../../shared/ai/aiProviderTypes.ts'
import {
  findAiProviderProfile,
  getAiCapabilityProfile,
  type ResolvedAiProviderState
} from './aiProviderState.ts'

export type ResolvedAiRoute = {
  providerId: string
  providerName: string
  capability: AiCapability
  baseUrl: string
  apiKey: string
  modelId: string
  modelName: string
  endpointPath: string
  protocol: AiModelProtocol
}

export class AiRouteResolutionError extends Error {
  code: string
  providerName: string | null
  capability: AiCapability
  modelName: string | null

  constructor(options: {
    code: string
    capability: AiCapability
    providerName?: string | null
    modelName?: string | null
    message: string
  }) {
    super(`${options.code}: ${options.message}`)
    this.name = 'AiRouteResolutionError'
    this.code = options.code
    this.providerName = options.providerName ?? null
    this.capability = options.capability
    this.modelName = options.modelName ?? null
  }
}

function getDefaultProviderId(state: ResolvedAiProviderState, capability: AiCapability): string | null {
  if (capability === 'chat') return state.aiRuntimeDefaults.chatProviderId
  if (capability === 'video') return state.aiRuntimeDefaults.videoProviderId
  return state.aiRuntimeDefaults.imageProviderId
}

function resolveRoute(
  state: ResolvedAiProviderState,
  capability: AiCapability
): ResolvedAiRoute {
  const providerId = getDefaultProviderId(state, capability)
  if (!providerId) {
    throw new AiRouteResolutionError({
      code: 'AI_PROVIDER_DEFAULT_MISSING',
      capability,
      message: 'Missing default provider for capability.'
    })
  }

  const providerProfile = findAiProviderProfile(state.aiProviderProfiles, providerId)
  if (!providerProfile) {
    throw new AiRouteResolutionError({
      code: 'AI_PROVIDER_NOT_FOUND',
      capability,
      message: `Provider ${providerId} not found.`
    })
  }

  if (!providerProfile.enabled) {
    throw new AiRouteResolutionError({
      code: 'AI_PROVIDER_DISABLED',
      capability,
      providerName: providerProfile.providerName,
      message: `Provider ${providerProfile.providerName} is disabled.`
    })
  }

  const capabilityProfile = getAiCapabilityProfile(providerProfile, capability)
  if (!capabilityProfile.enabled) {
    throw new AiRouteResolutionError({
      code: 'AI_CAPABILITY_DISABLED',
      capability,
      providerName: providerProfile.providerName,
      message: `Capability ${capability} is disabled for provider ${providerProfile.providerName}.`
    })
  }

  if (!capabilityProfile.defaultModelId) {
    throw new AiRouteResolutionError({
      code: 'AI_MODEL_MISSING',
      capability,
      providerName: providerProfile.providerName,
      message: `Missing default model for capability ${capability}.`
    })
  }

  const modelProfile =
    capabilityProfile.models.find((model) => model.id === capabilityProfile.defaultModelId) ?? null
  if (!modelProfile) {
    throw new AiRouteResolutionError({
      code: 'AI_MODEL_MISSING',
      capability,
      providerName: providerProfile.providerName,
      message: `Default model ${capabilityProfile.defaultModelId} not found.`
    })
  }

  if (!modelProfile.enabled) {
    throw new AiRouteResolutionError({
      code: 'AI_MODEL_DISABLED',
      capability,
      providerName: providerProfile.providerName,
      modelName: modelProfile.modelName,
      message: `Model ${modelProfile.modelName} is disabled.`
    })
  }

  if (!modelProfile.endpointPath) {
    throw new AiRouteResolutionError({
      code: 'AI_ENDPOINT_MISSING',
      capability,
      providerName: providerProfile.providerName,
      modelName: modelProfile.modelName,
      message: `Model ${modelProfile.modelName} has no endpoint path.`
    })
  }

  return {
    providerId: providerProfile.id,
    providerName: providerProfile.providerName,
    capability,
    baseUrl: providerProfile.baseUrl,
    apiKey: providerProfile.apiKey,
    modelId: modelProfile.id,
    modelName: modelProfile.modelName,
    endpointPath: modelProfile.endpointPath,
    protocol: modelProfile.protocol
  }
}

export function resolveChatRoute(state: ResolvedAiProviderState): ResolvedAiRoute {
  return resolveRoute(state, 'chat')
}

export function resolveImageRoute(state: ResolvedAiProviderState): ResolvedAiRoute {
  return resolveRoute(state, 'image')
}

export function resolveVideoRoute(state: ResolvedAiProviderState): ResolvedAiRoute {
  return resolveRoute(state, 'video')
}
