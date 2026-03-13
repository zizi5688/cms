import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  AI_VIDEO_PROFILES,
  DEFAULT_AI_VIDEO_PROFILE_ID,
  getAiVideoProfile,
  normalizeVideoDurationForModel,
  type AiStudioCapability,
  type AiStudioVideoMode,
  type AiVideoAdapterKind,
  type AiVideoAspectRatio,
  type AiVideoDuration,
  type AiVideoResolution
} from '@renderer/lib/aiVideoProfiles'
import {
  buildVideoEndpointPair,
  findAiProviderProfile,
  normalizeAiProviderValue,
  resolveAiTaskProviderSelection
} from '@renderer/lib/aiProviderProfiles'
import { DEFAULT_GRSAI_IMAGE_MODEL } from '@renderer/lib/grsaiModels'
import { useCmsStore } from '@renderer/store/useCmsStore'

import { runWithConcurrencyLimit } from './parallelRunHelpers'
import type { PreviewSlotRuntimeState } from './previewSlotHelpers'
import {
  bindMasterGeneratedAssetToSlot,
  buildSkippedMasterCleanupAssets
} from './masterCleanupHelpers'
import { findAbandonedPreSubmitTaskIds } from './staleTaskRecoveryHelpers'
import {
  buildQueuedPreviewSlotRuntimeStates,
  prepareWorkflowForMasterRun,
  resolveMasterWorkflowConcurrency,
  summarizeMasterSlotResults
} from './workflowRunHelpers'
import { buildPoolDispatchPlan } from './poolDispatchHelpers'

export type AiStudioImportedFolder = {
  folderPath: string
  productName: string
  imageFilePaths: string[]
}

export type AiStudioTemplateRecord = {
  id: string
  provider: string
  capability: AiStudioCapability
  name: string
  promptText: string
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type AiStudioTaskRecord = {
  id: string
  templateId: string | null
  provider: string
  sourceFolderPath: string | null
  productName: string
  status: 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'archived'
  aspectRatio: string
  outputCount: number
  model: string
  promptExtra: string
  primaryImagePath: string | null
  referenceImagePaths: string[]
  inputImagePaths: string[]
  remoteTaskId: string | null
  latestRunId: string | null
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
  billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type AiStudioAssetRecord = {
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
  createdAt: number
  updatedAt: number
}

export type AiStudioRunRecord = {
  id: string
  taskId: string
  runIndex: number
  provider: string
  status: string
  remoteTaskId: string | null
  billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
  runDir: string | null
  requestPayload: Record<string, unknown>
  responsePayload: Record<string, unknown>
  errorMessage: string | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

export type AiStudioTaskStatusFilter = 'all' | 'draft' | 'running' | 'failed' | 'completed'

export type AiStudioTaskView = AiStudioTaskRecord & {
  inputAssets: AiStudioAssetRecord[]
  outputAssets: AiStudioAssetRecord[]
  costLabel: string
  sourceCount: number
}

export type AiStudioBatchCostSummary = {
  min: number
  max: number
  label: string
}

export const MAX_AI_STUDIO_REFERENCE_IMAGES = 4

export type AiStudioWorkflowStage =
  | 'master-setup'
  | 'master-generating'
  | 'master-cleaning'
  | 'master-selecting'
  | 'child-ready'
  | 'child-generating'
  | 'completed'

export type AiStudioWorkflowFailureRecord = {
  id: string
  stageKind: 'master-generate' | 'master-clean' | 'child-generate'
  sequenceIndex: number
  message: string
  assetId?: string
  runId?: string
  createdAt: number
}

export type AiStudioWorkflowMetadata = {
  workflow: {
    mode: 'two-stage'
    activeStage: AiStudioWorkflowStage
    sourcePrimaryImagePath: string | null
    sourceReferenceImagePaths: string[]
    currentAiMasterAssetId: string | null
    requireCleanMasterBeforeChild: true
    skipFailedChildRuns: true
    currentItemKind: 'idle' | 'master-generate' | 'master-clean' | 'child-generate'
    currentItemIndex: number
    currentItemTotal: number
    failures: AiStudioWorkflowFailureRecord[]
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
    variantLines: string[]
    completedCount: number
    failedCount: number
  }
}

export type AiStudioStageProgress = {
  stage: AiStudioWorkflowStage
  currentLabel: string
  currentIndex: number
  currentTotal: number
  totalCompleted: number
  totalPlanned: number
  successCount: number
  failureCount: number
}

export type AiStudioVideoFailureRecord = {
  id: string
  sequenceIndex: number
  message: string
  detail?: string
  runId?: string
  createdAt: number
}

export type AiStudioVideoMetadata = {
  capability: 'video'
  profileId: string
  model: string
  adapterKind: AiVideoAdapterKind
  submitPath: string
  queryPath: string
  mode: AiStudioVideoMode
  subjectReferencePath: string | null
  firstFramePath: string | null
  lastFramePath: string | null
  aspectRatio: AiVideoAspectRatio
  resolution: AiVideoResolution
  duration: AiVideoDuration
  outputCount: number
  completedCount: number
  failedCount: number
  currentItemIndex: number
  currentItemTotal: number
  failures: AiStudioVideoFailureRecord[]
}

const AI_STUDIO_MASTER_OUTPUT_ROLE = 'master-raw'
const AI_STUDIO_MASTER_CLEAN_ROLE = 'master-clean'
const AI_STUDIO_CHILD_OUTPUT_ROLE = 'child-output'
const AI_STUDIO_VIDEO_OUTPUT_ROLE = 'video-output'
const AI_STUDIO_SOURCE_PRIMARY_ROLE = 'source-primary'
const AI_STUDIO_SOURCE_REFERENCE_ROLE = 'source-reference'
const AI_STUDIO_VIDEO_SUBJECT_REFERENCE_ROLE = 'video-subject-reference'
const AI_STUDIO_VIDEO_FIRST_FRAME_ROLE = 'video-first-frame'
const AI_STUDIO_VIDEO_LAST_FRAME_ROLE = 'video-last-frame'

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function basenameWithoutExtension(filePath: string): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return ''
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  const fileName = parts[parts.length - 1] ?? normalized
  return fileName.replace(/\.[^.]+$/, '').trim()
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function normalizeReferencePaths(filePaths: string[], primaryImagePath: string | null): string[] {
  return uniqueStrings(filePaths)
    .filter((item) => item !== primaryImagePath)
    .slice(0, MAX_AI_STUDIO_REFERENCE_IMAGES)
}

function normalizeVariantLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function normalizeVideoMode(value: unknown, fallback: AiStudioVideoMode): AiStudioVideoMode {
  return value === 'first-last-frame' || value === 'subject-reference' ? value : fallback
}

function normalizeVideoAspectRatio(
  value: unknown,
  fallback: AiVideoAspectRatio
): AiVideoAspectRatio {
  return value === '16:9' || value === '9:16' || value === '1:1' ? value : fallback
}

function normalizeVideoResolution(value: unknown, fallback: AiVideoResolution): AiVideoResolution {
  return value === '1080p' || value === '720p' ? value : fallback
}

function normalizeVideoDuration(value: unknown, fallback: AiVideoDuration): AiVideoDuration {
  const numeric = Number(value)
  return numeric === 8 ? 8 : numeric === 5 ? 5 : fallback
}

function normalizePositiveInteger(value: unknown, fallback: number, max?: number): number {
  const numeric = Number(value)
  const normalized = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback
  if (typeof max === 'number' && Number.isFinite(max)) {
    return Math.max(1, Math.min(max, normalized))
  }
  return Math.max(1, normalized)
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0
}

export function readTaskCapability(
  task: Pick<AiStudioTaskRecord, 'metadata'> | null | undefined
): AiStudioCapability {
  const metadata = task?.metadata && typeof task.metadata === 'object' ? task.metadata : {}
  return metadata.capability === 'video' ? 'video' : 'image'
}

function stripImageWorkflowMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const next = metadata && typeof metadata === 'object' ? { ...metadata } : {}
  delete next.workflow
  delete next.masterStage
  delete next.childStage
  delete next.mode
  if (next.capability === 'image') delete next.capability
  return next
}

function stripVideoMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const next = metadata && typeof metadata === 'object' ? { ...metadata } : {}
  delete next.video
  if (next.capability === 'video') delete next.capability
  return next
}

function createDefaultVideoMetadata(profileId?: string | null): AiStudioVideoMetadata {
  const profile = getAiVideoProfile(profileId ?? DEFAULT_AI_VIDEO_PROFILE_ID)
  return {
    capability: 'video',
    profileId: profile.id,
    model: profile.modelId,
    adapterKind: profile.adapterKind,
    submitPath: profile.submitPath,
    queryPath: profile.queryPath,
    mode: profile.defaultMode,
    subjectReferencePath: null,
    firstFramePath: null,
    lastFramePath: null,
    aspectRatio: profile.defaultAspectRatio,
    resolution: profile.defaultResolution,
    duration: normalizeVideoDurationForModel(
      profile.defaultDuration,
      profile.modelId,
      profile.defaultDuration
    ),
    outputCount: 1,
    completedCount: 0,
    failedCount: 0,
    currentItemIndex: 0,
    currentItemTotal: 0,
    failures: []
  }
}

export function readVideoMetadata(
  task: Pick<AiStudioTaskRecord, 'metadata'> | null | undefined
): AiStudioVideoMetadata {
  const metadata = task?.metadata && typeof task.metadata === 'object' ? task.metadata : {}
  const record =
    metadata.video && typeof metadata.video === 'object'
      ? (metadata.video as Record<string, unknown>)
      : {}
  const profile = getAiVideoProfile(
    typeof record.profileId === 'string' ? record.profileId : undefined
  )
  const base = createDefaultVideoMetadata(profile.id)
  const model = String(record.model ?? '').trim() || base.model

  return {
    capability: 'video',
    profileId: typeof record.profileId === 'string' ? record.profileId : base.profileId,
    model,
    adapterKind: record.adapterKind === 'allapi-unified' ? 'allapi-unified' : base.adapterKind,
    submitPath: String(record.submitPath ?? '').trim() || base.submitPath,
    queryPath: String(record.queryPath ?? '').trim() || base.queryPath,
    mode: normalizeVideoMode(record.mode, base.mode),
    subjectReferencePath:
      typeof record.subjectReferencePath === 'string' && record.subjectReferencePath.trim()
        ? record.subjectReferencePath.trim()
        : null,
    firstFramePath:
      typeof record.firstFramePath === 'string' && record.firstFramePath.trim()
        ? record.firstFramePath.trim()
        : null,
    lastFramePath:
      typeof record.lastFramePath === 'string' && record.lastFramePath.trim()
        ? record.lastFramePath.trim()
        : null,
    aspectRatio: normalizeVideoAspectRatio(record.aspectRatio, base.aspectRatio),
    resolution: normalizeVideoResolution(record.resolution, base.resolution),
    duration: normalizeVideoDurationForModel(
      normalizeVideoDuration(record.duration, base.duration),
      model,
      base.duration
    ),
    outputCount: normalizePositiveInteger(record.outputCount, base.outputCount, 4),
    completedCount: normalizeNonNegativeInteger(record.completedCount),
    failedCount: normalizeNonNegativeInteger(record.failedCount),
    currentItemIndex: normalizeNonNegativeInteger(record.currentItemIndex),
    currentItemTotal: normalizeNonNegativeInteger(record.currentItemTotal),
    failures: Array.isArray(record.failures)
      ? record.failures
          .map((item, index) => {
            const failure =
              item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
            const display = normalizeVideoFailureDisplay(
              String(failure.message ?? '').trim(),
              typeof failure.detail === 'string' ? failure.detail : undefined
            )
            return {
              id: String(failure.id ?? `video-failure-${index}`),
              sequenceIndex: normalizePositiveInteger(failure.sequenceIndex, index + 1),
              message: display.message,
              detail: display.detail,
              runId: typeof failure.runId === 'string' ? failure.runId : undefined,
              createdAt: typeof failure.createdAt === 'number' ? failure.createdAt : Date.now()
            } satisfies AiStudioVideoFailureRecord
          })
          .filter((item) => item.message)
      : []
  }
}

function writeVideoMetadata(
  task: Pick<AiStudioTaskRecord, 'metadata'>,
  nextVideo: AiStudioVideoMetadata
): Record<string, unknown> {
  const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {}
  return {
    ...stripImageWorkflowMetadata(metadata),
    capability: 'video',
    video: nextVideo
  }
}

export function selectDispatchOutputAssets(
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

function readAssetSequenceIndex(
  asset: Pick<AiStudioAssetRecord, 'sortOrder' | 'metadata'> | null | undefined
): number {
  if (!asset) return 0
  const metadata =
    asset.metadata && typeof asset.metadata === 'object'
      ? (asset.metadata as Record<string, unknown>)
      : {}
  const rawIndex = metadata.sequenceIndex
  const numericIndex =
    typeof rawIndex === 'number' && Number.isFinite(rawIndex)
      ? rawIndex
      : Number.parseInt(String(rawIndex ?? ''), 10)

  if (Number.isFinite(numericIndex) && numericIndex > 0) {
    return Math.max(1, Math.floor(numericIndex))
  }

  return Math.max(1, asset.sortOrder + 1)
}

function createDefaultWorkflowMetadata(
  task: Pick<
    AiStudioTaskRecord,
    'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths'
  >
): AiStudioWorkflowMetadata {
  return {
    workflow: {
      mode: 'two-stage',
      activeStage: 'master-setup',
      sourcePrimaryImagePath: task.primaryImagePath ?? null,
      sourceReferenceImagePaths: uniqueStrings(task.referenceImagePaths ?? []),
      currentAiMasterAssetId: null,
      requireCleanMasterBeforeChild: true,
      skipFailedChildRuns: true,
      currentItemKind: 'idle',
      currentItemIndex: 0,
      currentItemTotal: 0,
      failures: []
    },
    masterStage: {
      templateId: task.templateId ?? null,
      promptExtra: task.promptExtra ?? '',
      requestedCount: 3,
      completedCount: 0,
      cleanSuccessCount: 0,
      cleanFailedCount: 0
    },
    childStage: {
      templateId: task.templateId ?? null,
      promptExtra: '',
      requestedCount: 4,
      variantLines: [],
      completedCount: 0,
      failedCount: 0
    }
  }
}

export function readWorkflowMetadata(
  task: Pick<
    AiStudioTaskRecord,
    'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths' | 'metadata'
  >
): AiStudioWorkflowMetadata {
  const metadata =
    task.metadata && typeof task.metadata === 'object'
      ? (task.metadata as Record<string, unknown>)
      : {}
  const workflowRecord =
    metadata.workflow && typeof metadata.workflow === 'object'
      ? (metadata.workflow as Record<string, unknown>)
      : {}
  const masterRecord =
    metadata.masterStage && typeof metadata.masterStage === 'object'
      ? (metadata.masterStage as Record<string, unknown>)
      : {}
  const childRecord =
    metadata.childStage && typeof metadata.childStage === 'object'
      ? (metadata.childStage as Record<string, unknown>)
      : {}
  const base = createDefaultWorkflowMetadata(task)

  return {
    workflow: {
      mode: 'two-stage',
      activeStage:
        workflowRecord.activeStage === 'master-generating' ||
        workflowRecord.activeStage === 'master-cleaning' ||
        workflowRecord.activeStage === 'master-selecting' ||
        workflowRecord.activeStage === 'child-ready' ||
        workflowRecord.activeStage === 'child-generating' ||
        workflowRecord.activeStage === 'completed'
          ? (workflowRecord.activeStage as AiStudioWorkflowStage)
          : base.workflow.activeStage,
      sourcePrimaryImagePath:
        typeof workflowRecord.sourcePrimaryImagePath === 'string'
          ? workflowRecord.sourcePrimaryImagePath
          : base.workflow.sourcePrimaryImagePath,
      sourceReferenceImagePaths: Array.isArray(workflowRecord.sourceReferenceImagePaths)
        ? uniqueStrings(workflowRecord.sourceReferenceImagePaths as string[])
        : base.workflow.sourceReferenceImagePaths,
      currentAiMasterAssetId:
        typeof workflowRecord.currentAiMasterAssetId === 'string'
          ? workflowRecord.currentAiMasterAssetId
          : base.workflow.currentAiMasterAssetId,
      requireCleanMasterBeforeChild: true,
      skipFailedChildRuns: true,
      currentItemKind:
        workflowRecord.currentItemKind === 'master-generate' ||
        workflowRecord.currentItemKind === 'master-clean' ||
        workflowRecord.currentItemKind === 'child-generate'
          ? workflowRecord.currentItemKind
          : 'idle',
      currentItemIndex:
        typeof workflowRecord.currentItemIndex === 'number' &&
        Number.isFinite(workflowRecord.currentItemIndex)
          ? Math.max(0, Math.floor(workflowRecord.currentItemIndex))
          : 0,
      currentItemTotal:
        typeof workflowRecord.currentItemTotal === 'number' &&
        Number.isFinite(workflowRecord.currentItemTotal)
          ? Math.max(0, Math.floor(workflowRecord.currentItemTotal))
          : 0,
      failures: Array.isArray(workflowRecord.failures)
        ? (workflowRecord.failures as unknown[])
            .map((item, index) => {
              const record =
                item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
              return {
                id: String(record.id ?? `failure-${index}`),
                stageKind:
                  record.stageKind === 'master-clean' || record.stageKind === 'child-generate'
                    ? (record.stageKind as AiStudioWorkflowFailureRecord['stageKind'])
                    : 'master-generate',
                sequenceIndex: normalizePositiveInteger(record.sequenceIndex, index + 1),
                message: String(record.message ?? '').trim() || '未知错误',
                assetId: typeof record.assetId === 'string' ? record.assetId : undefined,
                runId: typeof record.runId === 'string' ? record.runId : undefined,
                createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now()
              } satisfies AiStudioWorkflowFailureRecord
            })
            .filter((item) => item.message)
        : []
    },
    masterStage: {
      templateId:
        typeof masterRecord.templateId === 'string' || masterRecord.templateId === null
          ? (masterRecord.templateId as string | null)
          : base.masterStage.templateId,
      promptExtra:
        typeof masterRecord.promptExtra === 'string'
          ? masterRecord.promptExtra
          : base.masterStage.promptExtra,
      requestedCount:
        typeof masterRecord.requestedCount === 'number' &&
        Number.isFinite(masterRecord.requestedCount)
          ? Math.max(1, Math.floor(masterRecord.requestedCount))
          : base.masterStage.requestedCount,
      completedCount:
        typeof masterRecord.completedCount === 'number' &&
        Number.isFinite(masterRecord.completedCount)
          ? Math.max(0, Math.floor(masterRecord.completedCount))
          : base.masterStage.completedCount,
      cleanSuccessCount:
        typeof masterRecord.cleanSuccessCount === 'number' &&
        Number.isFinite(masterRecord.cleanSuccessCount)
          ? Math.max(0, Math.floor(masterRecord.cleanSuccessCount))
          : base.masterStage.cleanSuccessCount,
      cleanFailedCount:
        typeof masterRecord.cleanFailedCount === 'number' &&
        Number.isFinite(masterRecord.cleanFailedCount)
          ? Math.max(0, Math.floor(masterRecord.cleanFailedCount))
          : base.masterStage.cleanFailedCount
    },
    childStage: {
      templateId:
        typeof childRecord.templateId === 'string' || childRecord.templateId === null
          ? (childRecord.templateId as string | null)
          : base.childStage.templateId,
      promptExtra:
        typeof childRecord.promptExtra === 'string'
          ? childRecord.promptExtra
          : base.childStage.promptExtra,
      requestedCount:
        typeof childRecord.requestedCount === 'number' &&
        Number.isFinite(childRecord.requestedCount)
          ? Math.max(1, Math.floor(childRecord.requestedCount))
          : base.childStage.requestedCount,
      variantLines: Array.isArray(childRecord.variantLines)
        ? normalizeVariantLines(childRecord.variantLines)
        : base.childStage.variantLines,
      completedCount:
        typeof childRecord.completedCount === 'number' &&
        Number.isFinite(childRecord.completedCount)
          ? Math.max(0, Math.floor(childRecord.completedCount))
          : base.childStage.completedCount,
      failedCount:
        typeof childRecord.failedCount === 'number' && Number.isFinite(childRecord.failedCount)
          ? Math.max(0, Math.floor(childRecord.failedCount))
          : base.childStage.failedCount
    }
  }
}

function writeWorkflowMetadata(
  task: Pick<
    AiStudioTaskRecord,
    'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths' | 'metadata'
  >,
  nextWorkflow: AiStudioWorkflowMetadata
): Record<string, unknown> {
  const metadata =
    task.metadata && typeof task.metadata === 'object'
      ? (task.metadata as Record<string, unknown>)
      : {}
  return {
    ...stripVideoMetadata(metadata),
    capability: 'image',
    workflow: nextWorkflow.workflow,
    masterStage: nextWorkflow.masterStage,
    childStage: nextWorkflow.childStage,
    mode: 'two-stage'
  }
}

function sanitizeDraftMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const next = stripVideoMetadata(stripImageWorkflowMetadata(metadata))
  delete next.latestSubmittedPrompt
  delete next.latestRequestSnapshot
  delete next.latestSubmittedAt
  delete next.latestSubmittedEndpointPath
  return next
}

function resetWorkflowMetadataForInputs(
  task: Pick<
    AiStudioTaskRecord,
    'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths' | 'metadata'
  >
): AiStudioWorkflowMetadata {
  const nextWorkflow = readWorkflowMetadata(task)
  return {
    workflow: {
      ...nextWorkflow.workflow,
      activeStage: 'master-setup',
      sourcePrimaryImagePath: task.primaryImagePath ?? null,
      sourceReferenceImagePaths: uniqueStrings(task.referenceImagePaths ?? []),
      currentAiMasterAssetId: null,
      currentItemKind: 'idle',
      currentItemIndex: 0,
      currentItemTotal: 0,
      failures: []
    },
    masterStage: {
      ...nextWorkflow.masterStage,
      completedCount: 0,
      cleanSuccessCount: 0,
      cleanFailedCount: 0
    },
    childStage: {
      ...nextWorkflow.childStage,
      completedCount: 0,
      failedCount: 0
    }
  }
}

function makeWorkflowFailureRecord(
  stageKind: AiStudioWorkflowFailureRecord['stageKind'],
  sequenceIndex: number,
  message: string,
  extra?: Pick<AiStudioWorkflowFailureRecord, 'assetId' | 'runId'>
): AiStudioWorkflowFailureRecord {
  return {
    id: `${stageKind}-${sequenceIndex}-${Date.now()}`,
    stageKind,
    sequenceIndex,
    message: String(message ?? '').trim() || '未知错误',
    assetId: extra?.assetId,
    runId: extra?.runId,
    createdAt: Date.now()
  }
}

function normalizeVideoFailureDisplay(
  message: string,
  detail?: string | null
): Pick<AiStudioVideoFailureRecord, 'message' | 'detail'> {
  const normalizedMessage = String(message ?? '').trim()
  const normalizedDetail = String(detail ?? '').trim()
  const raw = normalizedDetail || normalizedMessage
  const isContentReviewFailure = [
    /public[-_\s]*error[-_\s]*audio[-_\s]*filtered/i,
    /public[-_\s]*error[-_\s]*sexual/i,
    /received empty response from gemini/i,
    /no meaningful content in candidates/i,
    /^生成失败$/i,
    /上游负载饱和/i,
    /processing[-_\s]*error/i
  ].some((pattern) => pattern.test(raw))

  if (isContentReviewFailure) {
    return {
      message: '内容审核未通过',
      detail: raw
    }
  }

  return {
    message: normalizedMessage || '未知错误',
    detail: normalizedDetail || undefined
  }
}

function makeVideoFailureRecord(
  sequenceIndex: number,
  message: string,
  runId?: string,
  detail?: string | null
): AiStudioVideoFailureRecord {
  const display = normalizeVideoFailureDisplay(message, detail)
  return {
    id: `video-${sequenceIndex}-${Date.now()}`,
    sequenceIndex,
    message: display.message,
    detail: display.detail,
    runId,
    createdAt: Date.now()
  }
}

export function buildStageProgress(workflowMeta: AiStudioWorkflowMetadata): AiStudioStageProgress {
  const masterRequested = workflowMeta.masterStage.requestedCount
  const childRequested = workflowMeta.childStage.requestedCount
  const totalPlanned = masterRequested + masterRequested + childRequested
  const totalCompleted =
    workflowMeta.masterStage.completedCount +
    workflowMeta.masterStage.cleanSuccessCount +
    workflowMeta.masterStage.cleanFailedCount +
    workflowMeta.childStage.completedCount +
    workflowMeta.childStage.failedCount

  let currentLabel = '待开始'
  if (workflowMeta.workflow.currentItemKind === 'master-generate') {
    currentLabel = '结果生成中'
  } else if (workflowMeta.workflow.currentItemKind === 'master-clean') {
    currentLabel = '去水印处理中'
  } else if (workflowMeta.workflow.currentItemKind === 'child-generate') {
    currentLabel = '结果生成中'
  } else if (workflowMeta.workflow.activeStage === 'master-selecting') {
    currentLabel = '等待处理完成'
  } else if (workflowMeta.workflow.activeStage === 'child-ready') {
    currentLabel = '等待开始生成'
  } else if (workflowMeta.workflow.activeStage === 'completed') {
    currentLabel = '已完成'
  }

  return {
    stage: workflowMeta.workflow.activeStage,
    currentLabel,
    currentIndex: workflowMeta.workflow.currentItemIndex,
    currentTotal: workflowMeta.workflow.currentItemTotal,
    totalCompleted,
    totalPlanned,
    successCount:
      workflowMeta.masterStage.cleanSuccessCount + workflowMeta.childStage.completedCount,
    failureCount: workflowMeta.workflow.failures.length
  }
}

const AI_STUDIO_TASK_INTERRUPTED_MESSAGE = '[AI Studio] 任务已手动中断。'
const AI_STUDIO_MASTER_CLEAN_CONCURRENCY = 10

function createTaskInterruptedError(): Error {
  const error = new Error(AI_STUDIO_TASK_INTERRUPTED_MESSAGE)
  error.name = 'AiStudioTaskInterruptedError'
  return error
}

function isTaskInterruptedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AiStudioTaskInterruptedError' ||
      error.message === AI_STUDIO_TASK_INTERRUPTED_MESSAGE)
  )
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildChildPromptExtra(basePromptExtra: string, variantLine: string): string {
  const parts = [String(basePromptExtra ?? '').trim(), String(variantLine ?? '').trim()].filter(
    Boolean
  )
  return parts.join('\n\n')
}

