import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { ArrowLeft, ImageIcon, MessageSquare, Video } from 'lucide-react'

import { Card } from '@renderer/components/ui/card'
import { generateManifest } from '@renderer/lib/cms-engine'
import { cn } from '@renderer/lib/utils'
import { useCmsStore, type Task } from '@renderer/store/useCmsStore'

import { BatchPickCanvas } from './BatchPickCanvas'
import {
  buildBatchPickAssets,
  pruneBatchPickSelection,
  resolveUsedBatchPickAssetIds
} from './batchPickHelpers'
import { AiStudioProjectLanding } from './AiStudioProjectLanding'
import { ControlPanel } from './ControlPanel'
import { NoteSidebar, type NoteSidebarMode, type NoteSidebarPhase } from './NoteSidebar'
import { ResultPanel } from './ResultPanel'
import { TaskQueue } from './TaskQueue'
import { normalizeNoteSidebarConstraints } from './noteSidebarHelpers'
import {
  buildProjectCardSummaries,
  formatProjectUpdatedAt,
  normalizeTrackedProjects,
  upsertTrackedProject,
  type AiStudioTrackedProjectEntry
} from './projectViewHelpers'
import { readTaskCapability, useAiStudioState } from './useAiStudioState'

const AI_STUDIO_CANVAS_SURFACE_CLASS =
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,244,245,0.96))]'
const AI_STUDIO_TRACKED_PROJECTS_STORAGE_KEY = 'cms.aiStudio.trackedProjects.v1'
const AI_STUDIO_PROJECT_HEADER_SURFACE_CLASS = AI_STUDIO_CANVAS_SURFACE_CLASS

function readStoredTrackedProjects(): AiStudioTrackedProjectEntry[] {
  try {
    const raw = localStorage.getItem(AI_STUDIO_TRACKED_PROJECTS_STORAGE_KEY)
    if (!raw) return []
    return normalizeTrackedProjects(JSON.parse(raw))
  } catch {
    return []
  }
}

