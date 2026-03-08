import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'

import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCcw, Sparkles, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import type {
  AiStudioAssetRecord,
  AiStudioWorkflowFailureRecord,
  UseAiStudioStateResult
} from './useAiStudioState'

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未命名文件'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function readSequenceIndex(asset: AiStudioAssetRecord, fallbackIndex: number): number {
  const value = Number(asset.metadata?.sequenceIndex)
  if (Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallbackIndex + 1
}

function failureStageLabel(record: AiStudioWorkflowFailureRecord): string {
  if (record.stageKind === 'master-generate') return '母图生成'
  if (record.stageKind === 'master-clean') return '母图去水印'
  return '子图生成'
}

function SectionShell({
  title,
  badge,
  children
}: {
  title: string
  badge?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-950/65 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-base font-medium text-zinc-50">{title}</div>
        {badge ? (
          <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-500">
            {badge}
          </div>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }): React.JSX.Element {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 text-zinc-500">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="mt-4 text-sm font-medium text-zinc-100">{title}</div>
      <div className="mt-2 max-w-sm text-xs leading-6 text-zinc-500">{hint}</div>
    </div>
  )
}

function ImageLightbox({
  asset,
  open,
  onOpenChange
}: {
  asset: AiStudioAssetRecord | null
  open: boolean
  onOpenChange: (next: boolean) => void
}): React.JSX.Element | null {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = asset ? resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath) : ''

  useEffect(() => {
    if (!open) return
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('keydown', onEsc)
    }
  }, [onOpenChange, open])

  if (!open || !asset || !src) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/88 p-6">
      <button
        type="button"
        aria-label="关闭图片预览"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0"
      />
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="absolute right-5 top-5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-zinc-100 backdrop-blur transition hover:bg-black/70"
        aria-label="关闭图片预览"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="relative z-10 flex max-h-full max-w-[94vw] items-center justify-center">
        <img
          src={src}
          alt={basename(asset.filePath)}
          className="max-h-[92vh] max-w-[94vw] rounded-3xl object-contain shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
          draggable={false}
        />
      </div>
    </div>
  )
}

type PreviewCardProps = {
  asset?: AiStudioAssetRecord | null
  title: string
  badge?: string
  active?: boolean
  tone?: 'default' | 'error'
  placeholderTitle?: string
  placeholderHint?: string
  footer?: React.ReactNode
  onPreview?: (asset: AiStudioAssetRecord) => void
  onReveal?: (asset: AiStudioAssetRecord) => void
}

function PreviewCard({
  asset,
  title,
  badge,
  active,
  tone = 'default',
  placeholderTitle,
  placeholderHint,
  footer,
  onPreview,
  onReveal
}: PreviewCardProps): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = asset ? resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath) : ''
  const toneClass =
    tone === 'error'
      ? 'border-amber-500/25 bg-amber-500/5'
      : active
        ? 'border-zinc-100 shadow-[0_0_0_1px_rgba(255,255,255,0.14)]'
        : 'border-zinc-800 bg-zinc-950'
  const clickable = Boolean(src && asset && onPreview)

  return (
    <div className={cn('overflow-hidden rounded-2xl border', toneClass)}>
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={() => {
          if (asset && onPreview) onPreview(asset)
        }}
        onKeyDown={(event) => {
          if (!clickable || !asset || !onPreview) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onPreview(asset)
          }
        }}
        className={cn(
          'relative aspect-[3/4] overflow-hidden',
          clickable && 'cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500'
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
        <div
          className={cn(
            'absolute inset-0',
            src
              ? 'bg-[linear-gradient(180deg,rgba(0,0,0,0.06),rgba(0,0,0,0.72))]'
              : tone === 'error'
                ? 'bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),rgba(24,24,27,0.96))]'
                : 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),rgba(24,24,27,0.96))]'
          )}
        />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <div className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-zinc-100 backdrop-blur">
            {title}
          </div>
          {badge ? (
            <div className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-zinc-200 backdrop-blur">
              {badge}
            </div>
          ) : null}
        </div>
        {src && asset && onReveal ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full border border-white/10 bg-black/40 text-zinc-100 backdrop-blur hover:bg-black/65"
            aria-label="打开所在文件夹"
            onClick={(event) => {
              event.stopPropagation()
              void onReveal(asset)
            }}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        ) : null}
        {!src ? (
          <div className="absolute inset-x-6 bottom-6 rounded-2xl border border-white/10 bg-black/35 px-4 py-4 text-center backdrop-blur">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-zinc-100">
              {tone === 'error' ? (
                <AlertTriangle className="h-5 w-5 text-amber-300" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </div>
            <div className="mt-3 text-sm font-medium text-zinc-100">
              {placeholderTitle ?? '当前序位暂无图像'}
            </div>
            {placeholderHint ? (
              <div className="mt-2 text-xs leading-5 text-zinc-400">{placeholderHint}</div>
            ) : null}
          </div>
        ) : null}
      </div>
      {footer ? <div className="flex flex-col gap-2 p-3">{footer}</div> : null}
    </div>
  )
}

