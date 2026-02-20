import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, rm, stat } from 'fs/promises'
import { dirname, extname, join } from 'path'
import { createHash } from 'crypto'

import ffmpeg from 'fluent-ffmpeg'
import ffmpegStaticImport from 'ffmpeg-static'
import ffprobeStaticImport from 'ffprobe-static'
import sharp from 'sharp'

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
  batchIndex?: unknown
  batchTotal?: unknown
}

export type ComposeVideoFromImagesResult = {
  success: boolean
  outputPath?: string
  usedImages?: string[]
  seed?: number
  error?: string
}

export type ComposeVideoProgress = {
  percent: number
}

type VideoEncoder = 'libx264' | 'h264_videotoolbox'

type ComposeVideoRuntimeOptions = {
  onProgress?: (progress: ComposeVideoProgress) => void
  lowLoadMode?: boolean
  lowLoadCacheDir?: string
  lowLoadImageProxyCache?: Map<string, string>
  imageReadableCache?: Map<string, boolean>
}

type ComposeVideoFromPreparedPoolPayload = {
  sourceImages: string[]
  template?: Partial<VideoStyleTemplate>
  bgmPath?: unknown
  outputPath?: unknown
  seed?: unknown
}

const DEFAULT_TEMPLATE: VideoStyleTemplate = {
  name: 'style-v1',
  totalDurationSec: 10,
  imageCountMin: 6,
  imageCountMax: 10,
  width: 1080,
  height: 1920,
  fps: 24,
  transitionType: 'fade',
  transitionDurationSec: 0.3,
  bgmVolume: 0.28
}

function resolveEncoderThreads(): number {
  return 1
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
  const fps = toPositiveInt(raw?.fps, DEFAULT_TEMPLATE.fps, 12, 24)
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

function toLowLoadTemplate(template: VideoStyleTemplate): VideoStyleTemplate {
  const portrait = template.height >= template.width
  const width = portrait ? 720 : 1280
  const height = portrait ? 1280 : 720
  const hasTransition = template.transitionType !== 'none'
  return {
    ...template,
    width,
    height,
    fps: Math.min(template.fps, 12),
    transitionType: hasTransition ? 'fade' : 'none',
    transitionDurationSec: hasTransition ? Math.min(Math.max(template.transitionDurationSec, 0.08), 0.15) : 0
  }
}

function toHdTemplate(template: VideoStyleTemplate): VideoStyleTemplate {
  const portrait = template.height >= template.width
  const width = portrait ? 1080 : 1920
  const height = portrait ? 1920 : 1080
  return {
    ...template,
    width,
    height,
    fps: Math.min(template.fps, 12)
  }
}

export function normalizeImagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
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

async function isImageReadable(imagePath: string, cache?: Map<string, boolean>): Promise<boolean> {
  if (!imagePath) return false
  const cached = cache?.get(imagePath)
  if (cached !== undefined) return cached

  const fileStat = await stat(imagePath).catch(() => null)
  if (!fileStat || !fileStat.isFile()) {
    cache?.set(imagePath, false)
    return false
  }

  try {
    await sharp(imagePath, { failOn: 'error', limitInputPixels: false }).metadata()
    cache?.set(imagePath, true)
    return true
  } catch {
    cache?.set(imagePath, false)
    return false
  }
}

async function resolveImageProxyPath(options: {
  sourcePath: string
  template: VideoStyleTemplate
  cacheDir: string
  quality: number
  cacheMap?: Map<string, string>
}): Promise<string> {
  const { sourcePath, template, cacheDir, quality, cacheMap } = options
  const sourceStat = await stat(sourcePath).catch(() => null)
  if (!sourceStat || !sourceStat.isFile()) return sourcePath

  const cacheKey = `${sourcePath}|${sourceStat.mtimeMs}|${sourceStat.size}|${template.width}x${template.height}|q${quality}`
  const cachedPath = cacheMap?.get(cacheKey)
  if (cachedPath && existsSync(cachedPath)) return cachedPath

  const filename = `${createHash('sha1').update(cacheKey).digest('hex')}.jpg`
  const outputPath = join(cacheDir, filename)
  if (!existsSync(outputPath)) {
    await sharp(sourcePath, { failOn: 'none', limitInputPixels: false })
      .rotate()
      .resize(template.width, template.height, {
        fit: 'cover',
        position: 'centre'
      })
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: '4:2:0'
      })
      .toFile(outputPath)
  }

  cacheMap?.set(cacheKey, outputPath)
  return outputPath
}

async function prepareLowLoadImagesForRender(
  selectedImages: string[],
  poolImages: string[],
  minRequired: number,
  seed: number,
  template: VideoStyleTemplate,
  runtimeOptions: ComposeVideoRuntimeOptions
): Promise<{ usedImages: string[]; renderImages: string[] }> {
  return prepareProxyImagesForRender(selectedImages, poolImages, minRequired, seed, template, runtimeOptions, 64)
}

