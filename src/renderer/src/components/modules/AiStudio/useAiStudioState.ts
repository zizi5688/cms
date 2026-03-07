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
      role: 'primary',
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
      role: 'reference',
      filePath,
      previewPath: filePath,
      originPath: filePath,
      sortOrder: index + 1,
      metadata: { importedAt: Date.now(), slot: `reference-${index}` }
    })
  })

  return writes
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
          metadata: {
            ...(baseTask?.metadata ?? {}),
            importedImageCount: inputImagePaths.length,
            mode: 'single-task'
          }
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
        metadata: {
          ...(task.metadata ?? {}),
          importedImageCount: inputImagePaths.length,
          mode: 'single-task'
        }
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

  const setPromptExtra = useCallback(
    async (value: string) => {
      if (!activeTask) return
      await updateTaskPatch(activeTask.id, { promptExtra: value })
    },
    [activeTask, updateTaskPatch]
  )

  const setOutputCount = useCallback(
    async (value: number) => {
      if (!activeTask) return
      await updateTaskPatch(activeTask.id, { outputCount: Math.max(1, Math.floor(value || 1)) })
    },
    [activeTask, updateTaskPatch]
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
      await updateTaskPatch(activeTask.id, { templateId: value || null })
    },
    [activeTask, updateTaskPatch]
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

  const selectedTemplate = useMemo(() => {
    if (!activeTask?.templateId) return null
    return templateOptions.find((template) => template.id === activeTask.templateId) ?? null
  }, [activeTask?.templateId, templateOptions])

  const exceptionCount = useMemo(
    () => taskViews.filter((task) => task.status === 'failed').length,
    [taskViews]
  )

  return {
    templates: templateOptions,
    selectedTemplate,
    tasks: taskViews,
    visibleTasks,
    activeTask,
    activeTaskId,
    activeInputAssets,
    activeOutputAssets,
    activeSelectedOutputAssets,
    activeSelectedOutputIds,
    selectedOutputIdsByTask,
    selectedTaskIds,
    statusFilter,
    batchCostSummary,
    primaryImagePath,
    referenceImagePaths,
    exceptionCount,
    isLoading,
    isImporting,
    refresh,
    importFolders,
    setStatusFilter,
    setActiveTaskId,
    toggleTaskSelection,
    toggleOutputSelection,
    setOutputSelection,
    assignPrimaryImage,
    addReferenceImages,
    removeReferenceImage,
    toggleReferenceImage,
    setPromptExtra,
    setOutputCount,
    setAspectRatio,
    setModel,
    setTemplateId,
    saveTemplate
  }
}

export { useAiStudioState }
