import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

import { Check, ImagePlus, Plus, Sparkles, X } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import {
  buildStageProgress,
  readWorkflowMetadata,
  selectDispatchOutputAssets,
  type AiStudioAssetRecord,
  type AiStudioTaskView,
  type AiStudioWorkflowFailureRecord,
  type UseAiStudioStateResult
} from './useAiStudioState'
import { computePreviewTargetCount } from './workflowRunHelpers'
import { resolvePreviewSlotState, type PreviewTileStatus } from './previewSlotHelpers'
import { formatResolutionBadgeLabel } from './resolutionLabelHelpers'

const MASTER_CLEAN_ROLE = 'master-clean'

type PreviewSlot = {
  index: number
  asset: AiStudioAssetRecord | null
  failure: AiStudioWorkflowFailureRecord | null
  status: PreviewTileStatus
  statusText: string
}

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未命名文件'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function buildExcerpt(promptDraft: string): string {
  const normalized = String(promptDraft ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  if (!normalized) return '等待输入提示词'
  return normalized.length > 160 ? `${normalized.slice(0, 160)}…` : normalized
}

function getAssetSequenceIndex(asset: AiStudioAssetRecord, fallbackIndex: number): number {
  const metadata =
    asset.metadata && typeof asset.metadata === 'object'
      ? (asset.metadata as Record<string, unknown>)
      : {}
  const rawIndex = metadata.sequenceIndex
  const numericIndex =
    typeof rawIndex === 'number' && Number.isFinite(rawIndex)
      ? rawIndex
      : Number.parseInt(String(rawIndex ?? ''), 10)

  if (Number.isFinite(numericIndex) && numericIndex > 0) {
    return Math.max(1, Math.floor(numericIndex))
  }

  return Math.max(1, asset.sortOrder + 1, fallbackIndex)
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

  if (!open || !asset || !src || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/88 p-6">
      <button
        type="button"
        aria-label="关闭图片预览"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0"
      />
      <div className="relative z-10 flex max-h-full max-w-[94vw] items-center justify-center">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute -right-3 -top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-zinc-100 backdrop-blur transition hover:bg-black/70"
          aria-label="关闭图片预览"
        >
          <X className="h-5 w-5" />
        </button>
        <img
          src={src}
          alt={basename(asset.filePath)}
          className="max-h-[46vh] max-w-[47vw] rounded-3xl object-contain shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
          draggable={false}
        />
      </div>
    </div>,
    document.body
  )
}

function ThreadThumb({ asset }: { asset: AiStudioAssetRecord }): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)

  return (
    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-transparent">
      {src ? (
        <img
          src={src}
          alt={basename(asset.filePath)}
          className="h-full w-full object-cover"
          draggable={false}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-zinc-400">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}

function PreviewActionButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'group/action inline-flex h-8 items-center overflow-hidden rounded-full border shadow-[0_8px_20px_rgba(15,23,42,0.12)] transition-all duration-200',
        active
          ? 'border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-800'
          : 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50'
      )}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center">{icon}</span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap pr-0 text-[11px] font-medium opacity-0 transition-all duration-200 group-hover/action:max-w-[112px] group-hover/action:pr-2.5 group-hover/action:opacity-100">
        {label}
      </span>
    </button>
  )
}

