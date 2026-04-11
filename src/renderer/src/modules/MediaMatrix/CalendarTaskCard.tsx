import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import moment from 'moment'
import { useDrag, useDrop } from 'react-dnd'
import { Layers, Sparkles, Video, X } from 'lucide-react'

import { formatTaskProductSummary } from '@renderer/lib/cmsTaskProductHelpers'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'

import {
  calendarDndTypes,
  type CalendarDragItem,
  type ScheduledTaskDragItem
} from './calendarDnd'

type CalendarTaskCardProps = {
  task: CmsPublishTask
  workspacePath: string
  compact?: boolean
  isSelected?: boolean
  onUnschedule: (task: CmsPublishTask) => void | Promise<void>
  onChangeScheduledAt: (task: CmsPublishTask, nextScheduledAt: number) => void | Promise<void>
  onReorderScheduledTasks?: (
    draggedTask: CmsPublishTask,
    targetTask: CmsPublishTask,
    placement: 'before' | 'after'
  ) => void | Promise<void>
}

function formatBooleanMetric(value: boolean): string {
  return value ? 'true' : 'false'
}

function getSafetyMetricTone(isSafe: boolean): string {
  return isSafe ? '安全' : '异常'
}

function getSafetyFixSuggestion(label: string): string {
  switch (label) {
    case 'isTrusted':
      return '点击事件未被信任，检查是否回退到了 DOM dispatchEvent'
    case 'webdriver':
      return '自动化标志暴露，检查 stealth 注入和 --disable-blink-features=AutomationControlled 启动参数'
    case 'hasProcess':
      return 'Node 环境特征泄漏，检查 stealth 注入中 window.process 清理逻辑'
    case 'mouseMoveCount':
      return '鼠标轨迹不足，检查 humanMove 是否正常执行'
    case 'headless':
      return '检测到无头模式，检查 Chrome 启动参数是否误加了 --headless'
    default:
      return ''
  }
}

function getDropPlacement(
  clientOffset: { x: number; y: number } | null,
  element: HTMLElement | null
): 'before' | 'after' | null {
  if (!clientOffset || !element) return null
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.height) || rect.height <= 0) return null
  return clientOffset.y < rect.top + rect.height / 2 ? 'before' : 'after'
}

