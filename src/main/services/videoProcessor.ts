import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readdir, stat, unlink } from 'fs/promises'
import { join } from 'path'

import ffmpeg from 'fluent-ffmpeg'
import ffmpegStaticImport from 'ffmpeg-static'
import ffprobeStaticImport from 'ffprobe-static'

export type VideoCompatibilityResult = {
  isCompatible: boolean
  codecName?: string
  formatName?: string
}

export type PrepareVideoPreviewResult = {
  originalPath: string
  previewPath: string | null
  isCompatible: boolean
  codecName?: string
  error?: string
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
  if (!resolved) throw new Error('[videoProcessor] ffmpeg-static path not found for current platform.')
  return resolved
}

function resolveFfprobePath(): string {
  const ffprobeStatic = resolveStaticModule(ffprobeStaticImport as unknown as { path?: string } | null)
  const raw = ffprobeStatic && typeof ffprobeStatic.path === 'string' ? ffprobeStatic.path : ''
  const resolved = normalizePackagedBinaryPath(raw)
  if (!resolved) throw new Error('[videoProcessor] ffprobe-static path not found for current platform.')
  return resolved
}

let didConfigureFfmpeg = false

function ensureFfmpegConfigured(): void {
  if (didConfigureFfmpeg) return
  ffmpeg.setFfmpegPath(resolveFfmpegPath())
  ffmpeg.setFfprobePath(resolveFfprobePath())
  didConfigureFfmpeg = true
}

function getTempPreviewDir(): string {
  return join(app.getPath('userData'), 'temp_previews')
}

function getTempCoverDir(): string {
  return join(app.getPath('userData'), 'temp_covers')
}

function hashPreviewKey(input: { filePath: string; size?: number; mtimeMs?: number }): string {
  const hasher = createHash('sha1')
  hasher.update(input.filePath)
  hasher.update('|')
  hasher.update(String(input.size ?? ''))
  hasher.update('|')
  hasher.update(String(input.mtimeMs ?? ''))
  return hasher.digest('hex').slice(0, 16)
}

async function probeVideoStream(
  filePath: string
): Promise<{ codecName: string; formatName: string; videoStreamCount: number } | null> {
  ensureFfmpegConfigured()
  return await new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error || !metadata) return resolve(null)
      const streams = Array.isArray(metadata.streams) ? metadata.streams : []
      const videoStreams = streams.filter((stream) => (stream as { codec_type?: unknown })?.codec_type === 'video') as Array<{
        codec_name?: unknown
      }>
      const video = streams.find((stream) => (stream as { codec_type?: unknown })?.codec_type === 'video') as
        | { codec_name?: unknown }
        | undefined
      const codecName = video && typeof video.codec_name === 'string' ? video.codec_name : ''
      const formatName =
        metadata.format && typeof (metadata.format as { format_name?: unknown }).format_name === 'string'
          ? String((metadata.format as { format_name?: unknown }).format_name)
          : ''
      if (!codecName.trim()) return resolve(null)
      resolve({
        codecName: codecName.trim().toLowerCase(),
        formatName: formatName.trim().toLowerCase(),
        videoStreamCount: Math.max(0, videoStreams.length)
      })
    })
  })
}

export async function checkVideoCompatibility(filePath: string): Promise<VideoCompatibilityResult> {
  const normalizedPath = String(filePath ?? '').trim()
  if (!normalizedPath) return { isCompatible: false }

  const stream = await probeVideoStream(normalizedPath)
  if (!stream) return { isCompatible: false }

  const codec = stream.codecName
  const isSingleVideoStream = stream.videoStreamCount === 1
  const isCompatible = isSingleVideoStream && (codec === 'h264' || codec === 'vp8' || codec === 'vp9')
  return { isCompatible, codecName: codec, formatName: stream.formatName }
}

async function transcodeToH264AacMp4(inputPath: string, outputPath: string): Promise<void> {
  ensureFfmpegConfigured()
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 0:a?',
        '-c:v libx264',
        '-preset ultrafast',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-c:a aac',
        '-b:a 128k'
      ])
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outputPath)
  })
}

