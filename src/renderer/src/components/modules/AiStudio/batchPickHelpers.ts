import {
  selectDispatchOutputAssets,
  type AiStudioAssetRecord,
  type AiStudioTaskView
} from './useAiStudioState'

export function buildBatchPickAssets(historyTasks: AiStudioTaskView[]): AiStudioAssetRecord[] {
  const seen = new Set<string>()
  const next: AiStudioAssetRecord[] = []

  historyTasks.forEach((task) => {
    selectDispatchOutputAssets(task)
      .filter((asset) => /\.(jpg|jpeg|png|webp|heic)$/i.test(String(asset.filePath ?? '').trim()))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt)
      .forEach((asset) => {
        const dedupeKey = String(asset.filePath ?? asset.previewPath ?? '').trim()
        if (!dedupeKey || seen.has(dedupeKey)) return
        seen.add(dedupeKey)
        next.push(asset)
      })
  })

  return next
}
