import { useMemo, useState } from 'react'
import type * as React from 'react'

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { TaskCard } from '@renderer/components/ui/TaskCard'
import { useCmsStore } from '@renderer/store/useCmsStore'

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function UploadManager(): React.JSX.Element {
  const tasks = useCmsStore((s) => s.tasks)
  const uploadTasks = useCmsStore((s) => s.uploadTasks)
  const config = useCmsStore((s) => s.config)
  const addLog = useCmsStore((s) => s.addLog)
  const updateTask = useCmsStore((s) => s.updateTask)
  const resetAll = useCmsStore((s) => s.resetAll)

  const syncableTasks = useMemo(
    () => tasks.filter((t) => t.mediaType !== 'video' && !t.videoPath),
    [tasks]
  )

  const [isSyncing, setIsSyncing] = useState(false)
  const [progress, setProgress] = useState(0)

  const stats = useMemo(() => {
    const total = syncableTasks.length
    const success = syncableTasks.filter((t) => t.status === 'success').length
    const failed = syncableTasks.filter((t) => t.status === 'error').length
    const pending = total - success - failed
    return { total, pending, success, failed }
  }, [syncableTasks])

  const isConfigReady = useMemo(() => {
    return (
      isNonEmpty(config.appId) &&
      isNonEmpty(config.appSecret) &&
      isNonEmpty(config.baseToken) &&
      isNonEmpty(config.tableId) &&
      isNonEmpty(config.titleField) &&
      isNonEmpty(config.bodyField)
    )
  }, [config])

  const tasksToSync = useMemo(() => syncableTasks.filter((t) => t.status !== 'success'), [syncableTasks])

  const startUpload = async (): Promise<void> => {
    if (isSyncing) return
    if (!isConfigReady) {
      addLog('[Upload] 配置不完整：请先填写 appId/appSecret/baseToken/tableId 与字段映射。')
      return
    }

    const queue = tasksToSync
    if (queue.length === 0) {
      addLog('[Upload] 没有需要同步的任务。')
      setProgress(1)
      return
    }

    setIsSyncing(true)
    setProgress(0)

    addLog(`[Upload] 开始同步：共 ${queue.length} 条任务。`)

    for (let index = 0; index < queue.length; index += 1) {
      const task = queue[index]
      updateTask(task.id, { status: 'uploading', log: '' })
      addLog(`[Upload] (${index + 1}/${queue.length}) 开始：${task.title || '（无标题）'}`)

      try {
        const fileTokens: Array<{ file_token: string }> = []
        const images = task.assignedImages.map((path) => path.trim()).filter(Boolean)
        for (const imagePath of images) {
          try {
            addLog(`[Feishu] 上传图片：${fileNameFromPath(imagePath)}`)
            const token = await window.electronAPI.uploadImage(imagePath, config.appId, config.appSecret, config.baseToken)
            if (token) {
              fileTokens.push({ file_token: token })
              addLog(`[Feishu] 图片上传成功：${token}`)
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            addLog(`[Feishu] 图片上传失败：${fileNameFromPath(imagePath)} - ${message}`)
          }
        }
        if (images.length > 0) {
          addLog(`[Feishu] 图片上传完成：成功 ${fileTokens.length}/${images.length}`)
        }

        const fields: Record<string, unknown> = {
          [config.titleField]: task.title,
          [config.bodyField]: task.body
        }
        if (fileTokens.length > 0 && isNonEmpty(config.imageField)) {
          fields[config.imageField] = fileTokens
        }

        addLog('[Feishu] 创建记录中...')
        const recordId = await window.electronAPI.createRecord(
          fields,
          config.appId,
          config.appSecret,
          config.baseToken,
          config.tableId
        )

        updateTask(task.id, { status: 'success', log: `record_id: ${recordId}` })
        addLog(`[Upload] 成功：record_id=${recordId}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updateTask(task.id, { status: 'error', log: message })
        addLog(`[Upload] 失败：${message}`)
      } finally {
        setProgress((index + 1) / queue.length)
      }
    }

    addLog('[Upload] 同步完成。')
    setIsSyncing(false)
  }

  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>上传管理</CardTitle>
          <CardDescription>顺序同步任务到飞书多维表格（Base），并实时显示进度与状态。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="text-xs text-zinc-400">总数</div>
              <div className="mt-1 text-2xl font-semibold">{stats.total}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="text-xs text-zinc-400">待处理</div>
              <div className="mt-1 text-2xl font-semibold">{stats.pending}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="text-xs text-zinc-400">成功</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-300">{stats.success}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="text-xs text-zinc-400">失败</div>
              <div className="mt-1 text-2xl font-semibold text-rose-300">{stats.failed}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button onClick={startUpload} disabled={!isConfigReady || isSyncing}>
                开始同步
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resetAll()
                  setProgress(0)
                }}
                disabled={isSyncing}
              >
                重置
              </Button>
            </div>
            <div className="text-xs text-zinc-500">
              {!isConfigReady ? '配置不完整：请填写下方配置后再开始。' : isSyncing ? '同步进行中...' : '就绪'}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <div>进度</div>
              <div>{percent}%</div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full border border-zinc-800 bg-zinc-950">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${percent}%` }}
                aria-label="上传进度"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最终任务清单</CardTitle>
          <CardDescription>与「数据工坊」预览一致：用于最终检查标题 + 正文 + 图片。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {uploadTasks.length === 0 ? (
            <div className="text-sm text-zinc-400">暂无任务清单。请先在「数据工坊」点击“生成预览”。</div>
          ) : (
            <div className="flex flex-col gap-2">
              {uploadTasks.map((task, index) => (
                <TaskCard
                  key={`${index}-${task.title}-${task.images[0] ?? ''}`}
                  index={index}
                  title={task.title}
                  body={task.body}
                  images={task.images}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>任务状态</CardTitle>
          <CardDescription>状态会在同步过程中实时更新（加载 → 成功 / 失败）。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {tasks.length === 0 ? (
            <div className="text-sm text-zinc-400">暂无任务。请先在「数据工坊」生成任务清单。</div>
          ) : (
            <div className="flex flex-col gap-2">
              {tasks.map((task, index) => {
                const icon =
                  task.status === 'uploading' ? (
                    <Loader2 className="h-4 w-4 animate-spin text-zinc-200" />
                  ) : task.status === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  ) : task.status === 'error' ? (
                    <XCircle className="h-4 w-4 text-rose-300" />
                  ) : (
                    <Circle className="h-4 w-4 text-zinc-500" />
                  )

                return (
                  <div
                    key={task.id}
                    className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      {icon}
                      <div className="truncate">
                        第{index + 1}组: {task.title || '（无标题）'} | 已分配 {task.assignedImages.length} 张图
                      </div>
                    </div>
                    {task.log ? <div className="text-xs text-amber-300">{task.log}</div> : null}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export { UploadManager }