async function prepareProxyImagesForRender(
  selectedImages: string[],
  poolImages: string[],
  minRequired: number,
  seed: number,
  template: VideoStyleTemplate,
  runtimeOptions: ComposeVideoRuntimeOptions,
  quality: number
): Promise<{ usedImages: string[]; renderImages: string[] }> {
  const targetCount = selectedImages.length
  const cacheDir = runtimeOptions.lowLoadCacheDir?.trim() || join(app.getPath('temp'), 'super-cms-video-lowload-cache')
  await mkdir(cacheDir, { recursive: true })

  const visited = new Set<string>()
  const orderedCandidates: string[] = []
  for (const imagePath of selectedImages) {
    if (!imagePath || visited.has(imagePath)) continue
    visited.add(imagePath)
    orderedCandidates.push(imagePath)
  }

  const fallbackPool = poolImages.filter((item) => item && !visited.has(item))
  const random = mulberry32((seed ^ 0x85ebca6b) >>> 0)
  for (let index = fallbackPool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const temp = fallbackPool[index]
    fallbackPool[index] = fallbackPool[swapIndex]
    fallbackPool[swapIndex] = temp
  }
  orderedCandidates.push(...fallbackPool)

  const usedImages: string[] = []
  const renderImages: string[] = []
  for (const imagePath of orderedCandidates) {
    if (usedImages.length >= targetCount) break
    const readable = await isImageReadable(imagePath, runtimeOptions.imageReadableCache)
    if (!readable) continue

    try {
      const proxyPath = await resolveImageProxyPath({
        sourcePath: imagePath,
        template,
        cacheDir,
        quality,
        cacheMap: runtimeOptions.lowLoadImageProxyCache
      })
      usedImages.push(imagePath)
      renderImages.push(proxyPath)
    } catch {
      runtimeOptions.imageReadableCache?.set(imagePath, false)
    }
  }

  if (usedImages.length < minRequired) return { usedImages: [], renderImages: [] }
  return { usedImages, renderImages }
}

