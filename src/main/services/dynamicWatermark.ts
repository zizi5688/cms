import { copyFile, rename, rm } from 'fs/promises'
import { resolve } from 'path'
import sharp from 'sharp'

export type DynamicWatermarkConfig = {
  opacity?: number
  size?: number
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeAccountName(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.replace(/^@+/, '').trim()
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function estimateTextWidth(text: string, fontSize: number): number {
  const charCount = Math.max(1, Array.from(String(text ?? '')).length)
  // Conservative estimate to avoid clipping when CJK and wide glyphs are mixed.
  return Math.max(fontSize, Math.ceil(charCount * fontSize * 1.2))
}

function randomBetween(min: number, max: number, fallback: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return fallback
  return min + Math.random() * (max - min)
}

export async function applyDynamicWatermark(
  inputPath: string,
  outputPath: string,
  accountName: string,
  config: DynamicWatermarkConfig
): Promise<void> {
  const normalizedInputPath = resolve(String(inputPath ?? '').trim())
  const normalizedOutputPath = resolve(String(outputPath ?? '').trim())
  if (!normalizedInputPath || !normalizedOutputPath) {
    throw new Error('[DynamicWatermark] invalid input/output path')
  }

  const normalizedAccountName = normalizeAccountName(accountName)
  if (!normalizedAccountName) {
    if (normalizedInputPath !== normalizedOutputPath) {
      await copyFile(normalizedInputPath, normalizedOutputPath)
    }
    return
  }

  const opacity = clampNumber(config?.opacity, 0, 100, 15)
  const size = clampNumber(config?.size, 2, 10, 5)
  const text = `@${normalizedAccountName}`

  // Always auto-orient by EXIF first, so portrait images won't be written as landscape.
  const metadata = await sharp(normalizedInputPath, { failOn: 'none', limitInputPixels: false }).rotate().metadata()
  const width = Number(metadata.width ?? 0)
  const height = Number(metadata.height ?? 0)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('[DynamicWatermark] invalid image metadata')
  }

  // Use shortest edge with a small coefficient to keep watermark subtle.
  const shortEdge = Math.min(width, height)
  const fontSize = Math.max(8, Math.round(shortEdge * (size / 100) * 0.22))
  const conservativeTextWidth = estimateTextWidth(text, fontSize)

  const minY = height * 0.5
  const maxY = height - fontSize - 20
  const fallbackY = Math.max(0, Math.min(height - fontSize - 2, height * 0.65))
  const y = randomBetween(minY, maxY, fallbackY)

  const minX = 20
  const maxX = width - conservativeTextWidth - 20
  const fallbackX = Math.max(0, Math.min(width - conservativeTextWidth - 2, width * 0.08))
  const x = randomBetween(minX, maxX, fallbackX)

  const overlayWidth = Math.max(24, Math.ceil(conservativeTextWidth + fontSize))
  const overlayHeight = Math.max(fontSize + 12, Math.ceil(fontSize * 2))
  const textX = Math.max(1, Math.round(fontSize * 0.12))
  const textY = Math.max(fontSize, Math.round(fontSize * 1.28))
  const alpha = Math.max(0, Math.min(1, opacity / 100))
  const safeText = escapeSvgText(text)

  const svgString = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${overlayWidth}" height="${overlayHeight}">`,
    `<text x="${textX}" y="${textY}" font-size="${fontSize}" font-weight="600"`,
    ' font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif"',
    ` fill="rgba(255,255,255,${alpha.toFixed(3)})">${safeText}</text>`,
    '</svg>'
  ].join('')

  const composite = async (destination: string): Promise<void> => {
    // No resize here: preserve original image dimensions, only composite text overlay.
    await sharp(normalizedInputPath, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .composite([
        {
          input: Buffer.from(svgString),
          top: Math.round(y),
          left: Math.round(x),
          blend: 'over'
        }
      ])
      .toColorspace('srgb')
      .toFile(destination)
  }

  if (normalizedInputPath !== normalizedOutputPath) {
    await composite(normalizedOutputPath)
    return
  }

  const tempOutputPath = `${normalizedOutputPath}.wm-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await composite(tempOutputPath)
    await rename(tempOutputPath, normalizedOutputPath)
  } catch (error) {
    await rm(tempOutputPath, { force: true }).catch(() => void 0)
    throw error
  }
}
