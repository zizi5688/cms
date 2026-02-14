import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Virtuoso } from 'react-virtuoso'

import { Loader2, RotateCcw } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { TaskCard } from '@renderer/components/ui/TaskCard'
import { generateManifest, generateVideoManifest } from '@renderer/lib/cms-engine'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
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
  const lastScannedPathRef = useRef('')
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

  const importedVideoPath = useMemo(() => {
    if (workshopImport?.type !== 'video') return ''
    return String(workshopImport.path ?? '').trim()
  }, [workshopImport])

  const importedCoverPath = useMemo(() => {
    if (workshopImport?.type !== 'video') return ''
    return String(workshopImport.coverPath ?? '').trim()
  }, [workshopImport])

  const isVideoMode = Boolean(importedVideoPath)

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

  const handleGenerate = (): void => {
    setIsGenerating(true)
    try {
      const next = isVideoMode
        ? generateVideoManifest(csvContent, importedVideoPath).map((task) => ({
            ...task,
            assignedImages: task.mediaType === 'video' && importedCoverPath ? [importedCoverPath] : []
          }))
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
                  <div className="text-sm text-zinc-300">当前视频素材</div>
                  <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100">
                    {fileNameFromPath(importedVideoPath)}
                  </div>
                  <div className="text-xs text-zinc-500 break-all">{importedVideoPath}</div>
                  {importedCoverPath ? (
                    <div className="flex flex-col gap-2 pt-2">
                      <div className="text-xs text-zinc-400">封面预览</div>
                      <div className="flex items-center gap-3">
                        <img
                          src={resolveLocalImage(importedCoverPath, workspacePath)}
                          alt="封面"
                          className="h-16 w-28 rounded border border-zinc-800 object-cover"
                          loading="lazy"
                        />
                        <div className="min-w-0 text-xs text-emerald-300">已设置封面</div>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 text-xs text-zinc-500">未设置封面（视频任务将显示“未分配图片”）。</div>
                  )}
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
                <Button onClick={handleGenerate} disabled={isGenerating}>
                  生成预览
                </Button>
                <Button type="button" variant="outline" onClick={handleReset} disabled={isScanning || isGenerating}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  重置
                </Button>
                <div className="text-xs text-zinc-500">
                  {isVideoMode ? '每行 CSV 将生成 1 条视频任务，均使用当前视频素材。' : '会根据图片最大复用次数自动控制图片复用。'}
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
