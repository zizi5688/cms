import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, extname, join } from 'path'

import ffmpeg from 'fluent-ffmpeg'
import ffmpegStaticImport from 'ffmpeg-static'
import ffprobeStaticImport from 'ffprobe-static'

export type VideoTemplateTransition = 'none' | 'fade' | 'slideleft'

export type VideoStyleTemplate = {
  name?: string
  totalDurationSec: number
  imageCountMin: number
  imageCountMax: number
  width: number
  height: number
  fps: number
  transitionType: VideoTemplateTransition
  transitionDurationSec: number
  bgmVolume: number
}

export type ComposeVideoFromImagesPayload = {
  sourceImages?: unknown
  template?: Partial<VideoStyleTemplate>
  bgmPath?: unknown
  outputPath?: unknown
  seed?: unknown
}

export type ComposeVideoFromImagesResult = {
  success: boolean
  outputPath?: string
  usedImages?: string[]
  seed?: number
  error?: string
}

const DEFAULT_TEMPLATE: VideoStyleTemplate = {
  name: 'style-v1',
  totalDurationSec: 10,
  imageCountMin: 6,
  imageCountMax: 10,
  width: 1080,
  height: 1920,
  fps: 30,
  transitionType: 'fade',
  transitionDurationSec: 0.3,
  bgmVolume: 0.28
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
  if (!resolved) throw new Error('[videoComposer] ffmpeg-static path not found for current platform.')
  return resolved
}

function resolveFfprobePath(): string {
  const ffprobeStatic = resolveStaticModule(ffprobeStaticImport as unknown as { path?: string } | null)
  const raw = ffprobeStatic && typeof ffprobeStatic.path === 'string' ? ffprobeStatic.path : ''
  const resolved = normalizePackagedBinaryPath(raw)
  if (!resolved) throw new Error('[videoComposer] ffprobe-static path not found for current platform.')
  return resolved
}

let didConfigureFfmpeg = false

function ensureFfmpegConfigured(): void {
  if (didConfigureFfmpeg) return
  ffmpeg.setFfmpegPath(resolveFfmpegPath())
  ffmpeg.setFfprobePath(resolveFfprobePath())
  didConfigureFfmpeg = true
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(toFiniteNumber(value, fallback))
  return Math.min(max, Math.max(min, parsed))
}

function normalizeTemplate(raw: Partial<VideoStyleTemplate> | undefined): VideoStyleTemplate {
  const transitionType = raw?.transitionType === 'none' || raw?.transitionType === 'slideleft' ? raw.transitionType : 'fade'
  const width = toPositiveInt(raw?.width, DEFAULT_TEMPLATE.width, 360, 4096)
  const height = toPositiveInt(raw?.height, DEFAULT_TEMPLATE.height, 360, 4096)
  const fps = toPositiveInt(raw?.fps, DEFAULT_TEMPLATE.fps, 12, 60)
  const totalDurationSec = clampNumber(toFiniteNumber(raw?.totalDurationSec, DEFAULT_TEMPLATE.totalDurationSec), 2, 60)
  const imageCountMin = toPositiveInt(raw?.imageCountMin, DEFAULT_TEMPLATE.imageCountMin, 1, 50)
  const imageCountMax = toPositiveInt(raw?.imageCountMax, DEFAULT_TEMPLATE.imageCountMax, 1, 50)
  const min = Math.min(imageCountMin, imageCountMax)
  const max = Math.max(imageCountMin, imageCountMax)
  const transitionDurationSec = clampNumber(
    toFiniteNumber(raw?.transitionDurationSec, DEFAULT_TEMPLATE.transitionDurationSec),
    0,
    3
  )
  const bgmVolume = clampNumber(toFiniteNumber(raw?.bgmVolume, DEFAULT_TEMPLATE.bgmVolume), 0, 2)

  return {
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : DEFAULT_TEMPLATE.name,
    totalDurationSec,
    imageCountMin: min,
    imageCountMax: max,
    width,
    height,
    fps,
    transitionType,
    transitionDurationSec,
    bgmVolume
  }
}

function normalizeImagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .filter((item) => existsSync(item))
  return Array.from(new Set(normalized))
}

function normalizeSeed(value: unknown): number {
  const fallback = Date.now() % 2147483647
  const parsed = Math.floor(toFiniteNumber(value, fallback))
  if (!Number.isFinite(parsed)) return fallback
  const safe = parsed % 2147483647
  return safe > 0 ? safe : safe + 2147483646
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickRandomSubset(paths: string[], minCount: number, maxCount: number, seed: number): string[] {
  const size = paths.length
  if (size === 0) return []
  const min = Math.max(1, Math.min(minCount, size))
  const max = Math.max(min, Math.min(maxCount, size))
  const random = mulberry32(seed)
  const count = min + Math.floor(random() * (max - min + 1))
  const pool = paths.slice()
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = pool[i]
    pool[i] = pool[j]
    pool[j] = temp
  }
  return pool.slice(0, count)
}

function resolveOutputPath(rawPath: unknown): string {
  const value = typeof rawPath === 'string' ? rawPath.trim() : ''
  if (value) return extname(value).toLowerCase() === '.mp4' ? value : `${value}.mp4`
  const outputDir = join(app.getPath('userData'), 'generated_videos')
  const filename = `video_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`
  return join(outputDir, filename)
}

