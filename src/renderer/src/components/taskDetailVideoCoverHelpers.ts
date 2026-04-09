import { isSupportedProjectAssetImagePath } from './modules/AiStudio/projectAssetLibraryHelpers.ts'
import {
  buildProjectCardSummaries,
  formatProjectUpdatedAt,
  normalizeTrackedProjects,
  readProjectMeta,
  resolveTaskProjectId,
  type AiStudioTrackedProjectEntry
} from './modules/AiStudio/projectViewHelpers.ts'

type ProjectTaskLike = {
  id: string
  productName?: string | null
  status?: string | null
  sourceFolderPath?: string | null
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

type ProjectAssetLike = {
  id: string
  taskId: string
  kind?: string | null
  role?: string | null
  filePath?: string | null
  previewPath?: string | null
  createdAt?: number
  updatedAt?: number
  sortOrder?: number
}

export type TaskDetailProjectCard = {
  projectId: string
  rootTaskId: string
  title: string
  updatedAt: number
  updatedLabel: string
  assetCount: number
  thumbnailPaths: string[]
}

export type TaskDetailTrackedProjectLike = AiStudioTrackedProjectEntry

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeTimestamp(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0
}

function dedupeProjectAssets(assets: ProjectAssetLike[]): ProjectAssetLike[] {
  const seen = new Set<string>()
  const deduped: ProjectAssetLike[] = []
  for (const asset of assets) {
    const idKey = normalizeText(asset.id)
    const fileKey = normalizeText(asset.filePath).toLowerCase()
    const key = fileKey || idKey
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(asset)
  }
  return deduped
}

function isSelectableProjectImageAsset(asset: ProjectAssetLike): boolean {
  const filePath = normalizeText(asset.filePath)
  if (!isSupportedProjectAssetImagePath(filePath)) return false
  return normalizeText(asset.kind) === 'output'
}

function filterSelectableProjectAssets(
  assets: ProjectAssetLike[],
  projectKeys: Set<string>
): ProjectAssetLike[] {
  return dedupeProjectAssets(
    assets.filter((asset) => {
      const taskId = normalizeText(asset.taskId)
      return projectKeys.has(taskId) && isSelectableProjectImageAsset(asset)
    })
  ).sort((left, right) => {
    return (
      normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt) ||
      normalizeTimestamp(right.createdAt) - normalizeTimestamp(left.createdAt) ||
      Number(right.sortOrder) - Number(left.sortOrder)
    )
  })
}

function toProjectMetaTask(task: ProjectTaskLike): {
  id: string
  productName: string
  sourceFolderPath: string | null
  metadata: Record<string, unknown>
} {
  return {
    id: normalizeText(task.id),
    productName: normalizeText(task.productName),
    sourceFolderPath: normalizeText(task.sourceFolderPath) || null,
    metadata: task.metadata && typeof task.metadata === 'object' ? { ...task.metadata } : {}
  }
}

function toProjectThumbnailAsset(asset: ProjectAssetLike): {
  id: string
  filePath: string
  previewPath: string | null
  createdAt: number
  updatedAt: number
  sortOrder: number
} {
  return {
    id: normalizeText(asset.id),
    filePath: normalizeText(asset.filePath),
    previewPath: normalizeText(asset.previewPath) || null,
    createdAt: normalizeTimestamp(asset.createdAt),
    updatedAt: normalizeTimestamp(asset.updatedAt),
    sortOrder: Number(asset.sortOrder) || 0
  }
}

