import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { useCmsStore } from '@renderer/store/useCmsStore'

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

type DynamicWatermarkTrajectory = 'smoothSine' | 'figureEight' | 'diagonalWrap' | 'largeEllipse' | 'pseudoRandom'

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

function formatDateTime(value: number | null): string {
  if (!Number.isFinite(Number(value))) return '--'
  const time = Number(value)
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

const WATERMARK_TRAJECTORY_OPTIONS: TrajectoryOption[] = [
  { value: 'smoothSine', label: '方案 A · 柔和正弦漂移', description: '横向平移 + 纵向正弦起伏，轨迹柔和。' },
  { value: 'figureEight', label: '方案 B · 8字李萨如', description: '围绕中心画“∞”，闭环平滑。' },
  { value: 'diagonalWrap', label: '方案 C · 对角线回环', description: '沿对角方向巡航，越界后从对侧穿出。' },
  { value: 'largeEllipse', label: '方案 D · 大椭圆巡航', description: '贴近边缘大轨道运动，尽量避开核心画面。' },
  { value: 'pseudoRandom', label: '方案 E · 伪随机漫步', description: '叠加快慢波形成非线性游走（当前默认）。' }
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

function Settings(): React.JSX.Element {
  const config = useCmsStore((s) => s.config)
  const addLog = useCmsStore((s) => s.addLog)
  const updateConfig = useCmsStore((s) => s.updateConfig)
  const preferences = useCmsStore((s) => s.preferences)
  const updatePreferences = useCmsStore((s) => s.updatePreferences)

  const [isTesting, setIsTesting] = useState(false)
  const [isScanningAutoImport, setIsScanningAutoImport] = useState(false)
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false)
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false)
  const [autoImportScanProgress, setAutoImportScanProgress] = useState<AutoImportScanProgress | null>(null)
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null)
  const [workspacePath, setWorkspacePath] = useState('')
  const [workspaceStatus, setWorkspaceStatus] = useState<'initialized' | 'uninitialized'>('uninitialized')
  const [previewTime, setPreviewTime] = useState(0)
  const exePickerRef = useRef<HTMLInputElement | null>(null)
  const pythonPickerRef = useRef<HTMLInputElement | null>(null)
  const scriptPickerRef = useRef<HTMLInputElement | null>(null)
  const skipFirstSaveRef = useRef(true)
  const selectedTrajectory = normalizeDynamicWatermarkTrajectory(config.dynamicWatermarkTrajectory)

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
    return isNonEmpty(config.appId) && isNonEmpty(config.appSecret) && isNonEmpty(config.baseToken) && isNonEmpty(config.tableId)
  }, [config])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const savedTools = await window.electronAPI.getConfig()
        if (!cancelled && savedTools) {
          updateConfig({
            importStrategy: savedTools.importStrategy === 'move' ? 'move' : 'copy',
            realEsrganPath: savedTools.realEsrganPath ?? '',
            pythonPath: savedTools.pythonPath ?? '',
            watermarkScriptPath: savedTools.watermarkScriptPath ?? '',
            dynamicWatermarkEnabled: savedTools.dynamicWatermarkEnabled === true,
            dynamicWatermarkOpacity: clampOpacity(Number(savedTools.dynamicWatermarkOpacity)),
            dynamicWatermarkSize: clampSizePercent(Number(savedTools.dynamicWatermarkSize)),
            dynamicWatermarkTrajectory: normalizeDynamicWatermarkTrajectory(savedTools.dynamicWatermarkTrajectory),
            scoutDashboardAutoImportDir: savedTools.scoutDashboardAutoImportDir ?? ''
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

  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }

    const handle = window.setTimeout(() => {
      void window.electronAPI
        .saveConfig({
          importStrategy: config.importStrategy,
          realEsrganPath: config.realEsrganPath,
          pythonPath: config.pythonPath,
          watermarkScriptPath: config.watermarkScriptPath,
          dynamicWatermarkEnabled: config.dynamicWatermarkEnabled,
          dynamicWatermarkOpacity: clampOpacity(config.dynamicWatermarkOpacity),
          dynamicWatermarkSize: clampSizePercent(config.dynamicWatermarkSize),
          dynamicWatermarkTrajectory: selectedTrajectory,
          scoutDashboardAutoImportDir: config.scoutDashboardAutoImportDir,
          defaultStartTime: preferences.defaultStartTime,
          defaultInterval: preferences.defaultInterval
        })
        .catch(() => {
          addLog('[设置] 保存工具路径失败。')
        })
    }, 200)

    return () => {
      window.clearTimeout(handle)
    }
  }, [
    addLog,
    config.importStrategy,
    config.pythonPath,
    config.realEsrganPath,
    config.dynamicWatermarkEnabled,
    config.dynamicWatermarkOpacity,
    config.dynamicWatermarkSize,
    selectedTrajectory,
    config.scoutDashboardAutoImportDir,
    config.watermarkScriptPath,
    preferences.defaultInterval,
    preferences.defaultStartTime
  ])

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

  const autoImportProgressPercent = useMemo(() => {
    if (!autoImportScanProgress) return 0
    if (autoImportScanProgress.scannedFiles <= 0) return autoImportScanProgress.phase === 'done' ? 100 : 0
    const raw = Math.round((autoImportScanProgress.processedFiles / autoImportScanProgress.scannedFiles) * 100)
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
      await window.electronAPI.testFeishuConnection(config.appId, config.appSecret, config.baseToken, config.tableId)
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
          <CardDescription>管理飞书连接信息；配置会保存到本地并在下次启动时自动加载。</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>工作区管理</CardTitle>
          <CardDescription>切换本地工作区后，数据将写入该目录下的 SQLite 数据库；切换后应用会重启。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">当前工作区路径</div>
            <Input value={workspacePath || '(未设置，使用默认路径)'} readOnly className={workspacePath ? '' : 'text-zinc-500 italic'} />
            {workspaceStatus !== 'initialized' ? (
              <div className="text-xs text-amber-400">工作区状态异常：请点击「切换工作区」重新选择一个可写目录。</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={changeWorkspace}>切换工作区</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>热度看板自动导入</CardTitle>
          <CardDescription>设置爆款表文件夹后，系统会递归监听该目录，并按配置生效时的目录快照识别后续新增/变更模板文件。</CardDescription>
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
              支持多层子目录（如按年份/日期分层）和 `.xlsx`/`.xlsm`。若需补导历史文件，可点击“手动扫描导入”。
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
                导入 {autoImportScanProgress.importedFiles}，失败 {autoImportScanProgress.failedFiles}，跳过
                {' '}
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
          <CardDescription>基于 GitHub Releases 检查更新；Windows 打包版会在启动后自动检查一次。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 text-xs text-zinc-300 md:grid-cols-2">
            <div>
              当前版本：
              {' '}
              {appUpdateState?.currentVersion ?? '--'}
            </div>
            <div>
              最新版本：
              {' '}
              {appUpdateState?.latestVersion ?? '--'}
            </div>
            <div>
              最近检查：
              {' '}
              {formatDateTime(appUpdateState?.checkedAt ?? null)}
            </div>
            <div>
              下载完成：
              {' '}
              {formatDateTime(appUpdateState?.downloadedAt ?? null)}
            </div>
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
              {isCheckingAppUpdate || appUpdateState?.phase === 'checking' ? '检查中...' : '检查更新'}
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
          <CardTitle>导入策略</CardTitle>
          <CardDescription>控制派发任务时图片导入到工作区的方式。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={config.importStrategy === 'move'}
              onChange={(e) => updateConfig({ importStrategy: e.target.checked ? 'move' : 'copy' })}
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
              onClick={() => updateConfig({ dynamicWatermarkEnabled: !config.dynamicWatermarkEnabled })}
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
              onChange={(e) => updateConfig({ dynamicWatermarkOpacity: clampOpacity(Number(e.target.value)) })}
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
              onChange={(e) => updateConfig({ dynamicWatermarkSize: clampSizePercent(Number(e.target.value)) })}
              className="w-full accent-zinc-200"
            />
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs text-zinc-400">水印轨迹方案</div>
            <select
              value={selectedTrajectory}
              onChange={(e) =>
                updateConfig({
                  dynamicWatermarkTrajectory: normalizeDynamicWatermarkTrajectory(e.target.value)
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
              {WATERMARK_TRAJECTORY_OPTIONS.find((option) => option.value === selectedTrajectory)?.description}
            </div>
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs text-zinc-400">轨迹实时预览（黑底播放框）</div>
            <div className="mx-auto w-full max-w-[360px]">
              <div
                className="relative overflow-hidden rounded-md border border-zinc-700 bg-black"
                style={{ width: `${previewMotion.frameWidth}px`, height: `${previewMotion.frameHeight}px` }}
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
            <div className="mt-2 text-xs text-zinc-500">用于模拟轨迹运动效果，便于实时选择水印方案。</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>飞书配置</CardTitle>
          <CardDescription>所有飞书 API 调用在主进程执行；此处仅配置参数并通过 IPC 调用。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">应用 ID</div>
            <Input value={config.appId} onChange={(e) => updateConfig({ appId: e.target.value })} placeholder="cli_xxx" />
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
            <Input value={config.baseToken} onChange={(e) => updateConfig({ baseToken: e.target.value })} placeholder="bascn..." />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">数据表 ID</div>
            <Input value={config.tableId} onChange={(e) => updateConfig({ tableId: e.target.value })} placeholder="tbl..." />
          </div>

          <div className="flex items-end md:col-span-2">
            <Button onClick={testConnection} disabled={!isFeishuConfigReady || isTesting}>
              测试连接
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">标题字段 Key</div>
            <Input value={config.titleField} onChange={(e) => updateConfig({ titleField: e.target.value })} placeholder="标题" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">正文字段 Key</div>
            <Input value={config.bodyField} onChange={(e) => updateConfig({ bodyField: e.target.value })} placeholder="正文" />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <div className="text-xs text-zinc-400">图片字段 Key（可选）</div>
            <Input value={config.imageField} onChange={(e) => updateConfig({ imageField: e.target.value })} placeholder="图片" />
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
              <Button type="button" variant="outline" onClick={() => exePickerRef.current?.click()}>
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
              <Button type="button" variant="outline" onClick={() => pythonPickerRef.current?.click()}>
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
              <Button type="button" variant="outline" onClick={() => scriptPickerRef.current?.click()}>
                浏览
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { Settings }
