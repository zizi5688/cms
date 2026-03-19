type ClipboardFileLike = {
  type?: string | null
  name?: string | null
}

type ClipboardItemLike = {
  type?: string | null
  getAsFile?: (() => ClipboardFileLike | null) | null
}

type ExtractPastedImageCandidatesInput = {
  clipboardFiles: ClipboardFileLike[]
  clipboardItems: ClipboardItemLike[]
  getPathForFile?: ((file: ClipboardFileLike) => string | null | undefined) | null
  nowMs?: number
}

type ExtractedBlobFile = {
  file: ClipboardFileLike
  filename: string
}

type ExtractPastedImageCandidatesResult = {
  filePaths: string[]
  blobFiles: ExtractedBlobFile[]
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePathLike(value: unknown): string {
  return normalizeText(value).replace(/[\\/]+$/g, '')
}

function isImageMimeType(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase()
  return normalized.startsWith('image/')
}

function basenameLike(filePath: string): string {
  const normalized = normalizePathLike(filePath)
  if (!normalized) return ''
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function dirnameLike(filePath: string): string {
  const normalized = normalizePathLike(filePath).replace(/\\/g, '/')
  if (!normalized) return ''
  const match = /^(.*)\/[^/]+$/.exec(normalized)
  if (!match) return ''
  const parent = match[1] ?? ''
  if (!parent) return normalized.startsWith('/') ? '/' : ''
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent
}

function resolveImageExtensionFromMimeType(mimeType: string): string {
  const normalized = normalizeText(mimeType).toLowerCase()
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg'
  if (normalized === 'image/heic') return '.heic'
  if (normalized === 'image/gif') return '.gif'
  return '.png'
}

function sanitizeFilename(filename: string): string {
  const trimmed = basenameLike(filename)
  if (!trimmed) return ''
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}

function splitFilename(filename: string): { baseName: string; extension: string } {
  const sanitized = sanitizeFilename(filename)
  if (!sanitized) return { baseName: '', extension: '' }
  const match = /^(.*?)(\.[^.]+)?$/.exec(sanitized)
  return {
    baseName: normalizeText(match?.[1] ?? ''),
    extension: normalizeText(match?.[2] ?? '')
  }
}

export function resolveThreadSourceFolderPath(input: {
  latestOutputFilePath?: string | null
  sourceFolderPath?: string | null
}): string | null {
  const latestOutputFilePath = normalizePathLike(input.latestOutputFilePath)
  if (latestOutputFilePath) {
    const runFolderPath = dirnameLike(latestOutputFilePath)
    const sourceFolderPath = dirnameLike(runFolderPath)
    if (sourceFolderPath) return sourceFolderPath
  }

  const fallbackSourceFolderPath = normalizePathLike(input.sourceFolderPath)
  return fallbackSourceFolderPath || null
}

export function buildPastedImageFilename(input: {
  originalName?: string | null
  mimeType?: string | null
  nowMs?: number
  index?: number
}): string {
  const mimeType = normalizeText(input.mimeType)
  const extension = resolveImageExtensionFromMimeType(mimeType)
  const nowMs = Number.isFinite(input.nowMs) ? Math.floor(Number(input.nowMs)) : Date.now()
  const index = Number.isFinite(input.index) && Number(input.index) > 0 ? Math.floor(Number(input.index)) : 1
  const { baseName, extension: originalExtension } = splitFilename(normalizeText(input.originalName))
  if (baseName) {
    return `${baseName}-${nowMs}-${index}${originalExtension || extension}`
  }

  return `ai-studio-paste-${nowMs}-${index}${extension}`
}

export function extractPastedImageCandidates(
  input: ExtractPastedImageCandidatesInput
): ExtractPastedImageCandidatesResult {
  const clipboardFiles = Array.isArray(input.clipboardFiles) ? input.clipboardFiles : []
  const clipboardItems = Array.isArray(input.clipboardItems) ? input.clipboardItems : []
  const getPathForFile = typeof input.getPathForFile === 'function' ? input.getPathForFile : null
  const nowMs = Number.isFinite(input.nowMs) ? Math.floor(Number(input.nowMs)) : Date.now()

  const directImageFiles = clipboardFiles.filter((file) => isImageMimeType(file?.type))
  const fallbackImageFiles = clipboardItems
    .filter((item) => isImageMimeType(item?.type))
    .map((item) => item.getAsFile?.() ?? null)
    .filter((file): file is ClipboardFileLike => Boolean(file) && isImageMimeType(file?.type))

  const sourceFiles = directImageFiles.length > 0 ? directImageFiles : fallbackImageFiles
  const filePaths: string[] = []
  const blobFiles: ExtractedBlobFile[] = []
  const seenPaths = new Set<string>()
  const seenBlobFiles = new Set<unknown>()

  sourceFiles.forEach((file, index) => {
    const filePath = normalizePathLike(getPathForFile?.(file))
    if (filePath) {
      if (seenPaths.has(filePath)) return
      seenPaths.add(filePath)
      filePaths.push(filePath)
      return
    }

    if (seenBlobFiles.has(file)) return
    seenBlobFiles.add(file)
    blobFiles.push({
      file,
      filename: buildPastedImageFilename({
        originalName: file.name,
        mimeType: file.type,
        nowMs,
        index: index + 1
      })
    })
  })

  return { filePaths, blobFiles }
}
