import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import sharp from 'sharp'

const DEFAULT_GEMINI_INLINE_MAX_BYTES = 350 * 1024
const DEFAULT_GEMINI_INLINE_MAX_EDGE = 512
const MIN_GEMINI_INLINE_EDGE = 192
const JPEG_QUALITY_STEPS = [84, 76, 68, 60]
const WEBP_QUALITY_STEPS = [82, 74, 66, 58]
const EDGE_SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4]

export type GeminiInlineImagePreparationOptions = {
  maxBytes?: number
  maxEdge?: number
}

export type GeminiInlineImagePreparationResult = {
  dataUrl: string
  mimeType: string
  byteLength: number
  originalByteLength: number
  width: number | null
  height: number | null
  originalWidth: number | null
  originalHeight: number | null
  transformed: boolean
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.floor(parsed))
}

function inferImageExtensionFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace('.', '')
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'jpg'
}

function inferMimeType(filePath: string): string {
  const ext = inferImageExtensionFromPath(filePath)
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'avif') return 'image/avif'
  return 'image/jpeg'
}

function toDataUrl(mimeType: string, buffer: Buffer): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function createSharpPipeline(buffer: Buffer) {
  return sharp(buffer, {
    failOn: 'none',
    limitInputPixels: false
  }).rotate()
}

export async function prepareGeminiInlineImageFromPath(
  filePath: string,
  options: GeminiInlineImagePreparationOptions = {}
): Promise<GeminiInlineImagePreparationResult> {
  const normalizedPath = normalizeText(filePath)
  if (!normalizedPath) throw new Error('[AI Studio] 图片路径不能为空。')

  const buffer = await readFile(normalizedPath)
  if (!buffer || buffer.length <= 0) {
    throw new Error(`[AI Studio] 图片为空：${basename(normalizedPath)}`)
  }

  return await prepareGeminiInlineImageBuffer(buffer, {
    ...options,
    sourcePath: normalizedPath
  })
}

async function prepareGeminiInlineImageBuffer(
  buffer: Buffer,
  payload: GeminiInlineImagePreparationOptions & { sourcePath?: string }
): Promise<GeminiInlineImagePreparationResult> {
  if (!buffer || buffer.length <= 0) {
    throw new Error('[AI Studio] Gemini inlineData 图片不能为空。')
  }

  const maxBytes = normalizePositiveInteger(payload.maxBytes, DEFAULT_GEMINI_INLINE_MAX_BYTES)
  const maxEdge = normalizePositiveInteger(payload.maxEdge, DEFAULT_GEMINI_INLINE_MAX_EDGE)
  const sourcePath = normalizeText(payload.sourcePath)
  const sourceMimeType = sourcePath ? inferMimeType(sourcePath) : 'image/jpeg'
  const sourceMetadata = await createSharpPipeline(buffer).metadata()
  const originalWidth = Number.isFinite(sourceMetadata.width) ? sourceMetadata.width ?? null : null
  const originalHeight = Number.isFinite(sourceMetadata.height) ? sourceMetadata.height ?? null : null
  const currentMaxEdge = Math.max(originalWidth ?? 0, originalHeight ?? 0)

  if (buffer.length <= maxBytes && currentMaxEdge > 0 && currentMaxEdge <= maxEdge) {
    return {
      dataUrl: toDataUrl(sourceMimeType, buffer),
      mimeType: sourceMimeType,
      byteLength: buffer.length,
      originalByteLength: buffer.length,
      width: originalWidth,
      height: originalHeight,
      originalWidth,
      originalHeight,
      transformed: false
    }
  }

  const baseEdge = currentMaxEdge > 0 ? Math.min(currentMaxEdge, maxEdge) : maxEdge
  const edgeTargets = Array.from(
    new Set(
      EDGE_SCALE_STEPS.map((scale) => Math.max(MIN_GEMINI_INLINE_EDGE, Math.round(baseEdge * scale)))
        .filter((value) => value <= baseEdge)
        .concat(baseEdge)
    )
  ).sort((left, right) => right - left)

  const hasAlpha = Boolean(sourceMetadata.hasAlpha)
  let bestCandidate: GeminiInlineImagePreparationResult | null = null

  for (const edgeTarget of edgeTargets) {
    const qualitySteps = hasAlpha ? WEBP_QUALITY_STEPS : JPEG_QUALITY_STEPS

    for (const quality of qualitySteps) {
      let pipeline = createSharpPipeline(buffer)
      if (!currentMaxEdge || currentMaxEdge > edgeTarget) {
        pipeline = pipeline.resize({
          width: edgeTarget,
          height: edgeTarget,
          fit: 'inside',
          withoutEnlargement: true
        })
      }

      const mimeType = hasAlpha ? 'image/webp' : 'image/jpeg'
      const encoded = hasAlpha
        ? pipeline.webp({ quality, alphaQuality: quality }).toBuffer({ resolveWithObject: true })
        : pipeline
            .jpeg({
              quality,
              mozjpeg: true,
              chromaSubsampling: '4:2:0'
            })
            .toBuffer({ resolveWithObject: true })
      const { data, info } = await encoded

      const candidate: GeminiInlineImagePreparationResult = {
        dataUrl: toDataUrl(mimeType, data),
        mimeType,
        byteLength: data.length,
        originalByteLength: buffer.length,
        width: Number.isFinite(info.width) ? info.width : null,
        height: Number.isFinite(info.height) ? info.height : null,
        originalWidth,
        originalHeight,
        transformed: true
      }

      if (!bestCandidate || candidate.byteLength < bestCandidate.byteLength) {
        bestCandidate = candidate
      }
      if (candidate.byteLength <= maxBytes) {
        return candidate
      }
    }
  }

  if (bestCandidate) return bestCandidate

  return {
    dataUrl: toDataUrl(sourceMimeType, buffer),
    mimeType: sourceMimeType,
    byteLength: buffer.length,
    originalByteLength: buffer.length,
    width: originalWidth,
    height: originalHeight,
    originalWidth,
    originalHeight,
    transformed: false
  }
}
