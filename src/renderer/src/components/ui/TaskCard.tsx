import * as React from 'react'

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
import { Film, GripVertical, ImageIcon } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { Textarea } from '@renderer/components/ui/textarea'
import { SortableImage } from '@renderer/components/ui/SortableImage'
import { useCmsStore } from '@renderer/store/useCmsStore'

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

export interface TaskCardProps {
  index?: number
  taskId?: string
  title: string
  body: string
  images: string[]
  mediaType?: 'image' | 'video'
  videoPath?: string
  note?: string
  select?: {
    checked: boolean
    ariaLabel?: string
    disabled?: boolean
    onChange: (checked: boolean) => void
  }
  className?: string
}

const TaskCard = React.memo(function TaskCard({
  index,
  taskId,
  title,
  body,
  images,
  mediaType,
  videoPath,
  note,
  select,
  className
}: TaskCardProps): React.JSX.Element {
  const headerLabel = index === undefined ? '任务' : `第${index + 1}组`
  const workspacePath = useCmsStore((s) => s.workspacePath)
  const updateTask = useCmsStore((s) => s.updateTask)
  const canEdit = Boolean(taskId)
  const normalizedVideoPath = typeof videoPath === 'string' ? videoPath.trim() : ''
  const isVideoTask = mediaType === 'video' && Boolean(normalizedVideoPath)
  const coverPreviewPath = images[0] ?? ''
  const coverPreviewSrc = coverPreviewPath ? resolveLocalImage(coverPreviewPath, workspacePath) : ''

  const [draftTitle, setDraftTitle] = React.useState(title)
  const [draftBody, setDraftBody] = React.useState(body)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  React.useEffect(() => {
    setDraftTitle(title)
  }, [title])

  React.useEffect(() => {
    setDraftBody(body)
  }, [body])

  const handleDragEnd = (event: DragEndEvent): void => {
    if (!canEdit || !taskId) return

    const { active, over } = event
    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)
    if (activeId === overId) return

    const oldIndex = images.indexOf(activeId)
    const newIndex = images.indexOf(overId)
    if (oldIndex === -1 || newIndex === -1) return

    const nextImages = arrayMove(images, oldIndex, newIndex)
    updateTask(taskId, { assignedImages: nextImages })
  }

  const handleRemoveImage = (removeIndex: number): void => {
    if (!canEdit || !taskId) return
    const nextImages = images.filter((_, idx) => idx !== removeIndex)
    updateTask(taskId, { assignedImages: nextImages })
  }

  const commit = (): void => {
    if (!canEdit || !taskId) return

    const nextTitle = draftTitle
    const nextBody = draftBody
    if (nextTitle === title && nextBody === body) return
    updateTask(taskId, { title: nextTitle, body: nextBody })
  }

  return (
    <div
      className={cn(
        'w-full min-w-[760px] overflow-hidden rounded-[24px] border border-zinc-800/80 bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(9,9,11,0.98))] p-3 shadow-[0_20px_60px_-42px_rgba(0,0,0,0.85)]',
        className
      )}
    >
      <div className="grid grid-cols-[240px_minmax(0,1fr)] items-start gap-3">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {select ? (
                <input
                  type="checkbox"
                  checked={select.checked}
                  disabled={select.disabled}
                  onChange={(e) => select.onChange(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="h-4 w-4 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={select.ariaLabel ?? '选择任务'}
                />
              ) : null}
              <div className="rounded-full border border-zinc-700/80 bg-zinc-900/70 px-3 py-1 text-[11px] text-zinc-300">
                {headerLabel}
              </div>
            </div>
            <div className="rounded-full border border-zinc-700/80 bg-black/20 px-3 py-1 text-[11px] text-zinc-400">
              {isVideoTask ? '视频任务' : `${images.length} 图`}
            </div>
          </div>

          <div className="rounded-[24px] border border-zinc-800/80 bg-black/20 p-3">
            {isVideoTask ? (
              <>
                <div className="relative overflow-hidden rounded-[20px] border border-zinc-800/80 bg-zinc-950/80">
                  {coverPreviewSrc ? (
                    <img
                      src={coverPreviewSrc}
                      alt={fileNameFromPath(coverPreviewPath)}
                      className="aspect-[4/5] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-[4/5] items-center justify-center bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_45%),linear-gradient(180deg,rgba(24,24,27,0.9),rgba(9,9,11,0.96))] text-zinc-500">
                      <div className="flex flex-col items-center gap-2">
                        <Film className="h-8 w-8" />
                        <span className="text-xs">未设置封面图</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-3 py-2.5 text-xs text-zinc-400">
                  <div className="truncate text-sm text-zinc-100">
                    {fileNameFromPath(normalizedVideoPath)}
                  </div>
                </div>
              </>
            ) : images.length === 0 ? (
              <div className="flex min-h-[220px] items-center justify-center rounded-[20px] border border-dashed border-zinc-800 bg-zinc-950/60 text-zinc-500">
                <ImageIcon className="h-8 w-8" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-end gap-3">
                  {canEdit && taskId ? (
                    <div className="inline-flex items-center rounded-full border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-1 text-[11px] text-zinc-400">
                      <GripVertical className="h-3.5 w-3.5" />
                    </div>
                  ) : null}
                </div>

                {canEdit && taskId ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={images} strategy={rectSortingStrategy}>
                      <div
                        className="mt-3 flex flex-wrap gap-2"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        {images.map((imagePath, idx) => (
                          <SortableImage
                            key={`${imagePath}-${idx}`}
                            id={imagePath}
                            src={resolveLocalImage(imagePath, workspacePath)}
                            index={idx}
                            onRemove={() => handleRemoveImage(idx)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {images.map((imagePath, idx) => (
                      <div
                        key={`${imagePath}-${idx}`}
                        className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/80"
                      >
                        {idx === 0 ? (
                          <div className="absolute left-2 top-2 z-10 rounded-full bg-red-500 px-2 py-0.5 text-[11px] text-white">
                            封面
                          </div>
                        ) : null}
                        <img
                          src={resolveLocalImage(imagePath, workspacePath)}
                          alt={fileNameFromPath(imagePath)}
                          className="aspect-square w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {note ? (
            <div className="rounded-2xl border border-amber-400/15 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">
              {note}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-2.5">
          <div className="rounded-[22px] border border-zinc-800/80 bg-black/20 p-3.5">
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">标题</div>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commit}
              placeholder="（无标题）"
              maxLength={20}
              readOnly={!canEdit}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                'mt-2.5 min-w-0 w-full rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-4 py-2.5 text-[20px] font-medium tracking-[0.02em] text-zinc-50 placeholder:text-zinc-600',
                'transition-colors hover:border-zinc-700 focus:border-amber-400/40 focus:outline-none'
              )}
            />
          </div>

          <div className="rounded-[22px] border border-zinc-800/80 bg-black/20 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">正文</div>
            </div>
            <Textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onBlur={commit}
              placeholder="（无正文）"
              rows={6}
              readOnly={!canEdit}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn(
                'mt-2.5 h-[170px] resize-none rounded-2xl border-zinc-800/80 bg-zinc-950/70 px-4 py-2.5 text-sm leading-6 text-zinc-200',
                'hover:border-zinc-700 focus:border-amber-400/40 focus-visible:ring-0'
              )}
            />
          </div>
        </div>
      </div>
    </div>
  )
})

export { TaskCard }
