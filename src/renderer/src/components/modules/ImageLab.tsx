import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Folder, FolderOpen, Loader2, Video, X, Zap } from 'lucide-react'
import ReactCrop from 'react-image-crop'
import type { Crop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { useCmsStore } from '@renderer/store/useCmsStore'

type VideoPreviewResult = {
  originalPath: string
  previewPath: string | null
  isCompatible: boolean
  codecName?: string
  error?: string
}

function fileUrlFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const withLeadingSlash = /^[A-Za-z]:[/]/.test(normalized) ? `/${normalized}` : normalized
  const encoded = encodeURI(withLeadingSlash).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `safe-file://${encoded}`
}

function fileUrlFromPathWithBust(filePath: string, cacheBust: number | string): string {
  return `${fileUrlFromPath(filePath)}?t=${encodeURIComponent(String(cacheBust))}`
}

function thumbnailPathFromImagePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  const lastDot = normalized.lastIndexOf('.')
  const base = lastDot > lastSlash ? normalized.slice(0, lastDot) : normalized
  return `${base}_thumb.jpg`
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function dirNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return ''
  if (idx === 0) return '/'
  return normalized.slice(0, idx)
}

function isImageFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return normalized.endsWith('.jpg') || normalized.endsWith('.jpeg') || normalized.endsWith('.png') || normalized.endsWith('.webp')
}

function isVideoFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return normalized.endsWith('.mp4') || normalized.endsWith('.mov')
}

function uniqueMerge(prev: string[], next: string[]): string[] {
  const set = new Set(prev)
  for (const item of next) set.add(item)
  return Array.from(set)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function round3(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1000) / 1000
}

type ElectronPathFile = File & { path?: string }

function fileSystemPathFromFile(file: File): string | undefined {
  const fromWebUtils = window.electronAPI?.getPathForFile?.(file)
  if (typeof fromWebUtils === 'string') {
    const value = fromWebUtils.trim()
    if (value) return value
  }

  const maybe = file as ElectronPathFile
  if (typeof maybe.path !== 'string') return undefined
  const value = maybe.path.trim()
  return value ? value : undefined
}

