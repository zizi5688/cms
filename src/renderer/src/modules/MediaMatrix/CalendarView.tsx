import { useEffect, useMemo, useState } from 'react'

import moment from 'moment'
import 'moment/locale/zh-cn'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'

import { PendingTaskCard } from '@renderer/components/Calendar/PendingTaskCard'
import { TaskDetailModal } from '@renderer/components/TaskDetailModal'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import { CalendarHeader } from './CalendarHeader'
import { KanbanWeekView } from './KanbanWeekView'
import { getTaskDisplayTime, withDefaultStartTime } from './calendarUtils'
import {
  buildSurpriseRemix,
  listSurpriseRemixBatches,
  type SurpriseRemixCandidateBatch,
  type SurpriseRemixCreatePayload
} from './surpriseRemix'
import {
  PENDING_POOL_TITLE_LIMIT,
  getTitleLengthIssue,
  type TitleLengthIssue
} from './titleLengthGuard'

type CalendarViewProps = {
  tasks: CmsPublishTask[]
  workspacePath: string
  viewSpan: 4 | 7
  onViewSpanChange: (next: 4 | 7) => void
  onTasksUpdated: (updated: CmsPublishTask[]) => void
  onTasksDeleted: (deletedIds: string[]) => void
  onTasksCreated?: (created: CmsPublishTask[]) => void
}

type SurpriseRemixPreview = {
  sessionId: string
  seed: string
  sampleTitle: string
  selectedBatch: CmsPublishTask[]
  payloads: SurpriseRemixCreatePayload[]
}

type SurpriseRemixPickerState = {
  seed: string
  publishedImageSignatures: Set<string>
  candidates: SurpriseRemixCandidateBatch[]
  selectedBatchId: string
}

moment.locale('zh-cn')

