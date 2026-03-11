type WorkflowLike = {
  workflow: {
    activeStage: string
    sourcePrimaryImagePath: string | null
    sourceReferenceImagePaths: string[]
    currentAiMasterAssetId: string | null
    currentItemKind: string
    currentItemIndex: number
    currentItemTotal: number
    failures: unknown[]
  }
  masterStage: {
    templateId: string | null
    promptExtra: string
    requestedCount: number
    completedCount: number
    cleanSuccessCount: number
    cleanFailedCount: number
  }
  childStage: {
    templateId: string | null
    promptExtra: string
    requestedCount: number
    completedCount: number
    failedCount: number
  }
}

type PrepareWorkflowForMasterRunInput = {
  promptText: string
  templateId: string | null
  requestedCount: number
  primaryImagePath: string | null
  referenceImagePaths: string[]
}

type PreviewTargetCountInput = {
  isRunning: boolean
  currentItemTotal: number
  expectedOutputCount: number
  generatedCount: number
  maxFailureIndex: number
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function normalizeRequestedCount(value: number, fallback = 1): number {
  return Math.max(1, Math.floor(Number(value) || fallback || 1))
}

export function prepareWorkflowForMasterRun<T extends WorkflowLike>(
  workflow: T,
  input: PrepareWorkflowForMasterRunInput
): T {
  const requestedCount = normalizeRequestedCount(input.requestedCount)

  return {
    ...workflow,
    workflow: {
      ...workflow.workflow,
      activeStage: 'master-generating',
      sourcePrimaryImagePath: input.primaryImagePath ?? null,
      sourceReferenceImagePaths: uniqueStrings(input.referenceImagePaths),
      currentAiMasterAssetId: null,
      currentItemKind: 'master-generate',
      currentItemIndex: 0,
      currentItemTotal: requestedCount,
      failures: []
    },
    masterStage: {
      ...workflow.masterStage,
      templateId: input.templateId,
      promptExtra: input.promptText,
      requestedCount,
      completedCount: 0,
      cleanSuccessCount: 0,
      cleanFailedCount: 0
    },
    childStage: {
      ...workflow.childStage,
      templateId: input.templateId,
      promptExtra: input.promptText,
      requestedCount,
      completedCount: 0,
      failedCount: 0
    }
  }
}

export function computePreviewTargetCount(input: PreviewTargetCountInput): number {
  const baseCount = input.isRunning
    ? Math.max(
        input.currentItemTotal || 0,
        input.expectedOutputCount || 0,
        input.generatedCount,
        input.maxFailureIndex,
        1
      )
    : Math.max(input.generatedCount, input.expectedOutputCount || 0, input.maxFailureIndex, 1)

  return Math.max(baseCount, 0)
}
