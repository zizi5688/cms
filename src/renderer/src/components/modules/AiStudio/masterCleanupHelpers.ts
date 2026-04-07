type MasterCleanupAssetLike = {
  id: string
  taskId: string
  runId: string | null
  kind: 'input' | 'output'
  role: string
  filePath: string
  previewPath: string | null
  originPath: string | null
  selected: boolean
  sortOrder: number
  metadata: Record<string, unknown>
}

type MasterSlotBindingLike = Pick<
  MasterCleanupAssetLike,
  'id' | 'taskId' | 'sortOrder' | 'selected'
> | null

export function bindMasterGeneratedAssetsToSlots(
  rawAssets: MasterCleanupAssetLike[],
  existingSlotBindings: MasterSlotBindingLike[]
): MasterCleanupAssetLike[] {
  return rawAssets.map((rawAsset, index) =>
    bindMasterGeneratedAssetToSlot(rawAsset, index + 1, existingSlotBindings[index] ?? null)
  )
}

export function bindMasterGeneratedAssetToSlot(
  rawAsset: MasterCleanupAssetLike,
  sequenceIndex: number,
  existingSlotBinding: MasterSlotBindingLike
): MasterCleanupAssetLike {
  const rawMetadata =
    rawAsset.metadata && typeof rawAsset.metadata === 'object'
      ? (rawAsset.metadata as Record<string, unknown>)
      : {}

  return {
    ...rawAsset,
    id: existingSlotBinding?.id ?? rawAsset.id,
    taskId: existingSlotBinding?.taskId ?? rawAsset.taskId,
    kind: 'output',
    role: 'master-raw',
    selected: existingSlotBinding?.selected ?? rawAsset.selected,
    sortOrder: existingSlotBinding?.sortOrder ?? Math.max(0, sequenceIndex - 1),
    metadata: {
      ...rawMetadata,
      stage: 'master',
      sequenceIndex,
      outputIndex: 0,
      watermarkStatus: 'pending'
    }
  }
}

export function buildSkippedMasterCleanupAssets(
  rawAsset: MasterCleanupAssetLike,
  sequenceIndex: number
): [MasterCleanupAssetLike, MasterCleanupAssetLike] {
  const rawMetadata =
    rawAsset.metadata && typeof rawAsset.metadata === 'object'
      ? (rawAsset.metadata as Record<string, unknown>)
      : {}

  return [
    {
      ...rawAsset,
      metadata: {
        ...rawMetadata,
        stage: 'master',
        sequenceIndex,
        watermarkStatus: 'skipped',
        localCleanupSkipped: true
      }
    },
    {
      id: `${rawAsset.id}:clean`,
      taskId: rawAsset.taskId,
      runId: rawAsset.runId,
      kind: 'output',
      role: 'master-clean',
      filePath: rawAsset.filePath,
      previewPath: rawAsset.previewPath ?? rawAsset.filePath,
      originPath: rawAsset.filePath,
      selected: false,
      sortOrder: rawAsset.sortOrder,
      metadata: {
        stage: 'master',
        sequenceIndex,
        sourceAssetId: rawAsset.id,
        watermarkStatus: 'skipped',
        localCleanupSkipped: true
      }
    }
  ]
}
