import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'

import {
  Check,
  ChevronLeft,
  Clapperboard,
  Image as ImageIcon,
  Loader2,
  PackageSearch,
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
import {
  buildSelectedWorkshopProducts,
  resolveWorkshopAccountId
} from '@renderer/components/modules/workshopProductSelectionHelpers'

import {
  AI_STUDIO_NOTE_MATERIAL_DRAG_MIME,
  parseNoteMaterialDragPayload
} from './noteMaterialDragPayload'
import type { AiStudioAssetRecord } from './useAiStudioState'

export type NoteSidebarMode = 'image-note' | 'video-note'
export type NoteSidebarPhase = 'editing' | 'preview'

type NoteSidebarProps = {
  isOpen: boolean
  mode: NoteSidebarMode
  phase: NoteSidebarPhase
  materials: AiStudioAssetRecord[]
  csvDraft: string
  groupCountDraft: string
  minImagesDraft: string
  maxImagesDraft: string
  maxReuseDraft: string
  isGenerating?: boolean
  previewTasks: Task[]
  onOpenChange: (next: boolean) => void
  onModeChange: (mode: NoteSidebarMode) => void
  onCsvChange: (value: string) => void
  onGroupCountChange: (value: string) => void
  onMinImagesChange: (value: string) => void
  onMaxImagesChange: (value: string) => void
  onMaxReuseChange: (value: string) => void
  onGenerate: () => void
  onRegenerate: () => void
  onPreviewTasksChange: (tasks: Task[]) => void
  onDispatch: (selectedTaskIds: string[]) => void
  onAddMaterials: (paths: string[]) => void
  onRemoveMaterial: (asset: AiStudioAssetRecord) => void
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
        'inline-flex h-10 w-10 items-center justify-center rounded-full border transition',
        active
          ? 'border-zinc-950 bg-zinc-950 text-white shadow-[0_10px_30px_rgba(15,23,42,0.14)]'
          : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900'
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
    <div className="group/material relative">
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
        className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 opacity-0 shadow-[0_6px_14px_rgba(15,23,42,0.08)] transition hover:border-zinc-300 hover:text-zinc-900 group-hover/material:opacity-100"
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
        'flex w-full flex-col items-center justify-center gap-4 px-2 py-5 text-center transition',
        dragging ? 'bg-zinc-50/80' : 'bg-transparent hover:bg-zinc-50/30'
      )}
    >
      <div
        className={cn(
          'flex aspect-[4/5] w-[150px] max-w-full items-center justify-center rounded-[28px] border border-dashed bg-white transition',
          dragging
            ? 'border-zinc-300 shadow-[0_14px_32px_rgba(15,23,42,0.06)]'
            : 'border-zinc-200 shadow-[0_10px_26px_rgba(15,23,42,0.035)]'
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-zinc-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] text-zinc-400 shadow-[0_8px_18px_rgba(15,23,42,0.03)]">
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
        'rounded-[20px] transition',
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
  selected,
  onToggleSelect
}: {
  task: Task
  onOpen: () => void
  onTaskChange: (patch: Partial<Task>) => void
  selected: boolean
  onToggleSelect: () => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const imagePaths = task.assignedImages.filter(Boolean)
  const coverPath = imagePaths[0] ?? ''
  const coverSrc = resolveLocalImage(coverPath, workspacePath)
  const productSummary = deriveNoteBoundProductSummary(task)
  const [editingField, setEditingField] = useState<'title' | 'body' | null>(null)
  const [draftValue, setDraftValue] = useState('')

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
    <article className="px-3 py-2">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-4">
        <div className="relative self-start">
          <button
            type="button"
            onClick={onOpen}
            className="relative block overflow-hidden border border-zinc-200/80 bg-zinc-50 transition hover:border-sky-200 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.26)]"
          >
            {coverSrc ? (
              <img
                src={coverSrc}
                alt={basename(coverPath)}
                className="block aspect-[4/5] w-full bg-zinc-100 object-cover"
                draggable={false}
                loading="lazy"
              />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center bg-zinc-50 text-[10px] tracking-[0.04em] text-zinc-400">
                暂无封面
              </div>
            )}
            <div className="absolute bottom-2 right-2 inline-flex h-5 items-center justify-center border border-white/90 bg-zinc-950/34 px-1.5 text-[10px] font-medium tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-[4px]">
              {imagePaths.length}张
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleSelect()
            }}
            className={cn(
              'absolute left-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center border shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition',
              selected
                ? 'border-white bg-white text-zinc-950'
                : 'border-white/80 bg-white/78 text-transparent backdrop-blur-[2px] hover:bg-white'
            )}
            aria-label={selected ? '取消选中笔记' : '选中笔记'}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex h-[120px] min-w-0 flex-col text-left">
          <div className="flex min-w-0 shrink-0 flex-col items-start gap-2">
            {editingField === 'title' ? (
              <Input
                autoFocus
                value={draftValue}
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
                className="max-w-full text-left text-[12px] font-medium tracking-[0.02em] text-zinc-700 transition hover:text-zinc-950"
              >
                <span className="line-clamp-2 break-all">{task.title.trim() || '未命名笔记'}</span>
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 pt-1">
            {editingField === 'body' ? (
              <Textarea
                autoFocus
                value={draftValue}
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

function PreviewEditorModal({
  task,
  onClose,
  onImagesChange
}: {
  task: Task
  onClose: () => void
  onImagesChange: (nextImages: string[]) => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const imagePaths = task.assignedImages.filter(Boolean)

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
          {imagePaths.length > 0 ? (
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
              当前笔记已无图片
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

function VideoModePlaceholder(): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center px-6 pb-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[12px] text-zinc-500">
        <Clapperboard className="h-4 w-4" />
        视频笔记稍后接入
      </div>
    </div>
  )
}

function NoteSidebar({
  isOpen,
  mode,
  phase,
  materials,
  csvDraft,
  groupCountDraft,
  minImagesDraft,
  maxImagesDraft,
  maxReuseDraft,
  isGenerating = false,
  previewTasks,
  onOpenChange,
  onModeChange,
  onCsvChange,
  onGroupCountChange,
  onMinImagesChange,
  onMaxImagesChange,
  onMaxReuseChange,
  onGenerate,
  onRegenerate,
  onPreviewTasksChange,
  onDispatch,
  onAddMaterials,
  onRemoveMaterial
}: NoteSidebarProps): React.JSX.Element {
  const [activePreviewTaskId, setActivePreviewTaskId] = useState<string | null>(null)
  const [selectedPreviewTaskIds, setSelectedPreviewTaskIds] = useState<string[]>([])
  const [isDispatchSettingsOpen, setIsDispatchSettingsOpen] = useState(false)
  const [accounts, setAccounts] = useState<NoteSidebarAccountRecord[]>([])
  const [products, setProducts] = useState<NoteSidebarProductRecord[]>([])
  const [isLoadingDispatchAccounts, setIsLoadingDispatchAccounts] = useState(false)
  const [isLoadingDispatchProducts, setIsLoadingDispatchProducts] = useState(false)
  const [dispatchAccountIdDraft, setDispatchAccountIdDraft] = useState('')
  const [dispatchProductIdsDraft, setDispatchProductIdsDraft] = useState<string[]>([])
  const preferredAccountId = useCmsStore((store) => store.preferredAccountId)
  const setPreferredAccountId = useCmsStore((store) => store.setPreferredAccountId)
  const isImageMode = mode === 'image-note'
  const showPreview = isImageMode && phase === 'preview'
  const previewTaskIds = useMemo(() => previewTasks.map((task) => task.id), [previewTasks])
  const previewTaskIdsKey = previewTaskIds.join('::')
  const allPreviewSelected =
    previewTaskIds.length > 0 &&
    previewTaskIds.every((taskId) => selectedPreviewTaskIds.includes(taskId))
  const activePreviewTask =
    showPreview && activePreviewTaskId
      ? (previewTasks.find((task) => task.id === activePreviewTaskId) ?? null)
      : null

  useEffect(() => {
    if (!showPreview) {
      setSelectedPreviewTaskIds([])
      setIsDispatchSettingsOpen(false)
      return
    }

    setSelectedPreviewTaskIds((current) =>
      current.filter((taskId) => previewTaskIds.includes(taskId))
    )
  }, [previewTaskIds, previewTaskIdsKey, showPreview])

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
    return (
      <div className="pointer-events-none absolute right-6 top-6 z-40">
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-[0_16px_40px_rgba(15,23,42,0.08)] transition hover:border-zinc-300 hover:text-zinc-950"
          aria-label="展开创作中心"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </div>
    )
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

  return (
    <div className="pointer-events-none absolute right-0 top-0 bottom-0 z-40 flex w-[352px] max-w-[calc(100%-1.5rem)] justify-end">
      <aside className="pointer-events-auto flex h-full w-full flex-col border-l border-zinc-200 bg-[linear-gradient(180deg,rgb(255,255,255),rgb(248,250,252))] shadow-[-18px_0_48px_rgba(15,23,42,0.08)]">
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

        {mode === 'video-note' ? <VideoModePlaceholder /> : null}

        {isImageMode ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            {phase === 'editing' ? (
              <div className="pt-4">
                <MaterialStrip
                  materials={materials}
                  onAddMaterials={onAddMaterials}
                  onRemove={onRemoveMaterial}
                />
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pt-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {showPreview ? (
                <div className="space-y-3 py-2">
                  <div className="flex items-center justify-between px-3">
                    <div className="text-[11px] tracking-[0.04em] text-zinc-400">生成预览</div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={openDispatchSettings}
                        disabled={selectedPreviewTaskIds.length === 0}
                        className={cn(
                          'inline-flex items-center gap-1 text-[11px] tracking-[0.04em] transition',
                          selectedPreviewTaskIds.length > 0
                            ? 'text-zinc-400 hover:text-zinc-700'
                            : 'cursor-not-allowed text-zinc-300'
                        )}
                      >
                        分发设置
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPreviewTaskIds(allPreviewSelected ? [] : previewTaskIds)
                        }}
                        className="text-[11px] tracking-[0.04em] text-zinc-400 transition hover:text-zinc-700"
                      >
                        {allPreviewSelected ? '取消全选' : '全选'}
                      </button>
                    </div>
                  </div>
                  {previewTasks.map((task) => (
                    <PreviewNoteCard
                      key={task.id}
                      task={task}
                      onOpen={() => setActivePreviewTaskId(task.id)}
                      onTaskChange={(patch) => updatePreviewTask(task.id, patch)}
                      selected={selectedPreviewTaskIds.includes(task.id)}
                      onToggleSelect={() => {
                        setSelectedPreviewTaskIds((current) =>
                          current.includes(task.id)
                            ? current.filter((taskId) => taskId !== task.id)
                            : [...current, task.id]
                        )
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[180px] items-end justify-center">
                  <div className="text-[12px] text-zinc-300"> </div>
                </div>
              )}
            </div>

            <div className="mt-auto p-0">
              {phase === 'editing' ? (
                <div className="space-y-2">
                  <div className="px-1 text-[11px] tracking-[0.04em] text-zinc-400">图文笔记</div>
                  <div className="rounded-[5px] border border-zinc-200 bg-white px-3 py-3">
                    <Textarea
                      value={csvDraft}
                      onChange={(event) => onCsvChange(event.target.value)}
                      placeholder="输入 CSV 格式文案"
                      className="min-h-[88px] resize-none border-0 bg-transparent px-0 py-0 text-[12px] leading-6 text-zinc-900 placeholder:text-zinc-400 shadow-none focus-visible:ring-0"
                    />

                    <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
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
                          onClick={onGenerate}
                          disabled={isGenerating}
                          className="h-6 rounded-none border border-zinc-200 bg-zinc-50 px-3 text-[11px] font-medium text-zinc-700 shadow-none transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-60"
                        >
                          {isGenerating ? '生成中' : '生成笔记'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setActivePreviewTaskId(null)
                      onRegenerate()
                    }}
                    className="h-7 rounded-none border border-zinc-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,248,250,0.92))] px-3 text-[11px] font-medium tracking-[0.02em] text-zinc-700 shadow-[0_10px_24px_rgba(15,23,42,0.03)] transition hover:border-sky-200 hover:text-zinc-950 hover:shadow-[0_14px_28px_rgba(56,189,248,0.08)]"
                  >
                    重新生成
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onDispatch(selectedPreviewTaskIds)}
                    className="h-7 rounded-none border border-sky-100 bg-[linear-gradient(180deg,rgba(255,255,255,1),rgba(240,249,255,0.95))] px-3 text-[11px] font-medium tracking-[0.02em] text-zinc-800 shadow-[0_12px_28px_rgba(56,189,248,0.08)] transition hover:border-sky-200 hover:text-zinc-950 hover:shadow-[0_16px_34px_rgba(56,189,248,0.12)]"
                  >
                    派发到发布工作台
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </aside>

      {activePreviewTask ? (
        <PreviewEditorModal
          task={activePreviewTask}
          onClose={() => setActivePreviewTaskId(null)}
          onImagesChange={(nextImages) => updatePreviewTaskImages(activePreviewTask.id, nextImages)}
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