function PreviewStageTile({
  asset,
  status,
  statusText,
  onOpen,
  onTogglePool,
  pooled,
  onUseAsReference,
  referenceApplied,
  style
}: {
  asset?: AiStudioAssetRecord | null
  status: PreviewTileStatus
  statusText?: string
  onOpen?: () => void
  onTogglePool?: () => void
  pooled?: boolean
  onUseAsReference?: () => void
  referenceApplied?: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = asset ? resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath) : ''
  const showReferenceAction = Boolean(asset && onUseAsReference)
  const showPoolAction = Boolean(asset && onTogglePool)
  const [loadedResolution, setLoadedResolution] = useState<{ width: number; height: number } | null>(null)
  const resolutionBadgeLabel = loadedResolution
    ? formatResolutionBadgeLabel(loadedResolution.width, loadedResolution.height)
    : ''

  return (
    <div className="group/tile flex min-w-0 shrink-0 flex-col gap-2" style={style}>
      <div
        className={cn(
          'relative overflow-hidden rounded-[28px] bg-transparent shadow-none transition',
          status === 'failed' && 'shadow-[0_12px_32px_rgba(244,63,94,0.06)]'
        )}
      >

        {src && onOpen ? (
          <button type="button" onClick={onOpen} className="block w-full text-left">
            <div className="aspect-[3/4] overflow-hidden rounded-[28px] bg-transparent">
              <img
                src={src}
                alt={basename(asset?.filePath)}
                className="h-full w-full object-cover transition duration-300 hover:scale-[1.01]"
                draggable={false}
                loading="lazy"
                onLoad={(event) => {
                  const target = event.currentTarget
                  const width = Number(target.naturalWidth)
                  const height = Number(target.naturalHeight)
                  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                    setLoadedResolution(null)
                    return
                  }
                  setLoadedResolution((prev) =>
                    prev && prev.width === width && prev.height === height ? prev : { width, height }
                  )
                }}
              />
            </div>
          </button>
        ) : status === 'failed' ? (
          <div className="relative aspect-[3/4] rounded-[28px] border border-rose-200/90 bg-transparent">
            <div className="flex h-full items-center justify-center px-5 text-center text-sm font-medium leading-6 text-zinc-500">
              {statusText || '生成失败'}
            </div>
          </div>
        ) : (
          <div className="aspect-[3/4] rounded-[28px] border border-zinc-200/35 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),rgba(244,244,245,0.28))]" />
        )}

        {status === 'loading' ? (
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex h-8 items-center gap-2 rounded-full border border-white/70 bg-white/88 px-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-900/70" />
            <span className="text-[11px] font-medium tracking-[0.08em] text-zinc-500">处理中</span>
          </div>
        ) : null}

        {status !== 'failed' && resolutionBadgeLabel ? (
          <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 rounded-full border border-white/18 bg-black/24 px-2 py-0.5 text-[10px] font-medium tracking-[0.02em] text-white/92 shadow-[0_4px_12px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            {resolutionBadgeLabel}
          </div>
        ) : null}

        {showPoolAction || showReferenceAction ? (
          <div
            className={cn(
              'absolute right-3 top-3 z-10 flex items-center gap-1.5 transition duration-200',
              pooled || referenceApplied
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0 group-hover/tile:pointer-events-auto group-hover/tile:opacity-100 group-focus-within/tile:pointer-events-auto group-focus-within/tile:opacity-100'
            )}
          >
            {showPoolAction ? (
              <PreviewActionButton
                icon={pooled ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                label={pooled ? '移出图池' : '添加到图池'}
                active={pooled}
                onClick={onTogglePool!}
              />
            ) : null}
            {showReferenceAction ? (
              <PreviewActionButton
                icon={referenceApplied ? <Check className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
                label={referenceApplied ? '已作参考图' : '用作参考图'}
                active={referenceApplied}
                onClick={onUseAsReference!}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {status !== 'failed' && statusText ? (
        <div className="px-1 text-[13px] font-medium leading-6 text-zinc-500">{statusText}</div>
      ) : null}
    </div>
  )
}

function HistoryTaskSection({
  task,
  state,
  onOpenAsset
}: {
  task: AiStudioTaskView
  state: UseAiStudioStateResult
  onOpenAsset: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const primaryAsset = task.inputAssets.find((asset) => asset.filePath === task.primaryImagePath) ?? null
  const referenceAssets = task.inputAssets.filter((asset) =>
    task.referenceImagePaths.includes(asset.filePath)
  )
  const threadAssets = useMemo(() => {
    const next: AiStudioAssetRecord[] = []
    if (primaryAsset) next.push(primaryAsset)
    const existing = new Set(next.map((asset) => asset.filePath))
    referenceAssets.forEach((asset) => {
      if (!existing.has(asset.filePath)) next.push(asset)
    })
    return next
  }, [primaryAsset, referenceAssets])

  const workflowMeta = useMemo(
    () =>
      readWorkflowMetadata({
        templateId: task.templateId,
        promptExtra: task.promptExtra,
        primaryImagePath: task.primaryImagePath,
        referenceImagePaths: task.referenceImagePaths,
        metadata: task.metadata
      }),
    [task]
  )
  const stageProgress = useMemo(() => buildStageProgress(workflowMeta), [workflowMeta])
  const generatedAssets = useMemo(
    () =>
      [...selectDispatchOutputAssets(task)].sort(
        (left, right) =>
          getAssetSequenceIndex(left, left.sortOrder + 1) -
            getAssetSequenceIndex(right, right.sortOrder + 1) || left.sortOrder - right.sortOrder
      ),
    [task]
  )
  const masterCleanAssets = useMemo(
    () => task.outputAssets.filter((asset) => asset.role === MASTER_CLEAN_ROLE),
    [task.outputAssets]
  )
  const currentAiMasterAsset = useMemo(() => {
    const currentId = workflowMeta.workflow.currentAiMasterAssetId ?? ''
    if (!currentId) return null
    return masterCleanAssets.find((asset) => asset.id === currentId) ?? null
  }, [masterCleanAssets, workflowMeta.workflow.currentAiMasterAssetId])
  const latestSubmittedPrompt =
    task.metadata && typeof task.metadata === 'object'
      ? String((task.metadata as Record<string, unknown>).latestSubmittedPrompt ?? '')
      : ''
  const promptExcerpt = buildExcerpt(latestSubmittedPrompt || workflowMeta.masterStage.promptExtra || task.promptExtra)
  const isRunning = task.status === 'running'
  const failureRecords = workflowMeta.workflow.failures ?? []
  const currentReferencePaths = useMemo(
    () =>
      new Set(
        [state.primaryImagePath, ...state.referenceImagePaths]
          .map((filePath) => String(filePath ?? '').trim())
          .filter(Boolean)
      ),
    [state.primaryImagePath, state.referenceImagePaths]
  )
  const previewRuntimeStates = state.previewSlotRuntimeByTaskId[task.id] ?? {}
  const generatedAssetCount = generatedAssets.length
  const pooledGeneratedAssetCount = useMemo(
    () => generatedAssets.filter((asset) => asset.selected).length,
    [generatedAssets]
  )
  const canBatchAddToPool = generatedAssetCount > 0
  const allGeneratedAssetsPooled =
    canBatchAddToPool && pooledGeneratedAssetCount === generatedAssetCount

  const previewSlots = useMemo(() => {
    const failureByIndex = new Map<number, AiStudioWorkflowFailureRecord>()
    failureRecords.forEach((record) => {
      if (!failureByIndex.has(record.sequenceIndex)) {
        failureByIndex.set(record.sequenceIndex, record)
      }
    })

    const assetByIndex = new Map<number, AiStudioAssetRecord>()
    generatedAssets.forEach((asset, index) => {
      const sequenceIndex = getAssetSequenceIndex(asset, index + 1)
      if (!assetByIndex.has(sequenceIndex)) {
        assetByIndex.set(sequenceIndex, asset)
      }
    })

    const expectedOutputCount =
      generatedAssets[0]?.role === 'child-output'
        ? workflowMeta.childStage.requestedCount
        : workflowMeta.masterStage.requestedCount
    const maxFailureIndex = failureRecords.reduce(
      (max, record) => Math.max(max, record.sequenceIndex),
      0
    )
    const previewTargetCount = computePreviewTargetCount({
      isRunning,
      currentItemTotal: workflowMeta.workflow.currentItemTotal || 0,
      expectedOutputCount: expectedOutputCount || 0,
      generatedCount: generatedAssets.length,
      maxFailureIndex
    })

    if (previewTargetCount <= 0 && !currentAiMasterAsset) return [] as PreviewSlot[]

    return Array.from({ length: previewTargetCount }, (_, slotIndex) => {
      const index = slotIndex + 1
      const asset = assetByIndex.get(index) ?? null
      const failure = failureByIndex.get(index) ?? null
      const resolvedState = resolvePreviewSlotState({
        index,
        asset,
        failureMessage: failure?.message ?? null,
        isRunning,
        currentLabel: stageProgress.currentLabel,
        currentItemIndex: workflowMeta.workflow.currentItemIndex,
        runtimeState: previewRuntimeStates[index] ?? null
      })

      return {
        index,
        asset,
        failure,
        status: resolvedState.status,
        statusText: resolvedState.statusText
      } satisfies PreviewSlot
    })
  }, [currentAiMasterAsset, failureRecords, generatedAssets, isRunning, previewRuntimeStates, stageProgress.currentLabel, workflowMeta])

  const previewGapPx = 20
  const previewTileWidth = `clamp(120px, calc((100% - ${(Math.max(previewSlots.length - 1, 0) * previewGapPx)}px) / ${Math.max(previewSlots.length, 1)}), 248px)`

  const handleUseAsReference = async (asset: AiStudioAssetRecord): Promise<void> => {
    try {
      await state.useDispatchOutputAsReference(asset.filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 添加参考图失败：${message}`)
      window.alert(message)
    }
  }

  const handleSelectAllGeneratedAssets = async (): Promise<void> => {
    if (!canBatchAddToPool || allGeneratedAssetsPooled) return

    try {
      await state.selectAllDispatchOutputsForTask(task.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 批量加入图池失败：${message}`)
      window.alert(message)
    }
  }

  const threadHeader = (
    <div className="flex min-w-0 items-start gap-4">
      <div className="flex gap-2">
        {threadAssets.slice(0, 4).map((asset) => (
          <ThreadThumb key={asset.id} asset={asset} />
        ))}
      </div>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex min-w-0 flex-wrap items-start gap-2.5">
          <div className="min-w-0 flex-1 text-[15px] font-medium leading-7 text-zinc-900">
            {promptExcerpt}
          </div>
          <button
            type="button"
            onClick={() => void handleSelectAllGeneratedAssets()}
            disabled={!canBatchAddToPool || allGeneratedAssetsPooled}
            title={
              !canBatchAddToPool
                ? '该线程暂时还没有生成图片'
                : allGeneratedAssetsPooled
                  ? '该线程图片已全部加入图池'
                  : '将该线程当前已生成图片批量加入图池'
            }
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition',
              !canBatchAddToPool
                ? 'cursor-not-allowed border-zinc-200/80 bg-zinc-50 text-zinc-400'
                : allGeneratedAssetsPooled
                  ? 'cursor-default border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-zinc-200 bg-white text-zinc-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:border-zinc-300 hover:bg-zinc-50'
            )}
          >
            {allGeneratedAssetsPooled ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span>{allGeneratedAssetsPooled ? '已加入图池' : '批量加入图池'}</span>
          </button>
        </div>
      </div>
    </div>
  )

  if (previewSlots.length === 0 && !currentAiMasterAsset && failureRecords.length === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-4">{threadHeader}</section>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {threadHeader}

      {previewSlots.length > 0 ? (
        <div className="py-1">
          <div className="flex flex-nowrap items-start gap-5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {previewSlots.map((slot) => (
              <PreviewStageTile
                key={`${task.id}-preview-slot-${slot.index}`}
                asset={slot.asset}
                status={slot.status}
                statusText={slot.statusText}
                pooled={slot.asset?.selected}
                style={{ width: previewTileWidth }}
                onOpen={slot.asset ? () => onOpenAsset(slot.asset as AiStudioAssetRecord) : undefined}
                onTogglePool={
                  slot.asset
                    ? () => void state.toggleDispatchOutputPoolForTask(task.id, slot.asset?.id ?? '')
                    : undefined
                }
                onUseAsReference={
                  slot.asset ? () => void handleUseAsReference(slot.asset as AiStudioAssetRecord) : undefined
                }
                referenceApplied={slot.asset ? currentReferencePaths.has(slot.asset.filePath) : false}
              />
            ))}
          </div>
        </div>
      ) : currentAiMasterAsset ? (
        <div className="py-1">
          <div className="flex flex-nowrap items-start gap-5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <PreviewStageTile
              asset={currentAiMasterAsset}
              status="ready"
              style={{ width: 'min(248px, 100%)' }}
              onOpen={() => onOpenAsset(currentAiMasterAsset)}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ResultPanel({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const [lightboxAsset, setLightboxAsset] = useState<AiStudioAssetRecord | null>(null)

  if (state.historyTasks.length === 0) {
    return (
      <ImageLightbox
        asset={lightboxAsset}
        open={Boolean(lightboxAsset)}
        onOpenChange={(next) => {
          if (!next) setLightboxAsset(null)
        }}
      />
    )
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-5 pb-4">
        {state.historyTasks.map((task) => (
          <HistoryTaskSection
            key={task.id}
            task={task}
            state={state}
            onOpenAsset={(asset) => setLightboxAsset(asset)}
          />
        ))}
      </div>

      <ImageLightbox
        asset={lightboxAsset}
        open={Boolean(lightboxAsset)}
        onOpenChange={(next) => {
          if (!next) setLightboxAsset(null)
        }}
      />
    </>
  )
}

export { ResultPanel }
