import type { AiStudioAssetRecord, AiStudioTaskView } from './useAiStudioState'

const AI_STUDIO_MASTER_CLEAN_ROLE = 'master-clean'
const AI_STUDIO_CHILD_OUTPUT_ROLE = 'child-output'
const AI_STUDIO_VIDEO_OUTPUT_ROLE = 'video-output'

function normalizeAssetPath(filePath: string | null | undefined): string {
  return String(filePath ?? '').trim()
}

function selectDispatchOutputAssets(
  task: Pick<AiStudioTaskView, 'outputAssets'>
): AiStudioAssetRecord[] {
  const videoOutputAssets = task.outputAssets.filter(
    (asset) => asset.role === AI_STUDIO_VIDEO_OUTPUT_ROLE
  )
  if (videoOutputAssets.length > 0) return videoOutputAssets

  const childOutputAssets = task.outputAssets.filter(
    (asset) => asset.role === AI_STUDIO_CHILD_OUTPUT_ROLE
  )
  if (childOutputAssets.length > 0) return childOutputAssets

  return task.outputAssets.filter((asset) => asset.role === AI_STUDIO_MASTER_CLEAN_ROLE)
}

export function buildBatchPickAssets(historyTasks: AiStudioTaskView[]): AiStudioAssetRecord[] {
  const seen = new Set<string>()
  const next: AiStudioAssetRecord[] = []

  historyTasks.forEach((task) => {
    selectDispatchOutputAssets(task)
      .filter((asset) => /\.(jpg|jpeg|png|webp|heic)$/i.test(String(asset.filePath ?? '').trim()))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt)
      .forEach((asset) => {
        const dedupeKey = normalizeAssetPath(asset.filePath ?? asset.previewPath)
        if (!dedupeKey || seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        next.push(asset)
      })
  })

  return next
}

export function resolveUsedBatchPickAssetIds(
  batchPickAssets: Array<Pick<AiStudioAssetRecord, 'id' | 'filePath' | 'previewPath'>>,
  noteMaterials: Array<Pick<AiStudioAssetRecord, 'filePath' | 'previewPath'>>
): string[] {
  const usedPaths = new Set(
    noteMaterials
      .map((asset) => normalizeAssetPath(asset.filePath || asset.previewPath))
      .filter(Boolean)
  )

  return batchPickAssets
    .filter((asset) => usedPaths.has(normalizeAssetPath(asset.filePath || asset.previewPath)))
    .map((asset) => asset.id)
}

export function pruneBatchPickSelection({
  selectedAssetIds,
  availableAssetIds,
  usedAssetIds
}: {
  selectedAssetIds: string[]
  availableAssetIds: string[]
  usedAssetIds: string[]
}): string[] {
  const availableIds = new Set(availableAssetIds.map((assetId) => String(assetId ?? '').trim()))
  const blockedIds = new Set(usedAssetIds.map((assetId) => String(assetId ?? '').trim()))

  return selectedAssetIds.filter((assetId) => {
    const normalizedId = String(assetId ?? '').trim()
    if (!normalizedId) return false
    if (!availableIds.has(normalizedId)) return false
    return !blockedIds.has(normalizedId)
  })
}

export function buildSelectableBatchPickAssetIds({
  assets,
  usedAssetIds
}: {
  assets: Array<Pick<AiStudioAssetRecord, 'id'>>
  usedAssetIds: string[]
}): string[] {
  const blockedIds = new Set(usedAssetIds.map((assetId) => String(assetId ?? '').trim()))

  return assets
    .map((asset) => String(asset.id ?? '').trim())
    .filter((assetId) => assetId && !blockedIds.has(assetId))
}
