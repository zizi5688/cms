import type { AiCapability, AiModelProtocol } from '../../shared/ai/aiProviderTypes.ts'
import type { ResolvedAiProviderState } from './aiProviderState.ts'
import {
  resolveChatRoute,
  resolveImageRoute,
  resolveVideoRoute,
  type ResolvedAiRoute
} from './aiRouter.ts'

export type AiTaskRequest = {
  capability: AiCapability
  input: unknown
  context?: Record<string, unknown> & {
    routeOverride?: {
      providerId?: string
      providerName?: string
      baseUrl?: string
      apiKey?: string
      modelId?: string
      modelName?: string
      endpointPath?: string
      protocol?: AiModelProtocol
    }
  }
}

export type AiTaskExecutor = (payload: {
  mode: 'direct'
  route: ResolvedAiRoute
  request: AiTaskRequest
}) => Promise<unknown>

export type AiDirectExecutors = {
  chat: AiTaskExecutor
  image: AiTaskExecutor
  video: AiTaskExecutor
}

export type AiTaskDispatchOptions = {
  resolveRoute?: (
    state: ResolvedAiProviderState,
    capability: AiCapability
  ) => Promise<ResolvedAiRoute> | ResolvedAiRoute
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveRouteOverride(
  capability: AiCapability,
  request: AiTaskRequest
): ResolvedAiRoute | null {
  const override = request.context?.routeOverride
  if (!override) return null

  const providerId = normalizeText(override.providerId) || normalizeText(override.providerName)
  const providerName = normalizeText(override.providerName) || providerId
  const modelId = normalizeText(override.modelId) || normalizeText(override.modelName)
  const modelName = normalizeText(override.modelName) || modelId
  const baseUrl = normalizeText(override.baseUrl)
  const apiKey = normalizeText(override.apiKey)
  const endpointPath = normalizeText(override.endpointPath)

  if (!providerId || !providerName || !modelId || !modelName || !baseUrl || !apiKey || !endpointPath) {
    return null
  }

  return {
    providerId,
    providerName,
    capability,
    baseUrl,
    apiKey,
    modelId,
    modelName,
    endpointPath,
    protocol:
      override.protocol === 'google-genai' || override.protocol === 'vendor-custom'
        ? override.protocol
        : 'openai'
  }
}

function resolveTaskRoute(
  state: ResolvedAiProviderState,
  request: AiTaskRequest
): ResolvedAiRoute {
  const routeOverride = resolveRouteOverride(request.capability, request)
  if (routeOverride) return routeOverride
  const capability = request.capability
  if (capability === 'chat') return resolveChatRoute(state)
  if (capability === 'video') return resolveVideoRoute(state)
  return resolveImageRoute(state)
}

// Future Agent runtime will reuse this entrypoint, but MVP only supports direct mode.
export async function dispatchAiTask(
  state: ResolvedAiProviderState,
  request: AiTaskRequest,
  executors: AiDirectExecutors,
  options?: AiTaskDispatchOptions
): Promise<unknown> {
  const route = options?.resolveRoute
    ? await options.resolveRoute(state, request.capability)
    : resolveTaskRoute(state, request)
  const executor = executors[request.capability]
  return executor({
    mode: 'direct',
    route,
    request
  })
}
