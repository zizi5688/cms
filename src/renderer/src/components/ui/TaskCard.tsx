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
  note?: string
  select?: {
    checked: boolean
    ariaLabel?: string
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
  note,
  select,
  className
}: TaskCardProps): React.JSX.Element {
  const headerLabel = index === undefined ? '任务' : `第${index + 1}组`
  const workspacePath = useCmsStore((s) => s.workspacePath)
  const updateTask = useCmsStore((s) => s.updateTask)
  const canEdit = Boolean(taskId)

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
        'flex gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2',
        className
      )}
    >
      {select ? (
        <div className="shrink-0 pt-0.5">
          <input
            type="checkbox"
            checked={select.checked}
            onChange={(e) => select.onChange(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-4 w-4"
            aria-label={select.ariaLabel ?? '选择任务'}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="shrink-0 rounded bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300">
              {headerLabel}
            </div>
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
                'min-w-0 w-full bg-transparent px-1 py-1 text-lg font-normal text-zinc-100 placeholder:text-zinc-600',
                'rounded-sm border border-transparent transition-colors hover:border-zinc-700 focus:border-zinc-500 focus:outline-none'
              )}
            />
          </div>
          <div className="shrink-0 text-[11px] text-zinc-500">{images.length} 图</div>
        </div>

        <Textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          onBlur={commit}
          placeholder="（无正文）"
          rows={5}
          readOnly={!canEdit}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'h-[150px] resize-none bg-transparent px-1 py-1 text-sm font-normal text-zinc-300',
            'border-transparent hover:border-zinc-700 focus:border-zinc-500 focus-visible:ring-0'
          )}
        />

        {images.length === 0 ? (
          <div className="text-xs text-zinc-500">未分配图片</div>
        ) : canEdit && taskId ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={images} strategy={rectSortingStrategy}>
              <div
                className="flex flex-wrap gap-2"
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
          <div className="flex flex-wrap gap-2">
            {images.map((imagePath, idx) => (
              <div
                key={`${imagePath}-${idx}`}
                className="relative h-20 w-20 overflow-hidden rounded-md border border-zinc-800"
              >
                {idx === 0 ? (
                  <div className="absolute left-0 top-0 z-10 rounded-br bg-red-500 px-1.5 py-0.5 text-xs text-white">
                    封面
                  </div>
                ) : null}
                <img
                  src={resolveLocalImage(imagePath, workspacePath)}
                  alt={fileNameFromPath(imagePath)}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}

        {note ? <div className="truncate text-[11px] text-amber-300">{note}</div> : null}
      </div>
    </div>
  )
})

export { TaskCard }
