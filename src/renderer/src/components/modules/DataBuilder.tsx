import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Virtuoso } from 'react-virtuoso'

import {
  ChevronDown,
  ChevronUp,
  Film,
  FolderOpen,
  Images,
  ListChecks,
  Loader2,
  RotateCcw,
  ScanSearch,
  Send,
  Sparkles
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { CmsProductMultiSelectPanel } from '@renderer/components/ui/CmsProductMultiSelectPanel'
import { Input } from '@renderer/components/ui/input'
import { TaskCard } from '@renderer/components/ui/TaskCard'
import { generateManifest, generateVideoManifest } from '@renderer/lib/cms-engine'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'
import {
  buildAiStudioImageImportKey,
  shouldSyncAiStudioImageImport
} from './workshopImportSyncHelpers'
import {
  buildSelectedWorkshopProducts,
  resolveWorkshopAccountId
} from './workshopProductSelectionHelpers'
import {
  applyBatchCoverPathsToVideoTasks,
  sortCoverImagePathsByNaturalFilename
} from './videoBatchCoverHelpers'
import { shouldShowDispatchPanel } from './dispatchPanelVisibilityHelpers'
import {
  replaceVideoTaskCoverById,
  restoreVideoTaskCoverById
} from './videoTaskCoverSyncHelpers'
import { resolveVideoCoverPreview } from './videoCoverPreviewHelpers'

function numberOr(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function fileUrlFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = /^[A-Za-z]:[/]/.test(normalized) ? `/${normalized}` : normalized
  const encoded = encodeURI(withLeadingSlash).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `safe-file://${encoded}`
}

function dirNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  parts.pop()
  return parts.join('/')
}

function commonDirFromPaths(paths: string[]): string {
  const normalizedDirs = paths
    .map((item) => dirNameFromPath(String(item ?? '').trim()))
    .map((item) => item.trim())
    .filter(Boolean)
  if (normalizedDirs.length === 0) return ''
  if (normalizedDirs.length === 1) return normalizedDirs[0] ?? ''

  const splitDirs = normalizedDirs.map((item) => item.split('/').filter((segment) => segment.length > 0))
  const first = splitDirs[0] ?? []
  const prefix: string[] = []
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index]
    if (!segment) break
    if (splitDirs.every((parts) => parts[index] === segment)) {
      prefix.push(segment)
      continue
    }
    break
  }

  const sample = normalizedDirs[0] ?? ''
  const hasLeadingSlash = sample.startsWith('/')
  const common = prefix.join('/')
  if (!common) return ''
  return hasLeadingSlash ? `/${common}` : common
}

