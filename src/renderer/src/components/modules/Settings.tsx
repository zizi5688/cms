import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Tabs } from '@renderer/components/ui/tabs'
import { resolveLocalGatewayPrimaryAction } from '@renderer/lib/localGatewayOverviewAction'
import { useCmsStore } from '@renderer/store/useCmsStore'
import { createEmptyAiRuntimeDefaults } from '../../../../shared/ai/aiProviderTypes'
import { normalizeCmsElectronPublishAction } from '../../../../shared/cmsChromeProfileTypes'
import type {
  LocalGatewayAccountStatus,
  LocalGatewayAccountSummary,
  LocalGatewayChromeProfile,
  LocalGatewayOverallStatus,
  LocalGatewayServiceStatus,
  LocalGatewayState,
  LocalGatewaySystemChromeProfile
} from '../../../../shared/localGatewayTypes'

import { AiProviderSettingsPanel } from './settings/AiProviderSettingsPanel'

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 15
  return Math.min(100, Math.max(0, Math.round(value)))
}

function clampSizePercent(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.min(10, Math.max(2, Math.round(value)))
}

function clampRetainDays(value: number): number {
  if (!Number.isFinite(value)) return 7
  return Math.max(1, Math.min(120, Math.floor(value)))
}

type DynamicWatermarkTrajectory =
  | 'smoothSine'
  | 'figureEight'
  | 'diagonalWrap'
  | 'largeEllipse'
  | 'pseudoRandom'

type TrajectoryOption = {
  value: DynamicWatermarkTrajectory
  label: string
  description: string
}

type AutoImportScanProgress = {
  mode: 'auto' | 'manual'
  phase: 'start' | 'progress' | 'done' | 'error'
  watchDir: string
  scannedFiles: number
  processedFiles: number
  importedFiles: number
  failedFiles: number
  skippedBaselineFiles: number
  skippedProcessedFiles: number
  skippedRetryFiles: number
  currentFile: string | null
  message?: string
}

const NOTE_RACE_DATA_RESET_EVENT = 'note-race:data-reset'
function formatDateTime(value: number | null): string {
  if (!Number.isFinite(Number(value))) return '--'
  const time = Number(value)
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const WATERMARK_TRAJECTORY_OPTIONS: TrajectoryOption[] = [
  {
    value: 'smoothSine',
    label: '方案 A · 柔和正弦漂移',
    description: '横向平移 + 纵向正弦起伏，轨迹柔和。'
  },
  { value: 'figureEight', label: '方案 B · 8字李萨如', description: '围绕中心画“∞”，闭环平滑。' },
  {
    value: 'diagonalWrap',
    label: '方案 C · 对角线回环',
    description: '沿对角方向巡航，越界后从对侧穿出。'
  },
  {
    value: 'largeEllipse',
    label: '方案 D · 大椭圆巡航',
    description: '贴近边缘大轨道运动，尽量避开核心画面。'
  },
  {
    value: 'pseudoRandom',
    label: '方案 E · 伪随机漫步',
    description: '叠加快慢波形成非线性游走（当前默认）。'
  }
]

function normalizeDynamicWatermarkTrajectory(value: unknown): DynamicWatermarkTrajectory {
  const normalized = String(value ?? '').trim()
  const matched = WATERMARK_TRAJECTORY_OPTIONS.find((option) => option.value === normalized)
  return matched?.value ?? 'pseudoRandom'
}

function positiveMod(value: number, divisor: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0) return 0
  return ((value % divisor) + divisor) % divisor
}

function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max <= min) return min
  return Math.max(min, Math.min(max, value))
}

function normalizeStorageMaintenanceStartTime(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return '02:30'
  return text
}

function formatBytes(bytes: number): string {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }
  const precision = current >= 100 ? 0 : current >= 10 ? 1 : 2
  return `${current.toFixed(precision)} ${units[index]}`
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

function unwrapElectronInvokeError(message: string): string {
  let next = String(message ?? '').trim()
  next = next.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  next = next.replace(/^Error:\s*/i, '')
  return next.trim()
}

function getLocalGatewayAccountStatusLabel(
  status: LocalGatewayAccountStatus | null | undefined
): string {
  return status ?? '待同步'
}

function getLocalGatewayAccountStatusClassName(
  status: LocalGatewayAccountStatus | null | undefined
): string {
  if (status === 'active') return 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200'
  if (status === 'cooldown') return 'border-amber-700/60 bg-amber-950/30 text-amber-200'
  if (status === 'disabled') return 'border-zinc-700 bg-zinc-900/80 text-zinc-300'
  return 'border-zinc-700 bg-zinc-900/70 text-zinc-300'
}

type LocalGatewayCapabilityTone = 'ready' | 'warning' | 'failure'

function getLocalGatewayOverviewPresentation(
  status: LocalGatewayOverallStatus | null | undefined
): {
  label: string
  dotClassName: string
  panelClassName: string
} {
  if (status === 'services_ready') {
    return {
      label: '网关运行中',
      dotClassName: 'bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]',
      panelClassName: 'border-emerald-800/60 bg-emerald-950/20'
    }
  }

  if (status === 'degraded' || status === 'starting') {
    return {
      label: status === 'starting' ? '网关启动中' : '部分服务异常',
      dotClassName: 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.18)]',
      panelClassName: 'border-amber-800/60 bg-amber-950/20'
    }
  }

  return {
    label: '网关未启动',
    dotClassName: 'bg-rose-400 shadow-[0_0_0_4px_rgba(251,113,133,0.18)]',
    panelClassName: 'border-rose-800/60 bg-rose-950/20'
  }
}

function getLocalGatewayCapabilityPresentation(input: {
  ready: boolean
  label: string
  tone?: LocalGatewayCapabilityTone
}): {
  label: string
  dotClassName: string
  textClassName: string
} {
  if (input.ready) {
    return {
      label: '正常',
      dotClassName: 'bg-emerald-400',
      textClassName: 'text-emerald-300'
    }
  }

  if (input.tone === 'failure') {
    return {
      label: input.label,
      dotClassName: 'bg-rose-400',
      textClassName: 'text-rose-300'
    }
  }

  return {
    label: input.label,
    dotClassName: 'bg-amber-400',
    textClassName: 'text-amber-300'
  }
}

