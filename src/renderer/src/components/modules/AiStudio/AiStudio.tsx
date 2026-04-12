import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { flushSync } from 'react-dom'

import { ArrowLeft, ImageIcon, MessageSquare, Sparkles, Video } from 'lucide-react'

import { Card } from '@renderer/components/ui/card'
import { countManifestCsvRows, generateManifest } from '@renderer/lib/cms-engine'
import { cn } from '@renderer/lib/utils'
import { useCmsStore, type Task } from '@renderer/store/useCmsStore'
import type { SmartGenerationPhase } from '../../ui/smartGenerationOverlayHelpers'

import { BatchPickCanvas } from './BatchPickCanvas'
import {
  buildBatchPickAssets,
  pruneBatchPickSelection,
  resolveUsedBatchPickAssetIds
} from './batchPickHelpers'
import { AiStudioProjectLanding } from './AiStudioProjectLanding'
import { ControlPanel } from './ControlPanel'
import {
  NoteSidebar,
  type ImageNoteEntryMode,
  type NoteSidebarMode,
  type NoteSidebarPhase
} from './NoteSidebar'
import { ResultPanel } from './ResultPanel'
import {
  buildSmartNoteChatInput,
  buildVideoSmartNoteChatInput,
  extractCsvFromSmartNoteResponse
} from './smartNoteGenerationHelpers'
import { TaskQueue } from './TaskQueue'
import {
  countUndispatchedNotePreviewTasks,
  markNotePreviewTasksDispatched,
  matchCreatedTasksToNotePreviewTaskIds,
  normalizeNoteSidebarConstraints,
  resolveNotePreviewTasksForDispatch,
  shouldAutoOpenBatchPickForVideoPreview
} from './noteSidebarHelpers'
import {
  buildGeneratedVideoNotePreviewTasks,
  type GeneratedVideoNoteAsset
} from './videoNotePreviewHelpers'
import { type VideoNoteEntryMode } from './videoNoteEditorHelpers'
import {
  applyVideoNoteGenerationUpdate,
  createInitialVideoNoteGenerationState,
  type VideoNoteGenerationState
} from './videoNoteGenerationOrchestrator'
import { runVideoSmartGenerationFlow } from './videoSmartGenerationFlow'
import {
  buildProjectCardSummaries,
  formatProjectUpdatedAt,
  normalizeTrackedProjects,
  removeTrackedProjects,
  upsertTrackedProject,
  type AiStudioTrackedProjectEntry
} from './projectViewHelpers'
import { readTaskCapability, useAiStudioState } from './useAiStudioState'
import {
  isVideoComposerImageFile,
  isVideoComposerVideoFile,
  useVideoComposerController
} from '../useVideoComposerController'

const AI_STUDIO_CANVAS_SURFACE_CLASS = 'bg-[#fbfbfc]'
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
  smartPromptDraft: '',
  videoSmartPromptDraft: '',
  videoEntryMode: 'smart' as VideoNoteEntryMode,
  groupCountDraft: '1',
  minImagesDraft: '3',
  maxImagesDraft: '5',
  maxReuseDraft: '1'
}

type NoteCanvasMode = 'result' | 'batch-pick'