function CalendarView({
  tasks,
  workspacePath,
  viewSpan,
  onViewSpanChange,
  onTasksUpdated,
  onTasksDeleted,
  onTasksCreated
}: CalendarViewProps): React.JSX.Element {
  const [draggingBatchIds, setDraggingBatchIds] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [showPublished, setShowPublished] = useState(false)
  const [toastMessage, setToastMessage] = useState<string>('')
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [isRemixing, setIsRemixing] = useState(false)
  const [isRollingBackRemix, setIsRollingBackRemix] = useState(false)
  const [remixPicker, setRemixPicker] = useState<SurpriseRemixPickerState | null>(null)
  const [remixPreview, setRemixPreview] = useState<SurpriseRemixPreview | null>(null)
  const [lastRemixSession, setLastRemixSession] = useState<{
    sessionId: string
    accountId: string
    seed: string
    createdCount: number
  } | null>(null)
  const [flashingTaskIds, setFlashingTaskIds] = useState<Set<string>>(() => new Set())
  const [activeTask, setActiveTask] = useState<CmsPublishTask | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const defaultStartTime = useCmsStore((s) => s.preferences.defaultStartTime)
  const defaultInterval = useCmsStore((s) => s.preferences.defaultInterval)
  const batchScheduleTasks = useCmsStore((s) => s.batchScheduleTasks)
  const selectedPublishTaskIds = useCmsStore((s) => s.selectedPublishTaskIds)
  const selectedPendingTaskIds = useCmsStore((s) => s.selectedPendingTaskIds)
  const setSelectedPendingTaskIds = useCmsStore((s) => s.setSelectedPendingTaskIds)
  const clearSelectedPendingTaskIds = useCmsStore((s) => s.clearSelectedPendingTaskIds)
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
    const allPendingIds = new Set(unscheduledPool.map((t) => t.id))
    const nextSelected = selectedPendingTaskIds.filter((id) => allPendingIds.has(id))
    if (nextSelected.length !== selectedPendingTaskIds.length) setSelectedPendingTaskIds(nextSelected)
    setSelectionAnchorId((prev) => (prev && allPendingIds.has(prev) ? prev : null))
  }, [selectedPendingTaskIds, setSelectedPendingTaskIds, unscheduledPool])

  const orderedSelectedTasks = useMemo(() => {
    if (selectedPendingTaskIds.length === 0) return []
    const selected = new Set(selectedPendingTaskIds)
    return unscheduledPool.filter((t) => selected.has(t.id))
  }, [selectedPendingTaskIds, unscheduledPool])

  const keyboardSelectedTaskIds = useMemo(() => {
    return Array.from(new Set([...selectedPublishTaskIds, ...selectedPendingTaskIds]))
  }, [selectedPendingTaskIds, selectedPublishTaskIds])

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
        setSelectedPendingTaskIds(orderedIds.slice(start, end + 1))
        setSelectionAnchorId(taskId)
        return
      }
    }

    if (isRange) {
      setSelectedPendingTaskIds([taskId])
      setSelectionAnchorId(taskId)
      return
    }

    if (isToggle) {
      if (selectedPendingTaskIds.includes(taskId)) {
        setSelectedPendingTaskIds(selectedPendingTaskIds.filter((id) => id !== taskId))
      } else {
        setSelectedPendingTaskIds([...selectedPendingTaskIds, taskId])
      }
      setSelectionAnchorId(taskId)
      return
    }

    if (!selectedPendingTaskIds.includes(taskId)) {
      setSelectedPendingTaskIds([taskId])
      setSelectionAnchorId(taskId)
    }
  }

  const ensureSingleSelectionForDrag = (taskId: string): void => {
    setSelectedPendingTaskIds(
      selectedPendingTaskIds.includes(taskId) ? selectedPendingTaskIds : [taskId]
    )
    setSelectionAnchorId(taskId)
  }

  const calendarTasks = useMemo(() => {
    const withTime = tasks.filter((task) => getTaskDisplayTime(task) != null)
    return showPublished ? withTime : withTime.filter((task) => task.status !== 'published')
  }, [showPublished, tasks])

  const calendarStartDate = useMemo(() => {
    if (viewSpan === 7) return moment().startOf('day').add(weekOffset * 7, 'day').toDate()
    return moment().startOf('day').toDate()
  }, [viewSpan, weekOffset])

  const weekLabel = useMemo(() => {
    const base = viewSpan === 7 ? moment(calendarStartDate) : moment()
    return `${base.isoWeekYear()} 第 ${base.isoWeek()} 周`
  }, [calendarStartDate, viewSpan])

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

  const quickAssignPendingTasks = async (
    dayOffset: 0 | 1,
    label: '今天' | '明天'
  ): Promise<void> => {
    if (isSaving) return
    if (selectedPendingTaskIds.length === 0) return

    const selectedSet = new Set(selectedPendingTaskIds)
    const pendingTasks = unscheduledPool.filter((task) => selectedSet.has(task.id))
    if (pendingTasks.length === 0) return

    const firstInvalid = pendingTasks.find((task) => unscheduledTitleIssueById.has(task.id))
    if (firstInvalid) {
      const issue = unscheduledTitleIssueById.get(firstInvalid.id)
      if (issue) notifyTitleTooLong(firstInvalid, issue)
      return
    }

    const intervalMinutes =
      typeof defaultInterval === 'number' && Number.isFinite(defaultInterval)
        ? Math.max(0, defaultInterval)
        : 0
    const intervalMs = intervalMinutes * 60 * 1000
    const targetDay = moment().startOf('day').add(dayOffset, 'day')
    const dayStart = targetDay.valueOf()
    const dayEnd = targetDay.clone().endOf('day').valueOf()

    const lastScheduledAt = tasks.reduce<number | null>((latest, task) => {
      const scheduledAt =
        typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt) ? task.scheduledAt : null
      if (scheduledAt == null || scheduledAt < dayStart || scheduledAt > dayEnd) return latest
      return latest == null ? scheduledAt : Math.max(latest, scheduledAt)
    }, null)

    const firstSlot =
      lastScheduledAt != null
        ? lastScheduledAt + intervalMs
        : withDefaultStartTime(targetDay.toDate(), defaultStartTime).getTime()

    const updates = pendingTasks.map((task, index) => ({
      id: task.id,
      scheduledAt: firstSlot + index * intervalMs,
      status: 'pending' as const
    }))

    setIsSaving(true)
    try {
      const updated = await batchScheduleTasks(updates)
      onTasksUpdated(updated)
      clearSelectedPendingTaskIds()
      setSelectionAnchorId(null)
      setToastMessage(`已排入${label}：${updates.length} 条`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`批量排期失败：${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (keyboardSelectedTaskIds.length === 0) return

        const scheduledIds: string[] = []
        const pendingIds: string[] = []

        for (const id of keyboardSelectedTaskIds) {
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
  }, [handleBatchDelete, handleBatchUnschedule, keyboardSelectedTaskIds, tasks])

  useEffect(() => {
    if (flashingTaskIds.size === 0) return
    const timer = window.setTimeout(() => setFlashingTaskIds(new Set()), 1400)
    return () => window.clearTimeout(timer)
  }, [flashingTaskIds])

  const buildRemixSeed = (): string => {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
      return window.crypto.randomUUID()
    }
    return `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`
  }

  const buildRemixPreviewByBatch = (
    picker: SurpriseRemixPickerState,
    batchId: string
  ): SurpriseRemixPreview | null => {
    const candidate = picker.candidates.find((item) => item.id === batchId)
    if (!candidate) return null
    const scopedSeed = `${picker.seed}:${batchId}`
    const remix = buildSurpriseRemix(tasks, {
      count: 5,
      lookbackDays: 14,
      publishedImageSignatures: picker.publishedImageSignatures,
      seed: scopedSeed,
      sessionId: `remix-${scopedSeed}`,
      selectedBatch: candidate.tasks
    })
    return remix
  }

  const handleSurpriseRemix = (): void => {
    if (isRemixing || isRollingBackRemix || remixPicker) return
    // Step 3: 计算已发布任务的图片签名集合用于跨历史去重
    const publishedImageSignatures = new Set<string>()
    for (const t of tasks) {
      if (t.status === 'published' && t.images && t.images.length > 0) {
        const unique = Array.from(new Set(t.images.filter((v) => Boolean(v))))
        unique.sort()
        publishedImageSignatures.add(unique.join('|'))
      }
    }
    const candidates = listSurpriseRemixBatches(tasks, { lookbackDays: 14 })
    if (candidates.length === 0) {
      setToastMessage('🎲 没有可混剪的批次（近14天、每批≥3条）')
      return
    }
    const picker: SurpriseRemixPickerState = {
      seed: buildRemixSeed(),
      publishedImageSignatures,
      candidates,
      selectedBatchId: candidates[0]!.id
    }
    const preview = buildRemixPreviewByBatch(picker, picker.selectedBatchId)
    if (!preview) {
      setToastMessage('🎲 当前候选批次无法生成预览，请更换批次')
      return
    }
    setRemixPicker(picker)
    setRemixPreview(preview)
  }

  const handleSelectRemixBatch = (batchId: string): void => {
    if (!remixPicker || remixPicker.selectedBatchId === batchId) return
    const nextPicker: SurpriseRemixPickerState = { ...remixPicker, selectedBatchId: batchId }
    const nextPreview = buildRemixPreviewByBatch(nextPicker, batchId)
    if (!nextPreview) {
      setToastMessage('🎲 该批次当前无法生成预览，请选择其他批次')
      return
    }
    setRemixPicker(nextPicker)
    setRemixPreview(nextPreview)
  }

  const handleConfirmSurpriseRemix = async (): Promise<void> => {
    if (!remixPreview || !remixPicker || isRemixing) return
    const preview = remixPreview
    setIsRemixing(true)
    try {
      const created = await window.api.cms.task.createBatch(preview.payloads, {
        requestId: preview.sessionId
      })
      if (created.length === 0) {
        setToastMessage('🎲 预览已确认，但没有生成新任务')
        setRemixPicker(null)
        setRemixPreview(null)
        return
      }
      onTasksCreated?.(created)
      setFlashingTaskIds(new Set(created.map((t) => t.id)))
      setLastRemixSession({
        sessionId: preview.sessionId,
        accountId: preview.payloads[0]?.accountId ?? preview.selectedBatch[0]?.accountId ?? '',
        seed: preview.seed,
        createdCount: created.length
      })
      setToastMessage(
        `🎲 命中批次："${preview.sampleTitle}" (共${preview.selectedBatch.length}个素材)，已生成 ${created.length} 条（seed: ${preview.seed}）`
      )
      setRemixPicker(null)
      setRemixPreview(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`混剪失败：${message}`)
    } finally {
      setIsRemixing(false)
    }
  }

  const handleRollbackLastRemix = async (): Promise<void> => {
    if (!lastRemixSession || isRollingBackRemix) return
    const confirmed = window.confirm(
      `确定撤销上次裂变吗？将删除本次生成的任务（最多 ${lastRemixSession.createdCount} 条）。`
    )
    if (!confirmed) return
    setIsRollingBackRemix(true)
    try {
      const result = await window.api.cms.task.deleteByRemixSession(
        lastRemixSession.sessionId,
        lastRemixSession.accountId || undefined
      )
      if (result.deletedIds.length > 0) onTasksDeleted(result.deletedIds)
      setToastMessage(`已撤销上次裂变，删除 ${result.deleted} 条任务`)
      setLastRemixSession(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`撤销失败：${message}`)
    } finally {
      setIsRollingBackRemix(false)
    }
  }

  const handleToggleSidebar = (): void => {
    const panel = sidebarPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  const activeRemixCandidate = remixPicker
    ? remixPicker.candidates.find((candidate) => candidate.id === remixPicker.selectedBatchId) ?? null
    : null

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
            defaultSize="24%"
            minSize="14%"
            maxSize="55%"
            collapsible
            collapsedSize="0%"
            onResize={(size) => setIsSidebarCollapsed(size.asPercentage < 0.5)}
            className="min-h-0 pr-4"
          >
            <div className="relative flex h-full min-h-0 flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/10 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">待排期池</div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-zinc-400">{unscheduledPool.length}</div>
                  <button
                    type="button"
                    title="选择历史批次后进行裂变生成"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition',
                      'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15',
                      (isRemixing ||
                        isRollingBackRemix ||
                        Boolean(remixPicker) ||
                        tasks.length === 0) &&
                        'opacity-60 pointer-events-none'
                    )}
                    onClick={() => void handleSurpriseRemix()}
                    aria-busy={isRemixing}
                  >
                    <span className={cn(isRemixing ? 'animate-pulse' : '')}>🎲</span>
                    <span>{isRemixing ? '生成中' : '随便来5个'}</span>
                  </button>
                  {lastRemixSession ? (
                    <button
                      type="button"
                      title={`撤销 session: ${lastRemixSession.sessionId}`}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition',
                        'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/15',
                        (isRemixing || isRollingBackRemix) && 'opacity-60 pointer-events-none'
                      )}
                      onClick={() => void handleRollbackLastRemix()}
                      aria-busy={isRollingBackRemix}
                    >
                      <span>{isRollingBackRemix ? '撤销中' : '撤销上次'}</span>
                    </button>
                  ) : null}
                </div>
              </div>
              {unscheduledTitleIssueById.size > 0 ? (
                <div className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
                  检测到 {unscheduledTitleIssueById.size} 个任务标题超 {PENDING_POOL_TITLE_LIMIT}，请先修改标题后再排期
                </div>
              ) : null}
              <div className="text-[11px] text-zinc-500">支持 Shift 连选，支持 Cmd/Ctrl 点选。</div>
              <div
                className={cn(
                  'min-h-0 flex-1 space-y-2 overflow-auto pr-1',
                  selectedPendingTaskIds.length > 0 && 'pb-20'
                )}
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  if (e.target !== e.currentTarget) return
                  clearSelectedPendingTaskIds()
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
                        isSelected={selectedPendingTaskIds.includes(task.id)}
                        isFlashing={flashingTaskIds.has(task.id)}
                        isGroupDragging={draggingBatchIds.includes(task.id)}
                        selectedCount={selectedPendingTaskIds.length}
                        selectedTaskIds={selectedPendingTaskIds}
                        orderedSelectedTasks={orderedSelectedTasks}
                        titleLengthIssue={unscheduledTitleIssueById.get(task.id) || null}
                        onDraggingChange={() => undefined}
                        onDraggingBatchIdsChange={setDraggingBatchIds}
                        onBeforeDragUnselected={ensureSingleSelectionForDrag}
                        onSelect={handleTaskClick}
                        onDelete={deleteTask}
                      />
                    </div>
                  ))
                )}
              </div>
              {selectedPendingTaskIds.length > 0 ? (
                <div className="pointer-events-none absolute bottom-3 left-3 right-3">
                  <div className="pointer-events-auto rounded-xl border border-zinc-700/80 bg-zinc-950/95 px-3 py-2 shadow-xl backdrop-blur">
                    <div className="mb-2 text-xs text-zinc-300">已选 {selectedPendingTaskIds.length} 条任务</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 transition hover:bg-zinc-800/80 disabled:opacity-60"
                        disabled={isSaving}
                        onClick={() => void quickAssignPendingTasks(0, '今天')}
                      >
                        排入今天
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-100 transition hover:bg-zinc-800/80 disabled:opacity-60"
                        disabled={isSaving}
                        onClick={() => void quickAssignPendingTasks(1, '明天')}
                      >
                        排入明天
                      </button>
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800/80 hover:text-zinc-200"
                        onClick={() => {
                          clearSelectedPendingTaskIds()
                          setSelectionAnchorId(null)
                        }}
                      >
                        清空选择
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>

          <Separator className="w-1.5 bg-transparent transition-colors hover:bg-purple-500/50 cursor-col-resize flex flex-col justify-center items-center group">
            <div className="h-8 w-1 rounded-full bg-zinc-700 group-hover:bg-purple-400" />
          </Separator>

          <Panel id="calendar" minSize="30%" className="min-h-0 pl-4">
            <div className="min-h-0 flex h-full flex-col gap-3">
              <CalendarHeader
                viewSpan={viewSpan}
                weekLabel={weekLabel}
                canShiftWeek={viewSpan === 7}
                onShiftWeekBackward={() => setWeekOffset((prev) => prev - 1)}
                onShiftWeekForward={() => setWeekOffset((prev) => prev + 1)}
                onViewSpanChange={onViewSpanChange}
                showPublished={showPublished}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={handleToggleSidebar}
                onShowPublishedChange={setShowPublished}
              />

              <div className="min-h-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900/10 p-3">
                <div className="h-full w-full overflow-x-auto overflow-y-hidden">
                  <div className="h-full min-w-[980px]">
                    <KanbanWeekView
                      tasks={calendarTasks}
                      workspacePath={workspacePath}
                      viewSpan={viewSpan}
                      startDate={calendarStartDate}
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
              </div>
            </div>
          </Panel>
        </Group>
      </div>

      {remixPicker ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 md:items-center">
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
            <div className="mb-3 text-sm font-semibold text-zinc-100">
              选择命中批次并确认裂变
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-4 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
                <div className="mb-2 px-1 text-xs text-zinc-400">
                  候选批次 {remixPicker.candidates.length}（近14天）
                </div>
                <div className="space-y-2">
                  {remixPicker.candidates.map((candidate) => {
                    const cover = candidate.coverImage ? resolveLocalImage(candidate.coverImage, workspacePath) : null
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        className={cn(
                          'w-full rounded-md border px-2 py-2 text-left transition',
                          candidate.id === remixPicker.selectedBatchId
                            ? 'border-amber-500/60 bg-amber-500/10'
                            : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70'
                        )}
                        onClick={() => handleSelectRemixBatch(candidate.id)}
                      >
                        <div className="flex items-start gap-2">
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
                            {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-zinc-100">{candidate.sampleTitle}</div>
                            <div className="mt-1 text-[11px] text-zinc-400">
                              素材 {candidate.taskCount} · 图池 {candidate.imagePoolCount}
                            </div>
                            <div className="mt-1 text-[10px] text-zinc-500">
                              {moment(candidate.createdAtStart).format('MM/DD HH:mm')} -{' '}
                              {moment(candidate.createdAtEnd).format('MM/DD HH:mm')}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-lg border border-zinc-800 bg-zinc-900/20 p-3">
                {remixPreview ? (
                  <>
                    <div className="text-xs text-zinc-300">
                      命中批次：「{remixPreview.sampleTitle}」 · 候选素材 {remixPreview.selectedBatch.length} · 将创建{' '}
                      {remixPreview.payloads.length} 条
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      session: {remixPreview.sessionId} · seed: {remixPreview.seed}
                    </div>
                    {activeRemixCandidate ? (
                      <div className="mt-1 text-[11px] text-zinc-500">
                        批次时间：{moment(activeRemixCandidate.createdAtStart).format('YYYY-MM-DD HH:mm')} -{' '}
                        {moment(activeRemixCandidate.createdAtEnd).format('YYYY-MM-DD HH:mm')}
                      </div>
                    ) : null}

                    <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                      {remixPreview.payloads.map((payload, index) => (
                        <div
                          key={`${remixPreview.sessionId}-${index}`}
                          className="rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                        >
                          <div className="text-xs font-semibold text-zinc-100">
                            #{index + 1} {payload.title || '(未命名)'}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-400">
                            图片 {payload.images.length} 张 · 商品 {payload.productName || '未绑定商品'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-zinc-500">当前批次无法生成预览，请选择其他批次。</div>
                )}
              </div>
            </div>

            {remixPreview && remixPreview.payloads.length < 5 ? (
              <div className="mt-3 text-xs text-amber-200">
                当前素材约束下仅能生成 {remixPreview.payloads.length} 条（已应用去重保护）。
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/60"
                onClick={() => {
                  setRemixPreview(null)
                  setRemixPicker(null)
                }}
                disabled={isRemixing}
              >
                取消
              </button>
              <button
                type="button"
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs font-medium',
                  'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20',
                  isRemixing && 'opacity-60 pointer-events-none'
                )}
                onClick={() => void handleConfirmSurpriseRemix()}
                disabled={isRemixing || !remixPreview || remixPreview.payloads.length === 0}
              >
                {isRemixing
                  ? '生成中…'
                  : `确认生成 ${remixPreview ? remixPreview.payloads.length : 0} 条`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
