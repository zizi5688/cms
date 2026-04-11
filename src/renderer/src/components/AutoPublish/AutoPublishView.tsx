import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import {
  LogIn,
  Minimize2,
  Pencil,
  RefreshCw,
  Settings,
  Trash2,
  UserPlus,
  Video,
  X
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { formatTaskProductSummary } from '@renderer/lib/cmsTaskProductHelpers'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { CalendarView } from '@renderer/modules/MediaMatrix/CalendarView'
import { useCmsStore } from '@renderer/store/useCmsStore'
import type { CmsChromeProfileRecord } from '../../../../shared/cmsChromeProfileTypes'
import { resolveWorkshopAccountId } from '../modules/workshopProductSelectionHelpers'

const CMS_PRODUCTS_SYNCED_EVENT = 'cms.products.synced'

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

function filterTasksByStage(
  tasks: CmsPublishTask[],
  stage: 'pending' | 'published'
): CmsPublishTask[] {
  if (stage === 'published') return tasks.filter((task) => task.status === 'published')
  return tasks.filter((task) => task.status !== 'published')
}

function publishStepStateText(state: CmsPublishSessionStepState): string {
  if (state === 'done') return '已完成'
  if (state === 'active') return '进行中'
  if (state === 'error') return '已中止'
  return '等待中'
}

function resolvePublishSessionHighlight(snapshot: CmsPublishSessionSnapshot | null): {
  activeStepLabel: string
  message: string
} | null {
  if (!snapshot) return null
  const activeStep = snapshot.steps.find((step) => step.state === 'active')
  return {
    activeStepLabel: activeStep?.label || '发布中',
    message: snapshot.error || snapshot.message || '任务正在执行中'
  }
}

function AutoPublishView(): React.JSX.Element {
  const addLog = useCmsStore((s) => s.addLog)
  const workspacePath = useCmsStore((s) => s.workspacePath)
  const publishMode = useCmsStore((s) => s.config.publishMode)
  const defaultStartTime = useCmsStore((s) => s.preferences.defaultStartTime)
  const defaultInterval = useCmsStore((s) => s.preferences.defaultInterval)
  const preferredAccountId = useCmsStore((s) => s.preferredAccountId)
  const setPreferredAccountId = useCmsStore((s) => s.setPreferredAccountId)

  const [accounts, setAccounts] = useState<CmsAccountRecord[]>([])
  const [cmsProfiles, setCmsProfiles] = useState<CmsChromeProfileRecord[]>([])
  const [activeAccountId, setActiveAccountId] = useState('')
  const [tasks, setTasks] = useState<CmsPublishTask[]>([])
  const viewMode: 'schedule' = 'schedule'
  const [viewSpan, setViewSpan] = useState<4 | 7>(4)
  const isScheduleMode = true
  const [activeStage, setActiveStage] = useState<'pending' | 'published'>('pending')
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set())
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false)
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [isLoadingCmsProfiles, setIsLoadingCmsProfiles] = useState(false)
  const [isCreatingCmsProfile, setIsCreatingCmsProfile] = useState(false)
  const [isRenamingCmsProfile, setIsRenamingCmsProfile] = useState(false)
  const [isSyncingProducts, setIsSyncingProducts] = useState(false)
  const [bindingCmsProfileAccountId, setBindingCmsProfileAccountId] = useState('')
  const [verifyingCmsProfileAccountId, setVerifyingCmsProfileAccountId] = useState('')
  const [deletingTaskId, setDeletingTaskId] = useState('')
  const [retryingTaskId, setRetryingTaskId] = useState('')
  const [testingTaskId, setTestingTaskId] = useState('')
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
  const [publishSession, setPublishSession] = useState<CmsPublishSessionSnapshot | null>(null)
  const [publishNotice, setPublishNotice] = useState('')
  const [isPublishSessionHidden, setIsPublishSessionHidden] = useState(false)

  const isLoadingAccountsRef = useRef(false)
  const isLoadingTasksRef = useRef(false)
  const publishSessionDismissTimerRef = useRef<number | null>(null)
  const publishSessionIdRef = useRef<string | null>(null)

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
  const visibleCmsProfiles = useMemo(() => {
    const boundProfileIds = new Set(
      accounts
        .map((account) => account.cmsProfileId)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )

    return cmsProfiles
      .filter((profile) => profile.purpose !== 'gateway')
      .filter((profile) => {
        const nickname = profile.nickname.trim()
        if (nickname) return true
        if (profile.xhsLoggedIn) return true
        if (boundProfileIds.has(profile.id)) return true
        return false
      })
      .sort((left, right) => left.profileDir.localeCompare(right.profileDir, 'zh-CN'))
  }, [accounts, cmsProfiles])
  const activePublishQueueTaskId = publishSession?.queueTaskId?.trim() ?? ''
  const publishSessionHighlight = useMemo(
    () => resolvePublishSessionHighlight(publishSession),
    [publishSession]
  )

  const loadAccounts = useCallback(async (): Promise<void> => {
    if (isLoadingAccountsRef.current) return
    isLoadingAccountsRef.current = true
    setIsLoadingAccounts(true)
    try {
      const list = await window.api.cms.account.list()
      setAccounts(list)
      setActiveAccountId((prev) =>
        resolveWorkshopAccountId({
          accounts: list,
          currentAccountId: prev,
          preferredAccountId
        })
      )
    } catch (error) {
      addLog(`[媒体矩阵] 拉取账号失败：${String(error)}`)
    } finally {
      setIsLoadingAccounts(false)
      isLoadingAccountsRef.current = false
    }
  }, [addLog, preferredAccountId])

  const loadCmsProfiles = useCallback(async (): Promise<void> => {
    setIsLoadingCmsProfiles(true)
    try {
      const list = await window.api.cms.account.listCmsProfiles()
      setCmsProfiles(list)
    } catch (error) {
      addLog(`[媒体矩阵] 读取 CMS Chrome Profiles 失败：${String(error)}`)
    } finally {
      setIsLoadingCmsProfiles(false)
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
    if (publishMode !== 'cdp') return
    void loadCmsProfiles()
  }, [loadCmsProfiles, publishMode])

  useEffect(() => {
    void loadTasks(activeAccountId)
    setActiveStage('pending')
    setSelectedTaskIds(new Set())
  }, [activeAccountId, loadTasks])

  useEffect(() => {
    const normalizedAccountId = activeAccountId.trim()
    if (!normalizedAccountId) return
    setPreferredAccountId(normalizedAccountId)
  }, [activeAccountId, setPreferredAccountId])

  useEffect(() => {
    return window.api.cms.task.onUpdated((task) => {
      const activeId = activeAccountId.trim()
      if (!activeId || task.accountId !== activeId) return
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    })
  }, [activeAccountId])

  useEffect(() => {
    const clearDismissTimer = (): void => {
      if (publishSessionDismissTimerRef.current !== null) {
        window.clearTimeout(publishSessionDismissTimerRef.current)
        publishSessionDismissTimerRef.current = null
      }
    }

    const unsubscribe = window.api.cms.publisher.onSession((payload) => {
      clearDismissTimer()

      if (payload.status === 'failed') {
        publishSessionIdRef.current = null
        setPublishSession(null)
        setIsPublishSessionHidden(false)
        const errorText = (
          payload.error ||
          payload.message ||
          '发布失败，请检查任务后重新排期。'
        ).trim()
        if (errorText) {
          setPublishNotice(`发布已停止：${errorText}`)
          addLog(`[媒体矩阵] 发布已停止：${errorText}`)
        }
        return
      }

      if (publishSessionIdRef.current !== payload.sessionId) {
        setIsPublishSessionHidden(false)
      }
      publishSessionIdRef.current = payload.sessionId
      setPublishNotice('')
      setPublishSession(payload)

      if (payload.status === 'succeeded') {
        publishSessionDismissTimerRef.current = window.setTimeout(() => {
          publishSessionIdRef.current =
            publishSessionIdRef.current === payload.sessionId ? null : publishSessionIdRef.current
          setPublishSession((current) =>
            current?.sessionId === payload.sessionId ? null : current
          )
          setIsPublishSessionHidden((current) =>
            publishSessionIdRef.current === null ? false : current
          )
          publishSessionDismissTimerRef.current = null
        }, 1200)
      }
    })

    return () => {
      clearDismissTimer()
      unsubscribe()
    }
  }, [addLog])

  useEffect(() => {
    if (!publishNotice) return
    const timer = window.setTimeout(() => setPublishNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [publishNotice])

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
    const confirmed = window.confirm(
      `确定删除已选 ${ids.length} 条记录？仅删除本地记录，不影响小红书端。`
    )
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
      const datePart = now.toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const timePart = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      const name = `小红书账号 ${datePart} ${timePart}`
      const created = await window.api.cms.account.create(name)
      setActiveAccountId(created.id)
      if (publishMode === 'electron') {
        await window.api.cms.account.login(created.id)
      }
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
      setPreferredAccountId(accountId)
      window.dispatchEvent(
        new CustomEvent(CMS_PRODUCTS_SYNCED_EVENT, {
          detail: { accountId, products }
        })
      )
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
      if (publishMode === 'cdp') {
        await window.api.cms.account.openCmsProfileLogin(normalized)
        addLog(`[媒体矩阵] 已打开 CMS Chrome 登录窗口：${normalized}`)
      } else {
        await window.api.cms.account.login(normalized)
        addLog(`[媒体矩阵] 已打开登录窗口：${normalized}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`打开登录窗口失败：${message}`)
    }
  }

  const handleBindCmsProfile = async (accountId: string, cmsProfileId: string | null): Promise<void> => {
    const normalizedAccountId = accountId.trim()
    if (!normalizedAccountId) return
    const currentAccount = accounts.find((account) => account.id === normalizedAccountId) ?? null
    if (!currentAccount) return
    const nextProfileId =
      typeof cmsProfileId === 'string' && cmsProfileId.trim() ? cmsProfileId.trim() : null

    if (currentAccount.cmsProfileId === nextProfileId) {
      return
    }

    if (currentAccount.cmsProfileId && nextProfileId && currentAccount.cmsProfileId !== nextProfileId) {
      const confirmed = window.confirm(
        `当前账号已绑定 ${currentAccount.cmsProfileId}。\n确定要改绑到 ${nextProfileId} 吗？`
      )
      if (!confirmed) return
    }

    const occupiedBy = nextProfileId
      ? accounts.find(
          (account) => account.id !== normalizedAccountId && account.cmsProfileId === nextProfileId
        ) ?? null
      : null
    if (occupiedBy) {
      const confirmed = window.confirm(
        `${nextProfileId} 当前已绑定给账号“${occupiedBy.name}”。\n继续后会自动从原账号解绑，并改绑到当前账号。\n确定继续吗？`
      )
      if (!confirmed) return
    }

    if (!nextProfileId && currentAccount.cmsProfileId) {
      const confirmed = window.confirm(`确定要解除当前绑定 ${currentAccount.cmsProfileId} 吗？`)
      if (!confirmed) return
    }

    setBindingCmsProfileAccountId(normalizedAccountId)
    try {
      await window.api.cms.account.bindCmsProfile(normalizedAccountId, nextProfileId)
      await loadAccounts()
      addLog(
        `[媒体矩阵] ${
          nextProfileId ? `已绑定 CMS Profile：${nextProfileId}` : '已清除 CMS Profile 绑定'
        }`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`绑定 CMS Profile 失败：${message}`)
    } finally {
      setBindingCmsProfileAccountId('')
    }
  }

  const handleVerifyCmsProfile = async (account: CmsAccountRecord): Promise<void> => {
    const normalizedAccountId = account.id.trim()
    if (!normalizedAccountId) return
    setVerifyingCmsProfileAccountId(normalizedAccountId)
    try {
      const result = await window.api.cms.account.verifyCmsProfileLogin(normalizedAccountId)
      await Promise.all([loadAccounts(), loadCmsProfiles()])
      const summary = result.loggedIn
        ? `✅ ${result.profileId} 登录有效`
        : `❌ ${result.profileId} 未登录：${result.reason}`
      addLog(`[媒体矩阵] ${summary}`)
      window.alert(`${summary}\n${result.finalUrl}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`验证登录态失败：${message}`)
    } finally {
      setVerifyingCmsProfileAccountId('')
    }
  }

  const handleCreateCmsProfile = async (account: CmsAccountRecord): Promise<void> => {
    const normalizedAccountId = account.id.trim()
    if (!normalizedAccountId || isCreatingCmsProfile) return
    const nicknameInput = window.prompt(
      '输入新 Profile 的昵称（可留空，后续也可以再改名）',
      ''
    )
    if (nicknameInput === null) return

    setIsCreatingCmsProfile(true)
    try {
      const created = await window.api.cms.account.createCmsProfile(nicknameInput.trim())
      await window.api.cms.account.bindCmsProfile(normalizedAccountId, created.id)
      await Promise.all([loadAccounts(), loadCmsProfiles()])
      addLog(`[媒体矩阵] 已新建并绑定 CMS Profile：${created.nickname || created.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`新建 CMS Profile 失败：${message}`)
    } finally {
      setIsCreatingCmsProfile(false)
    }
  }

  const handleRenameCmsProfile = async (profileId: string): Promise<void> => {
    const normalizedProfileId = profileId.trim()
    if (!normalizedProfileId || isRenamingCmsProfile) return
    const current =
      cmsProfiles.find((profile) => profile.id === normalizedProfileId) ??
      visibleCmsProfiles.find((profile) => profile.id === normalizedProfileId) ??
      null
    if (!current) return

    const nextNickname = window.prompt('输入新的 Profile 昵称', current.nickname || current.id)
    if (nextNickname === null) return
    const normalizedNickname = nextNickname.trim()
    if (!normalizedNickname) {
      window.alert('Profile 昵称不能为空')
      return
    }

    setIsRenamingCmsProfile(true)
    try {
      await window.api.cms.account.renameCmsProfile(normalizedProfileId, normalizedNickname)
      await loadCmsProfiles()
      addLog(`[媒体矩阵] 已重命名 CMS Profile：${normalizedNickname}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`重命名 CMS Profile 失败：${message}`)
    } finally {
      setIsRenamingCmsProfile(false)
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

  const handleTestPublish = useCallback(
    async (task: CmsPublishTask): Promise<void> => {
      if (testingTaskId) return
      if (task.status === 'published') {
        window.alert('已发布任务不需要再做测试发布。')
        return
      }

      const confirmed = window.confirm(
        '将执行一次“不会真发”的测试发布：会自动打开发布页并填充内容，但不会点击最终发布按钮。\n确定继续吗？'
      )
      if (!confirmed) return

      setTestingTaskId(task.id)
      try {
        const result = await window.api.cms.publisher.publish(task.accountId, {
          title: task.title,
          content: task.content,
          mediaType: task.mediaType,
          videoPath: task.videoPath,
          videoCoverMode: task.videoCoverMode,
          images: task.images,
          productId: task.productId,
          productName: task.productName,
          linkedProducts: task.linkedProducts,
          dryRun: true,
          mode: 'immediate'
        })
        if (!result.success) {
          throw new Error(result.error || '测试发布失败')
        }
        addLog('[媒体矩阵] 测试发布执行完成：已走到发布前最后一步，未真正发布。')
        window.alert('测试发布执行完成：已走到发布前最后一步，未真正发布。')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.alert(`测试发布失败：${message}`)
      } finally {
        setTestingTaskId('')
      }
    },
    [addLog, testingTaskId]
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
    setSmartScheduleStartLocal(
      (prev) =>
        prev || toLocalDatetimeInputValue(withDefaultStartTime(new Date(), defaultStartTime))
    )
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

    const intervalMins =
      selectedInStage.length > 1 ? Math.max(0, Number(smartScheduleIntervalMins) || 0) : 0
    const updates = selectedInStage.map((task, index) => {
      return { id: task.id, updates: { scheduledAt: startMs + index * intervalMins * 60_000 } }
    })

    try {
      const updateBatch = window.api.cms.task.updateBatch as unknown as (
        patches: unknown
      ) => Promise<CmsPublishTask[]>
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
      {publishNotice ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {publishNotice}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        {isScheduleMode ? null : (
          <Card className="flex min-h-0 flex-col lg:basis-1/4">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle>账号管理</CardTitle>
                <CardDescription>选择账号查看对应队列。</CardDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void loadAccounts()}
                  disabled={isLoadingAccounts}
                >
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
                    const isOnline = account.status === 'logged_in'
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
                          isActive
                            ? 'border-zinc-300 bg-zinc-900/30'
                            : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-900/20'
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
                              <div className="truncate text-sm font-medium text-zinc-50">
                                {account.name}
                              </div>
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
                          <span className="text-xs text-zinc-400">
                            {isOnline ? '在线' : account.status === 'expired' ? '已过期' : '离线'}
                          </span>
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
                            {publishMode === 'cdp' ? '登录/重登' : '登录'}
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

        <Card
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            isScheduleMode ? 'lg:basis-full' : 'lg:basis-3/4'
          )}
        >
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            {isScheduleMode ? (
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
                  {activeAccount ? (
                    <div className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 px-2">
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full',
                          activeAccount.status === 'logged_in' ? 'bg-emerald-400' : 'bg-red-400'
                        )}
                      />
                      <span className="text-xs text-zinc-400">
                        {activeAccount.status === 'logged_in'
                          ? '在线'
                          : activeAccount.status === 'expired'
                            ? '已过期'
                            : '离线'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleLogin(activeAccount.id)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-xs text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-zinc-200"
                        aria-label="登录"
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        {publishMode === 'cdp' ? '登录/重登' : '登录'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAccount(activeAccount.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-500 transition hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-red-400"
                        aria-label="删除账号"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => beginRename(activeAccount)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-500 transition hover:border-zinc-700 hover:bg-zinc-900/40 hover:text-zinc-200"
                        aria-label="重命名账号"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => void loadAccounts()}
                      disabled={isLoadingAccounts}
                      aria-label="刷新账号"
                    >
                      <RefreshCw
                        className={cn('h-4 w-4', isLoadingAccounts ? 'animate-spin' : '')}
                      />
                    </Button>
                    <Button
                      size="icon"
                      onClick={() => void handleAddAccount()}
                      aria-label="新增账号"
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {activeAccount && editingAccountId === activeAccount.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editingAccountName}
                      onChange={(e) => setEditingAccountName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void saveRename()
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelRename()
                        }
                      }}
                      className="h-9 w-[280px] max-w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                      placeholder="输入新的账号名称"
                    />
                    <Button type="button" variant="outline" onClick={() => void saveRename()}>
                      保存
                    </Button>
                    <Button type="button" variant="outline" onClick={cancelRename}>
                      取消
                    </Button>
                  </div>
                ) : null}
                {activeAccount && publishMode === 'cdp' ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-zinc-400">CMS Chrome Profile</div>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={activeAccount.cmsProfileId ?? ''}
                            onChange={(event) =>
                              void handleBindCmsProfile(
                                activeAccount.id,
                                event.target.value.trim() || null
                              )
                            }
                            disabled={bindingCmsProfileAccountId === activeAccount.id}
                            className="h-9 min-w-[260px] rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
                          >
                            <option value="">未绑定</option>
                            {visibleCmsProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {(profile.nickname || profile.id) +
                                  ` · ${profile.profileDir} · ${profile.xhsLoggedIn ? '已登录' : '未登录'}`}
                              </option>
                            ))}
                          </select>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void loadCmsProfiles()}
                            disabled={isLoadingCmsProfiles}
                          >
                            {isLoadingCmsProfiles ? '刷新中...' : '刷新 Profiles'}
                          </Button>
                          <Button
                            type="button"
                            onClick={() => void handleCreateCmsProfile(activeAccount)}
                            disabled={isCreatingCmsProfile}
                          >
                            {isCreatingCmsProfile ? '新建中...' : '新建 Profile'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              activeAccount.cmsProfileId
                                ? void handleRenameCmsProfile(activeAccount.cmsProfileId)
                                : void 0
                            }
                            disabled={!activeAccount.cmsProfileId || isRenamingCmsProfile}
                          >
                            {isRenamingCmsProfile ? '改名中...' : '改名'}
                          </Button>
                          <Button
                            type="button"
                            onClick={() => void handleLogin(activeAccount.id)}
                            disabled={!activeAccount.cmsProfileId}
                          >
                            登录/重新登录
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleVerifyCmsProfile(activeAccount)}
                            disabled={
                              !activeAccount.cmsProfileId ||
                              verifyingCmsProfileAccountId === activeAccount.id
                            }
                          >
                            {verifyingCmsProfileAccountId === activeAccount.id
                              ? '验证中...'
                              : '验证登录态'}
                          </Button>
                        </div>
                      </div>
                      <div className="text-xs text-zinc-400">
                        {activeAccount.cmsProfileId
                          ? `当前绑定：${
                              cmsProfiles.find((profile) => profile.id === activeAccount.cmsProfileId)?.nickname ||
                              activeAccount.cmsProfileId
                            }。发布任务会直接使用这个专用 Profile。`
                          : '请先新建或绑定一个 CMS 专用 Profile，再进行登录或发布。'}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {activeAccount ? activeAccount.name : '队列任务'}
                </CardTitle>
                <CardDescription>
                  {activeAccount
                    ? '账号队列任务列表（按 createdAt 倒序）。'
                    : '请选择账号查看队列。'}
                </CardDescription>
              </div>
            )}
            <div className="flex shrink-0 items-center gap-2">
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
                  <Button
                    variant="outline"
                    onClick={() => void handleSyncProducts()}
                    disabled={isSyncingProducts || publishMode === 'cdp'}
                  >
                    <RefreshCw className={cn('h-4 w-4', isSyncingProducts ? 'animate-spin' : '')} />
                    同步商品
                  </Button>
                </>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {viewMode === 'schedule' ? (
              !activeAccountId ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                  请选择账号查看滚动日程。
                </div>
              ) : (
                <div className="h-full min-h-0 flex-1">
                  <CalendarView
                    tasks={tasks}
                    workspacePath={workspacePath}
                    viewSpan={viewSpan}
                    onViewSpanChange={setViewSpan}
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
                      <Button
                        variant="outline"
                        onClick={openSmartSchedule}
                        disabled={stageSelectedCount === 0}
                      >
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
                      const isPublishingTask =
                        task.status === 'processing' || activePublishQueueTaskId === task.id
                      const publishTaskHint =
                        isPublishingTask && activePublishQueueTaskId === task.id
                          ? publishSessionHighlight
                          : null
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
                            isPublishingTask
                              ? 'border-sky-500/40 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.12),0_0_28px_rgba(14,165,233,0.12)]'
                              : isSelected
                                ? 'border-zinc-300 bg-zinc-900/30'
                                : 'border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/20',
                            isSelected && isPublishingTask ? 'ring-1 ring-sky-300/40' : null
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
                                {isPublishingTask ? (
                                  <div className="mt-1 flex items-center gap-2 text-[11px] text-sky-100">
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 font-bold">
                                      <span className="relative flex h-2 w-2">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-300 opacity-70" />
                                        <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-300" />
                                      </span>
                                      执行中
                                    </span>
                                    <span className="truncate font-medium text-sky-200/90">
                                      {publishTaskHint?.activeStepLabel || '后台发布中'}
                                    </span>
                                  </div>
                                ) : null}
                                {publishTaskHint?.message ? (
                                  <div className="mt-1 truncate text-[11px] text-sky-200/75">
                                    {publishTaskHint.message}
                                  </div>
                                ) : null}
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
                                    {taskErrorText && (
                                      <span className="truncate">{taskErrorText}</span>
                                    )}
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
                                  {`商品：${formatTaskProductSummary({
                                    linkedProducts: task.linkedProducts,
                                    productName: task.productName,
                                    emptyLabel: '无'
                                  })}`}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-zinc-500">
                                  {task.images?.length
                                    ? `图片：${task.images.length} 张`
                                    : '图片：0 张'}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {publishMode === 'cdp' &&
                                (task.status === 'pending' || task.status === 'scheduled') ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleTestPublish(task)
                                    }}
                                    disabled={Boolean(testingTaskId)}
                                    title="自动走到发布前最后一步，但不会真正发布"
                                    className="border-amber-500/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 hover:text-amber-50"
                                  >
                                    {testingTaskId === task.id ? '测试中…' : '测试发布'}
                                  </Button>
                                ) : null}
                                {task.status === 'failed' ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void handleRetryTask(task.id)
                                    }}
                                    disabled={Boolean(retryingTaskId) || Boolean(testingTaskId)}
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
                                  disabled={Boolean(deletingTaskId) || Boolean(testingTaskId)}
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

      {publishSession && !isPublishSessionHidden ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div
                  className={cn(
                    'text-xs font-semibold uppercase tracking-[0.24em]',
                    publishSession.status === 'succeeded' ? 'text-emerald-300' : 'text-sky-300'
                  )}
                >
                  {publishSession.status === 'succeeded' ? '发布完成' : '发布中'}
                </div>
                <div className="mt-2 truncate text-lg font-semibold text-zinc-50">
                  {publishSession.taskTitle || '（无标题）'}
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  {publishSession.accountName || publishSession.accountId}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-300">
                  {publishSession.mediaType === 'video' ? '视频任务' : '图文任务'}
                </div>
                <button
                  type="button"
                  onClick={() => setIsPublishSessionHidden(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/70 text-zinc-300 transition hover:border-sky-500/40 hover:bg-sky-500/10 hover:text-sky-200"
                  aria-label="隐藏发布进度弹窗"
                  title="隐藏弹窗（不影响发布）"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {publishSession.steps.map((step) => {
                const toneClass =
                  step.state === 'done'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                    : step.state === 'active'
                      ? 'border-sky-500/30 bg-sky-500/10 text-sky-100'
                      : step.state === 'error'
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                        : 'border-zinc-800 bg-zinc-900/50 text-zinc-400'
                const dotClass =
                  step.state === 'done'
                    ? 'bg-emerald-400'
                    : step.state === 'active'
                      ? 'bg-sky-400'
                      : step.state === 'error'
                        ? 'bg-rose-400'
                        : 'bg-zinc-600'

                return (
                  <div
                    key={step.key}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-3 py-2 text-sm',
                      toneClass
                    )}
                  >
                    <div className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dotClass)} />
                    <div className="min-w-0 flex-1 truncate">{step.label}</div>
                    <div className="shrink-0 text-xs font-medium">
                      {publishStepStateText(step.state)}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-200">
              {publishSession.error || publishSession.message}
            </div>

            <div className="mt-3 text-right text-xs text-zinc-500">
              隐藏弹窗不会中断当前发布任务
            </div>
          </div>
        </div>
      ) : null}

      {publishSession && isPublishSessionHidden ? (
        <div className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-zinc-800 bg-zinc-950/92 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300">
                {publishSession.status === 'succeeded' ? '发布完成' : '后台发布中'}
              </div>
              <div className="mt-1 truncate text-sm font-medium text-zinc-100">
                {publishSession.taskTitle || '（无标题）'}
              </div>
              <div className="mt-1 truncate text-xs text-zinc-400">
                {publishSession.error || publishSession.message}
              </div>
            </div>
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setIsPublishSessionHidden(false)}
                className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-100 transition hover:border-sky-400/50 hover:bg-sky-500/20"
              >
                展开
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                  <Button
                    onClick={() => void handleConfirmSingleSchedule()}
                    disabled={Boolean(singleScheduleSavingTaskId)}
                  >
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
