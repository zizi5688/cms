import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'

import { CopyPlus, Play, Save, Send, Sparkles } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
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

import type { AiStudioTemplateRecord, UseAiStudioStateResult } from './useAiStudioState'

function StatusPill({ label, active = false }: { label: string; active?: boolean }): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-full border px-3 py-1 text-[11px] tracking-[0.18em] uppercase',
        active
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-zinc-800 bg-zinc-950/80 text-zinc-500'
      )}
    >
      {label}
    </div>
  )
}

function FieldLabel({ title, hint }: { title: string; hint?: string }): React.JSX.Element {
  return (
    <div className="flex items-end justify-between gap-3">
      <label className="text-sm font-medium text-zinc-100">{title}</label>
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </div>
  )
}

function SectionBlock({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/65 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{eyebrow}</div>
          <div className="mt-2 text-base font-medium text-zinc-50">{title}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  )
}

function TemplateEditor({
  stageLabel,
  templates,
  selectedTemplate,
  selectedTemplateId,
  templateNameDraft,
  templatePromptDraft,
  dirty,
  saving,
  onSelectTemplate,
  onCreateDraft,
  onChangeTemplateName,
  onChangeTemplatePrompt,
  onSave,
  onSaveAs
}: {
  stageLabel: string
  templates: AiStudioTemplateRecord[]
  selectedTemplate: AiStudioTemplateRecord | null
  selectedTemplateId: string
  templateNameDraft: string
  templatePromptDraft: string
  dirty: boolean
  saving: boolean
  onSelectTemplate: (value: string) => Promise<void>
  onCreateDraft: () => Promise<void>
  onChangeTemplateName: (value: string) => void
  onChangeTemplatePrompt: (value: string) => void
  onSave: () => Promise<void>
  onSaveAs: () => Promise<void>
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-zinc-100">{stageLabel}模板</div>
          <div className="mt-1 text-xs text-zinc-500">
            不保留系统模板，只使用你自己的模板库。
          </div>
        </div>
        <div
          className={cn(
            'rounded-full border px-3 py-1 text-[11px]',
            dirty
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-zinc-800 bg-zinc-950/80 text-zinc-500'
          )}
        >
          {dirty ? '未保存修改' : '已同步'}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={selectedTemplateId}
          onChange={(event) => void onSelectTemplate(event.target.value)}
          className="h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
        >
          <option value="">选择已保存模板</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={() => void onCreateDraft()}>
          <CopyPlus className="h-4 w-4" />
          新建草稿
        </Button>
      </div>

      <Input
        value={templateNameDraft}
        onChange={(event) => onChangeTemplateName(event.target.value)}
        placeholder={`${stageLabel}模板名称`}
      />

      <Textarea
        value={templatePromptDraft}
        onChange={(event) => onChangeTemplatePrompt(event.target.value)}
        placeholder={`填写${stageLabel}阶段的模板主提示词`}
        className="min-h-[140px]"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => void onSave()} disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? '保存中...' : selectedTemplate ? '保存模板' : '保存为模板'}
        </Button>
        <Button type="button" variant="outline" onClick={() => void onSaveAs()} disabled={saving}>
          <CopyPlus className="h-4 w-4" />
          另存为新模板
        </Button>
      </div>
    </div>
  )
}

function PresetButton({
  active,
  label,
  onClick
}: {
  active?: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm transition',
        active
          ? 'border-zinc-100 bg-zinc-100 text-zinc-950'
          : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
      )}
    >
      {label}
    </button>
  )
}

function trimText(value: string): string {
  return value.trim()
}

function isTemplateDirty(
  selectedTemplate: AiStudioTemplateRecord | null,
  draftName: string,
  draftPrompt: string
): boolean {
  const normalizedName = trimText(draftName)
  const normalizedPrompt = trimText(draftPrompt)
  if (!selectedTemplate) {
    return Boolean(normalizedName || normalizedPrompt)
  }
  return (
    normalizedName !== trimText(selectedTemplate.name) ||
    normalizedPrompt !== trimText(selectedTemplate.promptText)
  )
}