function readPromptSeed(state: ReturnType<typeof useAiStudioState>): string {
  return String(
    state.activeTask?.promptExtra ?? state.masterPromptExtra ?? state.childPromptExtra ?? ''
  ).trim()
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

const NOTE_SIDEBAR_DEFAULTS = {
  mode: 'image-note' as NoteSidebarMode,
  phase: 'editing' as NoteSidebarPhase,
  csvDraft: '',
  groupCountDraft: '1',
  minImagesDraft: '3',
  maxImagesDraft: '5',
  maxReuseDraft: '1'
}

type NoteCanvasMode = 'result' | 'batch-pick'

function AiStudioCanvas({
  state,
  initialPromptDraft,
  isSidebarOpen,
  canvasMode,
  batchPickAssets,
  selectedBatchPickAssetIds,
  usedBatchPickAssetIds,
  onToggleBatchPickAsset,
  onChangeBatchPickSelection,
  onCloseBatchPick,
  className
}: {
  state: ReturnType<typeof useAiStudioState>
  initialPromptDraft: string
  isSidebarOpen: boolean
  canvasMode: NoteCanvasMode
  batchPickAssets: ReturnType<typeof buildBatchPickAssets>
  selectedBatchPickAssetIds: string[]
  usedBatchPickAssetIds: string[]
  onToggleBatchPickAsset: (assetId: string) => void
  onChangeBatchPickSelection: (nextAssetIds: string[]) => void
  onCloseBatchPick: () => void
  className?: string
}): React.JSX.Element {
  const [promptDraft, setPromptDraft] = useState(initialPromptDraft)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [composerOverlayPadding, setComposerOverlayPadding] = useState(isSidebarOpen ? 72 : 420)
  const effectiveComposerOverlayPadding = isSidebarOpen ? 72 : composerOverlayPadding

  useLayoutEffect(() => {
    if (isSidebarOpen) return

    const updateOverlayPadding = (): void => {
      const overlayHeight = overlayRef.current?.offsetHeight ?? 0
      const extraGap = 28
      setComposerOverlayPadding(overlayHeight > 0 ? overlayHeight + extraGap : 420)
    }

    updateOverlayPadding()

    const currentOverlay = overlayRef.current
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && currentOverlay
        ? new ResizeObserver(() => {
            updateOverlayPadding()
          })
        : null

    if (currentOverlay && resizeObserver) {
      resizeObserver.observe(currentOverlay)
    }

    window.addEventListener('resize', updateOverlayPadding)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateOverlayPadding)
    }
  }, [isSidebarOpen, promptDraft, state.studioCapability])

  return (
    <Card
      className={cn(
        'relative flex h-full min-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-[34px] border border-zinc-200/80 bg-transparent text-zinc-950 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur',
        className
      )}
    >
      {canvasMode === 'batch-pick' ? (
        <BatchPickCanvas
          assets={batchPickAssets}
          selectedAssetIds={selectedBatchPickAssetIds}
          usedAssetIds={usedBatchPickAssetIds}
          onToggleAsset={onToggleBatchPickAsset}
          onSelectionChange={onChangeBatchPickSelection}
          onExit={onCloseBatchPick}
          reservedSidebarWidth={isSidebarOpen ? 352 : 0}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <ResultPanel state={state} bottomSpacerHeight={effectiveComposerOverlayPadding} />
        </div>
      )}

      {!isSidebarOpen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-5 pt-2">
          <div
            ref={overlayRef}
            className="pointer-events-auto mx-auto flex w-full max-w-[920px] flex-col gap-3"
          >
            <div
              className={cn(
                'inline-flex items-center self-start rounded-[18px] border border-zinc-200/65 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.04)]',
                AI_STUDIO_CANVAS_SURFACE_CLASS
              )}
            >
              <button
                type="button"
                onClick={() => state.setStudioCapability('image')}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[14px] border px-3 text-[13px] font-medium transition',
                  state.studioCapability === 'image'
                    ? 'border-transparent bg-zinc-900 text-white'
                    : 'border-transparent text-zinc-500 hover:border-zinc-200 hover:text-zinc-900'
                )}
              >
                <ImageIcon className="h-4 w-4" />
                图片
              </button>
              <button
                type="button"
                onClick={() => state.setStudioCapability('video')}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[14px] border px-3 text-[13px] font-medium transition',
                  state.studioCapability === 'video'
                    ? 'border-transparent bg-zinc-900 text-white'
                    : 'border-transparent text-zinc-500 hover:border-zinc-200 hover:text-zinc-900'
                )}
              >
                <Video className="h-4 w-4" />
                视频
              </button>
              <button
                type="button"
                onClick={() => state.setStudioCapability('chat')}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[14px] border px-3 text-[13px] font-medium transition',
                  state.studioCapability === 'chat'
                    ? 'border-transparent bg-zinc-900 text-white'
                    : 'border-transparent text-zinc-500 hover:border-zinc-200 hover:text-zinc-900'
                )}
              >
                <MessageSquare className="h-4 w-4" />
                会话
              </button>
            </div>

            <div
              className={cn(
                'rounded-[28px] border border-zinc-200/65 px-3.5 pt-2.5 pb-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)]',
                AI_STUDIO_CANVAS_SURFACE_CLASS
              )}
            >
              <TaskQueue state={state} promptDraft={promptDraft} onPromptChange={setPromptDraft} />
              <div className="relative z-30 mt-2.5 pt-2.5 before:absolute before:left-4 before:right-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-zinc-200/65 before:to-transparent">
                <ControlPanel
                  state={state}
                  promptDraft={promptDraft}
                  onPromptClear={() => setPromptDraft('')}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