function buildVideoInputPaths(videoMeta: AiStudioVideoMetadata): string[] {
  return videoMeta.mode === 'first-last-frame'
    ? uniqueStrings([videoMeta.firstFramePath ?? '', videoMeta.lastFramePath ?? ''])
    : uniqueStrings([videoMeta.subjectReferencePath ?? ''])
}

function getVideoInputNameSource(videoMeta: AiStudioVideoMetadata): string {
  if (videoMeta.mode === 'first-last-frame') {
    return videoMeta.firstFramePath ?? videoMeta.lastFramePath ?? ''
  }
  return videoMeta.subjectReferencePath ?? ''
}

function buildInputAssetPayload(
  taskId: string,
  primaryImagePath: string | null,
  referenceImagePaths: string[]
): Array<{
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
  const normalizedReferences = normalizeReferencePaths(referenceImagePaths, primaryImagePath)
  const writes: Array<{
    id: string
    taskId: string
    kind: 'input'
    role: string
    filePath: string
    previewPath: string
    originPath: string
    sortOrder: number
    metadata: Record<string, unknown>
  }> = []

  if (primaryImagePath) {
    writes.push({
      id: `${taskId}:input:primary`,
      taskId,
      kind: 'input',
      role: AI_STUDIO_SOURCE_PRIMARY_ROLE,
      filePath: primaryImagePath,
      previewPath: primaryImagePath,
      originPath: primaryImagePath,
      sortOrder: 0,
      metadata: { importedAt: Date.now(), slot: 'primary' }
    })
  }

  normalizedReferences.forEach((filePath, index) => {
    writes.push({
      id: `${taskId}:input:reference:${index}`,
      taskId,
      kind: 'input',
      role: AI_STUDIO_SOURCE_REFERENCE_ROLE,
      filePath,
      previewPath: filePath,
      originPath: filePath,
      sortOrder: index + 1,
      metadata: { importedAt: Date.now(), slot: `reference-${index}` }
    })
  })

  return writes
}

function buildVideoInputAssetPayload(
  taskId: string,
  videoMeta: AiStudioVideoMetadata
): Array<{
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
  const writes: Array<{
    id: string
    taskId: string
    kind: 'input'
    role: string
    filePath: string
    previewPath: string
    originPath: string
    sortOrder: number
    metadata: Record<string, unknown>
  }> = []

  if (videoMeta.mode === 'first-last-frame') {
    if (videoMeta.firstFramePath) {
      writes.push({
        id: `${taskId}:input:video-first-frame`,
        taskId,
        kind: 'input',
        role: AI_STUDIO_VIDEO_FIRST_FRAME_ROLE,
        filePath: videoMeta.firstFramePath,
        previewPath: videoMeta.firstFramePath,
        originPath: videoMeta.firstFramePath,
        sortOrder: 0,
        metadata: { importedAt: Date.now(), slot: 'first-frame' }
      })
    }
    if (videoMeta.lastFramePath) {
      writes.push({
        id: `${taskId}:input:video-last-frame`,
        taskId,
        kind: 'input',
        role: AI_STUDIO_VIDEO_LAST_FRAME_ROLE,
        filePath: videoMeta.lastFramePath,
        previewPath: videoMeta.lastFramePath,
        originPath: videoMeta.lastFramePath,
        sortOrder: 1,
        metadata: { importedAt: Date.now(), slot: 'last-frame' }
      })
    }
    return writes
  }

  if (!videoMeta.subjectReferencePath) return writes
  writes.push({
    id: `${taskId}:input:video-subject-reference`,
    taskId,
    kind: 'input',
    role: AI_STUDIO_VIDEO_SUBJECT_REFERENCE_ROLE,
    filePath: videoMeta.subjectReferencePath,
    previewPath: videoMeta.subjectReferencePath,
    originPath: videoMeta.subjectReferencePath,
    sortOrder: 0,
    metadata: { importedAt: Date.now(), slot: 'subject-reference' }
  })
  return writes
}

type AiStudioDemoImageSpec = {
  filename: string
  label: string
  accent: string
  backgroundStart: string
  backgroundEnd: string
  note?: string
  width?: number
  height?: number
}

async function saveAiStudioDemoImage(spec: AiStudioDemoImageSpec): Promise<string> {
  const width = spec.width ?? 960
  const height = spec.height ?? 1280
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[AI Studio] 联调假图画布初始化失败。')

  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, spec.backgroundStart)
  gradient.addColorStop(1, spec.backgroundEnd)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(48, 48, width - 96, height - 96)
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 4
  ctx.strokeRect(48, 48, width - 96, height - 96)

  ctx.fillStyle = spec.accent
  ctx.fillRect(72, 84, width - 144, 18)
  ctx.fillRect(72, height - 170, Math.floor(width * 0.42), 14)

  ctx.fillStyle = '#F5F5F5'
  ctx.font = '700 80px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText(spec.label, 72, 220)

  ctx.fillStyle = 'rgba(245,245,245,0.82)'
  ctx.font = '500 30px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.fillText('AI 素材工作台 · 联调假数据', 72, 278)

  if (spec.note) {
    ctx.fillStyle = 'rgba(245,245,245,0.72)'
    ctx.font = '500 26px "PingFang SC", "Microsoft YaHei", sans-serif'
    const lines = String(spec.note)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    lines.slice(0, 4).forEach((line, index) => {
      ctx.fillText(line, 72, 360 + index * 42)
    })
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const savedPath = await window.api.cms.image.saveBase64({
    dataUrl,
    filename: spec.filename
  })
  const normalized = String(savedPath ?? '').trim()
  if (!normalized) throw new Error('[AI Studio] 联调假图保存失败。')
  return normalized
}

async function confirmResetGeneratedTask(): Promise<boolean> {
  const message = '更换输入素材会清空当前结果并重置为草稿，是否继续？'
  try {
    const result = await window.electronAPI.showMessageBox({
      type: 'warning',
      title: '确认重置任务',
      message,
      detail: '这会删除当前任务的已生成结果与运行记录。',
      buttons: ['继续', '取消'],
      defaultId: 1,
      cancelId: 1
    })
    return result.response === 0
  } catch {
    return window.confirm(message)
  }
}

function mergeById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of prev) map.set(item.id, item)
  for (const item of next) map.set(item.id, item)
  return Array.from(map.values())
}

function formatCost(min: number | null, max: number | null): string {
  const normalizedMin = Number.isFinite(Number(min)) ? Number(min) : 0
  const normalizedMax = Number.isFinite(Number(max)) ? Number(max) : normalizedMin
  if (normalizedMin === 0 && normalizedMax === 0) return '¥ 0.00'
  if (normalizedMin === normalizedMax) return `¥ ${normalizedMin.toFixed(2)}`
  return `¥ ${normalizedMin.toFixed(2)} - ${normalizedMax.toFixed(2)}`
}

function inferStatusFilter(status: AiStudioTaskRecord['status']): AiStudioTaskStatusFilter {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'ready') return 'running'
  return 'draft'
}

function isHistoricalTask(task: AiStudioTaskView): boolean {
  return (
    task.status !== 'draft' ||
    task.outputAssets.length > 0 ||
    Boolean(task.latestRunId) ||
    Boolean(task.remoteTaskId)
  )
}

function normalizeTask(task: AiStudioTaskRecord): AiStudioTaskRecord {
  return {
    ...task,
    outputCount:
      Number.isFinite(Number(task.outputCount)) && Number(task.outputCount) > 0
        ? Math.floor(Number(task.outputCount))
        : 1,
    referenceImagePaths: uniqueStrings(task.referenceImagePaths ?? []),
    inputImagePaths: uniqueStrings(task.inputImagePaths ?? [])
  }
}

function coerceTemplateRecord(template: unknown): AiStudioTemplateRecord {
  const record = (template ?? {}) as Record<string, unknown>
  return {
    id: String(record.id ?? ''),
    provider: typeof record.provider === 'string' ? record.provider : 'grsai',
    capability: record.capability === 'video' ? 'video' : 'image',
    name: typeof record.name === 'string' ? record.name : '',
    promptText: typeof record.promptText === 'string' ? record.promptText : '',
    config:
      record.config && typeof record.config === 'object'
        ? (record.config as Record<string, unknown>)
        : {},
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0
  }
}