function ControlPanel({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const task = state.activeTask
  const addLog = useCmsStore((store) => store.addLog)
  const aiConfig = useCmsStore((store) => store.config)
  const [isCustomModel, setIsCustomModel] = useState(false)
  const [masterTemplateNameDraft, setMasterTemplateNameDraft] = useState('')
  const [masterTemplatePromptDraft, setMasterTemplatePromptDraft] = useState('')
  const [childTemplateNameDraft, setChildTemplateNameDraft] = useState('')
  const [childTemplatePromptDraft, setChildTemplatePromptDraft] = useState('')
  const [savingStage, setSavingStage] = useState<'master' | 'child' | null>(null)
  const [runningStage, setRunningStage] = useState<'master' | 'child' | null>(null)

  useEffect(() => {
    const normalized = normalizeGrsaiModelValue(task?.model)
    setIsCustomModel(Boolean(normalized) && !isKnownGrsaiModel(normalized))
  }, [task?.id, task?.model])

  useEffect(() => {
    setMasterTemplateNameDraft(state.selectedMasterTemplate?.name ?? '')
    setMasterTemplatePromptDraft(state.selectedMasterTemplate?.promptText ?? '')
  }, [state.selectedMasterTemplate?.id, state.selectedMasterTemplate?.updatedAt])

  useEffect(() => {
    setChildTemplateNameDraft(state.selectedChildTemplate?.name ?? '')
    setChildTemplatePromptDraft(state.selectedChildTemplate?.promptText ?? '')
  }, [state.selectedChildTemplate?.id, state.selectedChildTemplate?.updatedAt])

  const displayedModel = useMemo(
    () =>
      resolveDisplayedGrsaiModel(
        task?.model,
        aiConfig.aiDefaultImageModel || DEFAULT_GRSAI_IMAGE_MODEL
      ),
    [aiConfig.aiDefaultImageModel, task?.model]
  )

  const masterTemplateDirty = useMemo(
    () => isTemplateDirty(state.selectedMasterTemplate, masterTemplateNameDraft, masterTemplatePromptDraft),
    [childTemplateNameDraft, childTemplatePromptDraft, masterTemplateNameDraft, masterTemplatePromptDraft, state.selectedMasterTemplate]
  )

  const childTemplateDirty = useMemo(
    () => isTemplateDirty(state.selectedChildTemplate, childTemplateNameDraft, childTemplatePromptDraft),
    [childTemplateNameDraft, childTemplatePromptDraft, state.selectedChildTemplate]
  )

  const hasApiKey = Boolean(aiConfig.aiApiKey.trim())
  const hasWatermarkRuntime = Boolean(aiConfig.pythonPath.trim() && aiConfig.watermarkScriptPath.trim())
  const variantText = state.variantLines.join('\n')
  const variantCount = state.variantLines.filter((line) => line.trim()).length
  const progressPercent =
    state.stageProgress.totalPlanned > 0
      ? Math.min(100, Math.round((state.stageProgress.totalCompleted / state.stageProgress.totalPlanned) * 100))
      : 0
  const isDev = Boolean(import.meta.env.DEV)
  const selectedChildCount = state.activeSelectedChildOutputAssets.length

  const handleSaveStageTemplate = async (
    stage: 'master' | 'child',
    mode: 'save' | 'saveAs'
  ): Promise<void> => {
    const name = trimText(stage === 'master' ? masterTemplateNameDraft : childTemplateNameDraft)
    const promptText = trimText(stage === 'master' ? masterTemplatePromptDraft : childTemplatePromptDraft)
    if (!name) {
      window.alert('请先填写模板名称。')
      return
    }
    if (!promptText) {
      window.alert('请先填写模板主提示词。')
      return
    }

    try {
      setSavingStage(stage)
      const selectedTemplate = stage === 'master' ? state.selectedMasterTemplate : state.selectedChildTemplate
      const saved = await state.saveStageTemplate(stage, {
        templateId: mode === 'save' ? (selectedTemplate?.id ?? null) : null,
        name,
        promptText
      })
      addLog(`[AI Studio] ${stage === 'master' ? '母图' : '子图'}模板已保存：${saved.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 模板保存失败：${message}`)
      window.alert(message)
    } finally {
      setSavingStage(null)
    }
  }

  const handleCreateDraft = async (stage: 'master' | 'child'): Promise<void> => {
    if (stage === 'master') {
      await state.setMasterTemplateId('')
      setMasterTemplateNameDraft('')
      setMasterTemplatePromptDraft('')
    } else {
      await state.setChildTemplateId('')
      setChildTemplateNameDraft('')
      setChildTemplatePromptDraft('')
    }
    addLog(`[AI Studio] 已切换到${stage === 'master' ? '母图' : '子图'}新模板草稿`)
  }

  const handleStartMaster = async (): Promise<void> => {
    if (!task || runningStage) return
    if (masterTemplateDirty) {
      window.alert('母图模板有未保存修改，请先保存后再开始。')
      return
    }
    if (!state.selectedMasterTemplate?.promptText.trim()) {
      window.alert('请先保存并选择母图模板。')
      return
    }
    try {
      setRunningStage('master')
      await state.startMasterWorkflow()
      addLog('[AI Studio] 母图阶段已开始执行')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 母图阶段启动失败：${message}`)
      window.alert(message)
    } finally {
      setRunningStage(null)
    }
  }

  const handleStartChild = async (): Promise<void> => {
    if (!task || runningStage) return
    if (childTemplateDirty) {
      window.alert('子图模板有未保存修改，请先保存后再开始。')
      return
    }
    if (!state.selectedChildTemplate?.promptText.trim()) {
      window.alert('请先保存并选择子图模板。')
      return
    }
    try {
      setRunningStage('child')
      await state.startChildWorkflow()
      addLog('[AI Studio] 子图阶段已开始执行')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 子图阶段启动失败：${message}`)
      window.alert(message)
    } finally {
      setRunningStage(null)
    }
  }

  const handleSeedDemo = async (): Promise<void> => {
    try {
      await state.seedDemoTask()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 注入联调假数据失败：${message}`)
      window.alert(message)
    }
  }

  const handleSelectAllChildOutputs = async (): Promise<void> => {
    try {
      await state.selectAllChildOutputs()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 子图全选失败：${message}`)
      window.alert(message)
    }
  }

  const handleClearSelectedChildOutputs = async (): Promise<void> => {
    try {
      await state.clearSelectedChildOutputs()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 子图取消全选失败：${message}`)
      window.alert(message)
    }
  }

  const handleSendSelectedChildOutputs = async (): Promise<void> => {
    try {
      await state.sendSelectedChildOutputsToWorkshop()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 发送到数据工坊失败：${message}`)
      window.alert(message)
    }
  }

  if (!task) {
    return (
      <div className="flex h-full min-h-[420px] flex-col gap-4">
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/55 px-6 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-400">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="mt-4 text-base font-medium text-zinc-100">先放入主图和参考图</div>
          <div className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
            左侧导入素材后，这里会出现母图阶段、子图阶段、模板保存与进度控制。
          </div>
        </div>
        {isDev ? (
          <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/65 p-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Dev Only</div>
            <div className="mt-2 text-sm font-medium text-zinc-100">联调工具</div>
            <div className="mt-2 text-xs leading-5 text-zinc-500">
              注入一组正式 UI 假数据，用来验证子图多选与发送到数据工坊链路。
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void handleSeedDemo()}>
                注入假数据
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={hasApiKey ? 'API Key Ready' : 'API Key Missing'} active={hasApiKey} />
          <StatusPill label={hasWatermarkRuntime ? '去水印 Ready' : '去水印 Missing'} active={hasWatermarkRuntime} />
          <StatusPill label={`当前阶段 · ${state.stageProgress.currentLabel}`} active />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="text-xs text-zinc-500">模型 / 构图比例</div>
            <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_120px]">
              <select
                value={isCustomModel ? CUSTOM_GRSAI_MODEL_SENTINEL : displayedModel}
                onChange={(event) => {
                  const nextValue = event.target.value
                  if (nextValue === CUSTOM_GRSAI_MODEL_SENTINEL) {
                    setIsCustomModel(true)
                    return
                  }
                  setIsCustomModel(false)
                  void state.setModel(nextValue)
                }}
                className="h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
              >
                {GRSAI_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value={CUSTOM_GRSAI_MODEL_SENTINEL}>自定义模型…</option>
              </select>
              <select
                value={task.aspectRatio || '3:4'}
                onChange={(event) => void state.setAspectRatio(event.target.value)}
                className="h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
              >
                <option value="3:4">3:4</option>
                <option value="4:5">4:5</option>
                <option value="1:1">1:1</option>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
              </select>
            </div>
            {isCustomModel ? (
              <Input
                className="mt-3"
                value={normalizeGrsaiModelValue(task.model)}
                placeholder="输入自定义模型名称"
                onChange={(event) => void state.setModel(event.target.value)}
              />
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">整体进度</div>
                <div className="mt-1 text-sm text-zinc-100">
                  {state.stageProgress.totalCompleted} / {state.stageProgress.totalPlanned || 0}
                </div>
              </div>
              <div className="text-xs text-zinc-500">
                当前项 {state.stageProgress.currentIndex} / {state.stageProgress.currentTotal}
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-900">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#fafafa,#a1a1aa)] transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-400">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                母图成功 {state.workflowMeta?.masterStage.cleanSuccessCount ?? 0}
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                子图成功 {state.workflowMeta?.childStage.completedCount ?? 0}
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                失败记录 {state.failureRecords.length}
              </div>
            </div>
          </div>
        </div>
      </section>

      <SectionBlock
        eyebrow="Stage 1"
        title="母图设置"
        description="主图 + 可选参考图先生成多张 AI 母图。每张母图都会自动去水印，只有去印成功的结果才能设为当前 AI 母图。"
      >
        <TemplateEditor
          stageLabel="母图"
          templates={state.templates}
          selectedTemplate={state.selectedMasterTemplate}
          selectedTemplateId={state.selectedMasterTemplate?.id ?? ''}
          templateNameDraft={masterTemplateNameDraft}
          templatePromptDraft={masterTemplatePromptDraft}
          dirty={masterTemplateDirty}
          saving={savingStage === 'master'}
          onSelectTemplate={state.setMasterTemplateId}
          onCreateDraft={() => handleCreateDraft('master')}
          onChangeTemplateName={setMasterTemplateNameDraft}
          onChangeTemplatePrompt={setMasterTemplatePromptDraft}
          onSave={() => handleSaveStageTemplate('master', 'save')}
          onSaveAs={() => handleSaveStageTemplate('master', 'saveAs')}
        />

        <div className="grid gap-4 xl:grid-cols-[140px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <FieldLabel title="母图数量" />
            <Input
              type="number"
              min={1}
              step={1}
              value={state.masterOutputCount}
              onChange={(event) => void state.setMasterOutputCount(Number(event.target.value) || 1)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel title="本次追加说明" hint="可选，本次任务专用" />
            <Textarea
              value={state.masterPromptExtra}
              onChange={(event) => void state.setMasterPromptExtra(event.target.value)}
              placeholder="例如：先按特殊修改清单处理，再保留原图氛围、质感、空间关系。"
              className="min-h-[96px]"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div>
            <div className="text-sm font-medium text-zinc-100">开始生成 AI 母图</div>
            <div className="mt-1 text-xs leading-5 text-zinc-500">
              默认串行执行 {state.masterOutputCount} 次，并在每次结果落盘后立即自动去水印。
            </div>
          </div>
          <Button type="button" onClick={() => void handleStartMaster()} disabled={runningStage !== null}>
            <Play className="h-4 w-4" />
            {runningStage === 'master' ? '母图执行中...' : '开始生成AI母图'}
          </Button>
        </div>
      </SectionBlock>

      <SectionBlock
        eyebrow="Stage 2"
        title="子图设置"
        description="以“当前 AI 母图”作为首张参考图，串行生成子图。某张失败会记录错误并自动跳过，继续跑后面的任务。"
      >
        <TemplateEditor
          stageLabel="子图"
          templates={state.templates}
          selectedTemplate={state.selectedChildTemplate}
          selectedTemplateId={state.selectedChildTemplate?.id ?? ''}
          templateNameDraft={childTemplateNameDraft}
          templatePromptDraft={childTemplatePromptDraft}
          dirty={childTemplateDirty}
          saving={savingStage === 'child'}
          onSelectTemplate={state.setChildTemplateId}
          onCreateDraft={() => handleCreateDraft('child')}
          onChangeTemplateName={setChildTemplateNameDraft}
          onChangeTemplatePrompt={setChildTemplatePromptDraft}
          onSave={() => handleSaveStageTemplate('child', 'save')}
          onSaveAs={() => handleSaveStageTemplate('child', 'saveAs')}
        />

        <div className="grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <FieldLabel title="子图数量" />
            <div className="grid grid-cols-3 gap-2">
              {[4, 6, 9].map((count) => (
                <PresetButton
                  key={count}
                  label={String(count)}
                  active={state.childOutputCount === count}
                  onClick={() => void state.setChildOutputCount(count)}
                />
              ))}
            </div>
            <Input
              type="number"
              min={1}
              step={1}
              value={state.childOutputCount}
              onChange={(event) => void state.setChildOutputCount(Number(event.target.value) || 1)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <FieldLabel title="本次追加说明" hint="可选，本次任务专用" />
            <Textarea
              value={state.childPromptExtra}
              onChange={(event) => void state.setChildPromptExtra(event.target.value)}
              placeholder="例如：保持匿名感、不露脸、氛围感完全延续母图。"
              className="min-h-[96px]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel title="Variant 列表" hint={`${variantCount} / ${state.childOutputCount} 行`} />
          <Textarea
            value={variantText}
            onChange={(event) => void state.setVariantLines(event.target.value.split(/\r?\n/))}
            placeholder="每行一个变体，例如：\nFull body shot, naturally walking forward.\nMedium shot, 45-degree side profile."
            className="min-h-[150px] font-mono text-[13px]"
          />
          <div className="text-xs text-zinc-500">
            需要至少填写 {state.childOutputCount} 行。暂不内置任何变体模板，完全由你自定义。
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div>
            <div className="text-sm font-medium text-zinc-100">
              当前 AI 母图：{state.currentAiMasterAsset ? '已选定' : '未选定'}
            </div>
            <div className="mt-1 text-xs leading-5 text-zinc-500">
              子图会按序串行提交；单张失败只记入失败记录，不会打断后续子图。
            </div>
          </div>
          <Button
            type="button"
            onClick={() => void handleStartChild()}
            disabled={!state.currentAiMasterAsset || runningStage !== null}
          >
            <Play className="h-4 w-4" />
            {runningStage === 'child' ? '子图执行中...' : '开始生成子图'}
          </Button>
        </div>
      </SectionBlock>

      {isDev ? (
        <SectionBlock
          eyebrow="Dev Only"
          title="联调工具"
          description="仅开发环境显示。用于正式 UI 注入假数据、全选子图并验证发送到数据工坊的链路是否畅通。"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4">
            <div>
              <div className="text-sm font-medium text-zinc-100">当前已选子图 {selectedChildCount} 张</div>
              <div className="mt-1 text-xs leading-5 text-zinc-500">
                这里不会改动正式工作流，只是补一个开发态快速验证入口。
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void handleSeedDemo()}>
                注入假数据
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleSelectAllChildOutputs()}>
                全选子图
              </Button>
              <Button type="button" variant="outline" onClick={() => void handleClearSelectedChildOutputs()}>
                取消全选
              </Button>
              <Button
                type="button"
                onClick={() => void handleSendSelectedChildOutputs()}
                disabled={selectedChildCount === 0}
              >
                <Send className="h-4 w-4" />
                发送到数据工坊
              </Button>
            </div>
          </div>
        </SectionBlock>
      ) : null}
    </div>
  )
}

export { ControlPanel }