function CalendarTaskCard({
  task,
  workspacePath,
  compact = false,
  isSelected,
  onUnschedule,
  onChangeScheduledAt,
  onReorderScheduledTasks
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

  const [{ canDrop, dropPlacement, isOver }, dropRef] = useDrop<
    CalendarDragItem,
    { handled?: boolean } | void,
    {
      isOver: boolean
      canDrop: boolean
      dropPlacement: 'before' | 'after' | null
    }
  >(
    () => ({
      accept: [calendarDndTypes.SCHEDULED_TASK],
      canDrop: (item) => {
        if (!onReorderScheduledTasks) return false
        if (!item?.task || item.type !== calendarDndTypes.SCHEDULED_TASK) return false
        if (task.status === 'published' || item.task.status === 'published') return false
        if (item.task.id === task.id) return false
        if (
          typeof task.scheduledAt !== 'number' ||
          !Number.isFinite(task.scheduledAt) ||
          typeof item.task.scheduledAt !== 'number' ||
          !Number.isFinite(item.task.scheduledAt)
        ) {
          return false
        }
        return moment(item.task.scheduledAt).isSame(task.scheduledAt, 'day')
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
        dropPlacement: getDropPlacement(
          monitor.getClientOffset(),
          cardRef.current
        )
      }),
      drop: (item, monitor) => {
        if (!monitor.isOver({ shallow: true })) return
        if (item.type !== calendarDndTypes.SCHEDULED_TASK) return
        const placement = getDropPlacement(monitor.getClientOffset(), cardRef.current)
        if (!placement || !onReorderScheduledTasks) return
        void onReorderScheduledTasks(item.task, task, placement)
        return { handled: true }
      }
    }),
    [onReorderScheduledTasks, task]
  )

  useEffect(() => {
    const node = cardRef.current
    if (!node) return
    dragRef(dropRef(node))
  }, [dragRef, dropRef])

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
  const safetyCheck = isPublished ? task.safetyCheck ?? null : null
  const safetyTooltipRows = useMemo(() => {
    if (!safetyCheck) return []
    return [
      {
        label: 'isTrusted',
        value: formatBooleanMetric(safetyCheck.isTrusted),
        safe: safetyCheck.isTrusted
      },
      {
        label: 'webdriver',
        value: formatBooleanMetric(safetyCheck.webdriver),
        safe: safetyCheck.webdriver === false
      },
      {
        label: 'hasProcess',
        value: formatBooleanMetric(safetyCheck.hasProcess),
        safe: safetyCheck.hasProcess === false
      },
      {
        label: 'mouseMoveCount',
        value: String(safetyCheck.mouseMoveCount),
        safe: safetyCheck.mouseMoveCount >= 15
      },
      {
        label: 'headless',
        value: formatBooleanMetric(safetyCheck.headless),
        safe: safetyCheck.headless === false
      }
    ]
  }, [safetyCheck])
  const failedSafetyRows = useMemo(() => {
    return safetyTooltipRows
      .filter((row) => !row.safe)
      .map((row) => ({
        ...row,
        suggestion: getSafetyFixSuggestion(row.label)
      }))
  }, [safetyTooltipRows])

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
      {isOver && canDrop && dropPlacement ? (
        <div
          className={cn(
            'pointer-events-none absolute left-3 right-3 z-10 h-0.5 rounded-full bg-amber-300 shadow-[0_0_0_1px_rgba(252,211,77,0.35)]',
            dropPlacement === 'before' ? 'top-1.5' : 'bottom-1.5'
          )}
        />
      ) : null}
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
            {formatTaskProductSummary({
              linkedProducts: task.linkedProducts,
              productName: task.productName
            })}
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

      {isPublished && safetyCheck ? (
        <div className="absolute bottom-2 right-2 z-20">
          <button
            type="button"
            className={cn(
              'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.18)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
              safetyCheck.allPassed
                ? 'border-emerald-300/70 bg-emerald-400 focus-visible:ring-emerald-300'
                : 'peer border-red-300/70 bg-red-400 focus-visible:ring-red-300'
            )}
            aria-label={safetyCheck.allPassed ? '安全指标通过' : '安全指标异常'}
          >
            <span className="sr-only">{safetyCheck.allPassed ? '安全指标通过' : '安全指标异常'}</span>
          </button>
          {!safetyCheck.allPassed ? (
            <div className="pointer-events-none absolute bottom-6 right-0 z-30 w-64 rounded-lg border border-zinc-600 bg-zinc-950 p-3 text-left text-[10px] text-zinc-100 opacity-0 shadow-[0_18px_48px_rgba(0,0,0,0.7)] transition duration-150 peer-hover:opacity-100 peer-focus-visible:opacity-100">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold text-zinc-50">安全指标</span>
                <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-red-200">
                  未通过
                </span>
              </div>
              <div className="space-y-2">
                <div className="space-y-1.5">
                  {safetyTooltipRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-3">
                      <span className="text-zinc-400">{row.label}</span>
                      <span className={row.safe ? 'text-emerald-200' : 'text-red-200'}>
                        {row.value} · {getSafetyMetricTone(row.safe)}
                      </span>
                    </div>
                  ))}
                </div>
                {failedSafetyRows.length > 0 ? (
                  <div className="space-y-1.5 border-t border-zinc-800/80 pt-2">
                    {failedSafetyRows.map((row) => (
                      <div key={`${row.label}-suggestion`} className="space-y-1">
                        <div className="text-[10px] font-medium text-red-200">{row.label} 修复建议</div>
                        <div className="text-[10px] leading-relaxed text-zinc-300">{row.suggestion}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export { CalendarTaskCard }
