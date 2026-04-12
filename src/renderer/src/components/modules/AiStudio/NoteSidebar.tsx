import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import {
  Check,
  ChevronLeft,
  Image as ImageIcon,
  Loader2,
  Music4,
  PackageSearch,
  Play,
  Upload,
  Video,
  X
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { resolveTaskSelectedProductIds } from '@renderer/lib/cmsTaskProductHelpers'
import { useCmsStore, type Task } from '@renderer/store/useCmsStore'
import { SmartGenerationOverlay } from '../../ui/SmartGenerationOverlay'
import type { SmartGenerationPhase } from '../../ui/smartGenerationOverlayHelpers'
import {
  buildSelectedWorkshopProducts,
  resolveWorkshopAccountId
} from '@renderer/components/modules/workshopProductSelectionHelpers'

import {
  AI_STUDIO_NOTE_MATERIAL_DRAG_MIME,
  parseNoteMaterialDragPayload
} from './noteMaterialDragPayload'
import {
  applyDroppedCoversToPreviewTasks,
  canToggleNotePreviewSelection,
  collectDispatchableNotePreviewTaskIds,
  countUndispatchedNotePreviewTasks,
  isNotePreviewTaskDispatched,
  resolveIntersectedNotePreviewTaskIds
} from './noteSidebarHelpers'
import {
  buildVideoNoteEditorViewModel,
  type VideoNoteEntryMode
} from './videoNoteEditorHelpers'
import type { VideoNoteGenerationState } from './videoNoteGenerationOrchestrator'
import type { AiStudioAssetRecord } from './useAiStudioState'
import {
  VIDEO_COMPOSER_RANDOM_BGM_VALUE,
  fileNameFromPath,
  fileUrlFromPath,
  useVideoComposerController
} from '../useVideoComposerController'

export type NoteSidebarMode = 'image-note' | 'video-note'
export type NoteSidebarPhase = 'editing' | 'preview'
export type ImageNoteEntryMode = 'smart' | 'manual'

type NoteDispatchProgressState = {
  phase: 'start' | 'progress' | 'done'
  processed: number
  total: number
  created: number
  message: string
}

type NoteSidebarProps = {
  isOpen: boolean
  mode: NoteSidebarMode
  phase: NoteSidebarPhase
  canvasMode?: 'result' | 'batch-pick'
  materials: AiStudioAssetRecord[]
  csvDraft: string
  smartPromptDraft: string
  videoSmartPromptDraft: string
  groupCountDraft: string
  minImagesDraft: string
  maxImagesDraft: string
  maxReuseDraft: string
  videoEntryMode: VideoNoteEntryMode
  videoGenerationState: VideoNoteGenerationState
  smartGenerationPhase?: SmartGenerationPhase
  smartGenerationError?: string | null
  isVideoGenerateDisabled?: boolean
  isGenerating?: boolean
  dispatchProgress?: NoteDispatchProgressState | null
  previewTasks: Task[]
  videoComposer: ReturnType<typeof useVideoComposerController>
  pooledMediaPaths?: string[]
  onOpenChange: (next: boolean) => void
  onModeChange: (mode: NoteSidebarMode) => void
  onCsvChange: (value: string) => void
  onSmartPromptChange: (value: string) => void
  onVideoSmartPromptChange: (value: string) => void
  onVideoEntryModeChange: (value: VideoNoteEntryMode) => void
  onGroupCountChange: (value: string) => void
  onMinImagesChange: (value: string) => void
  onMaxImagesChange: (value: string) => void
  onMaxReuseChange: (value: string) => void
  onGenerate: (payload?: {
    imageNoteEntryMode?: ImageNoteEntryMode
    videoNoteEntryMode?: VideoNoteEntryMode
  }) => void
  onRegenerate: () => void
  onPreviewTasksChange: (tasks: Task[]) => void
  onDispatch: (selectedTaskIds: string[]) => void
  onAddMaterials: (paths: string[]) => void
  onRemoveMaterial: (asset: AiStudioAssetRecord) => void
  onOpenBatchPick?: () => void
  onConsumeBatchPickSelection?: () => void
}

type NoteSidebarAccountRecord = {
  id: string
  name: string
  status?: string
}

type NoteSidebarProductRecord = {
  id: string
  name: string
  cover: string
  price: string
  productUrl: string
  accountId: string
}

const NOTE_SIDEBAR_BASE_SURFACE_CLASS = 'bg-[#fbfbfc]'
const NOTE_SIDEBAR_CARD_SURFACE_CLASS =
  'border border-zinc-200/65 bg-[#fbfbfc] shadow-[0_18px_36px_rgba(15,23,42,0.035)]'
const NOTE_SIDEBAR_SUBTLE_SURFACE_CLASS = 'border border-zinc-200/80 bg-[#fbfbfc]'

function isSupportedImagePath(filePath: string): boolean {
  return /\.(jpg|jpeg|png|webp|heic)$/i.test(String(filePath ?? '').trim())
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未命名素材'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items
  if (fromIndex < 0 || toIndex < 0) return items
  if (fromIndex >= items.length || toIndex >= items.length) return items

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function readDroppedMaterialPaths(event: React.DragEvent<HTMLElement>): string[] {
  const customPayload = parseNoteMaterialDragPayload(
    event.dataTransfer.getData(AI_STUDIO_NOTE_MATERIAL_DRAG_MIME)
  ).filter(isSupportedImagePath)
  if (customPayload.length > 0) {
    return uniqueStrings(customPayload)
  }

  return uniqueStrings(
    Array.from(event.dataTransfer.files)
      .map((file) => window.electronAPI.getPathForFile(file))
      .filter(isSupportedImagePath)
  )
}

function deriveSelectedDispatchBinding(tasks: Task[]): {
  accountId: string
  productIds: string[]
} {
  const selectedTasks = Array.isArray(tasks) ? tasks : []
  if (selectedTasks.length === 0) {
    return { accountId: '', productIds: [] }
  }

  const firstAccountId = String(selectedTasks[0]?.accountId ?? '').trim()
  const allAccountIdsSame =
    firstAccountId.length > 0 &&
    selectedTasks.every((task) => String(task.accountId ?? '').trim() === firstAccountId)

  const firstProductIds = resolveTaskSelectedProductIds({
    linkedProducts: selectedTasks[0]?.linkedProducts,
    productId: selectedTasks[0]?.productId
  })
  const allProductIdsSame = selectedTasks.every((task) => {
    const nextIds = resolveTaskSelectedProductIds({
      linkedProducts: task?.linkedProducts,
      productId: task?.productId
    })
    if (nextIds.length !== firstProductIds.length) return false
    return nextIds.every((id, index) => id === firstProductIds[index])
  })

  return {
    accountId: allAccountIdsSame ? firstAccountId : '',
    productIds: allProductIdsSame ? firstProductIds : []
  }
}

function deriveNoteBoundProductSummary(task: Task): {
  primaryText: string
  suffixText: string
} {
  const linkedProducts = Array.isArray(task.linkedProducts) ? task.linkedProducts : []
  const normalizedNames = linkedProducts
    .map((product) => String(product?.name ?? '').trim())
    .filter(Boolean)

  if (normalizedNames.length > 0) {
    const firstName = normalizedNames[0] ?? ''
    if (normalizedNames.length === 1) {
      return { primaryText: firstName, suffixText: '' }
    }
    return {
      primaryText: firstName,
      suffixText: `等 ${normalizedNames.length} 个商品`
    }
  }

  const fallbackName = String(task.productName ?? '').trim()
  return {
    primaryText: fallbackName || '未绑定商品',
    suffixText: ''
  }
}

function IconButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-[10px] transition',
        active
          ? 'border-white/70 bg-zinc-900 text-white shadow-[0_12px_28px_rgba(15,23,42,0.12)]'
          : 'border-zinc-200/70 bg-white/78 text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] hover:border-zinc-200 hover:bg-white/92 hover:text-zinc-900'
      )}
    >
      {icon}
    </button>
  )
}

