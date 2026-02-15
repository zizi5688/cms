import { useEffect, useMemo, useState } from 'react'

import moment from 'moment'
import 'moment/locale/zh-cn'
import { Video } from 'lucide-react'
import {
  Calendar as ReactBigCalendar,
  momentLocalizer,
  type EventProps as ReactBigCalendarEventProps,
  type Formats,
  type Messages,
  type stringOrDate
} from 'react-big-calendar'
import withDragAndDrop, {
  type DragFromOutsideItemArgs,
  type EventInteractionArgs
} from 'react-big-calendar/lib/addons/dragAndDrop'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'

import { PendingTaskCard } from '@renderer/components/Calendar/PendingTaskCard'
import { TaskDetailModal } from '@renderer/components/TaskDetailModal'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import './react-big-calendar.dark.css'

import { CalendarHeader } from './CalendarHeader'
import { KanbanWeekView } from './KanbanWeekView'
import { getTaskDisplayTime, setDateKeepingTime, withDefaultStartTime } from './calendarUtils'
import { buildSurpriseRemix } from './surpriseRemix'
import {
  PENDING_POOL_TITLE_LIMIT,
  getTitleLengthIssue,
  type TitleLengthIssue
} from './titleLengthGuard'

type CalendarViewProps = {
  tasks: CmsPublishTask[]
  workspacePath: string
  onTasksUpdated: (updated: CmsPublishTask[]) => void
  onTasksDeleted: (deletedIds: string[]) => void
  onTasksCreated?: (created: CmsPublishTask[]) => void
}

type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  resource: CmsPublishTask
}

moment.locale('zh-cn')

const localizer = momentLocalizer(moment)
const DragAndDropCalendar = withDragAndDrop<CalendarEvent, object>(ReactBigCalendar)

const messages: Messages = {
  today: '今天',
  previous: '上周',
  next: '下周',
  month: '月',
  week: '周',
  day: '日',
  agenda: '议程',
  date: '日期',
  time: '时间',
  event: '任务',
  noEventsInRange: '当前范围内没有任务',
  showMore: (total) => `+${total} 更多`
}

const formats: Formats = {
  monthHeaderFormat: (date) => moment(date).format('YYYY年 M月'),
  weekdayFormat: (date) => moment(date).format('dd'),
  dayFormat: (date) => moment(date).format('ddd M/D'),
  dayHeaderFormat: (date) => moment(date).format('YYYY年 M月 D日 dddd'),
  dayRangeHeaderFormat: (range) => {
    const start = moment(range.start)
    const end = moment(range.end)
    const startText = start.format('YYYY年 M月 D日')
    const endText = start.isSame(end, 'month') ? end.format('D日') : end.format('M月 D日')
    return `${startText} - ${endText}`
  }
}

function toDate(value: stringOrDate): Date {
  return value instanceof Date ? value : new Date(value)
}

