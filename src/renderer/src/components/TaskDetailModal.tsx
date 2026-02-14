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
import { ImagePlus, Layers, Save, Sparkles, Trash2, Video, X } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'
import { SortableImage } from '@renderer/components/ui/SortableImage'

type TaskDetailModalProps = {
  isOpen: boolean
  onClose: () => void
  task: CmsPublishTask | null
  workspacePath?: string
  onTaskUpdated?: (task: CmsPublishTask) => void
}

function formatStatus(status: CmsPublishTaskStatus): { label: string; className: string } {
  if (status === 'published') return { label: '已发布', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' }
  if (status === 'processing') return { label: '处理中', className: 'border-sky-500/20 bg-sky-500/10 text-sky-300' }
  if (status === 'scheduled') return { label: '已排期', className: 'border-purple-500/20 bg-purple-500/10 text-purple-300' }
  if (status === 'publish_failed' || status === 'failed')
    return { label: '失败', className: 'border-red-500/20 bg-red-500/10 text-red-300' }
  return { label: '待处理', className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200' }
}

function TaskDetailModal({ isOpen, onClose, task, workspacePath, onTaskUpdated }: TaskDetailModalProps): React.JSX.Element | null {
  const deleteTasks = useCmsStore((s) => s.deleteTasks)
  const [activeIndex, setActiveIndex] = useState(0)
  const [mainLoaded, setMainLoaded] = useState(false)
  const [thumbLoaded, setThumbLoaded] = useState<Set<number>>(() => new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // ----- 编辑状态 -----
  const isEditable = task?.status === 'pending' || task?.status === 'scheduled'
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftImages, setDraftImages] = useState<string[]>([])
  const [draftProductId, setDraftProductId] = useState('')
  const [draftProductName, setDraftProductName] = useState('')
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
    setDraftProductId(task.productId || '')
    setDraftProductName(task.productName || '')
  }, [isOpen, task])

  // 重置 initializedRef 当弹窗关闭
  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = null
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
    return () => { canceled = true }
  }, [isOpen, task?.accountId, isEditable, task])

  const isDirty = useMemo(() => {
    if (!task || !isEditable) return false
    if (draftTitle !== (task.title || '')) return true
    if (draftContent !== (task.content || '')) return true
    if (draftProductId !== (task.productId || '')) return true
    const origImages = Array.isArray(task.images) ? task.images : []
    if (draftImages.length !== origImages.length) return true
    for (let i = 0; i < draftImages.length; i++) {
      if (draftImages[i] !== origImages[i]) return true
    }
    return false
  }, [task, isEditable, draftTitle, draftContent, draftImages, draftProductId])

  // DnD 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // 使用 draftImages (可编辑) 或 task.images (只读)
  const displayImages = isEditable ? draftImages : (Array.isArray(task?.images) ? task!.images : [])
  const resolvedImages = useMemo(() => displayImages.map((p) => resolveLocalImage(p, workspacePath)), [displayImages, workspacePath])
  const safeActiveIndex = Math.min(Math.max(0, activeIndex), Math.max(0, resolvedImages.length - 1))
  const activeSrc = resolvedImages[safeActiveIndex] ?? ''
  const isVideo = task?.mediaType === 'video'
  const activePosterSrc = resolvedImages[safeActiveIndex] ?? resolvedImages[0] ?? ''
  const videoSrc = useMemo(() => {
    const raw = task?.videoPreviewPath ? String(task.videoPreviewPath) : task?.videoPath ? String(task.videoPath) : ''
    return raw ? resolveLocalImage(raw, workspacePath) : ''
  }, [task?.videoPath, task?.videoPreviewPath, workspacePath])

  useEffect(() => {
    if (!isOpen) return
    setActiveIndex(0)
    setMainLoaded(false)
    setThumbLoaded(new Set())
  }, [isOpen, task?.id])

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
        guardedClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isOpen, guardedClose])

  if (!isOpen || !task) return null

  const isRemix = Boolean(task.tags?.includes('remix') || task.tags?.includes('裂变'))
  const status = formatStatus(task.status)
  const scheduledAtText =
    typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt)
      ? moment(task.scheduledAt).format('YYYY-MM-DD HH:mm')
      : '—'
  const createdAtText =
    typeof task.createdAt === 'number' && Number.isFinite(task.createdAt)
      ? moment(task.createdAt).format('YYYY-MM-DD HH:mm')
      : '—'

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
      const result = await window.electronAPI.openMediaFiles({ multiSelections: true, accept: 'image' })
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

  const handleProductChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const pid = e.target.value
    setDraftProductId(pid)
    const matched = products.find((p) => p.id === pid)
    setDraftProductName(matched ? matched.name : '')
  }

  const handleSave = async (): Promise<void> => {
    if (isSaving || !isDirty) return
    setIsSaving(true)
    try {
      const updates: Record<string, unknown> = {
        title: draftTitle,
        content: draftContent,
        images: draftImages,
        productId: draftProductId,
        productName: draftProductName
      }
      const result = await window.api.cms.task.updateBatch([task.id], updates as never)
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
      await deleteTasks([task.id])
      onClose()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      window.alert(`删除失败：${msg}`)
    } finally {
      setIsDeleting(false)
    }
  }

  // ----- 渲染 -----
  return createPortal(
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
                videoSrc ? (
                  <video
                    key={videoSrc}
                    controls
                    preload="metadata"
                    src={videoSrc}
                    poster={activePosterSrc || undefined}
                    className="h-full w-full object-contain"
                    onLoadedData={() => setMainLoaded(true)}
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
                  className={cn('h-full w-full object-contain transition-opacity', mainLoaded ? 'opacity-100' : 'opacity-0')}
                  onLoad={() => setMainLoaded(true)}
                />
              ) : (
                <div className="h-full w-full bg-zinc-900" />
              )}
              {!mainLoaded && (isVideo ? videoSrc : activeSrc) ? <div className="absolute inset-0 animate-pulse bg-zinc-900/40" /> : null}
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
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={draftImages} strategy={rectSortingStrategy}>
                    <div className="flex flex-wrap gap-2">
                      {draftImages.map((imgPath, index) => (
                        <SortableImage
                          key={imgPath}
                          id={imgPath}
                          src={resolveLocalImage(imgPath, workspacePath)}
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
            ) : resolvedImages.length > 1 ? (
              <div className="mt-3 grid grid-cols-6 gap-2">
                {resolvedImages.map((src, index) => (
                  <button
                    key={`${src}-${index}`}
                    type="button"
                    className={cn(
                      'relative aspect-square overflow-hidden rounded-lg border bg-zinc-950',
                      index === safeActiveIndex ? 'border-purple-500/60 ring-2 ring-purple-400/20' : 'border-zinc-800'
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
                    {!thumbLoaded.has(index) ? <div className="absolute inset-0 animate-pulse bg-zinc-900/40" /> : null}
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
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-lg font-bold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
                      placeholder="标题"
                    />
                  ) : (
                    <h2 className="text-lg font-bold text-zinc-100 break-words whitespace-normal">{task.title || '(未命名)'}</h2>
                  )}
                  <div className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', status.className)}>
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
                  {/* 商品：可编辑时用下拉，只读时用文本 */}
                  {isEditable ? (
                    <div className="flex items-center gap-1">
                      <span className="shrink-0">商品：</span>
                      <select
                        value={draftProductId}
                        onChange={handleProductChange}
                        className="h-7 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50"
                      >
                        <option value="">无商品链接</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : task.productName ? (
                    <div>
                      商品：<span className="text-zinc-200">{task.productName}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex-1">
                <div className="mb-2 text-xs font-semibold text-zinc-300">正文</div>
                <textarea
                  readOnly={!isEditable}
                  value={isEditable ? draftContent : (task.content || '')}
                  onChange={isEditable ? (e) => setDraftContent(e.target.value) : undefined}
                  className={cn(
                    'h-[260px] w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                    isEditable && 'focus-visible:ring-purple-500/50'
                  )}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {isEditable && isDirty ? (
                  <button
                    type="button"
                    className={cn(
                      'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 text-sm text-purple-200 transition hover:bg-purple-500/20',
                      isSaving && 'pointer-events-none opacity-60'
                    )}
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
  )
}

export { TaskDetailModal }
