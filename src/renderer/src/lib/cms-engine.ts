import type { Task } from '@renderer/store/useCmsStore'
import Papa from 'papaparse'

export interface GenerateManifestOptions {
  groupCount: number
  minImages: number
  maxImages: number
  maxReuse: number
  bestEffort?: boolean
}

function randomIntInclusive(min: number, max: number): number {
  const low = Math.ceil(min)
  const high = Math.floor(max)
  return Math.floor(Math.random() * (high - low + 1)) + low
}

type CsvRow = Record<string, unknown>

function normalizeHeaderKey(input: string): string {
  return input.replace(/^\uFEFF/, '').trim().toLowerCase()
}

function isMeaningfulCsvRow(row: CsvRow): boolean {
  return Object.values(row).some((value) => String(value ?? '').trim().length > 0)
}

function normalizeLineBreaks(input: string): string {
  return String(input ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function getStringField(row: CsvRow, wantedKeys: string[], wantedIncludes: string[]): string {
  const normalized = new Map<string, string>()
  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeHeaderKey(key), String(value ?? ''))
  }

  for (const key of wantedKeys) {
    const value = normalized.get(normalizeHeaderKey(key))
    if (value !== undefined) return value
  }

  for (const include of wantedIncludes) {
    const normalizedInclude = normalizeHeaderKey(include)
    for (const [key, value] of normalized.entries()) {
      if (key.includes(normalizedInclude)) return value
    }
  }

  return ''
}

function parseCsv(csvText: string): CsvRow[] {
  const normalizedText = normalizeLineBreaks(csvText)
  const parsed = Papa.parse<CsvRow>(normalizedText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim()
  })

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]
    throw new Error(`CSV 解析失败：${first.message}`)
  }

  return parsed.data.filter(isMeaningfulCsvRow)
}

export function countManifestCsvRows(csvText: string): number {
  return parseCsv(csvText).length
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function generateManifest(
  csvText: string,
  imageFiles: string[],
  options: GenerateManifestOptions
): Task[] {
  const bestEffort = options.bestEffort ?? true
  const minImages = Math.max(0, Math.floor(options.minImages))
  const maxImages = Math.max(minImages, Math.floor(options.maxImages))
  const maxReuse = Math.max(1, Math.floor(options.maxReuse))
  const groupCount = Math.max(0, Math.floor(options.groupCount))

  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    throw new Error('CSV 内容为空或无法解析。')
  }

  const effectiveGroupCount = groupCount > 0 ? groupCount : rows.length
  if (effectiveGroupCount > rows.length) {
    throw new Error(`CSV 行数(${rows.length})小于目标组数(${effectiveGroupCount})，请减少组数或补全 CSV。`)
  }

  const selectedRows = rows.slice(0, effectiveGroupCount)

  const usage = new Map<string, number>()
  const normalizedImages = imageFiles.map((p) => p.trim()).filter(Boolean)

  const tasks: Task[] = []

  for (let i = 0; i < selectedRows.length; i += 1) {
    const row = selectedRows[i]
    const title = normalizeLineBreaks(getStringField(row, ['title', '标题'], ['title'])).trim()
    const body = normalizeLineBreaks(
      getStringField(row, ['body', '正文', 'content'], ['body', 'content', '正文'])
    ).trim()

    const desired = randomIntInclusive(minImages, maxImages)
    const assignedImages: string[] = []
    const usedInThisTask = new Set<string>()

    while (assignedImages.length < desired) {
      const eligible = normalizedImages.filter((img) => {
        if (usedInThisTask.has(img)) return false
        const used = usage.get(img) ?? 0
        return used < maxReuse
      })

      if (eligible.length === 0) break

      const pick = eligible[randomIntInclusive(0, eligible.length - 1)]
      assignedImages.push(pick)
      usedInThisTask.add(pick)
      usage.set(pick, (usage.get(pick) ?? 0) + 1)
    }

    let log = ''
    if (assignedImages.length < minImages) {
      const msg = `图片不足：目标至少 ${minImages} 张，实际分配 ${assignedImages.length} 张。`
      if (!bestEffort) throw new Error(msg)
      log = msg
    }

    tasks.push({
      id: createId(),
      title,
      body,
      assignedImages,
      mediaType: 'image',
      status: 'idle',
      log
    })
  }

  return tasks
}

export function generateVideoManifest(csvText: string, videoPath: string | string[]): Task[] {
  const normalizedVideoPaths = Array.from(
    new Set(
      (Array.isArray(videoPath) ? videoPath : [videoPath])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
    )
  )
  if (normalizedVideoPaths.length === 0) {
    throw new Error('视频路径为空，无法生成任务。')
  }

  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    throw new Error('CSV 内容为空或无法解析。')
  }

  return rows.map((row, index) => {
    const title = normalizeLineBreaks(getStringField(row, ['title', '标题'], ['title'])).trim()
    const body = normalizeLineBreaks(
      getStringField(row, ['body', '正文', 'content'], ['body', 'content', '正文'])
    ).trim()
    const selectedVideoPath = normalizedVideoPaths[index % normalizedVideoPaths.length]

    return {
      id: createId(),
      title,
      body,
      assignedImages: [],
      mediaType: 'video',
      videoPath: selectedVideoPath,
      status: 'idle',
      log: ''
    }
  })
}

export function generateOneToOneVideoManifest(
  csvText: string,
  videoPaths: string | string[]
): Task[] {
  const normalizedVideoPaths = Array.from(
    new Set(
      (Array.isArray(videoPaths) ? videoPaths : [videoPaths])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
    )
  )
  if (normalizedVideoPaths.length === 0) {
    throw new Error('视频路径为空，无法生成任务。')
  }

  const rows = parseCsv(csvText)
  if (rows.length === 0) {
    throw new Error('CSV 内容为空或无法解析。')
  }

  const pairedCount = Math.min(rows.length, normalizedVideoPaths.length)

  return rows.slice(0, pairedCount).map((row, index) => {
    const title = normalizeLineBreaks(getStringField(row, ['title', '标题'], ['title'])).trim()
    const body = normalizeLineBreaks(
      getStringField(row, ['body', '正文', 'content'], ['body', 'content', '正文'])
    ).trim()

    return {
      id: createId(),
      title,
      body,
      assignedImages: [],
      mediaType: 'video',
      videoPath: normalizedVideoPaths[index],
      status: 'idle',
      log: ''
    }
  })
}
