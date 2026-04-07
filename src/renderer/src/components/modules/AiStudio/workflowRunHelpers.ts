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

export type PreviewSlotRuntimeStateRecord = {
  status: 'queued'
  message: '排队中'
}

export type MasterSlotResult<TFailure = unknown> = {
  sequenceIndex: number
  generated: boolean
  cleaned: boolean
  cleanFailed: boolean
  failure: TFailure | null
}

export type MasterWorkflowExecutionMode =
  | 'parallel_single_output'
  | 'single_run_multi_output'

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function normalizeRequestedCount(value: number, fallback = 1): number {
  return Math.max(1, Math.floor(Number(value) || fallback || 1))
}

function normalizeFlowIdentifier(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function resolveMasterWorkflowConcurrency(
  requestedCount: number,
  maxConcurrency = 10
): number {
  return Math.min(
    normalizeRequestedCount(requestedCount),
    normalizeRequestedCount(maxConcurrency)
  )
}

export function resolveMasterWorkflowExecutionMode(input: {
  requestedCount: number
  modelName?: string | null
  endpointPath?: string | null
}): MasterWorkflowExecutionMode {
  const requestedCount = normalizeRequestedCount(input.requestedCount)
  if (requestedCount <= 1) {
    return 'parallel_single_output'
  }

  const normalizedModelName = normalizeFlowIdentifier(input.modelName)
  const normalizedEndpointPath = normalizeFlowIdentifier(input.endpointPath)
  const isFlowWebApi =
    normalizedModelName === 'flow-web-image' ||
    normalizedEndpointPath === '/v1beta/models/flow-web-image:generatecontent'

  return isFlowWebApi ? 'single_run_multi_output' : 'parallel_single_output'
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

export function buildQueuedPreviewSlotRuntimeStates(
  requestedCount: number
): Record<number, PreviewSlotRuntimeStateRecord> {
  const normalizedCount = normalizeRequestedCount(requestedCount)
  return Object.fromEntries(
    Array.from({ length: normalizedCount }, (_, slotIndex) => [
      slotIndex + 1,
      {
        status: 'queued',
        message: '排队中'
      } satisfies PreviewSlotRuntimeStateRecord
    ])
  )
}

export function summarizeMasterSlotResults<TFailure>(
  results: Array<MasterSlotResult<TFailure>>
): {
  completedCount: number
  cleanSuccessCount: number
  cleanFailedCount: number
  failures: TFailure[]
} {
  return {
    completedCount: results.filter((item) => item.generated).length,
    cleanSuccessCount: results.filter((item) => item.cleaned).length,
    cleanFailedCount: results.filter((item) => item.cleanFailed).length,
    failures: results
      .map((item) => item.failure)
      .filter((item): item is TFailure => item != null)
  }
}
