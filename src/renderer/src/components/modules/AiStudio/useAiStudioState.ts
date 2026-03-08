import { useCallback, useEffect, useMemo, useState } from 'react'

import { useCmsStore } from '@renderer/store/useCmsStore'
import { DEFAULT_GRSAI_IMAGE_MODEL } from '@renderer/lib/grsaiModels'

export type AiStudioImportedFolder = {
  folderPath: string
  productName: string
  imageFilePaths: string[]
}

export type AiStudioTemplateRecord = {
  id: string
  provider: string
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

const AI_STUDIO_MASTER_OUTPUT_ROLE = 'master-raw'
const AI_STUDIO_MASTER_CLEAN_ROLE = 'master-clean'
const AI_STUDIO_CHILD_OUTPUT_ROLE = 'child-output'
const AI_STUDIO_SOURCE_PRIMARY_ROLE = 'source-primary'
const AI_STUDIO_SOURCE_REFERENCE_ROLE = 'source-reference'

function normalizeVariantLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function createDefaultWorkflowMetadata(
  task: Pick<AiStudioTaskRecord, 'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths'>
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

function readWorkflowMetadata(
  task: Pick<AiStudioTaskRecord, 'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths' | 'metadata'>
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
        typeof workflowRecord.currentItemIndex === 'number' && Number.isFinite(workflowRecord.currentItemIndex)
          ? Math.max(0, Math.floor(workflowRecord.currentItemIndex))
          : 0,
      currentItemTotal:
        typeof workflowRecord.currentItemTotal === 'number' && Number.isFinite(workflowRecord.currentItemTotal)
          ? Math.max(0, Math.floor(workflowRecord.currentItemTotal))
          : 0,
      failures: Array.isArray(workflowRecord.failures)
        ? (workflowRecord.failures as unknown[])
            .map((item, index) => {
              const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
              return {
                id: typeof record.id === 'string' ? record.id : `failure-${index}`,
                stageKind:
                  record.stageKind === 'master-clean' || record.stageKind === 'child-generate'
                    ? (record.stageKind as AiStudioWorkflowFailureRecord['stageKind'])
                    : 'master-generate',
                sequenceIndex:
                  typeof record.sequenceIndex === 'number' && Number.isFinite(record.sequenceIndex)
                    ? Math.max(1, Math.floor(record.sequenceIndex))
                    : index + 1,
                message: typeof record.message === 'string' ? record.message : '未知错误',
                assetId: typeof record.assetId === 'string' ? record.assetId : undefined,
                runId: typeof record.runId === 'string' ? record.runId : undefined,
                createdAt:
                  typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
                    ? Math.floor(record.createdAt)
                    : Date.now()
              } satisfies AiStudioWorkflowFailureRecord
            })
        : base.workflow.failures
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
        typeof masterRecord.requestedCount === 'number' && Number.isFinite(masterRecord.requestedCount)
          ? Math.max(1, Math.floor(masterRecord.requestedCount))
          : base.masterStage.requestedCount,
      completedCount:
        typeof masterRecord.completedCount === 'number' && Number.isFinite(masterRecord.completedCount)
          ? Math.max(0, Math.floor(masterRecord.completedCount))
          : base.masterStage.completedCount,
      cleanSuccessCount:
        typeof masterRecord.cleanSuccessCount === 'number' && Number.isFinite(masterRecord.cleanSuccessCount)
          ? Math.max(0, Math.floor(masterRecord.cleanSuccessCount))
          : base.masterStage.cleanSuccessCount,
      cleanFailedCount:
        typeof masterRecord.cleanFailedCount === 'number' && Number.isFinite(masterRecord.cleanFailedCount)
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
        typeof childRecord.requestedCount === 'number' && Number.isFinite(childRecord.requestedCount)
          ? Math.max(1, Math.floor(childRecord.requestedCount))
          : base.childStage.requestedCount,
      variantLines: Array.isArray(childRecord.variantLines)
        ? normalizeVariantLines(childRecord.variantLines)
        : base.childStage.variantLines,
      completedCount:
        typeof childRecord.completedCount === 'number' && Number.isFinite(childRecord.completedCount)
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
  task: Pick<AiStudioTaskRecord, 'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths' | 'metadata'>,
  nextWorkflow: AiStudioWorkflowMetadata
): Record<string, unknown> {
  const metadata =
    task.metadata && typeof task.metadata === 'object'
      ? (task.metadata as Record<string, unknown>)
      : {}
  return {
    ...metadata,
    workflow: nextWorkflow.workflow,
    masterStage: nextWorkflow.masterStage,
    childStage: nextWorkflow.childStage,
    mode: 'two-stage'
  }
}


function resetWorkflowMetadataForInputs(
  task: Pick<AiStudioTaskRecord, 'templateId' | 'promptExtra' | 'primaryImagePath' | 'referenceImagePaths' | 'metadata'>
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

function buildStageProgress(workflowMeta: AiStudioWorkflowMetadata): AiStudioStageProgress {
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
    currentLabel = '母图生成中'
  } else if (workflowMeta.workflow.currentItemKind === 'master-clean') {
    currentLabel = '母图去水印中'
  } else if (workflowMeta.workflow.currentItemKind === 'child-generate') {
    currentLabel = '子图生成中'
  } else if (workflowMeta.workflow.activeStage === 'master-selecting') {
    currentLabel = '等待选择当前AI母图'
  } else if (workflowMeta.workflow.activeStage === 'child-ready') {
    currentLabel = '等待开始子图生成'
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

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildChildPromptExtra(basePromptExtra: string, variantLine: string): string {
  const parts = [String(basePromptExtra ?? '').trim(), String(variantLine ?? '').trim()].filter(Boolean)
  return parts.join('\n\n')
}

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

function buildInputAssetPayload(
  taskId: string,
  primaryImagePath: string | null,
  referenceImagePaths: string[]
) {
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

function useAiStudioState() {
  const defaultModel = useCmsStore((state) => state.config.aiDefaultImageModel)
  const aiConfig = useCmsStore((state) => state.config)
  const addLog = useCmsStore((state) => state.addLog)
  const setWorkshopImport = useCmsStore((state) => state.setWorkshopImport)
  const setActiveModule = useCmsStore((state) => state.setActiveModule)
  const [templates, setTemplates] = useState<AiStudioTemplateRecord[]>([])
  const [tasks, setTasks] = useState<AiStudioTaskRecord[]>([])
  const [assets, setAssets] = useState<AiStudioAssetRecord[]>([])
  const [draftByTaskId, setDraftByTaskId] = useState<Record<string, Partial<AiStudioTaskRecord>>>(
    {}
  )
  const [statusFilter, setStatusFilter] = useState<AiStudioTaskStatusFilter>('all')
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isImporting, setIsImporting] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [templateRows, taskRows, assetRows] = await Promise.all([
        window.api.cms.aiStudio.template.list().catch(() => []),
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
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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

  const visibleTasks = useMemo(() => {
    if (statusFilter === 'all') return taskViews
    return taskViews.filter((task) => inferStatusFilter(task.status) === statusFilter)
  }, [statusFilter, taskViews])

  const activeTask = useMemo(() => {
    return taskViews.find((task) => task.id === activeTaskId) ?? taskViews[0] ?? null
  }, [activeTaskId, taskViews])

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
    const basis =
      selectedTaskIds.length > 0
        ? taskViews.filter((task) => selectedTaskIds.includes(task.id))
        : visibleTasks
    const min = basis.reduce((total, task) => total + (task.priceMinSnapshot ?? 0), 0)
    const max = basis.reduce(
      (total, task) => total + (task.priceMaxSnapshot ?? task.priceMinSnapshot ?? 0),
      0
    )
    return { min, max, label: formatCost(min, max) }
  }, [selectedTaskIds, taskViews, visibleTasks])

  const templateOptions = useMemo(() => sortTemplates(templates), [templates])

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

  const replaceTemplate = useCallback((nextTemplate: AiStudioTemplateRecord) => {
    setTemplates((prev) => sortTemplates(mergeById(prev, [coerceTemplateRecord(nextTemplate)])))
  }, [])

  const removeTaskLocally = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId))
    setAssets((prev) => prev.filter((asset) => asset.taskId !== taskId))
    setDraftByTaskId((prev) => {
      if (!prev[taskId]) return prev
      const next = { ...prev }
      delete next[taskId]
      return next
    })
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))
    setActiveTaskId((prev) => (prev === taskId ? null : prev))
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
        const created = coerceTaskRecord(
          await window.api.cms.aiStudio.task.create({
            provider: 'grsai',
            sourceFolderPath: folder.folderPath,
            productName: folder.productName,
            status: 'draft',
            aspectRatio: '3:4',
            outputCount: 1,
            model: defaultModel || DEFAULT_GRSAI_IMAGE_MODEL,
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
  }, [defaultModel])

  const createTaskWithInputs = useCallback(
    async (payload: {
      primaryImagePath: string | null
      referenceImagePaths: string[]
      inheritFrom?: AiStudioTaskView | null
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
      const inferredName = basenameWithoutExtension(
        primaryImagePath ?? referenceImagePaths[0] ?? ''
      )
      const created = coerceTaskRecord(
        await window.api.cms.aiStudio.task.create({
          templateId: baseTask?.templateId ?? null,
          provider: 'grsai',
          sourceFolderPath: null,
          productName: inferredName || baseTask?.productName || '未命名任务',
          status: 'draft',
          aspectRatio: baseTask?.aspectRatio ?? '3:4',
          outputCount: baseTask?.outputCount ?? 1,
          model: baseTask?.model || defaultModel || DEFAULT_GRSAI_IMAGE_MODEL,
          promptExtra: baseTask?.promptExtra ?? '',
          primaryImagePath,
          referenceImagePaths,
          inputImagePaths,
          remoteTaskId: null,
          latestRunId: null,
          priceMinSnapshot: null,
          priceMaxSnapshot: null,
          billedState: 'unbilled',
          metadata: writeWorkflowMetadata(
            {
              templateId: baseTask?.templateId ?? null,
              promptExtra: baseTask?.promptExtra ?? '',
              primaryImagePath,
              referenceImagePaths,
              metadata: { ...(baseTask?.metadata ?? {}), importedImageCount: inputImagePaths.length }
            },
            resetWorkflowMetadataForInputs({
              templateId: baseTask?.templateId ?? null,
              promptExtra: baseTask?.promptExtra ?? '',
              primaryImagePath,
              referenceImagePaths,
              metadata: { ...(baseTask?.metadata ?? {}), importedImageCount: inputImagePaths.length }
            })
          )
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
    [defaultModel, replaceAssets, replaceTask, templateOptions]
  )

  const syncTaskInputs = useCallback(
    async (
      task: AiStudioTaskView,
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
        metadata: writeWorkflowMetadata(
          {
            templateId: task.templateId,
            promptExtra: task.promptExtra,
            primaryImagePath: normalizedPrimary,
            referenceImagePaths: normalizedReferences,
            metadata: { ...(task.metadata ?? {}), importedImageCount: inputImagePaths.length }
          },
          resetWorkflowMetadataForInputs({
            templateId: task.templateId,
            promptExtra: task.promptExtra,
            primaryImagePath: normalizedPrimary,
            referenceImagePaths: normalizedReferences,
            metadata: { ...(task.metadata ?? {}), importedImageCount: inputImagePaths.length }
          })
        )
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
        await window.api.cms.aiStudio.task.delete({ taskId: currentTask.id }).catch(() => void 0)
        removeTaskLocally(currentTask.id)
        setSelectedTaskIds([replacement.id])
        setActiveTaskId(replacement.id)
        return replacement
      }

      return syncTaskInputs(currentTask, normalizedPrimary, normalizedReferences)
    },
    [activeTask, createTaskWithInputs, removeTaskLocally, syncTaskInputs]
  )

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((value) => value !== taskId)
        : uniqueStrings([...prev, taskId])
    )
  }, [])

  const setOutputSelection = useCallback(
    async (assetIds: string[], selected: boolean, clearOthers?: boolean) => {
      if (!activeTask) return [] as AiStudioAssetRecord[]
      const normalizedIds = uniqueStrings(assetIds)
      const nextAssets = await window.api.cms.aiStudio.asset.markSelected({
        taskId: activeTask.id,
        assetIds: normalizedIds,
        selected,
        clearOthers
      })
      const normalized = (nextAssets ?? []).map(coerceAssetRecord)
      replaceAssets(normalized)
      return normalized
    },
    [activeTask, replaceAssets]
  )

  const toggleOutputSelection = useCallback(
    async (assetId: string) => {
      if (!activeTask) return [] as AiStudioAssetRecord[]
      const target = activeOutputAssets.find((asset) => asset.id === assetId)
      if (!target) return [] as AiStudioAssetRecord[]
      return setOutputSelection([assetId], !target.selected, false)
    },
    [activeOutputAssets, activeTask, setOutputSelection]
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
          name: String(payload.name ?? '').trim(),
          promptText: String(payload.promptText ?? '').trim()
        })
      )
      replaceTemplate(saved)
      if (activeTask && activeTask.templateId !== saved.id) {
        await updateTaskPatch(activeTask.id, { templateId: saved.id })
      }
      return saved
    },
    [activeTask, replaceTemplate, updateTaskPatch]
  )

  const loadLatestTaskRecord = useCallback(async (taskId: string) => {
    const row = await window.api.cms.aiStudio.task.list({ ids: [taskId], limit: 1 }).then((rows) => rows[0])
    return row ? coerceTaskRecord(row) : null
  }, [])

  const workflowMeta = useMemo(
    () =>
      activeTask
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
    return templateOptions.find((template) => template.id === workflowMeta.masterStage.templateId) ?? null
  }, [templateOptions, workflowMeta])

  const selectedChildTemplate = useMemo(() => {
    if (!workflowMeta?.childStage.templateId) return null
    return templateOptions.find((template) => template.id === workflowMeta.childStage.templateId) ?? null
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
  const currentAiMasterAsset = useMemo(() => {
    const currentId = workflowMeta?.workflow.currentAiMasterAssetId ?? ''
    if (!currentId) return null
    return masterCleanAssets.find((asset) => asset.id === currentId) ?? null
  }, [masterCleanAssets, workflowMeta])
  const activeSelectedChildOutputAssets = useMemo(
    () => childOutputAssets.filter((asset) => asset.selected),
    [childOutputAssets]
  )
  const activeSelectedChildOutputIds = useMemo(
    () => activeSelectedChildOutputAssets.map((asset) => asset.id),
    [activeSelectedChildOutputAssets]
  )
  const selectAllChildOutputs = useCallback(async () => {
    const assetIds = childOutputAssets.map((asset) => asset.id)
    if (assetIds.length === 0) return [] as AiStudioAssetRecord[]
    return setOutputSelection(assetIds, true, true)
  }, [childOutputAssets, setOutputSelection])

  const clearSelectedChildOutputs = useCallback(async () => {
    const assetIds = childOutputAssets.map((asset) => asset.id)
    if (assetIds.length === 0) return [] as AiStudioAssetRecord[]
    return setOutputSelection(assetIds, false, false)
  }, [childOutputAssets, setOutputSelection])

  const sendSelectedChildOutputsToWorkshop = useCallback(async () => {
    const paths = uniqueStrings(
      activeSelectedChildOutputAssets.map((asset) => String(asset.filePath ?? '').trim())
    )
    if (paths.length === 0) {
      throw new Error('请先选择至少一张子图。')
    }
    setWorkshopImport('image', paths[0] ?? null, null, paths, 'ai-studio')
    setActiveModule('workshop')
    addLog(`[AI Studio] 已将 ${paths.length} 张子图发送到数据工坊。`)
    return paths
  }, [activeSelectedChildOutputAssets, addLog, setActiveModule, setWorkshopImport])
  const failureRecords = workflowMeta?.workflow.failures ?? []
  const stageProgress = useMemo(
    () => (workflowMeta ? buildStageProgress(workflowMeta) : {
      stage: 'master-setup' as AiStudioWorkflowStage,
      currentLabel: '待开始',
      currentIndex: 0,
      currentTotal: 0,
      totalCompleted: 0,
      totalPlanned: 0,
      successCount: 0,
      failureCount: 0
    }),
    [workflowMeta]
  )

  const patchWorkflowMetadata = useCallback(
    async (
      task: AiStudioTaskView,
      updater: (draft: AiStudioWorkflowMetadata) => void,
      extraPatch?: Record<string, unknown>
    ) => {
      const nextWorkflow = JSON.parse(JSON.stringify(readWorkflowMetadata(task))) as AiStudioWorkflowMetadata
      updater(nextWorkflow)
      return updateTaskPatch(task.id, {
        ...(extraPatch ?? {}),
        metadata: writeWorkflowMetadata(task, nextWorkflow)
      })
    },
    [updateTaskPatch]
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
      await setMasterPromptExtra(value)
    },
    [activeTask, setMasterPromptExtra]
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

  const setModel = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await updateTaskPatch(activeTask.id, { model: value })
    },
    [activeTask, updateTaskPatch]
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
      let result = await window.api.cms.aiStudio.task.startRun({ taskId })
      let guard = 0
      while (
        result.status !== 'succeeded' &&
        result.status !== 'failed' &&
        guard < 240
      ) {
        await sleepMs(2500)
        result = await window.api.cms.aiStudio.task.pollRun({ taskId, runId: result.run.id })
        guard += 1
      }
      if (result.status !== 'succeeded' && result.status !== 'failed') {
        throw new Error('[AI Studio] 任务轮询超时，请稍后重试。')
      }
      await refresh()
      return result
    },
    [refresh]
  )

  const ensureFreshTaskForMasterWorkflow = useCallback(async () => {
    if (!activeTask) return null
    const needsReset =
      activeTask.outputAssets.length > 0 ||
      Boolean(activeTask.latestRunId) ||
      Boolean(activeTask.remoteTaskId) ||
      activeTask.status === 'running' ||
      activeTask.status === 'completed' ||
      activeTask.status === 'failed'

    if (!needsReset) return activeTask

    const replacement = await createTaskWithInputs({
      primaryImagePath: activeTask.primaryImagePath,
      referenceImagePaths: activeTask.referenceImagePaths,
      inheritFrom: activeTask
    })
    await window.api.cms.aiStudio.task.delete({ taskId: activeTask.id }).catch(() => void 0)
    removeTaskLocally(activeTask.id)
    return replacement
  }, [activeTask, createTaskWithInputs, removeTaskLocally])

  const processMasterCleanup = useCallback(
    async (task: Pick<AiStudioTaskRecord, 'id'>, rawAsset: AiStudioAssetRecord, sequenceIndex: number) => {
      const outputs = await window.electronAPI.processWatermark({
        files: [rawAsset.filePath],
        pythonPath: aiConfig.pythonPath,
        scriptPath: aiConfig.watermarkScriptPath,
        watermarkBox: aiConfig.watermarkBox
      })
      const cleanPath = Array.isArray(outputs) ? String(outputs[0] ?? '').trim() : ''
      if (!cleanPath) {
        throw new Error('[AI Studio] 去水印未返回输出文件。')
      }

      const rawMetadata =
        rawAsset.metadata && typeof rawAsset.metadata === 'object'
          ? (rawAsset.metadata as Record<string, unknown>)
          : {}

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
            ...rawMetadata,
            stage: 'master',
            sequenceIndex,
            watermarkStatus: 'succeeded'
          }
        },
        {
          id: `${rawAsset.id}:clean`,
          taskId: task.id,
          runId: rawAsset.runId,
          kind: 'output',
          role: AI_STUDIO_MASTER_CLEAN_ROLE,
          filePath: cleanPath,
          previewPath: cleanPath,
          originPath: rawAsset.filePath,
          selected: false,
          sortOrder: rawAsset.sortOrder,
          metadata: {
            stage: 'master',
            sequenceIndex,
            sourceAssetId: rawAsset.id,
            watermarkStatus: 'succeeded'
          }
        }
      ])
    },
    [aiConfig.pythonPath, aiConfig.watermarkBox, aiConfig.watermarkScriptPath, upsertAssetsRemote]
  )

  const startMasterWorkflow = useCallback(async () => {
    if (!activeTask || !aiConfig.aiApiKey.trim()) {
      throw new Error('[AI Studio] 请先配置 API Key。')
    }
    if (!activeTask.primaryImagePath) {
      throw new Error('[AI Studio] 请先设置主图。')
    }

    const preparedTask = await ensureFreshTaskForMasterWorkflow()
    if (!preparedTask) return null

    const workingTask =
      preparedTask.id === activeTask.id
        ? preparedTask
        : coerceTaskRecord(await window.api.cms.aiStudio.task.list({ ids: [preparedTask.id], limit: 1 }).then((rows) => rows[0]))

    let workflow = readWorkflowMetadata(workingTask)
    if (!workflow.masterStage.templateId) {
      throw new Error('[AI Studio] 请先为母图阶段选择模板。')
    }

    workflow.workflow.activeStage = 'master-generating'
    workflow.workflow.sourcePrimaryImagePath = workingTask.primaryImagePath ?? null
    workflow.workflow.sourceReferenceImagePaths = uniqueStrings(workingTask.referenceImagePaths)
    workflow.workflow.currentAiMasterAssetId = null
    workflow.workflow.currentItemKind = 'master-generate'
    workflow.workflow.currentItemIndex = 0
    workflow.workflow.currentItemTotal = workflow.masterStage.requestedCount
    workflow.workflow.failures = []
    workflow.masterStage.completedCount = 0
    workflow.masterStage.cleanSuccessCount = 0
    workflow.masterStage.cleanFailedCount = 0
    workflow.childStage.completedCount = 0
    workflow.childStage.failedCount = 0

    let task = await updateTaskPatch(workingTask.id, {
      templateId: workflow.masterStage.templateId,
      promptExtra: workflow.masterStage.promptExtra,
      outputCount: 1,
      status: 'running',
      remoteTaskId: null,
      latestRunId: null,
      metadata: writeWorkflowMetadata(workingTask, workflow)
    })
    await refresh()

    for (let index = 1; index <= workflow.masterStage.requestedCount; index += 1) {
      const latestTask =
        (taskViews.find((item) => item.id === task.id) as AiStudioTaskView | undefined) ??
        (await window.api.cms.aiStudio.task.list({ ids: [task.id], limit: 1 }).then((rows) =>
          rows[0] ? (coerceTaskRecord(rows[0]) as AiStudioTaskView) : null
        ))
      if (!latestTask) break
      const loopWorkflow = readWorkflowMetadata(latestTask)
      loopWorkflow.workflow.activeStage = 'master-generating'
      loopWorkflow.workflow.currentItemKind = 'master-generate'
      loopWorkflow.workflow.currentItemIndex = index
      loopWorkflow.workflow.currentItemTotal = loopWorkflow.masterStage.requestedCount
      task = await updateTaskPatch(latestTask.id, {
        templateId: loopWorkflow.masterStage.templateId,
        promptExtra: loopWorkflow.masterStage.promptExtra,
        outputCount: 1,
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, loopWorkflow)
      })

      try {
        const result = await executeRunToTerminal(latestTask.id)
        const outputAssets = (result.outputs ?? []).map(coerceAssetRecord)
        loopWorkflow.masterStage.completedCount += 1

        if (result.status === 'succeeded' && outputAssets.length > 0) {
          const relabeled = await upsertAssetsRemote(
            outputAssets.map((asset, outputIndex) => ({
              id: asset.id,
              taskId: latestTask.id,
              runId: asset.runId,
              kind: 'output',
              role: AI_STUDIO_MASTER_OUTPUT_ROLE,
              filePath: asset.filePath,
              previewPath: asset.previewPath,
              originPath: asset.originPath,
              selected: asset.selected,
              sortOrder: asset.sortOrder,
              metadata: {
                ...(asset.metadata ?? {}),
                stage: 'master',
                sequenceIndex: index,
                outputIndex,
                watermarkStatus: 'pending'
              }
            }))
          )
          const rawAsset = relabeled[0]
          if (rawAsset) {
            loopWorkflow.workflow.activeStage = 'master-cleaning'
            loopWorkflow.workflow.currentItemKind = 'master-clean'
            loopWorkflow.workflow.currentItemIndex = index
            loopWorkflow.workflow.currentItemTotal = loopWorkflow.masterStage.requestedCount
            await updateTaskPatch(latestTask.id, {
              metadata: writeWorkflowMetadata(latestTask, loopWorkflow),
              status: 'running'
            })
            try {
              await processMasterCleanup(latestTask, rawAsset, index)
              loopWorkflow.masterStage.cleanSuccessCount += 1
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              loopWorkflow.masterStage.cleanFailedCount += 1
              loopWorkflow.workflow.failures.push(
                makeWorkflowFailureRecord('master-clean', index, message, { assetId: rawAsset.id })
              )
              await upsertAssetsRemote([
                {
                  id: rawAsset.id,
                  taskId: latestTask.id,
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
                    sequenceIndex: index,
                    watermarkStatus: 'failed'
                  }
                }
              ])
            }
          }
        } else {
          loopWorkflow.workflow.failures.push(
            makeWorkflowFailureRecord(
              'master-generate',
              index,
              result.run?.errorMessage || '母图生成失败',
              { runId: result.run?.id }
            )
          )
        }
      } catch (error) {
        loopWorkflow.masterStage.completedCount += 1
        loopWorkflow.workflow.failures.push(
          makeWorkflowFailureRecord('master-generate', index, error instanceof Error ? error.message : String(error))
        )
      }

      task = await updateTaskPatch(latestTask.id, {
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, loopWorkflow)
      })
      await refresh()
    }

    const completedTask = (await window.api.cms.aiStudio.task.list({ ids: [task.id], limit: 1 }).then((rows) => rows[0]))
    if (!completedTask) return null
    const completedRecord = coerceTaskRecord(completedTask)
    const completedWorkflow = readWorkflowMetadata(completedRecord)
    completedWorkflow.workflow.activeStage = 'master-selecting'
    completedWorkflow.workflow.currentItemKind = 'idle'
    completedWorkflow.workflow.currentItemIndex = 0
    completedWorkflow.workflow.currentItemTotal = completedWorkflow.masterStage.requestedCount
    await updateTaskPatch(completedRecord.id, {
      status: completedWorkflow.masterStage.cleanSuccessCount > 0 ? 'ready' : 'failed',
      metadata: writeWorkflowMetadata(completedRecord, completedWorkflow),
      promptExtra: completedWorkflow.masterStage.promptExtra,
      templateId: completedWorkflow.masterStage.templateId,
      outputCount: 1
    })
    await refresh()
    return true
  }, [
    activeTask,
    aiConfig.aiApiKey,
    ensureFreshTaskForMasterWorkflow,
    executeRunToTerminal,
    processMasterCleanup,
    refresh,
    taskViews,
    updateTaskPatch,
    upsertAssetsRemote
  ])

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
    [activeTask, loadLatestTaskRecord, masterRawAssets, processMasterCleanup, refresh, updateTaskPatch]
  )

  const retryMasterGeneration = useCallback(
    async (sequenceIndex: number) => {
      if (!activeTask || !aiConfig.aiApiKey.trim()) {
        throw new Error('[AI Studio] 请先配置 API Key。')
      }

      const latestTask = await loadLatestTaskRecord(activeTask.id)
      if (!latestTask) return

      const latestWorkflow = readWorkflowMetadata(latestTask)
      if (!latestWorkflow.masterStage.templateId) {
        throw new Error('[AI Studio] 请先为母图阶段选择模板。')
      }

      latestWorkflow.workflow.failures = latestWorkflow.workflow.failures.filter(
        (item) => !(item.stageKind === 'master-generate' && item.sequenceIndex === sequenceIndex)
      )
      latestWorkflow.workflow.activeStage = 'master-generating'
      latestWorkflow.workflow.currentItemKind = 'master-generate'
      latestWorkflow.workflow.currentItemIndex = sequenceIndex
      latestWorkflow.workflow.currentItemTotal = latestWorkflow.masterStage.requestedCount

      await updateTaskPatch(latestTask.id, {
        templateId: latestWorkflow.masterStage.templateId,
        promptExtra: latestWorkflow.masterStage.promptExtra,
        outputCount: 1,
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, latestWorkflow)
      })
      await refresh()

      const workingTask = await loadLatestTaskRecord(latestTask.id)
      if (!workingTask) return
      const workingWorkflow = readWorkflowMetadata(workingTask)

      try {
        const result = await executeRunToTerminal(workingTask.id)
        const outputAssets = (result.outputs ?? []).map(coerceAssetRecord)

        if (result.status === 'succeeded' && outputAssets.length > 0) {
          const relabeled = await upsertAssetsRemote(
            outputAssets.map((asset, outputIndex) => ({
              id: asset.id,
              taskId: workingTask.id,
              runId: asset.runId,
              kind: 'output',
              role: AI_STUDIO_MASTER_OUTPUT_ROLE,
              filePath: asset.filePath,
              previewPath: asset.previewPath,
              originPath: asset.originPath,
              selected: asset.selected,
              sortOrder: asset.sortOrder,
              metadata: {
                ...(asset.metadata ?? {}),
                stage: 'master',
                sequenceIndex,
                outputIndex,
                watermarkStatus: 'pending'
              }
            }))
          )
          const rawAsset = relabeled[0]
          if (rawAsset) {
            workingWorkflow.workflow.activeStage = 'master-cleaning'
            workingWorkflow.workflow.currentItemKind = 'master-clean'
            workingWorkflow.workflow.currentItemIndex = sequenceIndex
            workingWorkflow.workflow.currentItemTotal = workingWorkflow.masterStage.requestedCount
            await updateTaskPatch(workingTask.id, {
              status: 'running',
              metadata: writeWorkflowMetadata(workingTask, workingWorkflow)
            })

            try {
              await processMasterCleanup(workingTask, rawAsset, sequenceIndex)
              workingWorkflow.masterStage.cleanSuccessCount += 1
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              workingWorkflow.masterStage.cleanFailedCount += 1
              workingWorkflow.workflow.failures.push(
                makeWorkflowFailureRecord('master-clean', sequenceIndex, message, { assetId: rawAsset.id })
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
                    sequenceIndex,
                    watermarkStatus: 'failed'
                  }
                }
              ])
            }
          }
        } else {
          workingWorkflow.workflow.failures = workingWorkflow.workflow.failures.filter(
            (item) => !(item.stageKind === 'master-generate' && item.sequenceIndex === sequenceIndex)
          )
          workingWorkflow.workflow.failures.push(
            makeWorkflowFailureRecord(
              'master-generate',
              sequenceIndex,
              result.run?.errorMessage || '母图生成失败',
              { runId: result.run?.id }
            )
          )
        }
      } catch (error) {
        workingWorkflow.workflow.failures = workingWorkflow.workflow.failures.filter(
          (item) => !(item.stageKind === 'master-generate' && item.sequenceIndex === sequenceIndex)
        )
        workingWorkflow.workflow.failures.push(
          makeWorkflowFailureRecord(
            'master-generate',
            sequenceIndex,
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
    },
    [
      activeTask,
      aiConfig.aiApiKey,
      executeRunToTerminal,
      loadLatestTaskRecord,
      processMasterCleanup,
      refresh,
      updateTaskPatch,
      upsertAssetsRemote
    ]
  )

  const setCurrentAiMaster = useCallback(
    async (assetId: string) => {
      if (!activeTask) return
      const target = masterCleanAssets.find((asset) => asset.id === assetId)
      if (!target) return
      await patchWorkflowMetadata(activeTask, (draft) => {
        draft.workflow.currentAiMasterAssetId = target.id
        draft.workflow.activeStage = 'child-ready'
        draft.workflow.currentItemKind = 'idle'
        draft.workflow.currentItemIndex = 0
        draft.workflow.currentItemTotal = draft.childStage.requestedCount
      }, { status: 'ready' })
      await refresh()
    },
    [activeTask, masterCleanAssets, patchWorkflowMetadata, refresh]
  )

  const startChildWorkflow = useCallback(async () => {
    if (!activeTask || !aiConfig.aiApiKey.trim()) {
      throw new Error('[AI Studio] 请先配置 API Key。')
    }
    const workflow = workflowMeta
    if (!workflow?.workflow.currentAiMasterAssetId) {
      throw new Error('[AI Studio] 请先设为当前AI母图。')
    }
    if (!workflow.childStage.templateId) {
      throw new Error('[AI Studio] 请先为子图阶段选择模板。')
    }
    if (childOutputAssets.length > 0) {
      throw new Error('[AI Studio] 当前任务已有子图结果，本版 MVP 暂不支持在同一任务内重复生成子图。')
    }
    const variantList = normalizeVariantLines(workflow.childStage.variantLines).slice(0, workflow.childStage.requestedCount)
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
      const latestTaskRecord = await window.api.cms.aiStudio.task.list({ ids: [task.id], limit: 1 }).then((rows) => rows[0])
      if (!latestTaskRecord) break
      const latestTask = coerceTaskRecord(latestTaskRecord)
      const latestWorkflow = readWorkflowMetadata(latestTask)
      latestWorkflow.workflow.activeStage = 'child-generating'
      latestWorkflow.workflow.currentItemKind = 'child-generate'
      latestWorkflow.workflow.currentItemIndex = sequenceIndex
      latestWorkflow.workflow.currentItemTotal = latestWorkflow.childStage.requestedCount
      const currentPromptExtra = buildChildPromptExtra(latestWorkflow.childStage.promptExtra, variantLine)
      task = await updateTaskPatch(latestTask.id, {
        templateId: latestWorkflow.childStage.templateId,
        promptExtra: currentPromptExtra,
        outputCount: 1,
        status: 'running',
        metadata: writeWorkflowMetadata(latestTask, latestWorkflow)
      })

      try {
        const result = await executeRunToTerminal(latestTask.id)
        if (result.status === 'succeeded' && Array.isArray(result.outputs) && result.outputs.length > 0) {
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
          makeWorkflowFailureRecord('child-generate', sequenceIndex, error instanceof Error ? error.message : String(error))
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

    const finalTaskRecord = await window.api.cms.aiStudio.task.list({ ids: [task.id], limit: 1 }).then((rows) => rows[0])
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
    aiConfig.aiApiKey,
    childOutputAssets.length,
    executeRunToTerminal,
    refresh,
    updateTaskPatch,
    upsertAssetsRemote,
    workflowMeta
  ])

  const exceptionCount = useMemo(
    () => taskViews.filter((task) => task.status === 'failed').length,
    [taskViews]
  )

  return {
    templates: templateOptions,
    selectedTemplate: selectedTemplateBase ?? selectedTemplate,
    selectedMasterTemplate,
    selectedChildTemplate,
    tasks: taskViews,
    visibleTasks,
    activeTask,
    activeTaskId,
    activeInputAssets,
    activeOutputAssets,
    masterRawAssets,
    masterCleanAssets,
    childOutputAssets,
    currentAiMasterAsset,
    activeSelectedOutputAssets,
    activeSelectedOutputIds,
    activeSelectedChildOutputAssets,
    activeSelectedChildOutputIds,
    selectedOutputIdsByTask,
    selectedTaskIds,
    statusFilter,
    batchCostSummary,
    primaryImagePath,
    referenceImagePaths,
    exceptionCount,
    isLoading,
    isImporting,
    workflowMeta,
    activeStage,
    stageProgress,
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
    setOutputSelection,
    selectAllChildOutputs,
    clearSelectedChildOutputs,
    sendSelectedChildOutputsToWorkshop,
    seedDemoTask,
    assignPrimaryImage,
    addReferenceImages,
    removeReferenceImage,
    toggleReferenceImage,
    setPromptExtra,
    setOutputCount,
    setAspectRatio,
    setModel,
    setTemplateId,
    saveTemplate,
    saveStageTemplate,
    setMasterTemplateId,
    setChildTemplateId,
    setMasterPromptExtra,
    setChildPromptExtra,
    setMasterOutputCount,
    setChildOutputCount,
    setVariantLines,
    startMasterWorkflow,
    retryMasterCleanup,
    retryMasterGeneration,
    setCurrentAiMaster,
    startChildWorkflow
  }
}

export { useAiStudioState }
