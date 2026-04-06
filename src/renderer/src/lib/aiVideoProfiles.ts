export type AiStudioCapability = 'image' | 'video' | 'chat'

export type AiStudioVideoMode = 'subject-reference' | 'first-last-frame'
export type AiVideoAdapterKind = 'allapi-unified'
export type AiVideoAspectRatio = '16:9' | '9:16' | '1:1' | 'adaptive'
export type AiVideoResolution = '720p' | '1080p'
export type AiVideoDuration = 4 | 5 | 8

export type AiVideoProfile = {
  id: string
  label: string
  description: string
  providerLabel: string
  modelId: string
  adapterKind: AiVideoAdapterKind
  submitPath: string
  queryPath: string
  supportsModes: AiStudioVideoMode[]
  defaultMode: AiStudioVideoMode
  defaultAspectRatio: AiVideoAspectRatio
  defaultResolution: AiVideoResolution
  defaultDuration: AiVideoDuration
}

export const AI_VIDEO_PROFILES: AiVideoProfile[] = [
  {
    id: 'configured-video-model',
    label: '已配置视频模型',
    description: '通过供应商配置悬浮层选择要使用的视频模型。',
    providerLabel: '按供应商设置',
    modelId: '',
    adapterKind: 'allapi-unified',
    submitPath: '/v1/video/create',
    queryPath: '/v1/video/query',
    supportsModes: ['subject-reference', 'first-last-frame'],
    defaultMode: 'subject-reference',
    defaultAspectRatio: '9:16',
    defaultResolution: '1080p',
    defaultDuration: 5
  },
  {
    id: 'veo31-components',
    label: 'Veo 3.1 Components',
    description: '主体感稳定，适合商品主体参考与风格延展。',
    providerLabel: 'ALLAPI 统一视频',
    modelId: 'veo3.1-components',
    adapterKind: 'allapi-unified',
    submitPath: '/v1/video/create',
    queryPath: '/v1/video/query',
    supportsModes: ['subject-reference', 'first-last-frame'],
    defaultMode: 'subject-reference',
    defaultAspectRatio: '9:16',
    defaultResolution: '720p',
    defaultDuration: 5
  },
  {
    id: 'jimeng-video-3',
    label: '即梦 Video 3.0',
    description: '节奏更快，适合做首尾帧衔接与短视频素材。',
    providerLabel: 'ALLAPI 统一视频',
    modelId: 'jimeng-video-3.0',
    adapterKind: 'allapi-unified',
    submitPath: '/v1/video/create',
    queryPath: '/v1/video/query',
    supportsModes: ['subject-reference', 'first-last-frame'],
    defaultMode: 'first-last-frame',
    defaultAspectRatio: '9:16',
    defaultResolution: '720p',
    defaultDuration: 5
  }
]

export const DEFAULT_AI_VIDEO_PROFILE_ID = AI_VIDEO_PROFILES[0]?.id ?? 'configured-video-model'

export function getAiVideoProfile(profileId?: string | null): AiVideoProfile {
  const normalized = String(profileId ?? '').trim()
  return AI_VIDEO_PROFILES.find((profile) => profile.id === normalized) ?? AI_VIDEO_PROFILES[0]!
}

function normalizeVideoModelName(modelId?: string | null): string {
  return String(modelId ?? '').trim().toLowerCase()
}

export function isFixedEightSecondVideoModel(modelId?: string | null): boolean {
  const normalized = normalizeVideoModelName(modelId)
  return normalized.startsWith('veo3') || normalized.startsWith('veo-3')
}

export function isSeedanceVideoModel(modelId?: string | null): boolean {
  const normalized = normalizeVideoModelName(modelId)
  return normalized.includes('seedance')
}

export function getAllowedVideoAspectRatios(modelId?: string | null): AiVideoAspectRatio[] {
  if (isSeedanceVideoModel(modelId)) {
    return ['adaptive', '16:9', '9:16', '1:1']
  }
  return ['16:9', '9:16', '1:1']
}

export function normalizeVideoAspectRatioForModel(
  value: unknown,
  modelId: string | null | undefined,
  fallback: AiVideoAspectRatio
): AiVideoAspectRatio {
  const normalized =
    value === '16:9' || value === '9:16' || value === '1:1' || value === 'adaptive'
      ? value
      : fallback
  const allowed = getAllowedVideoAspectRatios(modelId)
  if (allowed.includes(normalized)) return normalized
  if (allowed.includes(fallback)) return fallback
  return allowed[0] ?? '9:16'
}

export function getAllowedVideoDurations(modelId?: string | null): AiVideoDuration[] {
  if (isSeedanceVideoModel(modelId)) return [4]
  return isFixedEightSecondVideoModel(modelId) ? [8] : [5, 8]
}

export function normalizeVideoDurationForModel(
  value: unknown,
  modelId: string | null | undefined,
  fallback: AiVideoDuration
): AiVideoDuration {
  const numeric = Number(value)
  const allowed = getAllowedVideoDurations(modelId)
  if (allowed.includes(numeric as AiVideoDuration)) {
    return numeric as AiVideoDuration
  }
  if (allowed.includes(fallback)) {
    return fallback
  }
  return allowed[0] ?? 8
}
