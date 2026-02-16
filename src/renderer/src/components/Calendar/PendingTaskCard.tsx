import type * as React from 'react'
import { useEffect, useRef } from 'react'

import { Layers, Sparkles, Trash2, Video } from 'lucide-react'
import { useDrag } from 'react-dnd'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { type UnscheduledTaskDragItem, calendarDndTypes } from '@renderer/modules/MediaMatrix/calendarDnd'
import type { TitleLengthIssue } from '@renderer/modules/MediaMatrix/titleLengthGuard'

function PendingTaskCard({
  task,
  workspacePath,
  isSelected,
  isFlashing,
  isGroupDragging,
  selectedCount,
  selectedTaskIds,
  orderedSelectedTasks,
  titleLengthIssue,
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
  titleLengthIssue?: TitleLengthIssue | null
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
  const isFailed = task.status === 'failed' || task.status === 'publish_failed'
  const errorText = (task.errorMsg || task.errorMessage || '').trim()
  const hasTitleLengthIssue = Boolean(titleLengthIssue)
  const canDrag = !hasTitleLengthIssue
  const tooltipText = isFailed && errorText
    ? errorText
    : hasTitleLengthIssue
      ? `标题超 ${titleLengthIssue?.limit ?? 20}（${titleLengthIssue?.count ?? 0}/${titleLengthIssue?.limit ?? 20}），请先修改后再排期`
      : task.title

  const [{ isDragging }, dragRef] = useDrag<
    UnscheduledTaskDragItem,
    unknown,
    { isDragging: boolean }
  >(
    () => ({
      type: calendarDndTypes.UNSCHEDULED_TASK,
      canDrag,
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
    [canDrag, onBeforeDragUnselected, onDraggingBatchIdsChange, onDraggingChange, orderedSelectedTasks, selectedTaskIds, task]
  )

  useEffect(() => {
    dragRef(cardRef)
  }, [dragRef])

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative flex min-h-[88px] items-start gap-3 rounded-md border p-3 text-xs text-zinc-100',
        isFailed
          ? 'border-red-700/60 bg-red-950/35 hover:bg-red-950/45'
          : hasTitleLengthIssue
            ? 'border-rose-600/70 bg-rose-950/30 hover:bg-rose-950/40'
          : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70',
        canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed',
        isDragging && 'opacity-60',
        isSelected && 'bg-zinc-800 border-zinc-600',
        isFlashing && 'border-amber-500/70 bg-amber-500/10 ring-2 ring-amber-400/30 animate-pulse',
        isGroupDragging && 'opacity-60'
      )}
      title={tooltipText}
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
        {isFailed ? (
          <div className="mb-1 inline-flex w-fit items-center rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-200">
            自动重试失败
          </div>
        ) : null}
        {hasTitleLengthIssue ? (
          <div className="mb-1 inline-flex w-fit items-center rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
            标题超 20（{titleLengthIssue?.count ?? 0}/20）
          </div>
        ) : null}
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
          {isFailed ? `❌ ${task.title || '(未命名)'}` : task.title || '(未命名)'}
        </div>
        {isFailed && errorText ? (
          <div className="mt-1 text-[11px] leading-4 text-red-300 break-all whitespace-pre-wrap overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
            {errorText}
          </div>
        ) : null}
        {hasTitleLengthIssue ? (
          <div className="mt-1 truncate text-[11px] text-rose-300">请先将标题改到 20 字符以内再排期</div>
        ) : null}
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
