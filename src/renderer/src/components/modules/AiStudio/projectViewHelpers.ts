export type AiStudioTrackedProjectEntry = {
  taskId: string
  createdAt: number
  lastOpenedAt: number
}

export type AiStudioProjectAssetLike = {
  id: string
  filePath: string
  previewPath: string | null
  createdAt: number
  updatedAt: number
  sortOrder: number
}

export type AiStudioProjectTaskLike = {
  id: string
  productName: string
  status: string
  sourceFolderPath?: string | null
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
  outputAssets: AiStudioProjectAssetLike[]
}

export type AiStudioProjectCardSummary = {
  taskId: string
  title: string
  status: string
  createdAt: number
  updatedAt: number
  updatedLabel: string
  outputCount: number
  thumbnailPaths: string[]
  lastOpenedAt: number
}

type BuildProjectCardSummariesInput = {
  tasks: AiStudioProjectTaskLike[]
  trackedProjects: AiStudioTrackedProjectEntry[]
  thumbnailLimit?: number
}

type AiStudioResolvedProjectMeta = {
  projectId: string
  projectRootTaskId: string
  projectName: string
  projectPath: string | null
}

function normalizeProjectText(value: unknown): string {
  return String(value ?? '').trim()
}

export function readProjectMeta(
  task: Pick<AiStudioProjectTaskLike, 'id' | 'productName' | 'sourceFolderPath' | 'metadata'> | null
): AiStudioResolvedProjectMeta | null {
  if (!task) return null

  const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {}
  const projectRootTaskId =
    normalizeProjectText(metadata.projectRootTaskId) || normalizeProjectText(task.id)
  const projectId =
    normalizeProjectText(metadata.projectId) || projectRootTaskId || normalizeProjectText(task.id)

  if (!projectId) return null

  return {
    projectId,
    projectRootTaskId,
    projectName:
      normalizeProjectText(metadata.projectName) ||
      normalizeProjectText(task.productName) ||
      '未命名项目',
    projectPath:
      normalizeProjectText(metadata.projectPath) ||
      normalizeProjectText(task.sourceFolderPath) ||
      null
  }
}

export function resolveTaskProjectId(
  task: Pick<AiStudioProjectTaskLike, 'id' | 'productName' | 'sourceFolderPath' | 'metadata'> | null
): string {
  return readProjectMeta(task)?.projectId ?? normalizeProjectText(task?.id)
}

export function normalizeTrackedProjects(value: unknown): AiStudioTrackedProjectEntry[] {
  if (!Array.isArray(value)) return []

  const now = Date.now()
  const seen = new Set<string>()
  const normalized: AiStudioTrackedProjectEntry[] = []

  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const record = item as Partial<AiStudioTrackedProjectEntry>
    const taskId = String(record.taskId ?? '').trim()
    if (!taskId || seen.has(taskId)) return
    seen.add(taskId)

    const createdAt = Number(record.createdAt)
    const lastOpenedAt = Number(record.lastOpenedAt)

    normalized.push({
      taskId,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : now + index,
      lastOpenedAt:
        Number.isFinite(lastOpenedAt) && lastOpenedAt > 0
          ? Math.floor(lastOpenedAt)
          : Number.isFinite(createdAt) && createdAt > 0
            ? Math.floor(createdAt)
            : now + index
    })
  })

  return normalized.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
}

export function upsertTrackedProject(
  entries: AiStudioTrackedProjectEntry[],
  nextEntry: { taskId: string; createdAt?: number; lastOpenedAt?: number }
): AiStudioTrackedProjectEntry[] {
  const taskId = String(nextEntry.taskId ?? '').trim()
  if (!taskId) return normalizeTrackedProjects(entries)

  const existing = normalizeTrackedProjects(entries)
  const found = existing.find((entry) => entry.taskId === taskId) ?? null
  const fallbackTime = Date.now()
  const createdAt =
    Number.isFinite(Number(nextEntry.createdAt)) && Number(nextEntry.createdAt) > 0
      ? Math.floor(Number(nextEntry.createdAt))
      : (found?.createdAt ?? fallbackTime)
  const lastOpenedAt =
    Number.isFinite(Number(nextEntry.lastOpenedAt)) && Number(nextEntry.lastOpenedAt) > 0
      ? Math.floor(Number(nextEntry.lastOpenedAt))
      : fallbackTime

  return normalizeTrackedProjects([
    { taskId, createdAt, lastOpenedAt },
    ...existing.filter((entry) => entry.taskId !== taskId)
  ])
}

