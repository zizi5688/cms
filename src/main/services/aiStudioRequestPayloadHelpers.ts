const DEFAULT_IMAGE_SIZE = '2K'

const MODEL_IMAGE_SIZE_MAP: Record<string, string> = {
  'nano-banana-pro-4k-vip': '4K'
}

export function resolveImageSizeForModel(model: string): string {
  const normalized = String(model ?? '').trim().toLowerCase()
  return MODEL_IMAGE_SIZE_MAP[normalized] ?? DEFAULT_IMAGE_SIZE
}

export function buildImageGenerationDirectiveLines(payload: {
  aspectRatio?: string | null
  imageSize?: string | null
  referenceCount?: number
}): string[] {
  const aspectRatio = String(payload.aspectRatio ?? '').trim()
  const imageSize = String(payload.imageSize ?? '').trim()
  const referenceCount = Number(payload.referenceCount ?? 0)
  const lines: string[] = []

  if (aspectRatio) {
    lines.push(`输出比例：${aspectRatio}。`)
  }
  if (imageSize) {
    lines.push(`输出清晰度：${imageSize}。`)
  }
  if (referenceCount > 0) {
    lines.push(
      `第 1 张输入图为主图，后续 ${referenceCount} 张为参考图，请保留主体材质、结构与关键细节。`
    )
  } else {
    lines.push('请保留主体材质、结构与关键细节。')
  }

  return lines
}

export function buildGeminiImageConfig(payload: {
  aspectRatio?: string | null
  imageSize?: string | null
}): Record<string, unknown> | undefined {
  const aspectRatio = String(payload.aspectRatio ?? '').trim()
  const imageSize = String(payload.imageSize ?? '').trim()

  const imageConfig: Record<string, unknown> = {}
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio
  if (imageSize) imageConfig.imageSize = imageSize

  return Object.keys(imageConfig).length > 0 ? imageConfig : undefined
}

export function buildGeminiGenerationConfig(payload: {
  aspectRatio?: string | null
  imageSize?: string | null
}): Record<string, unknown> {
  return {
    responseModalities: ['TEXT', 'IMAGE'],
    ...(buildGeminiImageConfig(payload) ? { imageConfig: buildGeminiImageConfig(payload) } : {})
  }
}