export async function generatePreview(filePath: string): Promise<string> {
  const normalizedPath = String(filePath ?? '').trim()
  if (!normalizedPath) throw new Error('[videoProcessor] filePath is required.')

  const compatibility = await checkVideoCompatibility(normalizedPath)
  if (compatibility.isCompatible) return normalizedPath

  const previewDir = getTempPreviewDir()
  await mkdir(previewDir, { recursive: true })

  let fileStats: Awaited<ReturnType<typeof stat>> | null = null
  try {
    fileStats = await stat(normalizedPath)
  } catch {
    fileStats = null
  }

  const key = hashPreviewKey({
    filePath: normalizedPath,
    size: fileStats?.size,
    mtimeMs: Number(fileStats?.mtimeMs || 0) || undefined
  })
  const outputPath = join(previewDir, `preview_${key}.mp4`)

  if (existsSync(outputPath)) return outputPath

  try {
    await transcodeToH264AacMp4(normalizedPath, outputPath)
    return outputPath
  } catch (error) {
    try {
      if (existsSync(outputPath)) await unlink(outputPath)
    } catch {
      void 0
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[videoProcessor] transcode failed: ${message}`)
  }
}

export async function prepareVideoPreview(filePath: string): Promise<PrepareVideoPreviewResult> {
  const originalPath = String(filePath ?? '').trim()
  if (!originalPath) {
    return { originalPath: '', previewPath: null, isCompatible: false, error: '[videoProcessor] filePath is required.' }
  }

  try {
    const compatibility = await checkVideoCompatibility(originalPath)
    if (compatibility.isCompatible) {
      return {
        originalPath,
        previewPath: originalPath,
        isCompatible: true,
        codecName: compatibility.codecName
      }
    }

    const previewPath = await generatePreview(originalPath)
    return {
      originalPath,
      previewPath,
      isCompatible: false,
      codecName: compatibility.codecName
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      originalPath,
      previewPath: null,
      isCompatible: false,
      error: message
    }
  }
}

async function captureVideoFrameAt(inputPath: string, outputPath: string, timeSec: number): Promise<void> {
  ensureFfmpegConfigured()
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(Math.max(0, timeSec))
      .outputOptions(['-frames:v 1', '-q:v 2'])
      .on('error', (err) => reject(err))
      .on('end', () => resolve())
      .save(outputPath)
  })
}

export async function captureVideoFrame(filePath: string, timeSec = 0): Promise<string> {
  const normalizedPath = String(filePath ?? '').trim()
  if (!normalizedPath) throw new Error('[videoProcessor] filePath is required.')

  const safeTime = Number.isFinite(timeSec) ? Math.max(0, Number(timeSec)) : 0
  const coverDir = getTempCoverDir()
  await mkdir(coverDir, { recursive: true })

  const key = createHash('sha1')
    .update(normalizedPath)
    .update('|')
    .update(String(Math.floor(safeTime * 1000)))
    .digest('hex')
    .slice(0, 16)

  const outputPath = join(coverDir, `cover_${Date.now()}_${key}.jpg`)

  try {
    await captureVideoFrameAt(normalizedPath, outputPath, safeTime)
    if (!existsSync(outputPath)) throw new Error('[videoProcessor] frame capture output not found.')
    return outputPath
  } catch (error) {
    if (safeTime > 0.05) {
      try {
        await captureVideoFrameAt(normalizedPath, outputPath, 0)
        if (!existsSync(outputPath)) throw new Error('[videoProcessor] frame capture output not found.')
        return outputPath
      } catch (fallbackError) {
        try {
          if (existsSync(outputPath)) await unlink(outputPath)
        } catch {
          void 0
        }
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        throw new Error(`[videoProcessor] frame capture failed: ${message}`)
      }
    }

    try {
      if (existsSync(outputPath)) await unlink(outputPath)
    } catch {
      void 0
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[videoProcessor] frame capture failed: ${message}`)
  }
}

export async function cleanupTempPreviews(options?: { maxFiles?: number; maxAgeDays?: number }): Promise<void> {
  const previewDir = getTempPreviewDir()
  if (!existsSync(previewDir)) return

  const maxFiles = Number.isFinite(options?.maxFiles) ? Math.max(0, Number(options!.maxFiles)) : 60
  const maxAgeDays = Number.isFinite(options?.maxAgeDays) ? Math.max(0, Number(options!.maxAgeDays)) : 7
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const now = Date.now()

  let entries: Array<{ path: string; mtimeMs: number }> = []
  try {
    const dirents = await readdir(previewDir, { withFileTypes: true })
    const files = dirents.filter((d) => d.isFile()).map((d) => d.name)
    const items = await Promise.all(
      files.map(async (name) => {
        const absolutePath = join(previewDir, name)
        try {
          const s = await stat(absolutePath)
          return { path: absolutePath, mtimeMs: Number(s.mtimeMs || 0) }
        } catch {
          return { path: absolutePath, mtimeMs: 0 }
        }
      })
    )
    entries = items
  } catch {
    return
  }

  const expired = entries.filter((e) => e.mtimeMs > 0 && now - e.mtimeMs > maxAgeMs)
  for (const item of expired) {
    try {
      await unlink(item.path)
    } catch {
      void 0
    }
  }

  if (maxFiles <= 0) return

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const toDelete = entries.slice(maxFiles)
  for (const item of toDelete) {
    try {
      await unlink(item.path)
    } catch {
      void 0
    }
  }
}