function MaterialTile({
  asset,
  onRemove
}: {
  asset: AiStudioAssetRecord
  onRemove: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)

  return (
    <div className="group/material relative overflow-hidden rounded-[12px] border border-zinc-200/65 bg-white/78 shadow-[0_10px_28px_rgba(15,23,42,0.035)] backdrop-blur-[8px]">
      {src ? (
        <img
          src={src}
          alt={basename(asset.filePath)}
          className="block aspect-[4/5] w-full bg-zinc-100 object-cover"
          draggable={false}
          loading="lazy"
        />
      ) : (
        <div className="aspect-[4/5] w-full bg-zinc-100" />
      )}

      <button
        type="button"
        onClick={() => onRemove(asset)}
        className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200/70 bg-white/94 text-zinc-500 opacity-0 shadow-[0_6px_14px_rgba(15,23,42,0.06)] backdrop-blur-[8px] transition hover:border-zinc-200 hover:text-zinc-900 group-hover/material:opacity-100"
        aria-label="移出创作中心"
        title="移出创作中心"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

function EmptyMaterialStrip({
  onAddMaterials
}: {
  onAddMaterials: (paths: string[]) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)

  const handlePick = async (): Promise<void> => {
    const result = await window.electronAPI.openMediaFiles({
      multiSelections: true,
      accept: 'image'
    })
    if (!result) return
    const items = Array.isArray(result) ? result : [result]
    const paths = uniqueStrings(
      items.map((item) => String(item?.originalPath ?? '').trim()).filter(isSupportedImagePath)
    )
    if (paths.length > 0) onAddMaterials(paths)
  }

  const handleDrop: React.DragEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault()
    setDragging(false)
    const paths = readDroppedMaterialPaths(event)
    if (paths.length > 0) onAddMaterials(paths)
  }

  return (
    <button
      type="button"
      onClick={() => void handlePick()}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={handleDrop}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-4 rounded-[18px] px-2 py-5 text-center transition',
        dragging ? 'bg-sky-50/78' : 'bg-transparent hover:bg-zinc-50/45'
      )}
    >
      <div
        className={cn(
          'flex aspect-[4/5] w-[150px] max-w-full items-center justify-center rounded-[18px] border border-dashed bg-white/84 backdrop-blur-[8px] transition',
          dragging
            ? 'border-sky-300 shadow-[0_14px_32px_rgba(56,189,248,0.10)]'
            : 'border-zinc-200/80 shadow-[0_10px_26px_rgba(15,23,42,0.035)]'
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-zinc-200/80 bg-white/88 text-zinc-400 shadow-[0_8px_18px_rgba(15,23,42,0.03)] backdrop-blur-[8px]">
          <Upload className="h-4 w-4" />
        </div>
      </div>
      <div className="pb-2 text-center">
        <div className="text-[12px] font-medium tracking-[0.01em] text-zinc-700">
          点击上传或拖入素材
        </div>
        <div className="mt-1 text-[11px] text-zinc-400">支持 jpg / png / webp / heic</div>
      </div>
    </button>
  )
}

function MaterialStrip({
  materials,
  onAddMaterials,
  onRemove
}: {
  materials: AiStudioAssetRecord[]
  onAddMaterials: (paths: string[]) => void
  onRemove: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)

  if (materials.length === 0) {
    return <EmptyMaterialStrip onAddMaterials={onAddMaterials} />
  }

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragLeave={(event) => {
        event.preventDefault()
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        const paths = readDroppedMaterialPaths(event)
        if (paths.length > 0) onAddMaterials(paths)
      }}
      className={cn(
        'rounded-[18px] transition',
        dragging
          ? 'bg-sky-50/70 ring-1 ring-sky-200 shadow-[0_14px_30px_rgba(56,189,248,0.08)]'
          : 'bg-transparent'
      )}
    >
      <div className="grid grid-cols-4 gap-3">
        {materials.map((asset) => (
          <MaterialTile key={asset.id} asset={asset} onRemove={onRemove} />
        ))}
      </div>
    </div>
  )
}