function ImageLab(): React.JSX.Element {
  const addLog = useCmsStore((s) => s.addLog)
  const setActiveModule = useCmsStore((s) => s.setActiveModule)
  const setDataWorkshopFolderPath = useCmsStore((s) => s.setDataWorkshopFolderPath)
  const setWorkshopImport = useCmsStore((s) => s.setWorkshopImport)
  const updateConfig = useCmsStore((s) => s.updateConfig)
  const realEsrganPath = useCmsStore((s) => s.config.realEsrganPath)
  const pythonPath = useCmsStore((s) => s.config.pythonPath)
  const watermarkScriptPath = useCmsStore((s) => s.config.watermarkScriptPath)
  const watermarkBox = useCmsStore((s) => s.config.watermarkBox)
  const isProd = import.meta.env.PROD

  const [sourceFiles, setSourceFiles] = useState<string[]>([])
  const [sourceRevision, setSourceRevision] = useState(0)
  const [generatedTiles, setGeneratedTiles] = useState<string[]>([])
  const [tilesRevision, setTilesRevision] = useState(0)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [isVideoMode, setIsVideoMode] = useState(false)
  const [isVideoPreparing, setIsVideoPreparing] = useState(false)
  const [videoPreview, setVideoPreview] = useState<VideoPreviewResult | null>(null)
  const [rows, setRows] = useState('3')
  const [cols, setCols] = useState('3')
  const [isWatermarking, setIsWatermarking] = useState(false)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const [isSplitting, setIsSplitting] = useState(false)
  const [isAutoRunning, setIsAutoRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [processLogLines, setProcessLogLines] = useState<string[]>([])
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [isWatermarkBoxOpen, setIsWatermarkBoxOpen] = useState(false)
  const [crop, setCrop] = useState<Crop>()
  const [cropImageSize, setCropImageSize] = useState<{ width: number; height: number } | null>(null)
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [coverRevision, setCoverRevision] = useState(0)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cropImageRef = useRef<HTMLImageElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const unsubscribe = window.electronAPI.onProcessLog((payload) => {
      const time = new Date(payload.timestamp).toLocaleTimeString()
      const line = `[${time}] [${payload.level}] ${payload.message}`
      setProcessLogLines((prev) => [...prev.slice(-500), line])
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!isVideoMode) return
    setIsWatermarkBoxOpen(false)
    setCrop(undefined)
    setCropImageSize(null)
    setGeneratedTiles([])
  }, [isVideoMode])

  const parsedRows = useMemo(() => {
    const value = Number(rows)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3
  }, [rows])

  const parsedCols = useMemo(() => {
    const value = Number(cols)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3
  }, [cols])

  const isProcessing = isWatermarking || isUpscaling || isSplitting || isAutoRunning || isVideoPreparing

  const revealInFolder = async (filePath: string): Promise<void> => {
    const normalized = String(filePath ?? '').trim()
    if (!normalized) return
    const result = await window.electronAPI.shellShowItemInFolder(normalized)
    if (!result?.success) {
      addLog(`[素材处理] 打开文件夹失败：${result?.error ?? '未知错误'}`)
    }
  }

  const exportTiles = async (): Promise<void> => {
    if (generatedTiles.length === 0) return
    const result = await window.electronAPI.exportFiles(generatedTiles)
    if (!result) return
    if (!result.success) {
      addLog(`[素材处理] 导出失败：${result.error}`)
      return
    }
    addLog(`[素材处理] 已导出 ${result.copied} 张到：${result.destinationDir}`)
  }

  const sourceCacheBust = useMemo(() => Date.now(), [sourceRevision])
  const tilesCacheBust = useMemo(() => Date.now(), [tilesRevision])
  const previewCacheBust = useMemo(() => Date.now(), [previewImage, sourceRevision, tilesRevision])
  const coverCacheBust = useMemo(() => Date.now(), [coverRevision])

  const videoPlayablePath = useMemo(() => {
    if (!isVideoMode) return ''
    const original = sourceFiles[0]?.trim() ?? ''
    if (!original) return ''
    if (isVideoPreparing) return ''
    if (!videoPreview) return original
    if (typeof videoPreview.previewPath === 'string' && videoPreview.previewPath.trim()) return videoPreview.previewPath.trim()
    if (videoPreview.isCompatible) return (videoPreview.originalPath || original).trim()
    return ''
  }, [isVideoMode, isVideoPreparing, sourceFiles, videoPreview])

  const handleAddPaths = async (paths: string[]): Promise<void> => {
    const normalized = paths.map((p) => p.trim()).filter(Boolean)
    const firstVideo = normalized.find((p) => isVideoFile(p))
    if (firstVideo) {
      setIsVideoMode(true)
      setSourceFiles([firstVideo])
      setSourceRevision((prev) => prev + 1)
      setGeneratedTiles([])
      setTilesRevision((prev) => prev + 1)
      setPreviewImage(null)
      setCoverPath(null)
      setCoverRevision((prev) => prev + 1)
      setIsWatermarkBoxOpen(false)
      setCrop(undefined)
      setCropImageSize(null)
      setError(null)
      setVideoPreview(null)

      setIsVideoPreparing(true)
      try {
        const prepared = await window.electronAPI.prepareVideoPreview(firstVideo)
        if (prepared && typeof prepared === 'object') {
          setVideoPreview(prepared as VideoPreviewResult)
          if ((prepared as VideoPreviewResult).error) {
            addLog(`[素材处理] 视频兼容性处理失败：${(prepared as VideoPreviewResult).error}`)
          } else if ((prepared as VideoPreviewResult).previewPath && (prepared as VideoPreviewResult).previewPath !== firstVideo) {
            addLog('[素材处理] 已生成视频预览版本（H.264）。')
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setVideoPreview({ originalPath: firstVideo, previewPath: null, isCompatible: false, error: message })
        addLog(`[素材处理] 视频兼容性处理失败：${message}`)
      } finally {
        setIsVideoPreparing(false)
      }
      return
    }

    const filtered = normalized.filter((p) => isImageFile(p))
    if (filtered.length === 0) return
    setIsVideoMode(false)
    setVideoPreview(null)
    setCoverPath(null)
    setCoverRevision((prev) => prev + 1)
    setSourceFiles((prev) => {
      const prevHasVideo = prev.some((p) => isVideoFile(p))
      return prevHasVideo ? filtered : uniqueMerge(prev, filtered)
    })
    setError(null)
  }

  const handlePickMediaFiles = async (): Promise<void> => {
    if (isProcessing) return
    setIsVideoPreparing(true)
    try {
      const result = await window.electronAPI.openMediaFiles({ multiSelections: true })
      const items = Array.isArray(result) ? result : result ? [result] : []
      if (items.length === 0) return

      const firstVideo = items.find((item) => item && typeof item === 'object' && (item as { mediaType?: unknown }).mediaType === 'video') as
        | {
            originalPath?: unknown
            previewPath?: unknown
            isCompatible?: unknown
            codecName?: unknown
            error?: unknown
          }
        | undefined

      if (firstVideo && typeof firstVideo.originalPath === 'string' && firstVideo.originalPath.trim()) {
        const originalPath = firstVideo.originalPath.trim()
        setIsVideoMode(true)
        setSourceFiles([originalPath])
        setSourceRevision((prev) => prev + 1)
        setGeneratedTiles([])
        setTilesRevision((prev) => prev + 1)
        setPreviewImage(null)
        setCoverPath(null)
        setCoverRevision((prev) => prev + 1)
        setIsWatermarkBoxOpen(false)
        setCrop(undefined)
        setCropImageSize(null)
        setError(null)
        setVideoPreview({
          originalPath,
          previewPath: typeof firstVideo.previewPath === 'string' ? firstVideo.previewPath : null,
          isCompatible: firstVideo.isCompatible === true,
          codecName: typeof firstVideo.codecName === 'string' ? firstVideo.codecName : undefined,
          error: typeof firstVideo.error === 'string' ? firstVideo.error : undefined
        })
        if (typeof firstVideo.error === 'string' && firstVideo.error.trim()) {
          addLog(`[素材处理] 视频兼容性处理失败：${firstVideo.error}`)
        } else if (typeof firstVideo.previewPath === 'string' && firstVideo.previewPath.trim() && firstVideo.previewPath !== originalPath) {
          addLog('[素材处理] 已生成视频预览版本（H.264）。')
        }
        return
      }

      const paths = items
        .map((item) => (item && typeof item === 'object' && typeof (item as { originalPath?: unknown }).originalPath === 'string'
          ? String((item as { originalPath?: unknown }).originalPath).trim()
          : ''))
        .filter(Boolean)
      if (paths.length === 0) return
      await handleAddPaths(paths)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[素材处理] 选择文件失败：${message}`)
      window.alert(message)
    } finally {
      setIsVideoPreparing(false)
    }
  }

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    const usablePaths = files.map(fileSystemPathFromFile).filter((p): p is string => Boolean(p))
    if (usablePaths.length === 0) {
      setError('未检测到文件系统路径（无法从 File 恢复 path）。请确认拖入的是本地文件，并检查“检测到的路径”是否只有文件名。')
      return
    }
    void handleAddPaths(usablePaths)
  }

  const handleDragEnter: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }

  const openWatermarkBoxModal = (): void => {
    if (isProcessing) return
    if (sourceFiles.length === 0) {
      window.alert('当前没有图片，请先添加图片。')
      return
    }
    setIsWatermarkBoxOpen(true)
    setCrop(undefined)
    setCropImageSize(null)
  }

  const handleCropImageLoad: React.ReactEventHandler<HTMLImageElement> = (e) => {
    const img = e.currentTarget
    cropImageRef.current = img
    const rect = img.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    setCropImageSize({ width, height })

    const x = Math.round(clamp01(watermarkBox.x) * width)
    const y = Math.round(clamp01(watermarkBox.y) * height)
    const w = Math.max(1, Math.round(clamp01(watermarkBox.width) * width))
    const h = Math.max(1, Math.round(clamp01(watermarkBox.height) * height))
    setCrop({
      unit: 'px',
      x: Math.min(x, width - 1),
      y: Math.min(y, height - 1),
      width: Math.min(w, width),
      height: Math.min(h, height)
    })
  }

  const confirmWatermarkBox = async (): Promise<void> => {
    const size = cropImageSize
    if (!size) {
      window.alert('图片尚未加载完成，请稍后再试。')
      return
    }
    const nextCrop = crop
    if (!nextCrop || !nextCrop.width || !nextCrop.height) {
      window.alert('请先框选一个有效区域。')
      return
    }

    const nextBox = {
      x: round3(clamp01((nextCrop.x ?? 0) / size.width)),
      y: round3(clamp01((nextCrop.y ?? 0) / size.height)),
      width: round3(clamp01((nextCrop.width ?? 0) / size.width)),
      height: round3(clamp01((nextCrop.height ?? 0) / size.height))
    }

    updateConfig({ watermarkBox: nextBox })
    try {
      await window.electronAPI.saveConfig({ watermarkBox: nextBox })
      addLog(`[素材处理] 已保存去印区域：${nextBox.x},${nextBox.y},${nextBox.width},${nextBox.height}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addLog(`[素材处理] 保存去印区域失败：${message}`)
    } finally {
      setIsWatermarkBoxOpen(false)
    }
  }

  const startSplit = async (): Promise<void> => {
    if (isProcessing) return
    if (sourceFiles.length === 0) return

    setIsSplitting(true)
    setError(null)

    try {
      addLog(`[素材处理] 网格切片：开始处理 ${sourceFiles.length} 张图片，${parsedRows}×${parsedCols}`)
      const paths = await window.electronAPI.processGridSplit({ sourceFiles, rows: parsedRows, cols: parsedCols })
      setGeneratedTiles(paths)
      setTilesRevision((prev) => prev + 1)
      addLog(`[素材处理] 网格切片：生成切片 ${paths.length} 张`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[素材处理] 网格切片：失败 - ${message}`)
      setGeneratedTiles([])
    } finally {
      setIsSplitting(false)
    }
  }

  const startHdUpscale = async (): Promise<void> => {
    if (isProcessing) return
    if (sourceFiles.length === 0) return
    const exePath = realEsrganPath.trim()
    if (!isProd && !exePath) {
      setError('Real-ESRGAN 未配置：请先在「设置」中配置可执行文件路径。')
      return
    }

    setIsUpscaling(true)
    setError(null)
    setIsLogOpen(true)

    try {
      addLog(`[素材处理] 画质重生：开始处理 ${sourceFiles.length} 张图片`)
      const nextPaths = await window.electronAPI.processHdUpscale({ files: sourceFiles, exePath })
      setSourceFiles(nextPaths)
      setSourceRevision((prev) => prev + 1)
      setGeneratedTiles([])
      setTilesRevision((prev) => prev + 1)
      addLog(`[素材处理] 画质重生：完成 ${nextPaths.length} 张`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[素材处理] 画质重生：失败 - ${message}`)
    } finally {
      setIsUpscaling(false)
    }
  }

  const startWatermarkRemoval = async (): Promise<void> => {
    if (isProcessing) return
    if (sourceFiles.length === 0) return
    const normalizedPythonPath = pythonPath.trim()
    const normalizedScriptPath = watermarkScriptPath.trim()
    if (!isProd && (!normalizedPythonPath || !normalizedScriptPath)) {
      setError('去印工具未配置：请先在「设置」中配置 Python 解释器路径与去印脚本路径。')
      return
    }

    setIsWatermarking(true)
    setError(null)
    setIsLogOpen(true)

    try {
      addLog(`[素材处理] 魔法去印：开始处理 ${sourceFiles.length} 张图片`)
      const nextPaths = await window.electronAPI.processWatermark({
        files: sourceFiles,
        pythonPath: isProd ? '' : normalizedPythonPath,
        scriptPath: isProd ? '' : normalizedScriptPath,
        watermarkBox
      })
      setSourceFiles(nextPaths)
      setSourceRevision((prev) => prev + 1)
      setGeneratedTiles([])
      setTilesRevision((prev) => prev + 1)
      addLog(`[素材处理] 魔法去印：完成 ${nextPaths.length} 张`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[素材处理] 魔法去印：失败 - ${message}`)
    } finally {
      setIsWatermarking(false)
    }
  }

  const handleAutoRun = async (): Promise<void> => {
    if (isProcessing) return
    if (sourceFiles.length === 0) return

    const normalizedPythonPath = pythonPath.trim()
    const normalizedScriptPath = watermarkScriptPath.trim()
    const exePath = realEsrganPath.trim()

    if (!isProd && (!normalizedPythonPath || !normalizedScriptPath)) {
      const message = '去印工具未配置：请先在「设置」中配置 Python 解释器路径与去印脚本路径。'
      setError(message)
      window.alert(message)
      return
    }

    if (!isProd && !exePath) {
      const message = 'Real-ESRGAN 未配置：请先在「设置」中配置可执行文件路径。'
      setError(message)
      window.alert(message)
      return
    }

    setIsAutoRunning(true)
    setError(null)
    setIsLogOpen(true)

    try {
      let currentFiles = sourceFiles.slice()
      addLog(`[素材处理] 一键全流程：开始处理 ${currentFiles.length} 张`)

      addLog('[素材处理] 一键全流程：步骤 1/3 去印处理中...')
      const cleanFiles: string[] = []
      for (const inputPath of currentFiles) {
        const out = await window.electronAPI.processWatermark({
          files: [inputPath],
          pythonPath: isProd ? '' : normalizedPythonPath,
          scriptPath: isProd ? '' : normalizedScriptPath,
          watermarkBox
        })
        const first = Array.isArray(out) ? out[0] : undefined
        if (typeof first === 'string' && first.trim()) cleanFiles.push(first)
      }
      if (!cleanFiles || cleanFiles.length === 0) throw new Error('[素材处理] 魔法去印失败：未返回有效文件。')
      setSourceFiles(cleanFiles)
      setSourceRevision((prev) => prev + 1)
      setGeneratedTiles([])
      setTilesRevision((prev) => prev + 1)
      currentFiles = cleanFiles
      addLog(`[素材处理] 一键全流程：步骤 1/3 完成 ${cleanFiles.length} 张`)

      addLog('[素材处理] 一键全流程：步骤 2/3 画质重生处理中...')
      const hdFiles: string[] = []
      for (const inputPath of currentFiles) {
        const out = await window.electronAPI.processHdUpscale({ files: [inputPath], exePath })
        const first = Array.isArray(out) ? out[0] : undefined
        if (typeof first === 'string' && first.trim()) hdFiles.push(first)
      }
      if (!hdFiles || hdFiles.length === 0) throw new Error('[素材处理] 画质重生失败：未返回有效文件。')
      setSourceFiles(hdFiles)
      setSourceRevision((prev) => prev + 1)
      currentFiles = hdFiles
      addLog(`[素材处理] 一键全流程：步骤 2/3 完成 ${hdFiles.length} 张`)

      addLog(`[素材处理] 一键全流程：步骤 3/3 切分处理中... ${parsedRows}×${parsedCols}`)
      const tiles = await window.electronAPI.processGridSplit({
        sourceFiles: currentFiles,
        rows: parsedRows,
        cols: parsedCols
      })
      if (!tiles || tiles.length === 0) throw new Error('[素材处理] 网格切片失败：未生成任何切片。')
      setGeneratedTiles(tiles)
      setTilesRevision((prev) => prev + 1)
      addLog(`[素材处理] 一键全流程：步骤 3/3 完成 ${tiles.length} 张切片`)
      addLog('[素材处理] 全流程完成：请将切片发送到数据工坊继续。')
      const time = new Date().toLocaleTimeString()
      setProcessLogLines((prev) => [
        ...prev.slice(-500),
        `[${time}] [info] 全流程完成：请将切片发送到数据工坊继续。`
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      addLog(`[素材处理] 一键全流程：失败 - ${message}`)
      window.alert(message)
    } finally {
      setIsAutoRunning(false)
    }
  }

  const handleDeleteTile = async (tilePath: string): Promise<void> => {
    try {
      const res = await window.electronAPI.deleteFile(tilePath)
      if (!res?.success) {
        const message = res?.error ? String(res.error) : '删除失败'
        addLog(`[素材处理] 删除失败：${fileNameFromPath(tilePath)} - ${message}`)
        return
      }
      setPreviewImage((prev) => (prev === tilePath ? null : prev))
      setGeneratedTiles((prev) => prev.filter((p) => p !== tilePath))
      addLog(`[素材处理] 已删除：${fileNameFromPath(tilePath)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addLog(`[素材处理] 删除失败：${fileNameFromPath(tilePath)} - ${message}`)
    }
  }

  const handleCaptureCover = async (): Promise<void> => {
    if (isProcessing) return
    if (!isVideoMode) return
    const video = videoRef.current
    if (!video) {
      window.alert('视频尚未准备好，请稍后再试。')
      return
    }
    const width = Number(video.videoWidth) || 0
    const height = Number(video.videoHeight) || 0
    if (width <= 0 || height <= 0) {
      window.alert('视频元信息尚未加载完成，请先点击播放或稍等片刻。')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      window.alert('Canvas 初始化失败。')
      return
    }
    ctx.drawImage(video, 0, 0, width, height)

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
      const filename = `cover_${Date.now()}.jpg`
      const savedPath = await window.api.cms.image.saveBase64({ dataUrl, filename })
      if (typeof savedPath === 'string' && savedPath.trim()) {
        setCoverPath(savedPath)
        setCoverRevision((prev) => prev + 1)
        addLog(`[素材处理] 已截取封面：${savedPath}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addLog(`[素材处理] 截取封面失败：${message}`)
      window.alert(message)
    }
  }

  const handleUploadCover = async (): Promise<void> => {
    if (isProcessing) return
    if (!isVideoMode) return
    try {
      const result = await window.electronAPI.openMediaFiles({ accept: 'image' })
      const item = Array.isArray(result) ? result[0] : result
      const filePath =
        item && typeof item === 'object' && typeof (item as { originalPath?: unknown }).originalPath === 'string'
          ? String((item as { originalPath?: unknown }).originalPath).trim()
          : ''
      if (!filePath) return
      if (!isImageFile(filePath)) {
        window.alert('请选择图片文件作为封面。')
        return
      }
      setCoverPath(filePath)
      setCoverRevision((prev) => prev + 1)
      addLog(`[素材处理] 已设置封面：${filePath}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addLog(`[素材处理] 上传封面失败：${message}`)
      window.alert(message)
    }
  }

  const handleSendToWorkshop = async (): Promise<void> => {
    if (isProcessing) return
    const originalPath = sourceFiles[0]?.trim() ?? ''
    if (!originalPath) return
    const previewPath = typeof videoPreview?.previewPath === 'string' ? videoPreview.previewPath.trim() : ''
    addLog(`[素材处理] 已选择视频：${originalPath}`)
    if (previewPath && previewPath !== originalPath) addLog(`[素材处理] 预览路径：${previewPath}`)

    setWorkshopImport('video', previewPath || originalPath, coverPath)
    setActiveModule('workshop')
    addLog(`[素材处理] 已将视频导入数据工坊：${previewPath || originalPath}`)
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>素材处理</CardTitle>
            <CardDescription>线性流水线：输入图片 → 魔法去印 → 画质重生 → 网格切片。</CardDescription>
          </CardHeader>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>输入素材</CardTitle>
              <CardDescription>拖拽图片/视频到下方区域，或点击按钮选择文件。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/mp4,video/quicktime,.mp4,.mov"
              className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                const usablePaths = files.map(fileSystemPathFromFile).filter((p): p is string => Boolean(p))
                if (usablePaths.length === 0) {
                  setError('未检测到文件系统路径（无法从 File 恢复 path）。请确认已启用 getPathForFile。')
                  e.currentTarget.value = ''
                  return
                }
                void handleAddPaths(usablePaths)
                e.currentTarget.value = ''
              }}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void handlePickMediaFiles()} disabled={isProcessing}>
                选择文件
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSourceFiles([])
                  setGeneratedTiles([])
                  setError(null)
                  setProcessLogLines([])
                  setIsLogOpen(false)
                  setIsVideoMode(false)
                  setIsVideoPreparing(false)
                  setVideoPreview(null)
                  setPreviewImage(null)
                  setCoverPath(null)
                  setCoverRevision((prev) => prev + 1)
                }}
                disabled={isProcessing}
              >
                清空
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void revealInFolder((isVideoMode ? videoPreview?.originalPath : sourceFiles[0]) ?? '')}
                disabled={isProcessing || sourceFiles.length === 0}
                aria-label="打开源图所在文件夹"
                title="打开源图所在文件夹"
                className="h-10 w-10"
              >
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              className="relative z-10 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/30 p-4 text-sm text-zinc-400 pointer-events-auto"
            >
              {sourceFiles.length === 0 ? (
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
                  <div className="text-zinc-300">将素材拖拽到这里</div>
                  <div className="text-xs text-zinc-500">支持图片与视频 (mp4/mov)</div>
                </div>
              ) : isVideoMode ? (
                <div className="flex flex-col gap-3">
                  <div className="flex w-full justify-center">
                    <div className="max-h-[600px] max-w-full overflow-hidden rounded-lg border border-zinc-800 bg-black">
                    {isVideoPreparing ? (
                      <div className="flex h-[320px] w-[520px] max-w-full items-center justify-center gap-2 text-zinc-300">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <div className="text-sm">正在处理视频...</div>
                      </div>
                    ) : videoPlayablePath ? (
                      <video
                        ref={videoRef}
                        controls
                        preload="metadata"
                        src={fileUrlFromPathWithBust(videoPlayablePath, sourceCacheBust)}
                        className="block h-auto w-auto max-h-[600px] max-w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-[320px] w-[520px] max-w-full flex-col items-center justify-center gap-2 px-6 text-center text-zinc-300">
                        <Video className="h-10 w-10" />
                        <div className="text-sm">无法预览该视频，但不影响发布</div>
                        {videoPreview?.error ? <div className="text-xs text-zinc-500">{videoPreview.error}</div> : null}
                      </div>
                    )}
                    </div>
                  </div>
                  <div className="truncate text-xs text-zinc-400">{fileNameFromPath(sourceFiles[0] ?? '')}</div>
                  {coverPath ? (
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <img
                        src={fileUrlFromPathWithBust(coverPath, coverCacheBust)}
                        alt="封面预览"
                        className="h-16 w-28 rounded border border-zinc-800 object-cover"
                        loading="lazy"
                      />
                      <div className="text-xs text-emerald-300">已设置封面</div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {sourceFiles.map((filePath) => {
                    const fileName = fileNameFromPath(filePath)
                    const isVideo = isVideoFile(filePath)
                    const isHd = fileName.includes('_HD')
                    const isClean = fileName.includes('_Clean')
                    const thumbPath = thumbnailPathFromImagePath(filePath)
                    return (
                      <div
                        key={`${sourceRevision}-${filePath}`}
                        className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40"
                      >
                        <div className="relative aspect-square w-full bg-zinc-950">
                          <button
                            type="button"
                            onClick={() => setPreviewImage(filePath)}
                            className="block h-full w-full"
                            aria-label={`预览 ${fileName}`}
                          >
                            {isVideo ? (
                              <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-zinc-300">
                                <div className="flex flex-col items-center gap-2">
                                  <Video className="h-8 w-8" />
                                  <div className="text-xs text-zinc-400">点击预览</div>
                                </div>
                              </div>
                            ) : (
                              <img
                                src={fileUrlFromPathWithBust(isHd || isClean ? thumbPath : filePath, sourceCacheBust)}
                                alt={fileName}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  if (!(isHd || isClean)) return
                                  const img = e.currentTarget
                                  if (img.dataset.fallbackApplied === '1') return
                                  img.dataset.fallbackApplied = '1'
                                  img.src = fileUrlFromPathWithBust(filePath, sourceCacheBust)
                                }}
                              />
                            )}
                          </button>
                          {isVideo ? (
                            <div className="absolute left-2 top-2 rounded bg-zinc-100/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                              视频
                            </div>
                          ) : null}
                          {isHd ? (
                            <div className="absolute left-2 top-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                              高清
                            </div>
                          ) : null}
                          {isClean ? (
                            <div className="absolute left-2 top-8 rounded bg-sky-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                              去印
                            </div>
                          ) : null}
                        </div>
                        <div className="truncate px-2 py-1 text-xs text-zinc-400">{fileName}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {isVideoMode ? (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-zinc-400">视频工具</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleCaptureCover()}
                      disabled={isProcessing || sourceFiles.length === 0 || !videoPlayablePath}
                    >
                      🎬 截取当前帧为封面
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleUploadCover()}
                      disabled={isProcessing || sourceFiles.length === 0}
                    >
                      🖼️ 上传封面
                    </Button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-zinc-500">视频模式下暂不支持去印/超分/切宫格。</div>
              </div>
            ) : (
              <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-zinc-400">工具</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => void handleAutoRun()}
                      className="bg-amber-400 text-black hover:bg-amber-300"
                      disabled={isProcessing || sourceFiles.length === 0}
                    >
                      {isAutoRunning ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          一键全流程...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Zap className="h-4 w-4" />
                          一键全流程
                        </span>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void startWatermarkRemoval()}
                      disabled={
                        isProcessing ||
                        sourceFiles.length === 0 ||
                        (!isProd && (pythonPath.trim().length === 0 || watermarkScriptPath.trim().length === 0))
                      }
                    >
                      {isWatermarking ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          魔法去印...
                        </span>
                      ) : (
                        '💧 魔法去印'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={openWatermarkBoxModal}
                      disabled={isProcessing || sourceFiles.length === 0}
                    >
                      ⚙️ 区域设置
                    </Button>
                    <Button
                      onClick={() => void startHdUpscale()}
                      disabled={isProcessing || sourceFiles.length === 0 || (!isProd && realEsrganPath.trim().length === 0)}
                    >
                      {isUpscaling ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          画质重生...
                        </span>
                      ) : (
                        '✨ 画质重生'
                      )}
                    </Button>
                  </div>
                </div>
                {!isProd && (pythonPath.trim().length === 0 || watermarkScriptPath.trim().length === 0) ? (
                  <div className="mt-1 text-xs text-zinc-500">未配置去印工具：请前往「设置」配置 Python / 去印脚本路径。</div>
                ) : null}
                {!isProd && realEsrganPath.trim().length === 0 ? (
                  <div className="mt-1 text-xs text-zinc-500">未配置 Real-ESRGAN：请前往「设置」配置路径。</div>
                ) : null}
              </div>
            )}

            {isVideoMode ? null : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">行数</div>
                  <Input type="number" min={1} value={rows} onChange={(e) => setRows(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">列数</div>
                  <Input type="number" min={1} value={cols} onChange={(e) => setCols(e.target.value)} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {isVideoMode ? (
                <Button onClick={() => void handleSendToWorkshop()} disabled={isProcessing || sourceFiles.length === 0}>
                  发送到数据工坊
                </Button>
              ) : (
                <Button onClick={startSplit} disabled={isProcessing || sourceFiles.length === 0}>
                  {isSplitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      切分中...
                    </span>
                  ) : (
                    '开始切分'
                  )}
                </Button>
              )}
              <div className="text-xs text-zinc-500">
                {sourceFiles.length === 0
                  ? '请先添加素材。'
                  : isVideoMode
                    ? '将把视频发送到数据工坊继续。'
                    : `将生成 ${parsedRows * parsedCols} 张/图片`}
              </div>
            </div>

            {error ? <div className="text-sm text-rose-300">{error}</div> : null}

            <details
              open={isLogOpen}
              onToggle={(e) => setIsLogOpen((e.currentTarget as HTMLDetailsElement).open)}
              className="rounded-md border border-zinc-800 bg-zinc-950/40"
            >
              <summary className="cursor-pointer select-none px-3 py-2 text-sm text-zinc-200">
                处理日志
              </summary>
              <div className="border-t border-zinc-800 p-3">
                <div className="mb-2 flex items-center justify-end">
                  <Button type="button" variant="outline" onClick={() => setProcessLogLines([])}>
                    清空日志
                  </Button>
                </div>
                <div className="max-h-56 overflow-auto rounded-md bg-black p-3 font-mono text-xs text-emerald-400">
                  {processLogLines.length === 0 ? (
                    <div className="text-emerald-400/70">暂无日志。</div>
                  ) : (
                    processLogLines.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>)
                  )}
                </div>
              </div>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>切片结果</CardTitle>
            <CardDescription>悬停切片显示删除按钮，点击即可移除并从磁盘删除。</CardDescription>
          </CardHeader>
          <CardContent>
            {generatedTiles.length === 0 ? null : (
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-500">共 {generatedTiles.length} 张切片</div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => void exportTiles()} disabled={isProcessing}>
                    📤 导出结果
                  </Button>
                  <Button
                    onClick={() => {
                      const firstPath = generatedTiles[0]
                      const folderPath = firstPath ? dirNameFromPath(firstPath).trim() : ''
                      if (!folderPath) {
                        addLog('[素材处理] 无法解析切片所在目录，请确认生成结果路径有效。')
                        return
                      }

                      setWorkshopImport('image', folderPath)
                      setDataWorkshopFolderPath(folderPath)
                      setActiveModule('workshop')
                      addLog(`[素材处理] 已将切片目录填入数据工坊：${folderPath}`)
                    }}
                    disabled={isProcessing}
                  >
                    🚀 发送到数据工坊
                  </Button>
                </div>
              </div>
            )}
            {generatedTiles.length === 0 ? (
              <div className="text-sm text-zinc-400">{isVideoMode ? '视频模式不生成切片结果。' : '暂无结果。请先执行切片。'}</div>
            ) : (
              <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
                {generatedTiles.map((tilePath) => (
                  <div
                    key={tilePath}
                    className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40"
                  >
                    <button
                      type="button"
                      onClick={() => void revealInFolder(tilePath)}
                      className="absolute left-2 top-2 z-10 rounded-full bg-zinc-900/80 p-1 text-white opacity-0 shadow transition-opacity hover:bg-zinc-800 group-hover:opacity-100"
                      aria-label={`在 Finder 中显示 ${fileNameFromPath(tilePath)}`}
                      title="在 Finder 中显示"
                    >
                      <Folder className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTile(tilePath)}
                      className="absolute right-2 top-2 z-10 rounded-full bg-rose-600 p-1 text-white opacity-0 shadow transition-opacity hover:bg-rose-500 group-hover:opacity-100"
                      aria-label={`删除 ${fileNameFromPath(tilePath)}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewImage(tilePath)}
                      className="block aspect-square w-full bg-zinc-950"
                      aria-label={`预览 ${fileNameFromPath(tilePath)}`}
                    >
                      <img
                        src={fileUrlFromPathWithBust(tilePath, tilesCacheBust)}
                        alt={fileNameFromPath(tilePath)}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                    <div className="truncate px-2 py-1 text-xs text-zinc-400">{fileNameFromPath(tilePath)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>

      {previewImage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative max-h-full w-full max-w-5xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="truncate text-sm text-zinc-200">{fileNameFromPath(previewImage)}</div>
              <Button type="button" variant="outline" onClick={() => setPreviewImage(null)}>
                关闭
              </Button>
            </div>
            <div className="flex max-h-[85vh] items-center justify-center bg-black p-4">
              {isVideoFile(previewImage) ? (
                <video
                  controls
                  preload="metadata"
                  src={fileUrlFromPathWithBust(previewImage, previewCacheBust)}
                  className="max-h-[80vh] w-auto max-w-full object-contain"
                />
              ) : (
                <img
                  src={fileUrlFromPathWithBust(previewImage, previewCacheBust)}
                  alt={fileNameFromPath(previewImage)}
                  className="max-h-[80vh] w-auto max-w-full object-contain"
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isWatermarkBoxOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setIsWatermarkBoxOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative max-h-full w-full max-w-5xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div className="truncate text-sm text-zinc-200">区域设置</div>
              <Button type="button" variant="outline" onClick={() => setIsWatermarkBoxOpen(false)}>
                关闭
              </Button>
            </div>
            <div className="flex max-h-[80vh] flex-col gap-3 overflow-auto bg-black p-4">
              <div className="text-xs text-zinc-400">
                拖拽/缩放选择区域后点击“保存”。当前值（百分比）：{watermarkBox.x},{watermarkBox.y},{watermarkBox.width},
                {watermarkBox.height}
              </div>
              {sourceFiles[0] ? (
                <div className="w-full">
                  <ReactCrop crop={crop} onChange={(next) => setCrop(next)} keepSelection>
                    <img
                      ref={cropImageRef}
                      src={fileUrlFromPathWithBust(sourceFiles[0], sourceCacheBust)}
                      alt={fileNameFromPath(sourceFiles[0])}
                      onLoad={handleCropImageLoad}
                      className="max-h-[70vh] w-auto max-w-full"
                    />
                  </ReactCrop>
                </div>
              ) : (
                <div className="flex min-h-48 items-center justify-center text-sm text-zinc-400">暂无图片可供设置。</div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsWatermarkBoxOpen(false)}>
                  取消
                </Button>
                <Button type="button" onClick={() => void confirmWatermarkBox()} disabled={!sourceFiles[0]}>
                  保存
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export { ImageLab }