function sortTemplates(templates: AiStudioTemplateRecord[]): AiStudioTemplateRecord[] {
  return [...templates].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

function coerceTaskRecord(task: unknown): AiStudioTaskRecord {
  const record = (task ?? {}) as Record<string, unknown>
  return normalizeTask({
    id: String(record.id ?? ''),
    templateId: typeof record.templateId === 'string' ? record.templateId : null,
    provider: typeof record.provider === 'string' ? record.provider : 'grsai',
    sourceFolderPath: typeof record.sourceFolderPath === 'string' ? record.sourceFolderPath : null,
    productName: typeof record.productName === 'string' ? record.productName : '',
    status:
      record.status === 'ready' ||
      record.status === 'running' ||
      record.status === 'completed' ||
      record.status === 'failed' ||
      record.status === 'archived'
        ? (record.status as AiStudioTaskRecord['status'])
        : 'draft',
    aspectRatio: typeof record.aspectRatio === 'string' ? record.aspectRatio : '3:4',
    outputCount: typeof record.outputCount === 'number' ? record.outputCount : 1,
    model: typeof record.model === 'string' ? record.model : '',
    promptExtra: typeof record.promptExtra === 'string' ? record.promptExtra : '',
    primaryImagePath: typeof record.primaryImagePath === 'string' ? record.primaryImagePath : null,
    referenceImagePaths: Array.isArray(record.referenceImagePaths)
      ? (record.referenceImagePaths as string[])
      : [],
    inputImagePaths: Array.isArray(record.inputImagePaths)
      ? (record.inputImagePaths as string[])
      : [],
    remoteTaskId: typeof record.remoteTaskId === 'string' ? record.remoteTaskId : null,
    latestRunId: typeof record.latestRunId === 'string' ? record.latestRunId : null,
    priceMinSnapshot: typeof record.priceMinSnapshot === 'number' ? record.priceMinSnapshot : null,
    priceMaxSnapshot: typeof record.priceMaxSnapshot === 'number' ? record.priceMaxSnapshot : null,
    billedState:
      record.billedState === 'billable' ||
      record.billedState === 'not_billable' ||
      record.billedState === 'settled'
        ? (record.billedState as AiStudioTaskRecord['billedState'])
        : 'unbilled',
    metadata:
      record.metadata && typeof record.metadata === 'object'
        ? (record.metadata as Record<string, unknown>)
        : {},
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0
  })
}

function coerceAssetRecord(asset: unknown): AiStudioAssetRecord {
  const record = (asset ?? {}) as Record<string, unknown>
  return {
    id: String(record.id ?? ''),
    taskId: String(record.taskId ?? ''),
    runId: typeof record.runId === 'string' ? record.runId : null,
    kind: record.kind === 'output' ? 'output' : 'input',
    role: typeof record.role === 'string' ? record.role : 'candidate',
    filePath: typeof record.filePath === 'string' ? record.filePath : '',
    previewPath: typeof record.previewPath === 'string' ? record.previewPath : null,
    originPath: typeof record.originPath === 'string' ? record.originPath : null,
    selected: record.selected === true,
    sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : 0,
    metadata:
      record.metadata && typeof record.metadata === 'object'
        ? (record.metadata as Record<string, unknown>)
        : {},
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0
  }
}

export type UseAiStudioStateResult = ReturnType<typeof useAiStudioState>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const useAiStudioState = () => {
  const defaultModel = useCmsStore((state) => state.config.aiDefaultImageModel)
  const aiConfig = useCmsStore((state) => state.config)
  const addLog = useCmsStore((state) => state.addLog)
  const setWorkshopImport = useCmsStore((state) => state.setWorkshopImport)
  const setMaterialImport = useCmsStore((state) => state.setMaterialImport)
  const setActiveModule = useCmsStore((state) => state.setActiveModule)
  const [templates, setTemplates] = useState<AiStudioTemplateRecord[]>([])
  const [tasks, setTasks] = useState<AiStudioTaskRecord[]>([])
  const [assets, setAssets] = useState<AiStudioAssetRecord[]>([])
  const [draftByTaskId, setDraftByTaskId] = useState<Record<string, Partial<AiStudioTaskRecord>>>(
    {}
  )
  const [statusFilter, setStatusFilter] = useState<AiStudioTaskStatusFilter>('all')
  const [studioCapability, setStudioCapabilityState] = useState<AiStudioCapability>('image')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)
  const interruptRequestedTaskIdsRef = useRef<Set<string>>(new Set())
  const sessionStartedAtRef = useRef(Date.now())
  const hasRecoveredAbandonedTasksRef = useRef(false)
  const [interruptingTaskIds, setInterruptingTaskIds] = useState<string[]>([])
  const [previewSlotRuntimeByTaskId, setPreviewSlotRuntimeByTaskId] = useState<
    Record<string, Record<number, PreviewSlotRuntimeState>>
  >({})

  const replacePreviewSlotRuntimeStates = useCallback(
    (taskId: string, nextStates: Record<number, PreviewSlotRuntimeState>) => {
      const normalizedTaskId = String(taskId ?? '').trim()
      if (!normalizedTaskId) return
      const nowMs = Date.now()
      setPreviewSlotRuntimeByTaskId((prev) => ({
        ...prev,
        [normalizedTaskId]: Object.fromEntries(
          Object.entries(nextStates).map(([slotKey, state]) => [
            slotKey,
            {
              ...state,
              startedAt:
                Number.isFinite(Number(state?.startedAt)) && Number(state?.startedAt) > 0
                  ? Number(state.startedAt)
                  : nowMs
            } satisfies PreviewSlotRuntimeState
          ])
        )
      }))
    },
    []
  )

  const patchPreviewSlotRuntimeState = useCallback(
    (taskId: string, sequenceIndex: number, nextState: PreviewSlotRuntimeState | null) => {
      const normalizedTaskId = String(taskId ?? '').trim()
      const normalizedIndex = Math.max(1, Math.floor(Number(sequenceIndex) || 0))
      if (!normalizedTaskId || normalizedIndex <= 0) return

      setPreviewSlotRuntimeByTaskId((prev) => {
        const current = { ...(prev[normalizedTaskId] ?? {}) }
        if (nextState) {
          const previousState = current[normalizedIndex] ?? null
          const nextStartedAt =
            Number.isFinite(Number(nextState.startedAt)) && Number(nextState.startedAt) > 0
              ? Number(nextState.startedAt)
              : previousState && previousState.status === nextState.status
                ? Number(previousState.startedAt ?? 0) || Date.now()
                : Date.now()
          current[normalizedIndex] = {
            ...nextState,
            startedAt: nextStartedAt
          }
        } else {
          delete current[normalizedIndex]
        }

        if (Object.keys(current).length <= 0) {
          if (!prev[normalizedTaskId]) return prev
          const next = { ...prev }
          delete next[normalizedTaskId]
          return next
        }

        return {
          ...prev,
          [normalizedTaskId]: current
        }
      })
    },
    []
  )

  const clearPreviewSlotRuntimeStates = useCallback((taskId: string) => {
    const normalizedTaskId = String(taskId ?? '').trim()
    if (!normalizedTaskId) return
    setPreviewSlotRuntimeByTaskId((prev) => {
      if (!prev[normalizedTaskId]) return prev
      const next = { ...prev }
      delete next[normalizedTaskId]
      return next
    })
  }, [])

  const buildAbandonedTaskRecoveryPatch = useCallback((task: AiStudioTaskRecord) => {
    if (readTaskCapability(task) === 'video') {
      const videoMeta = readVideoMetadata(task)
      return {
        status: 'failed' as const,
        metadata: writeVideoMetadata(task, {
          ...videoMeta,
          currentItemIndex: 0,
          currentItemTotal: videoMeta.outputCount
        })
      }
    }

    const workflow = readWorkflowMetadata(task)
    const wasChildStage = workflow.workflow.activeStage === 'child-generating'
    return {
      status: 'failed' as const,
      metadata: writeWorkflowMetadata(task, {
        ...workflow,
        workflow: {
          ...workflow.workflow,
          activeStage: wasChildStage ? 'child-ready' : 'master-selecting',
          currentItemKind: 'idle',
          currentItemIndex: 0,
          currentItemTotal: wasChildStage
            ? workflow.childStage.requestedCount
            : workflow.masterStage.requestedCount
        }
      })
    }
  }, [])

  const recoverAbandonedPreSubmitTasks = useCallback(
    async (taskRows: AiStudioTaskRecord[]) => {
      const abandonedTaskIds = new Set(
        findAbandonedPreSubmitTaskIds(taskRows, sessionStartedAtRef.current)
      )
      if (abandonedTaskIds.size <= 0) {
        return 0
      }

      let recoveredCount = 0
      for (const task of taskRows) {
        if (!abandonedTaskIds.has(task.id)) continue
        await window.api.cms.aiStudio.task.update({
          taskId: task.id,
          patch: buildAbandonedTaskRecoveryPatch(task)
        })
        recoveredCount += 1
      }
      return recoveredCount
    },
    [buildAbandonedTaskRecoveryPatch]
  )

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [templateRows, taskRows, assetRows] = await Promise.all([
        window.api.cms.aiStudio.template.list({ capability: studioCapability }).catch(() => []),
        window.api.cms.aiStudio.task.list({ limit: 300 }),
        window.api.cms.aiStudio.asset.list().catch(() => [])
      ])
      const nextTemplates = sortTemplates((templateRows ?? []).map(coerceTemplateRecord))
      const nextTasks = (taskRows ?? []).map(coerceTaskRecord)
      const nextAssets = (assetRows ?? []).map(coerceAssetRecord)
      setTemplates(nextTemplates)
      setTasks(nextTasks)
      setAssets(nextAssets)
      setActiveTaskId((prev) =>
        prev && nextTasks.some((task) => task.id === prev) ? prev : (nextTasks[0]?.id ?? null)
      )
      setSelectedTaskIds((prev) => prev.filter((id) => nextTasks.some((task) => task.id === id)))
    } finally {
      setIsLoading(false)
    }
  }, [studioCapability])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (hasRecoveredAbandonedTasksRef.current || isLoading) return
    hasRecoveredAbandonedTasksRef.current = true

    void (async () => {
      try {
        const recoveredCount = await recoverAbandonedPreSubmitTasks(tasks)
        if (recoveredCount > 0) {
          addLog(`[AI Studio] 已恢复 ${recoveredCount} 个上次会话中断的任务。`)
          await refresh()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[AI Studio] 恢复悬挂任务失败：${message}`)
      }
    })()
  }, [addLog, isLoading, recoverAbandonedPreSubmitTasks, refresh, tasks])

  const assetsByTaskId = useMemo(() => {
    const map = new Map<string, AiStudioAssetRecord[]>()
    for (const asset of assets) {
      const group = map.get(asset.taskId) ?? []
      group.push(asset)
      map.set(asset.taskId, group)
    }
    for (const group of map.values()) {
      group.sort(
        (left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt
      )
    }
    return map
  }, [assets])

  const taskViews = useMemo<AiStudioTaskView[]>(() => {
    return tasks.map((task) => {
      const draftPatch = draftByTaskId[task.id] ?? {}
      const mergedTask = normalizeTask({ ...task, ...draftPatch })
      const relatedAssets = assetsByTaskId.get(task.id) ?? []
      const currentInputPaths = new Set(mergedTask.inputImagePaths)
      const inputAssets = relatedAssets.filter(
        (asset) => asset.kind === 'input' && currentInputPaths.has(asset.filePath)
      )
      const outputAssets = relatedAssets.filter((asset) => asset.kind === 'output')
      return {
        ...mergedTask,
        inputAssets,
        outputAssets,
        sourceCount:
          inputAssets.length > 0 ? inputAssets.length : mergedTask.inputImagePaths.length,
        costLabel: formatCost(mergedTask.priceMinSnapshot, mergedTask.priceMaxSnapshot)
      }
    })
  }, [assetsByTaskId, draftByTaskId, tasks])

  const capabilityTaskViews = useMemo(
    () => taskViews.filter((task) => readTaskCapability(task) === studioCapability),
    [studioCapability, taskViews]
  )

  const setStudioCapability = useCallback(
    (next: AiStudioCapability) => {
      if (next !== studioCapability) {
        setTemplates([])
      }
      setStudioCapabilityState(next)
      setActiveTaskId((prev) => {
        if (
          prev &&
          taskViews.some((task) => task.id === prev && readTaskCapability(task) === next)
        ) {
          return prev
        }
        return taskViews.find((task) => readTaskCapability(task) === next)?.id ?? prev
      })
    },
    [studioCapability, taskViews]
  )

  const visibleTasks = useMemo(() => {
    if (statusFilter === 'all') return capabilityTaskViews
    return capabilityTaskViews.filter((task) => inferStatusFilter(task.status) === statusFilter)
  }, [capabilityTaskViews, statusFilter])

  const activeTask = useMemo(() => {
    return (
      capabilityTaskViews.find((task) => task.id === activeTaskId) ?? capabilityTaskViews[0] ?? null
    )
  }, [activeTaskId, capabilityTaskViews])

  const historyTasks = useMemo(() => {
    return capabilityTaskViews
      .filter((task) => isHistoricalTask(task))
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt)
  }, [capabilityTaskViews])

  const activeInputAssets = activeTask?.inputAssets ?? []
  const activeOutputAssets = activeTask?.outputAssets ?? []
  const selectedOutputIdsByTask = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {}
    for (const task of taskViews) {
      map[task.id] = task.outputAssets.filter((asset) => asset.selected).map((asset) => asset.id)
    }
    return map
  }, [taskViews])
  const activeSelectedOutputAssets = useMemo(
    () => activeOutputAssets.filter((asset) => asset.selected),
    [activeOutputAssets]
  )
  const activeSelectedOutputIds = useMemo(
    () => activeSelectedOutputAssets.map((asset) => asset.id),
    [activeSelectedOutputAssets]
  )
  const primaryImagePath = activeTask?.primaryImagePath ?? null
  const referenceImagePaths = activeTask?.referenceImagePaths ?? []

  const batchCostSummary = useMemo<AiStudioBatchCostSummary>(() => {
    const selectedCapabilityTasks = capabilityTaskViews.filter((task) =>
      selectedTaskIds.includes(task.id)
    )
    const basis = selectedCapabilityTasks.length > 0 ? selectedCapabilityTasks : visibleTasks
    const min = basis.reduce((total, task) => total + (task.priceMinSnapshot ?? 0), 0)
    const max = basis.reduce(
      (total, task) => total + (task.priceMaxSnapshot ?? task.priceMinSnapshot ?? 0),
      0
    )
    return { min, max, label: formatCost(min, max) }
  }, [capabilityTaskViews, selectedTaskIds, visibleTasks])

  const templateOptions = useMemo(
    () => sortTemplates(templates.filter((template) => template.capability === studioCapability)),
    [studioCapability, templates]
  )
  const videoProfiles = AI_VIDEO_PROFILES
  const videoMeta = useMemo(
    () =>
      studioCapability === 'video' ? readVideoMetadata(activeTask) : createDefaultVideoMetadata(),
    [activeTask, studioCapability]
  )
  const selectedVideoProfile = useMemo(
    () => getAiVideoProfile(videoMeta.profileId),
    [videoMeta.profileId]
  )
  const providerProfiles = useMemo(
    () => (Array.isArray(aiConfig.aiProviderProfiles) ? aiConfig.aiProviderProfiles : []),
    [aiConfig.aiProviderProfiles]
  )
  const resolveImageProviderSelection = useCallback(
    (providerName?: string | null, modelName?: string | null) =>
      resolveAiTaskProviderSelection(providerProfiles, {
        taskProviderName: providerName,
        taskModelName: modelName,
        fallbackProviderName: aiConfig.aiProvider,
        fallbackModelName: defaultModel || DEFAULT_GRSAI_IMAGE_MODEL
      }),
    [aiConfig.aiProvider, defaultModel, providerProfiles]
  )
  const resolveImageTaskProviderState = useCallback(
    (task?: Pick<AiStudioTaskRecord, 'provider' | 'model'> | null) =>
      resolveImageProviderSelection(task?.provider, task?.model),
    [resolveImageProviderSelection]
  )
  const resolveVideoProviderSelection = useCallback(
    (providerName?: string | null, modelName?: string | null, endpointPath?: string | null) => {
      const resolved = resolveAiTaskProviderSelection(providerProfiles, {
        taskProviderName: providerName,
        taskModelName: modelName,
        taskEndpointPath: endpointPath,
        fallbackProviderName: aiConfig.aiProvider,
        fallbackModelName: defaultModel || DEFAULT_GRSAI_IMAGE_MODEL
      })
      const endpointPair = buildVideoEndpointPair(resolved.endpointPath)
      return {
        providerName: resolved.providerName,
        modelName: resolved.modelName,
        submitPath: endpointPair.submitPath,
        queryPath: endpointPair.queryPath
      }
    },
    [aiConfig.aiProvider, defaultModel, providerProfiles]
  )

  const replaceTask = useCallback((nextTask: AiStudioTaskRecord) => {
    setTasks((prev) => mergeById(prev, [normalizeTask(nextTask)]))
    setDraftByTaskId((prev) => {
      if (!prev[nextTask.id]) return prev
      const next = { ...prev }
      delete next[nextTask.id]
      return next
    })
  }, [])

  const replaceAssets = useCallback((nextAssets: AiStudioAssetRecord[]) => {
    setAssets((prev) => mergeById(prev, nextAssets.map(coerceAssetRecord)))
  }, [])

  const replaceTemplate = useCallback(
    (nextTemplate: AiStudioTemplateRecord) => {
      const normalizedTemplate = coerceTemplateRecord(nextTemplate)
      setTemplates((prev) =>
        normalizedTemplate.capability === studioCapability
          ? sortTemplates(mergeById(prev, [normalizedTemplate]))
          : prev
      )
    },
    [studioCapability]
  )

  const requestTaskInterrupt = useCallback((taskId: string) => {
    const normalizedTaskId = String(taskId ?? '').trim()
    if (!normalizedTaskId) return
    interruptRequestedTaskIdsRef.current.add(normalizedTaskId)
    setInterruptingTaskIds((prev) => uniqueStrings([...prev, normalizedTaskId]))
  }, [])

  const clearTaskInterrupt = useCallback((taskId: string) => {
    const normalizedTaskId = String(taskId ?? '').trim()
    if (!normalizedTaskId) return
    interruptRequestedTaskIdsRef.current.delete(normalizedTaskId)
    setInterruptingTaskIds((prev) => prev.filter((value) => value !== normalizedTaskId))
  }, [])

  const isTaskInterruptRequested = useCallback((taskId: string) => {
    const normalizedTaskId = String(taskId ?? '').trim()
    return normalizedTaskId ? interruptRequestedTaskIdsRef.current.has(normalizedTaskId) : false
  }, [])

  const updateTaskPatch = useCallback(
    async (taskId: string, patch: Record<string, unknown>) => {
      const optimisticPatch = Object.fromEntries(
        Object.entries(patch).filter(
          ([, value]) => value !== undefined && !(typeof value === 'number' && Number.isNaN(value))
        )
      ) as Partial<AiStudioTaskRecord>

      if (Object.keys(optimisticPatch).length > 0) {
        setDraftByTaskId((prev) => ({
          ...prev,
          [taskId]: { ...(prev[taskId] ?? {}), ...optimisticPatch }
        }))
      }

      try {
        const updated = await window.api.cms.aiStudio.task.update({
          taskId,
          patch: optimisticPatch
        })
        const normalized = coerceTaskRecord(updated)
        replaceTask(normalized)
        return normalized
      } catch (error) {
        setDraftByTaskId((prev) => {
          if (!prev[taskId]) return prev
          const next = { ...prev }
          delete next[taskId]
          return next
        })
        throw error
      }
    },
    [replaceTask]
  )

  const importFolders = useCallback(async () => {
    setIsImporting(true)
    try {
      const folders =
        (await window.api.cms.aiStudio.task.importFolders()) as AiStudioImportedFolder[]
      if (!Array.isArray(folders) || folders.length === 0) return []

      const createdTasks: AiStudioTaskRecord[] = []
      const importedAssets: AiStudioAssetRecord[] = []

      for (const folder of folders) {
        const imageProviderSelection = resolveImageProviderSelection('', '')
        const created = coerceTaskRecord(
          await window.api.cms.aiStudio.task.create({
            provider: imageProviderSelection.providerName || aiConfig.aiProvider || 'grsai',
            sourceFolderPath: folder.folderPath,
            productName: folder.productName,
            status: 'draft',
            aspectRatio: '3:4',
            outputCount: 1,
            model: imageProviderSelection.modelName || defaultModel || DEFAULT_GRSAI_IMAGE_MODEL,
            inputImagePaths: folder.imageFilePaths,
            metadata: { importedImageCount: folder.imageFilePaths.length }
          })
        )
        createdTasks.push(created)

        if (folder.imageFilePaths.length > 0) {
          const savedAssets = await window.api.cms.aiStudio.asset.upsert(
            folder.imageFilePaths.map((filePath, index) => ({
              taskId: created.id,
              kind: 'input',
              role: 'source',
              filePath,
              originPath: filePath,
              sortOrder: index,
              metadata: { importedAt: Date.now() }
            }))
          )
          importedAssets.push(...savedAssets.map(coerceAssetRecord))
        }
      }

      setTasks((prev) => mergeById(prev, createdTasks))
      setAssets((prev) => mergeById(prev, importedAssets))
      const newIds = createdTasks.map((task) => task.id)
      setSelectedTaskIds((prev) => uniqueStrings([...prev, ...newIds]))
      setActiveTaskId(newIds[0] ?? null)
      return createdTasks
    } finally {
      setIsImporting(false)
    }
  }, [aiConfig.aiProvider, defaultModel, resolveImageProviderSelection])

  const createTaskWithInputs = useCallback(
    async (payload: {
      primaryImagePath: string | null
      referenceImagePaths: string[]
      inheritFrom?: AiStudioTaskRecord | AiStudioTaskView | null
      promptExtraOverride?: string
      templateIdOverride?: string | null
    }) => {
      const primaryImagePath = String(payload.primaryImagePath ?? '').trim() || null
      const referenceImagePaths = normalizeReferencePaths(
        payload.referenceImagePaths,
        primaryImagePath
      )
      const inputImagePaths = uniqueStrings(
        [primaryImagePath, ...referenceImagePaths].filter(Boolean) as string[]
      )
      const baseTask = payload.inheritFrom ?? null
      const baseWorkflow = baseTask ? readWorkflowMetadata(baseTask) : null
      const inheritedTemplateId =
        payload.templateIdOverride !== undefined
          ? payload.templateIdOverride
          : (baseWorkflow?.masterStage.templateId ?? baseTask?.templateId ?? null)
      const inheritedPromptExtra =
        payload.promptExtraOverride !== undefined
          ? payload.promptExtraOverride
          : (baseWorkflow?.masterStage.promptExtra ?? baseTask?.promptExtra ?? '')
      const imageProviderSelection = resolveImageProviderSelection(baseTask?.provider, baseTask?.model)
      const inferredName = basenameWithoutExtension(
        primaryImagePath ?? referenceImagePaths[0] ?? ''
      )
      const created = coerceTaskRecord(
        await window.api.cms.aiStudio.task.create({
          templateId: inheritedTemplateId,
          provider:
            imageProviderSelection.providerName ||
            normalizeAiProviderValue(baseTask?.provider) ||
            aiConfig.aiProvider ||
            'grsai',
          sourceFolderPath: null,
          productName: inferredName || baseTask?.productName || '未命名任务',
          status: 'draft',
          aspectRatio: baseTask?.aspectRatio ?? '3:4',
          outputCount: baseTask?.outputCount ?? 1,
          model:
            imageProviderSelection.modelName ||
            baseTask?.model ||
            defaultModel ||
            DEFAULT_GRSAI_IMAGE_MODEL,
          promptExtra: inheritedPromptExtra,
          primaryImagePath,
          referenceImagePaths,
          inputImagePaths,
          remoteTaskId: null,
          latestRunId: null,
          priceMinSnapshot: null,
          priceMaxSnapshot: null,
          billedState: 'unbilled',
          metadata: (() => {
            const nextMetadata = {
              ...sanitizeDraftMetadata(baseTask?.metadata),
              importedImageCount: inputImagePaths.length
            }
            return writeWorkflowMetadata(
              {
                templateId: inheritedTemplateId,
                promptExtra: inheritedPromptExtra,
                primaryImagePath,
                referenceImagePaths,
                metadata: nextMetadata
              },
              resetWorkflowMetadataForInputs({
                templateId: inheritedTemplateId,
                promptExtra: inheritedPromptExtra,
                primaryImagePath,
                referenceImagePaths,
                metadata: nextMetadata
              })
            )
          })()
        })
      )

      const nextAssets =
        inputImagePaths.length > 0
          ? (
              await window.api.cms.aiStudio.asset.upsert(
                buildInputAssetPayload(created.id, primaryImagePath, referenceImagePaths)
              )
            ).map(coerceAssetRecord)
          : []

      replaceTask(created)
      replaceAssets(nextAssets)
      setSelectedTaskIds([created.id])
      setActiveTaskId(created.id)
      return created
    },
    [aiConfig.aiProvider, defaultModel, replaceAssets, replaceTask, resolveImageProviderSelection]
  )

  const createVideoTask = useCallback(
    async (payload?: {
      inheritFrom?: AiStudioTaskRecord | AiStudioTaskView | null
      promptExtraOverride?: string
      videoMetaOverride?: Partial<AiStudioVideoMetadata>
    }) => {
      const baseTask = payload?.inheritFrom ?? null
      const baseVideoMeta =
        baseTask && readTaskCapability(baseTask) === 'video'
          ? readVideoMetadata(baseTask)
          : createDefaultVideoMetadata()
      const mergedVideoMeta = { ...baseVideoMeta, ...(payload?.videoMetaOverride ?? {}) }
      const profile = getAiVideoProfile(mergedVideoMeta.profileId)
      const providerSelection = resolveVideoProviderSelection(
        baseTask?.provider,
        String(mergedVideoMeta.model ?? '').trim(),
        String(mergedVideoMeta.submitPath ?? '').trim()
      )
      const nextVideoMeta: AiStudioVideoMetadata = {
        capability: 'video',
        profileId: profile.id,
        model: String(mergedVideoMeta.model ?? '').trim() || providerSelection.modelName || profile.modelId,
        adapterKind:
          mergedVideoMeta.adapterKind === 'allapi-unified' ? 'allapi-unified' : profile.adapterKind,
        submitPath:
          String(mergedVideoMeta.submitPath ?? '').trim() || providerSelection.submitPath || profile.submitPath,
        queryPath:
          String(mergedVideoMeta.queryPath ?? '').trim() || providerSelection.queryPath || profile.queryPath,
        mode: normalizeVideoMode(mergedVideoMeta.mode, profile.defaultMode),
        subjectReferencePath: String(mergedVideoMeta.subjectReferencePath ?? '').trim() || null,
        firstFramePath: String(mergedVideoMeta.firstFramePath ?? '').trim() || null,
        lastFramePath: String(mergedVideoMeta.lastFramePath ?? '').trim() || null,
        aspectRatio: normalizeVideoAspectRatio(
          mergedVideoMeta.aspectRatio,
          profile.defaultAspectRatio
        ),
        resolution: normalizeVideoResolution(mergedVideoMeta.resolution, profile.defaultResolution),
        duration: normalizeVideoDurationForModel(
          normalizeVideoDuration(mergedVideoMeta.duration, profile.defaultDuration),
          String(mergedVideoMeta.model ?? '').trim() || providerSelection.modelName || profile.modelId,
          profile.defaultDuration
        ),
        outputCount: normalizePositiveInteger(
          mergedVideoMeta.outputCount,
          baseVideoMeta.outputCount,
          4
        ),
        completedCount: 0,
        failedCount: 0,
        currentItemIndex: 0,
        currentItemTotal: 0,
        failures: []
      }
      const inputImagePaths = buildVideoInputPaths(nextVideoMeta)
      const inferredName = basenameWithoutExtension(getVideoInputNameSource(nextVideoMeta))
      const promptExtra =
        payload?.promptExtraOverride !== undefined
          ? payload.promptExtraOverride
          : (baseTask?.promptExtra ?? '')
      const created = coerceTaskRecord(
        await window.api.cms.aiStudio.task.create({
          templateId: null,
          provider: providerSelection.providerName,
          sourceFolderPath: null,
          productName: inferredName || baseTask?.productName || '未命名视频任务',
          status: 'draft',
          aspectRatio: nextVideoMeta.aspectRatio,
          outputCount: 1,
          model: nextVideoMeta.model,
          promptExtra,
          primaryImagePath: null,
          referenceImagePaths: [],
          inputImagePaths,
          remoteTaskId: null,
          latestRunId: null,
          priceMinSnapshot: null,
          priceMaxSnapshot: null,
          billedState: 'unbilled',
          metadata: (() => {
            const nextMetadata = {
              ...sanitizeDraftMetadata(baseTask?.metadata),
              importedImageCount: inputImagePaths.length
            }
            return writeVideoMetadata({ metadata: nextMetadata }, nextVideoMeta)
          })()
        })
      )

      const nextAssets =
        inputImagePaths.length > 0
          ? (
              await window.api.cms.aiStudio.asset.upsert(
                buildVideoInputAssetPayload(created.id, nextVideoMeta)
              )
            ).map(coerceAssetRecord)
          : []

      replaceTask(created)
      replaceAssets(nextAssets)
      setSelectedTaskIds([created.id])
      setActiveTaskId(created.id)
      return created
    },
    [replaceAssets, replaceTask, resolveVideoProviderSelection]
  )

  const syncVideoTaskInputs = useCallback(
    async (
      task: Pick<AiStudioTaskRecord, 'id' | 'metadata' | 'promptExtra' | 'productName'>,
      nextVideoMetaInput: AiStudioVideoMetadata,
      extraPatch?: Record<string, unknown>
    ) => {
      const nextVideoMeta = readVideoMetadata({
        metadata: { capability: 'video', video: nextVideoMetaInput }
      } as Pick<AiStudioTaskRecord, 'metadata'>)
      const inputImagePaths = buildVideoInputPaths(nextVideoMeta)
      const inferredName = basenameWithoutExtension(getVideoInputNameSource(nextVideoMeta))
      const updated = await updateTaskPatch(task.id, {
        sourceFolderPath: null,
        status: 'draft',
        productName: inferredName || task.productName || '未命名视频任务',
        aspectRatio: nextVideoMeta.aspectRatio,
        outputCount: 1,
        model: nextVideoMeta.model,
        primaryImagePath: null,
        referenceImagePaths: [],
        inputImagePaths,
        remoteTaskId: null,
        latestRunId: null,
        priceMinSnapshot: null,
        priceMaxSnapshot: null,
        billedState: 'unbilled',
        metadata: (() => {
          const nextMetadata = {
            ...sanitizeDraftMetadata(task.metadata),
            importedImageCount: inputImagePaths.length
          }
          return writeVideoMetadata({ metadata: nextMetadata }, nextVideoMeta)
        })(),
        ...(extraPatch ?? {})
      })

      const nextAssets =
        inputImagePaths.length > 0
          ? (
              await window.api.cms.aiStudio.asset.upsert(
                buildVideoInputAssetPayload(task.id, nextVideoMeta)
              )
            ).map(coerceAssetRecord)
          : []
      replaceAssets(nextAssets)
      setSelectedTaskIds([task.id])
      setActiveTaskId(task.id)
      return updated
    },
    [replaceAssets, updateTaskPatch]
  )

  const syncTaskInputs = useCallback(
    async (
      task: Pick<
        AiStudioTaskRecord,
        'id' | 'templateId' | 'promptExtra' | 'metadata' | 'productName'
      >,
      primaryImagePath: string | null,
      referenceImagePaths: string[]
    ) => {
      const normalizedPrimary = String(primaryImagePath ?? '').trim() || null
      const normalizedReferences = normalizeReferencePaths(referenceImagePaths, normalizedPrimary)
      const inputImagePaths = uniqueStrings(
        [normalizedPrimary, ...normalizedReferences].filter(Boolean) as string[]
      )
      const inferredName = basenameWithoutExtension(
        normalizedPrimary ?? normalizedReferences[0] ?? ''
      )

      const updated = await updateTaskPatch(task.id, {
        sourceFolderPath: null,
        status: 'draft',
        productName: inferredName || task.productName || '未命名任务',
        primaryImagePath: normalizedPrimary,
        referenceImagePaths: normalizedReferences,
        inputImagePaths,
        remoteTaskId: null,
        latestRunId: null,
        priceMinSnapshot: null,
        priceMaxSnapshot: null,
        billedState: 'unbilled',
        metadata: (() => {
          const nextMetadata = {
            ...sanitizeDraftMetadata(task.metadata),
            importedImageCount: inputImagePaths.length
          }
          return writeWorkflowMetadata(
            {
              templateId: task.templateId,
              promptExtra: task.promptExtra,
              primaryImagePath: normalizedPrimary,
              referenceImagePaths: normalizedReferences,
              metadata: nextMetadata
            },
            resetWorkflowMetadataForInputs({
              templateId: task.templateId,
              promptExtra: task.promptExtra,
              primaryImagePath: normalizedPrimary,
              referenceImagePaths: normalizedReferences,
              metadata: nextMetadata
            })
          )
        })()
      })

      const nextAssets =
        inputImagePaths.length > 0
          ? (
              await window.api.cms.aiStudio.asset.upsert(
                buildInputAssetPayload(task.id, normalizedPrimary, normalizedReferences)
              )
            ).map(coerceAssetRecord)
          : []
      replaceAssets(nextAssets)
      setSelectedTaskIds([task.id])
      setActiveTaskId(task.id)
      return updated
    },
    [replaceAssets, updateTaskPatch]
  )

  const ensureImageDraftTask = useCallback(async () => {
    const currentImageTask =
      studioCapability === 'image' && activeTask && readTaskCapability(activeTask) === 'image'
        ? activeTask
        : (taskViews.find((task) => readTaskCapability(task) === 'image') ?? null)

    if (!currentImageTask) {
      return createTaskWithInputs({
        primaryImagePath: null,
        referenceImagePaths: []
      })
    }

    const outputCount =
      'outputAssets' in currentImageTask ? currentImageTask.outputAssets.length : 0
    const needsReset =
      outputCount > 0 ||
      Boolean(currentImageTask.latestRunId) ||
      Boolean(currentImageTask.remoteTaskId) ||
      currentImageTask.status === 'running' ||
      currentImageTask.status === 'completed' ||
      currentImageTask.status === 'failed'

    return needsReset
      ? createTaskWithInputs({
          primaryImagePath: currentImageTask.primaryImagePath,
          referenceImagePaths: currentImageTask.referenceImagePaths,
          inheritFrom: currentImageTask
        })
      : currentImageTask
  }, [activeTask, createTaskWithInputs, studioCapability, taskViews])

  const ensureVideoDraftTask = useCallback(async () => {
    const currentVideoTask =
      studioCapability === 'video' && activeTask && readTaskCapability(activeTask) === 'video'
        ? activeTask
        : (taskViews.find((task) => readTaskCapability(task) === 'video') ?? null)

    if (!currentVideoTask) {
      return createVideoTask()
    }

    const outputCount =
      'outputAssets' in currentVideoTask ? currentVideoTask.outputAssets.length : 0
    const needsReset =
      outputCount > 0 ||
      Boolean(currentVideoTask.latestRunId) ||
      Boolean(currentVideoTask.remoteTaskId) ||
      currentVideoTask.status === 'running' ||
      currentVideoTask.status === 'completed' ||
      currentVideoTask.status === 'failed'

    return needsReset ? createVideoTask({ inheritFrom: currentVideoTask }) : currentVideoTask
  }, [activeTask, createVideoTask, studioCapability, taskViews])

  const setVideoMode = useCallback(
    async (value: AiStudioVideoMode) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.mode = value
      if (value === 'subject-reference' && !nextVideoMeta.subjectReferencePath) {
        nextVideoMeta.subjectReferencePath =
          nextVideoMeta.firstFramePath ?? nextVideoMeta.lastFramePath ?? null
      }
      if (value === 'first-last-frame' && !nextVideoMeta.firstFramePath) {
        nextVideoMeta.firstFramePath = nextVideoMeta.subjectReferencePath
      }
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoProfileId = useCallback(
    async (value: string) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      const profile = getAiVideoProfile(value)
      nextVideoMeta.profileId = profile.id
      nextVideoMeta.model = profile.modelId
      nextVideoMeta.adapterKind = profile.adapterKind
      nextVideoMeta.submitPath = profile.submitPath
      nextVideoMeta.queryPath = profile.queryPath
      if (!profile.supportsModes.includes(nextVideoMeta.mode)) {
        nextVideoMeta.mode = profile.defaultMode
      }
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoProvider = useCallback(
    async (value: string) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      const providerSelection = resolveVideoProviderSelection(value, '', '')
      nextVideoMeta.model = providerSelection.modelName
      nextVideoMeta.submitPath = providerSelection.submitPath
      nextVideoMeta.queryPath = providerSelection.queryPath
      await syncVideoTaskInputs(task, nextVideoMeta, {
        provider: providerSelection.providerName || normalizeAiProviderValue(value)
      })
    },
    [ensureVideoDraftTask, resolveVideoProviderSelection, syncVideoTaskInputs]
  )

  const setVideoModel = useCallback(
    async (payload: { provider?: string | null; model: string; endpointPath?: string | null }) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      const providerSelection = resolveVideoProviderSelection(
        payload.provider ?? task.provider,
        payload.model,
        payload.endpointPath ?? nextVideoMeta.submitPath
      )
      nextVideoMeta.model = providerSelection.modelName
      nextVideoMeta.submitPath = providerSelection.submitPath
      nextVideoMeta.queryPath = providerSelection.queryPath
      await syncVideoTaskInputs(task, nextVideoMeta, {
        provider: providerSelection.providerName || normalizeAiProviderValue(payload.provider) || task.provider
      })
    },
    [ensureVideoDraftTask, resolveVideoProviderSelection, syncVideoTaskInputs]
  )

  const setVideoSubjectReference = useCallback(
    async (value: string | null) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.subjectReferencePath = String(value ?? '').trim() || null
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoFirstFrame = useCallback(
    async (value: string | null) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.firstFramePath = String(value ?? '').trim() || null
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoLastFrame = useCallback(
    async (value: string | null) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.lastFramePath = String(value ?? '').trim() || null
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const swapVideoFrames = useCallback(async () => {
    const task = await ensureVideoDraftTask()
    const nextVideoMeta = readVideoMetadata(task)
    const firstFramePath = nextVideoMeta.firstFramePath
    nextVideoMeta.firstFramePath = nextVideoMeta.lastFramePath
    nextVideoMeta.lastFramePath = firstFramePath
    await syncVideoTaskInputs(task, nextVideoMeta)
  }, [ensureVideoDraftTask, syncVideoTaskInputs])

  const setVideoAspectRatio = useCallback(
    async (value: AiVideoAspectRatio) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.aspectRatio = value
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoResolution = useCallback(
    async (value: AiVideoResolution) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.resolution = value
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoDuration = useCallback(
    async (value: AiVideoDuration) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.duration = normalizeVideoDurationForModel(
        value,
        nextVideoMeta.model,
        nextVideoMeta.duration
      )
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const setVideoOutputCount = useCallback(
    async (value: number) => {
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      nextVideoMeta.outputCount = normalizePositiveInteger(value, nextVideoMeta.outputCount, 4)
      await syncVideoTaskInputs(task, nextVideoMeta)
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const useOutputAsVideoReference = useCallback(
    async (filePath: string) => {
      const normalizedPath = String(filePath ?? '').trim()
      if (!normalizedPath) return false
      const task = await ensureVideoDraftTask()
      const nextVideoMeta = readVideoMetadata(task)
      if (nextVideoMeta.mode === 'first-last-frame') {
        if (!nextVideoMeta.firstFramePath || nextVideoMeta.firstFramePath === normalizedPath) {
          nextVideoMeta.firstFramePath = normalizedPath
        } else {
          nextVideoMeta.lastFramePath = normalizedPath
        }
      } else {
        nextVideoMeta.subjectReferencePath = normalizedPath
      }
      await syncVideoTaskInputs(task, nextVideoMeta)
      return true
    },
    [ensureVideoDraftTask, syncVideoTaskInputs]
  )

  const useOutputAsVideoSubjectReference = useCallback(
    async (filePath: string) => {
      const normalizedPath = String(filePath ?? '').trim()
      if (!normalizedPath) return false
      const latestVideoTask =
        taskViews
          .filter((task) => readTaskCapability(task) === 'video')
          .slice()
          .sort((left, right) => right.createdAt - left.createdAt || right.updatedAt - left.updatedAt)[0] ?? null
      await createVideoTask({
        inheritFrom: latestVideoTask,
        promptExtraOverride: '',
        videoMetaOverride: {
          mode: 'subject-reference',
          subjectReferencePath: normalizedPath
        }
      })
      setStudioCapabilityState('video')
      return true
    },
    [createVideoTask, taskViews]
  )

  const applyInputSelection = useCallback(
    async (payload: { primaryImagePath: string | null; referenceImagePaths: string[] }) => {
      const normalizedPrimary = String(payload.primaryImagePath ?? '').trim() || null
      const normalizedReferences = normalizeReferencePaths(
        payload.referenceImagePaths,
        normalizedPrimary
      )
      const currentTask = activeTask

      if (!currentTask) {
        return createTaskWithInputs({
          primaryImagePath: normalizedPrimary,
          referenceImagePaths: normalizedReferences
        })
      }

      const inputsChanged =
        normalizedPrimary !== currentTask.primaryImagePath ||
        !sameStringArray(normalizedReferences, currentTask.referenceImagePaths)
      if (!inputsChanged) return currentTask

      const needsReset =
        currentTask.outputAssets.length > 0 ||
        Boolean(currentTask.latestRunId) ||
        Boolean(currentTask.remoteTaskId) ||
        currentTask.status === 'running' ||
        currentTask.status === 'completed' ||
        currentTask.status === 'failed'

      if (needsReset) {
        const confirmed = await confirmResetGeneratedTask()
        if (!confirmed) return currentTask
        const replacement = await createTaskWithInputs({
          primaryImagePath: normalizedPrimary,
          referenceImagePaths: normalizedReferences,
          inheritFrom: currentTask
        })
        setSelectedTaskIds([replacement.id])
        setActiveTaskId(replacement.id)
        return replacement
      }

      return syncTaskInputs(currentTask, normalizedPrimary, normalizedReferences)
    },
    [activeTask, createTaskWithInputs, syncTaskInputs]
  )

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((value) => value !== taskId)
        : uniqueStrings([...prev, taskId])
    )
  }, [])

  const setOutputSelectionForTask = useCallback(
    async (taskId: string, assetIds: string[], selected: boolean, clearOthers?: boolean) => {
      const normalizedTaskId = String(taskId ?? '').trim()
      if (!normalizedTaskId) return [] as AiStudioAssetRecord[]
      const normalizedIds = uniqueStrings(assetIds)
      if (normalizedIds.length === 0) return [] as AiStudioAssetRecord[]
      const nextAssets = await window.api.cms.aiStudio.asset.markSelected({
        taskId: normalizedTaskId,
        assetIds: normalizedIds,
        selected,
        clearOthers
      })
      const normalized = (nextAssets ?? []).map(coerceAssetRecord)
      replaceAssets(normalized)
      return normalized
    },
    [replaceAssets]
  )

  const setOutputSelection = useCallback(
    async (assetIds: string[], selected: boolean, clearOthers?: boolean) => {
      if (!activeTask) return [] as AiStudioAssetRecord[]
      return setOutputSelectionForTask(activeTask.id, assetIds, selected, clearOthers)
    },
    [activeTask, setOutputSelectionForTask]
  )

  const toggleOutputSelection = useCallback(
    async (assetId: string) => {
      if (!activeTask) return [] as AiStudioAssetRecord[]
      const target = activeOutputAssets.find((asset) => asset.id === assetId)
      if (!target) return [] as AiStudioAssetRecord[]
      return setOutputSelectionForTask(activeTask.id, [assetId], !target.selected, false)
    },
    [activeOutputAssets, activeTask, setOutputSelectionForTask]
  )

  const toggleDispatchOutputSelectionForTask = useCallback(
    async (taskId: string, assetId: string) => {
      const targetTask = taskViews.find((task) => task.id === taskId)
      if (!targetTask) return [] as AiStudioAssetRecord[]
      const dispatchAssets = selectDispatchOutputAssets(targetTask)
      const target = dispatchAssets.find((asset) => asset.id === assetId)
      if (!target) return [] as AiStudioAssetRecord[]
      return setOutputSelectionForTask(taskId, [assetId], !target.selected, false)
    },
    [setOutputSelectionForTask, taskViews]
  )

  const toggleDispatchOutputPoolForTask = useCallback(
    async (taskId: string, assetId: string) => {
      return toggleDispatchOutputSelectionForTask(taskId, assetId)
    },
    [toggleDispatchOutputSelectionForTask]
  )

  const assignPrimaryImage = useCallback(
    async (filePath: string | null) => {
      const normalized = String(filePath ?? '').trim() || null
      const nextReferences = normalized
        ? referenceImagePaths.filter((item) => item !== normalized)
        : referenceImagePaths
      await applyInputSelection({
        primaryImagePath: normalized,
        referenceImagePaths: nextReferences
      })
    },
    [applyInputSelection, referenceImagePaths]
  )

  const addReferenceImages = useCallback(
    async (filePaths: string[]) => {
      const normalizedIncoming = uniqueStrings(filePaths).filter(
        (item) => item !== primaryImagePath
      )
      if (normalizedIncoming.length === 0) {
        return { added: 0, overflow: 0 }
      }
      const current = referenceImagePaths
      const existingSet = new Set(current)
      const dedupedIncoming = normalizedIncoming.filter((item) => !existingSet.has(item))
      const nextReferences = normalizeReferencePaths(
        [...current, ...dedupedIncoming],
        primaryImagePath
      )
      const added = nextReferences.filter((item) => !existingSet.has(item)).length
      const overflow = Math.max(0, current.length + dedupedIncoming.length - nextReferences.length)
      await applyInputSelection({ primaryImagePath, referenceImagePaths: nextReferences })
      return { added, overflow }
    },
    [applyInputSelection, primaryImagePath, referenceImagePaths]
  )

  const removeReferenceImage = useCallback(
    async (filePath: string) => {
      const normalized = String(filePath ?? '').trim()
      if (!normalized) return
      const nextReferences = referenceImagePaths.filter((item) => item !== normalized)
      await applyInputSelection({ primaryImagePath, referenceImagePaths: nextReferences })
    },
    [applyInputSelection, primaryImagePath, referenceImagePaths]
  )

  const toggleReferenceImage = useCallback(
    async (filePath: string) => {
      const normalized = String(filePath ?? '').trim()
      if (!normalized) return
      if (referenceImagePaths.includes(normalized)) {
        await removeReferenceImage(normalized)
        return
      }
      await addReferenceImages([normalized])
    },
    [addReferenceImages, referenceImagePaths, removeReferenceImage]
  )

  const upsertAssetsRemote = useCallback(
    async (
      writes: Array<{
        id?: string
        taskId: string
        runId?: string | null
        kind?: 'input' | 'output'
        role?: string
        filePath: string
        previewPath?: string | null
        originPath?: string | null
        selected?: boolean
        sortOrder?: number
        metadata?: Record<string, unknown>
      }>
    ) => {
      const saved = await window.api.cms.aiStudio.asset.upsert(writes)
      const normalized = (saved ?? []).map(coerceAssetRecord)
      replaceAssets(normalized)
      return normalized
    },
    [replaceAssets]
  )

  const saveTemplate = useCallback(
    async (payload: { templateId?: string | null; name: string; promptText: string }) => {
      const saved = coerceTemplateRecord(
        await window.api.cms.aiStudio.template.upsert({
          id: String(payload.templateId ?? '').trim() || undefined,
          provider: 'grsai',
          capability: studioCapability,
          name: String(payload.name ?? '').trim(),
          promptText: String(payload.promptText ?? '').trim()
        })
      )
      replaceTemplate(saved)
      return saved
    },
    [replaceTemplate, studioCapability]
  )

  const deleteTemplate = useCallback(async (templateId: string) => {
    const normalizedId = String(templateId ?? '').trim()
    if (!normalizedId) return false
    const result = await window.api.cms.aiStudio.template.delete({ templateId: normalizedId })
    if (!result?.success) return false
    setTemplates((prev) => prev.filter((template) => template.id !== normalizedId))
    return true
  }, [])

  const loadLatestTaskRecord = useCallback(async (taskId: string) => {
    const row = await window.api.cms.aiStudio.task
      .list({ ids: [taskId], limit: 1 })
      .then((rows) => rows[0])
    return row ? coerceTaskRecord(row) : null
  }, [])

  const workflowMeta = useMemo(
    () =>
      activeTask && readTaskCapability(activeTask) === 'image'
        ? readWorkflowMetadata({
            templateId: activeTask.templateId,
            promptExtra: activeTask.promptExtra,
            primaryImagePath: activeTask.primaryImagePath,
            referenceImagePaths: activeTask.referenceImagePaths,
            metadata: activeTask.metadata
          })
        : null,
    [activeTask]
  )

  const selectedMasterTemplate = useMemo(() => {
    if (!workflowMeta?.masterStage.templateId) return null
    return (
      templateOptions.find((template) => template.id === workflowMeta.masterStage.templateId) ??
      null
    )
  }, [templateOptions, workflowMeta])

  const selectedChildTemplate = useMemo(() => {
    if (!workflowMeta?.childStage.templateId) return null
    return (
      templateOptions.find((template) => template.id === workflowMeta.childStage.templateId) ?? null
    )
  }, [templateOptions, workflowMeta])

  const selectedTemplate = selectedMasterTemplate
  const masterOutputCount = workflowMeta?.masterStage.requestedCount ?? 3
  const childOutputCount = workflowMeta?.childStage.requestedCount ?? 4
  const masterPromptExtra = workflowMeta?.masterStage.promptExtra ?? ''
  const childPromptExtra = workflowMeta?.childStage.promptExtra ?? ''
  const variantLines = workflowMeta?.childStage.variantLines ?? []
  const activeStage = workflowMeta?.workflow.activeStage ?? 'master-setup'

  const masterRawAssets = useMemo(
    () => activeOutputAssets.filter((asset) => asset.role === AI_STUDIO_MASTER_OUTPUT_ROLE),
    [activeOutputAssets]
  )
  const masterCleanAssets = useMemo(
    () => activeOutputAssets.filter((asset) => asset.role === AI_STUDIO_MASTER_CLEAN_ROLE),
    [activeOutputAssets]
  )
  const childOutputAssets = useMemo(
    () => activeOutputAssets.filter((asset) => asset.role === AI_STUDIO_CHILD_OUTPUT_ROLE),
    [activeOutputAssets]
  )
  const videoOutputAssets = useMemo(
    () => activeOutputAssets.filter((asset) => asset.role === AI_STUDIO_VIDEO_OUTPUT_ROLE),
    [activeOutputAssets]
  )
  const currentAiMasterAsset = useMemo(() => {
    const currentId = workflowMeta?.workflow.currentAiMasterAssetId ?? ''
    if (!currentId) return null
    return masterCleanAssets.find((asset) => asset.id === currentId) ?? null
  }, [masterCleanAssets, workflowMeta])
  const dispatchOutputAssets = useMemo(() => {
    if (videoOutputAssets.length > 0) return videoOutputAssets
    return childOutputAssets.length > 0 ? childOutputAssets : masterCleanAssets
  }, [childOutputAssets, masterCleanAssets, videoOutputAssets])
  const pooledOutputAssets = useMemo(
    () =>
      historyTasks.flatMap((task) =>
        selectDispatchOutputAssets(task).filter((asset) => asset.selected)
      ),
    [historyTasks]
  )
  const pooledOutputCount = pooledOutputAssets.length
  const activeSelectedDispatchOutputAssets = useMemo(
    () => dispatchOutputAssets.filter((asset) => asset.selected),
    [dispatchOutputAssets]
  )
  const activeSelectedDispatchOutputIds = useMemo(
    () => activeSelectedDispatchOutputAssets.map((asset) => asset.id),
    [activeSelectedDispatchOutputAssets]
  )

  const selectAllDispatchOutputsForTask = useCallback(
    async (taskId: string) => {
      const targetTask = taskViews.find((task) => task.id === taskId)
      if (!targetTask) return [] as AiStudioAssetRecord[]
      const assetIds = selectDispatchOutputAssets(targetTask).map((asset) => asset.id)
      if (assetIds.length === 0) return [] as AiStudioAssetRecord[]
      return setOutputSelectionForTask(taskId, assetIds, true, true)
    },
    [setOutputSelectionForTask, taskViews]
  )

  const clearSelectedDispatchOutputsForTask = useCallback(
    async (taskId: string) => {
      const targetTask = taskViews.find((task) => task.id === taskId)
      if (!targetTask) return [] as AiStudioAssetRecord[]
      const assetIds = selectDispatchOutputAssets(targetTask).map((asset) => asset.id)
      if (assetIds.length === 0) return [] as AiStudioAssetRecord[]
      return setOutputSelectionForTask(taskId, assetIds, false, false)
    },
    [setOutputSelectionForTask, taskViews]
  )

  const selectAllDispatchOutputs = useCallback(async () => {
    if (!activeTask) return [] as AiStudioAssetRecord[]
    return selectAllDispatchOutputsForTask(activeTask.id)
  }, [activeTask, selectAllDispatchOutputsForTask])

  const clearSelectedDispatchOutputs = useCallback(async () => {
    if (!activeTask) return [] as AiStudioAssetRecord[]
    return clearSelectedDispatchOutputsForTask(activeTask.id)
  }, [activeTask, clearSelectedDispatchOutputsForTask])

  const prepareNextDraftTask = useCallback(async () => {
    if (studioCapability === 'video') {
      if (
        activeTask &&
        readTaskCapability(activeTask) === 'video' &&
        activeTask.status === 'draft' &&
        activeTask.outputAssets.length === 0 &&
        !activeTask.latestRunId &&
        !activeTask.remoteTaskId
      ) {
        return activeTask
      }
      return createVideoTask({
        inheritFrom:
          (activeTask && readTaskCapability(activeTask) === 'video' ? activeTask : null) ??
          taskViews.find((task) => readTaskCapability(task) === 'video') ??
          null,
        promptExtraOverride: ''
      })
    }

    if (
      activeTask &&
      activeTask.status === 'draft' &&
      activeTask.outputAssets.length === 0 &&
      !activeTask.latestRunId &&
      !activeTask.remoteTaskId
    ) {
      return activeTask
    }

    return createTaskWithInputs({
      primaryImagePath: null,
      referenceImagePaths: [],
      inheritFrom: activeTask,
      promptExtraOverride: '',
      templateIdOverride: null
    })
  }, [activeTask, createTaskWithInputs, createVideoTask, studioCapability, taskViews])

  const useDispatchOutputAsReference = useCallback(
    async (filePath: string) => {
      const normalizedPath = String(filePath ?? '').trim()
      if (!normalizedPath) return false

      const draftTask =
        activeTask &&
        activeTask.status === 'draft' &&
        activeTask.outputAssets.length === 0 &&
        !activeTask.latestRunId &&
        !activeTask.remoteTaskId
          ? activeTask
          : await prepareNextDraftTask()

      if (!draftTask) return false
      if (
        draftTask.primaryImagePath === normalizedPath ||
        draftTask.referenceImagePaths.includes(normalizedPath)
      ) {
        return false
      }

      const nextPrimaryImagePath = draftTask.primaryImagePath ?? normalizedPath
      const nextReferenceImagePaths = draftTask.primaryImagePath
        ? [...draftTask.referenceImagePaths, normalizedPath]
        : draftTask.referenceImagePaths
      const nextInputCount = uniqueStrings(
        [nextPrimaryImagePath, ...nextReferenceImagePaths].filter(Boolean) as string[]
      ).length

      if (nextInputCount > MAX_AI_STUDIO_REFERENCE_IMAGES) {
        throw new Error(`最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张参考图。`)
      }

      await syncTaskInputs(draftTask, nextPrimaryImagePath, nextReferenceImagePaths)
      return true
    },
    [activeTask, prepareNextDraftTask, syncTaskInputs]
  )

  const sendSelectedDispatchOutputsToWorkshop = useCallback(
    async (taskId?: string) => {
      const targetTaskId = String(taskId ?? activeTask?.id ?? '').trim()
      const targetTask = taskViews.find((task) => task.id === targetTaskId) ?? null
      const targetDispatchOutputAssets = targetTask ? selectDispatchOutputAssets(targetTask) : []
      const selectedAssets = targetDispatchOutputAssets.filter((asset) => asset.selected)
      const paths = uniqueStrings(
        selectedAssets.map((asset) => String(asset.filePath ?? '').trim())
      )
      if (paths.length === 0) {
        throw new Error(
          studioCapability === 'video' ? '请先选择至少一个视频结果。' : '请先选择至少一张结果图。'
        )
      }

      const isVideo = Boolean(
        targetTask &&
        (readTaskCapability(targetTask) === 'video' ||
          selectedAssets.some((asset) => asset.role === AI_STUDIO_VIDEO_OUTPUT_ROLE))
      )

      if (isVideo) {
        setWorkshopImport(
          'video',
          paths[0] ?? null,
          selectedAssets[0]?.previewPath ?? null,
          paths,
          'ai-studio'
        )
        setActiveModule('workshop')
        addLog(`[AI Studio] 已将 ${paths.length} 个视频结果发送到数据工坊。`)
        return paths
      }

      await prepareNextDraftTask()
      setWorkshopImport('image', paths[0] ?? null, null, paths, 'ai-studio')
      setActiveModule('workshop')
      addLog(`[AI Studio] 已将 ${paths.length} 张结果图发送到数据工坊。`)
      return paths
    },
    [
      activeTask,
      addLog,
      prepareNextDraftTask,
      setActiveModule,
      setWorkshopImport,
      studioCapability,
      taskViews
    ]
  )

  const sendPooledOutputsToWorkshop = useCallback(async () => {
    const plan = buildPoolDispatchPlan({
      action: 'workshop',
      studioCapability,
      assets: pooledOutputAssets
    })

    if (plan.mediaType === 'video') {
      setWorkshopImport(
        'video',
        plan.paths[0] ?? null,
        pooledOutputAssets[0]?.previewPath ?? null,
        plan.paths,
        'ai-studio'
      )
      setActiveModule('workshop')
      addLog(`[AI Studio] 已将素材池中的 ${plan.paths.length} 个视频发送到数据工坊。`)
    } else {
      await prepareNextDraftTask()
      setWorkshopImport('image', plan.paths[0] ?? null, null, plan.paths, 'ai-studio')
      setActiveModule('workshop')
      addLog(`[AI Studio] 已将素材池中的 ${plan.paths.length} 张结果图发送到数据工坊。`)
    }

    if (plan.clearSelection) {
      const groupedAssetIds = new Map<string, string[]>()
      pooledOutputAssets.forEach((asset) => {
        const group = groupedAssetIds.get(asset.taskId) ?? []
        group.push(asset.id)
        groupedAssetIds.set(asset.taskId, group)
      })

      await Promise.all(
        Array.from(groupedAssetIds.entries()).map(([taskId, assetIds]) =>
          setOutputSelectionForTask(taskId, assetIds, false, false)
        )
      )
    }

    return plan.paths
  }, [
    addLog,
    pooledOutputAssets,
    prepareNextDraftTask,
    setActiveModule,
    setOutputSelectionForTask,
    setWorkshopImport,
    studioCapability
  ])

  const sendPooledOutputsToVideoComposer = useCallback(async () => {
    const plan = buildPoolDispatchPlan({
      action: 'remix',
      studioCapability,
      assets: pooledOutputAssets
    })

    setMaterialImport(plan.paths, 'aiStudio', 'video')
    setActiveModule('material')
    addLog(`[AI Studio] 已将素材池中的 ${plan.paths.length} 张图片发送到素材处理的视频处理模块。`)
    return plan.paths
  }, [addLog, pooledOutputAssets, setActiveModule, setMaterialImport, studioCapability])

  const failureRecords = workflowMeta?.workflow.failures ?? []
  const stageProgress = useMemo(
    () =>
      workflowMeta
        ? buildStageProgress(workflowMeta)
        : {
            stage: 'master-setup' as AiStudioWorkflowStage,
            currentLabel: '待开始',
            currentIndex: 0,
            currentTotal: 0,
            totalCompleted: 0,
            totalPlanned: 0,
            successCount: 0,
            failureCount: 0
          },
    [workflowMeta]
  )

  const patchWorkflowMetadata = useCallback(
    async (
      task: AiStudioTaskView,
      updater: (draft: AiStudioWorkflowMetadata) => void,
      extraPatch?: Record<string, unknown>
    ) => {
      const latestTask = await loadLatestTaskRecord(task.id)
      const baseTask = latestTask ?? task
      const nextWorkflow = JSON.parse(
        JSON.stringify(readWorkflowMetadata(baseTask))
      ) as AiStudioWorkflowMetadata
      updater(nextWorkflow)
      return updateTaskPatch(baseTask.id, {
        ...(extraPatch ?? {}),
        metadata: writeWorkflowMetadata(baseTask, nextWorkflow)
      })
    },
    [loadLatestTaskRecord, updateTaskPatch]
  )

  const seedDemoTask = useCallback(async () => {
    const seed = Date.now()
    const childVariantLines = [
      '通勤街景版本 · 保持母图氛围延续',
      '橱窗近景版本 · 强化层次与留白',
      '楼梯转角版本 · 保持服装主体完整',
      '室内镜面版本 · 增加一点高级感反射'
    ]

    const primaryImagePath = await saveAiStudioDemoImage({
      filename: `ai-studio-demo-primary-${seed}.jpg`,
      label: '主图',
      accent: '#F59E0B',
      backgroundStart: '#23131A',
      backgroundEnd: '#4A1D34',
      note: '正式 UI 联调\n作为主图输入'
    })

    const referenceImagePaths = await Promise.all([
      saveAiStudioDemoImage({
        filename: `ai-studio-demo-reference-a-${seed}.jpg`,
        label: '参考 A',
        accent: '#22C55E',
        backgroundStart: '#0F172A',
        backgroundEnd: '#134E4A',
        note: '参考构图\n参考材质'
      }),
      saveAiStudioDemoImage({
        filename: `ai-studio-demo-reference-b-${seed}.jpg`,
        label: '参考 B',
        accent: '#38BDF8',
        backgroundStart: '#1F2937',
        backgroundEnd: '#312E81',
        note: '参考姿态\n参考氛围'
      })
    ])

    const created = await createTaskWithInputs({
      primaryImagePath,
      referenceImagePaths
    })

    const latestTask = await loadLatestTaskRecord(created.id)
    if (!latestTask) {
      throw new Error('[AI Studio] 联调任务创建成功，但读取任务详情失败。')
    }

    const masterCleanPath = await saveAiStudioDemoImage({
      filename: `ai-studio-demo-master-clean-${seed}.jpg`,
      label: 'AI母图',
      accent: '#F97316',
      backgroundStart: '#111827',
      backgroundEnd: '#4C1D95',
      note: '去印完成\n可作为当前 AI 母图'
    })

    const childOutputPaths = await Promise.all(
      childVariantLines.map((line, index) =>
        saveAiStudioDemoImage({
          filename: `ai-studio-demo-child-${index + 1}-${seed}.jpg`,
          label: `子图 ${index + 1}`,
          accent: ['#F59E0B', '#10B981', '#60A5FA', '#F472B6'][index % 4] ?? '#F59E0B',
          backgroundStart: ['#221B1B', '#0F172A', '#1F2937', '#2D1B69'][index % 4] ?? '#221B1B',
          backgroundEnd: ['#5B2C2C', '#164E63', '#3B0764', '#7C2D12'][index % 4] ?? '#5B2C2C',
          note: line
        })
      )
    )

    const masterCleanAssetId = `${latestTask.id}:output:master-clean:1`
    await upsertAssetsRemote([
      {
        id: masterCleanAssetId,
        taskId: latestTask.id,
        runId: null,
        kind: 'output',
        role: AI_STUDIO_MASTER_CLEAN_ROLE,
        filePath: masterCleanPath,
        previewPath: masterCleanPath,
        originPath: primaryImagePath,
        selected: false,
        sortOrder: 100,
        metadata: {
          demo: true,
          stage: 'master',
          sequenceIndex: 1,
          watermarkStatus: 'succeeded'
        }
      },
      ...childOutputPaths.map((filePath, index) => ({
        id: `${latestTask.id}:output:child:${index + 1}`,
        taskId: latestTask.id,
        runId: null,
        kind: 'output' as const,
        role: AI_STUDIO_CHILD_OUTPUT_ROLE,
        filePath,
        previewPath: filePath,
        originPath: masterCleanPath,
        selected: true,
        sortOrder: 200 + index,
        metadata: {
          demo: true,
          stage: 'child',
          sequenceIndex: index + 1,
          variantText: childVariantLines[index] ?? ''
        }
      }))
    ])

    const workflow = resetWorkflowMetadataForInputs({
      templateId: latestTask.templateId,
      promptExtra: latestTask.promptExtra,
      primaryImagePath: latestTask.primaryImagePath,
      referenceImagePaths: latestTask.referenceImagePaths,
      metadata: latestTask.metadata
    })
    workflow.workflow.activeStage = 'completed'
    workflow.workflow.currentAiMasterAssetId = masterCleanAssetId
    workflow.workflow.currentItemKind = 'idle'
    workflow.workflow.currentItemIndex = 0
    workflow.workflow.currentItemTotal = childVariantLines.length
    workflow.masterStage.requestedCount = 1
    workflow.masterStage.completedCount = 1
    workflow.masterStage.cleanSuccessCount = 1
    workflow.masterStage.cleanFailedCount = 0
    workflow.childStage.requestedCount = childVariantLines.length
    workflow.childStage.variantLines = childVariantLines
    workflow.childStage.completedCount = childVariantLines.length
    workflow.childStage.failedCount = 0

    await updateTaskPatch(latestTask.id, {
      status: 'completed',
      metadata: writeWorkflowMetadata(latestTask, workflow)
    })

    await refresh()
    setSelectedTaskIds([latestTask.id])
    setActiveTaskId(latestTask.id)
    addLog(`[AI Studio] 已注入 ${childOutputPaths.length} 张联调子图，可直接发送到数据工坊。`)
    return latestTask.id
  }, [
    addLog,
    createTaskWithInputs,
    loadLatestTaskRecord,
    refresh,
    updateTaskPatch,
    upsertAssetsRemote
  ])

  const setMasterTemplateId = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.masterStage.templateId = value || null
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setChildTemplateId = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.childStage.templateId = value || null
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setMasterPromptExtra = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.masterStage.promptExtra = value
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setChildPromptExtra = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.childStage.promptExtra = value
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setMasterOutputCount = useCallback(
    async (value: number) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.masterStage.requestedCount = Math.max(1, Math.floor(value || 1))
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setChildOutputCount = useCallback(
    async (value: number) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.childStage.requestedCount = Math.max(1, Math.floor(value || 1))
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setVariantLines = useCallback(
    async (lines: string[]) => {
      if (!activeTask) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.childStage.variantLines = normalizeVariantLines(lines)
      })
    },
    [activeTask, patchWorkflowMetadata]
  )

  const saveStageTemplate = useCallback(
    async (
      stage: 'master' | 'child',
      payload: { templateId?: string | null; name: string; promptText: string }
    ) => {
      const saved = coerceTemplateRecord(
        await window.api.cms.aiStudio.template.upsert({
          id: String(payload.templateId ?? '').trim() || undefined,
          provider: 'grsai',
          capability: 'image',
          name: String(payload.name ?? '').trim(),
          promptText: String(payload.promptText ?? '').trim()
        })
      )
      replaceTemplate(saved)
      if (activeTask) {
        await patchWorkflowMetadata(activeTask, (draft) => {
          if (stage === 'master') draft.masterStage.templateId = saved.id
          else draft.childStage.templateId = saved.id
        })
      }
      return saved
    },
    [activeTask, patchWorkflowMetadata, replaceTemplate]
  )

  const setPromptExtra = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await patchWorkflowMetadata(
        activeTask,
        (draft) => {
          draft.masterStage.promptExtra = value
          draft.childStage.promptExtra = value
        },
        { promptExtra: value }
      )
    },
    [activeTask, patchWorkflowMetadata]
  )

  const setOutputCount = useCallback(
    async (value: number) => {
      if (!activeTask) return
      await setMasterOutputCount(value)
    },
    [activeTask, setMasterOutputCount]
  )

  const setAspectRatio = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await updateTaskPatch(activeTask.id, { aspectRatio: value || '3:4' })
    },
    [activeTask, updateTaskPatch]
  )

  const setImageProvider = useCallback(
    async (value: string) => {
      const task = await ensureImageDraftTask()
      const nextSelection = resolveImageProviderSelection(value, '')
      await updateTaskPatch(task.id, {
        provider: nextSelection.providerName || normalizeAiProviderValue(value) || task.provider,
        model: nextSelection.modelName || task.model || defaultModel || DEFAULT_GRSAI_IMAGE_MODEL
      })
    },
    [defaultModel, ensureImageDraftTask, resolveImageProviderSelection, updateTaskPatch]
  )

  const setImageModel = useCallback(
    async (payload: { provider?: string | null; model: string }) => {
      const task = await ensureImageDraftTask()
      const nextSelection = resolveImageProviderSelection(payload.provider ?? task.provider, payload.model)
      await updateTaskPatch(task.id, {
        provider:
          nextSelection.providerName ||
          normalizeAiProviderValue(payload.provider) ||
          task.provider,
        model:
          nextSelection.modelName ||
          payload.model ||
          task.model ||
          defaultModel ||
          DEFAULT_GRSAI_IMAGE_MODEL
      })
    },
    [defaultModel, ensureImageDraftTask, resolveImageProviderSelection, updateTaskPatch]
  )

  const setModel = useCallback(
    async (value: string) => {
      await setImageModel({ model: value })
    },
    [setImageModel]
  )

  const setTemplateId = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await setMasterTemplateId(value)
    },
    [activeTask, setMasterTemplateId]
  )

  const selectedTemplateBase = useMemo(() => {
    if (!activeTask?.templateId) return null
    return templateOptions.find((template) => template.id === activeTask.templateId) ?? null
  }, [activeTask?.templateId, templateOptions])

  const executeRunToTerminal = useCallback(
    async (taskId: string) => {
      if (isTaskInterruptRequested(taskId)) {
        throw createTaskInterruptedError()
      }

      const taskCapability = readTaskCapability(
        taskViews.find((item) => item.id === taskId) ?? null
      )
      const maxPollAttempts = taskCapability === 'video' ? 360 : 240
      let result = await window.api.cms.aiStudio.task.startRun({ taskId })
      let guard = 0
      while (
        result.status !== 'succeeded' &&
        result.status !== 'failed' &&
        guard < maxPollAttempts
      ) {
        if (isTaskInterruptRequested(taskId)) {
          throw createTaskInterruptedError()
        }
        await sleepMs(2500)
        if (isTaskInterruptRequested(taskId)) {
          throw createTaskInterruptedError()
        }
        result = await window.api.cms.aiStudio.task.pollRun({ taskId, runId: result.run.id })
        guard += 1
      }
      if (isTaskInterruptRequested(taskId)) {
        throw createTaskInterruptedError()
      }
      if (result.status !== 'succeeded' && result.status !== 'failed') {
        throw new Error('[AI Studio] 任务轮询超时，请稍后重试。')
      }
      await refresh()
      return result
    },
    [isTaskInterruptRequested, refresh, taskViews]
  )

  const processMasterCleanup = useCallback(
    async (
      task: Pick<AiStudioTaskRecord, 'id'>,
      rawAsset: AiStudioAssetRecord,
      sequenceIndex: number
    ) => {
      const [nextRawAsset, cleanAsset] = buildSkippedMasterCleanupAssets(rawAsset, sequenceIndex)
      await upsertAssetsRemote([
        {
          ...nextRawAsset,
          taskId: task.id
        },
        {
          ...cleanAsset,
          taskId: task.id,
          role: AI_STUDIO_MASTER_CLEAN_ROLE
        }
      ])
    },
    [upsertAssetsRemote]
  )

  const startVideoWorkflow = useCallback(
    async (payload?: { taskId?: string | null; promptText?: string; onStarted?: () => void }) => {
      const sourceTaskView =
        (payload?.taskId ? (taskViews.find((item) => item.id === payload.taskId) ?? null) : null) ??
        (activeTask && readTaskCapability(activeTask) === 'video' ? activeTask : null)
      const sourceVideoMeta =
        sourceTaskView && readTaskCapability(sourceTaskView) === 'video'
          ? readVideoMetadata(sourceTaskView)
          : videoMeta
      const sourceProviderName = normalizeAiProviderValue(sourceTaskView?.provider)
      const sourceProviderProfile = findAiProviderProfile(
        Array.isArray(aiConfig.aiProviderProfiles) ? aiConfig.aiProviderProfiles : [],
        sourceProviderName
      )

      if (!sourceProviderName || !sourceProviderProfile) {
        throw new Error('[AI Studio] 请先在模型设置中创建并选择视频供应商。')
      }
      if (!sourceProviderProfile.apiKey.trim()) {
        throw new Error('[AI Studio] 请先填写视频供应商 API Key。')
      }
      if (!sourceVideoMeta.model.trim()) {
        throw new Error('[AI Studio] 请先选择或保存视频模型。')
      }
      if (!sourceVideoMeta.submitPath.trim()) {
        throw new Error('[AI Studio] 请先填写视频模型 API 端点。')
      }

      const effectivePromptText =
        payload?.promptText !== undefined
          ? String(payload.promptText ?? '').trim()
          : String(sourceTaskView?.promptExtra ?? '').trim()
      if (!effectivePromptText) {
        throw new Error('[AI Studio] 请先输入提示词。')
      }
      if (sourceVideoMeta.mode === 'subject-reference' && !sourceVideoMeta.subjectReferencePath) {
        throw new Error('[AI Studio] 请先添加主体参考图。')
      }
      if (
        sourceVideoMeta.mode === 'first-last-frame' &&
        (!sourceVideoMeta.firstFramePath || !sourceVideoMeta.lastFramePath)
      ) {
        throw new Error('[AI Studio] 请先补齐首尾帧。')
      }

      const sourceOutputCount = sourceTaskView?.outputAssets.length ?? 0
      const needsReset =
        !sourceTaskView ||
        sourceOutputCount > 0 ||
        Boolean(sourceTaskView.latestRunId) ||
        Boolean(sourceTaskView.remoteTaskId) ||
        sourceTaskView.status === 'running' ||
        sourceTaskView.status === 'completed' ||
        sourceTaskView.status === 'failed'

      const preparedTask = needsReset
        ? await createVideoTask({
            inheritFrom: sourceTaskView,
            promptExtraOverride: effectivePromptText,
            videoMetaOverride: sourceVideoMeta
          })
        : sourceTaskView
      if (!preparedTask) return null

      const workingTask = (await loadLatestTaskRecord(preparedTask.id)) ?? preparedTask

      clearTaskInterrupt(workingTask.id)

      const initialVideoMeta = readVideoMetadata(workingTask)
      initialVideoMeta.mode = sourceVideoMeta.mode
      initialVideoMeta.profileId = sourceVideoMeta.profileId
      initialVideoMeta.model = sourceVideoMeta.model
      initialVideoMeta.adapterKind = sourceVideoMeta.adapterKind
      initialVideoMeta.submitPath = sourceVideoMeta.submitPath
      initialVideoMeta.queryPath = sourceVideoMeta.queryPath
      initialVideoMeta.subjectReferencePath = sourceVideoMeta.subjectReferencePath
      initialVideoMeta.firstFramePath = sourceVideoMeta.firstFramePath
      initialVideoMeta.lastFramePath = sourceVideoMeta.lastFramePath
      initialVideoMeta.aspectRatio = sourceVideoMeta.aspectRatio
      initialVideoMeta.resolution = sourceVideoMeta.resolution
      initialVideoMeta.duration = sourceVideoMeta.duration
      initialVideoMeta.outputCount = sourceVideoMeta.outputCount
      initialVideoMeta.completedCount = 0
      initialVideoMeta.failedCount = 0
      initialVideoMeta.currentItemIndex = 0
      initialVideoMeta.currentItemTotal = sourceVideoMeta.outputCount
      initialVideoMeta.failures = []

      let task = await updateTaskPatch(workingTask.id, {
        promptExtra: effectivePromptText,
        model: initialVideoMeta.model,
        aspectRatio: initialVideoMeta.aspectRatio,
        outputCount: 1,
        status: 'running',
        remoteTaskId: null,
        latestRunId: null,
        metadata: writeVideoMetadata(workingTask, initialVideoMeta)
      })
      await refresh()
      payload?.onStarted?.()

      await createVideoTask({
        inheritFrom: task,
        promptExtraOverride: '',
        videoMetaOverride: {
          subjectReferencePath: null,
          firstFramePath: null,
          lastFramePath: null
        }
      })

      replacePreviewSlotRuntimeStates(
        task.id,
        buildQueuedPreviewSlotRuntimeStates(initialVideoMeta.outputCount)
      )

      let wasInterrupted = false

      try {
        for (let index = 1; index <= initialVideoMeta.outputCount; index += 1) {
          const latestTask = (await loadLatestTaskRecord(task.id)) ?? task
          if (!latestTask) break
          const loopVideoMeta = readVideoMetadata(latestTask)
          loopVideoMeta.currentItemIndex = index
          loopVideoMeta.currentItemTotal = loopVideoMeta.outputCount
          task = await updateTaskPatch(latestTask.id, {
            promptExtra: effectivePromptText,
            model: loopVideoMeta.model,
            aspectRatio: loopVideoMeta.aspectRatio,
            outputCount: 1,
            status: 'running',
            metadata: writeVideoMetadata(latestTask, loopVideoMeta)
          })
          patchPreviewSlotRuntimeState(task.id, index, {
            status: 'generating',
            message: '结果生成中'
          })

          try {
            const result = await executeRunToTerminal(latestTask.id)
            const outputAssets = (result.outputs ?? []).map(coerceAssetRecord)

            if (result.status === 'succeeded' && outputAssets.length > 0) {
              await upsertAssetsRemote(
                outputAssets.map((asset, outputIndex) => ({
                  id: asset.id,
                  taskId: latestTask.id,
                  runId: asset.runId,
                  kind: 'output',
                  role: AI_STUDIO_VIDEO_OUTPUT_ROLE,
                  filePath: asset.filePath,
                  previewPath: asset.previewPath,
                  originPath: asset.originPath,
                  selected: asset.selected,
                  sortOrder: asset.sortOrder,
                  metadata: {
                    ...(asset.metadata ?? {}),
                    stage: 'video',
                    sequenceIndex: index,
                    outputIndex,
                    videoMode: loopVideoMeta.mode,
                    profileId: loopVideoMeta.profileId
                  }
                }))
              )
              loopVideoMeta.completedCount += 1
              patchPreviewSlotRuntimeState(task.id, index, null)
            } else {
              const failureRecord = makeVideoFailureRecord(
                index,
                result.run?.errorMessage || '视频生成失败',
                result.run?.id
              )
              loopVideoMeta.failedCount += 1
              loopVideoMeta.failures.push(failureRecord)
              patchPreviewSlotRuntimeState(task.id, index, {
                status: 'failed',
                message: failureRecord.message
              })
            }
          } catch (error) {
            if (isTaskInterruptedError(error)) {
              const failureRecord = makeVideoFailureRecord(
                index,
                AI_STUDIO_TASK_INTERRUPTED_MESSAGE
              )
              wasInterrupted = true
              loopVideoMeta.failedCount += 1
              loopVideoMeta.failures.push(failureRecord)
              patchPreviewSlotRuntimeState(task.id, index, {
                status: 'failed',
                message: failureRecord.message
              })
              task = await updateTaskPatch(latestTask.id, {
                status: loopVideoMeta.completedCount > 0 ? 'completed' : 'failed',
                metadata: writeVideoMetadata(latestTask, loopVideoMeta),
                promptExtra: effectivePromptText,
                model: loopVideoMeta.model,
                aspectRatio: loopVideoMeta.aspectRatio,
                outputCount: 1
              })
              await refresh()
              break
            }

            const failureRecord = makeVideoFailureRecord(
              index,
              error instanceof Error ? error.message : String(error)
            )
            loopVideoMeta.failedCount += 1
            loopVideoMeta.failures.push(failureRecord)
            patchPreviewSlotRuntimeState(task.id, index, {
              status: 'failed',
              message: failureRecord.message
            })
          }

          task = await updateTaskPatch(latestTask.id, {
            status: 'running',
            metadata: writeVideoMetadata(latestTask, loopVideoMeta)
          })
          await refresh()
        }

        const finalTaskRecord = await loadLatestTaskRecord(task.id)
        if (!finalTaskRecord) return null
        const finalVideoMeta = readVideoMetadata(finalTaskRecord)
        finalVideoMeta.currentItemIndex = 0
        finalVideoMeta.currentItemTotal = finalVideoMeta.outputCount
        const finalStatus = finalVideoMeta.completedCount > 0 ? 'completed' : 'failed'
        await updateTaskPatch(finalTaskRecord.id, {
          status: wasInterrupted && finalVideoMeta.completedCount > 0 ? 'completed' : finalStatus,
          promptExtra: effectivePromptText,
          model: finalVideoMeta.model,
          aspectRatio: finalVideoMeta.aspectRatio,
          outputCount: 1,
          metadata: writeVideoMetadata(finalTaskRecord, finalVideoMeta)
        })
        await refresh()
        return true
      } finally {
        clearTaskInterrupt(task.id)
        clearPreviewSlotRuntimeStates(task.id)
      }
    },
    [
      activeTask,
      aiConfig.aiProviderProfiles,
      clearPreviewSlotRuntimeStates,
      clearTaskInterrupt,
      createVideoTask,
      executeRunToTerminal,
      loadLatestTaskRecord,
      patchPreviewSlotRuntimeState,
      refresh,
      replacePreviewSlotRuntimeStates,
      taskViews,
      updateTaskPatch,
      upsertAssetsRemote,
      videoMeta
    ]
  )

  const startMasterWorkflow = useCallback(
    async (payload?: {
      taskId?: string | null
      promptText?: string
      model?: string
      requestedCount?: number
      templateId?: string | null
      onStarted?: () => void
    }) => {
      const sourceTaskView =
        (payload?.taskId ? (taskViews.find((item) => item.id === payload.taskId) ?? null) : null) ??
        activeTask
      const sourceTask =
        sourceTaskView ?? (payload?.taskId ? await loadLatestTaskRecord(payload.taskId) : null)
      const sourceProviderSelection = resolveImageTaskProviderState(sourceTask)
      if (!sourceTask || !sourceProviderSelection.providerProfile) {
        throw new Error('[AI Studio] 请先在模型设置中创建并选择图片供应商。')
      }
      if (!sourceProviderSelection.apiKey.trim()) {
        throw new Error('[AI Studio] 请先填写图片供应商 API Key。')
      }
      if (!sourceTask.primaryImagePath) {
        throw new Error('[AI Studio] 请先添加参考图。')
      }

      const sourceWorkflow = readWorkflowMetadata(sourceTask)
      const effectivePromptText =
        payload?.promptText !== undefined
          ? String(payload.promptText ?? '').trim()
          : String(sourceWorkflow.masterStage.promptExtra ?? sourceTask.promptExtra ?? '').trim()
      const effectiveTemplateId =
        payload?.templateId !== undefined
          ? String(payload.templateId ?? '').trim() || null
          : (sourceWorkflow.masterStage.templateId ?? sourceTask.templateId ?? null)
      const effectiveRequestedCount = Math.max(
        1,
        Math.floor(
          Number(payload?.requestedCount ?? sourceWorkflow.masterStage.requestedCount ?? 1) || 1
        )
      )
      const effectiveModel =
        String(
          payload?.model ??
            sourceTask.model ??
            sourceProviderSelection.modelName ??
            defaultModel ??
            DEFAULT_GRSAI_IMAGE_MODEL
        ).trim() || DEFAULT_GRSAI_IMAGE_MODEL

      const sourceOutputCount = 'outputAssets' in sourceTask ? sourceTask.outputAssets.length : 0
      const needsReset =
        sourceOutputCount > 0 ||
        Boolean(sourceTask.latestRunId) ||
        Boolean(sourceTask.remoteTaskId) ||
        sourceTask.status === 'running' ||
        sourceTask.status === 'completed' ||
        sourceTask.status === 'failed'

      const preparedTask = needsReset
        ? await createTaskWithInputs({
            primaryImagePath: sourceTask.primaryImagePath,
            referenceImagePaths: sourceTask.referenceImagePaths,
            inheritFrom: sourceTask,
            promptExtraOverride: effectivePromptText,
            templateIdOverride: effectiveTemplateId
          })
        : sourceTask
      if (!preparedTask) return null

      const workingTask =
        (await loadLatestTaskRecord(preparedTask.id)) ??
        (preparedTask.id === sourceTask.id
          ? preparedTask
          : coerceTaskRecord(
              await window.api.cms.aiStudio.task
                .list({ ids: [preparedTask.id], limit: 1 })
                .then((rows) => rows[0])
            ))

      clearTaskInterrupt(workingTask.id)

      const workflow = prepareWorkflowForMasterRun(readWorkflowMetadata(workingTask), {
        promptText: effectivePromptText,
        templateId: effectiveTemplateId,
        requestedCount: effectiveRequestedCount,
        primaryImagePath: workingTask.primaryImagePath ?? null,
        referenceImagePaths: workingTask.referenceImagePaths
      })

      let task = await updateTaskPatch(workingTask.id, {
        templateId: effectiveTemplateId,
        provider:
          sourceProviderSelection.providerName || normalizeAiProviderValue(workingTask.provider),
        promptExtra: effectivePromptText,
        model: effectiveModel,
        outputCount: 1,
        status: 'running',
        remoteTaskId: null,
        latestRunId: null,
        metadata: writeWorkflowMetadata(workingTask, workflow)
      })
      await refresh()
      payload?.onStarted?.()

      try {
        await createTaskWithInputs({
          primaryImagePath: null,
          referenceImagePaths: [],
          inheritFrom: task,
          promptExtraOverride: '',
          templateIdOverride: null
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[AI Studio] 创建下一张图片草稿失败：${message}`)
      }

      const sequenceIndexes = Array.from(
        { length: workflow.masterStage.requestedCount },
        (_, slotIndex) => slotIndex + 1
      )
      replacePreviewSlotRuntimeStates(
        task.id,
        buildQueuedPreviewSlotRuntimeStates(sequenceIndexes.length)
      )

      try {
        const slotResults = await runWithConcurrencyLimit(
          sequenceIndexes,
          resolveMasterWorkflowConcurrency(
            sequenceIndexes.length,
            AI_STUDIO_MASTER_CLEAN_CONCURRENCY
          ),
          async (sequenceIndex) => {
            if (isTaskInterruptRequested(task.id)) {
              patchPreviewSlotRuntimeState(task.id, sequenceIndex, {
                status: 'failed',
                message: AI_STUDIO_TASK_INTERRUPTED_MESSAGE
              })
              return {
                sequenceIndex,
                generated: false,
                cleaned: false,
                cleanFailed: false,
                failure: makeWorkflowFailureRecord(
                  'master-generate',
                  sequenceIndex,
                  AI_STUDIO_TASK_INTERRUPTED_MESSAGE
                )
              }
            }

            patchPreviewSlotRuntimeState(task.id, sequenceIndex, {
              status: 'generating',
              message: '结果生成中'
            })

            try {
              const result = await executeRunToTerminal(task.id)
              const outputAssets = (result.outputs ?? []).map(coerceAssetRecord)

              if (result.status === 'succeeded' && outputAssets.length > 0) {
                const relabeled = await upsertAssetsRemote(
                  outputAssets.slice(0, 1).map((asset) => ({
                    id: asset.id,
                    taskId: task.id,
                    runId: asset.runId,
                    kind: 'output',
                    role: AI_STUDIO_MASTER_OUTPUT_ROLE,
                    filePath: asset.filePath,
                    previewPath: asset.previewPath,
                    originPath: asset.originPath,
                    selected: asset.selected,
                    sortOrder: sequenceIndex - 1,
                    metadata: {
                      ...(asset.metadata ?? {}),
                      stage: 'master',
                      sequenceIndex,
                      outputIndex: 0,
                      watermarkStatus: 'pending'
                    }
                  }))
                )
                const rawAsset = relabeled[0]
                if (!rawAsset) {
                  const message = '结果生成失败'
                  patchPreviewSlotRuntimeState(task.id, sequenceIndex, {
                    status: 'failed',
                    message
                  })
                  return {
                    sequenceIndex,
                    generated: false,
                    cleaned: false,
                    cleanFailed: false,
                    failure: makeWorkflowFailureRecord('master-generate', sequenceIndex, message, {
                      runId: result.run?.id
                    })
                  }
                }

                try {
                  await processMasterCleanup({ id: task.id }, rawAsset, sequenceIndex)
                  patchPreviewSlotRuntimeState(task.id, sequenceIndex, null)
                  return {
                    sequenceIndex,
                    generated: true,
                    cleaned: true,
                    cleanFailed: false,
                    failure: null
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  await upsertAssetsRemote([
                    {
                      id: rawAsset.id,
                      taskId: task.id,
                      runId: rawAsset.runId,
                      kind: 'output',
                      role: AI_STUDIO_MASTER_OUTPUT_ROLE,
                      filePath: rawAsset.filePath,
                      previewPath: rawAsset.previewPath,
                      originPath: rawAsset.originPath,
                      selected: rawAsset.selected,
                      sortOrder: rawAsset.sortOrder,
                      metadata: {
                        ...(rawAsset.metadata ?? {}),
                        stage: 'master',
                        sequenceIndex,
                        watermarkStatus: 'failed'
                      }
                    }
                  ])
                  patchPreviewSlotRuntimeState(task.id, sequenceIndex, {
                    status: 'failed',
                    message
                  })
                  return {
                    sequenceIndex,
                    generated: true,
                    cleaned: false,
                    cleanFailed: true,
                    failure: makeWorkflowFailureRecord('master-clean', sequenceIndex, message, {
                      assetId: rawAsset.id
                    })
                  }
                }
              }

              const message = result.run?.errorMessage || '结果生成失败'
              patchPreviewSlotRuntimeState(task.id, sequenceIndex, {
                status: 'failed',
                message
              })
              return {
                sequenceIndex,
                generated: false,
                cleaned: false,
                cleanFailed: false,
                failure: makeWorkflowFailureRecord('master-generate', sequenceIndex, message, {
                  runId: result.run?.id
                })
              }
            } catch (error) {
              const interrupted = isTaskInterruptedError(error)
              const message = interrupted
                ? AI_STUDIO_TASK_INTERRUPTED_MESSAGE
                : (error instanceof Error ? error.message : String(error))
              patchPreviewSlotRuntimeState(task.id, sequenceIndex, {
                status: 'failed',
                message
              })
              return {
                sequenceIndex,
                generated: false,
                cleaned: false,
                cleanFailed: false,
                failure: makeWorkflowFailureRecord('master-generate', sequenceIndex, message)
              }
            }
          }
        )

        const finalizedTaskRecord = (await loadLatestTaskRecord(task.id)) ?? task
        const finalizedWorkflow = readWorkflowMetadata(finalizedTaskRecord)
        const summary = summarizeMasterSlotResults(slotResults)
        finalizedWorkflow.workflow.activeStage = 'master-selecting'
        finalizedWorkflow.workflow.currentItemKind = 'idle'
        finalizedWorkflow.workflow.currentItemIndex = 0
        finalizedWorkflow.workflow.currentItemTotal = finalizedWorkflow.masterStage.requestedCount
        finalizedWorkflow.masterStage.completedCount = summary.completedCount
        finalizedWorkflow.masterStage.cleanSuccessCount = summary.cleanSuccessCount
        finalizedWorkflow.masterStage.cleanFailedCount = summary.cleanFailedCount
        finalizedWorkflow.workflow.failures =
          summary.failures as AiStudioWorkflowFailureRecord[]

        const finalStatus =
          finalizedWorkflow.masterStage.cleanSuccessCount > 0 ? 'ready' : 'failed'
        task = await updateTaskPatch(finalizedTaskRecord.id, {
          status: finalStatus,
          metadata: writeWorkflowMetadata(finalizedTaskRecord, finalizedWorkflow),
          promptExtra: finalizedWorkflow.masterStage.promptExtra,
          templateId: finalizedWorkflow.masterStage.templateId,
          outputCount: 1
        })
        await refresh()

        return true
      } catch (error) {
        const latestTask = (await loadLatestTaskRecord(task.id)) ?? task
        const latestWorkflow = readWorkflowMetadata(latestTask)
        const interrupted = isTaskInterruptedError(error)
        const failureMessage = interrupted
          ? AI_STUDIO_TASK_INTERRUPTED_MESSAGE
          : (error instanceof Error ? error.message : String(error))

        replacePreviewSlotRuntimeStates(
          latestTask.id,
          Object.fromEntries(
            Array.from({ length: latestWorkflow.masterStage.requestedCount }, (_, slotIndex) => [
              slotIndex + 1,
              {
                status: 'failed',
                message: failureMessage
              } satisfies PreviewSlotRuntimeState
            ])
          )
        )

        latestWorkflow.workflow.activeStage = 'master-selecting'
        latestWorkflow.workflow.currentItemKind = 'idle'
        latestWorkflow.workflow.currentItemIndex = 0
        latestWorkflow.workflow.currentItemTotal = latestWorkflow.masterStage.requestedCount
        latestWorkflow.masterStage.completedCount = 0
        latestWorkflow.masterStage.cleanSuccessCount = 0
        latestWorkflow.masterStage.cleanFailedCount = 0
        latestWorkflow.workflow.failures = Array.from(
          { length: latestWorkflow.masterStage.requestedCount },
          (_, slotIndex) =>
            makeWorkflowFailureRecord('master-generate', slotIndex + 1, failureMessage)
        )

        const finalStatus = 'failed'
        task = await updateTaskPatch(latestTask.id, {
          status: finalStatus,
          metadata: writeWorkflowMetadata(latestTask, latestWorkflow),
          promptExtra: latestWorkflow.masterStage.promptExtra,
          templateId: latestWorkflow.masterStage.templateId,
          outputCount: 1
        })
        await refresh()

        return true
      } finally {
        clearTaskInterrupt(task.id)
        clearPreviewSlotRuntimeStates(task.id)
      }
    },
    [
      activeTask,
      clearPreviewSlotRuntimeStates,
      clearTaskInterrupt,
      createTaskWithInputs,
      addLog,
      defaultModel,
      executeRunToTerminal,
      isTaskInterruptRequested,
      loadLatestTaskRecord,
      patchPreviewSlotRuntimeState,
      processMasterCleanup,
      refresh,
      replacePreviewSlotRuntimeStates,
      resolveImageTaskProviderState,
      taskViews,
      updateTaskPatch,
      upsertAssetsRemote
    ]
  )

  const retryMasterCleanup = useCallback(
    async (assetId: string) => {
      if (!activeTask) return
      const rawAsset = masterRawAssets.find((asset) => asset.id === assetId)
      if (!rawAsset) return
      const latestTask = await loadLatestTaskRecord(activeTask.id)
      if (!latestTask) return

      const sequenceIndex =
        typeof rawAsset.metadata?.sequenceIndex === 'number'
          ? Math.max(1, Math.floor(Number(rawAsset.metadata.sequenceIndex)))
          : rawAsset.sortOrder + 1

      await processMasterCleanup(latestTask, rawAsset, sequenceIndex)

      const latestWorkflow = readWorkflowMetadata(latestTask)
      const priorFailed = String(rawAsset.metadata?.watermarkStatus ?? '') === 'failed'
      if (priorFailed && latestWorkflow.masterStage.cleanFailedCount > 0) {
        latestWorkflow.masterStage.cleanFailedCount -= 1
      }
      latestWorkflow.masterStage.cleanSuccessCount += 1
      latestWorkflow.workflow.failures = latestWorkflow.workflow.failures.filter(
        (item) => !(item.stageKind === 'master-clean' && item.assetId === rawAsset.id)
      )
      latestWorkflow.workflow.activeStage = 'master-selecting'
      latestWorkflow.workflow.currentItemKind = 'idle'
      latestWorkflow.workflow.currentItemIndex = 0
      latestWorkflow.workflow.currentItemTotal = latestWorkflow.masterStage.requestedCount

      await updateTaskPatch(latestTask.id, {
        status: latestWorkflow.masterStage.cleanSuccessCount > 0 ? 'ready' : 'failed',
        metadata: writeWorkflowMetadata(latestTask, latestWorkflow),
        promptExtra: latestWorkflow.masterStage.promptExtra,
        templateId: latestWorkflow.masterStage.templateId,
        outputCount: 1
      })
      await refresh()
    },
    [
      activeTask,
      loadLatestTaskRecord,
      masterRawAssets,
      processMasterCleanup,
      refresh,
      updateTaskPatch
    ]
  )

  const retryMasterGeneration = useCallback(
    async (taskId: string, sequenceIndex: number) => {
      const normalizedTaskId = String(taskId ?? '').trim()
      const normalizedSequenceIndex = Math.max(1, Math.floor(Number(sequenceIndex) || 1))
      if (!normalizedTaskId) return

      const latestTask = await loadLatestTaskRecord(normalizedTaskId)
      if (!latestTask) return

      const taskProviderSelection = resolveImageTaskProviderState(latestTask)
      if (!taskProviderSelection.providerProfile) {
        throw new Error('[AI Studio] 请先在模型设置中创建并选择图片供应商。')
      }
      if (!taskProviderSelection.apiKey.trim()) {
        throw new Error('[AI Studio] 请先填写图片供应商 API Key。')
      }

      const outputAssets = (
        await window.api.cms.aiStudio.asset.list({
          taskId: normalizedTaskId,
          kind: 'output'
        })
      ).map(coerceAssetRecord)
      const existingRawAsset =
        outputAssets.find(
          (asset) =>
            asset.role === AI_STUDIO_MASTER_OUTPUT_ROLE &&
            readAssetSequenceIndex(asset) === normalizedSequenceIndex
        ) ?? null
      const hasSuccessfulCleanAsset = outputAssets.some(
        (asset) =>
          asset.role === AI_STUDIO_MASTER_CLEAN_ROLE &&
          readAssetSequenceIndex(asset) === normalizedSequenceIndex
      )

      const latestWorkflow = readWorkflowMetadata(latestTask)
      const hadGeneratedBefore = Boolean(existingRawAsset)
      const hadFailedCleanBefore = latestWorkflow.workflow.failures.some(
        (item) =>
          item.stageKind === 'master-clean' && item.sequenceIndex === normalizedSequenceIndex
      )
      latestWorkflow.workflow.failures = latestWorkflow.workflow.failures.filter(
        (item) => item.sequenceIndex !== normalizedSequenceIndex
      )
      latestWorkflow.workflow.activeStage = 'master-generating'
      latestWorkflow.workflow.currentItemKind = 'master-generate'
      latestWorkflow.workflow.currentItemIndex = normalizedSequenceIndex
      latestWorkflow.workflow.currentItemTotal = latestWorkflow.masterStage.requestedCount

      patchPreviewSlotRuntimeState(normalizedTaskId, normalizedSequenceIndex, {
        status: 'generating',
        message: '结果生成中'
      })

      await updateTaskPatch(latestTask.id, {
        templateId: latestWorkflow.masterStage.templateId,
        promptExtra: latestWorkflow.masterStage.promptExtra,
        outputCount: 1,
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, latestWorkflow)
      })
      await refresh()

      const workingTask = await loadLatestTaskRecord(latestTask.id)
      if (!workingTask) {
        patchPreviewSlotRuntimeState(normalizedTaskId, normalizedSequenceIndex, null)
        return
      }

      const workingWorkflow = readWorkflowMetadata(workingTask)
      workingWorkflow.workflow.failures = workingWorkflow.workflow.failures.filter(
        (item) => item.sequenceIndex !== normalizedSequenceIndex
      )

      try {
        const result = await executeRunToTerminal(workingTask.id)
        const nextOutputAssets = (result.outputs ?? []).map(coerceAssetRecord)

        if (result.status === 'succeeded' && nextOutputAssets.length > 0) {
          const nextRawAsset = bindMasterGeneratedAssetToSlot(
            {
              ...nextOutputAssets[0],
              taskId: workingTask.id
            },
            normalizedSequenceIndex,
            existingRawAsset
              ? {
                  id: existingRawAsset.id,
                  taskId: workingTask.id,
                  sortOrder: existingRawAsset.sortOrder,
                  selected: existingRawAsset.selected
                }
              : null
          )
          const relabeled = await upsertAssetsRemote([nextRawAsset])
          const rawAsset = relabeled[0]

          if (!rawAsset) {
            const message = '结果生成失败'
            workingWorkflow.workflow.failures.push(
              makeWorkflowFailureRecord('master-generate', normalizedSequenceIndex, message, {
                runId: result.run?.id
              })
            )
          } else {
            try {
              await processMasterCleanup(workingTask, rawAsset, normalizedSequenceIndex)
              if (!hadGeneratedBefore) {
                workingWorkflow.masterStage.completedCount += 1
              }
              if (hadFailedCleanBefore && workingWorkflow.masterStage.cleanFailedCount > 0) {
                workingWorkflow.masterStage.cleanFailedCount -= 1
              }
              if (!hasSuccessfulCleanAsset) {
                workingWorkflow.masterStage.cleanSuccessCount += 1
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (!hadGeneratedBefore) {
                workingWorkflow.masterStage.completedCount += 1
              }
              if (!hasSuccessfulCleanAsset && !hadFailedCleanBefore) {
                workingWorkflow.masterStage.cleanFailedCount += 1
              }
              workingWorkflow.workflow.failures.push(
                makeWorkflowFailureRecord('master-clean', normalizedSequenceIndex, message, {
                  assetId: rawAsset.id
                })
              )
              await upsertAssetsRemote([
                {
                  id: rawAsset.id,
                  taskId: workingTask.id,
                  runId: rawAsset.runId,
                  kind: 'output',
                  role: AI_STUDIO_MASTER_OUTPUT_ROLE,
                  filePath: rawAsset.filePath,
                  previewPath: rawAsset.previewPath,
                  originPath: rawAsset.originPath,
                  selected: rawAsset.selected,
                  sortOrder: rawAsset.sortOrder,
                  metadata: {
                    ...(rawAsset.metadata ?? {}),
                    stage: 'master',
                    sequenceIndex: normalizedSequenceIndex,
                    watermarkStatus: 'failed'
                  }
                }
              ])
            }
          }
        } else {
          workingWorkflow.workflow.failures.push(
            makeWorkflowFailureRecord(
              'master-generate',
              normalizedSequenceIndex,
              result.run?.errorMessage || '结果生成失败',
              { runId: result.run?.id }
            )
          )
        }
      } catch (error) {
        workingWorkflow.workflow.failures.push(
          makeWorkflowFailureRecord(
            'master-generate',
            normalizedSequenceIndex,
            error instanceof Error ? error.message : String(error)
          )
        )
      }

      workingWorkflow.workflow.activeStage = 'master-selecting'
      workingWorkflow.workflow.currentItemKind = 'idle'
      workingWorkflow.workflow.currentItemIndex = 0
      workingWorkflow.workflow.currentItemTotal = workingWorkflow.masterStage.requestedCount

      await updateTaskPatch(workingTask.id, {
        status: workingWorkflow.masterStage.cleanSuccessCount > 0 ? 'ready' : 'failed',
        metadata: writeWorkflowMetadata(workingTask, workingWorkflow),
        promptExtra: workingWorkflow.masterStage.promptExtra,
        templateId: workingWorkflow.masterStage.templateId,
        outputCount: 1
      })
      await refresh()
      patchPreviewSlotRuntimeState(normalizedTaskId, normalizedSequenceIndex, null)
    },
    [
      executeRunToTerminal,
      loadLatestTaskRecord,
      patchPreviewSlotRuntimeState,
      processMasterCleanup,
      refresh,
      resolveImageTaskProviderState,
      updateTaskPatch,
      upsertAssetsRemote
    ]
  )

  const interruptTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = String(taskId ?? '').trim()
      if (!normalizedTaskId) return false

      const targetTask =
        taskViews.find((task) => task.id === normalizedTaskId) ??
        (await loadLatestTaskRecord(normalizedTaskId))
      if (!targetTask || targetTask.status !== 'running') return false

      requestTaskInterrupt(normalizedTaskId)
      addLog('[AI Studio] 已请求中断任务。')
      return true
    },
    [addLog, loadLatestTaskRecord, requestTaskInterrupt, taskViews]
  )

  const interruptActiveTask = useCallback(async () => {
    if (!activeTask) return false
    return interruptTask(activeTask.id)
  }, [activeTask, interruptTask])

  const setCurrentAiMaster = useCallback(
    async (assetId: string) => {
      if (!activeTask) return
      const target = masterCleanAssets.find((asset) => asset.id === assetId)
      if (!target) return
      await patchWorkflowMetadata(
        activeTask,
        (draft) => {
          draft.workflow.currentAiMasterAssetId = target.id
          draft.workflow.activeStage = 'child-ready'
          draft.workflow.currentItemKind = 'idle'
          draft.workflow.currentItemIndex = 0
          draft.workflow.currentItemTotal = draft.childStage.requestedCount
        },
        { status: 'ready' }
      )
      await refresh()
    },
    [activeTask, masterCleanAssets, patchWorkflowMetadata, refresh]
  )

  const startChildWorkflow = useCallback(async () => {
    const activeProviderSelection = resolveImageTaskProviderState(activeTask)
    if (!activeTask || !activeProviderSelection.providerProfile) {
      throw new Error('[AI Studio] 请先在模型设置中创建并选择图片供应商。')
    }
    if (!activeProviderSelection.apiKey.trim()) {
      throw new Error('[AI Studio] 请先填写图片供应商 API Key。')
    }
    const workflow = workflowMeta
    if (!workflow?.workflow.currentAiMasterAssetId) {
      throw new Error('[AI Studio] 请先设为当前AI母图。')
    }
    if (!workflow.childStage.templateId) {
      throw new Error('[AI Studio] 请先为子图阶段选择模板。')
    }
    if (childOutputAssets.length > 0) {
      throw new Error(
        '[AI Studio] 当前任务已有子图结果，本版 MVP 暂不支持在同一任务内重复生成子图。'
      )
    }
    const variantList = normalizeVariantLines(workflow.childStage.variantLines).slice(
      0,
      workflow.childStage.requestedCount
    )
    if (variantList.length < workflow.childStage.requestedCount) {
      throw new Error('[AI Studio] Variant 数量不足，请先补齐对应行数。')
    }

    let task = await updateTaskPatch(activeTask.id, {
      templateId: workflow.childStage.templateId,
      promptExtra: workflow.childStage.promptExtra,
      outputCount: 1,
      status: 'running',
      metadata: writeWorkflowMetadata(activeTask, {
        ...workflow,
        workflow: {
          ...workflow.workflow,
          activeStage: 'child-generating',
          currentItemKind: 'child-generate',
          currentItemIndex: 0,
          currentItemTotal: workflow.childStage.requestedCount
        },
        childStage: {
          ...workflow.childStage,
          completedCount: 0,
          failedCount: 0
        }
      })
    })
    await refresh()

    for (let index = 0; index < variantList.length; index += 1) {
      const sequenceIndex = index + 1
      const variantLine = variantList[index]
      const latestTaskRecord = await window.api.cms.aiStudio.task
        .list({ ids: [task.id], limit: 1 })
        .then((rows) => rows[0])
      if (!latestTaskRecord) break
      const latestTask = coerceTaskRecord(latestTaskRecord)
      const latestWorkflow = readWorkflowMetadata(latestTask)
      latestWorkflow.workflow.activeStage = 'child-generating'
      latestWorkflow.workflow.currentItemKind = 'child-generate'
      latestWorkflow.workflow.currentItemIndex = sequenceIndex
      latestWorkflow.workflow.currentItemTotal = latestWorkflow.childStage.requestedCount
      const currentPromptExtra = buildChildPromptExtra(
        latestWorkflow.childStage.promptExtra,
        variantLine
      )
      task = await updateTaskPatch(latestTask.id, {
        templateId: latestWorkflow.childStage.templateId,
        promptExtra: currentPromptExtra,
        outputCount: 1,
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, latestWorkflow)
      })

      try {
        const result = await executeRunToTerminal(latestTask.id)
        if (
          result.status === 'succeeded' &&
          Array.isArray(result.outputs) &&
          result.outputs.length > 0
        ) {
          await upsertAssetsRemote(
            result.outputs.map((asset) => ({
              id: asset.id,
              taskId: latestTask.id,
              runId: asset.runId,
              kind: 'output',
              role: AI_STUDIO_CHILD_OUTPUT_ROLE,
              filePath: asset.filePath,
              previewPath: asset.previewPath,
              originPath: asset.originPath,
              selected: asset.selected,
              sortOrder: asset.sortOrder,
              metadata: {
                ...(asset.metadata ?? {}),
                stage: 'child',
                sequenceIndex,
                variantText: variantLine,
                derivedFromAssetId: latestWorkflow.workflow.currentAiMasterAssetId
              }
            }))
          )
          latestWorkflow.childStage.completedCount += 1
        } else {
          latestWorkflow.childStage.failedCount += 1
          latestWorkflow.workflow.failures.push(
            makeWorkflowFailureRecord(
              'child-generate',
              sequenceIndex,
              result.run?.errorMessage || '子图生成失败',
              { runId: result.run?.id }
            )
          )
        }
      } catch (error) {
        latestWorkflow.childStage.failedCount += 1
        latestWorkflow.workflow.failures.push(
          makeWorkflowFailureRecord(
            'child-generate',
            sequenceIndex,
            error instanceof Error ? error.message : String(error)
          )
        )
      }

      task = await updateTaskPatch(latestTask.id, {
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, latestWorkflow),
        promptExtra: latestWorkflow.childStage.promptExtra,
        templateId: latestWorkflow.childStage.templateId,
        outputCount: 1
      })
      await refresh()
    }

    const finalTaskRecord = await window.api.cms.aiStudio.task
      .list({ ids: [task.id], limit: 1 })
      .then((rows) => rows[0])
    if (!finalTaskRecord) return null
    const finalTask = coerceTaskRecord(finalTaskRecord)
    const finalWorkflow = readWorkflowMetadata(finalTask)
    finalWorkflow.workflow.activeStage = 'completed'
    finalWorkflow.workflow.currentItemKind = 'idle'
    finalWorkflow.workflow.currentItemIndex = 0
    finalWorkflow.workflow.currentItemTotal = finalWorkflow.childStage.requestedCount
    await updateTaskPatch(finalTask.id, {
      status: finalWorkflow.childStage.completedCount > 0 ? 'completed' : 'failed',
      metadata: writeWorkflowMetadata(finalTask, finalWorkflow),
      promptExtra: finalWorkflow.childStage.promptExtra,
      templateId: finalWorkflow.childStage.templateId,
      outputCount: 1
    })
    await refresh()
    return true
  }, [
    activeTask,
    childOutputAssets.length,
    executeRunToTerminal,
    refresh,
    resolveImageTaskProviderState,
    updateTaskPatch,
    upsertAssetsRemote,
    workflowMeta
  ])

  const exceptionCount = useMemo(
    () => capabilityTaskViews.filter((task) => task.status === 'failed').length,
    [capabilityTaskViews]
  )

  return {
    studioCapability,
    setStudioCapability,
    templates: templateOptions,
    videoProfiles,
    videoMeta,
    selectedVideoProfile,
    videoMode: videoMeta.mode,
    selectedTemplate: selectedTemplateBase ?? selectedTemplate,
    selectedMasterTemplate,
    selectedChildTemplate,
    tasks: taskViews,
    visibleTasks,
    historyTasks,
    activeTask,
    activeTaskId: activeTask?.id ?? activeTaskId,
    activeInputAssets,
    activeOutputAssets,
    masterRawAssets,
    masterCleanAssets,
    childOutputAssets,
    videoOutputAssets,
    currentAiMasterAsset,
    activeSelectedOutputAssets,
    activeSelectedOutputIds,
    activeSelectedChildOutputAssets: activeSelectedDispatchOutputAssets,
    activeSelectedChildOutputIds: activeSelectedDispatchOutputIds,
    dispatchOutputAssets,
    pooledOutputAssets,
    pooledOutputCount,
    activeSelectedDispatchOutputAssets,
    activeSelectedDispatchOutputIds,
    selectedOutputIdsByTask,
    selectedTaskIds,
    statusFilter,
    batchCostSummary,
    primaryImagePath,
    referenceImagePaths,
    exceptionCount,
    isLoading,
    isImporting,
    interruptingTaskIds,
    workflowMeta,
    activeStage,
    stageProgress,
    previewSlotRuntimeByTaskId,
    failureRecords,
    masterOutputCount,
    childOutputCount,
    masterPromptExtra,
    childPromptExtra,
    variantLines,
    refresh,
    importFolders,
    setStatusFilter,
    setActiveTaskId,
    toggleTaskSelection,
    toggleOutputSelection,
    toggleDispatchOutputSelectionForTask,
    toggleDispatchOutputPoolForTask,
    setOutputSelection,
    selectAllChildOutputs: selectAllDispatchOutputs,
    clearSelectedChildOutputs: clearSelectedDispatchOutputs,
    sendSelectedChildOutputsToWorkshop: sendSelectedDispatchOutputsToWorkshop,
    selectAllDispatchOutputs,
    clearSelectedDispatchOutputs,
    selectAllDispatchOutputsForTask,
    clearSelectedDispatchOutputsForTask,
    sendSelectedDispatchOutputsToWorkshop,
    sendPooledOutputsToWorkshop,
    sendPooledOutputsToVideoComposer,
    prepareNextDraftTask,
    useDispatchOutputAsReference,
    useOutputAsVideoReference,
    useOutputAsVideoSubjectReference,
    interruptTask,
    interruptActiveTask,
    seedDemoTask,
    assignPrimaryImage,
    addReferenceImages,
    removeReferenceImage,
    toggleReferenceImage,
    setPromptExtra,
    setOutputCount,
    setAspectRatio,
    setImageProvider,
    setImageModel,
    setModel,
    setTemplateId,
    saveTemplate,
    deleteTemplate,
    saveStageTemplate,
    setMasterTemplateId,
    setChildTemplateId,
    setMasterPromptExtra,
    setChildPromptExtra,
    setMasterOutputCount,
    setChildOutputCount,
    setVariantLines,
    setVideoMode,
    setVideoProfileId,
    setVideoProvider,
    setVideoModel,
    setVideoSubjectReference,
    setVideoFirstFrame,
    setVideoLastFrame,
    swapVideoFrames,
    setVideoAspectRatio,
    setVideoResolution,
    setVideoDuration,
    setVideoOutputCount,
    startMasterWorkflow,
    startVideoWorkflow,
    retryMasterCleanup,
    retryMasterGeneration,
    setCurrentAiMaster,
    startChildWorkflow
  }
}

export { useAiStudioState }
