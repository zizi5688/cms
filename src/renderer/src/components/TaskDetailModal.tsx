import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import moment from 'moment'
import {
  ArrowLeft,
  Check,
  FolderOpen,
  ImagePlus,
  Layers,
  LoaderCircle,
  Save,
  Sparkles,
  Trash2,
  Video,
  X
} from 'lucide-react'

import { buildSelectedWorkshopProducts } from '@renderer/components/modules/workshopProductSelectionHelpers'
import { CmsProductMultiSelectPanel } from '@renderer/components/ui/CmsProductMultiSelectPanel'
import {
  formatTaskProductSummary,
  mergeTaskSelectableProducts,
  resolveTaskSelectedProductIds
} from '@renderer/lib/cmsTaskProductHelpers'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import {
  PENDING_POOL_TITLE_LIMIT,
  countUserVisibleChars
} from '@renderer/modules/MediaMatrix/titleLengthGuard'
import { useCmsStore } from '@renderer/store/useCmsStore'
import { SortableImage } from '@renderer/components/ui/SortableImage'
import {
  applyTaskDetailVideoCover,
  buildTaskDetailProjectCards,
  listTaskDetailProjectSelectableAssets,
  type TaskDetailProjectCard,
  type TaskDetailTrackedProjectLike
} from './taskDetailVideoCoverHelpers'

const AI_STUDIO_TRACKED_PROJECTS_STORAGE_KEY = 'cms.aiStudio.trackedProjects.v1'

type TaskDetailModalProps = {
  isOpen: boolean
  onClose: () => void
  task: CmsPublishTask | null
  workspacePath?: string
  onTaskUpdated?: (task: CmsPublishTask) => void
}

function isHttpUrl(value: string): boolean {
  return /^https?:[/]{2}/i.test(String(value ?? '').trim())
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? '').trim())
}

function isAbsolutePathLike(value: string): boolean {
  const normalized = String(value ?? '').trim()
  if (!normalized) return false
  if (normalized.startsWith('/')) return true
  if (isWindowsAbsolutePath(normalized)) return true
  return false
}

