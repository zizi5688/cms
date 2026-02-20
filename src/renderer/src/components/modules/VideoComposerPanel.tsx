import { useEffect, useState } from 'react'
import type * as React from 'react'

import { Download, FolderOpen, Loader2, Shuffle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { useCmsStore } from '@renderer/store/useCmsStore'

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function isImageFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return (
    normalized.endsWith('.jpg') ||
    normalized.endsWith('.jpeg') ||
    normalized.endsWith('.png') ||
    normalized.endsWith('.webp') ||
    normalized.endsWith('.heic')
  )
}

function isAudioFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return (
    normalized.endsWith('.mp3') ||
    normalized.endsWith('.m4a') ||
    normalized.endsWith('.aac') ||
    normalized.endsWith('.wav') ||
    normalized.endsWith('.ogg') ||
    normalized.endsWith('.flac')
  )
}

const DEFAULT_TEMPLATE: VideoStyleTemplate = {
  name: 'style-v1',
  totalDurationSec: 10,
  imageCountMin: 6,
  imageCountMax: 10,
  width: 1080,
  height: 1920,
  fps: 24,
  transitionType: 'fade',
  transitionDurationSec: 0.3,
  bgmVolume: 0.28
}

const TEMPLATE_STORAGE_KEY = 'cms.videoComposer.template.v1'
const RANDOM_BGM_VALUE = '__RANDOM_BGM__'

function toSafeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function toSafeInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.floor(toSafeNumber(value, fallback))
  return Math.min(max, Math.max(min, parsed))
}

function normalizeTemplateFromUnknown(raw: unknown): VideoStyleTemplate {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const transition = source.transitionType
  const transitionType: VideoTemplateTransition =
    transition === 'none' || transition === 'slideleft' ? transition : 'fade'
  const imageCountMin = toSafeInt(source.imageCountMin, DEFAULT_TEMPLATE.imageCountMin, 1, 50)
  const imageCountMax = toSafeInt(source.imageCountMax, DEFAULT_TEMPLATE.imageCountMax, 1, 50)
  const min = Math.min(imageCountMin, imageCountMax)
  const max = Math.max(imageCountMin, imageCountMax)

  return {
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : DEFAULT_TEMPLATE.name,
    totalDurationSec: clampNumber(toSafeNumber(source.totalDurationSec, DEFAULT_TEMPLATE.totalDurationSec), 2, 60),
    imageCountMin: min,
    imageCountMax: max,
    width: toSafeInt(source.width, DEFAULT_TEMPLATE.width, 360, 4096),
    height: toSafeInt(source.height, DEFAULT_TEMPLATE.height, 360, 4096),
    fps: toSafeInt(source.fps, DEFAULT_TEMPLATE.fps, 12, 24),
    transitionType,
    transitionDurationSec: clampNumber(
      toSafeNumber(source.transitionDurationSec, DEFAULT_TEMPLATE.transitionDurationSec),
      0,
      3
    ),
    bgmVolume: clampNumber(toSafeNumber(source.bgmVolume, DEFAULT_TEMPLATE.bgmVolume), 0, 2)
  }
}

function loadSavedTemplate(): { template: VideoStyleTemplate; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { template?: unknown; savedAt?: unknown }
    if (!parsed || typeof parsed !== 'object') return null

    return {
      template: normalizeTemplateFromUnknown(parsed.template),
      savedAt: Number(parsed.savedAt) || 0
    }
  } catch {
    return null
  }
}

function saveTemplateToStorage(template: VideoStyleTemplate): number | null {
  try {
    const savedAt = Date.now()
    localStorage.setItem(
      TEMPLATE_STORAGE_KEY,
      JSON.stringify({
        template,
        savedAt
      })
    )
    return savedAt
  } catch {
    return null
  }
}

function formatSavedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未保存'
  try {
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '未保存'
  }
}

const INITIAL_SAVED_TEMPLATE = loadSavedTemplate()