type NoteDispatchProgressState = {
  phase: 'start' | 'progress' | 'done'
  processed: number
  total: number
  created: number
  message: string
}

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
        'relative flex h-full min-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-[34px] border border-zinc-200/80 text-zinc-950 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur',
        AI_STUDIO_CANVAS_SURFACE_CLASS,
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
  const [noteSmartPromptDraft, setNoteSmartPromptDraft] = useState(
    NOTE_SIDEBAR_DEFAULTS.smartPromptDraft
  )
  const [videoNoteSmartPromptDraft, setVideoNoteSmartPromptDraft] = useState(
    NOTE_SIDEBAR_DEFAULTS.videoSmartPromptDraft
  )
  const [videoNoteEntryMode, setVideoNoteEntryMode] = useState<VideoNoteEntryMode>(
    NOTE_SIDEBAR_DEFAULTS.videoEntryMode
  )
  const [noteGroupCountDraft, setNoteGroupCountDraft] = useState(
    NOTE_SIDEBAR_DEFAULTS.groupCountDraft
  )
  const [noteMinImagesDraft, setNoteMinImagesDraft] = useState(NOTE_SIDEBAR_DEFAULTS.minImagesDraft)
  const [noteMaxImagesDraft, setNoteMaxImagesDraft] = useState(NOTE_SIDEBAR_DEFAULTS.maxImagesDraft)
  const [noteMaxReuseDraft, setNoteMaxReuseDraft] = useState(NOTE_SIDEBAR_DEFAULTS.maxReuseDraft)
  const [notePreviewTasks, setNotePreviewTasks] = useState<Task[]>([])
  const [isGeneratingNotePreview, setIsGeneratingNotePreview] = useState(false)
  const [smartGenPhase, setSmartGenPhase] = useState<SmartGenerationPhase>(null)
  const [smartGenError, setSmartGenError] = useState<string | null>(null)
  const [videoNoteGenerationState, setVideoNoteGenerationState] =
    useState<VideoNoteGenerationState>(() => createInitialVideoNoteGenerationState())
  const [noteDispatchProgress, setNoteDispatchProgress] =
    useState<NoteDispatchProgressState | null>(null)
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
  const noteDispatchHideTimeoutRef = useRef<number | null>(null)
  const videoComposer = useVideoComposerController({
    logPrefix: '[AI Studio][视频笔记]'
  })

  const clearNoteDispatchHideTimeout = useCallback((): void => {
    if (noteDispatchHideTimeoutRef.current === null) return
    window.clearTimeout(noteDispatchHideTimeoutRef.current)
    noteDispatchHideTimeoutRef.current = null
  }, [])

  useEffect(() => clearNoteDispatchHideTimeout, [clearNoteDispatchHideTimeout])

  const resetNoteSidebarState = useCallback((): void => {
    clearNoteDispatchHideTimeout()
    setNoteSidebarOpen(false)
    setNoteSidebarMode(NOTE_SIDEBAR_DEFAULTS.mode)
    setNoteSidebarPhase(NOTE_SIDEBAR_DEFAULTS.phase)
    setNoteCsvDraft(NOTE_SIDEBAR_DEFAULTS.csvDraft)
    setNoteSmartPromptDraft(NOTE_SIDEBAR_DEFAULTS.smartPromptDraft)
    setVideoNoteSmartPromptDraft(NOTE_SIDEBAR_DEFAULTS.videoSmartPromptDraft)
    setVideoNoteEntryMode(NOTE_SIDEBAR_DEFAULTS.videoEntryMode)
    setNoteGroupCountDraft(NOTE_SIDEBAR_DEFAULTS.groupCountDraft)
    setNoteMinImagesDraft(NOTE_SIDEBAR_DEFAULTS.minImagesDraft)
    setNoteMaxImagesDraft(NOTE_SIDEBAR_DEFAULTS.maxImagesDraft)
    setNoteMaxReuseDraft(NOTE_SIDEBAR_DEFAULTS.maxReuseDraft)
    setNotePreviewTasks([])
    setSmartGenPhase(null)
    setSmartGenError(null)
    setVideoNoteGenerationState(createInitialVideoNoteGenerationState())
    setNoteDispatchProgress(null)
    setNoteUploadedMaterialPaths([])
    setNoteCanvasMode('result')
    setSelectedBatchPickAssetIds([])
    videoComposer.resetComposer()
  }, [clearNoteDispatchHideTimeout, videoComposer])

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
  const pooledVideoNoteMediaPaths = useMemo(
    () =>
      Array.from(
        new Set(
          state.pooledOutputAssets
            .map((asset) => String(asset.filePath ?? '').trim())
            .filter(
              (filePath) => isVideoComposerImageFile(filePath) || isVideoComposerVideoFile(filePath)
            )
        )
      ),
    [state.pooledOutputAssets]
  )
  const hasReusableRenderedVideoAssets =
    videoNoteGenerationState.mergeStatus === 'partial-failed' &&
    videoNoteGenerationState.renderStatus === 'success' &&
    videoNoteGenerationState.previewAssets.length > 0
  const canRetrySmartCopyOnly =
    videoNoteGenerationState.canRetryCopyOnly && videoNoteGenerationState.previewAssets.length > 0
  const isVideoGenerateDisabled =
    isGeneratingNotePreview ||
    (videoNoteEntryMode === 'manual'
      ? !hasReusableRenderedVideoAssets && !videoComposer.canGenerate
      : !canRetrySmartCopyOnly && !videoComposer.canGenerate)

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
    const keepBatchPickForVideoPreview =
      noteSidebarOpen && noteSidebarMode === 'video-note' && noteSidebarPhase === 'preview'
    if (keepBatchPickForVideoPreview) {
      return
    }
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

  const buildImageNotePreviewTasksFromCsv = (csvText: string): Task[] => {
    const materialPaths = Array.from(
      new Set(noteMaterials.map((asset) => String(asset.filePath ?? '').trim()).filter(Boolean))
    )

    if (materialPaths.length === 0) {
      window.alert('请先从结果区加入至少一张图到图池。')
      return []
    }

    if (!String(csvText ?? '').trim()) {
      window.alert('请先输入 CSV 格式文案。')
      return []
    }

    return generateManifest(csvText, materialPaths, {
      ...normalizeNoteSidebarConstraints({
        groupCount: noteGroupCountDraft,
        minImages: noteMinImagesDraft,
        maxImages: noteMaxImagesDraft,
        maxReuse: noteMaxReuseDraft
      }),
      bestEffort: true
    })
  }

  const generateImageNotePreviewFromCsv = async (csvText: string): Promise<void> => {
    setIsGeneratingNotePreview(true)
    try {
      const nextTasks = buildImageNotePreviewTasksFromCsv(csvText)
      if (nextTasks.length === 0) return
      setNotePreviewTasks(nextTasks)
      setNoteSidebarPhase('preview')
      addLog(`[AI Studio] 已生成 ${nextTasks.length} 组图文笔记预览。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 图文笔记预览生成失败：${message}`)
      flushSync(() => {
        setIsGeneratingNotePreview(false)
      })
      window.alert(message)
    } finally {
      setIsGeneratingNotePreview(false)
    }
  }

  const handleGenerateNotePreview = async (): Promise<void> => {
    await generateImageNotePreviewFromCsv(noteCsvDraft)
  }

  const handleGenerateSmartNotePreview = async (): Promise<void> => {
    setSmartGenError(null)
    setIsGeneratingNotePreview(true)
    try {
      const chatInput = buildSmartNoteChatInput({
        userExtraPrompt: noteSmartPromptDraft,
        groupCount: Number(noteGroupCountDraft)
      })
      setSmartGenPhase('connecting')
      addLog('[AI Studio] 已发送图文智能生成请求（临时降级为纯文字模式，不附带参考图）。')
      setSmartGenPhase('generating')
      const result = (await state.startChatRun({
        promptText: chatInput.prompt,
        imagePaths: chatInput.imagePaths
      })) as {
        outputText?: unknown
      }
      setSmartGenPhase('parsing')
      const csvText = extractCsvFromSmartNoteResponse(String(result?.outputText ?? ''))
      setNoteCsvDraft(csvText)
      const nextTasks = buildImageNotePreviewTasksFromCsv(csvText)
      if (nextTasks.length === 0) return
      setNotePreviewTasks(nextTasks)
      setNoteSidebarPhase('preview')
      setSmartGenPhase(null)
      setSmartGenError(null)
      addLog(`[AI Studio] 智能生成已返回 CSV，并生成 ${nextTasks.length} 组图文笔记预览。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 图文智能生成失败：${message}`)
      setSmartGenError(message)
      setSmartGenPhase(null)
      flushSync(() => {
        setIsGeneratingNotePreview(false)
      })
    } finally {
      setSmartGenPhase(null)
      setIsGeneratingNotePreview(false)
    }
  }

  const prepareGeneratedVideoPreviewAssets = useCallback(async (videoPaths: string[]) => {
    const normalizedVideoPaths = Array.from(
      new Set(videoPaths.map((item) => String(item ?? '').trim()).filter(Boolean))
    )

    return Promise.all(
      normalizedVideoPaths.map(async (videoPath) => {
        let previewPath = ''
        let coverImagePath = ''

        try {
          const prepared = await window.electronAPI.prepareVideoPreview(videoPath)
          previewPath = String(prepared.previewPath ?? '').trim()
        } catch {
          previewPath = ''
        }

        try {
          coverImagePath = String(
            await window.electronAPI.captureVideoFrame(videoPath, 0.05)
          ).trim()
        } catch {
          coverImagePath = ''
        }

        return {
          videoPath,
          previewPath: previewPath || undefined,
          coverImagePath: coverImagePath || undefined
        }
      })
    )
  }, [])

  const openVideoNotePreviewFromAssets = useCallback(
    (
      csvText: string,
      previewAssets: GeneratedVideoNoteAsset[],
      options?: {
        successLog?: string
        emptyAlert?: string
        onEmpty?: (message: string) => void
      }
    ): boolean => {
      const nextTasks = buildGeneratedVideoNotePreviewTasks(csvText, previewAssets)
      if (nextTasks.length === 0) {
        const message = options?.emptyAlert || '已生成视频，但未能构建视频笔记结果，请检查 CSV 与输出数量。'
        options?.onEmpty?.(message)
        if (!options?.onEmpty) {
          window.alert(message)
        }
        return false
      }

      setNotePreviewTasks(nextTasks)
      setNoteSidebarOpen(true)
      setNoteSidebarMode('video-note')
      setNoteSidebarPhase('preview')
      setNoteCanvasMode(shouldAutoOpenBatchPickForVideoPreview(nextTasks) ? 'batch-pick' : 'result')
      setSelectedBatchPickAssetIds([])
      if (options?.successLog) addLog(options.successLog)
      return true
    },
    [addLog]
  )

  const handleGenerateVideoNotePreview = useCallback(async (): Promise<void> => {
    if (!noteCsvDraft.trim()) {
      window.alert('请先输入 CSV 格式文案。')
      return
    }

    let csvRowCount = 0
    try {
      csvRowCount = countManifestCsvRows(noteCsvDraft)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 视频笔记 CSV 解析失败：${message}`)
      window.alert(message)
      return
    }

    if (hasReusableRenderedVideoAssets) {
      openVideoNotePreviewFromAssets(noteCsvDraft, videoNoteGenerationState.previewAssets, {
        successLog: `[AI Studio] 已复用 ${videoNoteGenerationState.previewAssets.length} 条已生成视频，生成视频笔记预览。`
      })
      return
    }

    const requestedCount = Math.max(
      1,
      Math.min(20, Math.floor(Number(videoComposer.batchCount) || 1))
    )
    if (csvRowCount < requestedCount) {
      window.alert(
        `CSV 行数(${csvRowCount})少于本次生成数量(${requestedCount})，请补全文案或降低生成数量。`
      )
      return
    }

    if (videoComposer.sourceMediaCount === 0) {
      window.alert('请先导入至少一项图片或视频素材。')
      return
    }

    setIsGeneratingNotePreview(true)
    try {
      setVideoNoteGenerationState(createInitialVideoNoteGenerationState())
      const result = await videoComposer.startGenerate()
      if (!result || result.outputs.length === 0) {
        const message =
          result && result.failedCount > 0
            ? '本轮视频生成失败，请检查参数或素材后重试。'
            : '本轮视频生成未产出可用结果。'
        setVideoNoteGenerationState((current) =>
          applyVideoNoteGenerationUpdate(current, {
            type: 'render-error',
            message
          })
        )
        if (result && result.failedCount > 0) {
          window.alert(message)
        }
        return
      }

      const previewAssets = await prepareGeneratedVideoPreviewAssets(result.outputs)
      if (previewAssets.length === 0) {
        const message = '已生成视频，但未能准备可预览的视频素材，请检查输出目录后重试。'
        setVideoNoteGenerationState((current) =>
          applyVideoNoteGenerationUpdate(current, {
            type: 'render-error',
            message
          })
        )
        window.alert(message)
        return
      }

      setVideoNoteGenerationState((current) =>
        applyVideoNoteGenerationUpdate(current, {
          type: 'render-success',
          assets: previewAssets
        })
      )
      openVideoNotePreviewFromAssets(noteCsvDraft, previewAssets, {
        successLog: `[AI Studio] 已生成 ${previewAssets.length} 组视频笔记预览。`
      })
      if (result.failedCount > 0) {
        addLog(
          `[AI Studio] 视频笔记生成存在失败项：${result.failedCount} 条，已保留成功结果进入预览。`
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 视频笔记预览生成失败：${message}`)
      flushSync(() => {
        setIsGeneratingNotePreview(false)
      })
      window.alert(message)
    } finally {
      setIsGeneratingNotePreview(false)
    }
  }, [
    addLog,
    noteCsvDraft,
    openVideoNotePreviewFromAssets,
    prepareGeneratedVideoPreviewAssets,
    videoComposer,
    videoNoteGenerationState.previewAssets,
    hasReusableRenderedVideoAssets
  ])

  const handleGenerateSmartVideoNotePreview = useCallback(async (): Promise<void> => {
    setSmartGenError(null)
    const isCopyOnlyRetry =
      videoNoteGenerationState.canRetryCopyOnly && videoNoteGenerationState.previewAssets.length > 0
    let chatInput: ReturnType<typeof buildVideoSmartNoteChatInput>
    try {
      chatInput = buildVideoSmartNoteChatInput({
        userExtraPrompt: videoNoteSmartPromptDraft,
        groupCount: isCopyOnlyRetry
          ? videoNoteGenerationState.previewAssets.length
          : Math.max(1, Math.min(20, Math.floor(Number(videoComposer.batchCount) || 1)))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSmartGenError(message)
      return
    }

    if (!isCopyOnlyRetry && videoComposer.sourceMediaCount === 0) {
      window.alert('请先导入至少一项图片或视频素材。')
      return
    }

    if (
      !isCopyOnlyRetry &&
      videoComposer.sourceVideos.length === 0 &&
      videoComposer.sourceImages.length < videoComposer.normalizedMin
    ) {
      window.alert(
        `当前仅 ${videoComposer.sourceImages.length} 张图，至少需要 ${videoComposer.normalizedMin} 张。`
      )
      return
    }

    setIsGeneratingNotePreview(true)
    if (!isCopyOnlyRetry) {
      setVideoNoteGenerationState((current) =>
        applyVideoNoteGenerationUpdate(current, {
          type: 'start'
        })
      )
    }

    try {
      addLog(
        isCopyOnlyRetry
          ? '[AI Studio] 已启动视频笔记文案重试，将复用已生成视频。'
          : '[AI Studio] 已发送视频笔记智能生成请求，并并行启动视频生成。'
      )
      const { copyResult, renderResult } = await runVideoSmartGenerationFlow({
        chatInput,
        chatCandidates: state.getVideoSmartChatCandidates(),
        existingPreviewAssets: isCopyOnlyRetry ? videoNoteGenerationState.previewAssets : [],
        startChatRun: state.startChatRun,
        startVideoRender: () => videoComposer.startGenerate(),
        prepareGeneratedVideoPreviewAssets,
        extractCsvFromResponse: extractCsvFromSmartNoteResponse,
        applyGenerationUpdate: (update) =>
          setVideoNoteGenerationState((current) => applyVideoNoteGenerationUpdate(current, update)),
        addLog
      })

      if (copyResult.ok) {
        setNoteCsvDraft(copyResult.csvText)
      }

      if (copyResult.ok && renderResult.ok) {
        openVideoNotePreviewFromAssets(copyResult.csvText, renderResult.assets, {
          successLog: isCopyOnlyRetry
            ? `[AI Studio] 视频笔记文案重试完成，并复用 ${renderResult.assets.length} 组视频预览。`
            : `[AI Studio] 视频笔记智能生成完成，并生成 ${renderResult.assets.length} 组预览。`,
          onEmpty: (message) => {
            setSmartGenError(message)
          }
        })
        return
      }

      const messages = [
        copyResult.ok ? '' : copyResult.message,
        renderResult.ok ? '' : renderResult.message
      ].filter(Boolean)
      if (messages.length > 0) {
        setSmartGenError(messages.join('\n'))
      }
    } finally {
      setIsGeneratingNotePreview(false)
    }
  }, [
    addLog,
    openVideoNotePreviewFromAssets,
    prepareGeneratedVideoPreviewAssets,
    state,
    videoComposer,
    videoNoteGenerationState.canRetryCopyOnly,
    videoNoteGenerationState.previewAssets,
    videoNoteSmartPromptDraft
  ])

  const handleDispatchNotePreview = async (selectedTaskIds: string[]): Promise<void> => {
    const tasksToDispatch = resolveNotePreviewTasksForDispatch(notePreviewTasks, selectedTaskIds)

    if (tasksToDispatch.length === 0) {
      window.alert('当前没有可分发的笔记。')
      return
    }
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
      clearNoteDispatchHideTimeout()
      setNoteDispatchProgress({
        phase: 'start',
        processed: 0,
        total: tasksToDispatch.length,
        created: 0,
        message: `开始派发（0/${tasksToDispatch.length}）`
      })
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
        setNoteDispatchProgress({
          phase:
            payload.phase === 'done' ? 'done' : payload.phase === 'start' ? 'start' : 'progress',
          processed,
          total,
          created,
          message
        })
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

      const createdPreviewShadows = created.map((task) => ({
        id: String(task.id ?? '').trim(),
        accountId: String(task.accountId ?? '').trim() || undefined,
        title: String(task.title ?? '').trim(),
        body: String(task.content ?? '').trim(),
        assignedImages: Array.isArray(task.images)
          ? task.images.map((imagePath) => String(imagePath ?? '').trim()).filter(Boolean)
          : [],
        mediaType: task.mediaType,
        productId: String(task.productId ?? '').trim() || undefined,
        videoPath: String(task.videoPath ?? '').trim() || undefined,
        log: '',
        status: 'success' as const
      }))
      const dispatchedPreviewTaskIds = matchCreatedTasksToNotePreviewTaskIds(
        tasksToDispatch,
        createdPreviewShadows
      )
      const resolvedDispatchedPreviewTaskIds =
        dispatchedPreviewTaskIds.length === 0 && created.length === tasksToDispatch.length
          ? tasksToDispatch.map((task) => task.id)
          : dispatchedPreviewTaskIds
      const nextPreviewTasks = markNotePreviewTasksDispatched(
        notePreviewTasks,
        resolvedDispatchedPreviewTaskIds
      )
      const remainingUndispatchedCount = countUndispatchedNotePreviewTasks(nextPreviewTasks)

      const firstAccountId = String(
        created[0]?.accountId ?? tasksToDispatch[0]?.accountId ?? ''
      ).trim()
      if (firstAccountId) {
        setPreferredAccountId(firstAccountId)
      }
      setNotePreviewTasks(nextPreviewTasks)
      setNoteDispatchProgress({
        phase: 'done',
        processed: tasksToDispatch.length,
        total: tasksToDispatch.length,
        created: created.length,
        message: `已分发 ${created.length}/${tasksToDispatch.length}`
      })

      await new Promise<void>((resolve) => {
        noteDispatchHideTimeoutRef.current = window.setTimeout(() => {
          noteDispatchHideTimeoutRef.current = null
          resolve()
        }, 900)
      })
      setNoteDispatchProgress(null)

      if (remainingUndispatchedCount > 0) {
        addLog(
          `[AI Studio] 已派发 ${created.length}/${tasksToDispatch.length} 条预览任务，剩余 ${remainingUndispatchedCount} 条待分发。`
        )
        return
      }

      setSelectedPublishTaskIds(created.map((task) => String(task.id ?? '').trim()).filter(Boolean))
      setActiveModule('autopublish')
      resetNoteSidebarState()
      addLog(`[AI Studio] 已将 ${created.length} 组笔记全部派发到媒体矩阵队列。`)
    } catch (error) {
      clearNoteDispatchHideTimeout()
      setNoteDispatchProgress(null)
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 笔记派发失败：${message}`)
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
      smartPromptDraft={noteSmartPromptDraft}
      videoSmartPromptDraft={videoNoteSmartPromptDraft}
      groupCountDraft={noteGroupCountDraft}
      minImagesDraft={noteMinImagesDraft}
      maxImagesDraft={noteMaxImagesDraft}
      maxReuseDraft={noteMaxReuseDraft}
      videoEntryMode={videoNoteEntryMode}
      videoGenerationState={videoNoteGenerationState}
      smartGenerationPhase={smartGenPhase}
      smartGenerationError={smartGenError}
      isVideoGenerateDisabled={isVideoGenerateDisabled}
      isGenerating={isGeneratingNotePreview}
      dispatchProgress={noteDispatchProgress}
      previewTasks={notePreviewTasks}
      videoComposer={videoComposer}
      pooledMediaPaths={pooledVideoNoteMediaPaths}
      onOpenChange={setNoteSidebarOpen}
      onModeChange={(mode) => {
        setNoteSidebarMode(mode)
        setNoteSidebarPhase('editing')
        setNoteCanvasMode('result')
        setSelectedBatchPickAssetIds([])
      }}
      onCsvChange={setNoteCsvDraft}
      onSmartPromptChange={setNoteSmartPromptDraft}
      onVideoSmartPromptChange={setVideoNoteSmartPromptDraft}
      onVideoEntryModeChange={setVideoNoteEntryMode}
      onGroupCountChange={setNoteGroupCountDraft}
      onMinImagesChange={setNoteMinImagesDraft}
      onMaxImagesChange={setNoteMaxImagesDraft}
      onMaxReuseChange={setNoteMaxReuseDraft}
      onGenerate={(payload) => {
        const imageNoteEntryMode: ImageNoteEntryMode =
          payload?.imageNoteEntryMode === 'manual' ? 'manual' : 'smart'
        const nextVideoEntryMode: VideoNoteEntryMode =
          payload?.videoNoteEntryMode === 'smart' ? 'smart' : 'manual'
        void (noteSidebarMode === 'video-note'
          ? nextVideoEntryMode === 'smart'
            ? handleGenerateSmartVideoNotePreview()
            : handleGenerateVideoNotePreview()
          : imageNoteEntryMode === 'manual'
            ? handleGenerateNotePreview()
            : handleGenerateSmartNotePreview())
      }}
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
      onConsumeBatchPickSelection={() => {
        setSelectedBatchPickAssetIds([])
      }}
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

  const handleDeleteProject = useCallback(
    async (taskId: string, title: string): Promise<void> => {
      const normalizedTaskId = String(taskId ?? '').trim()
      const normalizedTitle = String(title ?? '').trim() || '未命名项目'
      if (!normalizedTaskId) return

      const confirmMessage = `确认删除项目「${normalizedTitle}」吗？`
      let confirmed = false
      try {
        const result = await window.electronAPI.showMessageBox({
          type: 'warning',
          title: '确认删除项目',
          message: confirmMessage,
          detail: '项目目录、素材和已生成结果都会移到系统回收站，项目记录也会一并移除。',
          buttons: ['删除', '取消'],
          defaultId: 1,
          cancelId: 1
        })
        confirmed = result.response === 0
      } catch {
        confirmed = window.confirm(confirmMessage)
      }

      if (!confirmed) return

      try {
        const result = await window.api.cms.aiStudio.task.deleteProject({
          taskId: normalizedTaskId
        })
        const deletedTaskIds =
          Array.isArray(result.deletedTaskIds) && result.deletedTaskIds.length > 0
            ? result.deletedTaskIds
            : [normalizedTaskId]

        if (state.currentProjectId && deletedTaskIds.includes(state.currentProjectId)) {
          handleReturnToLanding()
        }

        setTrackedProjects((current) => removeTrackedProjects(current, deletedTaskIds))
        await state.refresh()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[AI Studio] 删除项目失败：${message}`)
        window.alert(message)
      }
    },
    [addLog, handleReturnToLanding, state]
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
        onDeleteProject={(taskId, title) => {
          void handleDeleteProject(taskId, title)
        }}
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
                <Sparkles className="h-4 w-4" />
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