function toFixed3(value: number): string {
  return Math.max(0, value).toFixed(3)
}

async function renderVideo(options: {
  images: string[]
  outputPath: string
  template: VideoStyleTemplate
  bgmPath: string | null
}): Promise<void> {
  ensureFfmpegConfigured()

  const { images, outputPath, template, bgmPath } = options
  if (images.length === 0) throw new Error('[videoComposer] no images selected.')

  const totalDuration = clampNumber(template.totalDurationSec, 1, 120)
  const transitionsEnabled = template.transitionType !== 'none' && images.length > 1
  const rawTransition = transitionsEnabled ? template.transitionDurationSec : 0
  const clipDuration = totalDuration / images.length
  const transitionDuration = transitionsEnabled ? Math.min(rawTransition, Math.max(0, clipDuration * 0.6)) : 0
  const adjustedClipDuration =
    transitionDuration > 0 ? (totalDuration + (images.length - 1) * transitionDuration) / images.length : clipDuration
  const finalClipDuration = Math.max(0.2, adjustedClipDuration)

  const filterLines: string[] = []
  for (let index = 0; index < images.length; index += 1) {
    filterLines.push(
      `[${index}:v]scale=${template.width}:${template.height}:force_original_aspect_ratio=decrease,pad=${template.width}:${template.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,trim=duration=${toFixed3(finalClipDuration)},setpts=PTS-STARTPTS[v${index}]`
    )
  }

  if (images.length === 1) {
    filterLines.push(`[v0]fps=${template.fps},format=yuv420p[vout]`)
  } else if (transitionDuration <= 0) {
    const concatInput = images.map((_, idx) => `[v${idx}]`).join('')
    filterLines.push(`${concatInput}concat=n=${images.length}:v=1:a=0[vcat]`)
    filterLines.push(`[vcat]fps=${template.fps},format=yuv420p[vout]`)
  } else {
    let current = 'v0'
    const offsetStep = finalClipDuration - transitionDuration
    for (let index = 1; index < images.length; index += 1) {
      const outputLabel = `vx${index}`
      const offset = index * offsetStep
      filterLines.push(
        `[${current}][v${index}]xfade=transition=${template.transitionType}:duration=${toFixed3(transitionDuration)}:offset=${toFixed3(offset)}[${outputLabel}]`
      )
      current = outputLabel
    }
    filterLines.push(`[${current}]fps=${template.fps},format=yuv420p[vout]`)
  }

  const command = ffmpeg()

  for (const imagePath of images) {
    command.input(imagePath).inputOptions(['-loop 1', `-t ${toFixed3(finalClipDuration)}`])
  }

  const hasBgm = typeof bgmPath === 'string' && bgmPath.trim() && existsSync(bgmPath)
  if (hasBgm) {
    command.input(bgmPath as string).inputOptions(['-stream_loop -1'])
  }

  const outputOptions = [
    '-map [vout]',
    '-c:v libx264',
    '-preset veryfast',
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `-r ${template.fps}`,
    `-t ${toFixed3(totalDuration)}`
  ]

  if (hasBgm) {
    outputOptions.push(`-map ${images.length}:a:0`)
    const fadeOutStart = Math.max(0, totalDuration - 0.5)
    outputOptions.push(
      `-af volume=${toFixed3(template.bgmVolume)},afade=t=in:st=0:d=0.3,afade=t=out:st=${toFixed3(fadeOutStart)}:d=0.5`
    )
    outputOptions.push('-c:a aac', '-b:a 192k', '-shortest')
  } else {
    outputOptions.push('-an')
  }

  await mkdir(dirname(outputPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    command
      .complexFilter(filterLines)
      .outputOptions(outputOptions)
      .on('error', (error) => reject(error))
      .on('end', () => resolve())
      .save(outputPath)
  })
}

export async function composeVideoFromImages(
  payload: ComposeVideoFromImagesPayload
): Promise<ComposeVideoFromImagesResult> {
  const template = normalizeTemplate(payload?.template)
  const sourceImages = normalizeImagePaths(payload?.sourceImages)
  if (sourceImages.length === 0) {
    return { success: false, error: '[videoComposer] 至少需要一张可读图片。' }
  }

  const seed = normalizeSeed(payload?.seed)
  const usedImages = pickRandomSubset(sourceImages, template.imageCountMin, template.imageCountMax, seed)
  if (usedImages.length === 0) {
    return { success: false, seed, error: '[videoComposer] 可用图片数量不足。' }
  }

  const outputPath = resolveOutputPath(payload?.outputPath)
  const bgmPath = typeof payload?.bgmPath === 'string' && payload.bgmPath.trim() ? payload.bgmPath.trim() : null
  if (bgmPath && !existsSync(bgmPath)) {
    return { success: false, seed, error: `[videoComposer] 背景音乐不存在: ${bgmPath}` }
  }

  try {
    await renderVideo({
      images: usedImages,
      outputPath,
      template,
      bgmPath
    })
    return {
      success: true,
      outputPath,
      usedImages,
      seed
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      outputPath,
      usedImages,
      seed,
      error: `[videoComposer] ${message}`
    }
  }
}
