const SUPPORTED_PROJECT_ASSET_IMAGE_PATTERN = /\.(jpg|jpeg|png|webp|heic)$/i

export const AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE = 'project-library-image'

type ProjectAssetLike = {
  id?: string
  taskId?: string
  role?: string
  filePath?: string
  previewPath?: string | null
  originPath?: string | null
  metadata?: Record<string, unknown>
  createdAt?: number
  sortOrder?: number
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function createProjectAssetId(projectTaskId: string, filePath: string): string {
  const normalizedFilePath = normalizeText(filePath).toLowerCase()
  let hash = 0
  for (const char of normalizedFilePath) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return `${projectTaskId}:project-asset:${hash.toString(16)}`
}

function createProjectAssetWrite(input: {
  projectTaskId: string
  id?: string
  filePath: string
  previewPath?: string | null
  originPath?: string | null
  metadata?: Record<string, unknown>
  sortOrder?: number
}): {
  id: string
  taskId: string
  kind: 'input'
  role: string
  filePath: string
  previewPath: string
  originPath: string
  sortOrder: number
  metadata: Record<string, unknown>
} {
  const filePath = normalizeText(input.filePath)
  const previewPath = normalizeText(input.previewPath) || filePath
  const originPath = normalizeText(input.originPath) || filePath
  return {
    id: normalizeText(input.id) || createProjectAssetId(input.projectTaskId, filePath),
    taskId: input.projectTaskId,
    kind: 'input',
    role: AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
    filePath,
    previewPath,
    originPath,
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
    metadata: { ...(input.metadata ?? {}) }
  }
}

export function isSupportedProjectAssetImagePath(filePath: string): boolean {
  return SUPPORTED_PROJECT_ASSET_IMAGE_PATTERN.test(normalizeText(filePath))
}

export function listProjectAssetLibrary<T extends ProjectAssetLike>(input: {
  projectTaskId: string
  assets: T[]
}): T[] {
  const projectTaskId = normalizeText(input.projectTaskId)
  if (!projectTaskId) return []

  return (Array.isArray(input.assets) ? input.assets : [])
    .filter(
      (asset) =>
        normalizeText(asset?.taskId) === projectTaskId &&
        normalizeText(asset?.role) === AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE &&
        isSupportedProjectAssetImagePath(normalizeText(asset?.filePath))
    )
    .sort((left, right) => (Number(right?.createdAt) || 0) - (Number(left?.createdAt) || 0))
}

export function buildProjectAssetLibraryUpserts(input: {
  projectTaskId: string
  filePaths: string[]
  existingAssets?: ProjectAssetLike[]
  now?: number
}): Array<{
  id: string
  taskId: string
  kind: 'input'
  role: string
  filePath: string
  previewPath: string
  originPath: string
  sortOrder: number
  metadata: Record<string, unknown>
}> {
  const projectTaskId = normalizeText(input.projectTaskId)
  if (!projectTaskId) return []

  const existingPaths = new Set(
    listProjectAssetLibrary({
      projectTaskId,
      assets: Array.isArray(input.existingAssets) ? input.existingAssets : []
    }).map((asset) => normalizeText(asset.filePath).toLowerCase())
  )

  const nextPaths: string[] = []
  const seenIncoming = new Set<string>()

  for (const rawPath of Array.isArray(input.filePaths) ? input.filePaths : []) {
    const filePath = normalizeText(rawPath)
    const dedupeKey = filePath.toLowerCase()
    if (!filePath || seenIncoming.has(dedupeKey) || existingPaths.has(dedupeKey)) continue
    if (!isSupportedProjectAssetImagePath(filePath)) continue
    seenIncoming.add(dedupeKey)
    nextPaths.push(filePath)
  }

  const importedAt = Number.isFinite(input.now) ? Number(input.now) : Date.now()

  return nextPaths.map((filePath, index) =>
    createProjectAssetWrite({
      projectTaskId,
      filePath,
      previewPath: filePath,
      originPath: filePath,
      sortOrder: index,
      metadata: {
        importedAt,
        library: 'project'
      }
    })
  )
}

export function buildProjectAssetFavoriteUpsert(input: {
  projectTaskId: string
  asset: ProjectAssetLike | null | undefined
  existingAssets?: ProjectAssetLike[]
  now?: number
}): {
  id: string
  taskId: string
  kind: 'input'
  role: string
  filePath: string
  previewPath: string
  originPath: string
  sortOrder: number
  metadata: Record<string, unknown>
} | null {
  const projectTaskId = normalizeText(input.projectTaskId)
  const filePath = normalizeText(input.asset?.filePath)
  if (!projectTaskId || !filePath || !isSupportedProjectAssetImagePath(filePath)) return null

  const existingAsset =
    listProjectAssetLibrary({
      projectTaskId,
      assets: Array.isArray(input.existingAssets) ? input.existingAssets : []
    }).find((asset) => normalizeText(asset.filePath).toLowerCase() === filePath.toLowerCase()) ??
    null

  const importedAt =
    Number(existingAsset?.metadata?.importedAt) ||
    (Number.isFinite(input.now) ? Number(input.now) : Date.now())

  return createProjectAssetWrite({
    projectTaskId,
    id: existingAsset?.id,
    filePath,
    previewPath:
      normalizeText(input.asset?.previewPath) ||
      normalizeText(existingAsset?.previewPath) ||
      filePath,
    originPath:
      normalizeText(input.asset?.originPath) ||
      normalizeText(existingAsset?.originPath) ||
      filePath,
    sortOrder: Number.isFinite(existingAsset?.sortOrder) ? Number(existingAsset?.sortOrder) : 0,
    metadata: {
      ...(existingAsset?.metadata ?? {}),
      importedAt,
      library: 'project',
      favorite: true
    }
  })
}
