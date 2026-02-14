import type * as React from 'react'
import { useEffect, useMemo, useRef } from 'react'

import moment from 'moment'
import 'moment/locale/zh-cn'
import { useDrop } from 'react-dnd'

import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import { CalendarTaskCard } from './CalendarTaskCard'
import { type CalendarDragItem, calendarDndTypes } from './calendarDnd'
import { getTaskDisplayTime, getWeekDates, setDateKeepingTime, withDefaultStartTime } from './calendarUtils'

const weekMap: Record<number, string> = {
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六'
}

type KanbanWeekViewProps = {
  tasks: CmsPublishTask[]
  workspacePath: string
  baseDate: Date
  showPublished: boolean
  defaultStartTime: string
  defaultInterval: number
  onTaskDoubleClick?: (task: CmsPublishTask) => void
  onScheduleTask: (
    task: CmsPublishTask,
    scheduledAt: number,
    options?: { forcePending?: boolean }
  ) => void | Promise<void>
  onBatchScheduleTasks?: (
    updates: Array<{ id: string; scheduledAt: number }>,
    options?: { forcePending?: boolean }
  ) => void | Promise<void>
  onUnscheduleTask: (task: CmsPublishTask) => void | Promise<void>
}

function KanbanWeekView({
  tasks,
  workspacePath,
  baseDate,
  showPublished,
  defaultStartTime,
  defaultInterval,
  onTaskDoubleClick,
  onScheduleTask,
  onBatchScheduleTasks,
  onUnscheduleTask
}: KanbanWeekViewProps): React.JSX.Element {
  const days = useMemo(() => getWeekDates(baseDate), [baseDate])

  const filteredTasks = useMemo(() => {
    return showPublished ? tasks : tasks.filter((t) => t.status !== 'published')
  }, [showPublished, tasks])

  const tasksByDay = useMemo(() => {
    const dayBuckets = new Map<number, CmsPublishTask[]>()
    for (const day of days) dayBuckets.set(day.getTime(), [])

    for (const task of filteredTasks) {
      const displayAt = getTaskDisplayTime(task)
      if (displayAt == null) continue
      const scheduledMoment = moment(displayAt)
      const start = moment(baseDate).startOf('week').startOf('day')
      const end = moment(start).add(7, 'day')
      if (scheduledMoment.isBefore(start) || !scheduledMoment.isBefore(end)) continue

      const dayKey = scheduledMoment.startOf('day').toDate().getTime()
      const bucket = dayBuckets.get(dayKey)
      if (bucket) bucket.push(task)
    }

    for (const [key, bucket] of dayBuckets) {
      bucket.sort((a, b) => {
        const av = getTaskDisplayTime(a) ?? Number.POSITIVE_INFINITY
        const bv = getTaskDisplayTime(b) ?? Number.POSITIVE_INFINITY
        return av - bv
      })
      dayBuckets.set(key, bucket)
    }
    return dayBuckets
  }, [baseDate, days, filteredTasks])

  return (
    <div className="grid grid-cols-7 h-full divide-x divide-zinc-800">
      {days.map((day) => {
        const key = day.getTime()
        const bucket = tasksByDay.get(key) ?? []
        return (
          <DayColumn
            key={key}
            date={day}
            tasks={bucket}
            workspacePath={workspacePath}
            defaultStartTime={defaultStartTime}
            defaultInterval={defaultInterval}
            onTaskDoubleClick={onTaskDoubleClick}
            onScheduleTask={onScheduleTask}
            onBatchScheduleTasks={onBatchScheduleTasks}
            onUnscheduleTask={onUnscheduleTask}
          />
        )
      })}
    </div>
  )
}

