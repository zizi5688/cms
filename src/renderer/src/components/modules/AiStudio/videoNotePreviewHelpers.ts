import { generateOneToOneVideoManifest } from '../../../lib/cms-engine.ts'
import type { Task } from '../../../store/useCmsStore.ts'

export type GeneratedVideoNoteAsset = {
  videoPath: string
  previewPath?: string
  coverImagePath?: string
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildGeneratedVideoNotePreviewTasks(
  csvText: string,
  assets: GeneratedVideoNoteAsset[]
): Task[] {
  const normalizedAssets = assets
    .map((asset) => ({
      videoPath: trimText(asset.videoPath),
      previewPath: trimText(asset.previewPath),
      coverImagePath: trimText(asset.coverImagePath)
    }))
    .filter((asset) => asset.videoPath)

  const baseTasks = generateOneToOneVideoManifest(
    csvText,
    normalizedAssets.map((asset) => asset.videoPath)
  )

  return baseTasks.map((task, index) => {
    const asset = normalizedAssets[index]
    const coverImagePath = asset?.coverImagePath ?? ''
    const previewPath = asset?.previewPath ?? ''

    return {
      ...task,
      assignedImages: coverImagePath ? [coverImagePath] : [],
      videoPreviewPath: previewPath || undefined,
      videoCoverMode: 'auto'
    }
  })
}
