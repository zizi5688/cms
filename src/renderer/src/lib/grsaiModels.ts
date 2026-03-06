export type GrsaiModelOption = {
  value: string
  label: string
  description: string
}

export const DEFAULT_GRSAI_IMAGE_MODEL = 'nano-banana-fast'
export const LEGACY_DEFAULT_GRSAI_MODEL = 'image-default'
export const CUSTOM_GRSAI_MODEL_SENTINEL = '__custom__'

export const GRSAI_MODEL_OPTIONS: GrsaiModelOption[] = [
  {
    value: 'nano-banana-fast',
    label: 'nano-banana-fast',
    description: '极速版，适合日常高频出图。'
  },
  { value: 'nano-banana', label: 'nano-banana', description: '标准版，平衡速度与画质。' },
  { value: 'nano-banana-2', label: 'nano-banana-2', description: '第二代模型，适合尝试更新风格。' },
  {
    value: 'nano-banana-pro',
    label: 'nano-banana-pro',
    description: '高质量版，适合重点素材精修。'
  },
  {
    value: 'nano-banana-pro-vt',
    label: 'nano-banana-pro-vt',
    description: 'Pro VT 变体，适合特定高级场景。'
  },
  {
    value: 'nano-banana-pro-cl',
    label: 'nano-banana-pro-cl',
    description: 'Pro CL 变体，适合对一致性要求更高的任务。'
  },
  {
    value: 'nano-banana-pro-vip',
    label: 'nano-banana-pro-vip',
    description: 'VIP 版，适合优先质量场景。'
  },
  {
    value: 'nano-banana-pro-4k-vip',
    label: 'nano-banana-pro-4k-vip',
    description: '4K VIP 版，适合高分辨率重点物料。'
  }
]

export function normalizeGrsaiModelValue(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized === LEGACY_DEFAULT_GRSAI_MODEL ? '' : normalized
}

export function resolveDisplayedGrsaiModel(
  value: unknown,
  fallback = DEFAULT_GRSAI_IMAGE_MODEL
): string {
  const normalized = normalizeGrsaiModelValue(value)
  return normalized || fallback
}

export function isKnownGrsaiModel(value: unknown): boolean {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return GRSAI_MODEL_OPTIONS.some((option) => option.value === normalized)
}
