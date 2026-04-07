import { useEffect, useMemo, useState } from 'react'

import { useCmsStore } from '@renderer/store/useCmsStore'

export const VIDEO_COMPOSER_DEFAULT_TEMPLATE: VideoStyleTemplate = {
  name: 'style-v1',
  totalDurationSec: 15,
  imageCountMin: 5,
  imageCountMax: 8,
  width: 1080,
  height: 1920,
  fps: 24,
  transitionType: 'fade',
  transitionDurationSec: 0.3,
  bgmVolume: 0.28
}

export const VIDEO_COMPOSER_TEMPLATE_STORAGE_KEY = 'cms.videoComposer.template.v1'
export const VIDEO_COMPOSER_RANDOM_BGM_VALUE = '__RANDOM_BGM__'

type VideoComposerLogOptions = {
  prefix: string
}

type UseVideoComposerControllerOptions = {
  logPrefix: string
  listenMaterialImport?: boolean
}

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

export function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

export function fileUrlFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = /^[A-Za-z]:[/]/.test(normalized) ? `/${normalized}` : normalized
  const encoded = encodeURI(withLeadingSlash).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `safe-file://${encoded}`
}

export function isVideoComposerImageFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return (
    normalized.endsWith('.jpg') ||
    normalized.endsWith('.jpeg') ||
    normalized.endsWith('.png') ||
    normalized.endsWith('.webp') ||
    normalized.endsWith('.heic')
  )
}

export function isVideoComposerVideoFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return normalized.endsWith('.mp4') || normalized.endsWith('.mov')
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

function normalizeTemplateFromUnknown(raw: unknown): VideoStyleTemplate {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const transition = source.transitionType
  const transitionType: VideoTemplateTransition =
    transition === 'none' || transition === 'slideleft' ? transition : 'fade'
  const imageCountMin = toSafeInt(
    source.imageCountMin,
    VIDEO_COMPOSER_DEFAULT_TEMPLATE.imageCountMin,
    1,
    50
  )
  const imageCountMax = toSafeInt(
    source.imageCountMax,
    VIDEO_COMPOSER_DEFAULT_TEMPLATE.imageCountMax,
    1,
    50
  )
  const min = Math.min(imageCountMin, imageCountMax)
  const max = Math.max(imageCountMin, imageCountMax)

  return {
    name:
      typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : VIDEO_COMPOSER_DEFAULT_TEMPLATE.name,
    totalDurationSec: clampNumber(
      toSafeNumber(source.totalDurationSec, VIDEO_COMPOSER_DEFAULT_TEMPLATE.totalDurationSec),
      2,
      60
    ),
    imageCountMin: min,
    imageCountMax: max,
    width: toSafeInt(source.width, VIDEO_COMPOSER_DEFAULT_TEMPLATE.width, 360, 4096),
    height: toSafeInt(source.height, VIDEO_COMPOSER_DEFAULT_TEMPLATE.height, 360, 4096),
    fps: toSafeInt(source.fps, VIDEO_COMPOSER_DEFAULT_TEMPLATE.fps, 12, 24),
    transitionType,
    transitionDurationSec: clampNumber(
      toSafeNumber(
        source.transitionDurationSec,
        VIDEO_COMPOSER_DEFAULT_TEMPLATE.transitionDurationSec
      ),
      0,
      3
    ),
    bgmVolume: clampNumber(
      toSafeNumber(source.bgmVolume, VIDEO_COMPOSER_DEFAULT_TEMPLATE.bgmVolume),
      0,
      2
    )
  }
}