function toAbsoluteFilePath(rawPath: string, workspacePath?: string): string {
  const normalizedRaw = String(rawPath ?? '').trim()
  if (!normalizedRaw) return ''
  if (isHttpUrl(normalizedRaw)) return ''
  if (isAbsolutePathLike(normalizedRaw)) return normalizedRaw
  const ws = String(workspacePath ?? '').trim()
  if (!ws) return ''
  const normalizedRel = normalizedRaw.replace(/\\/g, '/').replace(/^[/]+/, '')
  return `${ws.replace(/[\\/]+$/, '')}/${normalizedRel}`
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function formatStatus(status: CmsPublishTaskStatus): { label: string; className: string } {
  if (status === 'published')
    return {
      label: '已发布',
      className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    }
  if (status === 'processing')
    return { label: '处理中', className: 'border-sky-500/20 bg-sky-500/10 text-sky-300' }
  if (status === 'scheduled')
    return { label: '已排期', className: 'border-purple-500/20 bg-purple-500/10 text-purple-300' }
  if (status === 'publish_failed' || status === 'failed')
    return { label: '失败', className: 'border-red-500/20 bg-red-500/10 text-red-300' }
  return { label: '待处理', className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200' }
}

type AiStudioProjectTaskSnapshot = {
  id: string
  productName: string
  status: string
  sourceFolderPath: string | null
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type AiStudioProjectAssetSnapshot = {
  id: string
  taskId: string
  kind: string
  role: string
  filePath: string
  previewPath: string | null
  originPath: string | null
  createdAt: number
  updatedAt: number
  sortOrder: number
}

type VideoCoverProjectPickerModalProps = {
  open: boolean
  stage: 'projects' | 'assets'
  workspacePath: string
  isLoading: boolean
  errorMessage: string
  projectCards: TaskDetailProjectCard[]
  selectedProject: TaskDetailProjectCard | null
  selectedAssetId: string
  selectedProjectAssets: AiStudioProjectAssetSnapshot[]
  isApplying: boolean
  onClose: () => void
  onOpenProject: (projectRootTaskId: string) => void
  onBackToProjects: () => void
  onSelectAsset: (assetId: string) => void
  onConfirm: () => void
}

function normalizeRecordText(value: unknown): string {
  return String(value ?? '').trim()
}

function basename(filePath: string): string {
  const normalized = normalizeRecordText(filePath)
  if (!normalized) return '未命名'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function coerceAiStudioProjectTask(record: unknown): AiStudioProjectTaskSnapshot | null {
  if (!record || typeof record !== 'object') return null
  const source = record as Record<string, unknown>
  const id = normalizeRecordText(source.id)
  if (!id) return null
  return {
    id,
    productName: normalizeRecordText(source.productName),
    status: normalizeRecordText(source.status),
    sourceFolderPath: normalizeRecordText(source.sourceFolderPath) || null,
    metadata:
      source.metadata && typeof source.metadata === 'object'
        ? { ...(source.metadata as Record<string, unknown>) }
        : {},
    createdAt: Number(source.createdAt) || 0,
    updatedAt: Number(source.updatedAt) || 0
  }
}

function coerceAiStudioProjectAsset(record: unknown): AiStudioProjectAssetSnapshot | null {
  if (!record || typeof record !== 'object') return null
  const source = record as Record<string, unknown>
  const id = normalizeRecordText(source.id)
  const taskId = normalizeRecordText(source.taskId)
  const filePath = normalizeRecordText(source.filePath)
  if (!id || !taskId || !filePath) return null
  return {
    id,
    taskId,
    kind: normalizeRecordText(source.kind),
    role: normalizeRecordText(source.role),
    filePath,
    previewPath: normalizeRecordText(source.previewPath) || null,
    originPath: normalizeRecordText(source.originPath) || null,
    createdAt: Number(source.createdAt) || 0,
    updatedAt: Number(source.updatedAt) || 0,
    sortOrder: Number(source.sortOrder) || 0
  }
}

function ProjectCoverPreviewTile({
  path,
  title,
  workspacePath
}: {
  path: string | null
  title: string
  workspacePath: string
}): React.JSX.Element {
  const src = path ? resolveLocalImage(path, workspacePath) : ''
  if (!src) {
    return <div className="rounded-xl border border-zinc-800 bg-zinc-900/70" />
  }
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70">
      <img src={src} alt={title} className="h-full w-full object-cover" draggable={false} />
    </div>
  )
}

function VideoCoverProjectPickerModal({
  open,
  stage,
  workspacePath,
  isLoading,
  errorMessage,
  projectCards,
  selectedProject,
  selectedAssetId,
  selectedProjectAssets,
  isApplying,
  onClose,
  onOpenProject,
  onBackToProjects,
  onSelectAsset,
  onConfirm
}: VideoCoverProjectPickerModalProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape, true)
    return () => document.removeEventListener('keydown', handleEscape, true)
  }, [onClose, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="关闭图池选图面板"
        onClick={onClose}
      />
      <div className="relative z-10 flex h-[min(82vh,840px)] w-[min(1120px,96vw)] flex-col overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950 shadow-[0_30px_120px_rgba(0,0,0,0.48)]">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              项目图池
            </div>
            <div className="mt-2 text-[26px] font-semibold tracking-[-0.04em] text-zinc-100">
              {stage === 'projects' ? '选择项目' : selectedProject?.title || '选择封面'}
            </div>
            <div className="mt-1 text-sm text-zinc-500">
              {stage === 'projects'
                ? '先选项目，再从该项目图池里挑一张图作为当前视频封面。'
                : '单选 1 张图，确认后会回填到当前任务，并切换为手动封面模式。'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stage === 'assets' ? (
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/80 px-4 text-sm text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-900"
                onClick={onBackToProjects}
              >
                <ArrowLeft className="h-4 w-4" />
                返回项目
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100"
              onClick={onClose}
              aria-label="关闭图池选图面板"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {isLoading ? (
            <div className="flex h-full min-h-[260px] items-center justify-center text-zinc-400">
              <LoaderCircle className="mr-3 h-5 w-5 animate-spin" />
              正在读取项目图池...
            </div>
          ) : errorMessage ? (
            <div className="flex h-full min-h-[260px] items-center justify-center">
              <div className="max-w-md rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
                读取项目图池失败：{errorMessage}
              </div>
            </div>
          ) : stage === 'projects' ? (
            projectCards.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {projectCards.map((card) => (
                  <button
                    key={card.rootTaskId}
                    type="button"
                    className="group overflow-hidden rounded-[22px] border border-zinc-800 bg-zinc-900/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900"
                    onClick={() => onOpenProject(card.rootTaskId)}
                  >
                    <div className="grid aspect-[8/5] grid-cols-2 gap-2">
                      {Array.from({ length: 2 }, (_, index) => (
                        <ProjectCoverPreviewTile
                          key={`${card.rootTaskId}:${index}`}
                          path={card.thumbnailPaths[index] ?? null}
                          title={card.title}
                          workspacePath={workspacePath}
                        />
                      ))}
                    </div>
                    <div className="mt-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-zinc-100">
                          {card.title}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">更新于 {card.updatedLabel}</div>
                      </div>
                      <div className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-950/80 px-2.5 py-1 text-[11px] text-zinc-300">
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>{card.assetCount}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[260px] items-center justify-center">
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/60 px-6 py-8 text-center text-sm text-zinc-500">
                  还没有可用的项目图池。先去 AI Studio
                  或图池流程里沉淀项目图片，再来这里直接换封面。
                </div>
              </div>
            )
          ) : selectedProjectAssets.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {selectedProjectAssets.map((asset) => {
                const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)
                const isSelected = asset.id === selectedAssetId
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onSelectAsset(asset.id)}
                    className={cn(
                      'group overflow-hidden rounded-[22px] border bg-zinc-900/70 text-left transition',
                      isSelected
                        ? 'border-purple-400/70 shadow-[0_0_0_1px_rgba(192,132,252,0.35)]'
                        : 'border-zinc-800 hover:-translate-y-0.5 hover:border-zinc-700'
                    )}
                  >
                    <div className="relative aspect-[4/5] overflow-hidden bg-zinc-900">
                      {src ? (
                        <img
                          src={src}
                          alt={basename(asset.filePath)}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                          预览不可用
                        </div>
                      )}
                      <div
                        className={cn(
                          'absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border transition',
                          isSelected
                            ? 'border-purple-300 bg-purple-400 text-zinc-950'
                            : 'border-white/20 bg-black/35 text-transparent backdrop-blur group-hover:text-white/85'
                        )}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      <div className="truncate text-xs text-zinc-200">
                        {basename(asset.filePath)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center">
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/60 px-6 py-8 text-center text-sm text-zinc-500">
                这个项目里还没有图池图片，换个项目试试，或者先把图片纳入该项目图池。
              </div>
            </div>
          )}
        </div>

        {stage === 'assets' ? (
          <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4">
            <div className="text-sm text-zinc-500">
              {selectedProject
                ? `${selectedProject.title} · 共 ${selectedProjectAssets.length} 张图`
                : '请选择一张图'}
            </div>
            <button
              type="button"
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition',
                selectedAssetId && !isApplying
                  ? 'border border-purple-400/40 bg-purple-500/15 text-purple-100 hover:bg-purple-500/25'
                  : 'cursor-not-allowed border border-zinc-800 bg-zinc-900 text-zinc-600'
              )}
              onClick={onConfirm}
              disabled={!selectedAssetId || isApplying}
            >
              {isApplying ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              用这张图做封面
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

function TaskDetailModal({
  isOpen,
  onClose,
  task,
  workspacePath,
  onTaskUpdated
}: TaskDetailModalProps): React.JSX.Element | null {
  const addLog = useCmsStore((s) => s.addLog)
  const publishMode = useCmsStore((s) => s.config.publishMode)
  const deleteTasks = useCmsStore((s) => s.deleteTasks)
  const [activeIndex, setActiveIndex] = useState(0)
  const [mainLoaded, setMainLoaded] = useState(false)
  const [thumbLoaded, setThumbLoaded] = useState<Set<number>>(() => new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTestingPublish, setIsTestingPublish] = useState(false)
  const [playableVideoSrc, setPlayableVideoSrc] = useState('')
  const [didFallbackToOriginalVideo, setDidFallbackToOriginalVideo] = useState(false)
  const [resolvedWorkspacePath, setResolvedWorkspacePath] = useState('')
  const [isProjectCoverPickerOpen, setIsProjectCoverPickerOpen] = useState(false)
  const [projectCoverPickerStage, setProjectCoverPickerStage] = useState<'projects' | 'assets'>(
    'projects'
  )
  const [projectCoverTasks, setProjectCoverTasks] = useState<AiStudioProjectTaskSnapshot[]>([])
  const [projectCoverAssets, setProjectCoverAssets] = useState<AiStudioProjectAssetSnapshot[]>([])
  const [trackedProjectEntries, setTrackedProjectEntries] = useState<
    TaskDetailTrackedProjectLike[]
  >([])
  const [isLoadingProjectCoverLibrary, setIsLoadingProjectCoverLibrary] = useState(false)
  const [projectCoverLibraryError, setProjectCoverLibraryError] = useState('')
  const [selectedProjectRootTaskId, setSelectedProjectRootTaskId] = useState('')
  const [selectedProjectAssetId, setSelectedProjectAssetId] = useState('')
  const [isApplyingProjectCover, setIsApplyingProjectCover] = useState(false)

  // ----- 编辑状态 -----
  const isEditable = task?.status === 'pending' || task?.status === 'scheduled'
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftImages, setDraftImages] = useState<string[]>([])
  const [draftVideoCoverMode, setDraftVideoCoverMode] = useState<'auto' | 'manual'>('manual')
  const [draftSelectedProductIds, setDraftSelectedProductIds] = useState<string[]>([])
  const [products, setProducts] = useState<CmsProductRecord[]>([])
  const initializedRef = useRef<string | null>(null)

  // 初始化 draft 值
  useEffect(() => {
    if (!isOpen || !task) return
    if (initializedRef.current === task.id) return
    initializedRef.current = task.id
    setDraftTitle(task.title || '')
    setDraftContent(task.content || '')
    setDraftImages(Array.isArray(task.images) ? [...task.images] : [])
    setDraftVideoCoverMode(task.videoCoverMode === 'auto' ? 'auto' : 'manual')
    setDraftSelectedProductIds(
      resolveTaskSelectedProductIds({
        linkedProducts: task.linkedProducts,
        productId: task.productId
      })
    )
  }, [isOpen, task])

  // 重置 initializedRef 当弹窗关闭
  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = null
      setIsProjectCoverPickerOpen(false)
      setProjectCoverPickerStage('projects')
      setSelectedProjectRootTaskId('')
      setSelectedProjectAssetId('')
      setProjectCoverLibraryError('')
      setIsApplyingProjectCover(false)
    }
  }, [isOpen])

  // 加载商品列表
  useEffect(() => {
    if (!isOpen || !task || !isEditable) return
    let canceled = false
    const load = async (): Promise<void> => {
      try {
        const list = await window.api.cms.product.list({ accountId: task.accountId })
        if (!canceled) setProducts(list)
      } catch {
        // 静默
      }
    }
    void load()
    return () => {
      canceled = true
    }
  }, [isOpen, task?.accountId, isEditable, task])

  const originalSelectedProductIds = useMemo(() => {
    return resolveTaskSelectedProductIds({
      linkedProducts: task?.linkedProducts,
      productId: task?.productId
    })
  }, [task?.linkedProducts, task?.productId])

  const selectableProducts = useMemo(() => {
    if (!task) return []
    return mergeTaskSelectableProducts({
      accountId: task.accountId,
      products,
      linkedProducts: task.linkedProducts,
      productId: task.productId,
      productName: task.productName
    })
  }, [products, task])

  const draftSelectedProducts = useMemo(
    () =>
      buildSelectedWorkshopProducts({
        allProducts: selectableProducts,
        selectedProductIds: draftSelectedProductIds
      }),
    [draftSelectedProductIds, selectableProducts]
  )

  const originalSelectedProducts = useMemo(
    () =>
      buildSelectedWorkshopProducts({
        allProducts: selectableProducts,
        selectedProductIds: originalSelectedProductIds
      }),
    [originalSelectedProductIds, selectableProducts]
  )

  const displaySelectedProducts = isEditable ? draftSelectedProducts : originalSelectedProducts
  const displaySelectedProductIds = isEditable
    ? draftSelectedProductIds
    : originalSelectedProductIds
  const displayProductOptions = isEditable ? products : originalSelectedProducts
  const productSummaryText = useMemo(
    () =>
      formatTaskProductSummary({
        linkedProducts: task?.linkedProducts,
        productName: task?.productName
      }),
    [task?.linkedProducts, task?.productName]
  )

  const isDirty = useMemo(() => {
    if (!task || !isEditable) return false
    if (draftTitle !== (task.title || '')) return true
    if (draftContent !== (task.content || '')) return true
    if (
      task.mediaType === 'video' &&
      draftVideoCoverMode !== (task.videoCoverMode === 'auto' ? 'auto' : 'manual')
    ) {
      return true
    }
    if (!areStringArraysEqual(draftSelectedProductIds, originalSelectedProductIds)) return true
    const origImages = Array.isArray(task.images) ? task.images : []
    if (draftImages.length !== origImages.length) return true
    for (let i = 0; i < draftImages.length; i++) {
      if (draftImages[i] !== origImages[i]) return true
    }
    return false
  }, [
    task,
    isEditable,
    draftTitle,
    draftContent,
    draftImages,
    draftSelectedProductIds,
    draftVideoCoverMode,
    originalSelectedProductIds
  ])

  const draftTitleCount = useMemo(() => countUserVisibleChars(draftTitle), [draftTitle])
  const hasTitleOverflow = useMemo(() => {
    if (!isEditable) return false
    return draftTitleCount > PENDING_POOL_TITLE_LIMIT
  }, [draftTitleCount, isEditable])
  const hasSaveTitleOverflow = hasTitleOverflow

  // DnD 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 使用 draftImages (可编辑) 或 task.images (只读)
  const effectiveWorkspacePath = useMemo(() => {
    const fromProp = String(workspacePath ?? '').trim()
    if (fromProp) return fromProp
    return String(resolvedWorkspacePath ?? '').trim()
  }, [workspacePath, resolvedWorkspacePath])
  const displayImages = isEditable ? draftImages : Array.isArray(task?.images) ? task!.images : []
  const resolvedImages = useMemo(
    () => displayImages.map((p) => resolveLocalImage(p, effectiveWorkspacePath)),
    [displayImages, effectiveWorkspacePath]
  )
  const safeActiveIndex = Math.min(Math.max(0, activeIndex), Math.max(0, resolvedImages.length - 1))
  const activeSrc = resolvedImages[safeActiveIndex] ?? ''
  const isVideo = task?.mediaType === 'video'
  const videoCoverSrc = resolvedImages[0] ?? ''
  const activePosterSrc = videoCoverSrc || resolvedImages[safeActiveIndex] || ''
  const rawVideoPath = useMemo(() => {
    return task?.videoPath ? String(task.videoPath).trim() : ''
  }, [task?.videoPath])
  const absoluteVideoPath = useMemo(() => {
    return toAbsoluteFilePath(rawVideoPath, effectiveWorkspacePath)
  }, [rawVideoPath, effectiveWorkspacePath])
  const resolvedOriginalVideoSrc = useMemo(() => {
    return rawVideoPath ? resolveLocalImage(rawVideoPath, effectiveWorkspacePath) : ''
  }, [rawVideoPath, effectiveWorkspacePath])
  const projectCoverCards = useMemo(
    () =>
      buildTaskDetailProjectCards({
        tasks: projectCoverTasks,
        assets: projectCoverAssets,
        trackedProjects: trackedProjectEntries
      }),
    [projectCoverAssets, projectCoverTasks, trackedProjectEntries]
  )
  const selectedProjectCard = useMemo(
    () => projectCoverCards.find((card) => card.rootTaskId === selectedProjectRootTaskId) ?? null,
    [projectCoverCards, selectedProjectRootTaskId]
  )
  const selectedProjectAssets = useMemo(() => {
    if (!selectedProjectCard) return []
    return listTaskDetailProjectSelectableAssets({
      projectId: selectedProjectCard.projectId,
      rootTaskId: selectedProjectCard.rootTaskId,
      tasks: projectCoverTasks,
      assets: projectCoverAssets
    }) as AiStudioProjectAssetSnapshot[]
  }, [projectCoverAssets, projectCoverTasks, selectedProjectCard])
  const selectedProjectAsset = useMemo(
    () => selectedProjectAssets.find((asset) => asset.id === selectedProjectAssetId) ?? null,
    [selectedProjectAssetId, selectedProjectAssets]
  )
  const videoCoverModeText = draftVideoCoverMode === 'manual' ? '手动封面' : '默认首帧'

  useEffect(() => {
    if (!isOpen) return
    setActiveIndex(0)
    setMainLoaded(false)
    setThumbLoaded(new Set())
  }, [isOpen, task?.id])

  useEffect(() => {
    if (!isOpen) return
    if (effectiveWorkspacePath) return
    let canceled = false
    void (async () => {
      try {
        const workspace = await window.electronAPI.getWorkspacePath()
        if (canceled) return
        const next = workspace && typeof workspace.path === 'string' ? workspace.path.trim() : ''
        if (next) setResolvedWorkspacePath(next)
      } catch {
        void 0
      }
    })()
    return () => {
      canceled = true
    }
  }, [isOpen, effectiveWorkspacePath])

  useEffect(() => {
    if (!isOpen || !task || !isVideo) {
      setPlayableVideoSrc('')
      setDidFallbackToOriginalVideo(false)
      return
    }

    const rawPreviewPath = task.videoPreviewPath ? String(task.videoPreviewPath).trim() : ''
    const rawOriginalPath = task.videoPath ? String(task.videoPath).trim() : ''
    const initialRaw = rawPreviewPath || rawOriginalPath
    setPlayableVideoSrc(initialRaw ? resolveLocalImage(initialRaw, effectiveWorkspacePath) : '')
    setDidFallbackToOriginalVideo(false)
    setMainLoaded(false)

    if (!absoluteVideoPath) return

    let canceled = false
    void (async () => {
      try {
        const prepared = await window.electronAPI.prepareVideoPreview(absoluteVideoPath)
        if (canceled) return
        const nextRaw =
          typeof prepared?.previewPath === 'string' && prepared.previewPath.trim()
            ? prepared.previewPath.trim()
            : absoluteVideoPath
        const nextResolved = resolveLocalImage(nextRaw, effectiveWorkspacePath)
        setPlayableVideoSrc(nextResolved)
      } catch (error) {
        if (canceled) return
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[媒体矩阵] 视频预览准备失败，回退原视频：${message}`)
        setPlayableVideoSrc(resolveLocalImage(absoluteVideoPath, effectiveWorkspacePath))
      }
    })()

    return () => {
      canceled = true
    }
  }, [
    isOpen,
    task?.id,
    task?.videoPath,
    task?.videoPreviewPath,
    isVideo,
    absoluteVideoPath,
    effectiveWorkspacePath,
    addLog
  ])

  useEffect(() => {
    setSelectedProjectAssetId('')
  }, [selectedProjectRootTaskId])

  useEffect(() => {
    if (!selectedProjectAssetId) return
    if (selectedProjectAssets.some((asset) => asset.id === selectedProjectAssetId)) return
    setSelectedProjectAssetId('')
  }, [selectedProjectAssetId, selectedProjectAssets])

  const handleVideoPreviewError = useCallback((): void => {
    if (!resolvedOriginalVideoSrc) {
      addLog('[媒体矩阵] 视频预览加载失败：缺少有效视频路径。')
      return
    }
    if (didFallbackToOriginalVideo || playableVideoSrc === resolvedOriginalVideoSrc) {
      addLog(`[媒体矩阵] 视频预览加载失败：已尝试回退原视频仍不可播放。src=${playableVideoSrc}`)
      return
    }
    setDidFallbackToOriginalVideo(true)
    setPlayableVideoSrc(resolvedOriginalVideoSrc)
    setMainLoaded(false)
    addLog(`[媒体矩阵] 视频预览加载失败，已自动回退原视频路径。src=${playableVideoSrc}`)
  }, [addLog, didFallbackToOriginalVideo, playableVideoSrc, resolvedOriginalVideoSrc])

  // 关闭守卫
  const guardedClose = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm('有未保存的修改，确定放弃？')
      if (!confirmed) return
    }
    onClose()
  }, [isDirty, onClose])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (isProjectCoverPickerOpen) {
          setIsProjectCoverPickerOpen(false)
          setProjectCoverPickerStage('projects')
          return
        }
        guardedClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isOpen, guardedClose, isProjectCoverPickerOpen])

  // ----- 编辑操作 -----
  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return
    const oldIndex = draftImages.indexOf(activeId)
    const newIndex = draftImages.indexOf(overId)
    if (oldIndex === -1 || newIndex === -1) return
    setDraftImages(arrayMove(draftImages, oldIndex, newIndex))
  }

  const handleRemoveImage = (removeIndex: number): void => {
    setDraftImages((prev) => prev.filter((_, idx) => idx !== removeIndex))
  }

  const handleAddImages = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openMediaFiles({
        multiSelections: true,
        accept: 'image'
      })
      if (!result) return
      const items = Array.isArray(result) ? result : [result]
      const filePaths = items
        .filter((item) => item.mediaType === 'image')
        .map((item) => item.originalPath)
        .filter(Boolean)
      if (filePaths.length === 0) return
      const relativePaths = await window.api.cms.task.importImages(filePaths)
      if (relativePaths.length > 0) {
        setDraftImages((prev) => [...prev, ...relativePaths])
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`添加图片失败：${msg}`)
    }
  }

  const applyVideoCoverPath = useCallback((nextCoverPath: string): void => {
    setDraftImages((prev) => applyTaskDetailVideoCover(prev, nextCoverPath).draftImages)
    setDraftVideoCoverMode('manual')
    setActiveIndex(0)
    setMainLoaded(false)
    setThumbLoaded(new Set())
  }, [])

  const loadProjectCoverLibrary = useCallback(async (): Promise<void> => {
    setIsLoadingProjectCoverLibrary(true)
    setProjectCoverLibraryError('')
    try {
      const trackedRaw =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(AI_STUDIO_TRACKED_PROJECTS_STORAGE_KEY)
          : null
      const [taskRows, assetRows] = await Promise.all([
        window.api.cms.aiStudio.task.list({ limit: 300 }),
        window.api.cms.aiStudio.asset.list().catch(() => [])
      ])
      setTrackedProjectEntries(
        trackedRaw && trackedRaw.trim()
          ? ((JSON.parse(trackedRaw) as TaskDetailTrackedProjectLike[]) ?? [])
          : []
      )
      setProjectCoverTasks(
        (Array.isArray(taskRows) ? taskRows : [])
          .map(coerceAiStudioProjectTask)
          .filter(Boolean) as AiStudioProjectTaskSnapshot[]
      )
      setProjectCoverAssets(
        (Array.isArray(assetRows) ? assetRows : [])
          .map(coerceAiStudioProjectAsset)
          .filter(Boolean) as AiStudioProjectAssetSnapshot[]
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProjectCoverLibraryError(message)
    } finally {
      setIsLoadingProjectCoverLibrary(false)
    }
  }, [])

  const openProjectCoverPicker = useCallback((): void => {
    setIsProjectCoverPickerOpen(true)
    setProjectCoverPickerStage('projects')
    setSelectedProjectRootTaskId('')
    setSelectedProjectAssetId('')
    void loadProjectCoverLibrary()
  }, [loadProjectCoverLibrary])

  const handleUploadVideoCover = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openMediaFiles({ accept: 'image' })
      if (!result) return
      const items = Array.isArray(result) ? result : [result]
      const picked = items.find((item) => item && item.mediaType === 'image') || null
      const filePath = picked?.originalPath ? String(picked.originalPath).trim() : ''
      if (!filePath) return

      const relativePaths = await window.api.cms.task.importImages([filePath])
      const nextCover = relativePaths[0] ? String(relativePaths[0]).trim() : ''
      if (!nextCover) throw new Error('导入封面失败')

      applyVideoCoverPath(nextCover)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`本地上传封面失败：${msg}`)
    }
  }

  const handleApplyProjectCover = useCallback(async (): Promise<void> => {
    if (!selectedProjectAsset) return
    setIsApplyingProjectCover(true)
    try {
      const sourcePath = toAbsoluteFilePath(
        selectedProjectAsset.originPath || selectedProjectAsset.filePath,
        effectiveWorkspacePath
      )
      const importPath =
        sourcePath || selectedProjectAsset.originPath || selectedProjectAsset.filePath
      if (!importPath) throw new Error('图池图片路径无效')
      const relativePaths = await window.api.cms.task.importImages([importPath])
      const nextCover = relativePaths[0] ? String(relativePaths[0]).trim() : ''
      if (!nextCover) throw new Error('导入图池图片失败')

      applyVideoCoverPath(nextCover)
      setIsProjectCoverPickerOpen(false)
      setProjectCoverPickerStage('projects')
      setSelectedProjectRootTaskId('')
      setSelectedProjectAssetId('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`图池选图失败：${message}`)
    } finally {
      setIsApplyingProjectCover(false)
    }
  }, [applyVideoCoverPath, effectiveWorkspacePath, selectedProjectAsset])

  const toggleDraftProduct = (productId: string): void => {
    const normalizedProductId = String(productId ?? '').trim()
    if (!normalizedProductId) return
    setDraftSelectedProductIds((prev) => {
      if (prev.includes(normalizedProductId)) {
        return prev.filter((id) => id !== normalizedProductId)
      }
      return [...prev, normalizedProductId]
    })
  }

  const clearDraftProducts = (): void => {
    setDraftSelectedProductIds([])
  }

  const handleSave = async (): Promise<void> => {
    if (isSaving || !isDirty) return
    const currentTask = task
    if (!currentTask) return
    if (hasSaveTitleOverflow) {
      window.alert(
        `标题超 ${PENDING_POOL_TITLE_LIMIT}（${draftTitleCount}/${PENDING_POOL_TITLE_LIMIT}），请先修改标题后再保存。`
      )
      return
    }
    setIsSaving(true)
    try {
      const primaryProduct = draftSelectedProducts[0]
      const updates: Record<string, unknown> = {
        title: draftTitle,
        content: draftContent,
        images: draftImages,
        ...(currentTask.mediaType === 'video' ? { videoCoverMode: draftVideoCoverMode } : {}),
        productId: primaryProduct?.id ?? '',
        productName: primaryProduct?.name ?? '',
        linkedProducts: draftSelectedProducts
      }
      const result = await window.api.cms.task.updateBatch([currentTask.id], updates as never)
      const updated = Array.isArray(result) ? result[0] : null
      if (updated && onTaskUpdated) {
        onTaskUpdated(updated)
      }
      // 重置初始化标记，让 draft 值重新从更新后的 task 同步
      initializedRef.current = null
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`保存失败：${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (isDeleting) return
    const currentTask = task
    if (!currentTask) return
    setIsDeleting(true)
    try {
      const result = await window.electronAPI.showMessageBox({
        type: 'warning',
        title: '确认删除',
        message: `确定要删除该任务吗？`,
        detail: '删除后无法恢复。',
        buttons: ['删除', '取消'],
        defaultId: 1,
        cancelId: 1
      })
      if (result.response !== 0) return
      await deleteTasks([currentTask.id])
      onClose()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      window.alert(`删除失败：${msg}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleTestPublish = async (): Promise<void> => {
    if (isTestingPublish) return
    const currentTask = task
    if (!currentTask) return
    if (isDirty) {
      window.alert('当前任务有未保存修改，请先保存后再执行测试发布。')
      return
    }
    if (currentTask.status === 'published') {
      window.alert('已发布任务不需要再做测试发布。')
      return
    }

    const confirmed = window.confirm(
      '将执行一次“不会真发”的测试发布：会自动打开发布页并填充内容，但不会点击最终发布按钮。\n确定继续吗？'
    )
    if (!confirmed) return

    setIsTestingPublish(true)
    try {
      const result = await window.api.cms.publisher.publish(currentTask.accountId, {
        title: currentTask.title,
        content: currentTask.content,
        mediaType: currentTask.mediaType,
        videoPath: currentTask.videoPath,
        videoCoverMode: currentTask.videoCoverMode,
        images: currentTask.images,
        productId: currentTask.productId,
        productName: currentTask.productName,
        linkedProducts: currentTask.linkedProducts,
        dryRun: true,
        mode: 'auto_publish'
      })
      if (!result.success) {
        throw new Error(result.error || '测试发布失败')
      }
      addLog('[媒体矩阵] 测试发布执行完成：已走到发布前最后一步，未真正发布。')
      window.alert('测试发布执行完成：已走到发布前最后一步，未真正发布。')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`测试发布失败：${message}`)
    } finally {
      setIsTestingPublish(false)
    }
  }

  if (!isOpen || !task) return null

  const isRemix = Boolean(
    task.transformPolicy === 'remix_v1' ||
    task.tags?.includes('remix') ||
    task.tags?.includes('裂变')
  )
  const status = formatStatus(task.status)
  const scheduledAtText =
    typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt)
      ? moment(task.scheduledAt).format('YYYY-MM-DD HH:mm')
      : '—'
  const createdAtText =
    typeof task.createdAt === 'number' && Number.isFinite(task.createdAt)
      ? moment(task.createdAt).format('YYYY-MM-DD HH:mm')
      : '—'

  // ----- 渲染 -----
  return (
    <>
      {createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            guardedClose()
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
              aria-label="关闭"
              onClick={guardedClose}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="grid grid-cols-5">
              {/* ========== 左侧：图片/视频预览 ========== */}
              <div className="col-span-3 border-r border-zinc-800 bg-black/20 p-4">
                <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                  {isVideo ? (
                    playableVideoSrc ? (
                      <video
                        key={playableVideoSrc}
                        controls
                        preload="metadata"
                        src={playableVideoSrc}
                        poster={activePosterSrc || undefined}
                        className="h-full w-full object-contain"
                        onLoadedData={() => setMainLoaded(true)}
                        onError={handleVideoPreviewError}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
                        <Video className="h-10 w-10" />
                      </div>
                    )
                  ) : activeSrc ? (
                    <img
                      key={activeSrc}
                      src={activeSrc}
                      alt=""
                      loading="lazy"
                      className={cn(
                        'h-full w-full object-contain transition-opacity',
                        mainLoaded ? 'opacity-100' : 'opacity-0'
                      )}
                      onLoad={() => setMainLoaded(true)}
                    />
                  ) : (
                    <div className="h-full w-full bg-zinc-900" />
                  )}
                  {!mainLoaded && (isVideo ? playableVideoSrc : activeSrc) ? (
                    <div className="absolute inset-0 animate-pulse bg-zinc-900/40" />
                  ) : null}
                  {resolvedImages.length > 1 && !isVideo ? (
                    <div className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
                      <Layers size={12} />
                      <span>
                        {safeActiveIndex + 1}/{resolvedImages.length}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* 缩略图区域：可编辑时用 DnD 排序，否则只读 */}
                {isEditable && !isVideo ? (
                  <div className="mt-3">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext items={draftImages} strategy={rectSortingStrategy}>
                        <div className="flex flex-wrap gap-2">
                          {draftImages.map((imgPath, index) => (
                            <SortableImage
                              key={imgPath}
                              id={imgPath}
                              src={resolveLocalImage(imgPath, effectiveWorkspacePath)}
                              index={index}
                              onRemove={() => handleRemoveImage(index)}
                              onClick={() => {
                                setActiveIndex(index)
                                setMainLoaded(false)
                              }}
                            />
                          ))}
                          <button
                            type="button"
                            className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/30 text-zinc-500 transition hover:border-purple-500/40 hover:text-purple-400"
                            onClick={() => void handleAddImages()}
                            aria-label="添加图片"
                          >
                            <ImagePlus className="h-5 w-5" />
                          </button>
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                ) : isEditable && isVideo ? (
                  <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold text-zinc-300">视频封面</div>
                      <div
                        className={cn(
                          'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px]',
                          draftVideoCoverMode === 'manual'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                            : 'border-zinc-700 bg-zinc-900 text-zinc-300'
                        )}
                      >
                        当前模式：{videoCoverModeText}
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="h-28 w-[84px] shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
                        {videoCoverSrc ? (
                          <img
                            src={videoCoverSrc}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">
                            未设置
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800"
                        onClick={() => void handleUploadVideoCover()}
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        本地上传
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2.5 text-xs text-purple-200 transition hover:bg-purple-500/20"
                        onClick={openProjectCoverPicker}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        图池选图
                      </button>
                    </div>
                  </div>
                ) : resolvedImages.length > 1 ? (
                  <div className="mt-3 grid grid-cols-6 gap-2">
                    {resolvedImages.map((src, index) => (
                      <button
                        key={`${src}-${index}`}
                        type="button"
                        className={cn(
                          'relative aspect-square overflow-hidden rounded-lg border bg-zinc-950',
                          index === safeActiveIndex
                            ? 'border-purple-500/60 ring-2 ring-purple-400/20'
                            : 'border-zinc-800'
                        )}
                        onClick={() => {
                          setActiveIndex(index)
                          if (!isVideo) setMainLoaded(false)
                        }}
                        aria-label={`预览第 ${index + 1} 张`}
                      >
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          className={cn(
                            'h-full w-full object-cover transition-opacity',
                            thumbLoaded.has(index) ? 'opacity-100' : 'opacity-0'
                          )}
                          onLoad={() =>
                            setThumbLoaded((prev) => {
                              const next = new Set(prev)
                              next.add(index)
                              return next
                            })
                          }
                        />
                        {!thumbLoaded.has(index) ? (
                          <div className="absolute inset-0 animate-pulse bg-zinc-900/40" />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* ========== 右侧：信息面板 ========== */}
              <div className="col-span-2 p-4">
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="pr-10">
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditable ? (
                        <div className="min-w-0 flex-1">
                          <input
                            type="text"
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            className={cn(
                              'min-w-0 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-lg font-bold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50',
                              hasTitleOverflow &&
                                'border-rose-500/60 text-rose-100 focus-visible:ring-rose-500/50'
                            )}
                            placeholder="标题"
                          />
                          {isEditable ? (
                            <div
                              className={cn(
                                'mt-1 text-[11px]',
                                hasTitleOverflow ? 'text-rose-300' : 'text-zinc-500'
                              )}
                            >
                              标题字数：{draftTitleCount}/{PENDING_POOL_TITLE_LIMIT}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <h2 className="text-lg font-bold text-zinc-100 break-words whitespace-normal">
                          {task.title || '(未命名)'}
                        </h2>
                      )}
                      <div
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          status.className
                        )}
                      >
                        {status.label}
                      </div>
                      {isVideo ? (
                        <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-200">
                          <Video className="h-3 w-3" />
                          <span>视频</span>
                        </div>
                      ) : null}
                      {isRemix ? (
                        <div
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-300"
                          title="智能裂变"
                        >
                          <Sparkles size={12} />
                          <span>裂变</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-zinc-400">
                      <div>
                        排期时间：<span className="text-zinc-200">{scheduledAtText}</span>
                      </div>
                      <div>
                        创建时间：<span className="text-zinc-200">{createdAtText}</span>
                      </div>
                      {hasSaveTitleOverflow ? (
                        <div className="text-rose-300">标题超 20，需先改标题后才能保存。</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex-1">
                    <div className="mb-2 text-xs font-semibold text-zinc-300">正文</div>
                    <textarea
                      readOnly={!isEditable}
                      value={isEditable ? draftContent : task.content || ''}
                      onChange={isEditable ? (e) => setDraftContent(e.target.value) : undefined}
                      className={cn(
                        'h-[260px] w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                        isEditable && 'focus-visible:ring-purple-500/50'
                      )}
                    />
                  </div>

                  <CmsProductMultiSelectPanel
                    title="挂车商品"
                    subtitle={
                      isEditable
                        ? displaySelectedProducts.length > 0
                          ? `已选 ${displaySelectedProducts.length} 个商品`
                          : '点击卡片选择需要挂车的商品'
                        : productSummaryText
                    }
                    products={displayProductOptions}
                    selectedProductIds={displaySelectedProductIds}
                    selectedProducts={displaySelectedProducts}
                    workspacePath={effectiveWorkspacePath}
                    emptyStateMessage={
                      isEditable
                        ? '当前账号暂无已同步商品，先去媒体矩阵执行一次“同步商品”。'
                        : '当前任务未绑定商品。'
                    }
                    onToggleProduct={isEditable ? toggleDraftProduct : undefined}
                    onClearSelected={isEditable ? clearDraftProducts : undefined}
                    interactive={isEditable}
                    showSelectedChips={isEditable}
                    variant="compact"
                    scrollClassName="max-h-[240px]"
                  />

                  <div className="flex items-center justify-end gap-2">
                    {publishMode === 'cdp' && (task.status === 'pending' || task.status === 'scheduled') ? (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 text-sm text-amber-100 transition hover:bg-amber-500/20',
                          (isTestingPublish || isDirty) && 'pointer-events-none opacity-60'
                        )}
                        disabled={isTestingPublish || isDirty}
                        onClick={() => void handleTestPublish()}
                        title={isDirty ? '请先保存任务修改，再执行测试发布' : '自动走到发布前最后一步，但不会真正发布'}
                      >
                        <Save className="h-4 w-4" />
                        {isTestingPublish ? '测试中…' : '测试发布（不会真发）'}
                      </button>
                    ) : null}
                    {isEditable && isDirty ? (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 text-sm text-purple-200 transition hover:bg-purple-500/20',
                          (isSaving || hasSaveTitleOverflow) && 'pointer-events-none opacity-60'
                        )}
                        disabled={isSaving || hasSaveTitleOverflow}
                        onClick={() => void handleSave()}
                      >
                        <Save className="h-4 w-4" />
                        {isSaving ? '保存中…' : '保存'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 transition hover:bg-zinc-900/50"
                      onClick={guardedClose}
                    >
                      关闭
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 text-sm text-red-200 transition hover:bg-red-500/15',
                        isDeleting && 'pointer-events-none opacity-60'
                      )}
                      onClick={() => void handleDelete()}
                    >
                      <Trash2 className="h-4 w-4" />
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      <VideoCoverProjectPickerModal
        open={isProjectCoverPickerOpen}
        stage={projectCoverPickerStage}
        workspacePath={effectiveWorkspacePath}
        isLoading={isLoadingProjectCoverLibrary}
        errorMessage={projectCoverLibraryError}
        projectCards={projectCoverCards}
        selectedProject={selectedProjectCard}
        selectedAssetId={selectedProjectAssetId}
        selectedProjectAssets={selectedProjectAssets}
        isApplying={isApplyingProjectCover}
        onClose={() => {
          setIsProjectCoverPickerOpen(false)
          setProjectCoverPickerStage('projects')
        }}
        onOpenProject={(projectRootTaskId) => {
          setSelectedProjectRootTaskId(projectRootTaskId)
          setProjectCoverPickerStage('assets')
        }}
        onBackToProjects={() => setProjectCoverPickerStage('projects')}
        onSelectAsset={setSelectedProjectAssetId}
        onConfirm={() => void handleApplyProjectCover()}
      />
    </>
  )
}

export { TaskDetailModal }
