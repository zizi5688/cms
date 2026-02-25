import { app } from 'electron'
import { copyFile, rename, rm, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { extname, join, resolve } from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStaticImport from 'ffmpeg-static'
import ffprobeStaticImport from 'ffprobe-static'
import sharp from 'sharp'

export type DynamicWatermarkConfig = {
  opacity?: number
  size?: number
  trajectory?: VideoWatermarkTrajectory
}

export type VideoWatermarkTrajectory = 'smoothSine' | 'figureEight' | 'diagonalWrap' | 'largeEllipse' | 'pseudoRandom'

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

function resolveStaticModule<T>(value: T): T {
  const maybe = value as unknown as { default?: T }
  return (maybe && typeof maybe === 'object' && 'default' in maybe && maybe.default ? maybe.default : value) as T
}

function normalizePackagedBinaryPath(binaryPath: string): string {
  const normalized = String(binaryPath ?? '').trim()
  if (!normalized) return ''
  if (!app.isPackaged) return normalized
  return normalized.includes('app.asar') ? normalized.replace('app.asar', 'app.asar.unpacked') : normalized
}

function resolveFfmpegPath(): string {
  const ffmpegStatic = resolveStaticModule(ffmpegStaticImport as unknown as string | null)
  const raw = typeof ffmpegStatic === 'string' ? ffmpegStatic : ''
  const resolved = normalizePackagedBinaryPath(raw)
  if (!resolved) throw new Error('[DynamicWatermark] ffmpeg-static path not found for current platform.')
  return resolved
}

function resolveFfprobePath(): string {
  const ffprobeStatic = resolveStaticModule(ffprobeStaticImport as unknown as { path?: string } | null)
  const raw = ffprobeStatic && typeof ffprobeStatic.path === 'string' ? ffprobeStatic.path : ''
  const resolved = normalizePackagedBinaryPath(raw)
  if (!resolved) throw new Error('[DynamicWatermark] ffprobe-static path not found for current platform.')
  return resolved
}

let didConfigureFfmpeg = false

function ensureFfmpegConfigured(): void {
  if (didConfigureFfmpeg) return
  ffmpeg.setFfmpegPath(resolveFfmpegPath())
  ffmpeg.setFfprobePath(resolveFfprobePath())
  didConfigureFfmpeg = true
}

async function probeVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  ensureFfmpegConfigured()
  return await new Promise((resolvePromise, rejectPromise) => {
    ffmpeg.ffprobe(videoPath, (error, metadata) => {
      if (error || !metadata) {
        const message = error instanceof Error ? error.message : String(error ?? 'unknown ffprobe error')
        rejectPromise(new Error(`[DynamicWatermark] ffprobe failed: ${message}`))
        return
      }

      const streams = Array.isArray(metadata.streams)
        ? (metadata.streams as Array<{ codec_type?: unknown; width?: unknown; height?: unknown }>)
        : []
      const videoStream = streams.find((stream) => stream.codec_type === 'video')
      const width = Number(videoStream?.width ?? 0)
      const height = Number(videoStream?.height ?? 0)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        rejectPromise(new Error('[DynamicWatermark] invalid video resolution from ffprobe'))
        return
      }

      resolvePromise({ width, height })
    })
  })
}

async function createVideoWatermarkSticker(accountName: string, config: DynamicWatermarkConfig, width: number, height: number): Promise<string> {
  const opacity = clampNumber(config?.opacity, 0, 100, 15)
  const size = clampNumber(config?.size, 2, 10, 5)
  const text = `@${accountName}`
  const shortEdge = Math.min(width, height)
  const fontSize = Math.max(8, Math.round(shortEdge * (size / 100) * 0.22))
  const conservativeTextWidth = estimateTextWidth(text, fontSize)
  const overlayWidth = Math.max(24, Math.ceil(conservativeTextWidth + fontSize * 0.45))
  const overlayHeight = Math.max(fontSize + 10, Math.ceil(fontSize * 1.65))
  const textX = Math.max(1, Math.round(fontSize * 0.12))
  const textY = Math.max(fontSize, Math.round(fontSize * 1.2))
  const alpha = Math.max(0, Math.min(1, opacity / 100))
  const safeText = escapeSvgText(text)
  const svgString = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${overlayWidth}" height="${overlayHeight}">`,
    `<text x="${textX}" y="${textY}" font-size="${fontSize}" font-weight="600"`,
    ' font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif"',
    ` fill="rgba(255,255,255,${alpha.toFixed(3)})">${safeText}</text>`,
    '</svg>'
  ].join('')

  const stickerPath = join(tmpdir(), `wm_${Date.now()}_${Math.random().toString(16).slice(2)}.png`)

  await sharp({
    create: {
      width: overlayWidth,
      height: overlayHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: Buffer.from(svgString), top: 0, left: 0, blend: 'over' }])
    .png()
    .toFile(stickerPath)

  return stickerPath
}

