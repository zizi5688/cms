import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { basename, extname, join, resolve } from 'path'

type DouyinHotMusicTrack = {
  rank: number
  title: string
  artist: string
  url: string
}

type DouyinHotMusicIndexEntry = {
  url: string
  title: string
  artist: string
  fileName?: string
  sourceRank: number
  downloadedAt?: string
  lastSeenAt: string
  contentType?: string
  bytes?: number
}

type DouyinHotMusicIndexDoc = {
  version: 1
  source: string
  updatedAt: string
  entries: DouyinHotMusicIndexEntry[]
}

export type SyncDouyinHotMusicPayload = {
  outputDir?: unknown
  limit?: unknown
}

export type ListDouyinHotMusicPayload = {
  outputDir?: unknown
}

export type SyncDouyinHotMusicResult = {
  success: boolean
  outputDir: string
  manifestPath: string
  total: number
  downloaded: number
  skipped: number
  failed: number
  downloadedFiles: string[]
  errors: string[]
  updatedAt: string
  error?: string
}

export type ListDouyinHotMusicResult = {
  success: boolean
  outputDir: string
  files: string[]
  error?: string
}

const DOUYIN_HOT_HUB_README_URL = 'https://raw.githubusercontent.com/SnailDev/douyin-hot-hub/main/README.md'
const INDEX_FILE_NAME = 'index.json'
const MANIFEST_FILE_NAME = 'manifest.tsv'
const README_SNAPSHOT_FILE_NAME = 'README.latest.md'
const AUDIO_FILE_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac'])

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(toFiniteNumber(value, fallback))
  return Math.min(max, Math.max(min, parsed))
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeFileNamePart(value: string): string {
  const normalized = String(value ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return 'unknown'
  return normalized.slice(0, 64)
}

function toTsvCell(value: string): string {
  return String(value ?? '')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function resolveDefaultOutputBaseDir(): string {
  if (!app.isPackaged) return resolve(process.cwd(), 'resources', 'douyin-hot-music')
  return join(app.getPath('userData'), 'douyin-hot-music')
}

function resolveOutputDir(rawOutputDir: unknown): string {
  const normalized = trimString(rawOutputDir)
  if (normalized) return resolve(normalized)
  return join(resolveDefaultOutputBaseDir(), 'basic')
}

function isAudioFile(filePath: string): boolean {
  const ext = extname(String(filePath ?? '').trim()).toLowerCase()
  return AUDIO_FILE_EXTENSIONS.has(ext)
}

function uniquePaths(paths: string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const rawPath of paths) {
    const normalized = resolve(String(rawPath ?? '').trim())
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function resolveCandidateDirs(rawOutputDir: unknown): string[] {
  const outputDir = resolveOutputDir(rawOutputDir)
  const sourceBaseDir = resolveDefaultOutputBaseDir()
  const outputIsBasic = basename(outputDir).toLowerCase() === 'basic'
  const candidates = outputIsBasic
    ? [outputDir, resolve(outputDir, '..'), join(sourceBaseDir, 'basic'), sourceBaseDir]
    : [join(outputDir, 'basic'), outputDir, join(sourceBaseDir, 'basic'), sourceBaseDir]
  return uniquePaths(candidates)
}

async function listAudioFilesInDirectory(dirPath: string): Promise<string[]> {
  const normalizedDir = resolve(String(dirPath ?? '').trim())
  if (!normalizedDir || !existsSync(normalizedDir)) return []
  const entries = await readdir(normalizedDir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(normalizedDir, entry.name))
    .filter((filePath) => isAudioFile(filePath))
  files.sort((left, right) =>
    basename(left).localeCompare(basename(right), 'zh-CN', {
      numeric: true,
      sensitivity: 'base'
    })
  )
  return files
}

function parseHotMusicTracks(readme: string): DouyinHotMusicTrack[] {
  const lines = readme.split(/\r?\n/)
  const result: DouyinHotMusicTrack[] = []
  const seenUrls = new Set<string>()
  let inMusicSection = false

  for (const line of lines) {
    if (/^##\s+音乐榜\s*$/.test(line.trim())) {
      inMusicSection = true
      continue
    }
    if (inMusicSection && /^##\s+/.test(line.trim())) break
    if (!inMusicSection) continue

    const match = line.match(/^\s*\d+\.\s+\[(.+?)\]\((https?:\/\/[^\)]+)\)\s*-\s*(.+?)\s*$/)
    if (!match) continue

    const title = trimString(match[1])
    const url = trimString(match[2])
    const artist = trimString(match[3])
    if (!title || !url || !artist || seenUrls.has(url)) continue
    seenUrls.add(url)
    result.push({
      rank: result.length + 1,
      title,
      artist,
      url
    })
  }

  return result
}

function normalizeIndexEntry(raw: unknown): DouyinHotMusicIndexEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const url = trimString(record.url)
  const title = trimString(record.title)
  const artist = trimString(record.artist)
  const fileName = trimString(record.fileName)
  const sourceRank = toPositiveInt(record.sourceRank, 1, 1, 999)
  const lastSeenAt = trimString(record.lastSeenAt) || new Date(0).toISOString()
  if (!url || !title || !artist) return null

  return {
    url,
    title,
    artist,
    fileName: fileName || undefined,
    sourceRank,
    downloadedAt: trimString(record.downloadedAt) || undefined,
    lastSeenAt,
    contentType: trimString(record.contentType) || undefined,
    bytes: Number.isFinite(Number(record.bytes)) ? Number(record.bytes) : undefined
  }
}

async function fileExistsWithSize(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false
  const info = await stat(filePath).catch(() => null)
  return Boolean(info && info.isFile() && info.size > 0)
}

function detectAudioExtension(contentType: string, url: string): string {
  const normalizedType = String(contentType ?? '').toLowerCase()
  if (normalizedType.includes('audio/mpeg')) return 'mp3'
  if (normalizedType.includes('audio/aac')) return 'aac'
  if (normalizedType.includes('audio/ogg')) return 'ogg'
  if (normalizedType.includes('audio/wav') || normalizedType.includes('audio/x-wav')) return 'wav'
  if (normalizedType.includes('audio/mp4') || normalizedType.includes('video/mp4')) return 'm4a'

  const urlNoQuery = String(url ?? '').split('?')[0]
  const extMatch = urlNoQuery.match(/\.([a-z0-9]{2,5})$/i)
  const ext = extMatch?.[1]?.toLowerCase()
  if (ext === 'mp3' || ext === 'm4a' || ext === 'aac' || ext === 'ogg' || ext === 'wav') return ext
  return 'm4a'
}

async function loadIndex(outputDir: string): Promise<Map<string, DouyinHotMusicIndexEntry>> {
  const indexMap = new Map<string, DouyinHotMusicIndexEntry>()
  const indexPath = join(outputDir, INDEX_FILE_NAME)
  const manifestPath = join(outputDir, MANIFEST_FILE_NAME)

  if (existsSync(indexPath)) {
    const raw = await readFile(indexPath, 'utf8').catch(() => '')
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as { entries?: unknown }
        const entries = Array.isArray(parsed.entries) ? parsed.entries : []
        for (const item of entries) {
          const normalized = normalizeIndexEntry(item)
          if (!normalized) continue
          indexMap.set(normalized.url, normalized)
        }
      } catch {
        // ignore invalid json; fallback to manifest parsing
      }
    }
  }

  if (existsSync(manifestPath)) {
    const raw = await readFile(manifestPath, 'utf8').catch(() => '')
    const lines = raw.split(/\r?\n/)
    for (const line of lines) {
      if (!line || line.startsWith('rank\t') || line.startsWith('#')) continue
      const matched = line.match(/https?:\/\/[^\s\t]+/)
      if (!matched) continue
      const url = trimString(matched[0])
      if (!url || indexMap.has(url)) continue
      indexMap.set(url, {
        url,
        title: 'legacy',
        artist: 'legacy',
        sourceRank: 1,
        lastSeenAt: new Date(0).toISOString()
      })
    }
  }

  return indexMap
}

