import type * as React from 'react'
import { useEffect, useRef } from 'react'

import { Layers, Sparkles, Trash2, Video } from 'lucide-react'
import { useDrag } from 'react-dnd'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { type UnscheduledTaskDragItem, calendarDndTypes } from '@renderer/modules/MediaMatrix/calendarDnd'

function PendingTaskCard({
  task,
  workspacePath,
  isSelected,
  isFlashing,
  isGroupDragging,
  selectedCount,
  selectedTaskIds,
  orderedSelectedTasks,
  onDraggingChange,
  onDraggingBatchIdsChange,
  onBeforeDragUnselected,
  onSelect,
  onDelete
}: {
  task: CmsPublishTask
  workspacePath: string
  isSelected: boolean
  isFlashing: boolean
  isGroupDragging: boolean
  selectedCount: number
  selectedTaskIds: string[]
  orderedSelectedTasks: CmsPublishTask[]
  onDraggingChange: (task: CmsPublishTask | null) => void
  onDraggingBatchIdsChange: (ids: string[]) => void
  onBeforeDragUnselected: (taskId: string) => void
  onSelect: (event: React.MouseEvent<HTMLDivElement>, taskId: string) => void
  onDelete: (task: CmsPublishTask) => void | Promise<void>
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const cover = task.images?.[0]
  const resolvedCover = cover ? resolveLocalImage(cover, workspacePath) : null
  const imageCount = Array.isArray(task.images) ? task.images.length : 0
  const isRemix = Boolean(task.tags?.includes('remix') || task.tags?.includes('裂变'))
  const isVideo = task.mediaType === 'video'

  const [{ isDragging }, dragRef] = useDrag<
    UnscheduledTaskDragItem,
    unknown,
    { isDragging: boolean }
  >(
    () => ({
      type: calendarDndTypes.UNSCHEDULED_TASK,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
      item: () => {
        const isMultiDrag = selectedTaskIds.includes(task.id)
        const batchTasks = isMultiDrag ? orderedSelectedTasks : [task]
        const batchIds = batchTasks.map((t) => t.id)
        if (!isMultiDrag) onBeforeDragUnselected(task.id)
        onDraggingChange(task)
        onDraggingBatchIdsChange(batchIds)
        return { type: calendarDndTypes.UNSCHEDULED_TASK, task, batchIds, batchTasks }
      },
      end: () => {
        onDraggingChange(null)
        onDraggingBatchIdsChange([])
      }
    }),
    [onBeforeDragUnselected, onDraggingBatchIdsChange, onDraggingChange, orderedSelectedTasks, selectedTaskIds, task]
  )

  useEffect(() => {
    dragRef(cardRef)
  }, [dragRef])

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative flex min-h-[88px] cursor-grab items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-100',
        'hover:bg-zinc-900/70 active:cursor-grabbing',
        isDragging && 'opacity-60',
        isSelected && 'bg-zinc-800 border-zinc-600',
        isFlashing && 'border-amber-500/70 bg-amber-500/10 ring-2 ring-amber-400/30 animate-pulse',
        isGroupDragging && 'opacity-60'
      )}
      title={task.title}
      onClick={(e) => onSelect(e, task.id)}
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-zinc-950">
        {resolvedCover ? (
          <img src={resolvedCover} className="h-full w-full object-cover" alt="" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
            {isVideo ? <Video className="h-6 w-6" /> : null}
          </div>
        )}
        {isVideo ? (
          <div className="absolute left-0 top-0 inline-flex items-center gap-1 rounded-br-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <Video className="h-3 w-3" />
            <span>视频</span>
          </div>
        ) : null}
        {imageCount > 1 ? (
          <div className="absolute bottom-0 right-0 flex items-center gap-0.5 rounded-tl-md rounded-br-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            <Layers size={10} />
            <span>{imageCount}</span>
          </div>
        ) : null}
        {isSelected && selectedCount > 1 ? (
          <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 px-1 text-[10px] font-semibold text-zinc-100">
            {selectedCount}
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {isRemix ? (
          <div className="mb-1 flex min-w-0 items-center">
            <div
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-white shadow-sm"
              title="智能裂变"
              aria-label="智能裂变"
            >
              <Sparkles size={12} />
            </div>
          </div>
        ) : null}
        <div className="min-w-0 font-semibold text-zinc-100 break-words whitespace-normal overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
          {task.title || '(未命名)'}
        </div>
        <div className="mt-1 truncate text-[11px] text-zinc-400">{task.productName || '未绑定商品'}</div>
      </div>

      <button
        type="button"
        className="absolute right-2 top-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 opacity-0 transition hover:bg-zinc-800/60 hover:text-zinc-100 group-hover:opacity-100"
        aria-label="彻底删除任务"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const confirmed = window.confirm('确定彻底删除该任务吗？')
          if (!confirmed) return
          void onDelete(task)
        }}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

export { PendingTaskCard }
