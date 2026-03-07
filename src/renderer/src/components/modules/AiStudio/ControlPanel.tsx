import { useEffect, useState } from 'react'
import type * as React from 'react'

import { CopyPlus, ImagePlus, Plus, Save, Wand2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import {
  CUSTOM_GRSAI_MODEL_SENTINEL,
  DEFAULT_GRSAI_IMAGE_MODEL,
  GRSAI_MODEL_OPTIONS,
  isKnownGrsaiModel,
  normalizeGrsaiModelValue,
  resolveDisplayedGrsaiModel
} from '@renderer/lib/grsaiModels'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import type { AiStudioAssetRecord, UseAiStudioStateResult } from './useAiStudioState'

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未设置'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
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
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset?.previewPath ?? asset?.filePath ?? '', workspacePath)
  const clickable = typeof onClick === 'function'

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(event) => {
          if (!clickable) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick?.()
          }
        }}
        className={cn(
          'relative aspect-[3/4] overflow-hidden rounded-2xl border bg-zinc-950',
          clickable &&
            'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
          active ? 'border-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.18)]' : 'border-zinc-800'
        )}
      >
        {src ? (
          <img
            src={src}
            alt={basename(asset?.filePath)}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        ) : null}
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
    </div>
  )
}

function ControlPanel({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const task = state.activeTask
  const addLog = useCmsStore((store) => store.addLog)
  const aiConfig = useCmsStore((store) => store.config)
  const [isStartingRun, setIsStartingRun] = useState(false)
  const [isSavingTemplate, setIsSavingTemplate] = useState(false)
  const [isCustomModel, setIsCustomModel] = useState(false)
  const [templateNameDraft, setTemplateNameDraft] = useState('')
  const [templatePromptDraft, setTemplatePromptDraft] = useState('')

  useEffect(() => {
    const normalized = normalizeGrsaiModelValue(task?.model)
    setIsCustomModel(Boolean(normalized) && !isKnownGrsaiModel(normalized))
  }, [task?.id, task?.model])

  useEffect(() => {
    setTemplateNameDraft(state.selectedTemplate?.name ?? '')
    setTemplatePromptDraft(state.selectedTemplate?.promptText ?? '')
  }, [state.selectedTemplate?.id, state.selectedTemplate?.updatedAt, task?.templateId])

  const handleSaveTemplate = async (mode: 'save' | 'saveAs'): Promise<void> => {
    const trimmedName = templateNameDraft.trim()
    const trimmedPrompt = templatePromptDraft.trim()
    if (!trimmedName) {
      window.alert('请先填写模板名称。')
      return
    }
    if (!trimmedPrompt) {
      window.alert('请先填写主提示词。')
      return
    }

    try {
      setIsSavingTemplate(true)
      const saved = await state.saveTemplate({
        templateId: mode === 'save' ? (state.selectedTemplate?.id ?? null) : null,
        name: trimmedName,
        promptText: trimmedPrompt
      })
      setTemplateNameDraft(saved.name)
      setTemplatePromptDraft(saved.promptText)
      addLog(
        `[AI Studio] 模板已${mode === 'save' && state.selectedTemplate ? '保存' : '创建'}：${saved.name}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 模板保存失败：${message}`)
      window.alert(message)
    } finally {
      setIsSavingTemplate(false)
    }
  }

  const handleCreateNewTemplate = async (): Promise<void> => {
    await state.setTemplateId('')
    setTemplateNameDraft('')
    setTemplatePromptDraft('')
    addLog('[AI Studio] 已切换到新建模板草稿')
  }

  const handleStartRun = async (): Promise<void> => {
    if (!task || isStartingRun) return
    if (!aiConfig.aiApiKey.trim()) {
      const message = '请先在 Settings > AI服务 中填写 API Key。'
      addLog(`[AI Studio] ${message}`)
      window.alert(message)
      return
    }
    if (!state.selectedTemplate?.promptText.trim()) {
      const message = '请先保存一份包含主提示词的模板。'
      addLog(`[AI Studio] ${message}`)
      window.alert(message)
      return
    }
    if (isTemplateDirty) {
      const message = '模板主提示词有未保存修改，请先保存或另存为。'
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
        aiDefaultImageModel: aiConfig.aiDefaultImageModel,
        aiEndpointPath: aiConfig.aiEndpointPath,
        aiProviderProfiles: aiConfig.aiProviderProfiles
      })
      addLog(`[AI Studio] 开始提交生成：${task.productName || task.id}`)
      const result = await window.api.cms.aiStudio.task.startRun({ taskId: task.id })
      await state.refresh()

      if (result.completed) {
        const message = `生成完成：共落盘 ${result.outputs.length} 张，任务 ${result.remoteTaskId ?? '已完成'}`
        addLog(`[AI Studio] ${message}`)
        window.alert(message)
      } else {
        const providerLabel = (task.provider || aiConfig.aiProvider || 'AI 服务').trim() || 'AI 服务'
        const message = `已提交到 ${providerLabel}，远端任务 ID：${result.remoteTaskId ?? '待返回'}。可继续在结果区查看后续状态。`
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
        先添加主图，再继续配置参数
      </div>
    )
  }

  const primaryAsset =
    state.activeInputAssets.find((asset) => asset.filePath === state.primaryImagePath) ?? null
  const referenceAssets = state.activeInputAssets.filter((asset) =>
    state.referenceImagePaths.includes(asset.filePath)
  )
  const templateValue = state.selectedTemplate?.id ?? ''
  const configuredModel = normalizeGrsaiModelValue(task.model)
  const inheritedModel = resolveDisplayedGrsaiModel(
    aiConfig.aiDefaultImageModel,
    DEFAULT_GRSAI_IMAGE_MODEL
  )
  const selectedPresetModel = isKnownGrsaiModel(configuredModel) ? configuredModel : inheritedModel
  const customModelValue = isCustomModel ? configuredModel : ''
  const trimmedTemplateName = templateNameDraft.trim()
  const trimmedTemplatePrompt = templatePromptDraft.trim()
  const savedTemplateName = state.selectedTemplate?.name.trim() ?? ''
  const savedTemplatePrompt = state.selectedTemplate?.promptText.trim() ?? ''
  const isTemplateDirty =
    trimmedTemplateName !== savedTemplateName || trimmedTemplatePrompt !== savedTemplatePrompt
  const canSaveTemplate = Boolean(trimmedTemplateName && trimmedTemplatePrompt) && !isSavingTemplate
  const hasSavedMainPrompt = Boolean(state.selectedTemplate?.promptText.trim())

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="flex flex-col gap-1 sm:col-span-2 xl:col-span-1 2xl:col-span-2">
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">模板</span>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <select
              value={templateValue}
              onChange={(event) => void state.setTemplateId(event.target.value)}
              className="h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
            >
              <option value="">未选择模板</option>
              {state.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" onClick={() => void handleCreateNewTemplate()}>
              <Plus className="h-4 w-4" />
              新建模板
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canSaveTemplate}
              onClick={() => void handleSaveTemplate('save')}
            >
              <Save className="h-4 w-4" />
              {isSavingTemplate ? '保存中...' : '保存'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canSaveTemplate}
              onClick={() => void handleSaveTemplate('saveAs')}
            >
              <CopyPlus className="h-4 w-4" />
              另存为
            </Button>
          </div>
          <div className="text-[11px] text-zinc-500">
            {state.selectedTemplate
              ? isTemplateDirty
                ? '当前模板有未保存修改，生成前请先保存或另存为。'
                : `当前模板：${state.selectedTemplate.name}`
              : '当前未选择模板，请先新建模板并保存主提示词。'}
          </div>
        </div>

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

        <label className="flex flex-col gap-1 sm:col-span-2 xl:col-span-1 2xl:col-span-2">
          <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">模型</span>
          <select
            value={isCustomModel ? CUSTOM_GRSAI_MODEL_SENTINEL : selectedPresetModel}
            onChange={(event) => {
              const nextValue = event.target.value
              if (nextValue === CUSTOM_GRSAI_MODEL_SENTINEL) {
                setIsCustomModel(true)
                void state.setModel(isKnownGrsaiModel(configuredModel) ? '' : configuredModel)
                return
              }
              setIsCustomModel(false)
              void state.setModel(nextValue)
            }}
            className="h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
          >
            {GRSAI_MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={CUSTOM_GRSAI_MODEL_SENTINEL}>自定义模型…</option>
          </select>
          {!isCustomModel ? (
            <div className="text-[11px] text-zinc-500">
              {configuredModel
                ? `当前任务固定使用：${selectedPresetModel}`
                : `未单独指定，当前继承默认模型：${inheritedModel}`}
            </div>
          ) : (
            <>
              <Input
                value={customModelValue}
                onChange={(event) => void state.setModel(event.target.value)}
                placeholder="输入文档里的完整模型名"
                spellCheck={false}
              />
              <div className="text-[11px] text-amber-300/80">
                自定义模式：请粘贴 GRSAI 文档中的完整模型名。
              </div>
            </>
          )}
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">模板名称</span>
        <Input
          value={templateNameDraft}
          onChange={(event) => setTemplateNameDraft(event.target.value)}
          placeholder="例如：电商女装镜前生活感"
          spellCheck={false}
        />
      </label>

      <label className="flex min-h-0 flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">主提示词</span>
        <textarea
          value={templatePromptDraft}
          onChange={(event) => setTemplatePromptDraft(event.target.value)}
          className="min-h-[112px] rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-500"
          placeholder="描述主体、构图、光线、镜头语言与整体气质，这部分会保存到模板。"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-2 text-xs text-zinc-500">主图</div>
          <PreviewTile asset={primaryAsset} badge="Primary" active={Boolean(primaryAsset)} />
        </div>
        <div>
          <div className="mb-2 text-xs text-zinc-500">参考</div>
          <div className="grid grid-cols-2 gap-2">
            {referenceAssets.length > 0 ? (
              referenceAssets
                .slice(0, 4)
                .map((asset) => <PreviewTile key={asset.id} asset={asset} badge="Ref" active />)
            ) : (
              <div className="col-span-2 flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 text-xs text-zinc-500">
                未设置
              </div>
            )}
          </div>
        </div>
      </div>

      <label className="flex min-h-0 flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">附加要求</span>
        <textarea
          value={task.promptExtra}
          onChange={(event) => void state.setPromptExtra(event.target.value)}
          className="min-h-[96px] rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-100 outline-none ring-0 transition focus:border-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-500"
          placeholder="补充本次任务的限制、场景、质感，不会写回模板。"
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
              先在左侧添加主图 / 参考图
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-auto space-y-2">
        {!aiConfig.aiApiKey.trim() ? (
          <div className="text-xs text-amber-400">请先在 Settings &gt; AI服务 中填写 API Key。</div>
        ) : null}
        {!task.primaryImagePath ? (
          <div className="text-xs text-zinc-500">主图未设置，暂时无法开始生成。</div>
        ) : null}
        {!hasSavedMainPrompt ? (
          <div className="text-xs text-zinc-500">请先保存一份包含主提示词的模板。</div>
        ) : null}
        {isTemplateDirty ? (
          <div className="text-xs text-amber-400">模板内容有未保存修改，请先保存或另存为。</div>
        ) : null}
        <Button
          type="button"
          className="h-11 w-full rounded-xl bg-zinc-50 text-zinc-950 hover:bg-white"
          disabled={
            !task.primaryImagePath ||
            !aiConfig.aiApiKey.trim() ||
            !hasSavedMainPrompt ||
            isTemplateDirty ||
            isStartingRun
          }
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
