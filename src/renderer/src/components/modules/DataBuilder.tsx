import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Virtuoso } from 'react-virtuoso'

import { Loader2, RotateCcw } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { TaskCard } from '@renderer/components/ui/TaskCard'
import { generateManifest, generateVideoManifest } from '@renderer/lib/cms-engine'
import { useCmsStore } from '@renderer/store/useCmsStore'

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
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set())
  const [queuedTaskIds, setQueuedTaskIds] = useState<Set<string>>(() => new Set())
  const [toastMessage, setToastMessage] = useState<string>('')
  const [videoCoverMode, setVideoCoverMode] = useState<'auto-first-frame' | 'manual'>('auto-first-frame')
  const [manualCoverMap, setManualCoverMap] = useState<Record<string, string>>({})
  const [isPreparingVideoCover, setIsPreparingVideoCover] = useState(false)
  const [isSavingManualCover, setIsSavingManualCover] = useState(false)
  const [videoCoverProgress, setVideoCoverProgress] = useState('')
  const [manualCoverEditorVideoPath, setManualCoverEditorVideoPath] = useState('')
  const [manualCoverEditorPlayablePath, setManualCoverEditorPlayablePath] = useState('')
  const [isManualCoverEditorPreparing, setIsManualCoverEditorPreparing] = useState(false)
  const [isManualCoverEditorPlaying, setIsManualCoverEditorPlaying] = useState(false)
  const [manualCoverEditorTimeSec, setManualCoverEditorTimeSec] = useState(0)
  const manualCoverEditorVideoRef = useRef<HTMLVideoElement | null>(null)
  const lastScannedPathRef = useRef('')
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
  const workspacePath = useCmsStore((s) => s.workspacePath)

  const importedVideoPaths = useMemo(() => {
    if (workshopImport?.type !== 'video') return []
    const fromPaths = Array.isArray(workshopImport.paths)
      ? workshopImport.paths.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    if (fromPaths.length > 0) return fromPaths
    const single = String(workshopImport.path ?? '').trim()
    return single ? [single] : []
  }, [workshopImport])

  const importedVideoPath = useMemo(() => importedVideoPaths[0] ?? '', [importedVideoPaths])

  const importedCoverPath = useMemo(() => {
    if (workshopImport?.type !== 'video') return ''
    return String(workshopImport.coverPath ?? '').trim()
  }, [workshopImport])

  const isVideoMode = importedVideoPaths.length > 0
  const isManualCoverEditorOpen = Boolean(manualCoverEditorVideoPath.trim())
  const normalizedManualEditorPath = manualCoverEditorVideoPath.trim()
  const normalizedManualEditorPlayablePath = manualCoverEditorPlayablePath.trim()
  const manualCoverEditorSourcePath = normalizedManualEditorPlayablePath || normalizedManualEditorPath
  const activeManualCoverPath = normalizedManualEditorPath ? manualCoverMap[normalizedManualEditorPath] ?? '' : ''
  const manualCoverConfiguredCount = useMemo(() => {
    let count = 0
    for (const path of importedVideoPaths) {
      const normalizedPath = path.trim()
      if (normalizedPath && manualCoverMap[normalizedPath]) count += 1
    }
    return count
  }, [importedVideoPaths, manualCoverMap])

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
    if (!isVideoMode) {
      setVideoCoverMode('auto-first-frame')
      setManualCoverMap({})
      setVideoCoverProgress('')
      setIsSavingManualCover(false)
      setIsManualCoverEditorPreparing(false)
      setIsManualCoverEditorPlaying(false)
      setManualCoverEditorVideoPath('')
      setManualCoverEditorPlayablePath('')
      setManualCoverEditorTimeSec(0)
      videoCoverCacheRef.current.clear()
      return
    }

    const currentVideoPathSet = new Set(importedVideoPaths.map((path) => path.trim()).filter(Boolean))
    const cache = videoCoverCacheRef.current
    for (const key of cache.keys()) {
      if (!currentVideoPathSet.has(key)) cache.delete(key)
    }

    setManualCoverMap((prev) => {
      const next: Record<string, string> = {}
      for (const path of currentVideoPathSet) {
        const saved = prev[path]
        if (typeof saved === 'string' && saved.trim()) next[path] = saved
      }
      if (importedCoverPath) {
        const firstVideoPath = importedVideoPaths[0]?.trim()
        if (firstVideoPath && !next[firstVideoPath]) next[firstVideoPath] = importedCoverPath
      }
      return next
    })

    if (importedCoverPath) {
      setVideoCoverMode('manual')
      setVideoCoverProgress('检测到导入封面，已切换为手动封面模式。')
    }
  }, [importedCoverPath, importedVideoPaths, isVideoMode])

  useEffect(() => {
    const normalizedEditorPath = manualCoverEditorVideoPath.trim()
    if (!normalizedEditorPath) {
      setIsManualCoverEditorPreparing(false)
      setIsManualCoverEditorPlaying(false)
      setManualCoverEditorPlayablePath('')
      return
    }
    if (importedVideoPaths.some((path) => path.trim() === normalizedEditorPath)) return
    setManualCoverEditorVideoPath('')
    setManualCoverEditorPlayablePath('')
    setManualCoverEditorTimeSec(0)
    setIsManualCoverEditorPlaying(false)
  }, [importedVideoPaths, manualCoverEditorVideoPath])

  useEffect(() => {
    const normalizedEditorPath = manualCoverEditorVideoPath.trim()
    if (!normalizedEditorPath) return

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
  }, [addLog, manualCoverEditorVideoPath])

  const prepareAutoCoverMap = useCallback(async (videoPaths: string[]): Promise<Map<string, string>> => {
    const uniquePaths = Array.from(new Set(videoPaths.map((item) => String(item ?? '').trim()).filter(Boolean)))
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
  }, [addLog])

  const handleScan = useCallback(async (nextPath?: string): Promise<void> => {
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
  }, [addLog, dataWorkshopFolderPath, isVideoMode])

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

  const openManualCoverEditor = (videoPath: string): void => {
    const normalizedPath = String(videoPath ?? '').trim()
    if (!normalizedPath) return
    if (isGenerating || isPreparingVideoCover || isSavingManualCover) return
    setIsManualCoverEditorPlaying(false)
    setManualCoverEditorVideoPath(normalizedPath)
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
    setManualCoverEditorVideoPath('')
    setManualCoverEditorPlayablePath('')
    setManualCoverEditorTimeSec(0)
  }

  const setManualCoverForVideo = useCallback((videoPath: string, coverPath: string): void => {
    const normalizedVideoPath = String(videoPath ?? '').trim()
    const normalizedCoverPath = String(coverPath ?? '').trim()
    if (!normalizedVideoPath) return

    let configuredCount = 0
    setManualCoverMap((prev) => {
      const next: Record<string, string> = { ...prev }
      if (normalizedCoverPath) next[normalizedVideoPath] = normalizedCoverPath
      else delete next[normalizedVideoPath]

      configuredCount = 0
      for (const path of importedVideoPaths) {
        const normalizedPath = path.trim()
        if (normalizedPath && next[normalizedPath]) configuredCount += 1
      }
      return next
    })

    setVideoCoverProgress(`手动模式：已设置 ${configuredCount}/${importedVideoPaths.length} 条视频封面。`)
  }, [importedVideoPaths])

  const handleUploadManualCover = async (): Promise<void> => {
    const targetVideoPath = manualCoverEditorVideoPath.trim()
    if (!targetVideoPath || isSavingManualCover || isGenerating || isPreparingVideoCover) return
    try {
      const result = await window.electronAPI.openMediaFiles({ accept: 'image' })
      const selectedPath = extractOriginalPathFromMediaResult(result)
      if (!selectedPath) return
      if (!isImageFile(selectedPath)) {
        window.alert('请选择图片文件作为封面。')
        return
      }
      setManualCoverForVideo(targetVideoPath, selectedPath)
      setVideoCoverMode('manual')
      addLog(`[Super CMS] 已设置手动封面：${fileNameFromPath(targetVideoPath)} -> ${selectedPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Super CMS] 上传手动封面失败：${message}`)
      window.alert(`上传手动封面失败：${message}`)
    }
  }

  const handleCaptureManualCover = async (): Promise<void> => {
    const targetVideoPath = manualCoverEditorVideoPath.trim()
    if (!targetVideoPath || isSavingManualCover || isGenerating || isPreparingVideoCover) return
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
      setManualCoverForVideo(targetVideoPath, savedPath)
      setVideoCoverMode('manual')
      addLog(`[Super CMS] 已截取封面：${fileNameFromPath(targetVideoPath)} -> ${savedPath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Super CMS] 截取手动封面失败：${message}`)
      window.alert(`截取封面失败：${message}`)
    } finally {
      setIsSavingManualCover(false)
    }
  }

  const handleClearManualCover = (): void => {
    const targetVideoPath = manualCoverEditorVideoPath.trim()
    if (!targetVideoPath || isSavingManualCover) return
    setManualCoverForVideo(targetVideoPath, '')
    addLog(`[Super CMS] 已清除手动封面：${fileNameFromPath(targetVideoPath)}`)
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

            if (videoCoverMode === 'manual') {
              if (manualCoverConfiguredCount === 0) {
                addLog('[Super CMS] 手动封面模式未设置封面图，本次预览将显示“未设置封面图”。')
              }
              setVideoCoverProgress(`手动模式：已设置 ${manualCoverConfiguredCount}/${importedVideoPaths.length} 条视频封面。`)
              return videoTasks.map((task) => ({
                ...task,
                assignedImages: (() => {
                  const normalizedVideoPath = String(task.videoPath ?? '').trim()
                  const mappedCoverPath = normalizedVideoPath ? manualCoverMap[normalizedVideoPath] ?? '' : ''
                  return mappedCoverPath ? [mappedCoverPath] : []
                })()
              }))
            }

            setIsPreparingVideoCover(true)
            const coverMap = await prepareAutoCoverMap(importedVideoPaths)
            const successCount = coverMap.size
            setVideoCoverProgress(`自动首帧模式：已提取 ${successCount}/${importedVideoPaths.length} 条视频封面。`)
            if (successCount === 0) {
              addLog('[Super CMS] 自动首帧封面提取失败，本次预览仍会生成，但任务将显示“未设置封面图”。')
            }

            return videoTasks.map((task) => {
              const normalizedVideoPath = String(task.videoPath ?? '').trim()
              const coverPath = normalizedVideoPath ? coverMap.get(normalizedVideoPath) ?? '' : ''
              return {
                ...task,
                assignedImages: coverPath ? [coverPath] : []
              }
            })
          })()
        : generateManifest(csvContent, imageFiles, {
            ...constraints,
            bestEffort: true
          })
      setTasks(next)
      setUploadTasks(
        next.map((task) => ({ title: task.title, body: task.body, images: task.mediaType === 'video' ? [] : task.assignedImages }))
      )
      addLog(`[Super CMS] 生成预览完成：共 ${next.length} 组。`)
    } catch (error) {
      addLog(`[Super CMS] 生成失败：${error instanceof Error ? error.message : String(error)}`)
      setTasks([])
      setUploadTasks([])
    } finally {
      setIsPreparingVideoCover(false)
      setIsGenerating(false)
    }
  }

  const handleReset = (): void => {
    if (!window.confirm('确定要清空当前所有输入和预览吗？')) return

    setCsvContent('')
    setDataWorkshopFolderPath('')
    setGroupCount('0')
    setMaxReuse('2')
    setMinImages('3')
    setMaxImages('5')

    setTasks([])
    setUploadTasks([])
    setSelectedImageIds(new Set())
    setQueuedTaskIds(new Set())
    setDispatchProgress(null)
    setToastMessage('')
    lastScannedPathRef.current = ''
    setImageFiles([])
    setVideoCoverProgress('')
    setIsSavingManualCover(false)
    setIsManualCoverEditorPreparing(false)
    setIsManualCoverEditorPlaying(false)
    setManualCoverEditorVideoPath('')
    setManualCoverEditorPlayablePath('')
    setManualCoverEditorTimeSec(0)
  }


  useEffect(() => {
    if (isVideoMode) return
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
  }, [dataWorkshopFolderPath, handleScan, isScanning, isVideoMode])

  useEffect(() => {
    let canceled = false
    const loadAccounts = async (): Promise<void> => {
      try {
        const list = await window.api.cms.account.list()
        if (canceled) return
        setAccounts(list)
        setSelectedAccountId((prev) => prev || list[0]?.id || '')
      } catch (error) {
        addLog(`[Super CMS] 拉取账号列表失败：${String(error)}`)
      }
    }
    void loadAccounts()
    return () => {
      canceled = true
    }
  }, [addLog])

  useEffect(() => {
    let canceled = false
    const loadProducts = async (): Promise<void> => {
      try {
        const list = await window.api.cms.product.list()
        if (canceled) return
        setAllProducts(list)
      } catch (error) {
        addLog(`[Super CMS] 拉取商品列表失败：${String(error)}`)
      }
    }
    void loadProducts()
    return () => {
      canceled = true
    }
  }, [addLog])

  useEffect(() => {
    setSelectedProductId('')
  }, [selectedAccountId])

  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => setToastMessage(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  const toggleSelected = (taskId: string): void => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  const isAllPreviewSelected = useMemo(() => {
    if (tasks.length === 0) return false
    return tasks.every((task) => selectedImageIds.has(task.id))
  }, [selectedImageIds, tasks])

  const toggleSelectAllPreview = (): void => {
    setSelectedImageIds((prev) => {
      const next = new Set(prev)
      if (tasks.length === 0) return next
      if (isAllPreviewSelected) {
        for (const task of tasks) next.delete(task.id)
        return next
      }
      for (const task of tasks) next.add(task.id)
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

    const productId = selectedProductId.trim()
    const productName = productId ? allProducts.find((p) => p.id === productId)?.name ?? '' : ''

    const selectedTasks = tasks.filter((t) => selectedImageIds.has(t.id))
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
        const message = typeof payload.message === 'string' ? payload.message : `派发处理中（${processed}/${total}）`
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
          mediaType: task.mediaType,
          videoPath: task.videoPath,
          videoPreviewPath: task.videoPreviewPath
        })),
        { requestId }
      )
      setQueuedTaskIds((prev) => {
        const next = new Set(prev)
        for (const task of selectedTasks) next.add(task.id)
        return next
      })
      setSelectedImageIds(new Set())
      setDispatchProgress({
        processed: selectedTasks.length,
        total: selectedTasks.length,
        created: created.length,
        message: `派发完成：${created.length} 条任务`
      })
      setToastMessage('已加入队列')
      addLog(`[Super CMS] 已派发 ${created.length} 条任务到账号队列。`)
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

  return (
    <div ref={containerRef} className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-28">
      <Card>
        <CardHeader>
          <CardTitle>数据工坊</CardTitle>
          <CardDescription>
            {isVideoMode ? '导入视频素材，输入 CSV，生成视频任务预览。' : '扫描图片文件夹，输入 CSV，生成任务清单预览。'}
          </CardDescription>
          <div className="text-xs text-zinc-400 break-all">📂 当前存储位置：{workspacePath || '未设置'}</div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="text-sm text-zinc-300">CSV 导入（标题, 正文）</div>
              <textarea
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                rows={8}
                className="w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              />
            </div>

            <div className="flex flex-col gap-4">
              {isVideoMode ? (
                <div className="flex flex-col gap-2">
                  <div className="text-sm text-zinc-300">当前视频素材（{importedVideoPaths.length} 条）</div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
                    {fileNameFromPath(importedVideoPath)}
                    {importedVideoPaths.length > 1 ? ` 等 ${importedVideoPaths.length} 条` : ''}
                  </div>
                  <div className="text-xs text-zinc-500 break-all">
                    {importedVideoPaths.length > 1
                      ? `首条：${importedVideoPath}`
                      : importedVideoPath}
                  </div>
                  <div className="mt-1 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="mb-2 text-xs text-zinc-300">封面设置</div>
                    <div className="flex flex-col gap-2">
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="radio"
                          name="video-cover-mode"
                          checked={videoCoverMode === 'auto-first-frame'}
                          onChange={() => setVideoCoverMode('auto-first-frame')}
                          disabled={isGenerating || isPreparingVideoCover || isSavingManualCover}
                        />
                        自动首帧封面（默认）
                      </label>
                      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="radio"
                          name="video-cover-mode"
                          checked={videoCoverMode === 'manual'}
                          onChange={() => setVideoCoverMode('manual')}
                          disabled={isGenerating || isPreparingVideoCover || isSavingManualCover}
                        />
                        手动封面（逐视频设置）
                      </label>
                    </div>

                    {videoCoverMode === 'manual' ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="text-xs text-zinc-400">
                          已设置 {manualCoverConfiguredCount}/{importedVideoPaths.length} 条视频封面
                        </div>
                        <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                          {importedVideoPaths.map((videoPath, index) => {
                            const normalizedPath = videoPath.trim()
                            const mappedCoverPath = normalizedPath ? manualCoverMap[normalizedPath] ?? '' : ''
                            const hasCover = Boolean(mappedCoverPath)
                            return (
                              <div
                                key={videoPath}
                                className="flex items-center justify-between gap-3 rounded-md border border-zinc-800/80 bg-zinc-950/70 px-2 py-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs text-zinc-200">
                                    {index + 1}. {fileNameFromPath(videoPath)}
                                  </div>
                                  <div className={`truncate text-[11px] ${hasCover ? 'text-emerald-300' : 'text-zinc-500'}`}>
                                    {hasCover ? `封面：${fileNameFromPath(mappedCoverPath)}` : '未设置封面图'}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-3 text-xs"
                                  onClick={() => openManualCoverEditor(videoPath)}
                                  disabled={isGenerating || isPreparingVideoCover || isSavingManualCover}
                                >
                                  {hasCover ? '修改' : '设置'}
                                </Button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-xs text-zinc-500">生成预览时会自动提取每条视频的首帧作为封面。</div>
                    )}

                    {isPreparingVideoCover ? (
                      <div className="mt-2 inline-flex items-center gap-2 text-xs text-zinc-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {videoCoverProgress || '封面提取中...'}
                      </div>
                    ) : videoCoverProgress ? (
                      <div className="mt-2 text-xs text-zinc-500">{videoCoverProgress}</div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <div className="text-sm text-zinc-300">图片文件夹路径</div>
                    <div className="flex gap-2">
                      <Input
                        value={dataWorkshopFolderPath}
                        onChange={(e) => setDataWorkshopFolderPath(e.target.value)}
                        placeholder="请输入或选择图片文件夹"
                      />
                      <Button onClick={handleBrowse} disabled={isScanning}>
                        浏览
                      </Button>
                      <Button onClick={() => handleScan()} disabled={isScanning || !dataWorkshopFolderPath.trim()}>
                        扫描
                      </Button>
                    </div>
                    <div className="text-xs text-zinc-500">已载入图片：{imageFiles.length} 张</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-zinc-400">分组数量（0=按 CSV 行数）</div>
                      <Input type="number" value={groupCount} onChange={(e) => setGroupCount(e.target.value)} min={0} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-zinc-400">最大复用次数</div>
                      <Input type="number" value={maxReuse} onChange={(e) => setMaxReuse(e.target.value)} min={1} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-zinc-400">每组最少图片数</div>
                      <Input type="number" value={minImages} onChange={(e) => setMinImages(e.target.value)} min={0} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs text-zinc-400">每组最多图片数</div>
                      <Input type="number" value={maxImages} onChange={(e) => setMaxImages(e.target.value)} min={0} />
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center gap-3">
                <Button onClick={() => void handleGenerate()} disabled={isGenerating || isPreparingVideoCover || isSavingManualCover}>
                  生成预览
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReset}
                  disabled={isScanning || isGenerating || isPreparingVideoCover || isSavingManualCover}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重置
                </Button>
                <div className="text-xs text-zinc-500">
                  {isVideoMode
                    ? '每行 CSV 将生成 1 条视频任务，并按顺序循环使用导入的视频素材。'
                    : '会根据图片最大复用次数自动控制图片复用。'}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <div className="min-w-0">
            <CardTitle>任务清单预览</CardTitle>
            <CardDescription>生成结果会写入状态管理，供后续上传模块使用。</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? (
            <div className="p-6 text-sm text-zinc-400">
              {isVideoMode ? '暂无任务。请先输入 CSV 并生成预览。' : '暂无任务。请先扫描图片并生成预览。'}
            </div>
          ) : (
            <Virtuoso
              key={scrollParent ? 'scroll-parent' : 'window-scroll'}
              customScrollParent={scrollParent}
              useWindowScroll={!scrollParent}
              data={tasks}
              defaultItemHeight={200}
              overscan={{ main: 500, reverse: 500 }}
              computeItemKey={(_, task) => task.id}
              components={{
                Header: () => (
                  <div className="px-6 pt-6 pb-4">
                    <div className="pl-3">
                      <label className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/60 py-1 pr-2 text-xs text-zinc-200">
                        <input
                          type="checkbox"
                          checked={isAllPreviewSelected}
                          onChange={toggleSelectAllPreview}
                          className="h-4 w-4"
                        />
                        全选
                      </label>
                    </div>
                  </div>
                )
              }}
              itemContent={(index, task) => {
                const isSelected = selectedImageIds.has(task.id)
                const isQueued = queuedTaskIds.has(task.id)

                return (
                  <div className="px-6 pb-4">
                    <div
                      className="relative"
                      onClick={() => toggleSelected(task.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') toggleSelected(task.id)
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {isQueued ? (
                        <div className="absolute right-2 top-2 z-10 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">
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
                        select={{
                          checked: isSelected,
                          ariaLabel: `${isSelected ? '取消选择' : '选择'}：${task.title || `第${index + 1}组`}`,
                          onChange: (checked) => {
                            if (checked !== isSelected) toggleSelected(task.id)
                          }
                        }}
                        className={
                          isSelected
                            ? 'border-zinc-300 bg-zinc-900/30 transition-colors'
                            : 'hover:bg-zinc-900/20 transition-colors'
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
                <div className="mt-1 truncate text-xs text-zinc-500">{normalizedManualEditorPath}</div>
              </div>
              <Button type="button" variant="outline" onClick={closeManualCoverEditor} disabled={isSavingManualCover}>
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
                    src={manualCoverEditorSourcePath ? fileUrlFromPath(manualCoverEditorSourcePath) : ''}
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
                    disabled={isSavingManualCover || isManualCoverEditorPreparing || !manualCoverEditorSourcePath}
                  >
                    {isManualCoverEditorPlaying ? '暂停' : '播放'}
                  </Button>
                  <div className="text-xs text-zinc-500">
                    当前帧时间：{formatTimeLabel(manualCoverEditorTimeSec)}（拖动进度条后点击“截取当前帧”）
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="text-xs text-zinc-400">当前视频：{fileNameFromPath(normalizedManualEditorPath)}</div>
                <div className="text-[11px] text-zinc-500 break-all">
                  预览源：{manualCoverEditorSourcePath || '准备中...'}
                </div>
                <div className="text-xs text-zinc-500 break-all">
                  当前封面：{activeManualCoverPath ? fileNameFromPath(activeManualCoverPath) : '未设置'}
                </div>
                <Button
                  type="button"
                  onClick={() => void handleCaptureManualCover()}
                  disabled={isSavingManualCover || isManualCoverEditorPreparing || !manualCoverEditorSourcePath}
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
                  disabled={isSavingManualCover || isManualCoverEditorPreparing || !normalizedManualEditorPath}
                >
                  手动上传图片
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearManualCover}
                  disabled={isSavingManualCover || !activeManualCoverPath}
                >
                  清除本视频封面
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

      {selectedImageIds.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-50 w-[min(820px,calc(100vw-48px))] -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-xl backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-zinc-200">已选 {selectedImageIds.size} 项</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                disabled={isDispatching}
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 sm:w-64"
              >
                {accounts.length === 0 ? <option value="">暂无账号</option> : null}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={isDispatching}
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 sm:w-64"
              >
                <option value="">无商品链接</option>
                {filteredProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button onClick={() => void dispatchSelected()} disabled={isDispatching || !selectedAccountId.trim()}>
                {isDispatching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isDispatching
                  ? `派发中 ${Math.min(dispatchProgress?.processed ?? 0, dispatchProgress?.total ?? 0)}/${dispatchProgress?.total ?? 0}`
                  : '📤 派发至队列'}
              </Button>
            </div>
            {dispatchProgress ? <div className="text-xs text-zinc-400">{dispatchProgress.message}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { DataBuilder }
