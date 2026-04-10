import type { AiProviderProfile, AiRuntimeDefaults } from '../../../../../shared/ai/aiProviderTypes.ts'
import {
  normalizeAiEndpointPath,
  normalizeAiProviderValue,
  resolveAiTaskProviderSelection,
  resolveOrderedChatProviderCandidates,
  type AiProviderRouteCandidate
} from '../../../lib/aiProviderProfiles.ts'

export type AiStudioChatRouteSelection = {
  route: AiProviderRouteCandidate
  shouldUseRouteOverride: boolean
}

type AiStudioChatConfigLike = {
  aiProvider?: string | null
  aiRuntimeDefaults?: AiRuntimeDefaults | null
}

function normalizeRouteCandidate(
  candidate: Partial<AiProviderRouteCandidate> | null | undefined
): AiProviderRouteCandidate {
  return {
    providerId: normalizeAiProviderValue(candidate?.providerId) || normalizeAiProviderValue(candidate?.providerName),
    providerName: normalizeAiProviderValue(candidate?.providerName),
    modelId: normalizeAiProviderValue(candidate?.modelId) || normalizeAiProviderValue(candidate?.modelName),
    modelName: normalizeAiProviderValue(candidate?.modelName),
    endpointPath: normalizeAiEndpointPath(candidate?.endpointPath),
    baseUrl: normalizeAiProviderValue(candidate?.baseUrl),
    apiKey: normalizeAiProviderValue(candidate?.apiKey),
    protocol:
      candidate?.protocol === 'google-genai' || candidate?.protocol === 'vendor-custom'
        ? candidate.protocol
        : 'openai'
  }
}

function buildDefaultChatRouteCandidate({
  aiConfig,
  providerProfiles
}: {
  aiConfig: AiStudioChatConfigLike
  providerProfiles: AiProviderProfile[]
}): AiProviderRouteCandidate {
  const selection = resolveAiTaskProviderSelection(providerProfiles, {
    capability: 'chat',
    taskProviderName: '',
    taskModelName: '',
    fallbackProviderId: aiConfig.aiRuntimeDefaults?.chatProviderId ?? null,
    fallbackProviderName: aiConfig.aiProvider ?? '',
    fallbackModelName: ''
  })

  return normalizeRouteCandidate({
    providerId: selection.providerProfile?.id ?? selection.providerName,
    providerName: selection.providerName,
    modelId: selection.modelProfile?.id ?? selection.modelName,
    modelName: selection.modelName,
    endpointPath: selection.endpointPath,
    baseUrl: selection.baseUrl,
    apiKey: selection.apiKey,
    protocol: selection.modelProfile?.protocol ?? 'openai'
  })
}

export function resolveVideoSmartChatCandidates({
  aiConfig,
  providerProfiles
}: {
  aiConfig: AiStudioChatConfigLike
  providerProfiles: AiProviderProfile[]
}): AiProviderRouteCandidate[] {
  return resolveOrderedChatProviderCandidates(providerProfiles, {
    chatProviderId: aiConfig.aiRuntimeDefaults?.chatProviderId ?? null
  })
}

export function resolveStartChatRunSelection({
  aiConfig,
  providerProfiles,
  routeOverride
}: {
  aiConfig: AiStudioChatConfigLike
  providerProfiles: AiProviderProfile[]
  routeOverride?: Partial<AiProviderRouteCandidate> | null
}): AiStudioChatRouteSelection {
  if (routeOverride) {
    return {
      route: normalizeRouteCandidate(routeOverride),
      shouldUseRouteOverride: true
    }
  }

  return {
    route: buildDefaultChatRouteCandidate({
      aiConfig,
      providerProfiles
    }),
    shouldUseRouteOverride: false
  }
}

export function validateStartChatRunSelection(
  route: Partial<AiProviderRouteCandidate> | null | undefined
): Error | null {
  const normalized = normalizeRouteCandidate(route)
  if (!normalized.providerId && !normalized.providerName) {
    return new Error('[AI Studio] 请先在设置页配置聊天供应商。')
  }
  if (!normalized.apiKey) {
    return new Error('[AI Studio] 请先填写聊天供应商 API Key。')
  }
  if (!normalized.modelName) {
    return new Error('[AI Studio] 请先配置聊天模型。')
  }
  if (!normalized.endpointPath) {
    return new Error('[AI Studio] 请先配置聊天模型 Endpoint。')
  }
  return null
}
