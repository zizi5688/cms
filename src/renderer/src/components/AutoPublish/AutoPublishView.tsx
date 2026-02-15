import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { LogIn, Pencil, RefreshCw, Settings, Trash2, UserPlus, Video, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { CalendarView } from '@renderer/modules/MediaMatrix/CalendarView'
import { useCmsStore } from '@renderer/store/useCmsStore'

function formatDateTimeMinute(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function toLocalDatetimeInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function parseLocalDatetimeInputValue(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const date = new Date(year, month - 1, day, hour, minute, 0, 0)
  const time = date.getTime()
  if (Number.isNaN(time)) return null
  return time
}

function withDefaultStartTime(date: Date, timeText: string): Date {
  const next = new Date(date)
  const normalized = String(timeText ?? '').trim()
  const match = /^(\d{2}):(\d{2})$/.exec(normalized)
  const hour = match ? Number(match[1]) : 10
  const minute = match ? Number(match[2]) : 0
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    next.setHours(10, 0, 0, 0)
    return next
  }
  next.setHours(hour, minute, 0, 0)
  return next
}

function filterTasksByStage(tasks: CmsPublishTask[], stage: 'pending' | 'published'): CmsPublishTask[] {
  if (stage === 'published') return tasks.filter((task) => task.status === 'published')
  return tasks.filter((task) => task.status !== 'published')
}

function AutoPublishView(): React.JSX.Element {
  const addLog = useCmsStore((s) => s.addLog)
  const workspacePath = useCmsStore((s) => s.workspacePath)
  const defaultStartTime = useCmsStore((s) => s.preferences.defaultStartTime)
  const defaultInterval = useCmsStore((s) => s.preferences.defaultInterval)

  const [accounts, setAccounts] = useState<CmsAccountRecord[]>([])
  const [activeAccountId, setActiveAccountId] = useState('')
  const [tasks, setTasks] = useState<CmsPublishTask[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar')
  const isCalendarMode = viewMode === 'calendar'
  const [activeStage, setActiveStage] = useState<'pending' | 'published'>('pending')
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set())
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [isSyncingProducts, setIsSyncingProducts] = useState(false)
  const [deletingTaskId, setDeletingTaskId] = useState('')
  const [retryingTaskId, setRetryingTaskId] = useState('')
  const [editingAccountId, setEditingAccountId] = useState('')
  const [editingAccountName, setEditingAccountName] = useState('')
  const [isSmartScheduleOpen, setIsSmartScheduleOpen] = useState(false)
  const [smartScheduleStartLocal, setSmartScheduleStartLocal] = useState('')
  const [smartScheduleIntervalMins, setSmartScheduleIntervalMins] = useState(() => defaultInterval)
  const [isSingleScheduleOpen, setIsSingleScheduleOpen] = useState(false)
  const [singleScheduleTaskId, setSingleScheduleTaskId] = useState('')
  const [singleScheduleLocal, setSingleScheduleLocal] = useState('')
  const [singleScheduleSavingTaskId, setSingleScheduleSavingTaskId] = useState('')
  const [cancelingScheduleTaskId, setCancelingScheduleTaskId] = useState('')

  const isLoadingAccountsRef = useRef(false)
  const isLoadingTasksRef = useRef(false)

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ deletedIds?: unknown }>).detail
      const deletedIds = Array.isArray(detail?.deletedIds) ? detail.deletedIds : []
      if (deletedIds.length === 0) return
      const setIds = new Set(deletedIds.map((id) => String(id ?? '').trim()).filter(Boolean))
      if (setIds.size === 0) return
      setTasks((prev) => prev.filter((t) => !setIds.has(t.id)))
      setSelectedTaskIds((prev) => {
        if (prev.size === 0) return prev
        const next = new Set(prev)
        for (const id of setIds) next.delete(id)
        return next
      })
    }

    window.addEventListener('cms.publishTasks.deleted', handler)
    return () => window.removeEventListener('cms.publishTasks.deleted', handler)
  }, [])

  useEffect(() => {
    if (isSmartScheduleOpen) return
    setSmartScheduleIntervalMins(defaultInterval)
  }, [defaultInterval, isSmartScheduleOpen])

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId]
  )

  const loadAccounts = useCallback(async (): Promise<void> => {
    if (isLoadingAccountsRef.current) return
    isLoadingAccountsRef.current = true
    setIsLoadingAccounts(true)
    try {
      const list = await window.api.cms.account.list()
      setAccounts(list)
      setActiveAccountId((prev) => prev || list[0]?.id || '')
    } catch (error) {
      addLog(`[媒体矩阵] 拉取账号失败：${String(error)}`)
    } finally {
      setIsLoadingAccounts(false)
      isLoadingAccountsRef.current = false
    }
  }, [addLog])

  const loadTasks = useCallback(
    async (accountId: string): Promise<void> => {
      const normalized = accountId.trim()
      if (!normalized) {
        setTasks([])
        return
      }
      if (isLoadingTasksRef.current) return
      isLoadingTasksRef.current = true
      setIsLoadingTasks(true)
      try {
        const list = await window.api.cms.task.list(normalized)
        setTasks(list)
      } catch (error) {
        addLog(`[媒体矩阵] 拉取队列任务失败：${String(error)}`)
      } finally {
        setIsLoadingTasks(false)
        isLoadingTasksRef.current = false
      }
    },
    [addLog]
  )

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    void loadTasks(activeAccountId)
    setActiveStage('pending')
    setSelectedTaskIds(new Set())
  }, [activeAccountId, loadTasks])

  useEffect(() => {
    return window.api.cms.task.onUpdated((task) => {
      const activeId = activeAccountId.trim()
      if (!activeId || task.accountId !== activeId) return
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    })
  }, [activeAccountId])

  const toggleSelectedTask = (taskId: string): void => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const clearSelection = (): void => {
    setSelectedTaskIds(new Set())
  }

  const handleChangeStage = (next: 'pending' | 'published'): void => {
    setActiveStage(next)
    clearSelection()
  }

  const patchTasksInState = (updated: CmsPublishTask[]): void => {
    if (updated.length === 0) return
    setTasks((prev) => prev.map((t) => updated.find((u) => u.id === t.id) ?? t))
  }

  const deleteSelectedTasks = async (): Promise<void> => {
    const ids = filterTasksByStage(tasks, activeStage)
      .filter((task) => selectedTaskIds.has(task.id))
      .map((task) => task.id)
    if (ids.length === 0) return
    const confirmed = window.confirm(`确定删除已选 ${ids.length} 条记录？仅删除本地记录，不影响小红书端。`)
    if (!confirmed) return
    try {
      const result = await window.api.cms.task.deleteBatch(ids)
      addLog(`[媒体矩阵] 已批量删除 ${result.deleted} 条任务。`)
      setTasks((prev) => prev.filter((t) => !new Set(result.deletedIds).has(t.id)))
      clearSelection()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`批量删除失败：${message}`)
    }
  }

  const handleAddAccount = async (): Promise<void> => {
    try {
      const now = new Date()
      const datePart = now.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
      const timePart = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      const name = `小红书账号 ${datePart} ${timePart}`
      const created = await window.api.cms.account.create(name)
      setActiveAccountId(created.id)
      await window.api.cms.account.login(created.id)
      await loadAccounts()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`创建账号失败：${message}`)
    }
  }

  const handleSyncProducts = async (): Promise<void> => {
    const accountId = activeAccountId.trim()
    if (!accountId) return
    if (isSyncingProducts) return
    setIsSyncingProducts(true)
    try {
      const products = await window.api.cms.product.sync(accountId)
      addLog(`[媒体矩阵] 商品同步完成：${products.length} 个。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`同步商品失败：${message}`)
    } finally {
      setIsSyncingProducts(false)
    }
  }

  const handleLogin = async (accountId: string): Promise<void> => {
    const normalized = accountId.trim()
    if (!normalized) return
    try {
      await window.api.cms.account.login(normalized)
      addLog(`[媒体矩阵] 已打开登录窗口：${normalized}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`打开登录窗口失败：${message}`)
    }
  }

  const handleDeleteAccount = async (accountId: string): Promise<void> => {
    if (!window.confirm('确定要永久删除该账号吗？相关的任务记录可能也会被清理。')) return

    try {
      await window.api.cms.account.delete(accountId)

      setAccounts((prev) => prev.filter((a) => a.id !== accountId))

      if (activeAccountId === accountId) {
        setActiveAccountId('')
        setTasks([])
        setActiveStage('pending')
        setSelectedTaskIds(new Set())
      }

      addLog(`[系统] 账号已删除：${accountId}`)
    } catch (error) {
      window.alert(`删除失败：${String(error)}`)
    }
  }

  const beginRename = (account: CmsAccountRecord): void => {
    setEditingAccountId(account.id)
    setEditingAccountName(account.name)
  }

  const cancelRename = (): void => {
    setEditingAccountId('')
    setEditingAccountName('')
  }

  const saveRename = async (): Promise<void> => {
    const accountId = editingAccountId.trim()
    const name = editingAccountName.trim()
    if (!accountId) return
    if (!name) {
      cancelRename()
      return
    }

    try {
      const updated = await window.api.cms.account.rename(accountId, name)
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      cancelRename()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`重命名失败：${message}`)
    }
  }

  const handleDeleteTask = useCallback(
    async (taskId: string): Promise<void> => {
      const normalizedTaskId = taskId.trim()
      const accountId = activeAccountId.trim()
      if (!normalizedTaskId || !accountId) return
      if (deletingTaskId) return

      const confirmed = window.confirm('确定从队列删除该任务？此操作不可撤销。')
      if (!confirmed) return

      setDeletingTaskId(normalizedTaskId)
      try {
        await window.api.cms.task.delete(normalizedTaskId)
        await loadTasks(accountId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.alert(`删除任务失败：${message}`)
      } finally {
        setDeletingTaskId('')
      }
    },
    [activeAccountId, deletingTaskId, loadTasks]
  )

  const handleRetryTask = useCallback(
    async (taskId: string): Promise<void> => {
      const normalizedTaskId = taskId.trim()
      const accountId = activeAccountId.trim()
      if (!normalizedTaskId || !accountId) return
      if (retryingTaskId) return

      setRetryingTaskId(normalizedTaskId)
      try {
        const updated = await window.api.cms.task.updateStatus(normalizedTaskId, 'pending')
        if (updated) {
          setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
          addLog(`[媒体矩阵] 已重试任务：${normalizedTaskId}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.alert(`重试任务失败：${message}`)
      } finally {
        setRetryingTaskId('')
      }
    },
    [activeAccountId, addLog, retryingTaskId]
  )

  const filteredTasks = useMemo(() => {
    return filterTasksByStage(tasks, activeStage)
  }, [activeStage, tasks])

  const stageSelectedCount = useMemo(() => {
    if (selectedTaskIds.size === 0) return 0
    let count = 0
    for (const task of filteredTasks) {
      if (selectedTaskIds.has(task.id)) count += 1
    }
    return count
  }, [filteredTasks, selectedTaskIds])

  const isAllFilteredSelected = useMemo(() => {
    if (filteredTasks.length === 0) return false
    return filteredTasks.every((task) => selectedTaskIds.has(task.id))
  }, [filteredTasks, selectedTaskIds])

  const toggleSelectAllFiltered = (): void => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev)
      if (isAllFilteredSelected) {
        for (const task of filteredTasks) next.delete(task.id)
        return next
      }
      for (const task of filteredTasks) next.add(task.id)
      return next
    })
  }

  const openSmartSchedule = (): void => {
    if (activeStage === 'published') return
    if (stageSelectedCount <= 0) return
    setSmartScheduleIntervalMins(defaultInterval)
    setSmartScheduleStartLocal((prev) => prev || toLocalDatetimeInputValue(withDefaultStartTime(new Date(), defaultStartTime)))
    setIsSmartScheduleOpen(true)
  }

  const handleConfirmSmartSchedule = async (): Promise<void> => {
    if (activeStage === 'published') return
    const selectedInStage = filteredTasks.filter((task) => selectedTaskIds.has(task.id))
    if (selectedInStage.length <= 0) return
    const startMs = parseLocalDatetimeInputValue(smartScheduleStartLocal)
    if (startMs === null) {
      window.alert('起始时间无效，请重新选择。')
      return
    }

    const intervalMins = selectedInStage.length > 1 ? Math.max(0, Number(smartScheduleIntervalMins) || 0) : 0
    const updates = selectedInStage.map((task, index) => {
      return { id: task.id, updates: { scheduledAt: startMs + index * intervalMins * 60_000 } }
    })

    try {
      const updateBatch = window.api.cms.task.updateBatch as unknown as (patches: unknown) => Promise<CmsPublishTask[]>
      const updated = await updateBatch(updates)
      patchTasksInState(updated)
      setIsSmartScheduleOpen(false)
      addLog(
        `[媒体矩阵] 已批量排期 ${selectedInStage.length} 条：起始 ${formatDateTimeMinute(startMs)}${
          selectedInStage.length > 1 ? `，间隔 ${intervalMins} 分钟` : ''
        }。`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`批量排期失败：${message}`)
    }
  }

  const openSingleSchedule = (task: CmsPublishTask): void => {
    const scheduledAt = task.scheduledAt ?? Date.now()
    setSingleScheduleTaskId(task.id)
    setSingleScheduleLocal(toLocalDatetimeInputValue(new Date(scheduledAt)))
    setIsSingleScheduleOpen(true)
  }

  const handleConfirmSingleSchedule = async (): Promise<void> => {
    const taskId = singleScheduleTaskId.trim()
    if (!taskId) return
    const nextMs = parseLocalDatetimeInputValue(singleScheduleLocal)
    if (nextMs === null) {
      window.alert('排期时间无效，请重新选择。')
      return
    }

    setSingleScheduleSavingTaskId(taskId)
    try {
      const updated = await window.api.cms.task.updateBatch([taskId], { scheduledAt: nextMs })
      patchTasksInState(updated)
      setIsSingleScheduleOpen(false)
      addLog(`[媒体矩阵] 已更新排期：${taskId} → ${formatDateTimeMinute(nextMs)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`修改排期失败：${message}`)
    } finally {
      setSingleScheduleSavingTaskId('')
    }
  }

  const handleCancelScheduleForTask = async (taskId: string): Promise<void> => {
    const normalized = taskId.trim()
    if (!normalized) return
    if (!window.confirm('确定取消排期吗？')) return

    setCancelingScheduleTaskId(normalized)
    try {
      const updated = await window.api.cms.task.cancelSchedule([normalized])
      patchTasksInState(updated)
      setSelectedTaskIds((prev) => {
        const next = new Set(prev)
        next.delete(normalized)
        return next
      })
      addLog(`[媒体矩阵] 已取消排期：${normalized}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`取消排期失败：${message}`)
    } finally {
      setCancelingScheduleTaskId('')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <div className="text-lg font-semibold">媒体矩阵</div>
        <div className="mt-1 text-sm text-zinc-400">分发 · 队列 · 执行</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {isCalendarMode ? null : (
          <Card className="flex min-h-0 flex-col lg:basis-1/4">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>账号管理</CardTitle>
                <CardDescription>选择账号查看对应队列。</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => void loadAccounts()} disabled={isLoadingAccounts}>
                  <RefreshCw className={cn('h-4 w-4', isLoadingAccounts ? 'animate-spin' : '')} />
                </Button>
                <Button size="icon" onClick={() => void handleAddAccount()}>
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto">
              {accounts.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                  暂无账号。点击右上角按钮创建。
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {accounts.map((account) => {
                    const isActive = account.id === activeAccountId
                    const isOnline = account.lastLoginTime !== null
                    const isEditing = editingAccountId === account.id
                    return (
                      <div
                        key={account.id}
                        onClick={() => setActiveAccountId(account.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setActiveAccountId(account.id)
                        }}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                          isActive ? 'border-zinc-300 bg-zinc-900/30' : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-900/20'
                        )}
                      >
                        <div className="min-w-0">
                          {isEditing ? (
                            <input
                              value={editingAccountName}
                              onChange={(e) => setEditingAccountName(e.target.value)}
                              autoFocus
                              onBlur={() => void saveRename()}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') void saveRename()
                                if (e.key === 'Escape') cancelRename()
                              }}
                              className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-medium text-zinc-50">{account.name}</div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  beginRename(account)
                                }}
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-zinc-400 opacity-0 transition hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-zinc-200 group-hover:opacity-100"
                                aria-label="重命名账号"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                          <div className="truncate text-xs text-zinc-500">{account.id}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={cn(
                              'h-2.5 w-2.5 rounded-full',
                              isOnline ? 'bg-emerald-400' : 'bg-red-400'
                            )}
                          />
                          <span className="text-xs text-zinc-400">{isOnline ? '在线' : '离线'}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveAccountId(account.id)
                              void handleLogin(account.id)
                            }}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-zinc-200"
                            aria-label="登录"
                          >
                            <LogIn className="h-3.5 w-3.5" />
                            登录
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDeleteAccount(account.id)
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-500 transition hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-red-400"
                            aria-label="删除账号"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className={cn('flex min-h-0 flex-1 flex-col', isCalendarMode ? 'lg:basis-full' : 'lg:basis-3/4')}>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            {isCalendarMode ? (
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={activeAccountId}
                    onChange={(e) => setActiveAccountId(e.target.value)}
                    disabled={accounts.length === 0}
                    className="h-9 w-[240px] max-w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-50"
                  >
                    <option value="" disabled>
                      选择账号
                    </option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => void loadAccounts()}
                      disabled={isLoadingAccounts}
                      aria-label="刷新账号"
                    >
                      <RefreshCw className={cn('h-4 w-4', isLoadingAccounts ? 'animate-spin' : '')} />
                    </Button>
                    <Button size="icon" onClick={() => void handleAddAccount()} aria-label="新增账号">
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="min-w-0">
                  <CardTitle className="truncate">排期日历</CardTitle>
                  <CardDescription className="truncate">
                    {activeAccount ? `当前账号：${activeAccount.name}` : '请选择账号查看日历。'}
                  </CardDescription>
                </div>
              </div>
            ) : (
              <div className="min-w-0">
                <CardTitle className="truncate">{activeAccount ? activeAccount.name : '队列任务'}</CardTitle>
                <CardDescription>
                  {activeAccount ? '账号队列任务列表（按 createdAt 倒序）。' : '请选择账号查看队列。'}
                </CardDescription>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950">
                <button
                  type="button"
                  onClick={() => setViewMode('calendar')}
                  className={cn(
                    'px-3 py-1.5 text-sm transition',
                    viewMode === 'calendar'
                      ? 'bg-zinc-900/50 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-900/30 hover:text-zinc-200'
                  )}
                >
                  日历
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'px-3 py-1.5 text-sm transition',
                    viewMode === 'list'
                      ? 'bg-zinc-900/50 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-900/30 hover:text-zinc-200'
                  )}
                >
                  列表
                </button>
              </div>
              <Button
                variant="outline"
                onClick={() => void loadTasks(activeAccountId)}
                disabled={!activeAccountId || isLoadingTasks}
              >
                <RefreshCw className={cn('h-4 w-4', isLoadingTasks ? 'animate-spin' : '')} />
                刷新
              </Button>
              {activeAccountId ? (
                <>
                  <Button variant="outline" onClick={() => void handleSyncProducts()} disabled={isSyncingProducts}>
                    <RefreshCw className={cn('h-4 w-4', isSyncingProducts ? 'animate-spin' : '')} />
                    同步
                  </Button>
                </>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {viewMode === 'calendar' ? (
              !activeAccountId ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                  请选择账号查看队列。
                </div>
              ) : (
                <div className="h-full min-h-0 flex-1">
                  <CalendarView
                    tasks={tasks}
                    workspacePath={workspacePath}
                    onTasksUpdated={patchTasksInState}
                    onTasksCreated={(created) => {
                      if (created.length === 0) return
                      const createdIds = new Set(created.map((t) => t.id))
                      setTasks((prev) => {
                        const remaining = prev.filter((t) => !createdIds.has(t.id))
                        return [...created, ...remaining]
                      })
                    }}
                    onTasksDeleted={(deletedIds) => {
                      const setIds = new Set(deletedIds)
                      setTasks((prev) => prev.filter((t) => !setIds.has(t.id)))
                    }}
                  />
                </div>
              )
            ) : !activeAccountId ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                请选择账号查看队列。
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                当前账号队列为空。
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isAllFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-zinc-200">全选</span>
                    </div>
                    <div className="text-sm text-zinc-400">已选择 {stageSelectedCount} 条</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950">
                      <button
                        type="button"
                        onClick={() => handleChangeStage('pending')}
                        className={cn(
                          'px-3 py-1.5 text-sm transition',
                          activeStage === 'pending'
                            ? 'bg-zinc-900/50 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-900/30 hover:text-zinc-200'
                        )}
                      >
                        待处理
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChangeStage('published')}
                        className={cn(
                          'px-3 py-1.5 text-sm transition',
                          activeStage === 'published'
                            ? 'bg-zinc-900/50 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-900/30 hover:text-zinc-200'
                        )}
                      >
                        已发布
                      </button>
                    </div>

                    {activeStage === 'pending' ? (
                      <Button variant="outline" onClick={openSmartSchedule} disabled={stageSelectedCount === 0}>
                        🕒 批量排期
                      </Button>
                    ) : null}

                    {selectedTaskIds.size > 0 ? (
                      <Button
                        variant="destructive"
                        onClick={() => void deleteSelectedTasks()}
                        disabled={Boolean(deletingTaskId)}
                      >
                        🗑️ 删除记录
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <div className="flex flex-col gap-2">
                    {filteredTasks.map((task) => {
                      const isSelected = selectedTaskIds.has(task.id)
                      const isVideo = task.mediaType === 'video'
                      const taskErrorText = (task.errorMsg || task.errorMessage || '').trim()
                      return (
                        <div
                          key={task.id}
                          onClick={() => toggleSelectedTask(task.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') toggleSelectedTask(task.id)
                          }}
                          role="button"
                          tabIndex={0}
                          className={cn(
                            'flex w-full overflow-hidden gap-3 rounded-lg border p-3 text-left transition-colors',
                            isSelected
                              ? 'border-zinc-300 bg-zinc-900/30'
                              : 'border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/20'
                          )}
                        >
                          <div className="flex shrink-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectedTask(task.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4"
                            />
                            <div className="relative h-14 w-14 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                              {task.images?.[0] ? (
                                <img
                                  src={resolveLocalImage(task.images[0], workspacePath)}
                                  alt={task.title || task.id}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
                                  {isVideo ? <Video className="h-6 w-6" /> : null}
                                </div>
                              )}
                              {isVideo ? (
                                <div className="absolute ml-1 mt-1 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  <Video className="h-3 w-3" />
                                  <span>视频</span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold text-zinc-100">
                                  {task.title ? task.title : '（无标题）'}
                                </div>
                                {task.status === 'failed' && taskErrorText && (
                                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-red-400">
                                    <span className="shrink-0 rounded bg-red-500/10 px-1 py-0.5 font-bold uppercase">
                                    错误
                                    </span>
                                    <span className="truncate">{taskErrorText}</span>
                                  </div>
                                )}
                                {task.status === 'publish_failed' && (
                                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-red-400">
                                    <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 font-bold uppercase text-white">
                                    发布失败
                                    </span>
                                    {taskErrorText && <span className="truncate">{taskErrorText}</span>}
                                  </div>
                                )}
                                {task.scheduledAt ? (
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-sky-200">
                                    <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 font-bold">
                                    🕒 排期中
                                    </span>
                                    <span className="group inline-flex min-w-0 items-center gap-1 pr-0.5">
                                      <span className="truncate font-semibold">
                                        🕒 排期: {new Date(task.scheduledAt).toLocaleString()}
                                      </span>
                                      <span className="inline-flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            openSingleSchedule(task)
                                          }}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900/40 hover:text-zinc-50"
                                          aria-label="修改排期"
                                          title="修改排期"
                                        >
                                          <Settings className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void handleCancelScheduleForTask(task.id)
                                          }}
                                          disabled={cancelingScheduleTaskId === task.id}
                                          className={cn(
                                            'inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition',
                                            'hover:bg-zinc-900/40 hover:text-red-400',
                                            'disabled:cursor-not-allowed disabled:opacity-50'
                                          )}
                                          aria-label="取消排期"
                                          title="取消排期"
                                        >
                                          <X className="h-4 w-4" />
                                        </button>
                                      </span>
                                    </span>
                                  </div>
                                ) : null}
                                <div className="mt-0.5 truncate text-xs text-zinc-400">
                                  {task.productName ? `商品：${task.productName}` : '商品：无'}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-zinc-500">
                                  {task.images?.length ? `图片：${task.images.length} 张` : '图片：0 张'}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {task.status === 'failed' ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleRetryTask(task.id)
                                    }}
                                    disabled={Boolean(retryingTaskId)}
                                  >
                                    重试
                                  </Button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void handleDeleteTask(task.id)
                                  }}
                                  disabled={Boolean(deletingTaskId)}
                                  className={cn(
                                    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-zinc-500 transition',
                                    'hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300',
                                    'disabled:cursor-not-allowed disabled:opacity-50'
                                  )}
                                  aria-label="删除任务"
                                  title="删除任务"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-400">
                              {task.content ? task.content : '（无正文）'}
                            </div>
                            <div className="mt-2 truncate text-[11px] text-zinc-600">{task.id}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {isSmartScheduleOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setIsSmartScheduleOpen(false)}
          role="presentation"
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()} role="presentation">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>🕒 批量排期</CardTitle>
                <CardDescription>按当前列表顺序：起始时间 + N × 间隔分钟。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="text-sm text-zinc-200">起始时间</div>
                  <input
                    type="datetime-local"
                    value={smartScheduleStartLocal}
                    onChange={(e) => setSmartScheduleStartLocal(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                </div>

                {stageSelectedCount > 1 ? (
                  <div className="flex flex-col gap-2">
                    <div className="text-sm text-zinc-200">连续发布间隔（分钟）</div>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={smartScheduleIntervalMins}
                      onChange={(e) => setSmartScheduleIntervalMins(Number(e.target.value))}
                      className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                    />
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsSmartScheduleOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={() => void handleConfirmSmartSchedule()}>确认</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {isSingleScheduleOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setIsSingleScheduleOpen(false)}
          role="presentation"
        >
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()} role="presentation">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>🕒 修改排期</CardTitle>
                <CardDescription>仅修改当前这条任务的排期时间。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="text-sm text-zinc-200">排期时间</div>
                  <input
                    type="datetime-local"
                    value={singleScheduleLocal}
                    onChange={(e) => setSingleScheduleLocal(e.target.value)}
                    className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsSingleScheduleOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={() => void handleConfirmSingleSchedule()} disabled={Boolean(singleScheduleSavingTaskId)}>
                    {singleScheduleSavingTaskId ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        保存中...
                      </>
                    ) : (
                      '保存'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { AutoPublishView }
