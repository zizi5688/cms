const DEFAULT_IMAGE_SIZE = '2K'

const MODEL_IMAGE_SIZE_MAP: Record<string, string> = {
  'nano-banana-pro-4k-vip': '4K'
}

export function resolveImageSizeForModel(model: string): string {
  const normalized = String(model ?? '').trim().toLowerCase()
  return MODEL_IMAGE_SIZE_MAP[normalized] ?? DEFAULT_IMAGE_SIZE
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