function AiStudio(): React.JSX.Element {
  const state = useAiStudioState()
  const activeModule = useCmsStore((store) => store.activeModule)
  const addLog = useCmsStore((store) => store.addLog)
  const setActiveModule = useCmsStore((store) => store.setActiveModule)
  const setPreferredAccountId = useCmsStore((store) => store.setPreferredAccountId)
  const setSelectedPublishTaskIds = useCmsStore((store) => store.setSelectedPublishTaskIds)
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const [noteSidebarOpen, setNoteSidebarOpen] = useState(false)
  const [noteSidebarMode, setNoteSidebarMode] = useState<NoteSidebarMode>(
    NOTE_SIDEBAR_DEFAULTS.mode
  )
  const [noteSidebarPhase, setNoteSidebarPhase] = useState<NoteSidebarPhase>(
    NOTE_SIDEBAR_DEFAULTS.phase
  )
  const [noteCsvDraft, setNoteCsvDraft] = useState(NOTE_SIDEBAR_DEFAULTS.csvDraft)
  const [noteGroupCountDraft, setNoteGroupCountDraft] = useState(
    NOTE_SIDEBAR_DEFAULTS.groupCountDraft
  )
  const [noteMinImagesDraft, setNoteMinImagesDraft] = useState(NOTE_SIDEBAR_DEFAULTS.minImagesDraft)
  const [noteMaxImagesDraft, setNoteMaxImagesDraft] = useState(NOTE_SIDEBAR_DEFAULTS.maxImagesDraft)
  const [noteMaxReuseDraft, setNoteMaxReuseDraft] = useState(NOTE_SIDEBAR_DEFAULTS.maxReuseDraft)
  const [notePreviewTasks, setNotePreviewTasks] = useState<Task[]>([])
  const [isGeneratingNotePreview, setIsGeneratingNotePreview] = useState(false)
  const [noteUploadedMaterialPaths, setNoteUploadedMaterialPaths] = useState<string[]>([])
  const [noteCanvasMode, setNoteCanvasMode] = useState<NoteCanvasMode>('result')
  const [selectedBatchPickAssetIds, setSelectedBatchPickAssetIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'landing' | 'workspace'>('landing')
  const [landingMode, setLandingMode] = useState<'recent' | 'all'>('recent')
  const [newProjectNameDraft, setNewProjectNameDraft] = useState('')
  const [isNamingNewProject, setIsNamingNewProject] = useState(false)
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [trackedProjects, setTrackedProjects] = useState<AiStudioTrackedProjectEntry[]>(() =>
    readStoredTrackedProjects()
  )
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const previousActiveModuleRef = useRef(activeModule)

  const resetNoteSidebarState = useCallback((): void => {
    setNoteSidebarOpen(false)
    setNoteSidebarMode(NOTE_SIDEBAR_DEFAULTS.mode)
    setNoteSidebarPhase(NOTE_SIDEBAR_DEFAULTS.phase)
    setNoteCsvDraft(NOTE_SIDEBAR_DEFAULTS.csvDraft)
    setNoteGroupCountDraft(NOTE_SIDEBAR_DEFAULTS.groupCountDraft)
    setNoteMinImagesDraft(NOTE_SIDEBAR_DEFAULTS.minImagesDraft)
    setNoteMaxImagesDraft(NOTE_SIDEBAR_DEFAULTS.maxImagesDraft)
    setNoteMaxReuseDraft(NOTE_SIDEBAR_DEFAULTS.maxReuseDraft)
    setNotePreviewTasks([])
    setNoteUploadedMaterialPaths([])
    setNoteCanvasMode('result')
    setSelectedBatchPickAssetIds([])
  }, [])

  const noteMaterials = useMemo(() => {
    const now = Date.now()
    const pooled = state.pooledOutputAssets.filter((asset) =>
      /\.(jpg|jpeg|png|webp|heic)$/i.test(String(asset.filePath ?? '').trim())
    )
    const uploaded = noteUploadedMaterialPaths.map((filePath, index) => ({
      id: `note-upload:${index}:${filePath}`,
      taskId: 'note-upload',
      runId: null,
      kind: 'input' as const,
      role: 'note-upload',
      filePath,
      previewPath: filePath,
      originPath: filePath,
      selected: false,
      sortOrder: index,
      metadata: {},
      createdAt: now + index,
      updatedAt: now + index
    }))
    return [...uploaded, ...pooled]
  }, [noteUploadedMaterialPaths, state.pooledOutputAssets])

  const batchPickAssets = useMemo(
    () => buildBatchPickAssets(state.historyTasks),
    [state.historyTasks]
  )
  const projectCards = useMemo(
    () =>
      buildProjectCardSummaries({
        tasks: state.tasks.map((task) => ({
          id: task.id,
          productName: task.productName,
          status: task.status,
          sourceFolderPath: task.sourceFolderPath,
          metadata: task.metadata,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          outputAssets: task.outputAssets.map((asset) => ({
            id: asset.id,
            filePath: asset.filePath,
            previewPath: asset.previewPath,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            sortOrder: asset.sortOrder
          }))
        })),
        trackedProjects
      }),
    [state.tasks, trackedProjects]
  )
  const usedBatchPickAssetIds = useMemo(
    () => resolveUsedBatchPickAssetIds(batchPickAssets, noteMaterials),
    [batchPickAssets, noteMaterials]
  )

  const handleToggleBatchPickAsset = useCallback((assetId: string): void => {
    setSelectedBatchPickAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((currentId) => currentId !== assetId)
        : [...current, assetId]
    )
  }, [])

  const handleChangeBatchPickSelection = useCallback((nextAssetIds: string[]): void => {
    setSelectedBatchPickAssetIds(nextAssetIds)
  }, [])

  const handleOpenBatchPick = useCallback((): void => {
    setNoteCanvasMode('batch-pick')
  }, [])

  const handleCloseBatchPick = useCallback((): void => {
    setNoteCanvasMode('result')
  }, [])

  useEffect(() => {
    if (!noteSidebarOpen || noteSidebarMode !== 'image-note' || noteSidebarPhase !== 'editing') {
      setNoteCanvasMode('result')
    }
  }, [noteSidebarMode, noteSidebarOpen, noteSidebarPhase])

  useEffect(() => {
    const availableAssetIds = batchPickAssets.map((asset) => asset.id)
    setSelectedBatchPickAssetIds((current) =>
      pruneBatchPickSelection({
        selectedAssetIds: current,
        availableAssetIds,
        usedAssetIds: usedBatchPickAssetIds
      })
    )
  }, [batchPickAssets, usedBatchPickAssetIds])

  useEffect(() => {
    setProjectNameDraft(String(state.currentProjectName ?? '').trim())
  }, [state.currentProjectId, state.currentProjectName])

  useEffect(() => {
    try {
      localStorage.setItem(
        AI_STUDIO_TRACKED_PROJECTS_STORAGE_KEY,
        JSON.stringify(normalizeTrackedProjects(trackedProjects))
      )
    } catch {
      return
    }
  }, [trackedProjects])

  useEffect(() => {
    if (activeModule === 'aiStudio' && previousActiveModuleRef.current !== 'aiStudio') {
      setViewMode('landing')
      setLandingMode('recent')
      setNewProjectNameDraft('')
      setIsNamingNewProject(false)
    }
    previousActiveModuleRef.current = activeModule
  }, [activeModule])

  const handleGenerateNotePreview = async (): Promise<void> => {
    const materialPaths = Array.from(
      new Set(noteMaterials.map((asset) => String(asset.filePath ?? '').trim()).filter(Boolean))
    )

    if (materialPaths.length === 0) {
      window.alert('请先从结果区加入至少一张图到图池。')
      return
    }

    if (!noteCsvDraft.trim()) {
      window.alert('请先输入 CSV 格式文案。')
      return
    }

    setIsGeneratingNotePreview(true)
    try {
      const nextTasks = generateManifest(noteCsvDraft, materialPaths, {
        ...normalizeNoteSidebarConstraints({
          groupCount: noteGroupCountDraft,
          minImages: noteMinImagesDraft,
          maxImages: noteMaxImagesDraft,
          maxReuse: noteMaxReuseDraft
        }),
        bestEffort: true
      })
      setNotePreviewTasks(nextTasks)
      setNoteSidebarPhase('preview')
      addLog(`[AI Studio] 已生成 ${nextTasks.length} 组图文笔记预览。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 图文笔记预览生成失败：${message}`)
      window.alert(message)
    } finally {
      setIsGeneratingNotePreview(false)
    }
  }

  const handleDispatchNotePreview = async (selectedTaskIds: string[]): Promise<void> => {
    const tasksToDispatch =
      selectedTaskIds.length > 0
        ? notePreviewTasks.filter((task) => selectedTaskIds.includes(task.id))
        : notePreviewTasks

    if (tasksToDispatch.length === 0) return
    const tasksMissingAccount = tasksToDispatch.filter(
      (task) => !String(task.accountId ?? '').trim()
    )
    if (tasksMissingAccount.length > 0) {
      window.alert('请先为选中的笔记完成分发设置并选择账号。')
      return
    }

    const requestId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    let unbindProgress = (): void => {
      void 0
    }

    try {
      unbindProgress = window.api.cms.task.onCreateBatchProgress((payload) => {
        if (!payload) return
        if (payload.requestId !== requestId) return
        const processed = typeof payload.processed === 'number' ? payload.processed : 0
        const total = typeof payload.total === 'number' ? payload.total : tasksToDispatch.length
        const created = typeof payload.created === 'number' ? payload.created : 0
        const message =
          typeof payload.message === 'string'
            ? payload.message
            : `派发处理中（${processed}/${total}）`
        addLog(`[AI Studio] ${message}，已创建 ${created} 条。`)
      })

      const created = await window.api.cms.task.createBatch(
        tasksToDispatch.map((task) => ({
          accountId: String(task.accountId ?? '').trim(),
          images: task.assignedImages,
          title: task.title,
          content: task.body,
          productId: String(task.productId ?? '').trim() || undefined,
          productName: String(task.productName ?? '').trim() || undefined,
          linkedProducts:
            Array.isArray(task.linkedProducts) && task.linkedProducts.length > 0
              ? task.linkedProducts
              : undefined,
          mediaType: task.mediaType,
          videoPath: task.videoPath,
          videoPreviewPath: task.videoPreviewPath,
          videoCoverMode: task.videoCoverMode
        })),
        { requestId }
      )

      const firstAccountId = String(
        created[0]?.accountId ?? tasksToDispatch[0]?.accountId ?? ''
      ).trim()
      if (firstAccountId) {
        setPreferredAccountId(firstAccountId)
      }
      setSelectedPublishTaskIds(created.map((task) => String(task.id ?? '').trim()).filter(Boolean))
      setActiveModule('autopublish')
      resetNoteSidebarState()
      addLog(`[AI Studio] 已将 ${created.length} 组图文笔记直接派发到媒体矩阵队列。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 图文笔记派发失败：${message}`)
      window.alert(message)
    } finally {
      unbindProgress()
    }
  }

  const noteSidebarNode = (
    <NoteSidebar
      isOpen={noteSidebarOpen}
      mode={noteSidebarMode}
      phase={noteSidebarPhase}
      canvasMode={noteCanvasMode}
      materials={noteMaterials}
      csvDraft={noteCsvDraft}
      groupCountDraft={noteGroupCountDraft}
      minImagesDraft={noteMinImagesDraft}
      maxImagesDraft={noteMaxImagesDraft}
      maxReuseDraft={noteMaxReuseDraft}
      isGenerating={isGeneratingNotePreview}
      previewTasks={notePreviewTasks}
      onOpenChange={setNoteSidebarOpen}
      onModeChange={(mode) => {
        setNoteSidebarMode(mode)
        setNoteSidebarPhase('editing')
        setNoteCanvasMode('result')
        setSelectedBatchPickAssetIds([])
      }}
      onCsvChange={setNoteCsvDraft}
      onGroupCountChange={setNoteGroupCountDraft}
      onMinImagesChange={setNoteMinImagesDraft}
      onMaxImagesChange={setNoteMaxImagesDraft}
      onMaxReuseChange={setNoteMaxReuseDraft}
      onGenerate={() => void handleGenerateNotePreview()}
      onRegenerate={() => {
        setNoteSidebarPhase('editing')
        setNotePreviewTasks([])
        setNoteCanvasMode('result')
        setSelectedBatchPickAssetIds([])
      }}
      onPreviewTasksChange={(tasks) => {
        setNotePreviewTasks(tasks)
      }}
      onDispatch={(selectedIds) => {
        void handleDispatchNotePreview(selectedIds)
      }}
      onAddMaterials={(paths) => {
        setNoteUploadedMaterialPaths((current) => uniqueStrings([...current, ...paths]))
      }}
      onRemoveMaterial={(asset) => {
        if (asset.taskId === 'note-upload') {
          setNoteUploadedMaterialPaths((current) =>
            current.filter((filePath) => filePath !== asset.filePath)
          )
          return
        }
        void state.toggleDispatchOutputPoolForTask(asset.taskId, asset.id)
      }}
      onOpenBatchPick={handleOpenBatchPick}
    />
  )

  const activeProjectDateLabel = useMemo(
    () => formatProjectUpdatedAt(state.currentProjectUpdatedAt ?? 0),
    [state.currentProjectUpdatedAt]
  )

  const handleReturnToLanding = useCallback((): void => {
    resetNoteSidebarState()
    state.setProjectScopeId(null)
    setViewMode('landing')
    setLandingMode('recent')
    setIsNamingNewProject(false)
    setNewProjectNameDraft('')
  }, [resetNoteSidebarState, state])

  const handleStartCreateProject = useCallback((): void => {
    if (isCreatingProject) return
    setIsNamingNewProject(true)
  }, [isCreatingProject])

  const handleCancelCreateProject = useCallback((): void => {
    if (isCreatingProject) return
    setIsNamingNewProject(false)
    setNewProjectNameDraft('')
  }, [isCreatingProject])

  const handleCreateProject = useCallback((): void => {
    if (isCreatingProject) return
    setIsCreatingProject(true)
    void state
      .createFreshProjectTask(newProjectNameDraft)
      .then((task) => {
        if (!task) return
        setTrackedProjects((current) =>
          upsertTrackedProject(current, {
            taskId: task.id,
            createdAt: task.createdAt,
            lastOpenedAt: task.updatedAt || Date.now()
          })
        )
        resetNoteSidebarState()
        setViewMode('workspace')
        setLandingMode('recent')
        setIsNamingNewProject(false)
        setNewProjectNameDraft('')
        setProjectNameDraft(String(task.productName ?? '').trim())
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[AI Studio] 新建项目失败：${message}`)
        window.alert(message)
      })
      .finally(() => {
        setIsCreatingProject(false)
      })
  }, [addLog, isCreatingProject, newProjectNameDraft, resetNoteSidebarState, state])

  const handleOpenProject = useCallback(
    (taskId: string): void => {
      const targetTask = state.tasks.find((task) => task.id === taskId)
      if (!targetTask) return
      resetNoteSidebarState()
      state.setProjectScopeId(taskId)
      state.setStudioCapability(readTaskCapability(targetTask))
      state.setActiveTaskId(taskId)
      setTrackedProjects((current) =>
        upsertTrackedProject(current, {
          taskId,
          createdAt: targetTask.createdAt,
          lastOpenedAt: Date.now()
        })
      )
      setViewMode('workspace')
      setLandingMode('recent')
    },
    [resetNoteSidebarState, state]
  )

  const handleRenameProject = useCallback(
    async (taskId: string, nextTitle: string): Promise<void> => {
      const normalizedTaskId = String(taskId ?? '').trim()
      if (!normalizedTaskId) return
      try {
        await state.renameTask(normalizedTaskId, nextTitle)
        setTrackedProjects((current) =>
          upsertTrackedProject(current, {
            taskId: normalizedTaskId,
            createdAt:
              state.tasks.find((task) => task.id === normalizedTaskId)?.createdAt ?? Date.now(),
            lastOpenedAt: Date.now()
          })
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[AI Studio] 项目改名失败：${message}`)
        window.alert(message)
      }
    },
    [addLog, state]
  )

  const handleSaveProjectName = useCallback(async (): Promise<void> => {
    if (!state.currentProjectId) return
    const normalizedDraft = projectNameDraft.trim()
    const currentName = String(state.currentProjectName ?? '').trim()
    if (normalizedDraft === currentName) return
    try {
      await state.renameTask(state.currentProjectId, projectNameDraft)
      setTrackedProjects((current) =>
        upsertTrackedProject(current, {
          taskId: state.currentProjectId ?? '',
          createdAt: state.currentProjectTask?.createdAt,
          lastOpenedAt: Date.now()
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 更新项目名失败：${message}`)
      window.alert(message)
      setProjectNameDraft(currentName)
    }
  }, [addLog, projectNameDraft, state])

  if (viewMode === 'landing') {
    return (
      <AiStudioProjectLanding
        mode={landingMode}
        projectCards={projectCards}
        newProjectName={newProjectNameDraft}
        isCreatingProject={isCreatingProject}
        isNamingNewProject={isNamingNewProject}
        workspacePath={workspacePath}
        onNewProjectNameChange={setNewProjectNameDraft}
        onStartCreateProject={handleStartCreateProject}
        onCancelCreateProject={handleCancelCreateProject}
        onCreateProject={handleCreateProject}
        onOpenProject={handleOpenProject}
        onRenameProject={handleRenameProject}
        onToggleMode={setLandingMode}
      />
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-[calc(100vh-3rem)] min-h-0 flex-col overflow-hidden rounded-[18px] border border-zinc-200/80 text-zinc-950 shadow-[0_24px_90px_rgba(15,23,42,0.08)]',
        AI_STUDIO_PROJECT_HEADER_SURFACE_CLASS
      )}
    >
      {noteSidebarNode}

      <div className="sticky top-0 z-20 shrink-0 bg-transparent px-5 py-4 text-zinc-950">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReturnToLanding}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200/80 bg-white/80 text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-950"
              aria-label="返回项目首页"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <div className="text-[12px] font-medium tracking-[0.14em] text-zinc-400">
                当前项目
              </div>
              <div className="mt-1 text-[14px] text-zinc-500">更新于 {activeProjectDateLabel}</div>
            </div>
          </div>

          <div className="flex min-w-0 items-start justify-between gap-3 md:ml-auto md:w-auto md:max-w-[48%] md:justify-end">
            <input
              value={projectNameDraft}
              onChange={(event) => setProjectNameDraft(event.target.value)}
              onBlur={() => void handleSaveProjectName()}
              onClick={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setProjectNameDraft(String(state.currentProjectName ?? '').trim())
                  event.currentTarget.blur()
                }
              }}
              placeholder="输入项目名"
              className="h-11 min-w-0 flex-1 border-0 bg-transparent px-0 text-left text-[22px] font-semibold tracking-[-0.04em] text-zinc-950 outline-none transition placeholder:text-zinc-350 sm:text-[24px] md:max-w-[260px] md:text-right"
              style={{ fontFamily: '"Iowan Old Style", "Noto Serif SC", "Songti SC", serif' }}
            />
            {!noteSidebarOpen ? (
              <button
                type="button"
                onClick={() => setNoteSidebarOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white/92 text-zinc-600 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition hover:border-zinc-300 hover:text-zinc-950"
                aria-label="打开图文创作中心"
                title="打开图文创作中心"
              >
                <ImageIcon className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <AiStudioCanvas
        key={`${state.studioCapability}:${state.activeTask?.id ?? 'empty'}`}
        state={state}
        initialPromptDraft={readPromptSeed(state)}
        isSidebarOpen={noteSidebarOpen}
        canvasMode={noteCanvasMode}
        batchPickAssets={batchPickAssets}
        selectedBatchPickAssetIds={selectedBatchPickAssetIds}
        usedBatchPickAssetIds={usedBatchPickAssetIds}
        onToggleBatchPickAsset={handleToggleBatchPickAsset}
        onChangeBatchPickSelection={handleChangeBatchPickSelection}
        onCloseBatchPick={handleCloseBatchPick}
        className="min-h-0 flex-1 rounded-none border-0 shadow-none"
      />
    </div>
  )
}

export { AiStudio }
