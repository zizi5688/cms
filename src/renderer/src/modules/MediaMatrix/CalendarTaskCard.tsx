import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import moment from 'moment'
import { useDrag } from 'react-dnd'
import { Layers, Sparkles, Video, X } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'

import { calendarDndTypes, type ScheduledTaskDragItem } from './calendarDnd'

type CalendarTaskCardProps = {
  task: CmsPublishTask
  workspacePath: string
  compact?: boolean
  isSelected?: boolean
  onUnschedule: (task: CmsPublishTask) => void | Promise<void>
  onChangeScheduledAt: (task: CmsPublishTask, nextScheduledAt: number) => void | Promise<void>
}

function CalendarTaskCard({
  task,
  workspacePath,
  compact = false,
  isSelected,
  onUnschedule,
  onChangeScheduledAt
}: CalendarTaskCardProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isEditingTime, setIsEditingTime] = useState(false)
  const [draftTime, setDraftTime] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isPublished = task.status === 'published'
  const isFailed = task.status === 'failed' || task.status === 'publish_failed'
  const canDrag = !isPublished
  const isRemix = Boolean(
    task.transformPolicy === 'remix_v1' || task.tags?.includes('remix') || task.tags?.includes('裂变')
  )

  const scheduledAtDate = useMemo(() => {
    return typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt)
      ? new Date(task.scheduledAt)
      : null
  }, [task.scheduledAt])

  const displayAtDate = useMemo(() => {
    const displayTime = task.status === 'published' ? task.publishedAt : task.scheduledAt
    if (task.status === 'published') {
      const iso = typeof displayTime === 'string' ? displayTime.trim() : ''
      const parsed = iso ? Date.parse(iso) : Number.NaN
      return Number.isFinite(parsed) ? new Date(parsed) : null
    }
    return typeof displayTime === 'number' && Number.isFinite(displayTime) ? new Date(displayTime) : null
  }, [task.publishedAt, task.scheduledAt, task.status])

  const timeText = useMemo(() => {
    if (!displayAtDate) return isPublished ? '已发 --:--' : '--:--'
    const formatted = moment(displayAtDate).format('HH:mm')
    return isPublished ? `已发 ${formatted}` : formatted
  }, [displayAtDate, isPublished])

  const isExpired = useMemo(() => {
    if (isPublished) return false
    if (!scheduledAtDate) return false
    return moment(scheduledAtDate).isBefore(moment())
  }, [isPublished, scheduledAtDate])

  const [{ isDragging }, dragRef] = useDrag<
    ScheduledTaskDragItem,
    unknown,
    { isDragging: boolean }
  >(
    () => ({
      type: calendarDndTypes.SCHEDULED_TASK,
      canDrag: () => canDrag,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
      item: () => ({ type: calendarDndTypes.SCHEDULED_TASK, task })
    }),
    [canDrag, task]
  )

  useEffect(() => {
    dragRef(cardRef)
  }, [dragRef])

  useEffect(() => {
    if (!isEditingTime) return
    const handle = window.setTimeout(() => {
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(handle)
  }, [isEditingTime])

  const cover = task.images?.[0]
  const resolvedCover = cover ? resolveLocalImage(cover, workspacePath) : null
  const imageCount = Array.isArray(task.images) ? task.images.length : 0
  const titleText = task.title || '(未命名)'
  const displayTitle = isPublished ? `✅ ${titleText}` : isFailed ? `❌ ${titleText}` : titleText
  const errorText = (task.errorMsg || task.errorMessage || '').trim()
  const tooltipText = isFailed && errorText ? errorText : titleText
  const isVideo = task.mediaType === 'video'

  const commitTime = async (nextTime: string): Promise<void> => {
    if (!scheduledAtDate) return
    const normalized = String(nextTime ?? '').trim()
    const match = /^(\d{2}):(\d{2})$/.exec(normalized)
    if (!match) {
      window.alert('时间格式不正确，请输入 HH:mm')
      return
    }
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (
      !Number.isFinite(hour) ||
      !Number.isFinite(minute) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      window.alert('时间范围不正确')
      return
    }

    const next = new Date(scheduledAtDate)
    next.setHours(hour, minute, 0, 0)
    const nextMs = next.getTime()
    if (nextMs === scheduledAtDate.getTime()) {
      setIsEditingTime(false)
      return
    }

    if (isSaving) return
    setIsSaving(true)
    try {
      await onChangeScheduledAt(task, nextMs)
    } finally {
      setIsSaving(false)
      setIsEditingTime(false)
    }
  }

  const handleUnschedule = async (): Promise<void> => {
    if (task.status === 'published') return
    if (isSaving) return
    setIsSaving(true)
    try {
      await onUnschedule(task)
    } finally {
      setIsSaving(false)
      setIsEditingTime(false)
    }
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        'group relative flex items-start rounded-md border text-xs text-zinc-100',
        compact ? 'min-h-[74px] gap-2 p-2' : 'min-h-[88px] gap-3 p-3',
        isPublished
          ? 'border-emerald-900/50 bg-emerald-950/20 opacity-75'
          : isFailed
            ? 'border-red-800 bg-red-900/45'
            : isExpired
              ? 'border-red-800 bg-red-900/40'
              : 'border-zinc-800 bg-zinc-900/40',
        canDrag
          ? isExpired
            ? 'cursor-grab hover:bg-red-900/50 active:cursor-grabbing'
            : 'cursor-grab hover:bg-zinc-900/70 active:cursor-grabbing'
          : 'cursor-default',
        isDragging && 'opacity-60',
        isSelected && 'bg-zinc-800 border-zinc-600'
      )}
      title={tooltipText}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden rounded-md bg-zinc-950',
          compact ? 'h-12 w-12' : 'h-16 w-16'
        )}
      >
        {resolvedCover ? (
          <img src={resolvedCover} className="h-full w-full object-cover" alt="" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
            {isVideo ? <Video className={cn(compact ? 'h-4 w-4' : 'h-6 w-6')} /> : null}
          </div>
        )}
        {isVideo ? (
          <div
            className={cn(
              'absolute right-1 top-1 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-semibold text-white',
              compact ? 'text-[9px]' : 'text-[10px]'
            )}
          >
            <Video className="h-3 w-3" />
            {!compact ? <span>视频</span> : null}
          </div>
        ) : null}
        {isRemix ? (
          <div
            className="absolute left-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-white shadow-sm"
            title="智能裂变"
            aria-label="智能裂变"
          >
            <Sparkles size={12} />
          </div>
        ) : null}
        {imageCount > 1 ? (
          <div className="absolute bottom-0 right-0 flex items-center gap-0.5 rounded-tl-md rounded-br-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
            <Layers size={10} />
            <span>{imageCount}</span>
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-start gap-2 pr-10">
          {isPublished ? (
            <div className="text-[11px] text-emerald-200/70">{timeText}</div>
          ) : isEditingTime ? (
            <input
              ref={inputRef}
              type="time"
              value={draftTime}
              autoFocus
              disabled={isSaving}
              className="h-6 w-[88px] rounded border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50"
              onChange={(e) => setDraftTime(e.target.value)}
              onBlur={() => void commitTime(draftTime)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commitTime(draftTime)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setIsEditingTime(false)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={cn(
                'text-[11px] hover:text-zinc-300',
                isExpired ? 'text-red-300 hover:text-red-200' : 'text-zinc-500'
              )}
              onClick={() => {
                setDraftTime(timeText === '--:--' ? '10:00' : timeText)
                setIsEditingTime(true)
              }}
            >
              {isExpired ? `⚠️ ${timeText}` : timeText}
            </button>
          )}
        </div>

        <div
          className={cn(
            'mt-1 min-w-0 font-semibold text-zinc-100 break-words whitespace-normal overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical]',
            compact ? 'text-[11px] [-webkit-line-clamp:1]' : '[-webkit-line-clamp:2]'
          )}
        >
          {displayTitle}
        </div>

        {!compact ? (
          <div
            className={cn(
              'mt-1 truncate text-[11px]',
              isPublished ? 'text-emerald-200/50' : 'text-zinc-500'
            )}
          >
            {task.productName || '未绑定商品'}
          </div>
        ) : null}
      </div>

      {task.status !== 'published' ? (
        <button
          type="button"
          onClick={() => void handleUnschedule()}
          disabled={isSaving}
          className={cn(
            'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 opacity-0 transition hover:bg-zinc-800/60 hover:text-zinc-100 group-hover:opacity-100',
            isSaving && 'pointer-events-none opacity-40'
          )}
          aria-label="撤回至待排期池"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

export { CalendarTaskCard }
