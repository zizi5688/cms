import { useEffect, useState } from 'react'
import type * as React from 'react'

import { ArrowUp, Send, Trash2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { DEFAULT_GRSAI_IMAGE_MODEL } from '@renderer/lib/grsaiModels'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import type { AiStudioAssetRecord, UseAiStudioStateResult } from './useAiStudioState'

const MODEL_DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  'gemini-3.1-flash-image-preview': 'Nano banana2'
}

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未命名文件'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function formatModelDisplayLabel(modelName: string, providerName: string): string {
  const normalizedModelName = String(modelName ?? '').trim()
  const normalizedProviderName = String(providerName ?? '').trim()
  const modelLabel =
    MODEL_DISPLAY_NAME_OVERRIDES[normalizedModelName] ?? normalizedModelName ?? '未配置模型'

  if (!normalizedProviderName) return modelLabel || '未配置模型'
  return `${modelLabel || '未配置模型'} - ${normalizedProviderName}`
}

function PoolPreviewThumb({
  asset,
  onRemove
}: {
  asset: AiStudioAssetRecord
  onRemove: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)

  return (
    <div className="group/thumb-item relative shrink-0 overflow-hidden rounded-[14px] border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300">
      <div className="h-[74px] w-[56px] overflow-hidden bg-zinc-100">
        {src ? (
          <img
            src={src}
            alt={basename(asset.filePath)}
            className="h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove(asset)
        }}
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-white text-zinc-700 opacity-0 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-950 group-hover/thumb-item:opacity-100"
        aria-label="移出图池"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function ControlPanel({
  state,
  promptDraft
}: {
  state: UseAiStudioStateResult
  promptDraft: string
}): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const configuredProvider = useCmsStore((store) => store.config.aiProvider)
  const configuredDefaultModel = useCmsStore((store) => store.config.aiDefaultImageModel)
  const task = state.activeTask
  const currentModel =
    String(configuredDefaultModel ?? '').trim() ||
    String(task?.model ?? '').trim() ||
    DEFAULT_GRSAI_IMAGE_MODEL
  const currentModelDisplayLabel = formatModelDisplayLabel(
    currentModel,
    String(configuredProvider ?? '').trim() || String(task?.provider ?? '').trim()
  )
  const requestedCount = Math.max(1, state.masterOutputCount || 1)
  const isRunning = task?.status === 'running'
  const isInterrupting = task ? state.interruptingTaskIds.includes(task.id) : false
  const actionLabel = isRunning ? (isInterrupting ? '中断中...' : '中断任务') : '开始生成'

  const [outputCountDraft, setOutputCountDraft] = useState(String(requestedCount))

  useEffect(() => {
    setOutputCountDraft(String(requestedCount))
  }, [requestedCount, task?.id])

  const handleGenerate = async (): Promise<void> => {
    try {
      if (!state.primaryImagePath) {
        throw new Error('请先添加参考图。')
      }

      const promptText = promptDraft.trim()
      if (!promptText) {
        throw new Error('请先输入提示词。')
      }
      const normalizedRequestedCount = Math.max(1, Math.floor(Number(outputCountDraft) || 1))
      await state.startMasterWorkflow({
        taskId: task?.id ?? null,
        promptText,
        model: currentModel,
        requestedCount: normalizedRequestedCount,
        templateId: null
      })
      addLog('[AI Studio] 已启动生成任务')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 生成失败：${message}`)
      window.alert(message)
    }
  }

  const handleSendPool = async (): Promise<void> => {
    try {
      await state.sendPooledOutputsToWorkshop()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 发送图池失败：${message}`)
      window.alert(message)
    }
  }

  const actionButtonClass =
    'relative h-10 shrink-0 rounded-full border border-zinc-950 bg-white px-4 text-[13px] font-medium text-zinc-950 shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:bg-zinc-50 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400'

  return (
    <>
      <div className="relative z-30 flex min-w-0 items-end gap-2 overflow-visible pb-1">
        <label className="flex w-[120px] min-w-[120px] shrink-0 flex-col gap-1.5">
          <span className="text-[10px] font-medium tracking-[0.12em] text-zinc-400">模型</span>
          <select
            value={currentModel}
            onChange={(event) => void state.setModel(event.target.value)}
            className="h-9 rounded-full border border-zinc-200 bg-zinc-50 px-3 text-[13px] text-zinc-900 outline-none transition focus:border-sky-400"
            disabled={!task}
          >
            <option value={currentModel}>{currentModelDisplayLabel}</option>
          </select>
        </label>

        <label className="flex w-[84px] min-w-[84px] shrink-0 flex-col gap-1.5">
          <span className="text-[10px] font-medium tracking-[0.12em] text-zinc-400">输出张数</span>
          <input
            type="number"
            min={1}
            step={1}
            value={outputCountDraft}
            onChange={(event) => {
              const rawValue = event.target.value
              setOutputCountDraft(rawValue)
              void state.setMasterOutputCount(Math.max(1, Math.floor(Number(rawValue) || 1)))
            }}
            onBlur={() => {
              const normalizedValue = Math.max(1, Math.floor(Number(outputCountDraft) || 1))
              setOutputCountDraft(String(normalizedValue))
            }}
            className="h-9 rounded-full border border-zinc-200 bg-zinc-50 px-3 text-[13px] text-zinc-900 outline-none transition focus:border-sky-400"
            disabled={!task}
          />
        </label>


        <div className="flex shrink-0 items-center justify-end self-end gap-2">
          <div className="group/pool relative z-[120] shrink-0">
            {state.pooledOutputCount > 0 ? (
              <div className="pointer-events-none absolute bottom-full right-0 z-[140] mb-1 translate-y-1 opacity-0 transition duration-150 group-hover/pool:pointer-events-auto group-hover/pool:translate-y-0 group-hover/pool:opacity-100 group-focus-within/pool:pointer-events-auto group-focus-within/pool:translate-y-0 group-focus-within/pool:opacity-100">
                <div className="rounded-[22px] border border-zinc-200 bg-white p-3 shadow-[0_22px_48px_rgba(15,23,42,0.16)]">
                  <div className="flex w-[282px] gap-2 overflow-x-auto pb-1">
                    {state.pooledOutputAssets.map((asset) => (
                      <PoolPreviewThumb
                        key={asset.id}
                        asset={asset}
                        onRemove={(targetAsset) =>
                          void state.toggleDispatchOutputPoolForTask(targetAsset.taskId, targetAsset.id)
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            <Button
              type="button"
              className={cn(actionButtonClass, 'gap-1.5')}
              onClick={() => void handleSendPool()}
              disabled={state.pooledOutputCount <= 0}
            >
              <Send className="h-4 w-4" />
              发送图池
              {state.pooledOutputCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-zinc-950 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                  {state.pooledOutputCount}
                </span>
              ) : null}
            </Button>
          </div>

          <Button
            type="button"
            className={cn(actionButtonClass, 'gap-1.5')}
            onClick={() => {
              if (isRunning) {
                void state.interruptActiveTask()
                return
              }
              void handleGenerate()
            }}
            disabled={isInterrupting}
          >
            <ArrowUp className="h-4 w-4" />
            {actionLabel}
          </Button>
        </div>
      </div>
    </>
  )
}

export { ControlPanel }