function extractOriginalPathFromMediaResult(result: unknown): string {
  const item = Array.isArray(result) ? result[0] : result
  if (!item || typeof item !== 'object') return ''
  const path =
    typeof (item as { originalPath?: unknown }).originalPath === 'string'
      ? String((item as { originalPath?: unknown }).originalPath).trim()
      : ''
  return path
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

async function saveFrameFromVideoElement(video: HTMLVideoElement): Promise<string> {
  const safeTime = Number.isFinite(video.currentTime) ? Math.max(0, Number(video.currentTime)) : 0
  const sourcePathFromDataset = String(video.dataset.captureSourcePath ?? '').trim()
  if (!sourcePathFromDataset) throw new Error('视频源路径缺失')
  const savedPath = await window.electronAPI.captureVideoFrame(sourcePathFromDataset, safeTime)
  const normalized = String(savedPath).trim()
  if (!normalized) throw new Error('封面保存失败')
  return normalized
}

async function captureVideoFirstFrame(videoPath: string): Promise<string> {
  const normalizedPath = String(videoPath ?? '').trim()
  if (!normalizedPath) throw new Error('视频路径为空')
  const savedPath = await window.electronAPI.captureVideoFrame(normalizedPath, 0.05)
  const normalizedSavedPath = String(savedPath ?? '').trim()
  if (!normalizedSavedPath) throw new Error('封面保存失败')
  return normalizedSavedPath
}

function formatTimeLabel(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const total = Math.floor(safeSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function buildUploadTasksFromPreviewTasks(
  tasks: Array<{ title: string; body: string; assignedImages: string[]; mediaType?: 'image' | 'video' }>
): Array<{ title: string; body: string; images: string[] }> {
  return tasks.map((task) => ({
    title: task.title,
    body: task.body,
    images: task.mediaType === 'video' ? [] : task.assignedImages
  }))
}

type WorkshopMetricTone = 'amber' | 'emerald' | 'sky' | 'rose'

interface WorkshopMetricCardProps {
  icon: React.ReactNode
  label: string
  value: string
  tone?: WorkshopMetricTone
}

const metricToneClasses: Record<WorkshopMetricTone, string> = {
  amber: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
  emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
  sky: 'border-sky-400/20 bg-sky-400/10 text-sky-100',
  rose: 'border-rose-400/20 bg-rose-400/10 text-rose-100'
}

const CMS_PRODUCTS_SYNCED_EVENT = 'cms.products.synced'

function WorkshopMetricCard({
  icon,
  label,
  value,
  tone = 'amber'
}: WorkshopMetricCardProps): React.JSX.Element {
  return (
    <div className="rounded-[18px] border border-zinc-800/80 bg-black/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
        <div className={cn('rounded-xl border p-2', metricToneClasses[tone])}>{icon}</div>
      </div>
      <div className="mt-2 text-xl font-semibold tracking-[0.02em] text-zinc-50">{value}</div>
    </div>
  )
}

function DataBuilder(): React.JSX.Element {
  const [imageFiles, setImageFiles] = useState<string[]>([])
  const [groupCount, setGroupCount] = useState('0')
  const [minImages, setMinImages] = useState('3')
  const [maxImages, setMaxImages] = useState('5')
  const [maxReuse, setMaxReuse] = useState('2')
  const [isScanning, setIsScanning] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDispatching, setIsDispatching] = useState(false)
  const [dispatchProgress, setDispatchProgress] = useState<{
    processed: number
    total: number
    created: number
    message: string
  } | null>(null)
  const [accounts, setAccounts] = useState<CmsAccountRecord[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [allProducts, setAllProducts] = useState<CmsProductRecord[]>([])
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set())
  const [queuedTaskIds, setQueuedTaskIds] = useState<Set<string>>(() => new Set())
  const [toastMessage, setToastMessage] = useState<string>('')
  const [isPreparingVideoCover, setIsPreparingVideoCover] = useState(false)
  const [isSavingManualCover, setIsSavingManualCover] = useState(false)
  const [videoCoverProgress, setVideoCoverProgress] = useState('')
  const [videoTaskFallbackCoverMap, setVideoTaskFallbackCoverMap] = useState<Record<string, string>>({})
  const [manualCoverEditorTaskId, setManualCoverEditorTaskId] = useState('')
  const [manualCoverEditorPlayablePath, setManualCoverEditorPlayablePath] = useState('')
  const [isManualCoverEditorPreparing, setIsManualCoverEditorPreparing] = useState(false)
  const [isManualCoverEditorPlaying, setIsManualCoverEditorPlaying] = useState(false)
  const [manualCoverEditorTimeSec, setManualCoverEditorTimeSec] = useState(0)
  const [isDispatchPanelCollapsed, setIsDispatchPanelCollapsed] = useState(false)
  const manualCoverEditorVideoRef = useRef<HTMLVideoElement | null>(null)
  const lastScannedPathRef = useRef('')
  const lastAiStudioImportKeyRef = useRef('')
  const videoCoverCacheRef = useRef<Map<string, string>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollParent, setScrollParent] = useState<HTMLElement | undefined>(undefined)

  const tasks = useCmsStore((s) => s.tasks)
  const addLog = useCmsStore((s) => s.addLog)
  const setTasks = useCmsStore((s) => s.setTasks)
  const setUploadTasks = useCmsStore((s) => s.setUploadTasks)
  const csvContent = useCmsStore((s) => s.csvContent)
  const dataWorkshopFolderPath = useCmsStore((s) => s.dataWorkshopFolderPath)
  const workshopImport = useCmsStore((s) => s.workshopImport)
  const setCsvContent = useCmsStore((s) => s.setCsvContent)
  const setDataWorkshopFolderPath = useCmsStore((s) => s.setDataWorkshopFolderPath)
  const setWorkshopImport = useCmsStore((s) => s.setWorkshopImport)
  const workspacePath = useCmsStore((s) => s.workspacePath)
  const activeModule = useCmsStore((s) => s.activeModule)
  const preferredAccountId = useCmsStore((s) => s.preferredAccountId)
  const setPreferredAccountId = useCmsStore((s) => s.setPreferredAccountId)
  const isWorkshopActive = activeModule === 'workshop'

  const importedVideoPaths = useMemo(() => {
    if (workshopImport?.type !== 'video') return []
    const fromPaths = Array.isArray(workshopImport.paths)
      ? workshopImport.paths.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    if (fromPaths.length > 0) return fromPaths
    const single = String(workshopImport.path ?? '').trim()
    return single ? [single] : []
  }, [workshopImport])

  const importedImagePaths = useMemo(() => {
    if (workshopImport?.type !== 'image' || workshopImport?.source !== 'ai-studio') return []
    const fromPaths = Array.isArray(workshopImport.paths)
      ? workshopImport.paths.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    if (fromPaths.length > 0) return fromPaths
    const single = String(workshopImport.path ?? '').trim()
    return single ? [single] : []
  }, [workshopImport])

  const importedVideoPath = useMemo(() => importedVideoPaths[0] ?? '', [importedVideoPaths])
  const importedManualCoverPath = useMemo(() => {
    if (workshopImport?.type !== 'video') return ''
    return typeof workshopImport.coverPath === 'string' ? workshopImport.coverPath.trim() : ''
  }, [workshopImport])

  const importedImageFolderPath = useMemo(() => {
    const commonFolder = commonDirFromPaths(importedImagePaths)
    if (commonFolder) return commonFolder
    const firstImagePath = importedImagePaths[0] ?? ''
    return firstImagePath ? dirNameFromPath(firstImagePath).trim() : ''
  }, [importedImagePaths])

  const isVideoMode = importedVideoPaths.length > 0
  const isAiStudioImageImportMode = importedImagePaths.length > 0
  const videoPreviewTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          task.mediaType === 'video' &&
          typeof task.videoPath === 'string' &&
          task.videoPath.trim().length > 0
      ),
    [tasks]
  )
  const isManualCoverEditorOpen = Boolean(manualCoverEditorTaskId.trim())
  const normalizedManualEditorTaskId = manualCoverEditorTaskId.trim()
  const activeManualCoverTask = useMemo(
    () => videoPreviewTasks.find((task) => task.id === normalizedManualEditorTaskId) ?? null,
    [normalizedManualEditorTaskId, videoPreviewTasks]
  )
  const normalizedManualEditorPath = String(activeManualCoverTask?.videoPath ?? '').trim()
  const normalizedManualEditorPlayablePath = manualCoverEditorPlayablePath.trim()
  const manualCoverEditorSourcePath =
    normalizedManualEditorPlayablePath || normalizedManualEditorPath
  const activeManualCoverPath = String(activeManualCoverTask?.assignedImages?.[0] ?? '').trim()
  const fallbackManualCoverPath = normalizedManualEditorTaskId
    ? (videoTaskFallbackCoverMap[normalizedManualEditorTaskId] ?? '')
    : ''
  const activeManualCoverPreview = useMemo(
    () =>
      resolveVideoCoverPreview({
        manualCoverPath: activeManualCoverPath,
        fallbackCoverPath: fallbackManualCoverPath
      }),
    [activeManualCoverPath, fallbackManualCoverPath]
  )
  const activeManualCoverPreviewSrc = activeManualCoverPreview.path
    ? resolveLocalImage(activeManualCoverPreview.path, workspacePath)
    : ''

  const constraints = useMemo(() => {
    return {
      groupCount: numberOr(groupCount, 0),
      minImages: numberOr(minImages, 0),
      maxImages: numberOr(maxImages, 0),
      maxReuse: numberOr(maxReuse, 1)
    }
  }, [groupCount, minImages, maxImages, maxReuse])

  const filteredProducts = useMemo(() => {
    const accountId = selectedAccountId.trim()
    if (!accountId) return []
    return allProducts.filter((p) => p.accountId === accountId)
  }, [allProducts, selectedAccountId])

  const selectedProducts = useMemo(
    () =>
      buildSelectedWorkshopProducts({
        allProducts: filteredProducts,
        selectedProductIds
      }),
    [filteredProducts, selectedProductIds]
  )

  const selectedProductCount = selectedProducts.length

  useEffect(() => {
    let el = containerRef.current?.parentElement ?? null
    while (el) {
      const overflowY = window.getComputedStyle(el).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        setScrollParent(el)
        return
      }
      el = el.parentElement
    }
  }, [])

  useEffect(() => {
    if (!isAiStudioImageImportMode || !isWorkshopActive) return
    const importKey = buildAiStudioImageImportKey(importedImagePaths)
    if (
      !shouldSyncAiStudioImageImport({
        importedImagePaths,
        currentImageFiles: imageFiles,
        previousImportKey: lastAiStudioImportKeyRef.current
      })
    ) {
      return
    }
    lastAiStudioImportKeyRef.current = importKey
    lastScannedPathRef.current = `__ai_studio__${importedImagePaths.length}`
    setImageFiles(importedImagePaths)
    setTasks([])
    setUploadTasks([])
    setSelectedImageIds(new Set())
    setQueuedTaskIds(new Set())
    setDispatchProgress(null)
    setToastMessage('')
    setVideoTaskFallbackCoverMap({})
    setManualCoverEditorTaskId('')
    if (importedImageFolderPath && dataWorkshopFolderPath.trim() !== importedImageFolderPath) {
      setDataWorkshopFolderPath(importedImageFolderPath)
    }
    addLog(`[Super CMS] 已从 AI素材工作台导入 ${importedImagePaths.length} 张结果图。`)
  }, [
    addLog,
    dataWorkshopFolderPath,
    importedImageFolderPath,
    importedImagePaths,
    imageFiles,
    isAiStudioImageImportMode,
    isWorkshopActive,
    setDataWorkshopFolderPath,
    setTasks,
    setUploadTasks
  ])

  useEffect(() => {
    if (!isVideoMode) {
      setVideoTaskFallbackCoverMap({})
      setVideoCoverProgress('')
      setIsSavingManualCover(false)
      setIsManualCoverEditorPreparing(false)
      setIsManualCoverEditorPlaying(false)
      setManualCoverEditorTaskId('')
      setManualCoverEditorPlayablePath('')
      setManualCoverEditorTimeSec(0)
      videoCoverCacheRef.current.clear()
      return
    }

    const currentVideoPathSet = new Set(
      importedVideoPaths.map((path) => path.trim()).filter(Boolean)
    )
    const cache = videoCoverCacheRef.current
    for (const key of cache.keys()) {
      if (!currentVideoPathSet.has(key)) cache.delete(key)
    }
  }, [importedVideoPaths, isVideoMode])

  useEffect(() => {
    const currentTaskIds = new Set(videoPreviewTasks.map((task) => task.id))
    setVideoTaskFallbackCoverMap((prev) => {
      const next: Record<string, string> = {}
      let changed = false
      for (const task of videoPreviewTasks) {
        const taskId = String(task.id ?? '').trim()
        if (!taskId) continue
        const saved = prev[taskId]
        if (saved) next[taskId] = saved
      }
      const prevKeys = Object.keys(prev)
      if (prevKeys.length !== Object.keys(next).length) changed = true
      if (!changed) {
        for (const key of prevKeys) {
          if (prev[key] !== next[key]) {
            changed = true
            break
          }
        }
      }
      return changed ? next : prev
    })

    const normalizedTaskId = manualCoverEditorTaskId.trim()
    if (!normalizedTaskId) return
    if (currentTaskIds.has(normalizedTaskId)) return
    setManualCoverEditorTaskId('')
    setManualCoverEditorPlayablePath('')
    setManualCoverEditorTimeSec(0)
    setIsManualCoverEditorPlaying(false)
  }, [manualCoverEditorTaskId, videoPreviewTasks])

  useEffect(() => {
    const normalizedEditorPath = String(activeManualCoverTask?.videoPath ?? '').trim()
    if (!manualCoverEditorTaskId.trim() || !normalizedEditorPath) {
      setIsManualCoverEditorPreparing(false)
      setIsManualCoverEditorPlaying(false)
      setManualCoverEditorPlayablePath('')
      return
    }

    let canceled = false
    setIsManualCoverEditorPreparing(true)
    setManualCoverEditorPlayablePath('')
    setIsManualCoverEditorPlaying(false)
    setManualCoverEditorTimeSec(0)

    void (async () => {
      try {
        const prepared = await window.electronAPI.prepareVideoPreview(normalizedEditorPath)
        if (canceled) return
        const previewPath =
          typeof prepared?.previewPath === 'string' && prepared.previewPath.trim()
            ? prepared.previewPath.trim()
            : normalizedEditorPath
        setManualCoverEditorPlayablePath(previewPath)
        if (prepared && typeof prepared.error === 'string' && prepared.error.trim()) {
          addLog(`[Super CMS] 视频封面编辑预处理失败，已回退原视频：${prepared.error}`)
        }
      } catch (error) {
        if (canceled) return
        const message = error instanceof Error ? error.message : String(error)
        addLog(`[Super CMS] 视频封面编辑预处理异常，已回退原视频：${message}`)
        setManualCoverEditorPlayablePath(normalizedEditorPath)
      } finally {
        if (!canceled) setIsManualCoverEditorPreparing(false)
      }
    })()

    return () => {
      canceled = true
    }
  }, [activeManualCoverTask, addLog, manualCoverEditorTaskId])

  const prepareAutoCoverMap = useCallback(
    async (videoPaths: string[]): Promise<Map<string, string>> => {
      const uniquePaths = Array.from(
        new Set(videoPaths.map((item) => String(item ?? '').trim()).filter(Boolean))
      )
      const nextCoverMap = new Map<string, string>()
      if (uniquePaths.length === 0) return nextCoverMap

      const cache = videoCoverCacheRef.current

      for (let i = 0; i < uniquePaths.length; i += 1) {
        const path = uniquePaths[i]
        if (!path) continue

        const indexLabel = `${i + 1}/${uniquePaths.length}`
        const cached = cache.get(path)
        if (cached) {
          nextCoverMap.set(path, cached)
          setVideoCoverProgress(`封面提取中（${indexLabel}，命中缓存）`)
          continue
        }

        setVideoCoverProgress(`封面提取中（${indexLabel}）`)
        addLog(`[Super CMS] 正在提取视频首帧封面（${indexLabel}）：${path}`)

        try {
          const coverPath = await captureVideoFirstFrame(path)
          cache.set(path, coverPath)
          nextCoverMap.set(path, coverPath)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          addLog(`[Super CMS] 首帧封面提取失败：${path}，${message}`)
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 0)
        })
      }

      return nextCoverMap
    },
    [addLog]
  )

  const handleScan = useCallback(
    async (nextPath?: string): Promise<void> => {
      if (isVideoMode) return
      const path = (nextPath ?? dataWorkshopFolderPath).trim()
      if (!path) {
        addLog('[Super CMS] 请输入文件夹路径后再扫描。')
        return
      }

      lastScannedPathRef.current = path
      setIsScanning(true)
      try {
        addLog(`[Super CMS] 扫描文件夹：${path}`)
        const files = await window.electronAPI.scanDirectory(path)
        setImageFiles(files)
        addLog(`[Super CMS] 扫描完成：找到 ${files.length} 张图片。`)
      } catch (error) {
        addLog(`[Super CMS] 扫描失败：${String(error)}`)
        setImageFiles([])
      } finally {
        setIsScanning(false)
      }
    },
    [addLog, dataWorkshopFolderPath, isVideoMode]
  )

  const handleBrowse = async (): Promise<void> => {
    if (isScanning) return
    try {
      const selected = await window.electronAPI.openDirectory()
      if (!selected) return
      setDataWorkshopFolderPath(selected)
      lastScannedPathRef.current = selected.trim()
      await handleScan(selected)
    } catch (error) {
      addLog(`[Super CMS] 打开目录失败：${String(error)}`)
    }
  }

  const commitPreviewTasks = useCallback(
    (nextTasks: typeof tasks): void => {
      setTasks(nextTasks)
      setUploadTasks(buildUploadTasksFromPreviewTasks(nextTasks))
    },
    [setTasks, setUploadTasks]
  )

  const openManualCoverEditor = (taskId: string): void => {
    const normalizedTaskId = String(taskId ?? '').trim()
    if (!normalizedTaskId) return
    if (isGenerating || isPreparingVideoCover || isSavingManualCover) return
    if (!videoPreviewTasks.some((task) => task.id === normalizedTaskId)) return
    setIsManualCoverEditorPlaying(false)
    setManualCoverEditorTaskId(normalizedTaskId)
    setManualCoverEditorTimeSec(0)
  }

  const closeManualCoverEditor = (): void => {
    if (isSavingManualCover) return
    try {
      manualCoverEditorVideoRef.current?.pause()
    } catch {
      void 0
    }
    setIsManualCoverEditorPlaying(false)
    setIsManualCoverEditorPreparing(false)
    setManualCoverEditorTaskId('')
    setManualCoverEditorPlayablePath('')
    setManualCoverEditorTimeSec(0)
  }

  const handleUploadManualCover = async (): Promise<void> => {
    const targetTaskId = manualCoverEditorTaskId.trim()
    if (!targetTaskId || isSavingManualCover || isGenerating || isPreparingVideoCover) return
    try {
      const result = await window.electronAPI.openMediaFiles({ accept: 'image' })
      const selectedPath = extractOriginalPathFromMediaResult(result)
      if (!selectedPath) return
      if (!isImageFile(selectedPath)) {
        window.alert('请选择图片文件作为封面。')
        return
      }
      const synced = replaceVideoTaskCoverById(tasks, targetTaskId, selectedPath)
      if (!synced.changed) return
      commitPreviewTasks(synced.tasks)
      addLog(`[Super CMS] 已设置手动封面：${fileNameFromPath(normalizedManualEditorPath)} -> ${selectedPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Super CMS] 上传手动封面失败：${message}`)
      window.alert(`上传手动封面失败：${message}`)
    }
  }

  const handleCaptureManualCover = async (): Promise<void> => {
    const targetTaskId = manualCoverEditorTaskId.trim()
    if (!targetTaskId || isSavingManualCover || isGenerating || isPreparingVideoCover) return
    const video = manualCoverEditorVideoRef.current
    if (!video) {
      window.alert('视频预览尚未准备好，请稍后再试。')
      return
    }
    if (!manualCoverEditorSourcePath) {
      window.alert('视频预览尚未准备好，请稍后再试。')
      return
    }
    video.dataset.captureSourcePath = manualCoverEditorSourcePath

    setIsSavingManualCover(true)
    try {
      const savedPath = await saveFrameFromVideoElement(video)
      const synced = replaceVideoTaskCoverById(tasks, targetTaskId, savedPath)
      if (!synced.changed) return
      commitPreviewTasks(synced.tasks)
      addLog(`[Super CMS] 已截取封面：${fileNameFromPath(normalizedManualEditorPath)} -> ${savedPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Super CMS] 截取手动封面失败：${message}`)
      window.alert(`截取封面失败：${message}`)
    } finally {
      setIsSavingManualCover(false)
    }
  }

  const handleClearManualCover = (): void => {
    const targetTaskId = manualCoverEditorTaskId.trim()
    if (!targetTaskId || isSavingManualCover) return
    const fallbackCoverPath = videoTaskFallbackCoverMap[targetTaskId] ?? ''
    const restored = restoreVideoTaskCoverById(tasks, targetTaskId, fallbackCoverPath)
    if (!restored.changed) return
    commitPreviewTasks(restored.tasks)
    addLog(`[Super CMS] 已恢复默认封面：${fileNameFromPath(normalizedManualEditorPath)}`)
  }

  const handleApplyBatchCoverFolder = async (): Promise<void> => {
    if (isGenerating || isPreparingVideoCover || isSavingManualCover) return
    if (videoPreviewTasks.length === 0) {
      window.alert('请先生成视频预览，再批量设置封面。')
      return
    }

    try {
      const selectedFolder = await window.electronAPI.openDirectory()
      if (!selectedFolder) return

      const sortedCoverPaths = sortCoverImagePathsByNaturalFilename(
        await window.electronAPI.scanDirectory(selectedFolder)
      )
      if (sortedCoverPaths.length === 0) {
        addLog(`[Super CMS] 批量设置封面失败：${selectedFolder} 中未找到可用图片。`)
        window.alert('所选文件夹中未找到可用图片。')
        return
      }

      const applied = applyBatchCoverPathsToVideoTasks(tasks, sortedCoverPaths)
      if (applied.changed) {
        commitPreviewTasks(applied.tasks)
      }

      const previewCount = videoPreviewTasks.length
      const keptFirstFrameCount = Math.max(previewCount - applied.appliedCount, 0)
      const ignoredCoverCount = Math.max(sortedCoverPaths.length - previewCount, 0)
      const progressParts = [`已覆盖 ${applied.appliedCount}/${previewCount} 条预览`]
      if (keptFirstFrameCount > 0) progressParts.push(`保留首帧 ${keptFirstFrameCount} 条`)
      if (ignoredCoverCount > 0) progressParts.push(`忽略多余图片 ${ignoredCoverCount} 张`)
      setVideoCoverProgress(`批量封面：${progressParts.join('，')}`)
      addLog(`[Super CMS] 已批量设置封面：${selectedFolder}，${progressParts.join('，')}。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Super CMS] 批量设置封面失败：${message}`)
      window.alert(`批量设置封面失败：${message}`)
    }
  }

  const handleToggleManualEditorPlayback = async (): Promise<void> => {
    const video = manualCoverEditorVideoRef.current
    if (!video || isManualCoverEditorPreparing) return
    try {
      if (video.paused || video.ended) {
        await video.play()
        setIsManualCoverEditorPlaying(true)
      } else {
        video.pause()
        setIsManualCoverEditorPlaying(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Super CMS] 视频播放失败：${message}`)
    }
  }

  const handleGenerate = async (): Promise<void> => {
    if (isGenerating || isPreparingVideoCover || isSavingManualCover) return
    setIsGenerating(true)
    try {
      const next = isVideoMode
        ? await (async () => {
            const videoTasks = generateVideoManifest(csvContent, importedVideoPaths)

            if (videoTasks.length === 0) return videoTasks

            setIsPreparingVideoCover(true)
            const coverMap = await prepareAutoCoverMap(importedVideoPaths)
            const successCount = coverMap.size
            setVideoCoverProgress(`默认首帧：已提取 ${successCount}/${importedVideoPaths.length} 条视频封面。`)
            if (successCount === 0) {
              addLog(
                '[Super CMS] 默认首帧封面提取失败，本次预览仍会生成，但任务将显示“未设置封面图”。'
              )
            }

            const nextFallbackMap: Record<string, string> = {}
            const nextTasks = videoTasks.map((task) => {
              const normalizedVideoPath = String(task.videoPath ?? '').trim()
              const coverPath = normalizedVideoPath ? (coverMap.get(normalizedVideoPath) ?? '') : ''
              const shouldUseImportedManualCover =
                Boolean(importedManualCoverPath) &&
                (importedVideoPaths.length === 1 || normalizedVideoPath === importedVideoPath)
              const videoCoverMode = shouldUseImportedManualCover ? ('manual' as const) : ('auto' as const)
              if (coverPath) nextFallbackMap[task.id] = coverPath
              return {
                ...task,
                assignedImages: shouldUseImportedManualCover
                  ? [importedManualCoverPath]
                  : coverPath
                    ? [coverPath]
                    : [],
                videoCoverMode
              }
            })
            setVideoTaskFallbackCoverMap(nextFallbackMap)
            setManualCoverEditorTaskId('')
            return nextTasks
          })()
        : generateManifest(csvContent, imageFiles, {
            ...constraints,
            bestEffort: true
          })
      if (!isVideoMode) {
        setVideoTaskFallbackCoverMap({})
        setManualCoverEditorTaskId('')
      }
      setTasks(next)
      setUploadTasks(buildUploadTasksFromPreviewTasks(next))
      addLog(`[Super CMS] 生成预览完成：共 ${next.length} 组。`)
    } catch (error) {
      addLog(`[Super CMS] 生成失败：${error instanceof Error ? error.message : String(error)}`)
      setTasks([])
      setUploadTasks([])
      setVideoTaskFallbackCoverMap({})
    } finally {
      setIsPreparingVideoCover(false)
      setIsGenerating(false)
    }
  }

  const handleReset = (): void => {
    if (!window.confirm('确定要清空当前所有输入和预览吗？')) return
    resetDataBuilderToInitial()
  }

  useEffect(() => {
    if (isVideoMode || isAiStudioImageImportMode) return
    const path = dataWorkshopFolderPath.trim()
    if (!path) {
      lastScannedPathRef.current = ''
      setImageFiles([])
      return
    }

    if (isScanning) return
    if (path === lastScannedPathRef.current) return

    const timer = window.setTimeout(() => {
      if (path === lastScannedPathRef.current) return
      lastScannedPathRef.current = path
      void handleScan(path)
    }, 200)

    return () => window.clearTimeout(timer)
  }, [dataWorkshopFolderPath, handleScan, isAiStudioImageImportMode, isScanning, isVideoMode])

  useEffect(() => {
    if (!isWorkshopActive) return
    let canceled = false
    const loadAccounts = async (): Promise<void> => {
      try {
        const list = await window.api.cms.account.list()
        if (canceled) return
        setAccounts(list)
        setSelectedAccountId((prev) => {
          return resolveWorkshopAccountId({
            accounts: list,
            currentAccountId: prev,
            preferredAccountId
          })
        })
      } catch (error) {
        if (canceled) return
        addLog(`[Super CMS] 拉取账号列表失败：${String(error)}`)
      }
    }
    void loadAccounts()
    return () => {
      canceled = true
    }
  }, [addLog, isWorkshopActive, preferredAccountId, workspacePath])

  useEffect(() => {
    if (!isWorkshopActive) return
    let canceled = false
    const loadProducts = async (): Promise<void> => {
      const accountId = selectedAccountId.trim()
      try {
        const list = await window.api.cms.product.list(accountId ? { accountId } : undefined)
        if (canceled) return
        setAllProducts(list)
      } catch (error) {
        if (canceled) return
        setAllProducts([])
        addLog(`[Super CMS] 拉取商品列表失败：${String(error)}`)
      }
    }
    void loadProducts()
    return () => {
      canceled = true
    }
  }, [addLog, isWorkshopActive, selectedAccountId, workspacePath])

  useEffect(() => {
    setSelectedProductIds([])
  }, [selectedAccountId])

  useEffect(() => {
    const normalizedAccountId = selectedAccountId.trim()
    if (!normalizedAccountId) return
    setPreferredAccountId(normalizedAccountId)
  }, [selectedAccountId, setPreferredAccountId])

  useEffect(() => {
    const availableIds = new Set(filteredProducts.map((product) => String(product.id ?? '').trim()).filter(Boolean))
    setSelectedProductIds((prev) => prev.filter((id) => availableIds.has(String(id ?? '').trim())))
  }, [filteredProducts])

  useEffect(() => {
    const handleProductsSynced = (event: Event): void => {
      const detail = (event as CustomEvent<{ accountId?: unknown; products?: unknown }>).detail
      const accountId = typeof detail?.accountId === 'string' ? detail.accountId.trim() : ''
      if (!accountId) return
      setPreferredAccountId(accountId)
      setSelectedAccountId(accountId)

      if (!isWorkshopActive) return

      if (accountId !== selectedAccountId.trim()) return
      const nextProducts = Array.isArray(detail?.products) ? detail.products : []
      setAllProducts(
        nextProducts.filter((product): product is CmsProductRecord => {
          return Boolean(product && typeof product === 'object')
        })
      )
    }

    window.addEventListener(CMS_PRODUCTS_SYNCED_EVENT, handleProductsSynced)
    return () => window.removeEventListener(CMS_PRODUCTS_SYNCED_EVENT, handleProductsSynced)
  }, [isWorkshopActive, selectedAccountId, setPreferredAccountId])

  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => setToastMessage(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  const resetDataBuilderToInitial = useCallback((): void => {
    setCsvContent('')
    setDataWorkshopFolderPath('')
    setWorkshopImport(null, null)
    setGroupCount('0')
    setMaxReuse('2')
    setMinImages('3')
    setMaxImages('5')
    setSelectedProductIds([])

    setTasks([])
    setUploadTasks([])
    setSelectedImageIds(new Set())
    setQueuedTaskIds(new Set())
    setDispatchProgress(null)
    setToastMessage('')
    lastScannedPathRef.current = ''
    lastAiStudioImportKeyRef.current = ''
    setImageFiles([])
    setVideoTaskFallbackCoverMap({})
    setVideoCoverProgress('')
    setIsPreparingVideoCover(false)
    setIsSavingManualCover(false)
    setIsManualCoverEditorPreparing(false)
    setIsManualCoverEditorPlaying(false)
    setManualCoverEditorTaskId('')
    setManualCoverEditorPlayablePath('')
    setManualCoverEditorTimeSec(0)
    setIsDispatchPanelCollapsed(false)
    videoCoverCacheRef.current.clear()
  }, [setCsvContent, setDataWorkshopFolderPath, setWorkshopImport, setTasks, setUploadTasks])

  const toggleSelected = (taskId: string): void => {
    if (queuedTaskIds.has(taskId)) return
    setSelectedImageIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const selectedDispatchCount = useMemo(() => {
    let count = 0
    for (const task of tasks) {
      if (queuedTaskIds.has(task.id)) continue
      if (selectedImageIds.has(task.id)) count += 1
    }
    return count
  }, [queuedTaskIds, selectedImageIds, tasks])
  const showDispatchPanel = useMemo(
    () =>
      shouldShowDispatchPanel({
        selectedDispatchCount,
        isManualCoverEditorOpen
      }),
    [isManualCoverEditorOpen, selectedDispatchCount]
  )

  useEffect(() => {
    if (selectedDispatchCount === 0) setIsDispatchPanelCollapsed(false)
  }, [selectedDispatchCount])

  const csvRowCount = useMemo(() => {
    return csvContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length
  }, [csvContent])

  const queuedTaskCount = useMemo(() => {
    let count = 0
    for (const task of tasks) {
      if (queuedTaskIds.has(task.id)) count += 1
    }
    return count
  }, [queuedTaskIds, tasks])

  const selectableTaskCount = useMemo(
    () => Math.max(tasks.length - queuedTaskCount, 0),
    [queuedTaskCount, tasks.length]
  )
  const sourceCount = isVideoMode ? importedVideoPaths.length : imageFiles.length
  const sourceLabel = isVideoMode ? '视频' : '图片'
  const isBuilderBusy = isGenerating || isPreparingVideoCover || isSavingManualCover

  const isAllPreviewSelected = useMemo(() => {
    const selectableTasks = tasks.filter((task) => !queuedTaskIds.has(task.id))
    if (selectableTasks.length === 0) return false
    return selectableTasks.every((task) => selectedImageIds.has(task.id))
  }, [queuedTaskIds, selectedImageIds, tasks])

  const toggleSelectAllPreview = (): void => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev)
      const selectableTasks = tasks.filter((task) => !queuedTaskIds.has(task.id))
      if (selectableTasks.length === 0) return next
      if (isAllPreviewSelected) {
        for (const task of selectableTasks) next.delete(task.id)
        return next
      }
      for (const task of selectableTasks) next.add(task.id)
      return next
    })
  }

  const dispatchSelected = async (): Promise<void> => {
    if (isDispatching) return
    const accountId = selectedAccountId.trim()
    if (!accountId) {
      window.alert('请先选择一个账号。')
      return
    }

    const primaryProduct = selectedProducts[0]
    const productId = primaryProduct?.id ?? ''
    const productName = primaryProduct?.name ?? ''

    const selectedTasks = tasks.filter(
      (t) => selectedImageIds.has(t.id) && !queuedTaskIds.has(t.id)
    )
    if (selectedTasks.length === 0) return

    const requestId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    setIsDispatching(true)
    setDispatchProgress({
      processed: 0,
      total: selectedTasks.length,
      created: 0,
      message: `开始派发（0/${selectedTasks.length}）`
    })

    let unbindProgress = (): void => {
      void 0
    }
    try {
      unbindProgress = window.api.cms.task.onCreateBatchProgress((payload) => {
        if (!payload) return
        if (payload.requestId !== requestId) return
        const processed = typeof payload.processed === 'number' ? payload.processed : 0
        const total = typeof payload.total === 'number' ? payload.total : selectedTasks.length
        const created = typeof payload.created === 'number' ? payload.created : 0
        const message =
          typeof payload.message === 'string'
            ? payload.message
            : `派发处理中（${processed}/${total}）`
        setDispatchProgress({ processed, total, created, message })
      })

      for (const task of selectedTasks) {
        console.log('Dispatch Body:', task.body, 'Newlines:', task.body.match(/\n/g)?.length)
      }
      const created = await window.api.cms.task.createBatch(
        selectedTasks.map((task) => ({
          accountId,
          images: task.assignedImages,
          title: task.title,
          content: task.body,
          productId: productId ? productId : undefined,
          productName: productName ? productName : undefined,
          linkedProducts: selectedProducts.length > 0 ? selectedProducts : undefined,
          mediaType: task.mediaType,
          videoPath: task.videoPath,
          videoPreviewPath: task.videoPreviewPath,
          videoCoverMode: task.videoCoverMode
        })),
        { requestId }
      )
      addLog(`[Super CMS] 已派发 ${created.length} 条任务到账号队列。`)
      const dispatchedTaskIdSet = new Set(selectedTasks.map((task) => task.id))
      const nextQueuedTaskIds = new Set(queuedTaskIds)
      for (const taskId of dispatchedTaskIdSet) nextQueuedTaskIds.add(taskId)
      const allTasksQueued =
        tasks.length > 0 && tasks.every((task) => nextQueuedTaskIds.has(task.id))

      if (allTasksQueued) {
        resetDataBuilderToInitial()
        return
      }

      setQueuedTaskIds(nextQueuedTaskIds)
      setSelectedImageIds((prev) => {
        const next = new Set(prev)
        for (const taskId of dispatchedTaskIdSet) next.delete(taskId)
        return next
      })
      const remainingCount = tasks.reduce((count, task) => {
        if (nextQueuedTaskIds.has(task.id)) return count
        return count + 1
      }, 0)
      setToastMessage(`已派发 ${created.length} 条任务，剩余 ${remainingCount} 条待派发。`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setDispatchProgress((prev) => ({
        processed: prev?.processed ?? 0,
        total: prev?.total ?? selectedTasks.length,
        created: prev?.created ?? 0,
        message: `派发失败：${message}`
      }))
      window.alert(`派发失败：${message}`)
    } finally {
      unbindProgress()
      setIsDispatching(false)
      window.setTimeout(() => {
        setDispatchProgress((prev) => {
          if (!prev) return prev
          if (prev.message.startsWith('派发失败')) return prev
          return null
        })
      }, 1800)
    }
  }

  const toggleSelectedProduct = (productId: string): void => {
    const normalizedProductId = String(productId ?? '').trim()
    if (!normalizedProductId) return
    setSelectedProductIds((prev) => {
      if (prev.includes(normalizedProductId)) {
        return prev.filter((id) => id !== normalizedProductId)
      }
      return [...prev, normalizedProductId]
    })
  }

  const clearSelectedProducts = (): void => {
    setSelectedProductIds([])
  }

  return (
    <div ref={containerRef} className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 pb-28">
      <Card className="overflow-hidden border-zinc-800/80 bg-zinc-950/85 shadow-[0_20px_80px_-45px_rgba(245,158,11,0.32)]">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-200">
                  <Sparkles className="h-3.5 w-3.5" />
                  {isVideoMode ? '视频' : '图片'}
                </div>
                <div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-zinc-700/80 bg-black/25 px-3 py-1 text-[11px] text-zinc-300">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span className="truncate">{workspacePath || '未设置'}</span>
                </div>
              </div>
              <CardTitle className="text-[22px] font-semibold tracking-[0.02em] text-zinc-50">
                结果预览
              </CardTitle>
            </div>

            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[420px]">
              <WorkshopMetricCard
                icon={isVideoMode ? <Film className="h-4 w-4" /> : <Images className="h-4 w-4" />}
                label={sourceLabel}
                value={`${sourceCount}`}
                tone="amber"
              />
              <WorkshopMetricCard
                icon={<ListChecks className="h-4 w-4" />}
                label="CSV"
                value={`${csvRowCount}`}
                tone="sky"
              />
              <WorkshopMetricCard
                icon={<Sparkles className="h-4 w-4" />}
                label="预览"
                value={`${tasks.length}`}
                tone="rose"
              />
              <WorkshopMetricCard
                icon={<Send className="h-4 w-4" />}
                label="待派发"
                value={`${selectableTaskCount}`}
                tone="emerald"
              />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[24px] border border-zinc-800/80 bg-black/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm text-zinc-100">CSV</div>
                <div className="rounded-full border border-zinc-700/80 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-300">
                  {csvRowCount}
                </div>
              </div>
              <textarea
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                rows={10}
                className="min-h-[220px] w-full resize-y rounded-[20px] border border-zinc-800/80 bg-zinc-950/80 px-4 py-3 text-sm leading-6 text-zinc-50 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
              />
            </div>

            <div className="flex flex-col gap-3">
              <div className="rounded-[24px] border border-zinc-800/80 bg-black/20 p-4">
                {isVideoMode ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-zinc-100">视频封面管理</div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 rounded-full border-zinc-700 px-3 text-xs"
                        onClick={() => void handleApplyBatchCoverFolder()}
                        disabled={isBuilderBusy || videoPreviewTasks.length === 0}
                      >
                        批量设置封面
                      </Button>
                    </div>
                    <div className="rounded-[20px] border border-zinc-800/80 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100">
                      {fileNameFromPath(importedVideoPath)}
                      {importedVideoPaths.length > 1 ? ` 等 ${importedVideoPaths.length}` : ''}
                    </div>
                    <div className="rounded-[20px] border border-zinc-800/80 bg-black/10 px-4 py-3 text-xs leading-6 text-zinc-400">
                      生成预览时会默认批量提取首帧作为封面。预览生成后，你可以逐条修改，也可以从文件夹按文件名自然排序批量覆盖。
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-[20px] border border-zinc-800/80 bg-black/20 p-2">
                      {videoPreviewTasks.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 px-3 py-6 text-center text-xs text-zinc-500">
                          先点击“生成预览”，这里会直接显示每条预览的当前封面列表。
                        </div>
                      ) : (
                        videoPreviewTasks.map((task, index) => {
                          const currentCoverPath = String(task.assignedImages?.[0] ?? '').trim()
                          const fallbackCoverPath = videoTaskFallbackCoverMap[task.id] ?? ''
                          const isManualCoverMode = task.videoCoverMode === 'manual'
                          const preview = resolveVideoCoverPreview({
                            manualCoverPath: currentCoverPath,
                            fallbackCoverPath
                          })
                          const previewSrc = preview.path
                            ? resolveLocalImage(preview.path, workspacePath)
                            : ''
                          return (
                            <div
                              key={task.id}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 px-3 py-2.5"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                                  {previewSrc ? (
                                    <img
                                      src={previewSrc}
                                      alt=""
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
                                      暂无封面
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs text-zinc-200">
                                    {index + 1}. {fileNameFromPath(String(task.videoPath ?? ''))}
                                  </div>
                                  <div className="mt-1 text-[11px] text-zinc-500">
                                    {isManualCoverMode
                                      ? '当前为手动封面'
                                      : preview.source === 'manual'
                                        ? '当前封面'
                                        : preview.source === 'first-frame'
                                          ? '当前使用默认首帧'
                                          : '当前暂无封面图'}
                                  </div>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-8 rounded-full border-zinc-700 px-3 text-xs"
                                onClick={() => openManualCoverEditor(task.id)}
                                disabled={isBuilderBusy}
                              >
                                {preview.path ? '修改' : '设置'}
                              </Button>
                            </div>
                          )
                        })
                      )}
                    </div>

                    {videoCoverProgress ? (
                      <div className="text-xs text-zinc-500">{videoCoverProgress}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="text-sm text-zinc-100">图片素材</div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={isAiStudioImageImportMode ? importedImageFolderPath || dataWorkshopFolderPath : dataWorkshopFolderPath}
                        onChange={(e) => setDataWorkshopFolderPath(e.target.value)}
                        placeholder="图片文件夹"
                        className="h-10 rounded-2xl bg-zinc-950/80"
                        readOnly={isAiStudioImageImportMode}
                      />
                      <div className="flex gap-2 sm:shrink-0">
                        <Button
                          onClick={handleBrowse}
                          disabled={isScanning || isAiStudioImageImportMode}
                          className="h-10 rounded-2xl px-4"
                        >
                          浏览
                        </Button>
                        <Button
                          onClick={() => void handleScan()}
                          disabled={isScanning || isAiStudioImageImportMode || !dataWorkshopFolderPath.trim()}
                          className="h-10 rounded-2xl px-4"
                        >
                          {isScanning ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ScanSearch className="h-4 w-4" />
                          )}
                          扫描
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-zinc-400">分组</div>
                        <Input
                          type="number"
                          value={groupCount}
                          onChange={(e) => setGroupCount(e.target.value)}
                          min={0}
                          className="h-10 rounded-2xl bg-black/20"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-zinc-400">复用</div>
                        <Input
                          type="number"
                          value={maxReuse}
                          onChange={(e) => setMaxReuse(e.target.value)}
                          min={1}
                          className="h-10 rounded-2xl bg-black/20"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-zinc-400">最少</div>
                        <Input
                          type="number"
                          value={minImages}
                          onChange={(e) => setMinImages(e.target.value)}
                          min={0}
                          className="h-10 rounded-2xl bg-black/20"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-zinc-400">最多</div>
                        <Input
                          type="number"
                          value={maxImages}
                          onChange={(e) => setMaxImages(e.target.value)}
                          min={0}
                          className="h-10 rounded-2xl bg-black/20"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => void handleGenerate()}
                  disabled={isBuilderBusy}
                  className="h-11 rounded-2xl bg-zinc-50 text-zinc-950 hover:bg-amber-100"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {isGenerating ? '生成中' : '生成'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  disabled={isScanning || isBuilderBusy}
                  className="h-11 rounded-2xl border-zinc-700 bg-transparent"
                >
                  <RotateCcw className="h-4 w-4" />
                  重置
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-zinc-800/80 bg-zinc-950/85 shadow-[0_20px_80px_-55px_rgba(56,189,248,0.22)]">
        <CardHeader className="gap-3 border-b border-zinc-800/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.3),rgba(9,9,11,0))] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-lg font-semibold tracking-[0.02em] text-zinc-50">
              任务清单
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1">
                {tasks.length}
              </div>
              <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1">
                {selectableTaskCount}
              </div>
              <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1">
                {queuedTaskCount}
              </div>
              {tasks.length > 0 ? (
                <label className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-zinc-200">
                  <input
                    type="checkbox"
                    checked={isAllPreviewSelected}
                    onChange={toggleSelectAllPreview}
                    className="h-4 w-4"
                  />
                  全选
                </label>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">暂无任务</div>
          ) : (
            <Virtuoso
              key={scrollParent ? 'scroll-parent' : 'window-scroll'}
              customScrollParent={scrollParent}
              useWindowScroll={!scrollParent}
              data={tasks}
              defaultItemHeight={260}
              overscan={{ main: 500, reverse: 500 }}
              computeItemKey={(_, task) => task.id}
              itemContent={(index, task) => {
                const isSelected = selectedImageIds.has(task.id)
                const isQueued = queuedTaskIds.has(task.id)
                const isSelectable = !isQueued

                return (
                  <div className="overflow-x-auto px-4 pb-3 pt-3">
                    <div
                      className="relative"
                      onClick={() => {
                        if (!isSelectable) return
                        toggleSelected(task.id)
                      }}
                      onKeyDown={(e) => {
                        if (!isSelectable) return
                        if (e.key === 'Enter' || e.key === ' ') toggleSelected(task.id)
                      }}
                      role={isSelectable ? 'button' : undefined}
                      tabIndex={isSelectable ? 0 : -1}
                    >
                      {isQueued ? (
                        <div className="absolute right-4 top-4 z-10 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
                          队列中
                        </div>
                      ) : null}

                      <TaskCard
                        index={index}
                        taskId={task.id}
                        title={task.title}
                        body={task.body}
                        images={task.assignedImages}
                        mediaType={task.mediaType}
                        videoPath={task.videoPath}
                        note={task.log}
                        onVideoCoverDoubleClick={
                          task.mediaType === 'video' &&
                          typeof task.videoPath === 'string' &&
                          task.videoPath.trim() &&
                          !isQueued
                            ? () => openManualCoverEditor(task.id)
                            : undefined
                        }
                        select={{
                          checked: isSelected,
                          disabled: !isSelectable,
                          ariaLabel: `${isSelected ? '取消选择' : '选择'}：${task.title || `第${index + 1}组`}`,
                          onChange: (checked) => {
                            if (!isSelectable) return
                            if (checked !== isSelected) toggleSelected(task.id)
                          }
                        }}
                        className={
                          isQueued
                            ? 'border-emerald-400/35 bg-emerald-400/5 ring-1 ring-inset ring-emerald-400/10 transition-colors'
                            : isSelected
                              ? 'border-amber-300/35 bg-amber-400/5 ring-1 ring-inset ring-amber-300/10 transition-colors'
                              : 'hover:border-zinc-700/80 hover:bg-white/[0.02] transition-colors'
                        }
                      />
                    </div>
                  </div>
                )
              }}
            />
          )}
        </CardContent>
      </Card>
      {isManualCoverEditorOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeManualCoverEditor()
          }}
        >
          <div className="w-full max-w-4xl rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-zinc-200">视频封面编辑</div>
                <div className="mt-1 truncate text-xs text-zinc-500">
                  {normalizedManualEditorPath || '未找到预览视频'}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={closeManualCoverEditor}
                disabled={isSavingManualCover}
              >
                关闭
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                {isManualCoverEditorPreparing ? (
                  <div className="flex h-[300px] w-full items-center justify-center rounded bg-black/40 text-sm text-zinc-400 lg:h-[360px]">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      视频预处理中...
                    </span>
                  </div>
                ) : (
                  <video
                    key={manualCoverEditorSourcePath}
                    ref={manualCoverEditorVideoRef}
                    src={
                      manualCoverEditorSourcePath
                        ? fileUrlFromPath(manualCoverEditorSourcePath)
                        : ''
                    }
                    controls
                    preload="metadata"
                    className="h-[300px] w-full rounded bg-black object-contain lg:h-[360px]"
                    onLoadedMetadata={(event) => {
                      const current = Number(event.currentTarget.currentTime)
                      setManualCoverEditorTimeSec(Number.isFinite(current) ? current : 0)
                    }}
                    onPlay={() => setIsManualCoverEditorPlaying(true)}
                    onPause={() => setIsManualCoverEditorPlaying(false)}
                    onEnded={() => setIsManualCoverEditorPlaying(false)}
                    onTimeUpdate={(event) => {
                      const current = Number(event.currentTarget.currentTime)
                      setManualCoverEditorTimeSec(Number.isFinite(current) ? current : 0)
                    }}
                  />
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleToggleManualEditorPlayback()}
                    disabled={
                      isSavingManualCover ||
                      isManualCoverEditorPreparing ||
                      !manualCoverEditorSourcePath
                    }
                  >
                    {isManualCoverEditorPlaying ? '暂停' : '播放'}
                  </Button>
                  <div className="text-xs text-zinc-500">
                    当前帧时间：{formatTimeLabel(manualCoverEditorTimeSec)}
                    （拖动进度条后点击“截取当前帧”）
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-xs text-zinc-400">
                  当前视频：{fileNameFromPath(normalizedManualEditorPath)}
                </div>
                <div className="text-[11px] text-zinc-500">
                  当前预览：{activeManualCoverTask ? activeManualCoverTask.title || activeManualCoverTask.id : '未找到'}
                </div>
                <div className="text-[11px] text-zinc-500 break-all">
                  预览源：{manualCoverEditorSourcePath || '准备中...'}
                </div>
                <div className="rounded-xl border border-zinc-800 bg-black/20 p-2.5">
                  <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    {activeManualCoverPreview.source === 'manual'
                      ? '当前封面'
                      : activeManualCoverPreview.source === 'first-frame'
                        ? '首帧预览'
                        : '封面预览'}
                  </div>
                  <div className="mt-2 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                    {activeManualCoverPreviewSrc ? (
                      <img
                        src={activeManualCoverPreviewSrc}
                        alt=""
                        loading="lazy"
                        className="h-36 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center text-xs text-zinc-500">
                        首帧预览准备中...
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 break-all">
                    {activeManualCoverPreview.path
                      ? fileNameFromPath(activeManualCoverPreview.path)
                      : '当前暂无封面图'}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => void handleCaptureManualCover()}
                  disabled={
                    isSavingManualCover ||
                    isManualCoverEditorPreparing ||
                    !manualCoverEditorSourcePath
                  }
                >
                  {isSavingManualCover ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      保存中...
                    </span>
                  ) : (
                    '截取当前帧'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleUploadManualCover()}
                  disabled={
                    isSavingManualCover ||
                    isManualCoverEditorPreparing ||
                    !normalizedManualEditorPath
                  }
                >
                  手动上传图片
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearManualCover}
                  disabled={
                    isSavingManualCover ||
                    !activeManualCoverPath ||
                    activeManualCoverPath === fallbackManualCoverPath
                  }
                >
                  恢复默认首帧
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="fixed bottom-[92px] left-1/2 z-50 -translate-x-1/2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 shadow-lg">
          {toastMessage}
        </div>
      ) : null}

      {showDispatchPanel ? (
        <div
          className={cn(
            'fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[24px] border border-zinc-800 bg-zinc-950/96 shadow-[0_28px_120px_-52px_rgba(0,0,0,0.78)] backdrop-blur',
            isDispatchPanelCollapsed
              ? 'w-[min(760px,calc(100vw-24px))] p-3.5'
              : 'w-[min(900px,calc(100vw-24px))] p-4'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-zinc-300">
              <div className="rounded-full border border-zinc-800 bg-black/25 px-3 py-1.5 text-zinc-100">
                已选 {selectedDispatchCount} 条
              </div>
              <div className="rounded-full border border-zinc-800 bg-black/25 px-3 py-1.5">
                商品 {selectedProductCount}
              </div>
              <div className="max-w-[280px] truncate rounded-full border border-zinc-800 bg-black/25 px-3 py-1.5 text-zinc-400">
                账号：{accounts.find((account) => account.id === selectedAccountId)?.name || '未选择'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isDispatchPanelCollapsed ? (
                <Button
                  onClick={() => void dispatchSelected()}
                  disabled={isDispatching || !selectedAccountId.trim()}
                  className="h-10 rounded-xl px-4"
                >
                  {isDispatching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {isDispatching
                    ? `派发中 ${Math.min(dispatchProgress?.processed ?? 0, dispatchProgress?.total ?? 0)}/${dispatchProgress?.total ?? 0}`
                    : '直接派发'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl border-zinc-700 px-3"
                onClick={() => setIsDispatchPanelCollapsed((prev) => !prev)}
              >
                {isDispatchPanelCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {isDispatchPanelCollapsed ? '展开看板' : '收起看板'}
              </Button>
            </div>
          </div>

          {isDispatchPanelCollapsed ? (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-zinc-800 bg-black/25 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">派发账号</div>
                  <div className="mt-1 truncate text-sm text-zinc-100">
                    {accounts.find((account) => account.id === selectedAccountId)?.name || '请选择账号'}
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-black/25 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">挂车商品</div>
                  <div className="mt-1 text-sm text-zinc-100">
                    已选 {selectedProductCount} 个商品
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-black/25 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">派发状态</div>
                  <div className="mt-1 truncate text-sm text-zinc-100">
                    {dispatchProgress?.message || '待派发'}
                  </div>
                </div>
              </div>
              {dispatchProgress ? (
                <div className="mt-3 px-1 text-xs text-zinc-400">{dispatchProgress.message}</div>
              ) : null}
            </>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-zinc-800 bg-black/25 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">派发账号</div>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    disabled={isDispatching}
                    className="mt-3 h-10 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  >
                    {accounts.length === 0 ? <option value="">暂无账号</option> : null}
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black/25 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">本次派发</div>
                  <div className="mt-2 flex items-end gap-2">
                    <span className="text-2xl font-semibold tracking-tight text-zinc-50">{selectedDispatchCount}</span>
                    <span className="pb-0.5 text-sm text-zinc-400">项任务</span>
                  </div>
                  <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-300">
                    已选 {selectedProductCount} 个商品
                  </div>
                  <Button
                    onClick={() => void dispatchSelected()}
                    disabled={isDispatching || !selectedAccountId.trim()}
                    className="mt-3 h-10 w-full rounded-xl"
                  >
                    {isDispatching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {isDispatching
                      ? `派发中 ${Math.min(dispatchProgress?.processed ?? 0, dispatchProgress?.total ?? 0)}/${dispatchProgress?.total ?? 0}`
                      : '派发至队列'}
                  </Button>
                </div>
              </div>

              <CmsProductMultiSelectPanel
                title="挂车商品"
                subtitle={
                  selectedProductCount > 0
                    ? `已选 ${selectedProductCount} 个商品`
                    : '从右侧列表勾选需要挂车的商品'
                }
                products={filteredProducts}
                selectedProductIds={selectedProductIds}
                selectedProducts={selectedProducts}
                workspacePath={workspacePath}
                emptyStateMessage="当前账号暂无已同步商品，先去媒体矩阵执行一次“同步商品”。"
                onToggleProduct={toggleSelectedProduct}
                onClearSelected={clearSelectedProducts}
                variant="compact"
                className="min-w-0"
                scrollClassName="max-h-[220px]"
              />

              {dispatchProgress ? (
                <div className="lg:col-span-2 px-1 text-xs text-zinc-400">{dispatchProgress.message}</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

export { DataBuilder }