async function prepareStandardImagesForRender(
  selectedImages: string[],
  poolImages: string[],
  minRequired: number,
  seed: number,
  template: VideoStyleTemplate,
  runtimeOptions: ComposeVideoRuntimeOptions
): Promise<{ usedImages: string[]; renderImages: string[] }> {
  return prepareProxyImagesForRender(selectedImages, poolImages, minRequired, seed, template, runtimeOptions, 72)
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

function parseTimemarkToSeconds(timemark: unknown): number {
  if (typeof timemark !== 'string') return 0
  const normalized = timemark.trim()
  if (!normalized) return 0
  const parts = normalized.split(':')
  if (parts.length !== 3) return 0
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  const seconds = Number(parts[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0
  return hours * 3600 + minutes * 60 + seconds
}

async function renderVideo(options: {
  images: string[]
  outputPath: string
  template: VideoStyleTemplate
  bgmPath: string | null
  videoEncoder: VideoEncoder
  lowLoadMode: boolean
  imagesPreprocessed: boolean
  onProgress?: (progress: ComposeVideoProgress) => void
}): Promise<void> {
  ensureFfmpegConfigured()

  const { images, outputPath, template, bgmPath, videoEncoder, lowLoadMode, imagesPreprocessed, onProgress } = options
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
    if (imagesPreprocessed) {
      filterLines.push(
        `[${index}:v]setsar=1,format=yuv420p,trim=duration=${toFixed3(finalClipDuration)},setpts=PTS-STARTPTS[v${index}]`
      )
      continue
    }

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
  if (typeof command.renice === 'function') {
    try {
      command.renice(15)
    } catch {
      // ignore unsupported platform/process policy errors
    }
  }

  for (const imagePath of images) {
    command.input(imagePath).inputOptions(['-loop 1', `-t ${toFixed3(finalClipDuration)}`])
  }

  const hasBgm = typeof bgmPath === 'string' && bgmPath.trim() && existsSync(bgmPath)
  if (hasBgm) {
    command.input(bgmPath as string).inputOptions(['-stream_loop -1'])
  }

  const outputOptions = [
    '-map [vout]',
    `-c:v ${videoEncoder}`,
    `-threads ${resolveEncoderThreads()}`,
    '-filter_threads 1',
    '-filter_complex_threads 1',
    '-sws_flags fast_bilinear',
    '-pix_fmt yuv420p',
    '-movflags +faststart',
    `-r ${template.fps}`,
    `-t ${toFixed3(totalDuration)}`
  ]

  if (videoEncoder === 'h264_videotoolbox') {
    if (lowLoadMode) {
      outputOptions.push('-allow_sw 1', '-realtime 1', '-b:v 2500k', '-maxrate 3500k', '-bufsize 6000k', '-tag:v avc1')
    } else {
      outputOptions.push('-allow_sw 1', '-realtime 1', '-b:v 4000k', '-maxrate 6000k', '-bufsize 9000k', '-tag:v avc1')
    }
  } else {
    outputOptions.push('-preset ultrafast', '-tune stillimage', '-crf 30')
  }

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

  let lastPercent = -1
  let lastEmitAt = 0
  const emitProgress = (rawPercent: number): void => {
    const normalized = clampNumber(rawPercent, 0, 1)
    const percent = lastPercent >= 0 ? Math.max(lastPercent, normalized) : normalized
    const now = Date.now()
    if (percent < 1) {
      const hasSmallChange = lastPercent >= 0 && Math.abs(percent - lastPercent) < 0.025
      const isHighFrequency = now - lastEmitAt < 180
      if (hasSmallChange && isHighFrequency) return
    }
    lastPercent = percent
    lastEmitAt = now
    onProgress?.({ percent })
  }
  emitProgress(0)

  await new Promise<void>((resolve, reject) => {
    command
      .complexFilter(filterLines)
      .outputOptions(outputOptions)
      .on('progress', (progress) => {
        const timemarkSeconds = parseTimemarkToSeconds((progress as { timemark?: unknown })?.timemark)
        if (timemarkSeconds > 0 && totalDuration > 0) {
          emitProgress(timemarkSeconds / totalDuration)
          return
        }
        const percent = Number((progress as { percent?: unknown })?.percent)
        if (Number.isFinite(percent)) emitProgress(percent / 100)
      })
      .on('error', (error) => reject(error))
      .on('end', () => {
        emitProgress(1)
        resolve()
      })
      .save(outputPath)
  })
}

export async function composeVideoFromPreparedImagePool(
  payload: ComposeVideoFromPreparedPoolPayload,
  runtimeOptions: ComposeVideoRuntimeOptions = {}
): Promise<ComposeVideoFromImagesResult> {
  const normalizedTemplate = normalizeTemplate(payload?.template)
  const isLowLoadMode = runtimeOptions.lowLoadMode === true
  const isHdMode = runtimeOptions.lowLoadMode === false
  const template = isLowLoadMode ? toLowLoadTemplate(normalizedTemplate) : isHdMode ? toHdTemplate(normalizedTemplate) : normalizedTemplate
  const sourceImages = payload.sourceImages
  if (sourceImages.length === 0) {
    return { success: false, error: '[videoComposer] 至少需要一张可读图片。' }
  }

  const seed = normalizeSeed(payload?.seed)
  const selectedImages = pickRandomSubset(sourceImages, template.imageCountMin, template.imageCountMax, seed)
  const minRequired = Math.max(1, Math.min(template.imageCountMin, sourceImages.length))

  const outputPath = resolveOutputPath(payload?.outputPath)
  const bgmPath = typeof payload?.bgmPath === 'string' && payload.bgmPath.trim() ? payload.bgmPath.trim() : null
  if (bgmPath && !existsSync(bgmPath)) {
    return { success: false, seed, error: `[videoComposer] 背景音乐不存在: ${bgmPath}` }
  }

  let usedImages: string[] = []
  try {
    const prepared = isLowLoadMode
      ? await prepareLowLoadImagesForRender(selectedImages, sourceImages, minRequired, seed, template, runtimeOptions)
      : await prepareStandardImagesForRender(selectedImages, sourceImages, minRequired, seed, template, runtimeOptions)

    usedImages = prepared.usedImages
    const renderImages = prepared.renderImages
    if (usedImages.length === 0 || renderImages.length === 0) {
      return { success: false, seed, error: '[videoComposer] 可用图片数量不足或图片文件损坏。' }
    }

    const preferredEncoder: VideoEncoder = process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264'
    try {
      await renderVideo({
        images: renderImages,
        outputPath,
        template,
        bgmPath,
        videoEncoder: preferredEncoder,
        lowLoadMode: isLowLoadMode,
        imagesPreprocessed: true,
        onProgress: runtimeOptions.onProgress
      })
    } catch (firstError) {
      const firstMessage = firstError instanceof Error ? firstError.message.toLowerCase() : String(firstError).toLowerCase()
      const shouldFallbackToX264 =
        preferredEncoder === 'h264_videotoolbox' &&
        (firstMessage.includes('videotoolbox') ||
          firstMessage.includes('unknown encoder') ||
          firstMessage.includes('encoder not found') ||
          firstMessage.includes('error while opening encoder'))

      if (!shouldFallbackToX264) throw firstError

      await rm(outputPath, { force: true }).catch(() => void 0)
      await renderVideo({
        images: renderImages,
        outputPath,
        template,
        bgmPath,
        videoEncoder: 'libx264',
        lowLoadMode: isLowLoadMode,
        imagesPreprocessed: true,
        onProgress: runtimeOptions.onProgress
      })
    }
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

export async function composeVideoFromImages(
  payload: ComposeVideoFromImagesPayload,
  runtimeOptions: ComposeVideoRuntimeOptions = {}
): Promise<ComposeVideoFromImagesResult> {
  const sourceImages = normalizeImagePaths(payload?.sourceImages)
  return composeVideoFromPreparedImagePool(
    {
      sourceImages,
      template: payload?.template,
      bgmPath: payload?.bgmPath,
      outputPath: payload?.outputPath,
      seed: payload?.seed
    },
    runtimeOptions
  )
}