function loadSavedTemplate(): { template: VideoStyleTemplate; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(VIDEO_COMPOSER_TEMPLATE_STORAGE_KEY)
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
      VIDEO_COMPOSER_TEMPLATE_STORAGE_KEY,
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

export function formatVideoComposerSavedAt(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未保存'
  try {
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '未保存'
  }
}

function truncateDebugDetails(details?: string): string {
  const normalized = typeof details === 'string' ? details.trim() : ''
  if (!normalized) return ''
  if (normalized.length <= 360) return normalized
  return `${normalized.slice(0, 360)}...`
}

function addComposerLog(
  addLog: (msg: string) => void,
  options: VideoComposerLogOptions,
  message: string
): void {
  addLog(`${options.prefix} ${message}`)
}

export function useVideoComposerController(options: UseVideoComposerControllerOptions) {
  const addLog = useCmsStore((store) => store.addLog)
  const materialImport = useCmsStore((store) => store.materialImport)
  const clearMaterialImport = useCmsStore((store) => store.clearMaterialImport)
  const logOptions = useMemo<VideoComposerLogOptions>(
    () => ({ prefix: options.logPrefix }),
    [options.logPrefix]
  )
  const initialSavedTemplate = useMemo(() => loadSavedTemplate(), [])

  const [sourceImages, setSourceImages] = useState<string[]>([])
  const [sourceVideos, setSourceVideos] = useState<string[]>([])
  const [sourceRootPath, setSourceRootPath] = useState('')
  const [template, setTemplate] = useState<VideoStyleTemplate>(() => VIDEO_COMPOSER_DEFAULT_TEMPLATE)
  const [templateSavedAt, setTemplateSavedAt] = useState<number>(
    () => initialSavedTemplate?.savedAt ?? 0
  )
  const [bgmPath, setBgmPath] = useState('')
  const [batchCount, setBatchCount] = useState('1')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isScanningRoot, setIsScanningRoot] = useState(false)
  const [outputAspect, setOutputAspect] = useState<'9:16' | '3:4'>('9:16')
  const [generateProgressPercent, setGenerateProgressPercent] = useState(0)
  const [generateProgressText, setGenerateProgressText] = useState('')
  const [isSyncingHotMusic, setIsSyncingHotMusic] = useState(false)
  const [isLoadingBgmList, setIsLoadingBgmList] = useState(false)
  const [bgmOptions, setBgmOptions] = useState<string[]>([])
  const [hotMusicOutputDir, setHotMusicOutputDir] = useState('')
  const [hotMusicSummary, setHotMusicSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sourceMediaCount = sourceImages.length + sourceVideos.length
  const canGenerate = sourceMediaCount > 0 && !isGenerating && !isScanningRoot
  const normalizedMin = Math.max(1, Math.floor(Number(template.imageCountMin) || 1))
  const normalizedMax = Math.max(normalizedMin, Math.floor(Number(template.imageCountMax) || normalizedMin))
  const renderMode: 'hd' = 'hd'
  const outputSizeLabel = outputAspect === '3:4' ? '1080x1440' : '1080x1920'
  const selectedBgmValue =
    bgmPath && bgmPath.trim()
      ? bgmPath
      : bgmOptions.length > 0
        ? VIDEO_COMPOSER_RANDOM_BGM_VALUE
        : ''

  const updateTemplateNumber = (field: keyof VideoStyleTemplate, value: string): void => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    setTemplate((prev) => ({ ...prev, [field]: parsed }))
  }

  const loadSourceMedia = (
    paths: string[],
    nextSourceRootPath = '',
    sourceLabel = '已导入素材'
  ): { imagePaths: string[]; videoPaths: string[] } | null => {
    const imagePaths = Array.from(
      new Set(paths.map((item) => String(item ?? '').trim()).filter(isVideoComposerImageFile))
    )
    const videoPaths = Array.from(
      new Set(paths.map((item) => String(item ?? '').trim()).filter(isVideoComposerVideoFile))
    )

    if (imagePaths.length === 0 && videoPaths.length === 0) {
      return null
    }

    setSourceRootPath(nextSourceRootPath)
    setSourceImages(imagePaths)
    setSourceVideos(videoPaths)
    setError(null)
    addComposerLog(
      addLog,
      logOptions,
      `${sourceLabel}：图片 ${imagePaths.length} 张，视频 ${videoPaths.length} 条。`
    )
    return { imagePaths, videoPaths }
  }

  const clearSources = (): void => {
    setSourceImages([])
    setSourceVideos([])
    setSourceRootPath('')
    setError(null)
  }

  const resetComposer = (): void => {
    clearSources()
    setTemplate(VIDEO_COMPOSER_DEFAULT_TEMPLATE)
    setTemplateSavedAt(initialSavedTemplate?.savedAt ?? 0)
    setBgmPath('')
    setBatchCount('1')
    setIsGenerating(false)
    setIsScanningRoot(false)
    setOutputAspect('9:16')
    setGenerateProgressPercent(0)
    setGenerateProgressText('')
    setIsSyncingHotMusic(false)
    setIsLoadingBgmList(false)
    setHotMusicSummary('')
    setError(null)
  }

  const handleSaveTemplate = (): void => {
    const savedAt = saveTemplateToStorage(template)
    if (!savedAt) {
      setError('模板保存失败，请检查本地存储权限。')
      addComposerLog(addLog, logOptions, '模板保存失败：localStorage 不可用')
      return
    }
    setTemplateSavedAt(savedAt)
    setError(null)
    addComposerLog(
      addLog,
      logOptions,
      `模板已保存：${template.name ?? '未命名模板'}（${formatVideoComposerSavedAt(savedAt)}）`
    )
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
    addComposerLog(
      addLog,
      logOptions,
      `已加载模板：${saved.template.name ?? '未命名模板'}（${formatVideoComposerSavedAt(saved.savedAt)}）`
    )
  }

  const handleResetTemplate = (): void => {
    setTemplate(VIDEO_COMPOSER_DEFAULT_TEMPLATE)
    setError(null)
    addComposerLog(addLog, logOptions, '模板已恢复默认参数')
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
          addComposerLog(addLog, logOptions, message)
          return
        }

        setBgmOptions(result.files)
        setHotMusicOutputDir(result.outputDir)
        if (bgmPath && bgmPath !== VIDEO_COMPOSER_RANDOM_BGM_VALUE && !result.files.includes(bgmPath)) {
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
      if (bgmPath && bgmPath !== VIDEO_COMPOSER_RANDOM_BGM_VALUE && !audioFiles.includes(bgmPath)) {
        setBgmPath('')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addComposerLog(addLog, logOptions, `读取 BGM 列表异常：${message}`)
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
        addComposerLog(addLog, logOptions, `抖音音乐榜刷新失败：${message}`)
        return
      }

      const summary = `总 ${result.total} 首，新增 ${result.downloaded}，已存在 ${result.skipped}，失败 ${result.failed}`
      setHotMusicOutputDir(result.outputDir)
      setHotMusicSummary(summary)
      addComposerLog(addLog, logOptions, `抖音音乐榜刷新完成：${summary}，目录：${result.outputDir}`)
      if (result.failed > 0 && result.errors.length > 0) {
        addComposerLog(
          addLog,
          logOptions,
          `抖音音乐榜失败示例：${result.errors.slice(0, 3).join(' | ')}`
        )
      }
      await loadHotMusicBgmOptions(result.outputDir)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addComposerLog(addLog, logOptions, `刷新抖音音乐榜异常：${message}`)
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

  useEffect(() => {
    if (
      !options.listenMaterialImport ||
      materialImport.source !== 'aiStudio' ||
      materialImport.target !== 'video' ||
      materialImport.paths.length === 0
    ) {
      return
    }

    const loaded = loadSourceMedia(materialImport.paths, '', '已接收 AI 工作台素材')
    if (!loaded) {
      setError('AI 工作台回流的素材里没有可用的图片/视频文件。')
      addComposerLog(addLog, logOptions, 'AI 工作台回流素材未识别到可用文件。')
      clearMaterialImport()
      return
    }

    clearMaterialImport()
  }, [addLog, clearMaterialImport, logOptions, materialImport, options.listenMaterialImport])

  const handlePickMediaFolder = async (): Promise<void> => {
    if (isGenerating || isScanningRoot) return
    try {
      setIsScanningRoot(true)
      const folderPath = await window.electronAPI.openDirectory()
      if (!folderPath || !folderPath.trim()) return

      const scanFn =
        typeof window.electronAPI.scanMediaDirectoryRecursive === 'function'
          ? window.electronAPI.scanMediaDirectoryRecursive
          : typeof window.electronAPI.scanDirectoryRecursive === 'function'
            ? window.electronAPI.scanDirectoryRecursive
            : window.electronAPI.scanDirectory
      const files = await scanFn(folderPath.trim())
      const loaded = loadSourceMedia(files, folderPath.trim(), '已从目录导入素材')
      if (!loaded) {
        setError('该目录下未发现可用素材（图片: jpg/jpeg/png/webp/heic；视频: mp4/mov）。')
        addComposerLog(addLog, logOptions, `素材目录无可用素材：${folderPath}`)
        window.alert('该目录下未发现可用素材（图片: jpg/jpeg/png/webp/heic；视频: mp4/mov）。')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addComposerLog(addLog, logOptions, `选择素材文件夹失败：${message}`)
      window.alert(`选择素材文件夹失败：${message}`)
    } finally {
      setIsScanningRoot(false)
    }
  }

  const handlePickMediaFiles = async (): Promise<void> => {
    if (isGenerating || isScanningRoot) return
    try {
      setIsScanningRoot(true)
      const picked =
        typeof window.electronAPI.openMediaFilePaths === 'function'
          ? await window.electronAPI.openMediaFilePaths({ multiSelections: true, accept: 'all' })
          : await window.electronAPI.openMediaFiles({ multiSelections: true, accept: 'all' })
      const paths = Array.isArray(picked)
        ? picked.map((item) =>
            typeof item === 'string'
              ? item
              : item && typeof item === 'object' && 'originalPath' in item
                ? String((item as { originalPath?: unknown }).originalPath ?? '').trim()
                : ''
          )
        : picked && typeof picked === 'object' && 'originalPath' in picked
          ? [String((picked as { originalPath?: unknown }).originalPath ?? '').trim()]
          : typeof picked === 'string'
            ? [picked]
            : []
      if (paths.length === 0) return

      const loaded = loadSourceMedia(paths, '', '已选择文件素材')
      if (!loaded) {
        setError('未选择到可用素材（图片: jpg/jpeg/png/webp/heic；视频: mp4/mov）。')
        addComposerLog(addLog, logOptions, '选择文件后未识别到可用图片/视频素材。')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addComposerLog(addLog, logOptions, `选择素材文件失败：${message}`)
      window.alert(`选择素材文件失败：${message}`)
    } finally {
      setIsScanningRoot(false)
    }
  }

  const startGenerate = async (): Promise<ComposeVideoBatchFromImagesResult | null> => {
    if (!canGenerate) return null
    if (sourceVideos.length === 0 && sourceImages.length < normalizedMin) {
      setError(`当前仅 ${sourceImages.length} 张图，至少需要 ${normalizedMin} 张。`)
      return null
    }

    const count = Math.max(1, Math.min(20, Math.floor(Number(batchCount) || 1)))
    setError(null)
    setGenerateProgressPercent(0)
    setGenerateProgressText(`第 1/${count} 条：0%`)
    setIsGenerating(true)

    try {
      const bgmMode: 'none' | 'fixed' | 'random' =
        selectedBgmValue === VIDEO_COMPOSER_RANDOM_BGM_VALUE
          ? 'random'
          : selectedBgmValue.trim()
            ? 'fixed'
            : 'none'
      const result = await window.electronAPI.composeVideoBatchFromImages({
        sourceImages,
        sourceVideos,
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
        renderMode,
        outputAspect
      })

      const firstFailure = result.failures[0]
      if (result.successCount === 0) {
        const reason = firstFailure?.error?.trim() || '未知错误'
        setError(`本轮生成全部失败：${reason}`)
      }

      addComposerLog(
        addLog,
        logOptions,
        `批量生成完成：成功 ${result.successCount}，失败 ${result.failedCount}，素材池 ${result.sourceMediaCount} 项（图 ${result.sourceImageCount} / 视频 ${result.sourceVideoCount}）`
      )
      if (result.failures.length > 0) {
        addComposerLog(
          addLog,
          logOptions,
          `失败示例：${result.failures
            .slice(0, 3)
            .map((item) => `${item.index}/${count} ${item.error}`)
            .join(' | ')}`
        )
        result.failures.slice(0, 3).forEach((item) => {
          const details = truncateDebugDetails(item.details)
          if (details) addComposerLog(addLog, logOptions, `[debug] #${item.index} ${details}`)
        })
      }
      if (result.debugLogPath) {
        addComposerLog(addLog, logOptions, `调试日志：${result.debugLogPath}`)
      }

      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addComposerLog(addLog, logOptions, `生成中断：${message}`)
      return null
    } finally {
      setIsGenerating(false)
      if (count > 0) {
        setGenerateProgressPercent(100)
        setGenerateProgressText(`第 ${count}/${count} 条：100%`)
      }
    }
  }

  const setBgmSelectionValue = (value: string): void => {
    if (value === VIDEO_COMPOSER_RANDOM_BGM_VALUE) {
      setBgmPath('')
      return
    }
    setBgmPath(value)
  }

  return {
    sourceImages,
    sourceVideos,
    sourceRootPath,
    sourceMediaCount,
    template,
    templateSavedAt,
    bgmPath,
    batchCount,
    outputAspect,
    generateProgressPercent,
    generateProgressText,
    isGenerating,
    isScanningRoot,
    isSyncingHotMusic,
    isLoadingBgmList,
    bgmOptions,
    hotMusicOutputDir,
    hotMusicSummary,
    error,
    canGenerate,
    normalizedMin,
    normalizedMax,
    outputSizeLabel,
    selectedBgmValue,
    setTemplate,
    setBatchCount,
    setOutputAspect,
    setBgmPath,
    setBgmSelectionValue,
    updateTemplateNumber,
    handleSaveTemplate,
    handleLoadTemplate,
    handleResetTemplate,
    handleSyncHotMusic,
    loadHotMusicBgmOptions,
    handlePickMediaFolder,
    handlePickMediaFiles,
    clearSources,
    resetComposer,
    loadSourceMedia,
    startGenerate
  }
}