function DayColumn({
  date,
  tasks,
  workspacePath,
  defaultStartTime,
  defaultInterval,
  onTaskDoubleClick,
  onScheduleTask,
  onBatchScheduleTasks,
  onUnscheduleTask
}: {
  date: Date
  tasks: CmsPublishTask[]
  workspacePath: string
  defaultStartTime: string
  defaultInterval: number
  onTaskDoubleClick?: (task: CmsPublishTask) => void
  onScheduleTask: (
    task: CmsPublishTask,
    scheduledAt: number,
    options?: { forcePending?: boolean }
  ) => void | Promise<void>
  onBatchScheduleTasks?: (
    updates: Array<{ id: string; scheduledAt: number }>,
    options?: { forcePending?: boolean }
  ) => void | Promise<void>
  onUnscheduleTask: (task: CmsPublishTask) => void | Promise<void>
}): React.JSX.Element {
  const columnRef = useRef<HTMLDivElement | null>(null)
  const selectedTaskIds = useCmsStore((s) => s.selectedPublishTaskIds)
  const setSelectedTaskIds = useCmsStore((s) => s.setSelectedPublishTaskIds)

  const isToday = moment(date).isSame(moment(), 'day')
  const isPast = moment(date).isBefore(moment(), 'day')

  const [{ isOver, canDrop }, dropRef] = useDrop<
    CalendarDragItem,
    unknown,
    { isOver: boolean; canDrop: boolean }
  >(
    () => ({
      accept: [calendarDndTypes.UNSCHEDULED_TASK, calendarDndTypes.SCHEDULED_TASK],
      canDrop: () => !isPast,
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop()
      }),
      drop: (item) => {
        if (isPast) return
        if (!item?.task) return
        if (item.type === calendarDndTypes.UNSCHEDULED_TASK) {
          const batchTasks =
            Array.isArray((item as { batchTasks?: unknown }).batchTasks) &&
            ((item as { batchTasks?: unknown }).batchTasks as unknown[]).length > 0
              ? (item as { batchTasks: CmsPublishTask[] }).batchTasks
              : [item.task]

          const now = moment()
          const catchUpInterval =
            typeof defaultInterval === 'number' && Number.isFinite(defaultInterval) && defaultInterval > 0
              ? defaultInterval
              : 30
          const slotInterval =
            typeof defaultInterval === 'number' && Number.isFinite(defaultInterval) ? Math.max(0, defaultInterval) : 0

          const computeFirstSlot = (): number => {
            if (tasks.length === 0) {
              const defaultNext = withDefaultStartTime(date, defaultStartTime).getTime()
              let next = defaultNext
              if (isToday && moment(defaultNext).isBefore(now)) {
                const bumped = now.clone().add(catchUpInterval, 'minute').seconds(0).milliseconds(0)
                const remainder = bumped.minutes() % 5
                if (remainder !== 0) bumped.add(5 - remainder, 'minute')
                next = bumped.toDate().getTime()
              }
              return next
            }

            const maxScheduledAt = tasks.reduce<number | null>((max, task) => {
              const scheduledAt =
                typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt) ? task.scheduledAt : null
              if (scheduledAt == null) return max
              return max == null ? scheduledAt : Math.max(max, scheduledAt)
            }, null)

            const base =
              maxScheduledAt != null ? new Date(maxScheduledAt) : withDefaultStartTime(date, defaultStartTime)
            const defaultNext = moment(base).add(slotInterval, 'minute').toDate().getTime()

            let next = defaultNext
            if (isToday && moment(defaultNext).isBefore(now)) {
              const bumped = now.clone().add(catchUpInterval, 'minute').seconds(0).milliseconds(0)
              const remainder = bumped.minutes() % 5
              if (remainder !== 0) bumped.add(5 - remainder, 'minute')
              next = bumped.toDate().getTime()
            }

            return next
          }

          const baseTime = computeFirstSlot()
          const updates = batchTasks.map((task, index) => ({
            id: task.id,
            scheduledAt: baseTime + index * slotInterval * 60 * 1000
          }))

          if (typeof onBatchScheduleTasks === 'function') {
            void onBatchScheduleTasks(updates, { forcePending: true })
            return
          }

          for (const [index, task] of batchTasks.entries()) {
            void onScheduleTask(task, baseTime + index * slotInterval * 60 * 1000, { forcePending: true })
          }
          return
        }

        if (item.type === calendarDndTypes.SCHEDULED_TASK) {
          const currentScheduledAt =
            typeof item.task.scheduledAt === 'number' && Number.isFinite(item.task.scheduledAt)
              ? new Date(item.task.scheduledAt)
              : null
          if (!currentScheduledAt) return
          let next = setDateKeepingTime(date, currentScheduledAt).getTime()

          const now = moment()
          if (moment(next).isBefore(now)) {
            const maxScheduledAt = tasks.reduce<number | null>((max, t) => {
              const sat =
                typeof t.scheduledAt === 'number' && Number.isFinite(t.scheduledAt)
                  ? t.scheduledAt
                  : null
              if (sat == null) return max
              return max == null ? sat : Math.max(max, sat)
            }, null)

            if (maxScheduledAt != null && moment(maxScheduledAt).isAfter(now)) {
              next = moment(maxScheduledAt).add(defaultInterval, 'minute').toDate().getTime()
            } else {
              const bumped = now.clone().add(10, 'minute')
              const remainder = bumped.minutes() % 5
              if (remainder !== 0) bumped.add(5 - remainder, 'minute')
              next = bumped.toDate().getTime()
            }
          }

          void onScheduleTask(item.task, next)
        }
      }
    }),
    [date, defaultInterval, defaultStartTime, isPast, onBatchScheduleTasks, onScheduleTask, tasks]
  )

  useEffect(() => {
    dropRef(columnRef)
  }, [dropRef])

  const headerText = `${weekMap[date.getDay()] ?? '周'} ${moment(date).format('M/DD')}`
  const isActive = isOver && canDrop
  const isBlocked = isOver && !canDrop
  const handleSelect = (event: React.MouseEvent, taskId: string): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest('button, input, textarea, select')) return
    event.stopPropagation()
    const isToggle = Boolean((event as React.MouseEvent).metaKey || (event as React.MouseEvent).ctrlKey)
    if (isToggle) {
      if (selectedTaskIds.includes(taskId)) {
        setSelectedTaskIds(selectedTaskIds.filter((id) => id !== taskId))
      } else {
        setSelectedTaskIds([...selectedTaskIds, taskId])
      }
      return
    }
    if (!selectedTaskIds.includes(taskId) || selectedTaskIds.length !== 1) setSelectedTaskIds([taskId])
  }

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col transition-colors duration-200',
        isToday && 'bg-white/[0.02]'
      )}
    >
      <div
        className={cn(
          'border-b border-zinc-800 px-2 py-2 text-xs font-semibold',
          isToday ? 'text-purple-400 font-bold' : 'text-zinc-400'
        )}
      >
        {headerText}
      </div>
      <div
        ref={columnRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 p-2 overflow-y-auto',
          isActive && 'bg-zinc-900/20',
          isBlocked && 'cursor-not-allowed bg-zinc-900/5'
        )}
      >
        {tasks.map((task) => (
          <div
            key={task.id}
            className="contents"
            onClick={(e) => handleSelect(e, task.id)}
            onDoubleClick={() => onTaskDoubleClick?.(task)}
          >
            <CalendarTaskCard
              task={task}
              workspacePath={workspacePath}
              isSelected={selectedTaskIds.includes(task.id)}
              onUnschedule={onUnscheduleTask}
              onChangeScheduledAt={(t, nextScheduledAt) => onScheduleTask(t, nextScheduledAt)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export { KanbanWeekView }
