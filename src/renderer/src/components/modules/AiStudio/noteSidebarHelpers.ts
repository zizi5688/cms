export type NoteSidebarConstraintDrafts = {
  groupCount: string
  minImages: string
  maxImages: string
  maxReuse: string
}

export type NoteSidebarManifestConstraints = {
  groupCount: number
  minImages: number
  maxImages: number
  maxReuse: number
}

export type NotePreviewTask = {
  id: string
  title: string
  body: string
  assignedImages: string[]
  mediaType?: 'image' | 'video'
  log: string
}

export type NotePreviewUploadTask = {
  title: string
  body: string
  images: string[]
}

export type NotePreviewCard = {
  id: string
  title: string
  body: string
  imagePaths: string[]
  imageCount: number
  hasImageShortage: boolean
  log: string
}

function numberOr(value: string, fallback: number): number {
  const normalized = String(value ?? '').trim()
  if (!normalized) return fallback
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : fallback
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniquePaths(paths: string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()

  paths.forEach((path) => {
    const normalized = trimText(path)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    next.push(normalized)
  })

  return next
}

export function normalizeNoteSidebarConstraints(
  drafts: NoteSidebarConstraintDrafts
): NoteSidebarManifestConstraints {
  const groupCount = Math.max(1, Math.floor(numberOr(drafts.groupCount, 1)))
  const minImages = Math.max(1, Math.floor(numberOr(drafts.minImages, 3)))
  const maxImages = Math.max(minImages, Math.floor(numberOr(drafts.maxImages, 5)))
  const maxReuse = Math.max(1, Math.floor(numberOr(drafts.maxReuse, 1)))

  return {
    groupCount,
    minImages,
    maxImages,
    maxReuse
  }
}

export function buildUploadTasksFromNotePreviewTasks(
  tasks: NotePreviewTask[]
): NotePreviewUploadTask[] {
  return tasks.map((task) => ({
    title: trimText(task.title),
    body: trimText(task.body),
    images: task.mediaType === 'video' ? [] : uniquePaths(task.assignedImages)
  }))
}

export function buildNoteSidebarPreviewItems(tasks: NotePreviewTask[]): NotePreviewCard[] {
  return tasks.map((task) => {
    const log = trimText(task.log)
    const imagePaths = uniquePaths(task.assignedImages)

    return {
      id: trimText(task.id),
      title: trimText(task.title),
      body: trimText(task.body),
      imagePaths,
      imageCount: imagePaths.length,
      hasImageShortage: log.includes('图片不足'),
      log
    }
  })
}

export const buildNotePreviewCards = buildNoteSidebarPreviewItems