const FLOATING_ALGORITHMS = {
  smoothSine: "x='mod(t*13.3333333, W-w)':y='(H-h)/2 + (H-h)*0.4*sin(t*0.5)'",
  figureEight: "x='(W-w)/2 + (W-w)*0.4*cos(t*0.3333333)':y='(H-h)/2 + (H-h)*0.4*sin(t*0.6666667)'",
  diagonalWrap: "x='mod(t*10, W-w)':y='mod(t*10*(H/W), H-h)'",
  largeEllipse: "x='(W-w)/2 + (W-w)*0.45*cos(t*0.2666667)':y='(H-h)/2 + (H-h)*0.45*sin(t*0.2666667)'",
  pseudoRandom:
    "x='(W-w)/2 + (W-w)*0.25*sin(t*0.3666667) + (W-w)*0.15*cos(t*0.7666667)':y='(H-h)/2 + (H-h)*0.25*cos(t*0.4333333) + (H-h)*0.15*sin(t*0.9666667)'"
} as const

const DEFAULT_VIDEO_WATERMARK_TRAJECTORY: VideoWatermarkTrajectory = 'pseudoRandom'

function normalizeVideoWatermarkTrajectory(value: unknown): VideoWatermarkTrajectory {
  const normalized = String(value ?? '').trim()
  if (normalized in FLOATING_ALGORITHMS) {
    return normalized as VideoWatermarkTrajectory
  }
  return DEFAULT_VIDEO_WATERMARK_TRAJECTORY
}

async function runFloatingOverlay(
  inputVideoPath: string,
  stickerPath: string,
  outputVideoPath: string,
  trajectory: VideoWatermarkTrajectory
): Promise<void> {
  ensureFfmpegConfigured()
  const overlayExpr = FLOATING_ALGORITHMS[normalizeVideoWatermarkTrajectory(trajectory)]
  const overlayFilter = `[0:v][1:v]overlay=${overlayExpr}[wm]`

  await new Promise<void>((resolvePromise, rejectPromise) => {
    ffmpeg()
      .input(inputVideoPath)
      .input(stickerPath)
      .complexFilter([overlayFilter])
      .outputOptions([
        '-map [wm]',
        '-map 0:a?',
        '-c:v libx264',
        '-preset fast',
        '-crf 23',
        '-f',
        'mp4',
        '-movflags',
        'faststart',
        '-pix_fmt',
        'yuv420p',
        '-profile:v',
        'main',
        '-c:a aac',
        '-b:a',
        '128k',
        '-ar',
        '44100'
      ])
      .on('error', (error) => rejectPromise(error))
      .on('end', () => {
        void (async () => {
          await new Promise<void>((resolveDelay) => {
            setTimeout(resolveDelay, 500)
          })
          resolvePromise()
        })().catch((error: unknown) => {
          rejectPromise(error instanceof Error ? error : new Error(String(error)))
        })
      })
      .save(outputVideoPath)
  })
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

export async function applyVideoWatermark(
  inputVideoPath: string,
  outputVideoPath: string,
  accountName: string,
  config: DynamicWatermarkConfig
): Promise<void> {
  const normalizedInputPath = resolve(String(inputVideoPath ?? '').trim())
  const normalizedOutputPath = resolve(String(outputVideoPath ?? '').trim())
  if (!normalizedInputPath || !normalizedOutputPath) {
    throw new Error('[DynamicWatermark] invalid input/output video path')
  }

  const normalizedAccountName = normalizeAccountName(accountName)
  if (!normalizedAccountName) {
    if (normalizedInputPath !== normalizedOutputPath) {
      await copyFile(normalizedInputPath, normalizedOutputPath)
    }
    return
  }

  const { width, height } = await probeVideoResolution(normalizedInputPath)
  const stickerPath = await createVideoWatermarkSticker(normalizedAccountName, config, width, height)
  const needsAtomicReplace = normalizedInputPath === normalizedOutputPath
  const outputExt = extname(normalizedOutputPath) || '.mp4'
  const tempOutputPath = `${normalizedOutputPath}.wm-${Date.now()}-${Math.random().toString(16).slice(2)}${outputExt}`
  const savePath = needsAtomicReplace ? tempOutputPath : normalizedOutputPath

  try {
    await runFloatingOverlay(
      normalizedInputPath,
      stickerPath,
      savePath,
      normalizeVideoWatermarkTrajectory(config?.trajectory)
    )
    if (needsAtomicReplace) {
      await rename(savePath, normalizedOutputPath)
    }
  } catch (error) {
    if (needsAtomicReplace) {
      await rm(savePath, { force: true }).catch(() => void 0)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[DynamicWatermark] video watermark failed: ${message}`)
  } finally {
    await unlink(stickerPath).catch(() => void 0)
  }
}