function pickVolumePathFromText(text: string): string {
  const matched = String(text ?? '').match(/\/Volumes\/[^\s'"]+/)
  return matched ? matched[0] : ''
}

function normalizeStorageMaintenanceErrorMessage(
  error: unknown,
  input: { dryRun: boolean; archivePath: string }
): string {
  const raw = unwrapElectronInvokeError(extractErrorMessage(error))
  if (!raw) return '存储维护执行失败，请重试。'
  if (raw.includes('[存储维护]')) return raw

  const lowered = raw.toLowerCase()
  const looksLikePermissionIssue =
    lowered.includes('eacces') ||
    lowered.includes('permission denied') ||
    lowered.includes('operation not permitted')
  if (looksLikePermissionIssue) {
    const volumePath = pickVolumePathFromText(raw)
    const archivePath = input.archivePath.trim() || volumePath || '/Volumes/FeiniuDB/2026'
    const modeText = input.dryRun ? '演练（dry-run）' : '执行（real-run）'
    return (
      `[存储维护] 无法访问归档目录，已取消${modeText}。\n` +
      `归档目录：${archivePath}\n` +
      '请按以下步骤处理：\n' +
      '1) 在 Finder 中挂载飞牛共享（前往 -> 连接服务器）。\n' +
      `2) 确认该目录可访问：${archivePath}\n` +
      '3) 回到设置页后重试。'
    )
  }
  return raw
}

function Settings(): React.JSX.Element {
  const config = useCmsStore((s) => s.config)
  const addLog = useCmsStore((s) => s.addLog)
  const updateConfig = useCmsStore((s) => s.updateConfig)
  const preferences = useCmsStore((s) => s.preferences)
  const updatePreferences = useCmsStore((s) => s.updatePreferences)

  const [isTesting, setIsTesting] = useState(false)
  const [isScanningAutoImport, setIsScanningAutoImport] = useState(false)
  const [isResettingNoteRace, setIsResettingNoteRace] = useState(false)
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false)
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false)
  const [autoImportScanProgress, setAutoImportScanProgress] =
    useState<AutoImportScanProgress | null>(null)
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null)
  const [localGatewayState, setLocalGatewayState] = useState<LocalGatewayState | null>(null)
  const [localGatewayProfiles, setLocalGatewayProfiles] = useState<LocalGatewayChromeProfile[]>([])
  const [isLoadingLocalGatewayProfiles, setIsLoadingLocalGatewayProfiles] = useState(false)
  const [systemChromeProfiles, setSystemChromeProfiles] = useState<
    LocalGatewaySystemChromeProfile[]
  >([])
  const [isLoadingSystemChromeProfiles, setIsLoadingSystemChromeProfiles] = useState(false)
  const [localGatewayAccounts, setLocalGatewayAccounts] = useState<LocalGatewayAccountSummary[]>([])
  const [isSyncingLocalGatewayAccounts, setIsSyncingLocalGatewayAccounts] = useState(false)
  const [isRetryingLocalGateway, setIsRetryingLocalGateway] = useState(false)
  const [isInitializingLocalGateway, setIsInitializingLocalGateway] = useState(false)
  const [localGatewayInitializationOutput, setLocalGatewayInitializationOutput] = useState('')
  const [isManagingChatAccounts, setIsManagingChatAccounts] = useState(false)
  const [showAllChatProfiles, setShowAllChatProfiles] = useState(false)
  const [storageMaintenanceState, setStorageMaintenanceState] =
    useState<StorageMaintenanceState | null>(null)
  const [isStorageMaintenanceRunningNow, setIsStorageMaintenanceRunningNow] = useState(false)
  const [isStorageMaintenanceRollingBack, setIsStorageMaintenanceRollingBack] = useState(false)
  const [storageMaintenanceReason, setStorageMaintenanceReason] = useState('')
  const [storageMaintenanceRollbackRunId, setStorageMaintenanceRollbackRunId] = useState('')
  const [lastStorageMaintenanceSummary, setLastStorageMaintenanceSummary] =
    useState<StorageMaintenanceSummary | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [workspaceStatus, setWorkspaceStatus] = useState<'initialized' | 'uninitialized'>(
    'uninitialized'
  )
  const [settingsPage, setSettingsPage] = useState<'general' | 'aiProviders'>('general')
  const [previewTime, setPreviewTime] = useState(0)
  const exePickerRef = useRef<HTMLInputElement | null>(null)
  const pythonPickerRef = useRef<HTMLInputElement | null>(null)
  const scriptPickerRef = useRef<HTMLInputElement | null>(null)
  const skipFirstSaveRef = useRef(true)
  const skipFirstLocalGatewayAccountsSyncRef = useRef(true)
  const storageMaintenanceRunLockRef = useRef(false)
  const storageMaintenanceRollbackLockRef = useRef(false)
  const selectedTrajectory = normalizeDynamicWatermarkTrajectory(config.dynamicWatermarkTrajectory)
  const selectedChatChromeProfileDirectories = useMemo(() => {
    const next: string[] = []
    for (const value of config.localGateway.chromeProfileDirectories ?? []) {
      const normalized = String(value ?? '').trim()
      if (!normalized || next.includes(normalized)) continue
      next.push(normalized)
    }
    return next
  }, [config.localGateway.chromeProfileDirectories])
  const selectedLocalGatewayProfile = useMemo(
    () =>
      localGatewayProfiles.find(
        (profile) => profile.id === config.localGateway.gatewayCmsProfileId.trim()
      ) ?? null,
    [config.localGateway.gatewayCmsProfileId, localGatewayProfiles]
  )
  const displayedSystemChromeProfiles = useMemo(() => {
    const existing = new Set(systemChromeProfiles.map((profile) => profile.profileDirectory))
    const fallbackProfiles = selectedChatChromeProfileDirectories
      .filter((profileDirectory) => !existing.has(profileDirectory))
      .map((profileDirectory) => ({
        profileDirectory,
        displayName: profileDirectory,
        email: null,
        label: profileDirectory
      }))
    return [...systemChromeProfiles, ...fallbackProfiles]
  }, [selectedChatChromeProfileDirectories, systemChromeProfiles])
  const selectedSystemChromeProfiles = useMemo(
    () =>
      selectedChatChromeProfileDirectories.map((profileDirectory) => {
        return (
          displayedSystemChromeProfiles.find(
            (profile) => profile.profileDirectory === profileDirectory
          ) ?? {
            profileDirectory,
            displayName: profileDirectory,
            email: null,
            label: profileDirectory
          }
        )
      }),
    [displayedSystemChromeProfiles, selectedChatChromeProfileDirectories]
  )
  const selectedSystemChromeProfilesSyncKey = useMemo(
    () =>
      JSON.stringify(
        selectedSystemChromeProfiles.map((profile) => [
          profile.profileDirectory,
          profile.displayName,
          profile.email
        ])
      ),
    [selectedSystemChromeProfiles]
  )
  const localGatewayAccountsByProfileDirectory = useMemo(() => {
    return new Map(
      localGatewayAccounts
        .filter((account) => account.chromeProfileDirectory)
        .map((account) => [String(account.chromeProfileDirectory), account])
    )
  }, [localGatewayAccounts])
  const selectedChatProfilesWithAccounts = useMemo(
    () =>
      selectedSystemChromeProfiles.map((profile) => ({
        profile,
        account: localGatewayAccountsByProfileDirectory.get(profile.profileDirectory) ?? null
      })),
    [localGatewayAccountsByProfileDirectory, selectedSystemChromeProfiles]
  )
  const manageableSystemChromeProfiles = useMemo(() => {
    if (showAllChatProfiles) return displayedSystemChromeProfiles
    return displayedSystemChromeProfiles.filter(
      (profile) =>
        Boolean(profile.email) ||
        selectedChatChromeProfileDirectories.includes(profile.profileDirectory)
    )
  }, [displayedSystemChromeProfiles, selectedChatChromeProfileDirectories, showAllChatProfiles])
  const hiddenChatProfileCount = useMemo(
    () =>
      displayedSystemChromeProfiles.filter(
        (profile) =>
          !profile.email && !selectedChatChromeProfileDirectories.includes(profile.profileDirectory)
      ).length,
    [displayedSystemChromeProfiles, selectedChatChromeProfileDirectories]
  )
  const localGatewayServices = localGatewayState?.services ?? []
  const localGatewayServicesByName = useMemo(
    () => new Map(localGatewayServices.map((service) => [service.name, service] as const)),
    [localGatewayServices]
  )
  const adapterService = localGatewayServicesByName.get('adapter') ?? null
  const gatewayService = localGatewayServicesByName.get('gateway') ?? null
  const adminUiService = localGatewayServicesByName.get('adminUi') ?? null
  const cdpProxyService = localGatewayServicesByName.get('cdpProxy') ?? null
  const chromeDebugService = localGatewayServicesByName.get('chromeDebug') ?? null
  const overallLocalGatewayStatus =
    localGatewayState?.overallStatus ?? (config.localGateway.enabled ? 'failed' : 'disabled')
  const localGatewayOverview = useMemo(
    () => getLocalGatewayOverviewPresentation(overallLocalGatewayStatus),
    [overallLocalGatewayStatus]
  )
  const isChatCapabilityReady = Boolean(adapterService?.ok && gatewayService?.ok)
  const isFlowCapabilityReady = Boolean(cdpProxyService?.ok && chromeDebugService?.ok)
  const isAdminCapabilityReady = Boolean(adminUiService?.ok)
  const chatCapability = useMemo(() => {
    return getLocalGatewayCapabilityPresentation({
      ready: isChatCapabilityReady,
      label:
        adapterService?.message ??
        gatewayService?.message ??
        (config.localGateway.enabled ? '未启动' : '未启用'),
      tone:
        !config.localGateway.enabled || overallLocalGatewayStatus === 'unconfigured'
          ? 'warning'
          : 'failure'
    })
  }, [
    adapterService,
    config.localGateway.enabled,
    gatewayService,
    isChatCapabilityReady,
    overallLocalGatewayStatus
  ])
  const flowCapability = useMemo(() => {
    const missingChrome =
      cdpProxyService?.message?.includes('Chrome 未启动') ||
      chromeDebugService?.message?.includes('Chrome 未开启远程调试端口') ||
      chromeDebugService?.message?.includes('Chrome 未启动')
    return getLocalGatewayCapabilityPresentation({
      ready: isFlowCapabilityReady,
      label: !config.localGateway.startCdpProxy
        ? '未启用'
        : missingChrome
          ? 'Chrome 未启动'
          : (cdpProxyService?.message ?? chromeDebugService?.message ?? '未启动'),
      tone: missingChrome || !config.localGateway.startCdpProxy ? 'warning' : 'failure'
    })
  }, [
    cdpProxyService,
    chromeDebugService,
    config.localGateway.startCdpProxy,
    isFlowCapabilityReady
  ])
  const adminCapability = useMemo(() => {
    return getLocalGatewayCapabilityPresentation({
      ready: isAdminCapabilityReady,
      label: !config.localGateway.startAdminUi ? '未启用' : (adminUiService?.message ?? '未启动'),
      tone: config.localGateway.startAdminUi ? 'failure' : 'warning'
    })
  }, [adminUiService, config.localGateway.startAdminUi, isAdminCapabilityReady])
  const primaryLocalGatewayAction = useMemo(
    () =>
      resolveLocalGatewayPrimaryAction({
        overallStatus: overallLocalGatewayStatus,
        isChatCapabilityReady,
        isFlowCapabilityReady
      }),
    [isChatCapabilityReady, isFlowCapabilityReady, overallLocalGatewayStatus]
  )
  const isRestartRecommended = primaryLocalGatewayAction.isRestartStyle
  const isPrimaryLocalGatewayActionBusy = isInitializingLocalGateway
  const isPrimaryLocalGatewayActionDisabled =
    isInitializingLocalGateway || !config.localGateway.enabled
  const primaryLocalGatewayActionClassName = isRestartRecommended
    ? 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
    : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
  const primaryLocalGatewayHint = !config.localGateway.enabled
    ? '可在“高级设置”中启用本地网关管理。'
    : primaryLocalGatewayAction.isFlowRecoveryAction &&
        !config.localGateway.gatewayCmsProfileId.trim()
      ? '先在“高级设置”中选择或初始化 CMS Profile。'
      : overallLocalGatewayStatus === 'unconfigured'
        ? '先在“高级设置”中设置正确的网关安装目录。'
        : null

  useEffect(() => {
    const startedAt = performance.now()
    const timer = window.setInterval(() => {
      setPreviewTime((performance.now() - startedAt) / 1000)
    }, 33)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const previewMotion = useMemo(() => {
    const frameWidth = 360
    const frameHeight = 204
    const stickerWidth = Math.round(100 + clampSizePercent(config.dynamicWatermarkSize) * 3)
    const stickerHeight = 30
    const xMax = Math.max(1, frameWidth - stickerWidth)
    const yMax = Math.max(1, frameHeight - stickerHeight)
    const t = previewTime

    let x = 0
    let y = 0
    if (selectedTrajectory === 'smoothSine') {
      x = positiveMod(t * 13.3333333, xMax)
      y = yMax / 2 + yMax * 0.4 * Math.sin(t * 0.5)
    } else if (selectedTrajectory === 'figureEight') {
      x = xMax / 2 + xMax * 0.4 * Math.cos(t * 0.3333333)
      y = yMax / 2 + yMax * 0.4 * Math.sin(t * 0.6666667)
    } else if (selectedTrajectory === 'diagonalWrap') {
      x = positiveMod(t * 10, xMax)
      y = positiveMod(t * 10 * (frameHeight / frameWidth), yMax)
    } else if (selectedTrajectory === 'largeEllipse') {
      x = xMax / 2 + xMax * 0.45 * Math.cos(t * 0.2666667)
      y = yMax / 2 + yMax * 0.45 * Math.sin(t * 0.2666667)
    } else {
      x = xMax / 2 + xMax * 0.25 * Math.sin(t * 0.3666667) + xMax * 0.15 * Math.cos(t * 0.7666667)
      y = yMax / 2 + yMax * 0.25 * Math.cos(t * 0.4333333) + yMax * 0.15 * Math.sin(t * 0.9666667)
    }

    return {
      frameWidth,
      frameHeight,
      stickerWidth,
      stickerHeight,
      x: clampRange(x, 0, xMax),
      y: clampRange(y, 0, yMax)
    }
  }, [config.dynamicWatermarkSize, previewTime, selectedTrajectory])

  const isFeishuConfigReady = useMemo(() => {
    return (
      isNonEmpty(config.appId) &&
      isNonEmpty(config.appSecret) &&
      isNonEmpty(config.baseToken) &&
      isNonEmpty(config.tableId)
    )
  }, [config])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const savedTools = await window.electronAPI.getConfig()
        if (!cancelled && savedTools) {
          updateConfig({
            publishMode: savedTools.publishMode ?? 'electron',
            electronPublishAction: normalizeCmsElectronPublishAction(savedTools.electronPublishAction),
            chromeExecutablePath: savedTools.chromeExecutablePath ?? '',
            cmsChromeDataDir: savedTools.cmsChromeDataDir ?? '',
            aiProvider:
              typeof savedTools.aiProvider === 'string' && savedTools.aiProvider.trim()
                ? savedTools.aiProvider.trim()
                : 'grsai',
            aiBaseUrl: savedTools.aiBaseUrl ?? '',
            aiApiKey: savedTools.aiApiKey ?? '',
            aiDefaultImageModel: savedTools.aiDefaultImageModel ?? '',
            aiEndpointPath: savedTools.aiEndpointPath ?? '',
            aiProviderProfiles: Array.isArray(savedTools.aiProviderProfiles)
              ? savedTools.aiProviderProfiles
              : [],
            aiRuntimeDefaults:
              savedTools.aiRuntimeDefaults && typeof savedTools.aiRuntimeDefaults === 'object'
                ? savedTools.aiRuntimeDefaults
                : createEmptyAiRuntimeDefaults(),
            importStrategy: savedTools.importStrategy === 'move' ? 'move' : 'copy',
            realEsrganPath: savedTools.realEsrganPath ?? '',
            pythonPath: savedTools.pythonPath ?? '',
            watermarkScriptPath: savedTools.watermarkScriptPath ?? '',
            dynamicWatermarkEnabled: savedTools.dynamicWatermarkEnabled === true,
            dynamicWatermarkOpacity: clampOpacity(Number(savedTools.dynamicWatermarkOpacity)),
            dynamicWatermarkSize: clampSizePercent(Number(savedTools.dynamicWatermarkSize)),
            dynamicWatermarkTrajectory: normalizeDynamicWatermarkTrajectory(
              savedTools.dynamicWatermarkTrajectory
            ),
            storageMaintenanceEnabled: savedTools.storageMaintenanceEnabled === true,
            storageMaintenanceStartTime: normalizeStorageMaintenanceStartTime(
              savedTools.storageMaintenanceStartTime
            ),
            storageMaintenanceRetainDays: clampRetainDays(
              Number(savedTools.storageMaintenanceRetainDays)
            ),
            storageArchivePath:
              typeof savedTools.storageArchivePath === 'string'
                ? savedTools.storageArchivePath
                : '',
            scoutDashboardAutoImportDir: savedTools.scoutDashboardAutoImportDir ?? '',
            localGateway: savedTools.localGateway
          })
          updatePreferences({
            defaultStartTime: savedTools.defaultStartTime ?? '10:00',
            defaultInterval: Number(savedTools.defaultInterval) || 30
          })
        }
      } catch {
        if (!cancelled) addLog('[设置] 读取本地工具配置失败。')
      }

      try {
        const saved = await window.electronAPI.getFeishuConfig()
        if (cancelled || !saved) return

        updateConfig({
          appId: saved.appId ?? '',
          appSecret: saved.appSecret ?? '',
          baseToken: saved.baseToken ?? '',
          tableId: saved.tableId ?? ''
        })
        addLog('[Feishu] 已从本地加载配置。')
      } catch {
        if (cancelled) return
        addLog('[Feishu] 读取本地配置失败，请重新测试连接以保存。')
      }

      try {
        const workspace = await window.electronAPI.getWorkspacePath()
        if (cancelled || !workspace) return
        setWorkspacePath(workspace.path ?? '')
        setWorkspaceStatus(workspace.status ?? 'uninitialized')
      } catch {
        if (cancelled) return
        addLog('[工作区] 读取工作区路径失败。')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [addLog, updateConfig])

  const refreshStorageMaintenanceState = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI.getStorageMaintenanceState !== 'function') return
    try {
      const state = await window.electronAPI.getStorageMaintenanceState()
      setStorageMaintenanceState(state)
      if (state?.lastRunId) {
        setStorageMaintenanceRollbackRunId((prev) => (prev.trim() ? prev : (state.lastRunId ?? '')))
      }
    } catch (error) {
      const message = extractErrorMessage(error)
      addLog(`[存储维护] 读取状态失败：${message}`)
    }
  }, [addLog])

  const refreshLocalGatewayState = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI.getLocalGatewayState !== 'function') return
    try {
      const state = await window.electronAPI.getLocalGatewayState()
      setLocalGatewayState(state)
    } catch (error) {
      addLog(`[本地网关] 读取状态失败：${extractErrorMessage(error)}`)
    }
  }, [addLog])

  const refreshLocalGatewayProfiles = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI.listLocalGatewayChromeProfiles !== 'function') return
    setIsLoadingLocalGatewayProfiles(true)
    try {
      const profiles = await window.electronAPI.listLocalGatewayChromeProfiles()
      setLocalGatewayProfiles(profiles)
    } catch (error) {
      addLog(
        `[本地网关] 读取 CMS 网关 Profile 失败：${unwrapElectronInvokeError(extractErrorMessage(error))}`
      )
    } finally {
      setIsLoadingLocalGatewayProfiles(false)
    }
  }, [addLog])

  const refreshSystemChromeProfiles = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI.listLocalGatewaySystemChromeProfiles !== 'function') return
    setIsLoadingSystemChromeProfiles(true)
    try {
      const profiles = await window.electronAPI.listLocalGatewaySystemChromeProfiles()
      setSystemChromeProfiles(profiles)
    } catch (error) {
      addLog(
        `[本地网关] 读取系统 Chrome Profiles 失败：${unwrapElectronInvokeError(extractErrorMessage(error))}`
      )
    } finally {
      setIsLoadingSystemChromeProfiles(false)
    }
  }, [addLog])

  const refreshLocalGatewayAccounts = useCallback(async (): Promise<void> => {
    if (typeof window.electronAPI.listLocalGatewayAccounts !== 'function') return
    try {
      const accounts = await window.electronAPI.listLocalGatewayAccounts()
      setLocalGatewayAccounts(accounts)
    } catch (error) {
      addLog(
        `[本地网关] 读取网关账号状态失败：${unwrapElectronInvokeError(extractErrorMessage(error))}`
      )
    }
  }, [addLog])

  const refreshChatAccountSection = useCallback(async (): Promise<void> => {
    await Promise.all([refreshSystemChromeProfiles(), refreshLocalGatewayAccounts()])
  }, [refreshLocalGatewayAccounts, refreshSystemChromeProfiles])

  const syncSelectedLocalGatewayAccounts = useCallback(
    async (profiles: LocalGatewaySystemChromeProfile[]): Promise<void> => {
      if (typeof window.electronAPI.syncLocalGatewayAccounts !== 'function') return
      setIsSyncingLocalGatewayAccounts(true)
      try {
        const accounts = await window.electronAPI.syncLocalGatewayAccounts({ profiles })
        setLocalGatewayAccounts(accounts)
        addLog(`[本地网关] 已同步 ${profiles.length} 个聊天链路 Chrome Profiles。`)
      } catch (error) {
        addLog(
          `[本地网关] 同步聊天链路 Chrome Profiles 失败：${unwrapElectronInvokeError(extractErrorMessage(error))}`
        )
      } finally {
        setIsSyncingLocalGatewayAccounts(false)
      }
    },
    [addLog]
  )

  const toggleSystemChromeProfile = useCallback(
    (profileDirectory: string): void => {
      const normalized = String(profileDirectory ?? '').trim()
      if (!normalized) return

      const nextDirectories = selectedChatChromeProfileDirectories.includes(normalized)
        ? selectedChatChromeProfileDirectories.filter((value) => value !== normalized)
        : [...selectedChatChromeProfileDirectories, normalized]

      updateConfig({
        localGateway: {
          ...config.localGateway,
          chromeProfileDirectories: nextDirectories
        }
      })
    },
    [config.localGateway, selectedChatChromeProfileDirectories, updateConfig]
  )

  useEffect(() => {
    void refreshStorageMaintenanceState()
  }, [refreshStorageMaintenanceState])

  useEffect(() => {
    void refreshLocalGatewayState()
  }, [refreshLocalGatewayState])

  useEffect(() => {
    void refreshLocalGatewayProfiles()
  }, [refreshLocalGatewayProfiles])

  useEffect(() => {
    void refreshSystemChromeProfiles()
  }, [refreshSystemChromeProfiles])

  useEffect(() => {
    void refreshLocalGatewayAccounts()
  }, [refreshLocalGatewayAccounts])

  useEffect(() => {
    if (skipFirstLocalGatewayAccountsSyncRef.current) {
      skipFirstLocalGatewayAccountsSyncRef.current = false
      return
    }

    const handle = window.setTimeout(() => {
      void syncSelectedLocalGatewayAccounts(selectedSystemChromeProfiles)
    }, 250)

    return () => {
      window.clearTimeout(handle)
    }
  }, [
    selectedSystemChromeProfiles,
    selectedSystemChromeProfilesSyncKey,
    syncSelectedLocalGatewayAccounts
  ])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshStorageMaintenanceState()
    }, 15_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [refreshStorageMaintenanceState])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLocalGatewayState()
    }, 15_000)

    return () => {
      window.clearInterval(timer)
    }
  }, [refreshLocalGatewayState])

  const changeWorkspace = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.pickWorkspacePath()
      if (!selected) return
      const result = await window.electronAPI.setWorkspacePath(selected)
      setWorkspacePath(result.path ?? '')
      setWorkspaceStatus('initialized')
      addLog(`[工作区] 已切换至：${result.path}`)
      window.alert('工作区已切换，应用将重启。')
      await window.electronAPI.relaunch()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[工作区] 切换失败：${message}`)
      window.alert(message)
    }
  }

  const chooseLocalGatewayBundlePath = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.openDirectory()
      if (!selected) return
      updateConfig({
        localGateway: {
          ...config.localGateway,
          bundlePath: selected
        }
      })
    } catch (error) {
      addLog(`[本地网关] 选择目录失败：${extractErrorMessage(error)}`)
    }
  }

  const resetNoteRaceData = async (): Promise<void> => {
    if (isResettingNoteRace) return
    const accepted = window.confirm(
      '确认重置「笔记赛马监控」全部数据吗？\n\n这会清空商品快照、内容快照、匹配关系、榜单结果和回收区数据，且不可恢复。'
    )
    if (!accepted) return

    setIsResettingNoteRace(true)
    try {
      const result = await window.api.cms.noteRace.resetAll()
      const totalDeleted =
        result.deletedCommerceRows +
        result.deletedContentRows +
        result.deletedMatchRows +
        result.deletedRankRows +
        result.deletedDeletedCommerceRows +
        result.deletedDeletedContentRows
      const message =
        totalDeleted > 0
          ? `重置完成：商品 ${result.deletedCommerceRows} 行，内容 ${result.deletedContentRows} 行，` +
            `匹配 ${result.deletedMatchRows} 行，榜单 ${result.deletedRankRows} 行，` +
            `回收区商品 ${result.deletedDeletedCommerceRows} 行，回收区内容 ${result.deletedDeletedContentRows} 行。`
          : '重置完成：当前赛马库已是空数据（0 行）。'
      window.dispatchEvent(
        new CustomEvent(NOTE_RACE_DATA_RESET_EVENT, {
          detail: result
        })
      )
      addLog(`[笔记赛马] ${message}`)
      window.alert(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[笔记赛马] 数据重置失败：${message}`)
      window.alert(message)
    } finally {
      setIsResettingNoteRace(false)
    }
  }

  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }

    const handle = window.setTimeout(() => {
      void window.electronAPI
        .saveConfig({
          publishMode: config.publishMode,
          electronPublishAction: config.electronPublishAction,
          chromeExecutablePath: config.chromeExecutablePath.trim(),
          cmsChromeDataDir: config.cmsChromeDataDir.trim(),
          aiProvider: config.aiProvider,
          aiBaseUrl: config.aiBaseUrl,
          aiApiKey: config.aiApiKey,
          aiDefaultImageModel: config.aiDefaultImageModel,
          aiEndpointPath: config.aiEndpointPath,
          aiProviderProfiles: config.aiProviderProfiles,
          aiRuntimeDefaults: config.aiRuntimeDefaults,
          importStrategy: config.importStrategy,
          realEsrganPath: config.realEsrganPath,
          pythonPath: config.pythonPath,
          watermarkScriptPath: config.watermarkScriptPath,
          dynamicWatermarkEnabled: config.dynamicWatermarkEnabled,
          dynamicWatermarkOpacity: clampOpacity(config.dynamicWatermarkOpacity),
          dynamicWatermarkSize: clampSizePercent(config.dynamicWatermarkSize),
          dynamicWatermarkTrajectory: selectedTrajectory,
          storageMaintenanceEnabled: config.storageMaintenanceEnabled,
          storageMaintenanceStartTime: normalizeStorageMaintenanceStartTime(
            config.storageMaintenanceStartTime
          ),
          storageMaintenanceRetainDays: clampRetainDays(config.storageMaintenanceRetainDays),
          storageArchivePath: config.storageArchivePath.trim(),
          scoutDashboardAutoImportDir: config.scoutDashboardAutoImportDir,
          localGateway: config.localGateway,
          defaultStartTime: preferences.defaultStartTime,
          defaultInterval: preferences.defaultInterval
        })
        .catch(() => {
          addLog('[设置] 保存本地配置失败。')
        })
    }, 200)

    return () => {
      window.clearTimeout(handle)
    }
  }, [
    addLog,
    config.chromeExecutablePath,
    config.cmsChromeDataDir,
    config.aiApiKey,
    config.aiBaseUrl,
    config.aiDefaultImageModel,
    config.aiEndpointPath,
    config.aiProvider,
    config.aiProviderProfiles,
    config.aiRuntimeDefaults,
    config.electronPublishAction,
    config.publishMode,
    config.importStrategy,
    config.pythonPath,
    config.realEsrganPath,
    config.dynamicWatermarkEnabled,
    config.dynamicWatermarkOpacity,
    config.dynamicWatermarkSize,
    selectedTrajectory,
    config.storageMaintenanceEnabled,
    config.storageMaintenanceStartTime,
    config.storageMaintenanceRetainDays,
    config.storageArchivePath,
    config.scoutDashboardAutoImportDir,
    config.localGateway,
    config.watermarkScriptPath,
    preferences.defaultInterval,
    preferences.defaultStartTime
  ])

  const retryStartLocalGateway = async (): Promise<void> => {
    if (isRetryingLocalGateway || typeof window.electronAPI.retryStartLocalGateway !== 'function')
      return
    setIsRetryingLocalGateway(true)
    try {
      const state = await window.electronAPI.retryStartLocalGateway()
      setLocalGatewayState(state)
      addLog(`[本地网关] 重试恢复完成：${state.overallStatus}`)
    } catch (error) {
      addLog(`[本地网关] 重试恢复失败：${extractErrorMessage(error)}`)
    } finally {
      setIsRetryingLocalGateway(false)
    }
  }

  const initializeLocalGateway = async (): Promise<void> => {
    if (
      isInitializingLocalGateway ||
      typeof window.electronAPI.initializeLocalGateway !== 'function'
    )
      return
    setIsInitializingLocalGateway(true)
    setLocalGatewayInitializationOutput('')
    try {
      const result = await window.electronAPI.initializeLocalGateway({
        smokeImage: config.localGateway.prewarmImageOnLaunch
      })
      setLocalGatewayInitializationOutput(
        result.output.trim() || `初始化完成：${result.profileDirectory}`
      )
      addLog(`[本地网关] 初始化完成：${result.profileDirectory}`)
      await refreshLocalGatewayState()
    } catch (error) {
      const message =
        unwrapElectronInvokeError(extractErrorMessage(error)) ||
        '初始化失败，请检查本地网关配置后重试。'
      setLocalGatewayInitializationOutput(message)
      addLog(`[本地网关] 初始化失败：${message}`)
      await refreshLocalGatewayState()
    } finally {
      setIsInitializingLocalGateway(false)
    }
  }

  const ensureLocalGatewayProfile = async (): Promise<void> => {
    if (typeof window.electronAPI.ensureLocalGatewayProfile !== 'function') return
    setIsInitializingLocalGateway(true)
    try {
      const profile = await window.electronAPI.ensureLocalGatewayProfile()
      updateConfig({
        localGateway: {
          ...config.localGateway,
          gatewayCmsProfileId: profile.id,
          allowDedicatedChrome: true
        }
      })
      addLog(`[本地网关] 已准备网关专用 Profile：${profile.profileDir}`)
      await refreshLocalGatewayProfiles()
      await refreshLocalGatewayState()
    } catch (error) {
      addLog(`[本地网关] 初始化网关专用 Profile 失败：${extractErrorMessage(error)}`)
    } finally {
      setIsInitializingLocalGateway(false)
    }
  }

  const openLocalGatewayProfileLogin = async (): Promise<void> => {
    if (typeof window.electronAPI.openLocalGatewayProfileLogin !== 'function') return
    try {
      const result = await window.electronAPI.openLocalGatewayProfileLogin()
      if (!config.localGateway.gatewayCmsProfileId.trim()) {
        updateConfig({
          localGateway: {
            ...config.localGateway,
            gatewayCmsProfileId: result.profileId,
            allowDedicatedChrome: true
          }
        })
      }
      addLog(`[本地网关] 已打开网关专用 Profile，请在 Chrome 中完成 Google / Flow 登录。`)
      await refreshLocalGatewayProfiles()
    } catch (error) {
      addLog(`[本地网关] 打开网关专用 Profile 失败：${extractErrorMessage(error)}`)
    }
  }

  useEffect(() => {
    const dispose = window.api.cms.scout.dashboard.onAutoImportScanProgress((payload) => {
      if (!payload || payload.mode !== 'manual') return
      setAutoImportScanProgress(payload)
    })
    return () => {
      dispose()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const applyState = (state: AppUpdateState): void => {
      if (cancelled) return
      setAppUpdateState(state)
    }

    if (typeof window.electronAPI.getAppUpdateState === 'function') {
      void window.electronAPI
        .getAppUpdateState()
        .then(applyState)
        .catch(() => void 0)
    }

    const dispose =
      typeof window.electronAPI.onAppUpdateStatus === 'function'
        ? window.electronAPI.onAppUpdateStatus((state) => {
            applyState(state)
          })
        : () => undefined

    return () => {
      cancelled = true
      dispose()
    }
  }, [])

  const appUpdateStatusText = useMemo(() => {
    if (!appUpdateState) return '正在读取更新状态...'
    const latest = appUpdateState.latestVersion ? `（最新：${appUpdateState.latestVersion}）` : ''
    switch (appUpdateState.phase) {
      case 'disabled':
        return appUpdateState.message || '当前环境未启用自动更新。'
      case 'checking':
        return '正在检查更新...'
      case 'available':
        return appUpdateState.message || `发现新版本 ${latest}`
      case 'downloading':
        return appUpdateState.message || '正在下载更新...'
      case 'downloaded':
        return appUpdateState.message || '更新已下载，可安装。'
      case 'not-available':
        return appUpdateState.message || '当前已是最新版本。'
      case 'error':
        return appUpdateState.message || '更新检查失败。'
      default:
        return appUpdateState.message || '自动更新已就绪。'
    }
  }, [appUpdateState])

  const checkAppUpdateNow = async (): Promise<void> => {
    if (isCheckingAppUpdate) return
    if (typeof window.electronAPI.checkAppUpdate !== 'function') {
      const message = '当前版本未集成自动更新接口。'
      addLog(`[更新] ${message}`)
      window.alert(message)
      return
    }

    setIsCheckingAppUpdate(true)
    try {
      addLog('[更新] 开始手动检查更新...')
      const next = await window.electronAPI.checkAppUpdate()
      setAppUpdateState(next)
      addLog(`[更新] ${next.message}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[更新] 手动检查失败：${message}`)
      window.alert(message)
    } finally {
      setIsCheckingAppUpdate(false)
    }
  }

  const installDownloadedUpdate = async (): Promise<void> => {
    if (isInstallingAppUpdate) return
    if (typeof window.electronAPI.installAppUpdateNow !== 'function') {
      const message = '当前版本未集成更新安装接口。'
      addLog(`[更新] ${message}`)
      window.alert(message)
      return
    }

    setIsInstallingAppUpdate(true)
    try {
      const result = await window.electronAPI.installAppUpdateNow()
      if (!result.accepted) {
        const reason = result.reason ? `（${result.reason}）` : ''
        addLog(`[更新] 暂未执行安装${reason}。`)
        setAppUpdateState(result.state)
        return
      }
      addLog('[更新] 即将重启并安装更新...')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[更新] 安装失败：${message}`)
      window.alert(message)
    } finally {
      setIsInstallingAppUpdate(false)
    }
  }

  const chooseScoutDashboardAutoImportDir = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.openDirectory()
      if (!selected) return
      updateConfig({ scoutDashboardAutoImportDir: selected })
      addLog(`[热度看板] 自动导入目录已设置：${selected}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[热度看板] 设置自动导入目录失败：${message}`)
      window.alert(message)
    }
  }

  const clearScoutDashboardAutoImportDir = (): void => {
    if (!config.scoutDashboardAutoImportDir.trim()) return
    updateConfig({ scoutDashboardAutoImportDir: '' })
    addLog('[热度看板] 自动导入目录已清空。')
  }

  const chooseStorageArchivePath = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.openDirectory()
      if (!selected) return
      updateConfig({ storageArchivePath: selected })
      addLog(`[存储维护] 归档路径已设置：${selected}`)
    } catch (error) {
      const message = extractErrorMessage(error)
      addLog(`[存储维护] 设置归档路径失败：${message}`)
      window.alert(message)
    }
  }

  const clearStorageArchivePath = (): void => {
    if (!config.storageArchivePath.trim()) return
    updateConfig({ storageArchivePath: '' })
    addLog('[存储维护] 归档路径已清空。')
  }

  const scanScoutDashboardAutoImportNow = async (): Promise<void> => {
    if (isScanningAutoImport) return

    const watchDir = config.scoutDashboardAutoImportDir.trim()
    if (!watchDir) {
      const message = '请先选择自动导入目录。'
      addLog(`[热度看板] 手动扫描失败：${message}`)
      window.alert(message)
      return
    }

    setIsScanningAutoImport(true)
    setAutoImportScanProgress({
      mode: 'manual',
      phase: 'start',
      watchDir,
      scannedFiles: 0,
      processedFiles: 0,
      importedFiles: 0,
      failedFiles: 0,
      skippedBaselineFiles: 0,
      skippedProcessedFiles: 0,
      skippedRetryFiles: 0,
      currentFile: null,
      message: '准备开始手动扫描...'
    })
    try {
      // Ensure latest path is persisted before triggering manual scan.
      await window.electronAPI.saveConfig({ scoutDashboardAutoImportDir: watchDir })
      addLog(`[热度看板] 开始手动扫描：${watchDir}`)
      const result = await window.api.cms.scout.dashboard.autoImportScanNow()
      if (!result) {
        addLog('[热度看板] 手动扫描未返回结果。')
        window.alert('手动扫描未返回结果，请重试。')
        return
      }

      const summary = `手动扫描完成：扫描 ${result.scannedFiles} 个，导入 ${result.importedFiles} 个，失败 ${result.failedFiles} 个。`
      addLog(`[热度看板] ${summary}`)
      setAutoImportScanProgress((prev) => ({
        mode: 'manual',
        phase: 'done',
        watchDir: result.watchDir,
        scannedFiles: result.scannedFiles,
        processedFiles: result.processedFiles,
        importedFiles: result.importedFiles,
        failedFiles: result.failedFiles,
        skippedBaselineFiles: result.skippedBaselineFiles,
        skippedProcessedFiles: result.skippedProcessedFiles,
        skippedRetryFiles: result.skippedRetryFiles,
        currentFile: prev?.currentFile ?? null
      }))
      if (result.failedFiles > 0 && result.failures.length > 0) {
        const brief = result.failures
          .slice(0, 3)
          .map((item) => `${item.sourceFile}: ${item.message}`)
          .join(' | ')
        addLog(`[热度看板] 手动扫描失败样例：${brief}`)
      }

      const failureHint =
        result.failedFiles > 0 && result.failures.length > 0
          ? `\n失败样例：\n${result.failures
              .slice(0, 3)
              .map((item) => `- ${item.sourceFile}: ${item.message}`)
              .join('\n')}`
          : ''
      window.alert(`${summary}${failureHint}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[热度看板] 手动扫描失败：${message}`)
      setAutoImportScanProgress((prev) => ({
        mode: 'manual',
        phase: 'error',
        watchDir: watchDir,
        scannedFiles: prev?.scannedFiles ?? 0,
        processedFiles: prev?.processedFiles ?? 0,
        importedFiles: prev?.importedFiles ?? 0,
        failedFiles: prev?.failedFiles ?? 0,
        skippedBaselineFiles: prev?.skippedBaselineFiles ?? 0,
        skippedProcessedFiles: prev?.skippedProcessedFiles ?? 0,
        skippedRetryFiles: prev?.skippedRetryFiles ?? 0,
        currentFile: prev?.currentFile ?? null,
        message
      }))
      window.alert(message)
    } finally {
      setIsScanningAutoImport(false)
    }
  }

  const runStorageMaintenance = async (dryRun: boolean): Promise<void> => {
    if (
      storageMaintenanceRunLockRef.current ||
      storageMaintenanceRollbackLockRef.current ||
      isStorageMaintenanceRunningNow ||
      isStorageMaintenanceRollingBack ||
      storageMaintenanceState?.running
    ) {
      return
    }
    if (typeof window.electronAPI.runStorageMaintenanceNow !== 'function') {
      window.alert('当前版本未集成存储维护执行接口。')
      return
    }

    const reason = storageMaintenanceReason.trim() || 'manual-ui'
    if (!dryRun && !config.storageArchivePath.trim()) {
      const accepted = window.confirm('当前未配置归档路径，实跑将执行不可回滚删除。是否继续？')
      if (!accepted) return
    }

    storageMaintenanceRunLockRef.current = true
    setIsStorageMaintenanceRunningNow(true)
    try {
      addLog(`[存储维护] 开始执行${dryRun ? ' dry-run' : ' real-run'}，reason=${reason}`)
      const summary = await window.electronAPI.runStorageMaintenanceNow({ reason, dryRun })
      setLastStorageMaintenanceSummary(summary)
      setStorageMaintenanceRollbackRunId(summary.runId)
      addLog(
        `[存储维护] 执行完成 执行编号=${summary.runId} ` +
          `assets=${summary.results.orphanAssetsDeleted} ` +
          `partitions=${summary.results.orphanPartitionsDeleted} ` +
          `temp=${summary.results.tempFilesDeleted} ` +
          `videos=${summary.results.migratedVideos}`
      )
      if (summary.notes.length > 0) {
        addLog(`[存储维护] 备注：${summary.notes.slice(0, 2).join(' | ')}`)
      }
      window.alert(
        `执行完成（${dryRun ? 'dry-run' : 'real-run'}）\n` +
          `执行编号: ${summary.runId}\n` +
          `清理文件: ${summary.results.orphanAssetsDeleted + summary.results.tempFilesDeleted}\n` +
          `清理分区: ${summary.results.orphanPartitionsDeleted}\n` +
          `迁移视频: ${summary.results.migratedVideos}`
      )
    } catch (error) {
      const message = normalizeStorageMaintenanceErrorMessage(error, {
        dryRun,
        archivePath: config.storageArchivePath
      })
      addLog(`[存储维护] 执行失败：${message}`)
      window.alert(message)
    } finally {
      setIsStorageMaintenanceRunningNow(false)
      storageMaintenanceRunLockRef.current = false
      await refreshStorageMaintenanceState()
    }
  }

  const rollbackStorageMaintenance = async (): Promise<void> => {
    if (
      storageMaintenanceRunLockRef.current ||
      storageMaintenanceRollbackLockRef.current ||
      isStorageMaintenanceRunningNow ||
      isStorageMaintenanceRollingBack ||
      storageMaintenanceState?.running
    ) {
      return
    }
    if (typeof window.electronAPI.rollbackStorageMaintenance !== 'function') {
      window.alert('当前版本未集成存储维护回滚接口。')
      return
    }

    const runId = storageMaintenanceRollbackRunId.trim()
    if (!runId) {
      window.alert('请输入要回滚的目标编号。')
      return
    }

    const accepted = window.confirm(`确认回滚目标编号=${runId} ?`)
    if (!accepted) return

    storageMaintenanceRollbackLockRef.current = true
    setIsStorageMaintenanceRollingBack(true)
    try {
      const result = await window.electronAPI.rollbackStorageMaintenance(runId)
      addLog(
        `[存储维护] 回滚完成 目标编号=${runId} restored=${result.restored} errors=${result.errors.length}`
      )
      if (result.errors.length > 0) {
        addLog(`[存储维护] 回滚错误：${result.errors.slice(0, 2).join(' | ')}`)
      }
      window.alert(
        `回滚完成\n目标编号: ${runId}\n恢复项: ${result.restored}\n错误数: ${result.errors.length}`
      )
    } catch (error) {
      const message = unwrapElectronInvokeError(extractErrorMessage(error))
      addLog(`[存储维护] 回滚失败：${message}`)
      window.alert(message)
    } finally {
      setIsStorageMaintenanceRollingBack(false)
      storageMaintenanceRollbackLockRef.current = false
      await refreshStorageMaintenanceState()
    }
  }

  const autoImportProgressPercent = useMemo(() => {
    if (!autoImportScanProgress) return 0
    if (autoImportScanProgress.scannedFiles <= 0)
      return autoImportScanProgress.phase === 'done' ? 100 : 0
    const raw = Math.round(
      (autoImportScanProgress.processedFiles / autoImportScanProgress.scannedFiles) * 100
    )
    return Math.max(0, Math.min(100, raw))
  }, [autoImportScanProgress])

  const testConnection = async (): Promise<void> => {
    if (isTesting) return
    if (!isFeishuConfigReady) {
      addLog('[Feishu] 配置不完整：请先填写 appId/appSecret/baseToken/tableId。')
      return
    }

    setIsTesting(true)
    try {
      addLog('[Feishu] 测试连接中...')
      await window.electronAPI.testFeishuConnection(
        config.appId,
        config.appSecret,
        config.baseToken,
        config.tableId
      )
      addLog('[Feishu] 连接成功并已保存配置。')
      window.alert('连接成功并已保存配置')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Feishu] 连接失败：${message}`)
      window.alert(message)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>设置</CardTitle>
          <CardDescription>
            管理飞书连接信息；配置会保存到本地并在下次启动时自动加载。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Tabs
          value={settingsPage}
          onValueChange={(value) => setSettingsPage(value as 'general' | 'aiProviders')}
          items={[
            { value: 'general', label: '通用设置' },
            { value: 'aiProviders', label: 'AI 供应商' }
          ]}
        />
        <div className="text-xs text-zinc-500">
          {settingsPage === 'aiProviders'
            ? '统一维护默认路由与供应商模型。'
            : '工作区、飞书、工具和系统级配置。'}
        </div>
      </div>

      {settingsPage === 'aiProviders' ? (
        <AiProviderSettingsPanel config={config} updateConfig={updateConfig} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>工作区管理</CardTitle>
              <CardDescription>
                切换本地工作区后，数据将写入该目录下的 SQLite 数据库；切换后应用会重启。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">当前工作区路径</div>
                <Input
                  value={workspacePath || '(未设置，使用默认路径)'}
                  readOnly
                  className={workspacePath ? '' : 'text-zinc-500 italic'}
                />
                {workspaceStatus !== 'initialized' ? (
                  <div className="text-xs text-amber-400">
                    工作区状态异常：请点击「切换工作区」重新选择一个可写目录。
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={changeWorkspace}>切换工作区</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Chrome 发布模式</CardTitle>
              <CardDescription>
                保留旧的 Electron 链路，同时支持切换到基于真实 Chrome 的 CDP 发布模式。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">发布模式</div>
                  <select
                    value={config.publishMode}
                    onChange={(event) =>
                      updateConfig({
                        publishMode: event.target.value === 'cdp' ? 'cdp' : 'electron'
                      })
                    }
                    className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200"
                  >
                    <option value="electron">Electron（旧模式）</option>
                    <option value="cdp">Chrome CDP（新模式）</option>
                  </select>
                  <div className="text-xs text-zinc-500">
                    `Chrome CDP` 会按当前环境切换 CMS 专用目录：开发环境默认
                    `~/chrome-cms-data-dev`，生产环境默认 `~/chrome-cms-data`。
                  </div>
                </div>
                {config.publishMode === 'electron' ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-xs text-zinc-400">发布方式</div>
                    <select
                      value={config.electronPublishAction}
                      onChange={(event) =>
                        updateConfig({
                          electronPublishAction:
                            event.target.value === 'auto_publish' ? 'auto_publish' : 'save_draft'
                        })
                      }
                      className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200"
                    >
                      <option value="save_draft">保存草稿</option>
                      <option value="auto_publish">自动发布</option>
                    </select>
                    <div className="text-xs text-zinc-500">
                      保存草稿会在完成素材上传、标题正文、封面与挂车后直接关闭发布窗口，由小红书自动保存草稿。
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">当前说明</div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
                    {config.publishMode === 'cdp'
                      ? '当前发布将走真实 Chrome + Puppeteer pipe 模式。账号需要先绑定 CMS Profile。'
                      : '当前发布继续走 Electron BrowserWindow 方案，旧链路不受影响。'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">Chrome 可执行文件路径</div>
                <Input
                  value={config.chromeExecutablePath}
                  onChange={(event) => updateConfig({ chromeExecutablePath: event.target.value })}
                  placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">CMS 数据目录</div>
                <div className="flex gap-2">
                  <Input
                    value={config.cmsChromeDataDir}
                    onChange={(event) => updateConfig({ cmsChromeDataDir: event.target.value })}
                    placeholder="开发: ~/chrome-cms-data-dev / 生产: ~/chrome-cms-data"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void window.electronAPI.openDirectory().then((selected) => {
                        if (!selected) return
                        updateConfig({ cmsChromeDataDir: selected })
                      })
                    }
                  >
                    选择目录
                  </Button>
                </div>
                <div className="text-xs text-zinc-500">
                  这里应指向当前环境对应的 CMS 专用 Chrome 数据目录，里面包含 `cms-accounts.json`。
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>笔记赛马数据重置</CardTitle>
              <CardDescription>
                当口径频繁调整导致历史数据混入脏数据时，可一键清空赛马监控模块数据后重新导入。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-400">
                仅影响「笔记赛马监控」模块数据，不会删除账号、任务、素材等其他模块数据。
              </div>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void resetNoteRaceData()}
                disabled={isResettingNoteRace}
              >
                {isResettingNoteRace ? '重置中...' : '重置赛马数据'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>热度看板自动导入</CardTitle>
              <CardDescription>
                设置爆款表文件夹后，系统会递归监听该目录，并按配置生效时的目录快照识别后续新增/变更模板文件。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">爆款表文件夹</div>
                <Input
                  value={config.scoutDashboardAutoImportDir || '(未设置)'}
                  readOnly
                  className={config.scoutDashboardAutoImportDir ? '' : 'text-zinc-500 italic'}
                />
                <div className="text-xs text-zinc-400">
                  支持多层子目录（如按年份/日期分层）和
                  `.xlsx`/`.xlsm`。若需补导历史文件，可点击“手动扫描导入”。
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" onClick={chooseScoutDashboardAutoImportDir}>
                  选择文件夹
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearScoutDashboardAutoImportDir}
                  disabled={!config.scoutDashboardAutoImportDir.trim()}
                >
                  清空
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void scanScoutDashboardAutoImportNow()}
                  disabled={!config.scoutDashboardAutoImportDir.trim() || isScanningAutoImport}
                >
                  {isScanningAutoImport ? '扫描中...' : '手动扫描导入'}
                </Button>
              </div>
              {autoImportScanProgress ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="flex items-center justify-between text-xs text-zinc-300">
                    <span>
                      {autoImportScanProgress.phase === 'error'
                        ? '手动扫描失败'
                        : autoImportScanProgress.phase === 'done'
                          ? '手动扫描完成'
                          : '手动扫描进行中'}
                    </span>
                    <span>
                      {autoImportScanProgress.processedFiles}/{autoImportScanProgress.scannedFiles}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-zinc-800">
                    <div
                      className={`h-full transition-all ${
                        autoImportScanProgress.phase === 'error' ? 'bg-rose-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${autoImportProgressPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    {autoImportScanProgress.currentFile
                      ? `当前文件：${autoImportScanProgress.currentFile}`
                      : autoImportScanProgress.message || '等待扫描任务启动...'}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    导入 {autoImportScanProgress.importedFiles}，失败{' '}
                    {autoImportScanProgress.failedFiles}，跳过{' '}
                    {autoImportScanProgress.skippedBaselineFiles +
                      autoImportScanProgress.skippedProcessedFiles +
                      autoImportScanProgress.skippedRetryFiles}
                    ，进度 {autoImportProgressPercent}%
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>应用更新（Windows）</CardTitle>
              <CardDescription>
                基于 GitHub Releases 检查更新；Windows 打包版会在启动后自动检查一次。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-2 text-xs text-zinc-300 md:grid-cols-2">
                <div>当前版本： {appUpdateState?.currentVersion ?? '--'}</div>
                <div>最新版本： {appUpdateState?.latestVersion ?? '--'}</div>
                <div>最近检查： {formatDateTime(appUpdateState?.checkedAt ?? null)}</div>
                <div>下载完成： {formatDateTime(appUpdateState?.downloadedAt ?? null)}</div>
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-200">
                {appUpdateStatusText}
              </div>

              {typeof appUpdateState?.percent === 'number' && appUpdateState.percent >= 0 ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-zinc-300">
                    <span>下载进度</span>
                    <span>{Math.round(appUpdateState.percent)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-zinc-800">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, appUpdateState.percent))}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void checkAppUpdateNow()}
                  disabled={isCheckingAppUpdate || appUpdateState?.phase === 'checking'}
                >
                  {isCheckingAppUpdate || appUpdateState?.phase === 'checking'
                    ? '检查中...'
                    : '检查更新'}
                </Button>
                <Button
                  type="button"
                  onClick={() => void installDownloadedUpdate()}
                  disabled={appUpdateState?.phase !== 'downloaded' || isInstallingAppUpdate}
                >
                  {isInstallingAppUpdate ? '准备重启...' : '立即安装并重启'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>本地网关</CardTitle>
              <CardDescription>
                管理 CMS 依赖的本地 AI
                网关自动恢复与首次初始化。这里的目录是网关程序包的安装目录，不是普通保存路径。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <section className={`rounded-xl border p-4 ${localGatewayOverview.panelClassName}`}>
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${localGatewayOverview.dotClassName}`} />
                    <div>
                      <div className="text-base font-semibold text-zinc-100">
                        {localGatewayOverview.label}
                      </div>
                      <div className="text-xs text-zinc-400">常用状态与启动入口</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-400">
                    最近启动：{formatDateTime(localGatewayState?.lastStartedAt ?? null)}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-black/10 bg-black/10 px-3 py-3">
                    <div className="text-xs text-zinc-400">会话（Chat）</div>
                    <div
                      className={`mt-2 flex items-center gap-2 text-sm font-medium ${chatCapability.textClassName}`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${chatCapability.dotClassName}`} />
                      <span>{chatCapability.label}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-black/10 bg-black/10 px-3 py-3">
                    <div className="text-xs text-zinc-400">生图（Flow）</div>
                    <div
                      className={`mt-2 flex items-center gap-2 text-sm font-medium ${flowCapability.textClassName}`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${flowCapability.dotClassName}`} />
                      <span>{flowCapability.label}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-black/10 bg-black/10 px-3 py-3">
                    <div className="text-xs text-zinc-400">管理后台</div>
                    <div
                      className={`mt-2 flex items-center gap-2 text-sm font-medium ${adminCapability.textClassName}`}
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${adminCapability.dotClassName}`}
                      />
                      <span>{adminCapability.label}</span>
                    </div>
                  </div>
                </div>

                {primaryLocalGatewayHint ? (
                  <div className="mt-3 text-xs text-amber-200">{primaryLocalGatewayHint}</div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant={isRestartRecommended ? 'outline' : 'default'}
                    className={primaryLocalGatewayActionClassName}
                    onClick={() => void initializeLocalGateway()}
                    disabled={isPrimaryLocalGatewayActionDisabled}
                  >
                    {isPrimaryLocalGatewayActionBusy
                      ? primaryLocalGatewayAction.busyLabel
                      : primaryLocalGatewayAction.label}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void refreshLocalGatewayState()}
                    className="h-auto px-1 text-xs text-zinc-400 hover:bg-transparent hover:text-zinc-100"
                  >
                    刷新状态
                  </Button>
                </div>
              </section>

              <section className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-zinc-100">Chat 账号</div>
                    <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-300">
                      已选 {selectedChatChromeProfileDirectories.length} 个
                    </span>
                    {isSyncingLocalGatewayAccounts ? (
                      <span className="text-xs text-zinc-500">正在同步到 gateway...</span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {selectedChatProfilesWithAccounts.length > 0 ? (
                    selectedChatProfilesWithAccounts.map(({ profile, account }) => (
                      <div
                        key={profile.profileDirectory}
                        className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-100">
                            {profile.displayName}
                          </div>
                          <div className="truncate text-xs text-zinc-400">
                            {profile.email ?? '未读取到邮箱'}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${getLocalGatewayAccountStatusClassName(
                              account?.status ?? null
                            )}`}
                          >
                            {getLocalGatewayAccountStatusLabel(account?.status ?? null)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            失败次数 {account?.consecutiveFailures ?? 0}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/30 px-3 py-4 text-sm text-zinc-500">
                      {isLoadingSystemChromeProfiles
                        ? '正在读取 Google Profiles...'
                        : '还没有选择 Chat 账号。点“管理账号”后勾选要同步到 Chat 链路的 Profile。'}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsManagingChatAccounts((prev) => !prev)}
                  >
                    {isManagingChatAccounts ? '收起账号管理' : '管理账号'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void refreshChatAccountSection()}
                    disabled={isLoadingSystemChromeProfiles}
                    className="h-auto px-1 text-xs text-zinc-400 hover:bg-transparent hover:text-zinc-100"
                  >
                    {isLoadingSystemChromeProfiles ? '刷新中...' : '刷新'}
                  </Button>
                </div>

                {isManagingChatAccounts ? (
                  <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="text-xs text-zinc-400">
                      只展示可识别邮箱的 Google Profile，方便筛选 Chat 轮询账号。
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                      {manageableSystemChromeProfiles.map((profile) => {
                        const checked = selectedChatChromeProfileDirectories.includes(
                          profile.profileDirectory
                        )
                        const account =
                          localGatewayAccountsByProfileDirectory.get(profile.profileDirectory) ??
                          null
                        return (
                          <label
                            key={profile.profileDirectory}
                            className={`rounded-lg border px-3 py-3 ${
                              checked
                                ? 'border-emerald-800/60 bg-emerald-950/15'
                                : 'border-zinc-800 bg-zinc-950/20'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleSystemChromeProfile(profile.profileDirectory)}
                                className="mt-1"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-zinc-100">
                                      {profile.displayName}
                                    </div>
                                    <div className="truncate text-xs text-zinc-400">
                                      {profile.email ?? '未读取到邮箱'}
                                    </div>
                                  </div>
                                  {checked ? (
                                    <span
                                      className={`rounded-full border px-2 py-0.5 text-[11px] ${getLocalGatewayAccountStatusClassName(
                                        account?.status ?? null
                                      )}`}
                                    >
                                      {getLocalGatewayAccountStatusLabel(account?.status ?? null)}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 truncate text-xs text-zinc-500">
                                  {profile.profileDirectory}
                                </div>
                                {checked && account ? (
                                  <div className="mt-1 text-xs text-zinc-500">
                                    失败次数 {account.consecutiveFailures}
                                    {account.lastFailedAt
                                      ? ` · 最近失败 ${formatDateTime(account.lastFailedAt)}`
                                      : ''}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </label>
                        )
                      })}

                      {!isLoadingSystemChromeProfiles &&
                      manageableSystemChromeProfiles.length === 0 ? (
                        <div className="text-xs text-amber-300">
                          还没有读取到可用的 Google Profile。请确认本机 Chrome
                          已启动过，并且账号列表里存在邮箱信息。
                        </div>
                      ) : null}
                    </div>

                    {hiddenChatProfileCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAllChatProfiles((prev) => !prev)}
                        className="mt-3 h-auto px-0 text-xs text-zinc-400 hover:bg-transparent hover:text-zinc-100"
                      >
                        {showAllChatProfiles ? '仅显示有邮箱的 Profile' : '显示全部 Profile'}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section>
                <details className="rounded-xl border border-zinc-800 bg-zinc-950/30">
                  <summary className="cursor-pointer select-none px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-100">高级设置</div>
                        <div className="text-xs text-zinc-500">
                          目录、CMS Profile、调试信息和恢复入口
                        </div>
                      </div>
                      <span className="text-xs text-zinc-500">点击展开</span>
                    </div>
                  </summary>

                  <div className="flex flex-col gap-4 border-t border-zinc-800 p-4">
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <div className="text-xs text-zinc-400">网关安装目录</div>
                        <Input
                          value={config.localGateway.bundlePath || '(未设置)'}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                bundlePath: event.target.value
                              }
                            })
                          }
                          className={config.localGateway.bundlePath ? '' : 'text-zinc-500 italic'}
                        />
                        <div className="text-xs text-zinc-500">
                          这里应指向 Local AI Gateway 程序包根目录，目录下需包含
                          `local-ai-gateway`、`tools`、`local-ai-gateway-startup`。
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void chooseLocalGatewayBundlePath()}
                          >
                            选择目录
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <div className="text-xs text-zinc-400">CMS Profile 选择</div>
                        <select
                          value={config.localGateway.gatewayCmsProfileId}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                gatewayCmsProfileId: event.target.value,
                                allowDedicatedChrome: true
                              }
                            })
                          }
                          className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200"
                        >
                          <option value="">请选择一个 CMS 网关 Profile</option>
                          {localGatewayProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.label}
                            </option>
                          ))}
                        </select>
                        <div className="text-xs text-zinc-500">
                          这是 Flow / CDP 专用的 CMS Profile，不影响上面的 Chat 账号选择。
                        </div>
                        {selectedLocalGatewayProfile ? (
                          <div className="text-xs text-emerald-300">
                            当前选择：{selectedLocalGatewayProfile.nickname} /{' '}
                            {selectedLocalGatewayProfile.profileDir}
                          </div>
                        ) : null}
                        {!isLoadingLocalGatewayProfiles && localGatewayProfiles.length === 0 ? (
                          <div className="text-xs text-amber-300">
                            当前还没有网关专用 CMS Profile。先初始化，再打开登录 Flow。
                          </div>
                        ) : null}
                        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
                          首次使用：先初始化一个“本地网关专用”CMS Profile，再打开它完成 Google /
                          Flow 登录，最后执行初始化。
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void ensureLocalGatewayProfile()}
                            disabled={isInitializingLocalGateway}
                          >
                            初始化网关专用 Profile
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void openLocalGatewayProfileLogin()}
                            disabled={isInitializingLocalGateway}
                          >
                            打开并登录网关 Profile
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void refreshLocalGatewayProfiles()}
                            disabled={isLoadingLocalGatewayProfiles}
                            className="h-auto px-1 text-xs text-zinc-400 hover:bg-transparent hover:text-zinc-100"
                          >
                            {isLoadingLocalGatewayProfiles ? '刷新中...' : '刷新 CMS Profiles'}
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                          type="checkbox"
                          checked={config.localGateway.enabled}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                enabled: event.target.checked
                              }
                            })
                          }
                        />
                        启用本地网关管理
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                          type="checkbox"
                          checked={config.localGateway.autoStartOnAppLaunch}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                autoStartOnAppLaunch: event.target.checked
                              }
                            })
                          }
                        />
                        启动应用时自动恢复
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                          type="checkbox"
                          checked={config.localGateway.startAdminUi}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                startAdminUi: event.target.checked
                              }
                            })
                          }
                        />
                        同时拉起管理后台
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                          type="checkbox"
                          checked={config.localGateway.startCdpProxy}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                startCdpProxy: event.target.checked
                              }
                            })
                          }
                        />
                        同时拉起 CDP 代理
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-200">
                        <input
                          type="checkbox"
                          checked={config.localGateway.prewarmImageOnLaunch}
                          onChange={(event) =>
                            updateConfig({
                              localGateway: {
                                ...config.localGateway,
                                prewarmImageOnLaunch: event.target.checked
                              }
                            })
                          }
                        />
                        初始化时做图片 smoke
                      </label>
                    </div>

                    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                      <div className="text-xs text-zinc-400">服务状态详情</div>
                      <div className="mt-3 flex flex-col gap-2 text-sm text-zinc-200">
                        {localGatewayServices.length > 0 ? (
                          localGatewayServices.map((service: LocalGatewayServiceStatus) => (
                            <div
                              key={service.name}
                              className="flex flex-col gap-1 rounded-md border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 md:flex-row md:items-center md:justify-between"
                            >
                              <span className="font-medium text-zinc-100">{service.name}</span>
                              <span className={service.ok ? 'text-emerald-400' : 'text-amber-300'}>
                                {service.ok
                                  ? `ok (${service.port})`
                                  : `${service.port} · ${service.message ?? '未就绪'}`}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-zinc-500">暂无状态快照。</div>
                        )}
                      </div>
                      {localGatewayState?.lastError ? (
                        <div className="mt-3 text-xs text-rose-300">
                          {localGatewayState.lastError}
                        </div>
                      ) : null}
                    </div>

                    <details className="rounded-lg border border-zinc-800 bg-zinc-950/50">
                      <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-200">
                        初始化输出日志
                      </summary>
                      <div className="border-t border-zinc-800 p-3">
                        {localGatewayInitializationOutput ? (
                          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-black p-3 text-xs text-white">
                            {localGatewayInitializationOutput}
                          </pre>
                        ) : (
                          <div className="text-xs text-zinc-500">暂无输出。</div>
                        )}
                      </div>
                    </details>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void retryStartLocalGateway()}
                        disabled={isRetryingLocalGateway || !config.localGateway.enabled}
                      >
                        {isRetryingLocalGateway ? '恢复中...' : '重试恢复'}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void initializeLocalGateway()}
                        disabled={
                          isInitializingLocalGateway ||
                          !config.localGateway.enabled ||
                          !config.localGateway.gatewayCmsProfileId.trim()
                        }
                      >
                        {isInitializingLocalGateway ? '初始化中...' : '执行初始化'}
                      </Button>
                    </div>
                  </div>
                </details>
              </section>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>存储维护（缓存瘦身）</CardTitle>
              <CardDescription>
                当前阶段只恢复手动维护：支持
                dry-run、实跑、飞牛归档和按执行编号回滚；不会按夜间时间自动执行。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400">
                自动维护配置字段仍会保留兼容：
                {config.storageMaintenanceEnabled ? '已启用' : '未启用'} /{' '}
                {normalizeStorageMaintenanceStartTime(config.storageMaintenanceStartTime)}
                ，但本阶段不会自动触发。
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">保留天数</div>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={clampRetainDays(config.storageMaintenanceRetainDays)}
                    onChange={(e) =>
                      updateConfig({
                        storageMaintenanceRetainDays: clampRetainDays(Number(e.target.value))
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">当前运行状态</div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200">
                    {isStorageMaintenanceRunningNow || storageMaintenanceState?.running
                      ? '运行中'
                      : isStorageMaintenanceRollingBack
                        ? '回滚中'
                        : '空闲'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">飞牛归档目录</div>
                <Input
                  value={config.storageArchivePath || '(未设置)'}
                  readOnly
                  className={config.storageArchivePath ? '' : 'text-zinc-500 italic'}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void chooseStorageArchivePath()}
                  >
                    选择目录
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={clearStorageArchivePath}
                    disabled={!config.storageArchivePath.trim()}
                  >
                    清空
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300">
                <div>
                  自动计划时间（仅展示）：
                  {formatDateTime(storageMaintenanceState?.nextRunAt ?? null)}
                </div>
                <div>
                  上次执行时间：{formatDateTime(storageMaintenanceState?.lastRunAt ?? null)}
                </div>
                <div>上次执行编号：{storageMaintenanceState?.lastRunId ?? '--'}</div>
                <div>锁状态：{storageMaintenanceState?.locked ? '已锁定' : '未锁定'}</div>
                <div>锁原因：{storageMaintenanceState?.lockReason ?? '--'}</div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="flex flex-col gap-1 md:col-span-2">
                  <div className="text-xs text-zinc-400">本次执行备注</div>
                  <Input
                    value={storageMaintenanceReason}
                    onChange={(e) => setStorageMaintenanceReason(e.target.value)}
                    placeholder="例如：发布前手动清理"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refreshStorageMaintenanceState()}
                  >
                    刷新状态
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void runStorageMaintenance(true)}
                  disabled={
                    isStorageMaintenanceRunningNow ||
                    isStorageMaintenanceRollingBack ||
                    storageMaintenanceState?.running
                  }
                >
                  {isStorageMaintenanceRunningNow ? '执行中...' : '立即 dry-run'}
                </Button>
                <Button
                  type="button"
                  onClick={() => void runStorageMaintenance(false)}
                  disabled={
                    isStorageMaintenanceRunningNow ||
                    isStorageMaintenanceRollingBack ||
                    storageMaintenanceState?.running
                  }
                >
                  {isStorageMaintenanceRunningNow ? '执行中...' : '立即实跑'}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <div className="flex flex-col gap-1 md:col-span-2">
                  <div className="text-xs text-zinc-400">回滚目标编号</div>
                  <Input
                    value={storageMaintenanceRollbackRunId}
                    onChange={(e) => setStorageMaintenanceRollbackRunId(e.target.value)}
                    placeholder="执行完成后会自动带入，也可手动填写"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void rollbackStorageMaintenance()}
                    disabled={
                      isStorageMaintenanceRunningNow ||
                      isStorageMaintenanceRollingBack ||
                      storageMaintenanceState?.running
                    }
                  >
                    {isStorageMaintenanceRollingBack ? '回滚中...' : '执行回滚'}
                  </Button>
                </div>
              </div>

              {lastStorageMaintenanceSummary ? (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-300">
                  <div>最近手动结果：执行编号={lastStorageMaintenanceSummary.runId}</div>
                  <div>
                    清理：assets {lastStorageMaintenanceSummary.results.orphanAssetsDeleted} / temp{' '}
                    {lastStorageMaintenanceSummary.results.tempFilesDeleted} / partitions{' '}
                    {lastStorageMaintenanceSummary.results.orphanPartitionsDeleted}
                  </div>
                  <div>
                    空间回收：assets{' '}
                    {formatBytes(lastStorageMaintenanceSummary.results.orphanAssetsDeletedBytes)} /
                    temp {formatBytes(lastStorageMaintenanceSummary.results.tempFilesDeletedBytes)}{' '}
                    / partitions{' '}
                    {formatBytes(
                      lastStorageMaintenanceSummary.results.orphanPartitionsDeletedBytes
                    )}
                  </div>
                  <div>
                    迁移视频：{lastStorageMaintenanceSummary.results.migratedVideos}（
                    {formatBytes(lastStorageMaintenanceSummary.results.migratedVideoBytes)}），跳过{' '}
                    {lastStorageMaintenanceSummary.results.skippedMigrations}
                  </div>
                  <div>
                    耗时：
                    {Math.max(0, Math.round(lastStorageMaintenanceSummary.durationMs / 100) / 10)} s
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>导入策略</CardTitle>
              <CardDescription>控制派发任务时图片导入到工作区的方式。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={config.importStrategy === 'move'}
                  onChange={(e) =>
                    updateConfig({ importStrategy: e.target.checked ? 'move' : 'copy' })
                  }
                />
                <div className="text-sm text-zinc-200">导入后删除源文件 (Move instead of Copy)</div>
              </label>
              <div className="text-xs text-amber-400">
                开启后，源文件将被移动到工作区，原位置文件不再保留。请谨慎开启。
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>素材水印预设</CardTitle>
              <CardDescription>在数据工坊派发阶段为图片动态注入账号水印。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 text-xs text-zinc-400">全局开关</div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.dynamicWatermarkEnabled}
                  onClick={() =>
                    updateConfig({ dynamicWatermarkEnabled: !config.dynamicWatermarkEnabled })
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    config.dynamicWatermarkEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      config.dynamicWatermarkEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                  <span>透明度</span>
                  <span>{clampOpacity(config.dynamicWatermarkOpacity)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={clampOpacity(config.dynamicWatermarkOpacity)}
                  onChange={(e) =>
                    updateConfig({ dynamicWatermarkOpacity: clampOpacity(Number(e.target.value)) })
                  }
                  className="w-full accent-zinc-200"
                />
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                  <span>水印大小占比（%）</span>
                  <span>{clampSizePercent(config.dynamicWatermarkSize)}</span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={10}
                  step={1}
                  value={clampSizePercent(config.dynamicWatermarkSize)}
                  onChange={(e) =>
                    updateConfig({ dynamicWatermarkSize: clampSizePercent(Number(e.target.value)) })
                  }
                  className="w-full accent-zinc-200"
                />
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 text-xs text-zinc-400">水印轨迹方案</div>
                <select
                  value={selectedTrajectory}
                  onChange={(e) =>
                    updateConfig({
                      dynamicWatermarkTrajectory: normalizeDynamicWatermarkTrajectory(
                        e.target.value
                      )
                    })
                  }
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  {WATERMARK_TRAJECTORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-2 text-xs text-zinc-500">
                  {
                    WATERMARK_TRAJECTORY_OPTIONS.find(
                      (option) => option.value === selectedTrajectory
                    )?.description
                  }
                </div>
              </div>

              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-2 text-xs text-zinc-400">轨迹实时预览（黑底播放框）</div>
                <div className="mx-auto w-full max-w-[360px]">
                  <div
                    className="relative overflow-hidden rounded-md border border-zinc-700 bg-black"
                    style={{
                      width: `${previewMotion.frameWidth}px`,
                      height: `${previewMotion.frameHeight}px`
                    }}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),rgba(0,0,0,0)_55%)]" />
                    <div
                      className="absolute inline-flex items-center justify-center rounded bg-white/12 px-2 text-xs font-semibold text-white backdrop-blur-sm"
                      style={{
                        left: `${previewMotion.x}px`,
                        top: `${previewMotion.y}px`,
                        width: `${previewMotion.stickerWidth}px`,
                        height: `${previewMotion.stickerHeight}px`
                      }}
                    >
                      @accountName
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-zinc-500">
                  用于模拟轨迹运动效果，便于实时选择水印方案。
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>飞书配置</CardTitle>
              <CardDescription>
                所有飞书 API 调用在主进程执行；此处仅配置参数并通过 IPC 调用。
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">应用 ID</div>
                <Input
                  value={config.appId}
                  onChange={(e) => updateConfig({ appId: e.target.value })}
                  placeholder="cli_xxx"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">应用密钥</div>
                <Input
                  type="password"
                  value={config.appSecret}
                  onChange={(e) => updateConfig({ appSecret: e.target.value })}
                  placeholder="xxxx"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">Base Token（app_token）</div>
                <Input
                  value={config.baseToken}
                  onChange={(e) => updateConfig({ baseToken: e.target.value })}
                  placeholder="bascn..."
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">数据表 ID</div>
                <Input
                  value={config.tableId}
                  onChange={(e) => updateConfig({ tableId: e.target.value })}
                  placeholder="tbl..."
                />
              </div>

              <div className="flex items-end md:col-span-2">
                <Button onClick={testConnection} disabled={!isFeishuConfigReady || isTesting}>
                  测试连接
                </Button>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">标题字段 Key</div>
                <Input
                  value={config.titleField}
                  onChange={(e) => updateConfig({ titleField: e.target.value })}
                  placeholder="标题"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">正文字段 Key</div>
                <Input
                  value={config.bodyField}
                  onChange={(e) => updateConfig({ bodyField: e.target.value })}
                  placeholder="正文"
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <div className="text-xs text-zinc-400">图片字段 Key（可选）</div>
                <Input
                  value={config.imageField}
                  onChange={(e) => updateConfig({ imageField: e.target.value })}
                  placeholder="图片"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>工具配置</CardTitle>
              <CardDescription>配置本地工具路径（用于图片处理流水线）。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <input
                ref={exePickerRef}
                type="file"
                accept="*/*"
                className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
                onChange={(e) => {
                  const file = (e.target.files ?? [])[0]
                  e.currentTarget.value = ''
                  if (!file) return
                  const filePath = window.electronAPI.getPathForFile(file).trim()
                  if (!filePath) {
                    addLog('[设置] 未能获取 Real-ESRGAN 可执行文件路径。')
                    return
                  }
                  updateConfig({ realEsrganPath: filePath })
                  addLog(`[设置] Real-ESRGAN 已设置：${filePath}`)
                }}
              />

              <input
                ref={pythonPickerRef}
                type="file"
                accept="*/*"
                className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
                onChange={(e) => {
                  const file = (e.target.files ?? [])[0]
                  e.currentTarget.value = ''
                  if (!file) return
                  const filePath = window.electronAPI.getPathForFile(file).trim()
                  if (!filePath) {
                    addLog('[设置] 未能获取 Python 解释器路径。')
                    return
                  }
                  updateConfig({ pythonPath: filePath })
                  addLog(`[设置] Python 已设置：${filePath}`)
                }}
              />

              <input
                ref={scriptPickerRef}
                type="file"
                accept="*/*"
                className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
                onChange={(e) => {
                  const file = (e.target.files ?? [])[0]
                  e.currentTarget.value = ''
                  if (!file) return
                  const filePath = window.electronAPI.getPathForFile(file).trim()
                  if (!filePath) {
                    addLog('[设置] 未能获取去印脚本路径。')
                    return
                  }
                  updateConfig({ watermarkScriptPath: filePath })
                  addLog(`[设置] 去印脚本已设置：${filePath}`)
                }}
              />

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">Real-ESRGAN 可执行文件路径</div>
                <div className="flex gap-2">
                  <Input
                    value={config.realEsrganPath}
                    onChange={(e) => updateConfig({ realEsrganPath: e.target.value })}
                    placeholder="/path/to/realesrgan-ncnn-vulkan"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => exePickerRef.current?.click()}
                  >
                    浏览
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">Python 解释器路径</div>
                <div className="flex gap-2">
                  <Input
                    value={config.pythonPath}
                    onChange={(e) => updateConfig({ pythonPath: e.target.value })}
                    placeholder="/usr/local/bin/python3.10"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => pythonPickerRef.current?.click()}
                  >
                    浏览
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">去印脚本路径</div>
                <div className="flex gap-2">
                  <Input
                    value={config.watermarkScriptPath}
                    onChange={(e) => updateConfig({ watermarkScriptPath: e.target.value })}
                    placeholder="/Users/z/AI_Tools/watermark_cli.py"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => scriptPickerRef.current?.click()}
                  >
                    浏览
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export { Settings }