function CalendarMonthEventItem({
  event,
  workspacePath
}: ReactBigCalendarEventProps<CalendarEvent> & { workspacePath: string }): React.JSX.Element {
  const task = event.resource
  const cover = task.images?.[0]
  const resolvedCover = cover ? resolveLocalImage(cover, workspacePath) : null
  const timeText = moment(event.start).format('HH:mm')
  const isRemix = Boolean(task.tags?.includes('remix') || task.tags?.includes('裂变'))
  const isVideo = task.mediaType === 'video'

  return (
    <div className="group relative mb-1 flex min-w-0 flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/80 p-2">
      {isRemix ? (
        <div
          className="absolute right-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] font-semibold text-amber-200"
          title="该任务由 AI 裂变生成，请检查文案"
        >
          🎲
        </div>
      ) : null}
      <div className="flex min-w-0 items-start gap-2">
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-zinc-950">
          {resolvedCover ? <img src={resolvedCover} className="h-full w-full object-cover" alt="" /> : null}
          {!resolvedCover && isVideo ? (
            <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
              <Video className="h-4 w-4" />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 text-xs text-zinc-200 break-words whitespace-normal overflow-hidden [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
          {task.title || '(未命名)'}
        </div>
      </div>
      {isVideo ? (
        <div className="inline-flex w-fit items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Video className="h-3 w-3" />
          <span>视频</span>
        </div>
      ) : null}
      <div className="text-[10px] text-zinc-500">{timeText}</div>
    </div>
  )
}

function CalendarView({
  tasks,
  workspacePath,
  onTasksUpdated,
  onTasksDeleted,
  onTasksCreated
}: CalendarViewProps): React.JSX.Element {
  const [draggingTask, setDraggingTask] = useState<CmsPublishTask | null>(null)
  const [draggingBatchIds, setDraggingBatchIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [activeDate, setActiveDate] = useState<Date>(() => new Date())
  const [view, setView] = useState<'week' | 'month'>('week')
  const [showPublished, setShowPublished] = useState(false)
  const [toastMessage, setToastMessage] = useState<string>('')
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [isRemixing, setIsRemixing] = useState(false)
  const [flashingTaskIds, setFlashingTaskIds] = useState<Set<string>>(() => new Set())
  const [activeTask, setActiveTask] = useState<CmsPublishTask | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const defaultStartTime = useCmsStore((s) => s.preferences.defaultStartTime)
  const defaultInterval = useCmsStore((s) => s.preferences.defaultInterval)
  const batchScheduleTasks = useCmsStore((s) => s.batchScheduleTasks)
  const selectedTaskIds = useCmsStore((s) => s.selectedPublishTaskIds)
  const setSelectedTaskIds = useCmsStore((s) => s.setSelectedPublishTaskIds)
  const clearSelectedTaskIds = useCmsStore((s) => s.clearSelectedPublishTaskIds)
  const sidebarPanelRef = usePanelRef()
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'cms-layout-persistence' })

  const unscheduledPool = useMemo(() => {
    return tasks.filter((task) => task.status !== 'published' && task.scheduledAt == null)
  }, [tasks])

  const unscheduledTitleIssueById = useMemo(() => {
    const map = new Map<string, TitleLengthIssue>()
    for (const task of unscheduledPool) {
      const issue = getTitleLengthIssue(task.title, PENDING_POOL_TITLE_LIMIT)
      if (issue) map.set(task.id, issue)
    }
    return map
  }, [unscheduledPool])

  useEffect(() => {
    const allIds = new Set(tasks.map((t) => t.id))
    const nextSelected = selectedTaskIds.filter((id) => allIds.has(id))
    if (nextSelected.length !== selectedTaskIds.length) setSelectedTaskIds(nextSelected)
    setSelectionAnchorId((prev) => (prev && allIds.has(prev) ? prev : null))
  }, [selectedTaskIds, setSelectedTaskIds, tasks])

  const orderedSelectedTasks = useMemo(() => {
    if (selectedTaskIds.length === 0) return []
    const selected = new Set(selectedTaskIds)
    return unscheduledPool.filter((t) => selected.has(t.id))
  }, [selectedTaskIds, unscheduledPool])

  const notifyTitleTooLong = (task: CmsPublishTask, issue: TitleLengthIssue): void => {
    const title = (task.title || '').trim()
    const shortTitle = title || '(未命名)'
    setToastMessage(`标题超 ${issue.limit}（${issue.count}/${issue.limit}）：${shortTitle}，禁止排期`)
  }

  const handleTaskClick = (event: React.MouseEvent<HTMLDivElement>, taskId: string): void => {
    event.stopPropagation()
    const orderedIds = unscheduledPool.map((t) => t.id)
    const isToggle = Boolean(event.metaKey || event.ctrlKey)
    const isRange = Boolean(event.shiftKey)

    if (isRange && selectionAnchorId) {
      const a = orderedIds.indexOf(selectionAnchorId)
      const b = orderedIds.indexOf(taskId)
      if (a >= 0 && b >= 0) {
        const [start, end] = a <= b ? [a, b] : [b, a]
        setSelectedTaskIds(orderedIds.slice(start, end + 1))
        setSelectionAnchorId(taskId)
        return
      }
    }

    if (isRange) {
      setSelectedTaskIds([taskId])
      setSelectionAnchorId(taskId)
      return
    }

    if (isToggle) {
      if (selectedTaskIds.includes(taskId)) {
        setSelectedTaskIds(selectedTaskIds.filter((id) => id !== taskId))
      } else {
        setSelectedTaskIds([...selectedTaskIds, taskId])
      }
      setSelectionAnchorId(taskId)
      return
    }

    if (!selectedTaskIds.includes(taskId)) {
      setSelectedTaskIds([taskId])
      setSelectionAnchorId(taskId)
    }
  }

  const ensureSingleSelectionForDrag = (taskId: string): void => {
    setSelectedTaskIds(selectedTaskIds.includes(taskId) ? selectedTaskIds : [taskId])
    setSelectionAnchorId(taskId)
  }

  const calendarTasks = useMemo(() => {
    const withTime = tasks.filter((task) => getTaskDisplayTime(task) != null)
    return showPublished ? withTime : withTime.filter((task) => task.status !== 'published')
  }, [showPublished, tasks])

  const events = useMemo<CalendarEvent[]>(() => {
    return calendarTasks
      .map((task) => {
        const displayAt = getTaskDisplayTime(task)
        if (displayAt == null) return null
        const start = new Date(displayAt)
        const end = moment(displayAt).add(1, 'hour').toDate()
        return { id: task.id, title: task.title, start, end, resource: task }
      })
      .filter((v): v is CalendarEvent => Boolean(v))
  }, [calendarTasks])

  const saveTaskSchedule = async (
    task: CmsPublishTask,
    scheduledAt: number,
    options?: { forcePending?: boolean }
  ): Promise<void> => {
    if (task.scheduledAt == null) {
      const issue = unscheduledTitleIssueById.get(task.id)
      if (issue) {
        notifyTitleTooLong(task, issue)
        return
      }
    }
    if (isSaving) return
    setIsSaving(true)
    try {
      const updates: { scheduledAt: number; status?: CmsPublishTaskStatus } = { scheduledAt }
      if (options?.forcePending) updates.status = 'pending'
      const updated = await window.api.cms.task.updateBatch([task.id], updates)
      onTasksUpdated(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`排期更新失败：${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const saveBatchTaskSchedule = async (
    updates: Array<{ id: string; scheduledAt: number }>,
    options?: { forcePending?: boolean }
  ): Promise<void> => {
    if (isSaving) return
    if (updates.length === 0) return

    const invalidTasks = updates
      .map((update) => tasks.find((task) => task.id === update.id) || null)
      .filter(
        (task): task is CmsPublishTask =>
          task !== null && task.scheduledAt == null && unscheduledTitleIssueById.has(task.id)
      )

    if (invalidTasks.length > 0) {
      const first = invalidTasks[0]
      if (first) {
        const issue = unscheduledTitleIssueById.get(first.id)
        if (issue) notifyTitleTooLong(first, issue)
      }
      return
    }

    setIsSaving(true)
    try {
      const patches = updates.map((u) => ({
        id: u.id,
        scheduledAt: u.scheduledAt,
        status: options?.forcePending ? ('pending' as const) : undefined
      }))
      const updated = await batchScheduleTasks(patches)
      onTasksUpdated(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`批量排期失败：${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDropFromOutside = ({ start }: DragFromOutsideItemArgs): void => {
    if (!draggingTask) return
    const droppedAt = toDate(start)
    const hasTime =
      droppedAt.getHours() !== 0 ||
      droppedAt.getMinutes() !== 0 ||
      droppedAt.getSeconds() !== 0 ||
      droppedAt.getMilliseconds() !== 0
    const scheduledAt = (
      hasTime ? droppedAt : withDefaultStartTime(droppedAt, defaultStartTime)
    ).getTime()
    void saveTaskSchedule(draggingTask, scheduledAt, { forcePending: true })
  }

  const handleEventDrop = ({ event, start }: EventInteractionArgs<CalendarEvent>): void => {
    const task = event.resource
    if (task.status === 'published') return
    const previous = task.scheduledAt != null ? new Date(task.scheduledAt) : event.start
    const scheduledAt = setDateKeepingTime(toDate(start), previous).getTime()
    void saveTaskSchedule(task, scheduledAt)
  }

  const deleteTask = async (task: CmsPublishTask): Promise<void> => {
    try {
      const result = await window.api.cms.task.delete(task.id)
      if (!result?.success) throw new Error('删除失败')
      onTasksDeleted([task.id])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`删除失败：${message}`)
    }
  }

  const unscheduleTask = async (task: CmsPublishTask): Promise<void> => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const updated = await window.api.cms.task.updateBatch([task.id], {
        scheduledAt: null,
        status: 'pending'
      })
      onTasksUpdated(updated)
      setToastMessage('已撤回至待排期池')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`撤回失败：${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => setToastMessage(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  const handleBatchUnschedule = async (ids: string[]): Promise<void> => {
    if (isSaving) return
    setIsSaving(true)
    try {
      const updated = await window.api.cms.task.updateBatch(ids, {
        scheduledAt: null,
        status: 'pending'
      })
      onTasksUpdated(updated)
      setToastMessage(`已将 ${ids.length} 个任务撤回至待排期池`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`撤回失败：${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleBatchDelete = async (ids: string[]): Promise<void> => {
    const confirmed = window.confirm(`确定彻底删除选中的 ${ids.length} 个草稿任务吗？`)
    if (!confirmed) return

    try {
      await Promise.all(ids.map((id) => window.api.cms.task.delete(id)))
      onTasksDeleted(ids)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`批量删除失败：${message}`)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedTaskIds.length === 0) return

        const scheduledIds: string[] = []
        const pendingIds: string[] = []

        for (const id of selectedTaskIds) {
          const task = tasks.find((t) => t.id === id)
          if (!task) continue
          if (task.status === 'published') continue

          // scheduledAt check: task.scheduledAt != null
          if (
            typeof task.scheduledAt === 'number' &&
            Number.isFinite(task.scheduledAt) &&
            task.scheduledAt > 0
          ) {
            scheduledIds.push(id)
          } else {
            pendingIds.push(id)
          }
        }

        if (scheduledIds.length === 0 && pendingIds.length === 0) return

        e.preventDefault()
        e.stopPropagation()

        if (scheduledIds.length > 0) {
          void handleBatchUnschedule(scheduledIds)
        }

        if (pendingIds.length > 0) {
          void handleBatchDelete(pendingIds)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBatchDelete, handleBatchUnschedule, selectedTaskIds, tasks])

  useEffect(() => {
    if (flashingTaskIds.size === 0) return
    const timer = window.setTimeout(() => setFlashingTaskIds(new Set()), 1400)
    return () => window.clearTimeout(timer)
  }, [flashingTaskIds])

  const handleSurpriseRemix = async (): Promise<void> => {
    if (isRemixing) return
    // Step 3: 计算已发布任务的图片签名集合用于跨历史去重
    const publishedImageSignatures = new Set<string>()
    for (const t of tasks) {
      if (t.status === 'published' && t.images && t.images.length > 0) {
        const unique = Array.from(new Set(t.images.filter((v) => Boolean(v))))
        unique.sort()
        publishedImageSignatures.add(unique.join('|'))
      }
    }
    const remix = buildSurpriseRemix(tasks, { count: 5, lookbackDays: 14, publishedImageSignatures })
    if (!remix) {
      setToastMessage('🎲 没有可混剪的批次（近14天、每批≥3条）')
      return
    }
    setIsRemixing(true)
    try {
      const created = await window.api.cms.task.createBatch(remix.payloads)
      onTasksCreated?.(created)
      setFlashingTaskIds(new Set(created.map((t) => t.id)))
      setToastMessage(
        `🎲 命中批次："${remix.sampleTitle}" (共${remix.selectedBatch.length}个素材)，已为您生成 ${created.length} 条新任务！`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`混剪失败：${message}`)
    } finally {
      setIsRemixing(false)
    }
  }

  const handleToggleSidebar = (): void => {
    const panel = sidebarPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-full min-h-0">
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="h-full min-h-0"
        >
          <Panel
            id="pending-pool"
            panelRef={sidebarPanelRef}
            defaultSize="20%"
            minSize="15%"
            maxSize="40%"
            collapsible
            collapsedSize="0%"
            onResize={(size) => setIsSidebarCollapsed(size.asPercentage < 0.5)}
            className="min-h-0 pr-4"
          >
            <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/10 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">待排期池</div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-zinc-400">{unscheduledPool.length}</div>
                  <button
                    type="button"
                    title="随机选取历史某一批次素材进行裂变生成"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition',
                      'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15',
                      (isRemixing || tasks.length === 0) && 'opacity-60 pointer-events-none'
                    )}
                    onClick={() => void handleSurpriseRemix()}
                    aria-busy={isRemixing}
                  >
                    <span className={cn(isRemixing ? 'animate-pulse' : '')}>🎲</span>
                    <span>{isRemixing ? '生成中' : '随便来5个'}</span>
                  </button>
                </div>
              </div>
              {unscheduledTitleIssueById.size > 0 ? (
                <div className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
                  检测到 {unscheduledTitleIssueById.size} 个任务标题超 {PENDING_POOL_TITLE_LIMIT}，请先修改标题后再排期
                </div>
              ) : null}
              <div
                className="min-h-0 flex-1 space-y-2 overflow-auto pr-1"
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  if (e.target !== e.currentTarget) return
                  clearSelectedTaskIds()
                  setSelectionAnchorId(null)
                }}
              >
                {unscheduledPool.length === 0 ? (
                  <div className="rounded-md border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
                    没有未排期草稿
                  </div>
                ) : (
                  unscheduledPool.map((task) => (
                    <div
                      key={task.id}
                      className="contents"
                      onDoubleClick={() => {
                        setActiveTask(task)
                        setIsDetailModalOpen(true)
                      }}
                    >
                      <PendingTaskCard
                        task={task}
                        workspacePath={workspacePath}
                        isSelected={selectedTaskIds.includes(task.id)}
                        isFlashing={flashingTaskIds.has(task.id)}
                        isGroupDragging={draggingBatchIds.includes(task.id)}
                        selectedCount={selectedTaskIds.length}
                        selectedTaskIds={selectedTaskIds}
                        orderedSelectedTasks={orderedSelectedTasks}
                        titleLengthIssue={unscheduledTitleIssueById.get(task.id) || null}
                        onDraggingChange={setDraggingTask}
                        onDraggingBatchIdsChange={setDraggingBatchIds}
                        onBeforeDragUnselected={ensureSingleSelectionForDrag}
                        onSelect={handleTaskClick}
                        onDelete={deleteTask}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </Panel>

          <Separator className="w-1.5 bg-transparent transition-colors hover:bg-purple-500/50 cursor-col-resize flex flex-col justify-center items-center group">
            <div className="h-8 w-1 rounded-full bg-zinc-700 group-hover:bg-purple-400" />
          </Separator>

          <Panel id="calendar" minSize="30%" className="min-h-0 pl-4">
            <div className="min-h-0 flex h-full flex-col gap-3">
              <CalendarHeader
                view={view}
                date={activeDate}
                showPublished={showPublished}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={handleToggleSidebar}
                onShowPublishedChange={setShowPublished}
                onChangeView={setView}
                onNavigateToday={() => setActiveDate(new Date())}
                onNavigatePrev={() => {
                  setActiveDate((prev) =>
                    view === 'week'
                      ? moment(prev).subtract(7, 'day').toDate()
                      : moment(prev).subtract(1, 'month').toDate()
                  )
                }}
                onNavigateNext={() => {
                  setActiveDate((prev) =>
                    view === 'week'
                      ? moment(prev).add(7, 'day').toDate()
                      : moment(prev).add(1, 'month').toDate()
                  )
                }}
              />

              <div className="min-h-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/10 p-3">
                {view === 'week' ? (
                  <div className="h-full w-full overflow-x-auto overflow-y-hidden">
                    <div className="h-full min-w-[1120px]">
                      <KanbanWeekView
                        tasks={calendarTasks}
                        workspacePath={workspacePath}
                        baseDate={activeDate}
                        showPublished={showPublished}
                        defaultStartTime={defaultStartTime}
                        defaultInterval={defaultInterval}
                        onScheduleTask={saveTaskSchedule}
                        onBatchScheduleTasks={saveBatchTaskSchedule}
                        onUnscheduleTask={unscheduleTask}
                        onTaskDoubleClick={(task) => {
                          setActiveTask(task)
                          setIsDetailModalOpen(true)
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <DragAndDropCalendar
                    localizer={localizer}
                    view="month"
                    views={['month']}
                    date={activeDate}
                    onNavigate={(date) => setActiveDate(date)}
                    culture="zh-cn"
                    popup
                    showAllEvents
                    events={events}
                    startAccessor="start"
                    endAccessor="end"
                    selectable={false}
                    resizable={false}
                    toolbar={false}
                    draggableAccessor={(event) => event.resource.status !== 'published'}
                    onEventDrop={handleEventDrop}
                    onDropFromOutside={handleDropFromOutside}
                    dragFromOutsideItem={
                      draggingTask
                        ? () => {
                            const now = new Date()
                            return {
                              id: draggingTask.id,
                              title: draggingTask.title,
                              start: now,
                              end: moment(now).add(1, 'hour').toDate(),
                              resource: draggingTask
                            }
                          }
                        : undefined
                    }
                    components={{
                      event: (props) => (
                        <CalendarMonthEventItem {...props} workspacePath={workspacePath} />
                      )
                    }}
                    messages={messages}
                    formats={formats}
                    style={{ height: '100%' }}
                  />
                )}
              </div>
            </div>
          </Panel>
        </Group>
      </div>

      {toastMessage ? (
        <div className="fixed bottom-[24px] left-1/2 z-50 -translate-x-1/2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 shadow-lg">
          {toastMessage}
        </div>
      ) : null}

      <TaskDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        task={activeTask}
        workspacePath={workspacePath}
        onTaskUpdated={(updated) => {
          setActiveTask(updated)
          onTasksUpdated([updated])
        }}
      />
    </DndProvider>
  )
}

export { CalendarView }