export function removeTrackedProjects(
  entries: AiStudioTrackedProjectEntry[],
  taskIds: string[]
): AiStudioTrackedProjectEntry[] {
  const removedTaskIds = new Set(
    taskIds.map((taskId) => String(taskId ?? '').trim()).filter(Boolean)
  )
  if (removedTaskIds.size === 0) return normalizeTrackedProjects(entries)
  return normalizeTrackedProjects(entries).filter((entry) => !removedTaskIds.has(entry.taskId))
}

export function formatProjectUpdatedAt(timestamp: number): string {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return '--'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '--'

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildProjectThumbnailPaths(
  assets: AiStudioProjectAssetLike[],
  thumbnailLimit = 4
): string[] {
  const limit = Math.max(0, Math.floor(thumbnailLimit || 0))
  if (limit <= 0) return []

  return assets
    .filter((asset) => /\.(png|jpe?g|webp|heic)$/i.test(String(asset.filePath ?? '').trim()))
    .slice()
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.createdAt - left.createdAt ||
        right.sortOrder - left.sortOrder
    )
    .slice(0, limit)
    .map((asset) => String(asset.previewPath ?? asset.filePath ?? '').trim())
    .filter(Boolean)
}

export function buildProjectCardSummaries({
  tasks,
  trackedProjects,
  thumbnailLimit = 4
}: BuildProjectCardSummariesInput): AiStudioProjectCardSummary[] {
  const tracked = normalizeTrackedProjects(trackedProjects)
  const tasksById = new Map(tasks.map((task) => [String(task.id ?? '').trim(), task]))
  const tasksByProjectId = new Map<string, AiStudioProjectTaskLike[]>()

  tasks.forEach((task) => {
    const projectId = resolveTaskProjectId(task)
    if (!projectId) return
    const group = tasksByProjectId.get(projectId) ?? []
    group.push(task)
    tasksByProjectId.set(projectId, group)
  })

  return tracked
    .map((entry) => {
      const anchorTask = tasksById.get(entry.taskId)
      if (!anchorTask) return null

      const projectId = resolveTaskProjectId(anchorTask) || entry.taskId
      const projectTasks = tasksByProjectId.get(projectId) ?? [anchorTask]
      const projectMeta = readProjectMeta(anchorTask)
      const rootTaskId = projectMeta?.projectRootTaskId || entry.taskId
      const rootTask =
        projectTasks.find((task) => String(task.id ?? '').trim() === rootTaskId) ?? anchorTask
      const allOutputAssets = projectTasks.flatMap((task) =>
        Array.isArray(task.outputAssets) ? task.outputAssets : []
      )
      const thumbnailPaths = buildProjectThumbnailPaths(allOutputAssets, thumbnailLimit)
      const latestAssetUpdatedAt = Math.max(
        0,
        ...(allOutputAssets.map((asset) =>
          Math.max(Number(asset.updatedAt) || 0, Number(asset.createdAt) || 0)
        ) ?? [])
      )
      const updatedAt = Math.max(
        ...projectTasks.map((task) =>
          Math.max(Number(task.updatedAt) || 0, Number(task.createdAt) || 0)
        ),
        latestAssetUpdatedAt
      )

      return {
        taskId: String(rootTask.id ?? '').trim() || entry.taskId,
        title:
          readProjectMeta(rootTask)?.projectName ||
          String(rootTask.productName ?? '').trim() ||
          '未命名项目',
        status: String(rootTask.status ?? '').trim() || 'draft',
        createdAt: Number(rootTask.createdAt) || entry.createdAt,
        updatedAt,
        updatedLabel: formatProjectUpdatedAt(updatedAt),
        outputCount: allOutputAssets.length,
        thumbnailPaths,
        lastOpenedAt: entry.lastOpenedAt
      } satisfies AiStudioProjectCardSummary
    })
    .filter((card): card is AiStudioProjectCardSummary => Boolean(card))
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        right.lastOpenedAt - left.lastOpenedAt ||
        right.createdAt - left.createdAt
    )
}

export function sliceProjectCards(
  cards: AiStudioProjectCardSummary[],
  mode: 'recent' | 'all',
  recentLimit = 4
): AiStudioProjectCardSummary[] {
  if (mode === 'all') return cards.slice()
  return cards.slice(0, Math.max(0, Math.floor(recentLimit || 0)))
}
