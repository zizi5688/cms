import { useState } from 'react'
import type * as React from 'react'

import { ImagePlus, Wand2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import type { AiStudioAssetRecord, UseAiStudioStateResult } from './useAiStudioState'

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未设置'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function toFileSrc(filePath: string | null | undefined): string | undefined {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return undefined
  return encodeURI(normalized.startsWith('file://') ? normalized : `file://${normalized}`)
}

function PreviewTile({
  asset,
  active,
  badge,
  onClick,
  footer
}: {
  asset: AiStudioAssetRecord | null
  active?: boolean
  badge?: string
  onClick?: () => void
  footer?: React.ReactNode
}): React.JSX.Element {
  const src = toFileSrc(asset?.previewPath ?? asset?.filePath)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full flex-col gap-2 text-left',
        !onClick && 'cursor-default'
      )}
    >
      <div
        className={cn(
          'relative aspect-[3/4] overflow-hidden rounded-2xl border bg-zinc-950',
          active ? 'border-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.18)]' : 'border-zinc-800'
        )}
      >
        <div
          className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black bg-cover bg-center"
          style={src ? { backgroundImage: `url(${src})` } : undefined}
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.46))]" />
        {badge ? (
          <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/35 px-2 py-1 text-[10px] text-zinc-100 backdrop-blur">
            {badge}
          </div>
        ) : null}
        <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-100 backdrop-blur">
          {basename(asset?.filePath)}
        </div>
      </div>
      {footer}
    </button>
  )
}

function ControlPanel({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const task = state.activeTask
  const addLog = useCmsStore((store) => store.addLog)
  const aiConfig = useCmsStore((store) => store.config)
  const [isStartingRun, setIsStartingRun] = useState(false)

  const handleStartRun = async (): Promise<void> => {
    if (!task || isStartingRun) return
    if (!aiConfig.aiApiKey.trim()) {
      const message = '请先在 Settings > AI服务 中填写 API Key。'
      addLog(`[AI Studio] ${message}`)
      window.alert(message)
      return
    }

    setIsStartingRun(true)
    try {
      await window.electronAPI.saveConfig({
        aiProvider: aiConfig.aiProvider,
        aiBaseUrl: aiConfig.aiBaseUrl,
        aiApiKey: aiConfig.aiApiKey,
        aiDefaultImageModel: aiConfig.aiDefaultImageModel
      })
      addLog(`[AI Studio] 开始提交生成：${task.productName || task.id}`)
      const result = await window.api.cms.aiStudio.task.startRun({ taskId: task.id })
      await state.refresh()

      if (result.completed) {
        const message = `生成完成：共落盘 ${result.outputs.length} 张，任务 ${result.remoteTaskId ?? '已完成'}`
        addLog(`[AI Studio] ${message}`)
        window.alert(message)
      } else {
        const message = `已提交到 GRSAI，远端任务 ID：${result.remoteTaskId ?? '待返回'}。可继续在结果区查看后续状态。`
        addLog(`[AI Studio] ${message}`)
        window.alert(message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 提交失败：${message}`)
      window.alert(message)
      await state.refresh()
    } finally {
      setIsStartingRun(false)
    }
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-sm text-zinc-500">
        导入后开始编辑
      </div>
    )
  }

  const primaryAsset = state.activeInputAssets.find((asset) => asset.filePath === state.primaryImagePath) ?? null
  const referenceAssets = state.activeInputAssets.filter((asset) => state.referenceImagePaths.includes(asset.filePath))
  const templateValue = task.templateId || state.templates[0]?.id || ''
  const modelValue = task.model || 'image-default'

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">模板</span>
          <select
            value={templateValue}
            onChange={(event) => void state.setTemplateId(event.target.value)}
            className="h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            {state.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">比例</span>
          <select
            value={task.aspectRatio || '3:4'}
            onChange={(event) => void state.setAspectRatio(event.target.value)}
            className="h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            <option value="3:4">3:4</option>
            <option value="1:1">1:1</option>
            <option value="9:16">9:16</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">数量</span>
          <Input
            type="number"
            min={1}
            value={String(task.outputCount || 1)}
            onChange={(event) => void state.setOutputCount(Number(event.target.value) || 1)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">模型</span>
          <Input value={modelValue} onChange={(event) => void state.setModel(event.target.value)} placeholder="image-default" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-2 text-xs text-zinc-500">主图</div>
          <PreviewTile asset={primaryAsset} badge="Primary" active={Boolean(primaryAsset)} />
        </div>
        <div>
          <div className="mb-2 text-xs text-zinc-500">参考</div>
          <div className="grid grid-cols-2 gap-2">
            {referenceAssets.length > 0 ? (
              referenceAssets.slice(0, 4).map((asset) => <PreviewTile key={asset.id} asset={asset} badge="Ref" active />)
            ) : (
              <div className="col-span-2 flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 text-xs text-zinc-500">
                未设置
              </div>
            )}
          </div>
        </div>
      </div>

      <label className="flex min-h-0 flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">要求</span>
        <textarea
          value={task.promptExtra}
          onChange={(event) => void state.setPromptExtra(event.target.value)}
          className="min-h-[96px] rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-500"
          placeholder="补充限制、场景、质感"
        />
      </label>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">图库</div>
        <div className="grid max-h-[260px] grid-cols-2 gap-3 overflow-y-auto pr-1 2xl:grid-cols-3">
          {state.activeInputAssets.map((asset) => {
            const isPrimary = state.primaryImagePath === asset.filePath
            const isReference = state.referenceImagePaths.includes(asset.filePath)
            return (
              <PreviewTile
                key={asset.id}
                asset={asset}
                active={isPrimary || isReference}
                onClick={() => void state.assignPrimaryImage(asset.filePath)}
                footer={
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className={cn(isPrimary ? 'bg-zinc-50 text-zinc-950 hover:bg-white' : '')}
                      variant={isPrimary ? 'default' : 'outline'}
                      onClick={(event) => {
                        event.stopPropagation()
                        void state.assignPrimaryImage(isPrimary ? null : asset.filePath)
                      }}
                    >
                      主图
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={isReference ? 'default' : 'outline'}
                      className={cn(isReference ? 'bg-zinc-50 text-zinc-950 hover:bg-white' : '')}
                      onClick={(event) => {
                        event.stopPropagation()
                        void state.toggleReferenceImage(asset.filePath)
                      }}
                    >
                      参考
                    </Button>
                  </div>
                }
              />
            )
          })}

          {state.activeInputAssets.length === 0 ? (
            <div className="col-span-2 flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 text-xs text-zinc-500 2xl:col-span-3">
              <ImagePlus className="mr-2 h-4 w-4" />
              暂无素材
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-auto space-y-2">
        {!aiConfig.aiApiKey.trim() ? (
          <div className="text-xs text-amber-400">请先在 Settings &gt; AI服务 中填写 API Key。</div>
        ) : null}
        <Button
          type="button"
          className="h-11 w-full rounded-xl bg-zinc-50 text-zinc-950 hover:bg-white"
          disabled={!task.primaryImagePath || !aiConfig.aiApiKey.trim() || isStartingRun}
          onClick={() => void handleStartRun()}
        >
          <Wand2 className="h-4 w-4" />
          {isStartingRun ? '生成中...' : '开始生成'}
        </Button>
      </div>
    </div>
  )
}

export { ControlPanel }