type MasterCandidateView = {
  sequenceIndex: number
  raw: AiStudioAssetRecord | null
  clean: AiStudioAssetRecord | null
  generateFailure: AiStudioWorkflowFailureRecord | null
  cleanFailure: AiStudioWorkflowFailureRecord | null
  status: 'ready' | 'generate-failed' | 'clean-failed' | 'pending'
}

function ResultPanel({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const [retryingKey, setRetryingKey] = useState<string | null>(null)
  const [previewAsset, setPreviewAsset] = useState<AiStudioAssetRecord | null>(null)
  const task = state.activeTask

  const masterCandidates = useMemo<MasterCandidateView[]>(() => {
    const rawBySequence = new Map<number, AiStudioAssetRecord>()
    for (const [index, asset] of state.masterRawAssets.entries()) {
      rawBySequence.set(readSequenceIndex(asset, index), asset)
    }

    const cleanBySequence = new Map<number, AiStudioAssetRecord>()
    for (const [index, asset] of state.masterCleanAssets.entries()) {
      cleanBySequence.set(readSequenceIndex(asset, index), asset)
    }

    const generateFailureBySequence = new Map<number, AiStudioWorkflowFailureRecord>()
    const cleanFailureBySequence = new Map<number, AiStudioWorkflowFailureRecord>()
    for (const record of state.failureRecords) {
      if (record.stageKind === 'master-generate') {
        generateFailureBySequence.set(record.sequenceIndex, record)
      }
      if (record.stageKind === 'master-clean') {
        cleanFailureBySequence.set(record.sequenceIndex, record)
      }
    }

    const allSequenceIndexes = [
      state.workflowMeta?.masterStage.requestedCount ?? state.masterOutputCount,
      ...Array.from(rawBySequence.keys()),
      ...Array.from(cleanBySequence.keys()),
      ...Array.from(generateFailureBySequence.keys()),
      ...Array.from(cleanFailureBySequence.keys())
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)

    const total = Math.max(0, ...allSequenceIndexes)
    return Array.from({ length: total }, (_, index) => {
      const sequenceIndex = index + 1
      const raw = rawBySequence.get(sequenceIndex) ?? null
      const clean = cleanBySequence.get(sequenceIndex) ?? null
      const generateFailure = generateFailureBySequence.get(sequenceIndex) ?? null
      const cleanFailure = cleanFailureBySequence.get(sequenceIndex) ?? null
      const watermarkStatus = String(raw?.metadata?.watermarkStatus ?? '')

      let status: MasterCandidateView['status'] = 'pending'
      if (clean) status = 'ready'
      else if (generateFailure) status = 'generate-failed'
      else if (cleanFailure || watermarkStatus === 'failed') status = 'clean-failed'

      return {
        sequenceIndex,
        raw,
        clean,
        generateFailure,
        cleanFailure,
        status
      }
    })
  }, [
    state.failureRecords,
    state.masterCleanAssets,
    state.masterOutputCount,
    state.masterRawAssets,
    state.workflowMeta?.masterStage.requestedCount
  ])


  const revealAsset = async (asset: AiStudioAssetRecord | null, label: string): Promise<void> => {
    if (!asset) return
    const result = await window.electronAPI.shellShowItemInFolder(asset.filePath)
    if (result?.success === false) {
      const message = result.error || `${label}定位失败。`
      addLog(`[AI Studio] ${message}`)
      window.alert(message)
    }
  }

  const handleRetryCleanup = async (assetId: string): Promise<void> => {
    try {
      setRetryingKey(`clean:${assetId}`)
      await state.retryMasterCleanup(assetId)
      addLog('[AI Studio] 已重新执行母图去水印')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 重新去水印失败：${message}`)
      window.alert(message)
    } finally {
      setRetryingKey(null)
    }
  }

  const handleRetryGeneration = async (sequenceIndex: number): Promise<void> => {
    try {
      setRetryingKey(`generate:${sequenceIndex}`)
      await state.retryMasterGeneration(sequenceIndex)
      addLog(`[AI Studio] 已重新执行母图 #${sequenceIndex} 生成`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 母图重试失败：${message}`)
      window.alert(message)
    } finally {
      setRetryingKey(null)
    }
  }

  if (!task) {
    return (
      <>
        <EmptyState title="结果区待命中" hint="先在左侧输入主图与参考图，然后开始母图生成。" />
        <ImageLightbox asset={previewAsset} open={Boolean(previewAsset)} onOpenChange={() => setPreviewAsset(null)} />
      </>
    )
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        <SectionShell title="母图候选" badge={`${masterCandidates.length} 个序位`}>
          {masterCandidates.length === 0 ? (
            <EmptyState title="还没有 AI 母图" hint="完成母图阶段后，这里会展示所有母图候选以及失败卡片。" />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {masterCandidates.map((candidate) => {
                const isCurrent = Boolean(
                  candidate.clean && state.currentAiMasterAsset?.id === candidate.clean.id
                )
                const previewAsset = candidate.clean ?? candidate.raw ?? null
                const cleanError = candidate.cleanFailure?.message?.trim() || null
                const generateError = candidate.generateFailure?.message?.trim() || null

                if (candidate.status === 'generate-failed') {
                  return (
                    <PreviewCard
                      key={`master-failed-${candidate.sequenceIndex}`}
                      title={`母图 #${candidate.sequenceIndex}`}
                      badge="生成失败"
                      tone="error"
                      placeholderTitle="该次母图生成失败"
                      placeholderHint="这次调用没有产出图片，但你可以直接在这里重试。"
                      footer={
                        <>
                          <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-3 text-xs leading-6 text-zinc-300">
                            {generateError || '未拿到更详细的失败原因'}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleRetryGeneration(candidate.sequenceIndex)}
                            disabled={retryingKey === `generate:${candidate.sequenceIndex}`}
                          >
                            <RefreshCcw
                              className={cn(
                                'h-4 w-4',
                                retryingKey === `generate:${candidate.sequenceIndex}` && 'animate-spin'
                              )}
                            />
                            {retryingKey === `generate:${candidate.sequenceIndex}` ? '重试中...' : '重试生成'}
                          </Button>
                        </>
                      }
                    />
                  )
                }

                return (
                  <PreviewCard
                    key={candidate.clean?.id ?? candidate.raw?.id ?? `master-slot-${candidate.sequenceIndex}`}
                    asset={previewAsset}
                    title={`母图 #${candidate.sequenceIndex}`}
                    badge={
                      candidate.status === 'ready'
                        ? '去印成功'
                        : candidate.status === 'clean-failed'
                          ? '去印失败'
                          : '待去印'
                    }
                    active={isCurrent}
                    tone={candidate.status === 'clean-failed' ? 'error' : 'default'}
                    placeholderTitle="当前序位暂无图像"
                    placeholderHint="这个母图序位还没有拿到输出。"
                    onPreview={(asset) => setPreviewAsset(asset)}
                    onReveal={(asset) => void revealAsset(asset, 'AI母图')}
                    footer={
                      candidate.status === 'ready' && candidate.clean ? (
                        <Button
                          type="button"
                          onClick={() => void state.setCurrentAiMaster(candidate.clean?.id ?? '')}
                          disabled={isCurrent}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {isCurrent ? '当前使用中' : '设为当前AI母图'}
                        </Button>
                      ) : candidate.status === 'clean-failed' ? (
                        <>
                          {cleanError ? (
                            <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-3 text-xs leading-6 text-zinc-300">
                              {cleanError}
                            </div>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => candidate.raw && void handleRetryCleanup(candidate.raw.id)}
                            disabled={
                              !candidate.raw || retryingKey === `clean:${candidate.raw.id}` || candidate.status !== 'clean-failed'
                            }
                          >
                            <RefreshCcw
                              className={cn(
                                'h-4 w-4',
                                candidate.raw && retryingKey === `clean:${candidate.raw.id}` && 'animate-spin'
                              )}
                            />
                            {candidate.raw && retryingKey === `clean:${candidate.raw.id}` ? '重试中...' : '重试去水印'}
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                )
              })}
            </div>
          )}
        </SectionShell>

        <SectionShell title="当前AI母图" badge={state.currentAiMasterAsset ? '已选定' : '未选定'}>
          {state.currentAiMasterAsset ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              <PreviewCard
                asset={state.currentAiMasterAsset}
                title="当前AI母图"
                badge="子图首参考"
                active
                onPreview={(asset) => setPreviewAsset(asset)}
                onReveal={(asset) => void revealAsset(asset, '当前AI母图')}
              />
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="text-sm font-medium text-zinc-100">后续子图会如何调用</div>
                <div className="mt-3 space-y-3 text-sm leading-7 text-zinc-400">
                  <p>子图阶段会把这张去印后的当前 AI 母图放在第一参考位。</p>
                  <p>原始参考图会继续作为补充参考图拼接到后面的输入位。</p>
                  <p>如果某一张子图失败，失败会记入下方列表，但队列会继续往后跑。</p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="还没选择当前 AI 母图"
              hint="从上方“母图候选”里挑一张去印成功的结果，点击“设为当前AI母图”。"
            />
          )}
        </SectionShell>

        <SectionShell title="子图结果" badge={`${state.childOutputAssets.length} 张`}>
          {state.childOutputAssets.length === 0 ? (
            <EmptyState title="还没有子图结果" hint="选择当前 AI 母图并启动子图阶段后，这里会连续展示所有子图。" />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {state.childOutputAssets.map((asset, index) => {
                const sequenceIndex = readSequenceIndex(asset, index)
                const variantText = String(asset.metadata?.variantText ?? '').trim()
                return (
                  <PreviewCard
                    key={asset.id}
                    asset={asset}
                    title={`子图 #${sequenceIndex}`}
                    badge={variantText ? '已带变体' : '默认'}
                    onPreview={(nextAsset) => setPreviewAsset(nextAsset)}
                    onReveal={(nextAsset) => void revealAsset(nextAsset, '子图')}
                    footer={
                      variantText ? (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs leading-5 text-zinc-400">
                          {variantText}
                        </div>
                      ) : undefined
                    }
                  />
                )
              })}
            </div>
          )}
        </SectionShell>

        <SectionShell title="失败记录" badge={`${state.failureRecords.length} 条`}>
          {state.failureRecords.length === 0 ? (
            <EmptyState title="当前没有失败记录" hint="一旦母图生成、去水印或子图生成失败，这里会保留详细错误。" />
          ) : (
            <div className="flex flex-col gap-3">
              {state.failureRecords.map((record) => (
                <div
                  key={record.id}
                  className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                    <span>{failureStageLabel(record)}</span>
                    <span className="text-zinc-500"># {record.sequenceIndex}</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-zinc-400">{record.message}</div>
                </div>
              ))}
            </div>
          )}
        </SectionShell>
      </div>

      <ImageLightbox
        asset={previewAsset}
        open={Boolean(previewAsset)}
        onOpenChange={(next) => {
          if (!next) setPreviewAsset(null)
        }}
      />
    </>
  )
}

export { ResultPanel }