function PreviewNoteCard({
  task,
  onOpen,
  onTaskChange,
  onCoverDrop,
  cardRef,
  selected,
  onToggleSelect
}: {
  task: Task
  onOpen: () => void
  onTaskChange: (patch: Partial<Task>) => void
  onCoverDrop: (droppedPaths: string[]) => void
  cardRef?: (node: HTMLDivElement | null) => void
  selected: boolean
  onToggleSelect: () => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const imagePaths = task.assignedImages.filter(Boolean)
  const coverPath = imagePaths[0] ?? ''
  const coverSrc = resolveLocalImage(coverPath, workspacePath)
  const isVideoTask = task.mediaType === 'video'
  const isDispatched = isNotePreviewTaskDispatched(task)
  const productSummary = deriveNoteBoundProductSummary(task)
  const [editingField, setEditingField] = useState<'title' | 'body' | null>(null)
  const [draftValue, setDraftValue] = useState('')
  const [isCoverDragOver, setIsCoverDragOver] = useState(false)

  const openEditor = (field: 'title' | 'body'): void => {
    setEditingField(field)
    setDraftValue(field === 'title' ? task.title : task.body)
  }

  const commitEditor = (): void => {
    if (!editingField) return
    const nextValue = draftValue.trim()
    if (editingField === 'title') {
      onTaskChange({ title: nextValue })
    } else {
      onTaskChange({ body: nextValue })
    }
    setEditingField(null)
  }

  return (
    <article
      ref={cardRef}
      data-note-preview-card="true"
      data-note-preview-task-id={task.id}
      className={cn(
        'rounded-[18px] px-3 py-2 transition',
        selected
          ? 'bg-zinc-50/92 shadow-[0_10px_24px_rgba(15,23,42,0.04)]'
          : 'hover:bg-zinc-50/58'
      )}
    >
      <div className="grid grid-cols-[20px_96px_minmax(0,1fr)] gap-4">
        <div className="flex items-center justify-center self-start pt-10">
          <button
            type="button"
            onClick={() => {
              if (isDispatched) return
              onToggleSelect()
            }}
            disabled={isDispatched}
            data-note-preview-interactive="true"
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border shadow-[0_6px_16px_rgba(15,23,42,0.06)] transition',
              isDispatched
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                : selected
                  ? 'border-zinc-900 bg-zinc-900 text-white'
                  : 'border-zinc-300 bg-white text-transparent hover:border-zinc-400 hover:bg-zinc-50'
            )}
            aria-label={isDispatched ? '笔记已分发' : selected ? '取消选中笔记' : '选中笔记'}
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
          </button>
        </div>

        <div className="relative self-start">
          <button
            type="button"
            onClick={onOpen}
            data-note-preview-interactive="true"
            onDragEnter={(event) => {
              if (!isVideoTask) return
              event.preventDefault()
              setIsCoverDragOver(true)
            }}
            onDragOver={(event) => {
              if (!isVideoTask) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              setIsCoverDragOver(true)
            }}
            onDragLeave={(event) => {
              if (!isVideoTask) return
              event.preventDefault()
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
              setIsCoverDragOver(false)
            }}
            onDrop={(event) => {
              if (!isVideoTask) return
              event.preventDefault()
              const droppedPaths = readDroppedMaterialPaths(event)
              if (droppedPaths.length === 0) {
                setIsCoverDragOver(false)
                return
              }
              onCoverDrop(droppedPaths)
              setIsCoverDragOver(false)
            }}
            className={cn(
              'relative block overflow-hidden border bg-zinc-50 transition hover:border-sky-200 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.26)]',
              isCoverDragOver
                ? 'border-sky-300 shadow-[0_0_0_2px_rgba(125,211,252,0.32)]'
                : 'border-zinc-200/80'
            )}
          >
            {coverSrc ? (
              <div className="relative">
                <img
                  src={coverSrc}
                  alt={basename(coverPath)}
                  className="block aspect-[4/5] w-full bg-zinc-100 object-cover"
                  draggable={false}
                  loading="lazy"
                />
                {isVideoTask ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(15,23,42,0.02),rgba(15,23,42,0.28))]">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/18 text-white backdrop-blur-[6px]">
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center bg-zinc-50 text-[10px] tracking-[0.04em] text-zinc-400">
                {isVideoTask ? '暂无视频封面' : '暂无封面'}
              </div>
            )}
            {isVideoTask && isCoverDragOver ? (
              <div className="absolute inset-0 z-[1] flex items-center justify-center bg-sky-500/14 text-[10px] font-medium tracking-[0.08em] text-sky-700 backdrop-blur-[1px]">
                释放替换封面
              </div>
            ) : null}
            <div className="absolute bottom-2 right-2 inline-flex h-5 items-center justify-center border border-white/90 bg-zinc-950/34 px-1.5 text-[10px] font-medium tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-[4px]">
              {isVideoTask ? '视频' : `${imagePaths.length}张`}
            </div>
          </button>
        </div>

        <div className="flex h-[120px] min-w-0 flex-col text-left">
          <div className="flex min-w-0 shrink-0 flex-col items-start gap-2">
            <div className="flex w-full items-start justify-between gap-2">
              {editingField === 'title' ? (
                <Input
                  autoFocus
                  value={draftValue}
                  data-note-preview-interactive="true"
                  onChange={(event) => setDraftValue(event.target.value)}
                  onBlur={commitEditor}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitEditor()
                    }
                    if (event.key === 'Escape') {
                      setEditingField(null)
                    }
                  }}
                  className="h-7 w-full rounded-none border-zinc-200 bg-white px-2 text-[12px] font-medium tracking-[0.02em] text-zinc-800 placeholder:text-zinc-300 shadow-[0_0_0_1px_rgba(255,255,255,0.6)] focus-visible:border-sky-200 focus-visible:ring-1 focus-visible:ring-sky-100"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => openEditor('title')}
                  data-note-preview-interactive="true"
                  className="max-w-full flex-1 text-left text-[12px] font-medium tracking-[0.02em] text-zinc-700 transition hover:text-zinc-950"
                >
                  <span className="line-clamp-2 break-all">
                    {task.title.trim() || '未命名笔记'}
                  </span>
                </button>
              )}
              {isDispatched ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] tracking-[0.04em] text-emerald-600">
                  已分发
                </span>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 pt-1">
            {editingField === 'body' ? (
              <Textarea
                autoFocus
                value={draftValue}
                data-note-preview-interactive="true"
                onChange={(event) => setDraftValue(event.target.value)}
                onBlur={commitEditor}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    commitEditor()
                  }
                  if (event.key === 'Escape') {
                    setEditingField(null)
                  }
                }}
                className="h-full min-h-0 w-full resize-none rounded-none border-zinc-200 bg-white px-2 py-2 text-[12px] leading-6 text-zinc-600 placeholder:text-zinc-300 shadow-[0_0_0_1px_rgba(255,255,255,0.6)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden focus-visible:border-sky-200 focus-visible:ring-1 focus-visible:ring-sky-100"
              />
            ) : (
              <div className="h-full overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => openEditor('body')}
                  data-note-preview-interactive="true"
                  className="block w-full text-left align-top transition hover:text-zinc-700"
                >
                  <div className="whitespace-pre-wrap break-words text-[12px] leading-[1.7] text-zinc-500">
                    {task.body.trim() || '点击这里编辑正文'}
                  </div>
                </button>
              </div>
            )}
          </div>

          <div className="mt-auto shrink-0 pt-2 text-[10px] leading-4 tracking-[0.01em] text-zinc-400">
            {productSummary.suffixText ? (
              <div className="flex min-w-0 items-baseline gap-0.5 whitespace-nowrap">
                <span className="min-w-0 truncate">{productSummary.primaryText}</span>
                <span className="shrink-0">{productSummary.suffixText}</span>
              </div>
            ) : (
              <span className="block truncate">{productSummary.primaryText}</span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function DispatchSettingsModal({
  isOpen,
  selectedTaskCount,
  isLoadingAccounts,
  isLoadingProducts,
  accounts,
  selectedAccountId,
  products,
  selectedProductIds,
  onAccountChange,
  onToggleProduct,
  onClearProducts,
  onClose,
  onApply
}: {
  isOpen: boolean
  selectedTaskCount: number
  isLoadingAccounts: boolean
  isLoadingProducts: boolean
  accounts: NoteSidebarAccountRecord[]
  selectedAccountId: string
  products: NoteSidebarProductRecord[]
  selectedProductIds: string[]
  onAccountChange: (value: string) => void
  onToggleProduct: (productId: string) => void
  onClearProducts: () => void
  onClose: () => void
  onApply: () => void
}): React.JSX.Element | null {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const selectedProducts = useMemo(
    () =>
      buildSelectedWorkshopProducts({
        allProducts: products,
        selectedProductIds
      }),
    [products, selectedProductIds]
  )

  if (!isOpen) return null

  return (
    <div className="pointer-events-auto fixed inset-0 z-[90] flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.78),rgba(244,244,245,0.94))] px-5 py-8">
      <button
        type="button"
        aria-label="关闭分发设置"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(760px,calc(100vh-3rem))] w-[min(920px,calc(100vw-3rem))] flex-col bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(248,250,252,0.98))] shadow-[0_28px_90px_rgba(15,23,42,0.12),0_0_0_1px_rgba(148,163,184,0.12)]">
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-[14px] font-medium tracking-[0.02em] text-zinc-900">分发设置</div>
            <div className="mt-1 text-[11px] tracking-[0.04em] text-zinc-400">
              为已选 {selectedTaskCount} 条笔记绑定账号与商品
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center border border-zinc-200 bg-white text-zinc-500 shadow-[0_8px_18px_rgba(56,189,248,0.08)] transition hover:border-sky-200 hover:text-zinc-900"
            aria-label="关闭分发设置"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 px-5 pb-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="border border-zinc-200/90 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.025)]">
              <div className="text-[10px] tracking-[0.08em] text-zinc-400">派发账号</div>
              {isLoadingAccounts ? (
                <div className="mt-3 flex h-10 items-center gap-2 border border-zinc-200 bg-white px-3 text-[12px] text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在读取账号
                </div>
              ) : (
                <select
                  value={selectedAccountId}
                  onChange={(event) => onAccountChange(event.target.value)}
                  className="mt-3 h-10 w-full border border-zinc-200 bg-white px-3 text-[13px] text-zinc-800 outline-none transition focus:border-sky-200 focus:ring-2 focus:ring-sky-100"
                >
                  {accounts.length === 0 ? <option value="">暂无账号</option> : null}
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="border border-zinc-200/90 bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.025)]">
              <div className="text-[10px] tracking-[0.08em] text-zinc-400">本次绑定</div>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-[28px] font-semibold tracking-[-0.03em] text-zinc-900">
                  {selectedTaskCount}
                </span>
                <span className="pb-1 text-[12px] text-zinc-400">条笔记</span>
              </div>
              <div className="mt-3 border border-zinc-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(240,249,255,0.65))] px-3 py-2 text-[12px] text-zinc-600 shadow-[0_10px_24px_rgba(56,189,248,0.05)]">
                已选 {selectedProducts.length} 个商品
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="h-8 flex-1 rounded-none border-zinc-200 bg-white px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  onClick={onApply}
                  className="h-8 flex-1 rounded-none border border-sky-100 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(240,249,255,0.95))] px-3 text-[11px] font-medium tracking-[0.02em] text-zinc-800 shadow-[0_12px_28px_rgba(56,189,248,0.08)] transition hover:border-sky-200 hover:text-zinc-950 hover:shadow-[0_16px_34px_rgba(56,189,248,0.12)]"
                >
                  应用到已选笔记
                </Button>
              </div>
            </div>
          </div>

          <div className="min-h-0 border border-zinc-200/90 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.025)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-[10px] tracking-[0.08em] text-zinc-400">挂车商品</div>
                <div className="mt-1 text-[12px] text-zinc-500">
                  {selectedProducts.length > 0
                    ? `已选 ${selectedProducts.length} 个商品`
                    : '选择后会应用到当前选中的笔记'}
                </div>
              </div>
              {selectedProducts.length > 0 ? (
                <button
                  type="button"
                  onClick={onClearProducts}
                  className="text-[11px] tracking-[0.04em] text-zinc-400 transition hover:text-zinc-700"
                >
                  清空
                </button>
              ) : null}
            </div>

            <div className="min-h-0 max-h-[420px] overflow-y-auto px-3 pb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {isLoadingProducts ? (
                <div className="flex min-h-[260px] items-center justify-center border border-dashed border-zinc-200 bg-zinc-50 px-6 text-center text-[12px] text-zinc-400">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在读取商品
                  </div>
                </div>
              ) : products.length > 0 ? (
                <div className="space-y-2">
                  {products.map((product) => {
                    const isSelected = selectedProductIds.includes(product.id)
                    const previewSrc = product.cover
                      ? resolveLocalImage(product.cover, workspacePath)
                      : ''

                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => onToggleProduct(product.id)}
                        className={cn(
                          'flex w-full items-center gap-3 border px-3 py-3 text-left transition',
                          isSelected
                            ? 'border-sky-200 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(240,249,255,0.82))] shadow-[0_10px_24px_rgba(56,189,248,0.08)]'
                            : 'border-zinc-200 bg-white hover:border-zinc-300 hover:shadow-[0_10px_22px_rgba(15,23,42,0.03)]'
                        )}
                      >
                        <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden border border-zinc-200 bg-zinc-50">
                          {previewSrc ? (
                            <img
                              src={previewSrc}
                              alt={product.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-zinc-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="line-clamp-2 text-[13px] font-medium leading-5 text-zinc-800">
                            {product.name || product.id}
                          </div>
                          <div className="mt-2 text-[12px] text-zinc-400">
                            {product.price || '未设置价格'}
                          </div>
                        </div>
                        <div
                          className={cn(
                            'inline-flex h-6 w-6 shrink-0 items-center justify-center border transition',
                            isSelected
                              ? 'border-zinc-950 bg-zinc-950 text-white'
                              : 'border-zinc-200 bg-white text-transparent'
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-h-[260px] items-center justify-center border border-dashed border-zinc-200 bg-zinc-50 px-6 text-center text-[12px] text-zinc-400">
                  <div className="flex max-w-[220px] flex-col items-center gap-2">
                    <PackageSearch className="h-4 w-4 text-zinc-300" />
                    <span>{selectedAccountId ? '当前账号暂无已同步商品' : '请先选择账号'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function DispatchProgressOverlay({
  progress
}: {
  progress: NoteDispatchProgressState
}): React.JSX.Element {
  const safeTotal = Math.max(progress.total, 1)
  const percent = Math.max(0, Math.min(100, Math.round((progress.processed / safeTotal) * 100)))
  const isDone = progress.phase === 'done'

  return (
    <div className="pointer-events-auto fixed inset-0 z-[140] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.74),rgba(244,244,245,0.92))] px-6 py-8 backdrop-blur-[14px]">
      <div className="w-[min(440px,calc(100vw-2.5rem))] rounded-[32px] border border-white/70 bg-[rgba(255,255,255,0.78)] px-8 py-7 shadow-[0_30px_90px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.8)]">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-full border shadow-[0_16px_38px_rgba(15,23,42,0.08)]',
              isDone
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                : 'border-zinc-200 bg-white text-zinc-700'
            )}
          >
            {isDone ? <Check className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-semibold tracking-[-0.03em] text-zinc-900">
              {isDone ? '分发完成' : '正在派发'}
            </div>
            <div className="mt-1 text-[12px] leading-6 text-zinc-500">{progress.message}</div>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-full bg-zinc-200/80">
          <div
            className={cn(
              'h-2 rounded-full transition-all duration-300',
              isDone ? 'bg-emerald-500' : 'bg-zinc-900'
            )}
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] tracking-[0.04em] text-zinc-400">
          <span>
            {isDone
              ? `已分发 ${progress.created}/${safeTotal}`
              : `进行中 ${progress.processed}/${safeTotal}`}
          </span>
          <span>{percent}%</span>
        </div>
      </div>
    </div>
  )
}

function PreviewEditorModal({
  task,
  onClose,
  onImagesChange,
  onCoverDrop
}: {
  task: Task
  onClose: () => void
  onImagesChange: (nextImages: string[]) => void
  onCoverDrop: (droppedPaths: string[]) => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [isVideoCoverDragOver, setIsVideoCoverDragOver] = useState(false)
  const imagePaths = task.assignedImages.filter(Boolean)
  const isVideoTask = task.mediaType === 'video'
  const videoPreviewPath = String(task.videoPreviewPath ?? task.videoPath ?? '').trim()
  const videoCoverPath = imagePaths[0] ?? ''
  const videoCoverSrc = videoCoverPath ? resolveLocalImage(videoCoverPath, workspacePath) : ''

  return (
    <div className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.72),rgba(244,244,245,0.92))] px-6 py-8">
      <button
        type="button"
        aria-label="关闭预览编辑器"
        className="absolute inset-0"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(720px,calc(100vh-4rem))] w-[min(1040px,calc(100vw-5rem))] flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_28px_90px_rgba(15,23,42,0.12),0_0_0_1px_rgba(148,163,184,0.14)]">
        <div className="flex items-center justify-end px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center border border-zinc-200 bg-white text-zinc-500 shadow-[0_8px_18px_rgba(56,189,248,0.08)] transition hover:border-sky-200 hover:text-zinc-900"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-5 py-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {isVideoTask ? (
            <div className="grid h-full min-h-[260px] gap-4 lg:grid-cols-[minmax(0,1.3fr)_280px]">
              <div className="flex min-h-[260px] items-center justify-center border border-zinc-200/80 bg-black/90">
                {videoPreviewPath ? (
                  <video
                    src={fileUrlFromPath(videoPreviewPath)}
                    className="h-full max-h-[520px] w-full object-contain"
                    controls
                    preload="metadata"
                    playsInline
                  />
                ) : (
                  <div className="text-[12px] tracking-[0.04em] text-zinc-400">
                    当前视频不可预览
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div className="border border-zinc-200/80 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.035)]">
                  <div className="text-[10px] tracking-[0.08em] text-zinc-400">视频封面</div>
                  <div
                    className={cn(
                      'mt-3 overflow-hidden border bg-zinc-50 transition',
                      isVideoCoverDragOver
                        ? 'border-sky-300 shadow-[0_0_0_2px_rgba(125,211,252,0.22)]'
                        : 'border-zinc-200'
                    )}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      setIsVideoCoverDragOver(true)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                      setIsVideoCoverDragOver(true)
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                      setIsVideoCoverDragOver(false)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const droppedPaths = readDroppedMaterialPaths(event)
                      if (droppedPaths.length > 0) {
                        onCoverDrop(droppedPaths)
                      }
                      setIsVideoCoverDragOver(false)
                    }}
                  >
                    {videoCoverSrc ? (
                      <div className="relative">
                        <img
                          src={videoCoverSrc}
                          alt={basename(videoCoverPath)}
                          className="block aspect-[4/5] w-full object-cover"
                          loading="lazy"
                        />
                        {isVideoCoverDragOver ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-sky-500/14 text-[11px] font-medium tracking-[0.08em] text-sky-700 backdrop-blur-[1px]">
                            释放替换封面
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex aspect-[4/5] items-center justify-center text-[11px] text-zinc-400">
                        {isVideoCoverDragOver ? '释放替换封面' : '暂无封面'}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-[10px] tracking-[0.04em] text-zinc-400">
                    可把图池图片直接拖到这里，覆盖为新封面
                  </div>
                </div>
                <div className="border border-zinc-200/80 bg-white p-3 text-[11px] leading-5 text-zinc-500 shadow-[0_10px_24px_rgba(15,23,42,0.035)]">
                  <div className="text-[10px] tracking-[0.08em] text-zinc-400">视频信息</div>
                  <div className="mt-3 break-all">
                    {String(task.videoPath ?? '').trim() || '未记录视频路径'}
                  </div>
                </div>
              </div>
            </div>
          ) : imagePaths.length > 0 ? (
            <div className="flex min-w-max gap-4">
              {imagePaths.map((filePath, index) => {
                const src = resolveLocalImage(filePath, workspacePath)

                return (
                  <div
                    key={`${task.id}:${filePath}:${index}`}
                    draggable
                    onDragStart={() => setDraggingIndex(index)}
                    onDragEnd={() => setDraggingIndex(null)}
                    onDragOver={(event) => {
                      event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggingIndex === null) return
                      onImagesChange(reorderItems(imagePaths, draggingIndex, index))
                      setDraggingIndex(null)
                    }}
                    className={cn(
                      'group relative w-[172px] shrink-0 border border-zinc-200/80 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.035)] transition',
                      draggingIndex === index
                        ? 'opacity-70'
                        : 'opacity-100 hover:border-sky-200 hover:shadow-[0_16px_36px_rgba(56,189,248,0.1)]'
                    )}
                  >
                    <div className="absolute left-2 top-2 z-10 inline-flex h-6 min-w-6 items-center justify-center border border-zinc-200 bg-white px-1.5 text-[10px] tracking-[0.04em] text-zinc-500">
                      {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onImagesChange(imagePaths.filter((_, imageIndex) => imageIndex !== index))
                        setDraggingIndex(null)
                      }}
                      className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center border border-zinc-200 bg-white text-zinc-500 opacity-0 transition hover:border-zinc-300 hover:text-zinc-900 group-hover:opacity-100"
                      aria-label="删除图片"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    {src ? (
                      <img
                        src={src}
                        alt={basename(filePath)}
                        className="block aspect-[4/5] w-full bg-zinc-50 object-contain"
                        draggable={false}
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-[4/5] w-full items-center justify-center bg-zinc-50 text-[11px] text-zinc-400">
                        图片不可预览
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center border border-dashed border-zinc-200 bg-zinc-50 text-[12px] tracking-[0.04em] text-zinc-400">
              {isVideoTask ? '当前视频笔记暂无可预览内容' : '当前笔记已无图片'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CapsuleInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}): React.JSX.Element {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-6 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 placeholder:text-zinc-400 focus-visible:ring-zinc-300"
    />
  )
}

function LabeledMiniField({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="px-1 text-[10px] tracking-[0.04em] text-zinc-400">{label}</span>
      {children}
    </label>
  )
}

function VideoNoteEditor({
  csvDraft,
  smartPromptDraft,
  onCsvChange,
  onSmartPromptChange,
  onGenerate,
  videoComposer,
  pooledMediaPaths,
  entryMode,
  generationState,
  isGenerating,
  isGenerateDisabled,
  onEntryModeChange,
  smartGenerationError = null
}: {
  csvDraft: string
  smartPromptDraft: string
  onCsvChange: (value: string) => void
  onSmartPromptChange: (value: string) => void
  onGenerate: () => void
  videoComposer: ReturnType<typeof useVideoComposerController>
  pooledMediaPaths: string[]
  entryMode: VideoNoteEntryMode
  generationState: VideoNoteGenerationState
  isGenerating: boolean
  isGenerateDisabled: boolean
  onEntryModeChange: (value: VideoNoteEntryMode) => void
  smartGenerationError?: string | null
}): React.JSX.Element {
  const revealInFolder = async (filePath: string): Promise<void> => {
    const normalized = String(filePath ?? '').trim()
    if (!normalized) return
    await window.electronAPI.shellShowItemInFolder(normalized)
  }
  const viewModel = buildVideoNoteEditorViewModel({
    entryMode,
    generationState,
    isGenerating
  })
  const textareaValue = entryMode === 'manual' ? csvDraft : smartPromptDraft

  const sourceSummary = videoComposer.sourceRootPath
    ? `${videoComposer.sourceRootPath} · 图片 ${videoComposer.sourceImages.length} 张 / 视频 ${videoComposer.sourceVideos.length} 条`
    : videoComposer.sourceMediaCount > 0
      ? `已载入素材 · 图片 ${videoComposer.sourceImages.length} 张 / 视频 ${videoComposer.sourceVideos.length} 条`
      : '未选择素材'
  const isRandomBgmMode = videoComposer.selectedBgmValue === VIDEO_COMPOSER_RANDOM_BGM_VALUE

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="space-y-3 pb-4">
          <section className={cn('rounded-[22px] px-4 py-4', NOTE_SIDEBAR_CARD_SURFACE_CLASS)}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-zinc-800">素材输入</div>
              </div>
              <div
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] text-zinc-500',
                  NOTE_SIDEBAR_SUBTLE_SURFACE_CLASS
                )}
              >
                {videoComposer.sourceMediaCount} 项
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {pooledMediaPaths.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    videoComposer.loadSourceMedia(pooledMediaPaths, '', '已导入当前素材池')
                  }
                  className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  导入当前素材池
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => void videoComposer.handlePickMediaFolder()}
                disabled={videoComposer.isGenerating || videoComposer.isScanningRoot}
                className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              >
                {videoComposer.isScanningRoot ? '扫描中' : '选择文件夹'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void videoComposer.handlePickMediaFiles()}
                disabled={videoComposer.isGenerating || videoComposer.isScanningRoot}
                className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              >
                选择文件
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={videoComposer.clearSources}
                disabled={
                  videoComposer.isGenerating ||
                  videoComposer.isScanningRoot ||
                  videoComposer.sourceMediaCount === 0
                }
                className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              >
                清空
              </Button>
              {videoComposer.sourceRootPath ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void revealInFolder(videoComposer.sourceRootPath)}
                  className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  打开目录
                </Button>
              ) : null}
            </div>
            <div className="mt-3 rounded-[18px] border border-dashed border-zinc-200 bg-[#fbfbfc] px-3 py-3 text-[11px] leading-5 text-zinc-500">
              {sourceSummary}
            </div>
            {videoComposer.error ? (
              <div className="mt-2 text-[11px] text-rose-500">{videoComposer.error}</div>
            ) : null}
          </section>

          <section className={cn('rounded-[22px] px-4 py-4', NOTE_SIDEBAR_CARD_SURFACE_CLASS)}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-zinc-800">模板参数</div>
              </div>
              <div className="text-[10px] tracking-[0.04em] text-zinc-400">
                最近保存：{videoComposer.templateSavedAt > 0 ? '已保存' : '未保存'}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={videoComposer.handleSaveTemplate}
                className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              >
                保存模板
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={videoComposer.handleLoadTemplate}
                className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              >
                加载模板
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={videoComposer.handleResetTemplate}
                className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              >
                恢复默认
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] tracking-[0.04em] text-zinc-400">模板名称</span>
                <Input
                  value={videoComposer.template.name ?? ''}
                  onChange={(event) =>
                    videoComposer.setTemplate((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] tracking-[0.04em] text-zinc-400">总时长（秒）</span>
                <Input
                  value={videoComposer.template.totalDurationSec}
                  onChange={(event) =>
                    videoComposer.updateTemplateNumber('totalDurationSec', event.target.value)
                  }
                  className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] tracking-[0.04em] text-zinc-400">图片最小数</span>
                <Input
                  value={videoComposer.template.imageCountMin}
                  onChange={(event) =>
                    videoComposer.updateTemplateNumber('imageCountMin', event.target.value)
                  }
                  className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] tracking-[0.04em] text-zinc-400">图片最大数</span>
                <Input
                  value={videoComposer.template.imageCountMax}
                  onChange={(event) =>
                    videoComposer.updateTemplateNumber('imageCountMax', event.target.value)
                  }
                  className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                />
              </label>
            </div>
            <details className="mt-3 rounded-[18px] border border-zinc-200 bg-zinc-50/90 px-3 py-3">
              <summary className="cursor-pointer text-[11px] font-medium tracking-[0.04em] text-zinc-700">
                高级渲染设置
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">宽度</span>
                  <Input
                    value={videoComposer.template.width}
                    onChange={(event) =>
                      videoComposer.updateTemplateNumber('width', event.target.value)
                    }
                    className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">高度</span>
                  <Input
                    value={videoComposer.template.height}
                    onChange={(event) =>
                      videoComposer.updateTemplateNumber('height', event.target.value)
                    }
                    className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">FPS</span>
                  <Input
                    value={videoComposer.template.fps}
                    onChange={(event) =>
                      videoComposer.updateTemplateNumber('fps', event.target.value)
                    }
                    className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">转场</span>
                  <select
                    value={videoComposer.template.transitionType}
                    onChange={(event) =>
                      videoComposer.setTemplate((prev) => ({
                        ...prev,
                        transitionType: event.target.value as VideoTemplateTransition
                      }))
                    }
                    className="h-8 rounded-none border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 outline-none transition focus:border-zinc-300 focus:ring-2 focus:ring-zinc-100"
                  >
                    <option value="none">none</option>
                    <option value="fade">fade</option>
                    <option value="slideleft">slideleft</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">
                    转场时长（秒）
                  </span>
                  <Input
                    value={videoComposer.template.transitionDurationSec}
                    onChange={(event) =>
                      videoComposer.updateTemplateNumber(
                        'transitionDurationSec',
                        event.target.value
                      )
                    }
                    className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">
                    BGM 音量（0-2）
                  </span>
                  <Input
                    value={videoComposer.template.bgmVolume}
                    onChange={(event) =>
                      videoComposer.updateTemplateNumber('bgmVolume', event.target.value)
                    }
                    className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                  />
                </label>
              </div>
            </details>
          </section>

          <section className={cn('rounded-[22px] px-4 py-4', NOTE_SIDEBAR_CARD_SURFACE_CLASS)}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-medium text-zinc-800">生成控制</div>
              </div>
              <div className="rounded-full border border-zinc-200/80 bg-white/90 px-3 py-1 text-[11px] text-zinc-500">
                输出 {videoComposer.outputSizeLabel}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <select
                value={videoComposer.selectedBgmValue}
                onChange={(event) => videoComposer.setBgmSelectionValue(event.target.value)}
                disabled={
                  videoComposer.isGenerating ||
                  videoComposer.isSyncingHotMusic ||
                  videoComposer.isLoadingBgmList ||
                  videoComposer.bgmOptions.length === 0
                }
                className="h-9 w-full rounded-none border border-zinc-200 bg-white px-3 text-[12px] text-zinc-700 outline-none transition focus:border-zinc-300 focus:ring-2 focus:ring-zinc-100"
              >
                {videoComposer.bgmOptions.length === 0 ? (
                  <option value="">暂无可用音乐</option>
                ) : (
                  <option value={VIDEO_COMPOSER_RANDOM_BGM_VALUE}>随机一首背景音乐</option>
                )}
                {videoComposer.bgmOptions.map((filePath) => (
                  <option key={filePath} value={filePath}>
                    {fileNameFromPath(filePath)}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void videoComposer.handleSyncHotMusic()}
                  disabled={videoComposer.isGenerating || videoComposer.isSyncingHotMusic}
                  className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  {videoComposer.isSyncingHotMusic ? '刷新中' : '刷新音乐榜'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void videoComposer.loadHotMusicBgmOptions()}
                  disabled={
                    videoComposer.isGenerating ||
                    videoComposer.isSyncingHotMusic ||
                    videoComposer.isLoadingBgmList
                  }
                  className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  {videoComposer.isLoadingBgmList ? '刷新中' : '本地列表'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    videoComposer.setBgmSelectionValue(VIDEO_COMPOSER_RANDOM_BGM_VALUE)
                  }
                  disabled={
                    videoComposer.isGenerating ||
                    videoComposer.bgmOptions.length === 0 ||
                    isRandomBgmMode
                  }
                  className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  设为随机
                </Button>
                {videoComposer.selectedBgmValue &&
                videoComposer.selectedBgmValue !== VIDEO_COMPOSER_RANDOM_BGM_VALUE ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void revealInFolder(videoComposer.selectedBgmValue)}
                    className="h-8 rounded-full border-zinc-200/80 bg-white/92 px-3 text-[11px] text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                  >
                    打开 BGM
                  </Button>
                ) : (
                  <div className="flex h-8 items-center justify-center rounded-full border border-dashed border-zinc-200/80 bg-[#fbfbfc] px-3 text-[11px] text-zinc-400">
                    <Music4 className="mr-1.5 h-3.5 w-3.5" />
                    音乐跟随列表
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">本次生成数量</span>
                  <Input
                    value={videoComposer.batchCount}
                    onChange={(event) => videoComposer.setBatchCount(event.target.value)}
                    className="h-8 rounded-none border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 focus-visible:ring-zinc-300"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] tracking-[0.04em] text-zinc-400">输出尺寸比例</span>
                  <select
                    value={videoComposer.outputAspect}
                    onChange={(event) =>
                      videoComposer.setOutputAspect(event.target.value as '9:16' | '3:4')
                    }
                    className="h-8 rounded-none border border-zinc-200 bg-white px-2 text-[11px] text-zinc-700 outline-none transition focus:border-zinc-300 focus:ring-2 focus:ring-zinc-100"
                  >
                    <option value="9:16">9:16（1080x1920）</option>
                    <option value="3:4">3:4（1080x1440）</option>
                  </select>
                </label>
              </div>

              {videoComposer.isGenerating ? (
                <div className="space-y-2 pt-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                    <div
                      className="h-full rounded-full bg-zinc-900 transition-all duration-150"
                      style={{ width: `${videoComposer.generateProgressPercent}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {videoComposer.generateProgressText ||
                      `总进度：${videoComposer.generateProgressPercent}%`}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <div className="text-[11px] tracking-[0.04em] text-zinc-400">视频笔记</div>
              <button
                type="button"
                onClick={() => onEntryModeChange(entryMode === 'manual' ? 'smart' : 'manual')}
                className="text-[11px] tracking-[0.04em] text-zinc-400 transition hover:text-zinc-700"
              >
                {viewModel.entryToggleLabel}
              </button>
            </div>
            <section
              className={cn(
                'relative overflow-hidden rounded-[22px] px-4 py-3',
                NOTE_SIDEBAR_CARD_SURFACE_CLASS
              )}
            >
              <SmartGenerationOverlay
                phase={viewModel.overlayPhase}
                errorMessage={entryMode === 'manual' ? null : smartGenerationError}
              />
              <Textarea
                value={textareaValue}
                onChange={(event) =>
                  entryMode === 'manual'
                    ? onCsvChange(event.target.value)
                    : onSmartPromptChange(event.target.value)
                }
                placeholder={viewModel.textareaPlaceholder}
                className="min-h-[88px] resize-none border-0 bg-transparent px-0 py-0 text-[12px] leading-6 text-zinc-900 placeholder:text-zinc-400 shadow-none focus-visible:ring-0"
              />
              {viewModel.statusText ? (
                <div className="mt-2 text-[11px] leading-5 text-zinc-500">{viewModel.statusText}</div>
              ) : null}

              <div className="mt-3 flex items-end justify-end gap-3 pt-2">
                <Button
                  type="button"
                  onClick={onGenerate}
                  disabled={isGenerateDisabled}
                  className="h-7 rounded-full border border-transparent bg-zinc-900 px-3.5 text-[11px] font-medium text-white shadow-[0_10px_22px_rgba(15,23,42,0.08)] transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  {viewModel.generateButtonLabel}
                </Button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function NoteSidebar({
  isOpen,
  mode,
  phase,
  canvasMode = 'result',
  materials,
  csvDraft,
  smartPromptDraft,
  videoSmartPromptDraft,
  groupCountDraft,
  minImagesDraft,
  maxImagesDraft,
  maxReuseDraft,
  videoEntryMode,
  videoGenerationState,
  smartGenerationPhase = null,
  smartGenerationError = null,
  isVideoGenerateDisabled = false,
  isGenerating = false,
  dispatchProgress = null,
  previewTasks,
  videoComposer,
  pooledMediaPaths = [],
  onOpenChange,
  onModeChange,
  onCsvChange,
  onSmartPromptChange,
  onVideoSmartPromptChange,
  onVideoEntryModeChange,
  onGroupCountChange,
  onMinImagesChange,
  onMaxImagesChange,
  onMaxReuseChange,
  onGenerate,
  onRegenerate,
  onPreviewTasksChange,
  onDispatch,
  onAddMaterials,
  onRemoveMaterial,
  onOpenBatchPick,
  onConsumeBatchPickSelection
}: NoteSidebarProps): React.JSX.Element | null {
  const [activePreviewTaskId, setActivePreviewTaskId] = useState<string | null>(null)
  const [selectedPreviewTaskIds, setSelectedPreviewTaskIds] = useState<string[]>([])
  const [isDispatchSettingsOpen, setIsDispatchSettingsOpen] = useState(false)
  const [imageNoteEntryMode, setImageNoteEntryMode] = useState<ImageNoteEntryMode>('smart')
  const [accounts, setAccounts] = useState<NoteSidebarAccountRecord[]>([])
  const [products, setProducts] = useState<NoteSidebarProductRecord[]>([])
  const [isLoadingDispatchAccounts, setIsLoadingDispatchAccounts] = useState(false)
  const [isLoadingDispatchProducts, setIsLoadingDispatchProducts] = useState(false)
  const [dispatchAccountIdDraft, setDispatchAccountIdDraft] = useState('')
  const [dispatchProductIdsDraft, setDispatchProductIdsDraft] = useState<string[]>([])
  const previewSurfaceRef = useRef<HTMLDivElement | null>(null)
  const previewCardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previewGestureRef = useRef<{
    startX: number
    startY: number
    targetTaskId: string | null
  } | null>(null)
  const previewTaskLayoutRef = useRef<
    Array<{ id: string; left: number; top: number; right: number; bottom: number }>
  >([])
  const suppressPreviewToggleRef = useRef(false)
  const lastPreviewSelectionRef = useRef<string[]>([])
  const [previewSelectionBox, setPreviewSelectionBox] = useState<{
    startX: number
    startY: number
    endX: number
    endY: number
  } | null>(null)
  const preferredAccountId = useCmsStore((store) => store.preferredAccountId)
  const setPreferredAccountId = useCmsStore((store) => store.setPreferredAccountId)
  const isImageMode = mode === 'image-note'
  const showPreview = phase === 'preview'
  const previewTaskIds = useMemo(() => previewTasks.map((task) => task.id), [previewTasks])
  const previewTaskIdsKey = previewTaskIds.join('::')
  const dispatchablePreviewTaskIds = useMemo(
    () => collectDispatchableNotePreviewTaskIds(previewTasks),
    [previewTasks]
  )
  const dispatchablePreviewTaskIdsKey = dispatchablePreviewTaskIds.join('::')
  const undispatchedPreviewTaskCount = countUndispatchedNotePreviewTasks(previewTasks)
  const isDispatching = dispatchProgress !== null
  const allPreviewSelected =
    dispatchablePreviewTaskIds.length > 0 &&
    dispatchablePreviewTaskIds.every((taskId) => selectedPreviewTaskIds.includes(taskId))
  const activePreviewTask =
    showPreview && activePreviewTaskId
      ? (previewTasks.find((task) => task.id === activePreviewTaskId) ?? null)
      : null
  const isManualImageNoteEntry = imageNoteEntryMode === 'manual'
  const imageNoteTextareaValue = isManualImageNoteEntry ? csvDraft : smartPromptDraft
  const imageNoteTextareaPlaceholder = isManualImageNoteEntry
    ? '输入 CSV 格式文案'
    : '输入商品信息和额外说明提示词'
  const imageNoteGenerateButtonLabel = isManualImageNoteEntry ? '生成笔记' : '智能生成'
  const imageNoteEntryToggleLabel = isManualImageNoteEntry ? '智能生成' : '手动录入'
  const isImageSmartGenerating = !isManualImageNoteEntry && smartGenerationPhase !== null
  const imageNoteButtonLabel = isManualImageNoteEntry
    ? isGenerating
      ? '生成中'
      : imageNoteGenerateButtonLabel
    : imageNoteGenerateButtonLabel
  const previewSelectionOverlayStyle = previewSelectionBox
    ? {
        left: `${Math.min(previewSelectionBox.startX, previewSelectionBox.endX)}px`,
        top: `${Math.min(previewSelectionBox.startY, previewSelectionBox.endY)}px`,
        width: `${Math.abs(previewSelectionBox.endX - previewSelectionBox.startX)}px`,
        height: `${Math.abs(previewSelectionBox.endY - previewSelectionBox.startY)}px`
      }
    : null

  useEffect(() => {
    if (!showPreview) {
      setSelectedPreviewTaskIds([])
      setIsDispatchSettingsOpen(false)
      setPreviewSelectionBox(null)
      return
    }

    setSelectedPreviewTaskIds((current) =>
      current.filter((taskId) => dispatchablePreviewTaskIds.includes(taskId))
    )
  }, [
    dispatchablePreviewTaskIds,
    dispatchablePreviewTaskIdsKey,
    previewTaskIds,
    previewTaskIdsKey,
    showPreview
  ])

  useEffect(() => {
    lastPreviewSelectionRef.current = selectedPreviewTaskIds
  }, [selectedPreviewTaskIds])

  useEffect(() => {
    if (!showPreview || !isDispatchSettingsOpen) return
    let canceled = false
    const loadAccounts = async (): Promise<void> => {
      setIsLoadingDispatchAccounts(true)
      try {
        const list = (await window.api.cms.account.list()) as NoteSidebarAccountRecord[]
        if (canceled) return
        setAccounts(list)
        setDispatchAccountIdDraft((current) =>
          resolveWorkshopAccountId({
            accounts: list,
            currentAccountId: current,
            preferredAccountId
          })
        )
      } catch {
        if (canceled) return
        setAccounts([])
      } finally {
        if (!canceled) setIsLoadingDispatchAccounts(false)
      }
    }
    void loadAccounts()
    return () => {
      canceled = true
    }
  }, [isDispatchSettingsOpen, preferredAccountId, showPreview])

  useEffect(() => {
    if (!showPreview || !isDispatchSettingsOpen) return
    let canceled = false
    const loadProducts = async (): Promise<void> => {
      try {
        const accountId = dispatchAccountIdDraft.trim()
        if (!accountId) {
          setProducts([])
          setIsLoadingDispatchProducts(false)
          return
        }
        setIsLoadingDispatchProducts(true)
        const list = (await window.api.cms.product.list({
          accountId
        })) as NoteSidebarProductRecord[]
        if (canceled) return
        setProducts(list)
      } catch {
        if (canceled) return
        setProducts([])
      } finally {
        if (!canceled) setIsLoadingDispatchProducts(false)
      }
    }
    void loadProducts()
    return () => {
      canceled = true
    }
  }, [dispatchAccountIdDraft, isDispatchSettingsOpen, showPreview])

  useEffect(() => {
    if (!dispatchAccountIdDraft.trim()) {
      setDispatchProductIdsDraft([])
      return
    }
    if (products.length === 0) return
    const availableIds = new Set(
      products.map((product) => String(product.id ?? '').trim()).filter(Boolean)
    )
    setDispatchProductIdsDraft((current) =>
      current.filter((productId) => availableIds.has(String(productId ?? '').trim()))
    )
  }, [dispatchAccountIdDraft, products])

  if (!isOpen) {
    return null
  }

  const updatePreviewTaskImages = (taskId: string, nextImages: string[]): void => {
    onPreviewTasksChange(
      previewTasks.map((task) =>
        task.id === taskId ? { ...task, assignedImages: nextImages } : task
      )
    )
  }

  const updatePreviewTask = (taskId: string, patch: Partial<Task>): void => {
    onPreviewTasksChange(
      previewTasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task))
    )
  }

  const applyPreviewTaskCoverDrop = (taskId: string, droppedPaths: string[]): void => {
    const result = applyDroppedCoversToPreviewTasks(previewTasks, taskId, droppedPaths)
    if (result.appliedCount <= 0) return
    onPreviewTasksChange(result.tasks)
    onConsumeBatchPickSelection?.()
  }

  const togglePreviewTaskSelection = (taskId: string): void => {
    const normalizedTaskId = String(taskId ?? '').trim()
    if (!normalizedTaskId) return
    const targetTask = previewTasks.find((task) => task.id === normalizedTaskId)
    if (!targetTask || !canToggleNotePreviewSelection(targetTask)) return

    setSelectedPreviewTaskIds((current) =>
      current.includes(normalizedTaskId)
        ? current.filter((currentTaskId) => currentTaskId !== normalizedTaskId)
        : [...current, normalizedTaskId]
    )
  }

  const openDispatchSettings = (): void => {
    if (selectedPreviewTaskIds.length === 0) {
      window.alert('请先选中至少一条笔记。')
      return
    }

    const selectedTasks = previewTasks.filter((task) => selectedPreviewTaskIds.includes(task.id))
    const preset = deriveSelectedDispatchBinding(selectedTasks)

    setDispatchAccountIdDraft(preset.accountId)
    setDispatchProductIdsDraft(preset.productIds)
    setIsDispatchSettingsOpen(true)
  }

  const applyDispatchSettings = (): void => {
    const normalizedAccountId = dispatchAccountIdDraft.trim()
    const selectedProducts = buildSelectedWorkshopProducts({
      allProducts: products,
      selectedProductIds: dispatchProductIdsDraft
    })
    const primaryProduct = selectedProducts[0]

    if (normalizedAccountId) {
      setPreferredAccountId(normalizedAccountId)
    }

    onPreviewTasksChange(
      previewTasks.map((task) =>
        selectedPreviewTaskIds.includes(task.id)
          ? {
              ...task,
              accountId: normalizedAccountId || undefined,
              productId: primaryProduct?.id ?? undefined,
              productName: primaryProduct?.name ?? undefined,
              linkedProducts: selectedProducts.length > 0 ? selectedProducts : undefined
            }
          : task
      )
    )
    setIsDispatchSettingsOpen(false)
  }

  const handleImageNoteEntryModeToggle = (): void => {
    setImageNoteEntryMode((current) => (current === 'manual' ? 'smart' : 'manual'))
  }

  return (
    <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-40 flex w-[352px] max-w-[calc(100%-1.5rem)] justify-end">
      <aside
        className={cn(
          'pointer-events-auto flex h-full w-full flex-col overflow-hidden shadow-[-18px_0_48px_rgba(15,23,42,0.04)]',
          NOTE_SIDEBAR_BASE_SURFACE_CLASS
        )}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <div className="text-[14px] font-medium tracking-[0.02em] text-zinc-800">创作中心</div>
          <div className="flex items-center gap-2">
            <IconButton
              icon={<ChevronLeft className="h-4 w-4" />}
              label="收起侧栏"
              onClick={() => onOpenChange(false)}
            />
            <IconButton
              icon={<ImageIcon className="h-4 w-4" />}
              label="创作图文笔记"
              active={isImageMode}
              onClick={() => onModeChange('image-note')}
            />
            <IconButton
              icon={<Video className="h-4 w-4" />}
              label="创作视频笔记"
              active={mode === 'video-note'}
              onClick={() => onModeChange('video-note')}
            />
          </div>
        </div>

        {mode === 'video-note' && phase === 'editing' ? (
          <VideoNoteEditor
            csvDraft={csvDraft}
            smartPromptDraft={videoSmartPromptDraft}
            onCsvChange={onCsvChange}
            onSmartPromptChange={onVideoSmartPromptChange}
            onGenerate={() => onGenerate({ videoNoteEntryMode: videoEntryMode })}
            videoComposer={videoComposer}
            pooledMediaPaths={pooledMediaPaths}
            entryMode={videoEntryMode}
            generationState={videoGenerationState}
            isGenerating={isGenerating}
            isGenerateDisabled={isVideoGenerateDisabled}
            onEntryModeChange={onVideoEntryModeChange}
            smartGenerationError={smartGenerationError}
          />
        ) : null}

        {isImageMode || showPreview ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <div className="min-h-0 flex-1 overflow-y-auto pt-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {phase === 'editing' ? (
                <div className="pb-4">
                  <MaterialStrip
                    materials={materials}
                    onAddMaterials={onAddMaterials}
                    onRemove={onRemoveMaterial}
                  />
                  {isImageMode && canvasMode === 'result' && onOpenBatchPick ? (
                    <div className="flex justify-center pb-6 pt-3">
                      <button
                        type="button"
                        onClick={onOpenBatchPick}
                        className="inline-flex h-8 items-center gap-2 rounded-full border border-zinc-200/70 bg-white/86 px-3 text-[11px] font-medium tracking-[0.04em] text-zinc-700 shadow-[0_14px_30px_rgba(15,23,42,0.05)] backdrop-blur-[10px] transition hover:border-zinc-200 hover:bg-white hover:text-zinc-950 hover:shadow-[0_18px_36px_rgba(15,23,42,0.07)]"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        图池选图
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showPreview ? (
                <div
                  ref={previewSurfaceRef}
                  onPointerDownCapture={(event) => {
                    if (event.button !== 0 || isDispatching) return
                    const surface = previewSurfaceRef.current
                    if (!surface) return

                    const target = event.target as HTMLElement | null
                    const interactiveElement =
                      target?.closest<HTMLElement>(
                        '[data-note-preview-interactive="true"],button,a,input,textarea,select,[role="button"]'
                      ) ?? null
                    if (interactiveElement) return

                    const cardElement =
                      target?.closest<HTMLElement>('[data-note-preview-card="true"]') ?? null
                    const targetTaskId =
                      String(cardElement?.dataset.notePreviewTaskId ?? '').trim() || null

                    event.preventDefault()
                    const surfaceRect = surface.getBoundingClientRect()
                    const startX = event.clientX - surfaceRect.left
                    const startY = event.clientY - surfaceRect.top
                    previewGestureRef.current = { startX, startY, targetTaskId }
                    previewTaskLayoutRef.current = previewTasks
                      .map((task) => {
                        const cardNode = previewCardRefs.current[task.id]
                        if (!cardNode) return null
                        const cardRect = cardNode.getBoundingClientRect()
                        return {
                          id: task.id,
                          left: cardRect.left - surfaceRect.left,
                          top: cardRect.top - surfaceRect.top,
                          right: cardRect.right - surfaceRect.left,
                          bottom: cardRect.bottom - surfaceRect.top
                        }
                      })
                      .filter(
                        (
                          layout
                        ): layout is {
                          id: string
                          left: number
                          top: number
                          right: number
                          bottom: number
                        } => Boolean(layout)
                      )
                    suppressPreviewToggleRef.current = false
                    lastPreviewSelectionRef.current = selectedPreviewTaskIds

                    const handlePointerMove = (moveEvent: PointerEvent): void => {
                      const currentSurface = previewSurfaceRef.current
                      const gesture = previewGestureRef.current
                      if (!currentSurface || !gesture) return

                      const currentRect = currentSurface.getBoundingClientRect()
                      const endX = moveEvent.clientX - currentRect.left
                      const endY = moveEvent.clientY - currentRect.top
                      if (Math.abs(endX - gesture.startX) < 4 && Math.abs(endY - gesture.startY) < 4) {
                        return
                      }

                      suppressPreviewToggleRef.current = true
                      const nextBox = {
                        startX: gesture.startX,
                        startY: gesture.startY,
                        endX,
                        endY
                      }
                      setPreviewSelectionBox(nextBox)

                      const nextSelectedIds = resolveIntersectedNotePreviewTaskIds({
                        taskLayouts: previewTaskLayoutRef.current,
                        selectableTaskIds: dispatchablePreviewTaskIds,
                        selectionRect: {
                          left: Math.min(nextBox.startX, nextBox.endX),
                          top: Math.min(nextBox.startY, nextBox.endY),
                          right: Math.max(nextBox.startX, nextBox.endX),
                          bottom: Math.max(nextBox.startY, nextBox.endY)
                        }
                      })

                      const previousIds = lastPreviewSelectionRef.current
                      if (
                        previousIds.length === nextSelectedIds.length &&
                        previousIds.every((id, index) => id === nextSelectedIds[index])
                      ) {
                        return
                      }
                      lastPreviewSelectionRef.current = nextSelectedIds
                      setSelectedPreviewTaskIds(nextSelectedIds)
                    }

                    const handlePointerUp = (): void => {
                      const gesture = previewGestureRef.current
                      previewGestureRef.current = null
                      previewTaskLayoutRef.current = []
                      setPreviewSelectionBox(null)
                      window.removeEventListener('pointermove', handlePointerMove)
                      window.removeEventListener('pointerup', handlePointerUp)

                      if (!suppressPreviewToggleRef.current) {
                        if (gesture?.targetTaskId) {
                          togglePreviewTaskSelection(gesture.targetTaskId)
                        } else {
                          setSelectedPreviewTaskIds([])
                        }
                      }

                      window.setTimeout(() => {
                        suppressPreviewToggleRef.current = false
                      }, 0)
                    }

                    window.addEventListener('pointermove', handlePointerMove)
                    window.addEventListener('pointerup', handlePointerUp)
                  }}
                  className="relative space-y-3 py-2"
                >
                  <div className="flex items-center justify-between px-3">
                    <div className="text-[11px] tracking-[0.04em] text-zinc-400">
                      生成预览
                      {undispatchedPreviewTaskCount > 0
                        ? ` · 待分发 ${undispatchedPreviewTaskCount} 条`
                        : ' · 已全部分发'}
                    </div>
                    <div className="flex items-center gap-3">
                      {mode === 'video-note' && onOpenBatchPick ? (
                        <button
                          type="button"
                          onClick={onOpenBatchPick}
                          className="inline-flex items-center gap-1 text-[11px] tracking-[0.04em] text-zinc-400 transition hover:text-zinc-700"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          图池选图
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setActivePreviewTaskId(null)
                          onRegenerate()
                        }}
                        disabled={isDispatching}
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] tracking-[0.04em] transition',
                          !isDispatching
                            ? 'text-zinc-400 hover:text-zinc-700'
                            : 'cursor-not-allowed text-zinc-300'
                        )}
                      >
                        重新生成
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPreviewTaskIds(
                            allPreviewSelected ? [] : dispatchablePreviewTaskIds
                          )
                        }}
                        disabled={dispatchablePreviewTaskIds.length === 0 || isDispatching}
                        className="text-[11px] tracking-[0.04em] text-zinc-400 transition hover:text-zinc-700"
                      >
                        {allPreviewSelected ? '取消全选' : '全选'}
                      </button>
                    </div>
                  </div>
                  {previewTasks.map((task) => (
                    <PreviewNoteCard
                      key={task.id}
                      cardRef={(node) => {
                        previewCardRefs.current[task.id] = node
                      }}
                      task={task}
                      onOpen={() => setActivePreviewTaskId(task.id)}
                      onTaskChange={(patch) => updatePreviewTask(task.id, patch)}
                      onCoverDrop={(droppedPaths) => applyPreviewTaskCoverDrop(task.id, droppedPaths)}
                      selected={selectedPreviewTaskIds.includes(task.id)}
                      onToggleSelect={() => togglePreviewTaskSelection(task.id)}
                    />
                  ))}
                  {previewSelectionOverlayStyle ? (
                    <div
                      className="pointer-events-none absolute z-20 rounded-[18px] border border-sky-400/85 bg-[rgba(56,189,248,0.18)] shadow-[0_0_0_1px_rgba(186,230,253,0.55),0_16px_40px_rgba(14,165,233,0.14)] backdrop-blur-[1px]"
                      style={previewSelectionOverlayStyle}
                    />
                  ) : null}
                </div>
              ) : phase !== 'editing' ? (
                <div className="flex h-full min-h-[180px] items-end justify-center">
                  <div className="text-[12px] text-zinc-300"> </div>
                </div>
              ) : null}
            </div>

            <div className="mt-1 shrink-0 bg-transparent px-1 pt-1">
              {phase === 'editing' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-[11px] tracking-[0.04em] text-zinc-400">图文笔记</div>
                    <button
                      type="button"
                      onClick={handleImageNoteEntryModeToggle}
                      className="text-[11px] tracking-[0.04em] text-zinc-400 transition hover:text-zinc-700"
                    >
                      {imageNoteEntryToggleLabel}
                    </button>
                  </div>
                  <div
                    className={cn(
                      'relative overflow-hidden rounded-[22px] px-4 py-3',
                      NOTE_SIDEBAR_CARD_SURFACE_CLASS
                    )}
                  >
                    <SmartGenerationOverlay
                      phase={isManualImageNoteEntry ? null : smartGenerationPhase}
                      errorMessage={isManualImageNoteEntry ? null : smartGenerationError}
                    />
                    <Textarea
                      value={imageNoteTextareaValue}
                      onChange={(event) =>
                        isManualImageNoteEntry
                          ? onCsvChange(event.target.value)
                          : onSmartPromptChange(event.target.value)
                      }
                      placeholder={imageNoteTextareaPlaceholder}
                      className="min-h-[88px] resize-none border-0 bg-transparent px-0 py-0 text-[12px] leading-6 text-zinc-900 placeholder:text-zinc-400 shadow-none focus-visible:ring-0"
                    />
                    <div className="mt-3 space-y-2 pt-2">
                      <div className="grid grid-cols-[0.9fr_1.45fr_0.9fr_auto] items-end gap-2">
                        <LabeledMiniField label="组数">
                          <CapsuleInput
                            value={groupCountDraft}
                            onChange={onGroupCountChange}
                            placeholder="1"
                          />
                        </LabeledMiniField>
                        <LabeledMiniField label="张数">
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                            <CapsuleInput
                              value={minImagesDraft}
                              onChange={onMinImagesChange}
                              placeholder="3"
                            />
                            <span className="text-[10px] text-zinc-300">-</span>
                            <CapsuleInput
                              value={maxImagesDraft}
                              onChange={onMaxImagesChange}
                              placeholder="5"
                            />
                          </div>
                        </LabeledMiniField>
                        <LabeledMiniField label="复用">
                          <CapsuleInput
                            value={maxReuseDraft}
                            onChange={onMaxReuseChange}
                            placeholder="1"
                          />
                        </LabeledMiniField>
                        <Button
                          type="button"
                          onClick={() => onGenerate({ imageNoteEntryMode })}
                          disabled={isGenerating || isImageSmartGenerating}
                          className="h-7 rounded-full border border-transparent bg-zinc-900 px-3.5 text-[11px] font-medium text-white shadow-[0_10px_22px_rgba(15,23,42,0.08)] transition hover:bg-zinc-800 disabled:opacity-60"
                        >
                          {imageNoteButtonLabel}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 pb-1 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openDispatchSettings}
                    disabled={selectedPreviewTaskIds.length === 0 || isDispatching}
                    className="h-8 rounded-full border border-zinc-200/70 bg-white/88 px-3 text-[11px] font-medium tracking-[0.02em] text-zinc-700 shadow-[0_10px_24px_rgba(15,23,42,0.03)] transition hover:border-zinc-200 hover:text-zinc-950"
                  >
                    分发设置
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onDispatch(selectedPreviewTaskIds)}
                    disabled={undispatchedPreviewTaskCount === 0 || isDispatching}
                    className="h-8 rounded-full border border-transparent bg-zinc-900 px-3 text-[11px] font-medium tracking-[0.02em] text-white shadow-[0_12px_26px_rgba(15,23,42,0.08)] transition hover:bg-zinc-800"
                  >
                    {undispatchedPreviewTaskCount === 0
                      ? '已全部分发'
                      : isDispatching
                        ? '派发中'
                        : '派发到发布工作台'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </aside>

      {dispatchProgress ? <DispatchProgressOverlay progress={dispatchProgress} /> : null}

      {activePreviewTask ? (
        <PreviewEditorModal
          task={activePreviewTask}
          onClose={() => setActivePreviewTaskId(null)}
          onImagesChange={(nextImages) => updatePreviewTaskImages(activePreviewTask.id, nextImages)}
          onCoverDrop={(droppedPaths) => applyPreviewTaskCoverDrop(activePreviewTask.id, droppedPaths)}
        />
      ) : null}

      <DispatchSettingsModal
        isOpen={isDispatchSettingsOpen}
        selectedTaskCount={selectedPreviewTaskIds.length}
        isLoadingAccounts={isLoadingDispatchAccounts}
        isLoadingProducts={isLoadingDispatchProducts}
        accounts={accounts}
        selectedAccountId={dispatchAccountIdDraft}
        products={products}
        selectedProductIds={dispatchProductIdsDraft}
        onAccountChange={(value) => {
          setDispatchAccountIdDraft(value)
          setDispatchProductIdsDraft([])
        }}
        onToggleProduct={(productId) => {
          setDispatchProductIdsDraft((current) =>
            current.includes(productId)
              ? current.filter((currentId) => currentId !== productId)
              : [...current, productId]
          )
        }}
        onClearProducts={() => setDispatchProductIdsDraft([])}
        onClose={() => setIsDispatchSettingsOpen(false)}
        onApply={applyDispatchSettings}
      />
    </div>
  )
}

export { NoteSidebar }
