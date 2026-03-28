const DEFAULT_IMAGE_SIZE = '2K'

const MODEL_IMAGE_SIZE_MAP: Record<string, string> = {
  'nano-banana-pro-4k-vip': '4K'
}

type SeedanceVideoMode = 'subject-reference' | 'first-last-frame'

export function resolveImageSizeForModel(model: string): string {
  const normalized = String(model ?? '').trim().toLowerCase()
  return MODEL_IMAGE_SIZE_MAP[normalized] ?? DEFAULT_IMAGE_SIZE
}

export function isGeminiGenerateContentPath(apiPath: string): boolean {
  return /:generatecontent(?:$|[?#])/i.test(String(apiPath ?? '').trim())
}

export function isSeedanceVideoModel(model: string): boolean {
  const normalized = String(model ?? '').trim().toLowerCase()
  return normalized.includes('seedance')
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

export function buildSeedanceVideoTaskPayload(payload: {
  model: string
  prompt: string
  mode: SeedanceVideoMode
  imageUrls: string[]
  aspectRatio?: string | null
  duration?: number | null
  watermark?: boolean | null
}): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = []
  const prompt = String(payload.prompt ?? '').trim()
  if (prompt) {
    content.push({
      type: 'text',
      text: prompt
    })
  }

  if (payload.mode === 'first-last-frame') {
    const [firstFrameUrl = '', lastFrameUrl = ''] = payload.imageUrls
    if (firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: firstFrameUrl },
        role: 'first_frame'
      })
    }
    if (lastFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: lastFrameUrl },
        role: 'last_frame'
      })
    }
  } else {
    payload.imageUrls
      .map((url) => String(url ?? '').trim())
      .filter(Boolean)
      .forEach((url) => {
        content.push({
          type: 'image_url',
          image_url: { url }
        })
      })
  }

  const requestPayload: Record<string, unknown> = {
    model: String(payload.model ?? '').trim(),
    content,
    watermark: payload.watermark ?? false
  }

  const aspectRatio = String(payload.aspectRatio ?? '').trim()
  if (aspectRatio) {
    requestPayload.ratio = aspectRatio
  }

  const duration = Number(payload.duration)
  if (Number.isFinite(duration) && duration > 0) {
    requestPayload.duration = Math.floor(duration)
  }

  return requestPayload
}