async function saveIndex(outputDir: string, entries: DouyinHotMusicIndexEntry[], updatedAt: string): Promise<void> {
  const indexPath = join(outputDir, INDEX_FILE_NAME)
  const sortedEntries = entries.slice().sort((a, b) => a.url.localeCompare(b.url))
  const doc: DouyinHotMusicIndexDoc = {
    version: 1,
    source: DOUYIN_HOT_HUB_README_URL,
    updatedAt,
    entries: sortedEntries
  }
  await writeFile(indexPath, JSON.stringify(doc, null, 2), 'utf8')
}

export async function listDouyinHotMusicTracks(
  payload: ListDouyinHotMusicPayload = {}
): Promise<ListDouyinHotMusicResult> {
  const candidates = resolveCandidateDirs(payload.outputDir)
  const fallbackDir = candidates[0] ?? resolveOutputDir(payload.outputDir)
  const result: ListDouyinHotMusicResult = {
    success: true,
    outputDir: fallbackDir,
    files: []
  }

  try {
    for (const candidate of candidates) {
      const files = await listAudioFilesInDirectory(candidate)
      if (files.length === 0) continue
      result.outputDir = candidate
      result.files = files
      return result
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      outputDir: fallbackDir,
      files: [],
      error: message
    }
  }
}

