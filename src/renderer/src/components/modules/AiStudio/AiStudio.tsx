import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { ImageIcon, Video } from 'lucide-react'

import { Card } from '@renderer/components/ui/card'
import { generateManifest } from '@renderer/lib/cms-engine'
import { cn } from '@renderer/lib/utils'
import { useCmsStore, type Task } from '@renderer/store/useCmsStore'

import { ControlPanel } from './ControlPanel'
import { NoteSidebar, type NoteSidebarMode, type NoteSidebarPhase } from './NoteSidebar'
import { ResultPanel } from './ResultPanel'
import { TaskQueue } from './TaskQueue'
import {
  normalizeNoteSidebarConstraints
} from './noteSidebarHelpers'
import { useAiStudioState } from './useAiStudioState'

const AI_STUDIO_CANVAS_SURFACE_CLASS =
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,244,245,0.96))]'

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

function AiStudioCanvas({
  state,
  initialPromptDraft,
  noteSidebar,
  isSidebarOpen
}: {
  state: ReturnType<typeof useAiStudioState>
  initialPromptDraft: string
  noteSidebar: React.JSX.Element
  isSidebarOpen: boolean
}): React.JSX.Element {
  const [promptDraft, setPromptDraft] = useState(initialPromptDraft)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [composerOverlayPadding, setComposerOverlayPadding] = useState(isSidebarOpen ? 72 : 420)

  useLayoutEffect(() => {
    if (isSidebarOpen) {
      setComposerOverlayPadding(72)
      return
    }

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
        AI_STUDIO_CANVAS_SURFACE_CLASS
      )}
    >
      {noteSidebar}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <ResultPanel state={state} bottomSpacerHeight={composerOverlayPadding} />
      </div>

      {!isSidebarOpen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-5 pt-2">
          <div ref={overlayRef} className="pointer-events-auto mx-auto flex w-full max-w-[920px] flex-col gap-3">
            <div
              className={cn(
                'inline-flex items-center self-start rounded-[18px] border border-black/8 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.04)]',
                AI_STUDIO_CANVAS_SURFACE_CLASS
              )}
            >
              <button
                type="button"
                onClick={() => state.setStudioCapability('image')}
                className={cn(
                  'inline-flex h-8 items-center gap-2 rounded-[14px] border px-3 text-[13px] font-medium transition',
                  state.studioCapability === 'image'
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900'
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
                    ? 'border-zinc-950 bg-zinc-950 text-white'
                    : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900'
                )}
              >
                <Video className="h-4 w-4" />
                视频
              </button>
            </div>

            <div
              className={cn(
                'rounded-[28px] border border-black/8 px-3.5 pt-2.5 pb-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)]',
                AI_STUDIO_CANVAS_SURFACE_CLASS
              )}
            >
              <TaskQueue state={state} promptDraft={promptDraft} onPromptChange={setPromptDraft} />
              <div className="relative z-30 mt-2.5 pt-2.5 before:absolute before:left-4 before:right-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-black/8 before:to-transparent">
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
  const addLog = useCmsStore((store) => store.addLog)
  const setActiveModule = useCmsStore((store) => store.setActiveModule)
  const setPreferredAccountId = useCmsStore((store) => store.setPreferredAccountId)
  const setSelectedPublishTaskIds = useCmsStore((store) => store.setSelectedPublishTaskIds)
  const [noteSidebarOpen, setNoteSidebarOpen] = useState(false)
  const [noteSidebarMode, setNoteSidebarMode] = useState<NoteSidebarMode>(NOTE_SIDEBAR_DEFAULTS.mode)
  const [noteSidebarPhase, setNoteSidebarPhase] = useState<NoteSidebarPhase>(NOTE_SIDEBAR_DEFAULTS.phase)
  const [noteCsvDraft, setNoteCsvDraft] = useState(NOTE_SIDEBAR_DEFAULTS.csvDraft)
  const [noteGroupCountDraft, setNoteGroupCountDraft] = useState(NOTE_SIDEBAR_DEFAULTS.groupCountDraft)
  const [noteMinImagesDraft, setNoteMinImagesDraft] = useState(NOTE_SIDEBAR_DEFAULTS.minImagesDraft)
  const [noteMaxImagesDraft, setNoteMaxImagesDraft] = useState(NOTE_SIDEBAR_DEFAULTS.maxImagesDraft)
  const [noteMaxReuseDraft, setNoteMaxReuseDraft] = useState(NOTE_SIDEBAR_DEFAULTS.maxReuseDraft)
  const [notePreviewTasks, setNotePreviewTasks] = useState<Task[]>([])
  const [isGeneratingNotePreview, setIsGeneratingNotePreview] = useState(false)
  const [noteUploadedMaterialPaths, setNoteUploadedMaterialPaths] = useState<string[]>([])

  const resetNoteSidebarState = (): void => {
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
  }

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

  const handleGenerateNotePreview = async (): Promise<void> => {
    const materialPaths = Array.from(
      new Set(
        noteMaterials
          .map((asset) => String(asset.filePath ?? '').trim())
          .filter(Boolean)
      )
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
      const nextTasks = generateManifest(
        noteCsvDraft,
        materialPaths,
        {
          ...normalizeNoteSidebarConstraints({
            groupCount: noteGroupCountDraft,
            minImages: noteMinImagesDraft,
            maxImages: noteMaxImagesDraft,
            maxReuse: noteMaxReuseDraft
          }),
          bestEffort: true
        }
      )
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

      const firstAccountId = String(created[0]?.accountId ?? tasksToDispatch[0]?.accountId ?? '').trim()
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
    />
  )

  return (
    <AiStudioCanvas
      key={`${state.studioCapability}:${state.activeTask?.id ?? 'empty'}`}
      state={state}
      initialPromptDraft={readPromptSeed(state)}
      noteSidebar={noteSidebarNode}
      isSidebarOpen={noteSidebarOpen}
    />
  )
}

export { AiStudio }
