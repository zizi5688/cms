import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'

import { CheckCircle2, ImageIcon, RefreshCcw, Send, Trash2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import type { AiStudioAssetRecord, UseAiStudioStateResult } from './useAiStudioState'

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未命名结果'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function PreviewCandidate({
  asset,
  active,
  onClick
}: {
  asset: AiStudioAssetRecord
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset.previewPath ?? asset.filePath ?? '', workspacePath)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-2 rounded-2xl border p-2 text-left transition',
        active
          ? 'border-zinc-100 bg-zinc-950/90 shadow-[0_0_0_1px_rgba(255,255,255,0.16)]'
          : 'border-zinc-800 bg-zinc-950/55 hover:border-zinc-700 hover:bg-zinc-950/80'
      )}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        {src ? (
          <img
            src={src}
            alt={basename(asset.filePath)}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.42))]" />
        <div
          className={cn(
            'absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] backdrop-blur',
            active
              ? 'border border-emerald-400/20 bg-emerald-400/15 text-emerald-200'
              : 'border border-white/10 bg-black/35 text-zinc-300'
          )}
        >
          <CheckCircle2 className="h-3 w-3" />
          {active ? '已选' : '候选'}
        </div>
      </div>
      <div className="truncate text-xs text-zinc-400">{basename(asset.filePath)}</div>
    </button>
  )
}

function ResultPanel({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const setActiveModule = useCmsStore((store) => store.setActiveModule)
  const setMaterialImport = useCmsStore((store) => store.setMaterialImport)
  const workspacePath = useCmsStore((store) => store.workspacePath)

  const [heroAssetId, setHeroAssetId] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const task = state.activeTask
  const outputAssets = state.activeOutputAssets
  const selectedAssets = state.activeSelectedOutputAssets

  useEffect(() => {
    const fallbackId = selectedAssets[0]?.id ?? outputAssets[0]?.id ?? null
    if (!heroAssetId || !outputAssets.some((asset) => asset.id === heroAssetId)) {
      setHeroAssetId(fallbackId)
    }
  }, [heroAssetId, outputAssets, selectedAssets])

  const heroAsset = useMemo(() => {
    return (
      outputAssets.find((asset) => asset.id === heroAssetId) ??
      selectedAssets[0] ??
      outputAssets[0] ??
      null
    )
  }, [heroAssetId, outputAssets, selectedAssets])

  const retainedAssets = selectedAssets.length > 0 ? selectedAssets : heroAsset ? [heroAsset] : []

  const handleKeep = async (): Promise<void> => {
    if (!task || retainedAssets.length === 0) return
    await state.setOutputSelection(
      retainedAssets.map((asset) => asset.id),
      true,
      true
    )
    addLog(`[AI Studio] 已保留 ${retainedAssets.length} 张结果：${task.productName || task.id}`)
  }

  const handleSendToImageLab = (): void => {
    if (!task || selectedAssets.length === 0) {
      window.alert('请先勾选至少一张结果图，再送入链路。')
      return
    }
    setMaterialImport(
      selectedAssets.map((asset) => asset.filePath),
      'aiStudio'
    )
    setActiveModule('material')
    addLog(
      `[AI Studio] 已送入 ImageLab：${selectedAssets.length} 张结果，任务 ${task.productName || task.id}`
    )
  }

  const handleRetry = async (): Promise<void> => {
    if (!task || isRetrying) return
    setIsRetrying(true)
    try {
      const result = await window.api.cms.aiStudio.task.retryRun({ taskId: task.id })
      await state.refresh()
      addLog(
        result.completed
          ? `[AI Studio] 重生成完成：${result.outputs.length} 张，任务 ${task.productName || task.id}`
          : `[AI Studio] 已重生成并提交新任务：${result.remoteTaskId ?? '待返回'}，任务 ${task.productName || task.id}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 重生成失败：${message}`)
      window.alert(message)
    } finally {
      setIsRetrying(false)
    }
  }

  const handleDiscard = async (): Promise<void> => {
    if (!task || selectedAssets.length === 0) {
      window.alert('请先勾选要丢弃的结果图。')
      return
    }
    await state.setOutputSelection(
      selectedAssets.map((asset) => asset.id),
      false,
      false
    )
    addLog(
      `[AI Studio] 已丢弃当前选择：${selectedAssets.length} 张，任务 ${task.productName || task.id}`
    )
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 p-8 text-sm text-zinc-500">
        添加主图后，结果区会在这里显示生成内容
      </div>
    )
  }

  if (outputAssets.length === 0) {
    return (
      <div className="flex h-full flex-col gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
                Current Task
              </div>
              <div className="mt-2 text-lg font-medium text-zinc-100">
                {task.productName || '未命名任务'}
              </div>
            </div>
            <div className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">
              {task.costLabel}
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-black/20 p-8 text-center">
          <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 text-zinc-300">
            <ImageIcon className="h-6 w-6" />
          </div>
          <div className="text-base text-zinc-200">
            {task.status === 'running' ? '结果生成中…' : '等待生成结果'}
          </div>
          <div className="mt-2 max-w-md text-sm text-zinc-500">
            {task.remoteTaskId
              ? `远端任务 ID：${task.remoteTaskId}`
              : '设置好主图与可选参考图后，候选图会在这里以大图 + 缩略网格的方式呈现。'}
          </div>
        </div>
      </div>
    )
  }

  const heroSrc = resolveLocalImage(
    heroAsset?.previewPath ?? heroAsset?.filePath ?? '',
    workspacePath
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              Current Task
            </div>
            <div className="mt-2 text-lg font-medium text-zinc-100">
              {task.productName || '未命名任务'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <div className="rounded-full border border-zinc-800 px-3 py-1">{task.costLabel}</div>
            <div className="rounded-full border border-zinc-800 px-3 py-1">
              候选 {outputAssets.length}
            </div>
            <div className="rounded-full border border-zinc-800 px-3 py-1">
              已选 {selectedAssets.length}
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="flex min-h-0 flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="relative flex-1 overflow-hidden rounded-[28px] border border-zinc-800 bg-zinc-950">
            {heroSrc ? (
              <img
                src={heroSrc}
                alt={basename(heroAsset?.filePath)}
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black/20 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate text-zinc-200">{basename(heroAsset?.filePath)}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {task.remoteTaskId ? `远端任务：${task.remoteTaskId}` : '当前任务未绑定远端任务 ID'}
              </div>
            </div>
            <div className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">
              {heroAsset?.selected ? '已保留' : '待筛选'}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-1 2xl:grid-cols-2">
            {outputAssets.map((asset) => (
              <PreviewCandidate
                key={asset.id}
                asset={asset}
                active={asset.selected}
                onClick={() => {
                  setHeroAssetId(asset.id)
                  void state.toggleOutputSelection(asset.id)
                }}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/75 p-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleKeep()}
              disabled={retainedAssets.length === 0}
            >
              <CheckCircle2 className="h-4 w-4" />
              保留
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSendToImageLab}
              disabled={selectedAssets.length === 0}
            >
              <Send className="h-4 w-4" />
              送入链路
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
            >
              <RefreshCcw className={cn('h-4 w-4', isRetrying && 'animate-spin')} />
              {isRetrying ? '重生成中...' : '重生成'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleDiscard()}
              disabled={selectedAssets.length === 0}
            >
              <Trash2 className="h-4 w-4" />
              丢弃
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { ResultPanel }
