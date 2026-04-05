import type { AiCapability } from '../../shared/ai/aiProviderTypes.ts'
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
  context?: Record<string, unknown>
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

function resolveTaskRoute(
  state: ResolvedAiProviderState,
  capability: AiCapability
): ResolvedAiRoute {
  if (capability === 'chat') return resolveChatRoute(state)
  if (capability === 'video') return resolveVideoRoute(state)
  return resolveImageRoute(state)
}

// Future Agent runtime will reuse this entrypoint, but MVP only supports direct mode.
export async function dispatchAiTask(
  state: ResolvedAiProviderState,
  request: AiTaskRequest,
  executors: AiDirectExecutors
): Promise<unknown> {
  const route = resolveTaskRoute(state, request.capability)
  const executor = executors[request.capability]
  return executor({
    mode: 'direct',
    route,
    request
  })
}
