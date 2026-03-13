type WorkflowSourceTaskLike = {
  primaryImagePath: string | null
  referenceImagePaths: string[]
  metadata: Record<string, unknown>
}

export type AiStudioWorkflowSourceDescriptor = {
  activeStage: string
  currentAiMasterAssetId: string | null
  sourcePrimaryImagePath: string | null
  sourceReferenceImagePaths: string[]
  useCurrentAiMasterAsPrimary: boolean
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized || null
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => normalizeText(item)).filter(Boolean)))
}

export function readWorkflowSourceDescriptor(
  task: WorkflowSourceTaskLike
): AiStudioWorkflowSourceDescriptor {
  const metadata = asObject(task.metadata)
  const workflow = asObject(metadata.workflow)
  const activeStage = normalizeText(workflow.activeStage)
  const useCurrentAiMasterAsPrimary =
    activeStage === 'child-ready' ||
    activeStage === 'child-generating' ||
    activeStage === 'completed'
  const metadataPrimaryImagePath = normalizeNullableText(workflow.sourcePrimaryImagePath)
  const metadataReferencePaths = normalizeStringArray(workflow.sourceReferenceImagePaths)

  return {
    activeStage,
    currentAiMasterAssetId: useCurrentAiMasterAsPrimary
      ? normalizeNullableText(workflow.currentAiMasterAssetId)
      : null,
    sourcePrimaryImagePath: metadataPrimaryImagePath ?? normalizeNullableText(task.primaryImagePath),
    sourceReferenceImagePaths:
      metadataReferencePaths.length > 0
        ? metadataReferencePaths
        : normalizeStringArray(task.referenceImagePaths),
    useCurrentAiMasterAsPrimary
  }
}