export async function syncDouyinHotMusic(payload: SyncDouyinHotMusicPayload = {}): Promise<SyncDouyinHotMusicResult> {
  const outputDir = resolveOutputDir(payload.outputDir)
  const manifestPath = join(outputDir, MANIFEST_FILE_NAME)
  const updatedAt = new Date().toISOString()

  const result: SyncDouyinHotMusicResult = {
    success: false,
    outputDir,
    manifestPath,
    total: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    downloadedFiles: [],
    errors: [],
    updatedAt
  }

  try {
    await mkdir(outputDir, { recursive: true })

    const readmeResponse = await fetch(DOUYIN_HOT_HUB_README_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    })
    if (!readmeResponse.ok) {
      throw new Error(`拉取排行榜 README 失败（HTTP ${readmeResponse.status}）`)
    }
    const readmeText = await readmeResponse.text()
    await writeFile(join(outputDir, README_SNAPSHOT_FILE_NAME), readmeText, 'utf8')

    const parsedTracks = parseHotMusicTracks(readmeText)
    if (parsedTracks.length === 0) {
      throw new Error('未解析到音乐榜条目，请稍后重试。')
    }
    const limit = toPositiveInt(payload.limit, parsedTracks.length, 1, parsedTracks.length)
    const tracks = parsedTracks.slice(0, limit)
    result.total = tracks.length

    const existingMap = await loadIndex(outputDir)
    const statusByUrl = new Map<string, 'downloaded' | 'existing' | 'failed'>()

    for (const track of tracks) {
      const existing = existingMap.get(track.url)
      if (existing?.fileName) {
        const existingPath = join(outputDir, existing.fileName)
        if (await fileExistsWithSize(existingPath)) {
          existingMap.set(track.url, {
            ...existing,
            title: track.title,
            artist: track.artist,
            sourceRank: track.rank,
            lastSeenAt: updatedAt
          })
          result.skipped += 1
          statusByUrl.set(track.url, 'existing')
          continue
        }
      }

      try {
        const audioResponse = await fetch(track.url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(20000)
        })
        if (!audioResponse.ok) {
          throw new Error(`HTTP ${audioResponse.status}`)
        }

        const contentType = trimString(audioResponse.headers.get('content-type')).toLowerCase()
        const ext = detectAudioExtension(contentType, track.url)
        const urlHash = createHash('sha1').update(track.url).digest('hex').slice(0, 10)
        const fileName = `${String(track.rank).padStart(3, '0')} - ${sanitizeFileNamePart(track.title)} - ${sanitizeFileNamePart(track.artist)} - ${urlHash}.${ext}`
        const filePath = join(outputDir, fileName)

        if (await fileExistsWithSize(filePath)) {
          result.skipped += 1
          statusByUrl.set(track.url, 'existing')
          existingMap.set(track.url, {
            url: track.url,
            title: track.title,
            artist: track.artist,
            fileName,
            sourceRank: track.rank,
            downloadedAt: updatedAt,
            lastSeenAt: updatedAt,
            contentType: contentType || undefined
          })
          continue
        }

        const binary = Buffer.from(await audioResponse.arrayBuffer())
        if (binary.length <= 0) throw new Error('返回空文件')
        await writeFile(filePath, binary)

        result.downloaded += 1
        result.downloadedFiles.push(filePath)
        statusByUrl.set(track.url, 'downloaded')
        existingMap.set(track.url, {
          url: track.url,
          title: track.title,
          artist: track.artist,
          fileName,
          sourceRank: track.rank,
          downloadedAt: updatedAt,
          lastSeenAt: updatedAt,
          contentType: contentType || undefined,
          bytes: binary.length
        })
      } catch (error) {
        result.failed += 1
        statusByUrl.set(track.url, 'failed')
        const message = error instanceof Error ? error.message : String(error)
        result.errors.push(`[${track.rank}] ${track.title} 下载失败：${message}`)
      }
    }

    const manifestLines = ['rank\ttitle\tartist\turl\tfile_name\tstatus']
    for (const track of tracks) {
      const entry = existingMap.get(track.url)
      const status = statusByUrl.get(track.url) ?? (entry ? 'existing' : 'failed')
      manifestLines.push(
        [
          String(track.rank),
          toTsvCell(track.title),
          toTsvCell(track.artist),
          track.url,
          entry?.fileName ?? '',
          status
        ].join('\t')
      )
    }
    await writeFile(manifestPath, `${manifestLines.join('\n')}\n`, 'utf8')
    await saveIndex(outputDir, Array.from(existingMap.values()), updatedAt)

    result.success = true
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.error = message
    result.errors.push(message)
    return result
  }
}