export function buildTaskDetailProjectCards(input: {
  tasks: ProjectTaskLike[]
  assets: ProjectAssetLike[]
  trackedProjects?: TaskDetailTrackedProjectLike[]
}): TaskDetailProjectCard[] {
  const tasks = Array.isArray(input.tasks) ? input.tasks : []
  const assets = Array.isArray(input.assets) ? input.assets : []
  const trackedProjects = normalizeTrackedProjects(
    Array.isArray(input.trackedProjects) ? input.trackedProjects : []
  )
  const assetsByTaskId = new Map<string, ProjectAssetLike[]>()
  for (const asset of assets) {
    const taskId = normalizeText(asset.taskId)
    if (!taskId) continue
    const group = assetsByTaskId.get(taskId) ?? []
    group.push(asset)
    assetsByTaskId.set(taskId, group)
  }

  const cards = buildProjectCardSummaries({
    tasks: tasks.map((task) => ({
      id: normalizeText(task.id),
      productName: normalizeText(task.productName),
      status: normalizeText(task.status) || 'draft',
      sourceFolderPath: normalizeText(task.sourceFolderPath) || null,
      metadata: task.metadata && typeof task.metadata === 'object' ? { ...task.metadata } : {},
      createdAt: normalizeTimestamp(task.createdAt),
      updatedAt: normalizeTimestamp(task.updatedAt),
      outputAssets: (assetsByTaskId.get(normalizeText(task.id)) ?? [])
        .filter(
          (asset) => normalizeText(asset.kind) === 'output' && isSelectableProjectImageAsset(asset)
        )
        .map(toProjectThumbnailAsset)
    })),
    trackedProjects
  })

  return cards
    .map((card) => {
      const rootTask =
        tasks.find((task) => normalizeText(task.id) === normalizeText(card.taskId)) ?? null
      const projectMeta = readProjectMeta(rootTask ? toProjectMetaTask(rootTask) : null)
      const projectId = normalizeText(projectMeta?.projectId) || normalizeText(card.taskId)
      return {
        projectId,
        rootTaskId: normalizeText(card.taskId),
        title: normalizeText(card.title) || '未命名项目',
        updatedAt: normalizeTimestamp(card.updatedAt),
        updatedLabel: formatProjectUpdatedAt(normalizeTimestamp(card.updatedAt)),
        assetCount: Math.max(0, Number(card.outputCount) || 0),
        thumbnailPaths: Array.isArray(card.thumbnailPaths)
          ? card.thumbnailPaths.map((path) => normalizeText(path)).filter(Boolean)
          : []
      } satisfies TaskDetailProjectCard
    })
    .filter((card) => card.assetCount > 0)
}

export function listTaskDetailProjectSelectableAssets(input: {
  projectId: string
  rootTaskId: string
  tasks: ProjectTaskLike[]
  assets: ProjectAssetLike[]
}): ProjectAssetLike[] {
  const projectId = normalizeText(input.projectId)
  const rootTaskId = normalizeText(input.rootTaskId)
  if (!projectId && !rootTaskId) return []
  const projectTaskIds = new Set<string>()
  for (const task of Array.isArray(input.tasks) ? input.tasks : []) {
    const taskProjectId = resolveTaskProjectId(toProjectMetaTask(task))
    const taskRootTaskId = normalizeText(
      readProjectMeta(toProjectMetaTask(task))?.projectRootTaskId
    )
    if (taskProjectId === projectId || taskRootTaskId === rootTaskId) {
      projectTaskIds.add(normalizeText(task.id))
    }
  }
  return filterSelectableProjectAssets(
    Array.isArray(input.assets) ? input.assets : [],
    projectTaskIds
  )
}

export function applyTaskDetailVideoCover(
  draftImages: string[],
  nextCoverPath: string
): {
  draftImages: string[]
  videoCoverMode: 'manual'
} {
  const nextCover = normalizeText(nextCoverPath)
  if (!nextCover) {
    return {
      draftImages: Array.isArray(draftImages) ? [...draftImages] : [],
      videoCoverMode: 'manual'
    }
  }

  const nextImages = Array.isArray(draftImages) ? [...draftImages] : []
  if (nextImages.length === 0) {
    nextImages.push(nextCover)
  } else {
    nextImages[0] = nextCover
  }

  return {
    draftImages: nextImages,
    videoCoverMode: 'manual'
  }
}