function VideoComposerPanel(): React.JSX.Element {
  const addLog = useCmsStore((s) => s.addLog)

  const [sourceImages, setSourceImages] = useState<string[]>([])
  const [sourceRootPath, setSourceRootPath] = useState('')
  const [template, setTemplate] = useState<VideoStyleTemplate>(() => INITIAL_SAVED_TEMPLATE?.template ?? DEFAULT_TEMPLATE)
  const [templateSavedAt, setTemplateSavedAt] = useState<number>(() => INITIAL_SAVED_TEMPLATE?.savedAt ?? 0)
  const [bgmPath, setBgmPath] = useState('')
  const [batchCount, setBatchCount] = useState('1')
  const [generatedVideos, setGeneratedVideos] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isScanningRoot, setIsScanningRoot] = useState(false)
  const [generateProgressPercent, setGenerateProgressPercent] = useState(0)
  const [generateProgressText, setGenerateProgressText] = useState('')
  const [isSyncingHotMusic, setIsSyncingHotMusic] = useState(false)
  const [isLoadingBgmList, setIsLoadingBgmList] = useState(false)
  const [bgmOptions, setBgmOptions] = useState<string[]>([])
  const [hotMusicOutputDir, setHotMusicOutputDir] = useState('')
  const [hotMusicSummary, setHotMusicSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canGenerate = sourceImages.length > 0 && !isGenerating && !isScanningRoot
  const normalizedMin = Math.max(1, Math.floor(Number(template.imageCountMin) || 1))
  const normalizedMax = Math.max(normalizedMin, Math.floor(Number(template.imageCountMax) || normalizedMin))
  const renderMode: 'hd' = 'hd'
  const selectedBgmValue = bgmPath && bgmPath.trim() ? bgmPath : bgmOptions.length > 0 ? RANDOM_BGM_VALUE : ''
  const isRandomBgmMode = selectedBgmValue === RANDOM_BGM_VALUE

  const updateTemplateNumber = (field: keyof VideoStyleTemplate, value: string): void => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    setTemplate((prev) => ({ ...prev, [field]: parsed }))
  }

  const handleSaveTemplate = (): void => {
    const savedAt = saveTemplateToStorage(template)
    if (!savedAt) {
      setError('模板保存失败，请检查本地存储权限。')
      addLog('[视频处理] 模板保存失败：localStorage 不可用')
      return
    }
    setTemplateSavedAt(savedAt)
    setError(null)
    addLog(`[视频处理] 模板已保存：${template.name ?? '未命名模板'}（${formatSavedAt(savedAt)}）`)
  }

  const handleLoadTemplate = (): void => {
    const saved = loadSavedTemplate()
    if (!saved) {
      setError('未找到已保存模板，请先点击“保存模板”。')
      return
    }
    setTemplate(saved.template)
    setTemplateSavedAt(saved.savedAt)
    setError(null)
    addLog(`[视频处理] 已加载模板：${saved.template.name ?? '未命名模板'}（${formatSavedAt(saved.savedAt)}）`)
  }

  const handleResetTemplate = (): void => {
    setTemplate(DEFAULT_TEMPLATE)
    setError(null)
    addLog('[视频处理] 模板已恢复默认参数')
  }

  const loadHotMusicBgmOptions = async (outputDir?: string): Promise<void> => {
    if (isLoadingBgmList) return
    try {
      setIsLoadingBgmList(true)

      if (typeof window.electronAPI.listDouyinHotMusicTracks === 'function') {
        const result = await window.electronAPI.listDouyinHotMusicTracks({
          outputDir: outputDir?.trim() || undefined
        })
        if (!result.success) {
          const message = result.error || '加载本地 BGM 列表失败。'
          setError(message)
          addLog(`[视频处理] ${message}`)
          return
        }

        setBgmOptions(result.files)
        setHotMusicOutputDir(result.outputDir)
        if (bgmPath && bgmPath !== RANDOM_BGM_VALUE && !result.files.includes(bgmPath)) {
          setBgmPath('')
        }
        return
      }

      const fallbackRoot = outputDir?.trim() || hotMusicOutputDir.trim()
      if (!fallbackRoot) {
        setBgmOptions([])
        return
      }

      const scanFn =
        typeof window.electronAPI.scanDirectoryRecursive === 'function'
          ? window.electronAPI.scanDirectoryRecursive
          : window.electronAPI.scanDirectory
      const files = await scanFn(fallbackRoot)
      const audioFiles = files.filter((filePath) => isAudioFile(filePath))
      setBgmOptions(audioFiles)
      setHotMusicOutputDir(fallbackRoot)
      if (bgmPath && bgmPath !== RANDOM_BGM_VALUE && !audioFiles.includes(bgmPath)) {
        setBgmPath('')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[视频处理] 读取 BGM 列表异常：${message}`)
    } finally {
      setIsLoadingBgmList(false)
    }
  }

  const handleSyncHotMusic = async (): Promise<void> => {
    if (isGenerating || isSyncingHotMusic) return
    try {
      setIsSyncingHotMusic(true)
      setError(null)
      const result = await window.electronAPI.syncDouyinHotMusic()
      if (!result.success) {
        const message = result.error || result.errors[0] || '刷新抖音音乐榜失败。'
        setError(message)
        addLog(`[视频处理] 抖音音乐榜刷新失败：${message}`)
        return
      }

      const summary = `总 ${result.total} 首，新增 ${result.downloaded}，已存在 ${result.skipped}，失败 ${result.failed}`
      setHotMusicOutputDir(result.outputDir)
      setHotMusicSummary(summary)
      addLog(`[视频处理] 抖音音乐榜刷新完成：${summary}，目录：${result.outputDir}`)
      if (result.failed > 0 && result.errors.length > 0) {
        addLog(`[视频处理] 抖音音乐榜失败示例：${result.errors.slice(0, 3).join(' | ')}`)
      }
      await loadHotMusicBgmOptions(result.outputDir)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[视频处理] 刷新抖音音乐榜异常：${message}`)
    } finally {
      setIsSyncingHotMusic(false)
    }
  }

  useEffect(() => {
    void loadHotMusicBgmOptions()
  }, [])

  useEffect(() => {
    if (typeof window.electronAPI.onComposeVideoProgress !== 'function') return
    return window.electronAPI.onComposeVideoProgress((payload) => {
      if (!isGenerating) return
      const message = typeof payload.message === 'string' ? payload.message.trim() : ''
      const batchTotal = Math.max(1, Math.floor(Number(payload.batchTotal) || 1))
      const batchIndex = Math.min(batchTotal, Math.max(1, Math.floor(Number(payload.batchIndex) || 1)))
      const percent = clampNumber(Number(payload.percent) || 0, 0, 1)

      if (message && (!payload.batchIndex || Number(payload.batchIndex) <= 0)) {
        setGenerateProgressText(message)
        return
      }

      const overall = clampNumber(((batchIndex - 1) + percent) / batchTotal, 0, 1)
      setGenerateProgressPercent(Math.round(overall * 100))
      setGenerateProgressText(`第 ${batchIndex}/${batchTotal} 条：${Math.round(percent * 100)}%`)
    })
  }, [isGenerating])

  const revealInFolder = async (filePath: string): Promise<void> => {
    const normalized = String(filePath ?? '').trim()
    if (!normalized) return
    const result = await window.electronAPI.shellShowItemInFolder(normalized)
    if (!result?.success) {
      addLog(`[视频处理] 打开文件夹失败：${result?.error ?? '未知错误'}`)
    }
  }

  const handlePickImageRoot = async (): Promise<void> => {
    if (isGenerating || isScanningRoot) return
    try {
      setIsScanningRoot(true)
      const folderPath = await window.electronAPI.openDirectory()
      if (!folderPath || !folderPath.trim()) return

      const scanFn =
        typeof window.electronAPI.scanDirectoryRecursive === 'function'
          ? window.electronAPI.scanDirectoryRecursive
          : window.electronAPI.scanDirectory
      const files = await scanFn(folderPath.trim())
      const imagePaths = files.filter((item) => isImageFile(item))
      if (imagePaths.length === 0) {
        setError('该目录下未发现可用图片（支持 jpg/jpeg/png/webp/heic）。')
        addLog(`[视频处理] 图片根目录无可用素材：${folderPath}`)
        window.alert('该目录下未发现可用图片（支持 jpg/jpeg/png/webp/heic）。')
        return
      }

      setSourceRootPath(folderPath.trim())
      setSourceImages(Array.from(new Set(imagePaths)))
      setError(null)
      addLog(`[视频处理] 已从目录导入 ${imagePaths.length} 张图片：${folderPath}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[视频处理] 选择图片根目录失败：${message}`)
      window.alert(`选择图片根目录失败：${message}`)
    } finally {
      setIsScanningRoot(false)
    }
  }

  const startGenerate = async (): Promise<void> => {
    if (!canGenerate) return
    if (sourceImages.length < normalizedMin) {
      setError(`当前仅 ${sourceImages.length} 张图，至少需要 ${normalizedMin} 张。`)
      return
    }

    const count = Math.max(1, Math.min(20, Math.floor(Number(batchCount) || 1)))
    setError(null)
    setGenerateProgressPercent(0)
    setGenerateProgressText(`第 1/${count} 条：0%`)
    setIsGenerating(true)

    try {
      const bgmMode: 'none' | 'fixed' | 'random' =
        selectedBgmValue === RANDOM_BGM_VALUE ? 'random' : selectedBgmValue.trim() ? 'fixed' : 'none'
      const result = await window.electronAPI.composeVideoBatchFromImages({
        sourceImages,
        template: {
          ...template,
          imageCountMin: normalizedMin,
          imageCountMax: normalizedMax
        },
        batchCount: count,
        bgmMode,
        bgmPath: bgmMode === 'fixed' ? selectedBgmValue.trim() : undefined,
        bgmOptions: bgmMode === 'random' ? bgmOptions : undefined,
        seedBase: Date.now(),
        renderMode
      })

      if (result.successCount === 0) {
        setError('本轮生成全部失败，请检查模板参数和素材。')
      }

      if (result.outputs.length > 0) {
        setGeneratedVideos((prev) => [...result.outputs.slice().reverse(), ...prev].slice(0, 80))
      }

      addLog(
        `[视频处理] 批量生成完成：成功 ${result.successCount}，失败 ${result.failedCount}，素材池 ${result.sourceImageCount} 张`
      )
      if (result.failures.length > 0) {
        addLog(
          `[视频处理] 失败示例：${result.failures
            .slice(0, 3)
            .map((item) => `${item.index}/${count} ${item.error}`)
            .join(' | ')}`
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[视频处理] 生成中断：${message}`)
    } finally {
      setIsGenerating(false)
      if (count > 0) {
        setGenerateProgressPercent(100)
        setGenerateProgressText(`第 ${count}/${count} 条：100%`)
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>视频处理</CardTitle>
          <CardDescription>选择图片根目录后，仅显示目录路径与数量，不加载缩略图，减少卡顿。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void handlePickImageRoot()} disabled={isGenerating || isScanningRoot}>
              {isScanningRoot ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  扫描目录中...
                </span>
              ) : (
                '选择图片目录'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSourceImages([])
                setSourceRootPath('')
                setError(null)
              }}
              disabled={isGenerating || isScanningRoot || sourceImages.length === 0}
            >
              清空素材
            </Button>
            {sourceRootPath ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => void revealInFolder(sourceRootPath)}
                aria-label="打开图片目录"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            ) : null}
          </div>

          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-300">
            <div className="truncate">
              图片根目录：{sourceRootPath ? sourceRootPath : '未选择'}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              已识别图片：{sourceImages.length} 张
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              系统不会在此处加载图片预览。
            </div>
          </div>

          {error ? <div className="text-sm text-rose-300">{error}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>模板参数</CardTitle>
          <CardDescription>先固定“风格模板”，再批量生产。随机变化只在允许范围内进行。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={handleSaveTemplate} disabled={isGenerating || isScanningRoot}>
              保存模板
            </Button>
            <Button type="button" variant="outline" onClick={handleLoadTemplate} disabled={isGenerating || isScanningRoot}>
              加载模板
            </Button>
            <Button type="button" variant="outline" onClick={handleResetTemplate} disabled={isGenerating || isScanningRoot}>
              恢复默认
            </Button>
            <div className="text-xs text-zinc-500">
              最近保存：{formatSavedAt(templateSavedAt)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">模板名</div>
              <Input
                value={template.name ?? ''}
                onChange={(e) => setTemplate((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">总时长（秒）</div>
              <Input value={template.totalDurationSec} onChange={(e) => updateTemplateNumber('totalDurationSec', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">图片最小数</div>
              <Input value={template.imageCountMin} onChange={(e) => updateTemplateNumber('imageCountMin', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">图片最大数</div>
              <Input value={template.imageCountMax} onChange={(e) => updateTemplateNumber('imageCountMax', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">宽度</div>
              <Input value={template.width} onChange={(e) => updateTemplateNumber('width', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">高度</div>
              <Input value={template.height} onChange={(e) => updateTemplateNumber('height', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">FPS</div>
              <Input value={template.fps} onChange={(e) => updateTemplateNumber('fps', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">转场</div>
              <select
                value={template.transitionType}
                onChange={(e) =>
                  setTemplate((prev) => ({
                    ...prev,
                    transitionType: e.target.value as VideoTemplateTransition
                  }))
                }
                className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200"
              >
                <option value="none">none</option>
                <option value="fade">fade</option>
                <option value="slideleft">slideleft</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">转场时长（秒）</div>
              <Input
                value={template.transitionDurationSec}
                onChange={(e) => updateTemplateNumber('transitionDurationSec', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-xs text-zinc-400">BGM 音量（0-2）</div>
              <Input value={template.bgmVolume} onChange={(e) => updateTemplateNumber('bgmVolume', e.target.value)} />
            </div>
          </div>

          <details className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <summary className="cursor-pointer text-sm text-zinc-200">查看模板 JSON</summary>
            <pre className="mt-3 overflow-auto rounded-md bg-black p-3 text-xs text-emerald-300">
              {JSON.stringify(
                {
                  ...template,
                  imageCountMin: normalizedMin,
                  imageCountMax: normalizedMax,
                  sourceRootPath,
                  sourceImageCount: sourceImages.length
                },
                null,
                2
              )}
            </pre>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生成控制</CardTitle>
          <CardDescription>根据模板随机抽图并生成视频。每次生成都带 seed，方便后续复现。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs text-zinc-400">背景音乐</div>
            <div className="mb-2">
              <select
                value={selectedBgmValue}
                onChange={(event) => setBgmPath(event.target.value)}
                disabled={isGenerating || isSyncingHotMusic || isLoadingBgmList || bgmOptions.length === 0}
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200"
              >
                {bgmOptions.length === 0 ? (
                  <option value="">暂无可用音乐，请先点击“一键刷新音乐榜”</option>
                ) : (
                  <option value={RANDOM_BGM_VALUE}>随机一首背景音乐</option>
                )}
                {bgmOptions.map((filePath) => (
                  <option key={filePath} value={filePath}>
                    {fileNameFromPath(filePath)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleSyncHotMusic()}
                disabled={isGenerating || isSyncingHotMusic}
              >
                {isSyncingHotMusic ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    刷新音乐榜中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    一键刷新音乐榜
                  </span>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadHotMusicBgmOptions(hotMusicOutputDir)}
                disabled={isGenerating || isSyncingHotMusic || isLoadingBgmList}
              >
                {isLoadingBgmList ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    刷新本地列表中...
                  </span>
                ) : (
                  '刷新本地列表'
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBgmPath(RANDOM_BGM_VALUE)}
                disabled={isGenerating || bgmOptions.length === 0 || isRandomBgmMode}
              >
                设为随机
              </Button>
              {selectedBgmValue && selectedBgmValue !== RANDOM_BGM_VALUE ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => void revealInFolder(selectedBgmValue)}
                  aria-label="打开 BGM 所在目录"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
              {hotMusicOutputDir ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => void revealInFolder(hotMusicOutputDir)}
                  aria-label="打开音乐榜下载目录"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <div className="mt-2 truncate text-xs text-zinc-500">
              {selectedBgmValue === RANDOM_BGM_VALUE
                ? '随机一首背景音乐（每条视频随机抽取）'
                : selectedBgmValue || '未选择背景音乐（将输出无音轨视频）'}
            </div>
            {hotMusicSummary ? <div className="mt-1 text-xs text-zinc-500">{hotMusicSummary}</div> : null}
            {hotMusicOutputDir ? (
              <div className="mt-1 truncate text-xs text-zinc-500">音乐榜目录：{hotMusicOutputDir}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex w-32 flex-col gap-1">
              <div className="text-xs text-zinc-400">本次生成数量</div>
              <Input value={batchCount} onChange={(e) => setBatchCount(e.target.value)} />
            </div>
            <div className="text-xs text-zinc-500">生成模式：高清 1080p</div>
            <Button type="button" onClick={() => void startGenerate()} disabled={!canGenerate}>
              {isGenerating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Shuffle className="h-4 w-4" />
                  开始随机生成
                </span>
              )}
            </Button>
            <div className="text-xs text-zinc-500">
              抽样规则：每条视频随机使用 {normalizedMin}-{normalizedMax} 张图
              （高清：1080p / 12fps / 轻转场）
            </div>
          </div>
          {isGenerating ? (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
                <div
                  className="h-full bg-emerald-400 transition-all duration-150"
                  style={{ width: `${clampNumber(generateProgressPercent, 0, 100)}%` }}
                />
              </div>
              <div className="text-xs text-zinc-400">
                {generateProgressText || `总进度：${generateProgressPercent}%`}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>输出结果</CardTitle>
          <CardDescription>最新生成的视频会显示在这里，可直接定位文件。</CardDescription>
        </CardHeader>
        <CardContent>
          {generatedVideos.length === 0 ? (
            <div className="text-sm text-zinc-400">暂无输出。</div>
          ) : (
            <div className="space-y-2">
              {generatedVideos.map((videoPath) => (
                <div key={videoPath} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
                  <div className="min-w-0 flex-1 truncate text-sm text-zinc-300">{fileNameFromPath(videoPath)}</div>
                  <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => void revealInFolder(videoPath)}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export { VideoComposerPanel }
