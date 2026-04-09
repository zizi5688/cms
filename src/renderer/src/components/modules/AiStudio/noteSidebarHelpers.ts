import type { Task, TaskStatus } from '@renderer/store/useCmsStore'

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
  status?: TaskStatus
  accountId?: string
  productId?: string
  productName?: string
  linkedProducts?: Task['linkedProducts']
  videoPath?: string
  videoPreviewPath?: string
  videoCoverMode?: Task['videoCoverMode']
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

export type NotePreviewTaskLayout = {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

export type NotePreviewSelectionRect = {
  left: number
  top: number
  right: number
  bottom: number
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

function uniqueIds(ids: string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()

  ids.forEach((id) => {
    const normalized = trimText(id)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    next.push(normalized)
  })

  return next
}

function appendDispatchLog(log: string): string {
  const normalized = trimText(log)
  const dispatchText = '已派发到媒体矩阵'
  if (!normalized) return dispatchText
  if (normalized.includes(dispatchText)) return normalized
  return `${normalized}\n${dispatchText}`
}

function intersectRectangles(
  selectionRect: NotePreviewSelectionRect,
  tileRect: NotePreviewSelectionRect
): boolean {
  return !(
    tileRect.right < selectionRect.left ||
    tileRect.left > selectionRect.right ||
    tileRect.bottom < selectionRect.top ||
    tileRect.top > selectionRect.bottom
  )
}

function buildPreviewTaskDispatchKey(
  task: Pick<
    NotePreviewTask,
    'accountId' | 'title' | 'body' | 'assignedImages' | 'mediaType' | 'productId' | 'videoPath'
  >
): string {
  return JSON.stringify({
    accountId: trimText(task.accountId),
    title: trimText(task.title),
    body: trimText(task.body),
    mediaType: trimText(task.mediaType),
    productId: trimText(task.productId),
    videoPath: trimText(task.videoPath),
    assignedImages: uniquePaths(task.assignedImages ?? [])
  })
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

export function replaceVideoPreviewCoverImage(
  assignedImages: string[],
  droppedPaths: string[]
): string[] {
  const nextCoverPath = uniquePaths(droppedPaths)[0] ?? ''
  if (!nextCoverPath) return uniquePaths(assignedImages)

  const currentImages = uniquePaths(assignedImages)
  const trailingImages = currentImages.filter((path, index) => index > 0 && path !== nextCoverPath)
  return [nextCoverPath, ...trailingImages]
}

export function applyDroppedCoversToPreviewTasks<T extends NotePreviewTask>(
  tasks: T[],
  targetTaskId: string,
  droppedPaths: string[]
): { tasks: T[]; appliedCount: number } {
  const normalizedPaths = uniquePaths(droppedPaths)
  const normalizedTargetTaskId = trimText(targetTaskId)
  if (!normalizedTargetTaskId || normalizedPaths.length === 0) {
    return { tasks: tasks.slice(), appliedCount: 0 }
  }

  const targetIndex = tasks.findIndex((task) => trimText(task.id) === normalizedTargetTaskId)
  if (targetIndex < 0) {
    return { tasks: tasks.slice(), appliedCount: 0 }
  }

  let nextPathIndex = 0
  const nextTasks = tasks.map((task, index) => {
    const isEligibleVideoTask = index >= targetIndex && task.mediaType === 'video'
    if (!isEligibleVideoTask || nextPathIndex >= normalizedPaths.length) return task

    const nextCoverPath = normalizedPaths[nextPathIndex] ?? ''
    nextPathIndex += 1
    return {
      ...task,
      assignedImages: replaceVideoPreviewCoverImage(task.assignedImages, [nextCoverPath]),
      videoCoverMode: 'manual'
    } as T
  })

  return {
    tasks: nextTasks,
    appliedCount: nextPathIndex
  }
}

export function shouldAutoOpenBatchPickForVideoPreview(
  tasks: Array<Pick<NotePreviewTask, 'mediaType'>>
): boolean {
  return tasks.some((task) => trimText(task.mediaType) === 'video')
}

export function canToggleNotePreviewSelection(
  task: Pick<NotePreviewTask, 'status'>
): boolean {
  return !isNotePreviewTaskDispatched(task)
}

export function resolveIntersectedNotePreviewTaskIds({
  taskLayouts,
  selectableTaskIds,
  selectionRect
}: {
  taskLayouts: NotePreviewTaskLayout[]
  selectableTaskIds: string[]
  selectionRect: NotePreviewSelectionRect
}): string[] {
  const selectableSet = new Set(uniqueIds(selectableTaskIds))
  return taskLayouts
    .filter((taskLayout) => selectableSet.has(trimText(taskLayout.id)))
    .filter((taskLayout) => intersectRectangles(selectionRect, taskLayout))
    .map((taskLayout) => trimText(taskLayout.id))
    .filter(Boolean)
}

export function isNotePreviewTaskDispatched(task: Pick<NotePreviewTask, 'status'>): boolean {
  return task.status === 'success'
}

export function collectDispatchableNotePreviewTaskIds(
  tasks: Array<Pick<NotePreviewTask, 'id' | 'status'>>
): string[] {
  return tasks
    .filter((task) => !isNotePreviewTaskDispatched(task))
    .map((task) => trimText(task.id))
    .filter(Boolean)
}

export function resolveNotePreviewTasksForDispatch<T extends NotePreviewTask>(
  tasks: T[],
  selectedTaskIds: string[]
): T[] {
  const dispatchableIds = new Set(collectDispatchableNotePreviewTaskIds(tasks))
  const normalizedSelectedIds = uniqueIds(selectedTaskIds).filter((id) => dispatchableIds.has(id))
  if (normalizedSelectedIds.length > 0) {
    const selectedSet = new Set(normalizedSelectedIds)
    return tasks.filter((task) => selectedSet.has(trimText(task.id)))
  }
  return tasks.filter((task) => dispatchableIds.has(trimText(task.id)))
}

export function countUndispatchedNotePreviewTasks(
  tasks: Array<Pick<NotePreviewTask, 'status'>>
): number {
  return tasks.filter((task) => !isNotePreviewTaskDispatched(task)).length
}

export function matchCreatedTasksToNotePreviewTaskIds<T extends NotePreviewTask>(
  sourceTasks: T[],
  createdTasks: NotePreviewTask[]
): string[] {
  const pendingMap = new Map<string, string[]>()

  sourceTasks.forEach((task) => {
    const key = buildPreviewTaskDispatchKey(task)
    const next = pendingMap.get(key) ?? []
    next.push(trimText(task.id))
    pendingMap.set(key, next)
  })

  const matchedIds: string[] = []
  createdTasks.forEach((task) => {
    const key = buildPreviewTaskDispatchKey(task)
    const queue = pendingMap.get(key)
    const matchedId = queue?.shift()
    if (!matchedId) return
    matchedIds.push(matchedId)
    if (queue && queue.length === 0) {
      pendingMap.delete(key)
    }
  })

  return uniqueIds(matchedIds)
}

export function markNotePreviewTasksDispatched<T extends NotePreviewTask>(
  tasks: T[],
  dispatchedTaskIds: string[]
): T[] {
  const dispatchedSet = new Set(uniqueIds(dispatchedTaskIds))
  if (dispatchedSet.size === 0) return tasks.slice()

  return tasks.map((task) => {
    if (!dispatchedSet.has(trimText(task.id))) return task
    return {
      ...task,
      status: 'success',
      log: appendDispatchLog(task.log)
    } as T
  })
}

export const buildNotePreviewCards = buildNoteSidebarPreviewItems
