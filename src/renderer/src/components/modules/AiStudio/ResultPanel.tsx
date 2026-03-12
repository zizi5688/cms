import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

import { Check, Clapperboard, ImageMinus, ImagePlus, Play, Plus, Sparkles, X } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import {
  buildStageProgress,
  readVideoMetadata,
  readWorkflowMetadata,
  selectDispatchOutputAssets,
  type AiStudioAssetRecord,
  type AiStudioTaskView,
  type AiStudioVideoFailureRecord,
  type AiStudioWorkflowFailureRecord,
  type UseAiStudioStateResult
} from './useAiStudioState'

const MASTER_CLEAN_ROLE = 'master-clean'
const MAX_PREVIEW_SLOTS = 4
const VIDEO_POSTER_CAPTURE_TIME_SEC = 0.05
const videoPosterCache = new Map<string, string>()
const videoPosterInflight = new Map<string, Promise<string>>()

type PreviewTileStatus = 'ready' | 'loading' | 'failed' | 'idle'

type PreviewSlot = {
  index: number
  asset: AiStudioAssetRecord | null
  failure: AiStudioWorkflowFailureRecord | AiStudioVideoFailureRecord | null
  status: PreviewTileStatus
  statusText: string
  detailText?: string
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

function normalizeOverlayText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildResolutionLabelFromDimensions(width: number, height: number): string {
  const shortEdge = Math.min(Math.abs(Math.floor(width)), Math.abs(Math.floor(height)))
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return ''
  if (shortEdge >= 2160) return '4K'
  if (shortEdge >= 1440) return '2K'
  if (shortEdge >= 1080) return '1080p'
  if (shortEdge >= 720) return '720p'
  return `${shortEdge}p`
}

function readVideoAssetResolutionLabel(
  asset: AiStudioAssetRecord | null | undefined,
  fallbackResolution?: string | null
): string {
  if (!asset || !asset.metadata || typeof asset.metadata !== 'object') {
    return normalizeOverlayText(fallbackResolution)
  }

  const metadata = asset.metadata as Record<string, unknown>
  const explicitLabel = normalizeOverlayText(metadata.resolutionLabel)
  if (explicitLabel) return explicitLabel

  const width = Number(metadata.videoWidth ?? 0)
  const height = Number(metadata.videoHeight ?? 0)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const label = buildResolutionLabelFromDimensions(width, height)
    if (label) return label
  }

  const sizeText = normalizeOverlayText(metadata.videoSizeText ?? metadata.responseSize)
  if (sizeText) {
    const matched = sizeText.match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i)
    if (matched) {
      const parsedWidth = Number.parseInt(matched[1] ?? '', 10)
      const parsedHeight = Number.parseInt(matched[2] ?? '', 10)
      if (
        Number.isFinite(parsedWidth) &&
        Number.isFinite(parsedHeight) &&
        parsedWidth > 0 &&
        parsedHeight > 0
      ) {
        const label = buildResolutionLabelFromDimensions(parsedWidth, parsedHeight)
        if (label) return label
      }
    }
  }

  const requestedResolution = normalizeOverlayText(metadata.requestedResolution)
  if (requestedResolution) return requestedResolution

  return normalizeOverlayText(fallbackResolution)
}

async function captureVideoPoster(filePath: string): Promise<string> {
  const normalizedPath = String(filePath ?? '').trim()
  if (!normalizedPath) throw new Error('视频路径为空')

  const cacheKey = `${normalizedPath}@${VIDEO_POSTER_CAPTURE_TIME_SEC}`
  const cached = videoPosterCache.get(cacheKey)
  if (cached) return cached

  const inflight = videoPosterInflight.get(cacheKey)
  if (inflight) return inflight

  const request = window.electronAPI
    .captureVideoFrame(normalizedPath, VIDEO_POSTER_CAPTURE_TIME_SEC)
    .then((savedPath) => {
      const normalizedSavedPath = String(savedPath ?? '').trim()
      if (!normalizedSavedPath) throw new Error('封面保存失败')
      videoPosterCache.set(cacheKey, normalizedSavedPath)
      return normalizedSavedPath
    })
    .finally(() => {
      videoPosterInflight.delete(cacheKey)
    })

  videoPosterInflight.set(cacheKey, request)
  return request
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
  onGenerateVideo,
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
  onGenerateVideo?: () => void
  referenceApplied?: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = asset ? resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath) : ''
  const showReferenceAction = Boolean(asset && onUseAsReference)
  const showPoolAction = Boolean(asset && onTogglePool)
  const showGenerateVideoAction = Boolean(asset && onGenerateVideo)

  return (
    <div className="group/tile flex min-w-0 shrink-0 flex-col gap-2" style={style}>
      <div
        className={cn(
          'relative overflow-hidden rounded-[28px] bg-transparent transition'
        )}
      >
        {status === 'loading' ? (
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px] p-[1px] animate-[spin_2.6s_linear_infinite]"
            style={{
              background:
                'conic-gradient(from_0deg,rgba(24,24,27,0.08),rgba(24,24,27,0.72),rgba(24,24,27,0.08),rgba(24,24,27,0.72),rgba(24,24,27,0.08))'
            }}
          >
            <div className="h-full w-full rounded-[27px] bg-transparent" />
          </div>
        ) : null}

        {src && onOpen ? (
          <button type="button" onClick={onOpen} className="block w-full text-left">
            <div className="aspect-[3/4] overflow-hidden bg-transparent">
              <img
                src={src}
                alt={basename(asset?.filePath)}
                className="h-full w-full object-cover transition duration-300 hover:scale-[1.01]"
                draggable={false}
                loading="lazy"
              />
            </div>
          </button>
        ) : status === 'failed' ? (
          <div className="relative aspect-[3/4] bg-transparent">
            <div className="absolute inset-0 rounded-[28px] border border-rose-200/90" />
            <div className="flex h-full items-center justify-center px-5 text-center text-sm font-medium leading-6 text-zinc-500">
              {statusText || '生成失败'}
            </div>
          </div>
        ) : (
          <div className="aspect-[3/4] bg-transparent" />
        )}

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
                icon={
                  referenceApplied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )
                }
                label={referenceApplied ? '已作参考图' : '用作参考图'}
                active={referenceApplied}
                onClick={onUseAsReference!}
              />
            ) : null}
          </div>
        ) : null}

        {showGenerateVideoAction ? (
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 opacity-0 transition duration-200 group-hover/tile:pointer-events-auto group-hover/tile:opacity-100 group-focus-within/tile:pointer-events-auto group-focus-within/tile:opacity-100">
            <PreviewActionButton
              icon={<Clapperboard className="h-3.5 w-3.5" />}
              label="生成视频"
              onClick={onGenerateVideo!}
            />
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
  const primaryAsset =
    task.inputAssets.find((asset) => asset.filePath === task.primaryImagePath) ?? null
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
  const hasDispatchOutputs = generatedAssets.length > 0
  const selectedDispatchOutputCount = generatedAssets.filter((asset) => asset.selected).length
  const areAllDispatchOutputsPooled =
    hasDispatchOutputs && selectedDispatchOutputCount >= generatedAssets.length
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
  const promptExcerpt = buildExcerpt(
    latestSubmittedPrompt || workflowMeta.masterStage.promptExtra || task.promptExtra
  )
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
    const previewTargetCount = Math.min(
      isRunning
        ? Math.max(
            workflowMeta.workflow.currentItemTotal || 0,
            expectedOutputCount || 0,
            generatedAssets.length,
            maxFailureIndex,
            1
          )
        : Math.max(generatedAssets.length, expectedOutputCount || 0, maxFailureIndex, 1),
      MAX_PREVIEW_SLOTS
    )

    if (previewTargetCount <= 0 && !currentAiMasterAsset) return [] as PreviewSlot[]

    return Array.from({ length: previewTargetCount }, (_, slotIndex) => {
      const index = slotIndex + 1
      const asset = assetByIndex.get(index) ?? null
      const failure = failureByIndex.get(index) ?? null
      const isLoadingSlot = isRunning && !asset && !failure

      return {
        index,
        asset,
        failure,
        status: asset ? 'ready' : failure ? 'failed' : isLoadingSlot ? 'loading' : 'idle',
        statusText: failure ? failure.message : isLoadingSlot ? stageProgress.currentLabel : ''
      } satisfies PreviewSlot
    })
  }, [
    currentAiMasterAsset,
    failureRecords,
    generatedAssets,
    isRunning,
    stageProgress.currentLabel,
    workflowMeta
  ])

  const previewGapPx = 20
  const previewTileWidth = `clamp(120px, calc((100% - ${Math.max(previewSlots.length - 1, 0) * previewGapPx}px) / ${Math.max(previewSlots.length, 1)}), 248px)`

  const handleUseAsReference = async (asset: AiStudioAssetRecord): Promise<void> => {
    try {
      await state.useDispatchOutputAsReference(asset.filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 添加参考图失败：${message}`)
      window.alert(message)
    }
  }

  const handleGenerateVideo = async (asset: AiStudioAssetRecord): Promise<void> => {
    try {
      await state.useOutputAsVideoSubjectReference(asset.filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 切换到视频生成失败：${message}`)
      window.alert(message)
    }
  }

  const handleBatchPoolForTask = async (): Promise<void> => {
    try {
      if (areAllDispatchOutputsPooled) {
        await state.clearSelectedDispatchOutputsForTask(task.id)
        return
      }
      await state.selectAllDispatchOutputsForTask(task.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 批量加入图池失败：${message}`)
      window.alert(message)
    }
  }

  if (previewSlots.length === 0 && !currentAiMasterAsset && failureRecords.length === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex gap-2">
            {threadAssets.slice(0, 4).map((asset) => (
              <ThreadThumb key={asset.id} asset={asset} />
            ))}
          </div>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-1">
            <div className="min-w-0 text-[15px] font-medium leading-7 text-zinc-900">
              {promptExcerpt}
            </div>
            {hasDispatchOutputs ? (
              <button
                type="button"
                onClick={() => void handleBatchPoolForTask()}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-zinc-950 bg-white px-4 text-[12px] font-medium text-zinc-950 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition hover:bg-zinc-50 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
              >
                {areAllDispatchOutputsPooled ? (
                  <ImageMinus className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                <span>{areAllDispatchOutputsPooled ? '移出图池' : '批量加入图池'}</span>
              </button>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex gap-2">
          {threadAssets.slice(0, 4).map((asset) => (
            <ThreadThumb key={asset.id} asset={asset} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pt-1">
          <div className="min-w-0 text-[15px] font-medium leading-7 text-zinc-900">
            {promptExcerpt}
          </div>
          {hasDispatchOutputs ? (
            <button
              type="button"
              onClick={() => void handleBatchPoolForTask()}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-zinc-950 bg-white px-4 text-[12px] font-medium text-zinc-950 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition hover:bg-zinc-50 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              {areAllDispatchOutputsPooled ? (
                <ImageMinus className="h-3.5 w-3.5" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>{areAllDispatchOutputsPooled ? '移出图池' : '批量加入图池'}</span>
            </button>
          ) : null}
        </div>
      </div>

      {previewSlots.length > 0 ? (
        <div className="py-1">
          <div className="flex flex-nowrap items-start gap-5 overflow-x-auto pb-1">
            {previewSlots.map((slot) => (
              <PreviewStageTile
                key={`${task.id}-preview-slot-${slot.index}`}
                asset={slot.asset}
                status={slot.status}
                statusText={slot.statusText}
                pooled={slot.asset?.selected}
                style={{ width: previewTileWidth }}
                onOpen={
                  slot.asset ? () => onOpenAsset(slot.asset as AiStudioAssetRecord) : undefined
                }
                onTogglePool={
                  slot.asset
                    ? () =>
                        void state.toggleDispatchOutputPoolForTask(task.id, slot.asset?.id ?? '')
                    : undefined
                }
                onUseAsReference={
                  slot.asset
                    ? () => void handleUseAsReference(slot.asset as AiStudioAssetRecord)
                    : undefined
                }
                onGenerateVideo={
                  slot.asset ? () => void handleGenerateVideo(slot.asset as AiStudioAssetRecord) : undefined
                }
                referenceApplied={
                  slot.asset ? currentReferencePaths.has(slot.asset.filePath) : false
                }
              />
            ))}
          </div>
        </div>
      ) : currentAiMasterAsset ? (
        <div className="py-1">
          <div className="flex flex-nowrap items-start gap-5 overflow-x-auto pb-1">
            <PreviewStageTile
              asset={currentAiMasterAsset}
              status="ready"
              style={{ width: 'min(248px, 100%)' }}
              onOpen={() => onOpenAsset(currentAiMasterAsset)}
              onGenerateVideo={() => void handleGenerateVideo(currentAiMasterAsset)}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}

function VideoLightbox({
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
        aria-label="关闭视频预览"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0"
      />
      <div className="relative z-10 flex max-h-full max-w-[94vw] items-center justify-center">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute -right-3 -top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/45 text-zinc-100 backdrop-blur transition hover:bg-black/70"
          aria-label="关闭视频预览"
        >
          <X className="h-5 w-5" />
        </button>
        <video
          src={src}
          controls
          autoPlay
          className="max-h-[72vh] max-w-[72vw] rounded-3xl bg-black object-contain shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
        />
      </div>
    </div>,
    document.body
  )
}

function VideoPreviewTile({
  asset,
  status,
  statusText,
  detailText,
  resolutionLabel,
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
  detailText?: string
  resolutionLabel?: string
  onOpen?: () => void
  onTogglePool?: () => void
  pooled?: boolean
  onUseAsReference?: () => void
  referenceApplied?: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const sourcePath = String(asset?.filePath ?? '').trim()
  const src = asset ? resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath) : ''
  const [posterState, setPosterState] = useState<{ sourcePath: string; posterPath: string }>({
    sourcePath: '',
    posterPath: ''
  })
  const showPoolAction = Boolean(asset && onTogglePool)
  const showReferenceAction = Boolean(asset && onUseAsReference)

  useEffect(() => {
    if (!sourcePath) return

    let cancelled = false
    void captureVideoPoster(sourcePath)
      .then((savedPath) => {
        if (cancelled) return
        setPosterState({ sourcePath, posterPath: savedPath })
      })
      .catch(() => {
        if (cancelled) return
        setPosterState({ sourcePath, posterPath: '' })
      })

    return () => {
      cancelled = true
    }
  }, [sourcePath])

  const posterSrc =
    posterState.sourcePath === sourcePath && posterState.posterPath
      ? resolveLocalImage(posterState.posterPath, workspacePath)
      : ''

  return (
    <div className="flex shrink-0 flex-col gap-2" style={style}>
      <div className="group/tile relative overflow-hidden rounded-[28px] bg-transparent">
        {src && onOpen ? (
          <button type="button" onClick={onOpen} className="relative block w-full text-left">
            <div className="relative aspect-[9/16] overflow-hidden bg-black">
              <video
                src={src}
                poster={posterSrc || undefined}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.42))]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg">
                  <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
                </div>
              </div>
            </div>
          </button>
        ) : status === 'failed' ? (
          <div className="relative aspect-[9/16] bg-transparent">
            <div className="absolute inset-0 rounded-[28px] border border-rose-200/90" />
            <div className="flex h-full items-center justify-center px-5">
              <div className="flex max-w-full flex-col items-center gap-2 text-center">
                <div className="text-sm font-medium leading-6 text-zinc-500">
                  {statusText || '生成失败'}
                </div>
                {detailText ? (
                  <div className="max-w-full break-all text-[11px] leading-5 text-zinc-400">
                    具体原因：{detailText}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative aspect-[9/16] bg-transparent">
            <div className="absolute inset-0 flex items-center justify-center text-zinc-400">
              <Clapperboard className="h-6 w-6" />
            </div>
          </div>
        )}

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
                icon={
                  referenceApplied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )
                }
                label={referenceApplied ? '已作参考帧' : '用作参考帧'}
                active={referenceApplied}
                onClick={onUseAsReference!}
              />
            ) : null}
          </div>
        ) : null}

        {asset && resolutionLabel ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 inline-flex h-6 items-center rounded-full bg-black/72 px-2.5 text-[10px] font-medium tracking-[0.04em] text-white shadow-[0_8px_18px_rgba(0,0,0,0.24)] backdrop-blur-sm">
            {resolutionLabel}
          </div>
        ) : null}
      </div>

      {status !== 'failed' && statusText ? (
        <div className="px-1 text-[13px] font-medium leading-6 text-zinc-500">{statusText}</div>
      ) : null}
    </div>
  )
}

function VideoHistoryTaskSection({
  task,
  state,
  onOpenAsset
}: {
  task: AiStudioTaskView
  state: UseAiStudioStateResult
  onOpenAsset: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const videoMeta = useMemo(() => readVideoMetadata(task), [task])
  const promptExcerpt = buildExcerpt(task.promptExtra)
  const generatedAssets = useMemo(
    () =>
      [...selectDispatchOutputAssets(task)].sort(
        (left, right) =>
          getAssetSequenceIndex(left, left.sortOrder + 1) -
            getAssetSequenceIndex(right, right.sortOrder + 1) || left.sortOrder - right.sortOrder
      ),
    [task]
  )
  const currentReferencePaths = useMemo(
    () =>
      new Set(
        [
          state.videoMeta.subjectReferencePath,
          state.videoMeta.firstFramePath,
          state.videoMeta.lastFramePath
        ]
          .map((filePath) => String(filePath ?? '').trim())
          .filter(Boolean)
      ),
    [
      state.videoMeta.firstFramePath,
      state.videoMeta.lastFramePath,
      state.videoMeta.subjectReferencePath
    ]
  )
  const previewSlots = useMemo(() => {
    const failureByIndex = new Map<number, AiStudioVideoFailureRecord>()
    videoMeta.failures.forEach((record) => {
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

    const targetCount = Math.min(
      Math.max(generatedAssets.length, videoMeta.outputCount, videoMeta.currentItemTotal, 1),
      MAX_PREVIEW_SLOTS
    )

    return Array.from({ length: targetCount }, (_, slotIndex) => {
      const index = slotIndex + 1
      const asset = assetByIndex.get(index) ?? null
      const failure = failureByIndex.get(index) ?? null
      const isLoading = task.status === 'running' && !asset && !failure
      return {
        index,
        asset,
        failure,
        status: asset ? 'ready' : failure ? 'failed' : isLoading ? 'loading' : 'idle',
        statusText: failure
          ? failure.message
          : isLoading
            ? `第 ${index}/${videoMeta.currentItemTotal || videoMeta.outputCount} 条生成中`
            : '',
        detailText: failure?.detail
      } satisfies PreviewSlot
    })
  }, [generatedAssets, task.status, videoMeta])

  const handleUseAsReference = async (asset: AiStudioAssetRecord): Promise<void> => {
    try {
      await state.useOutputAsVideoReference(asset.filePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 回填视频参考失败：${message}`)
      window.alert(message)
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex gap-2">
          {task.inputAssets.slice(0, 2).map((asset) => (
            <ThreadThumb key={asset.id} asset={asset} />
          ))}
        </div>
        <div className="min-w-0 pt-1">
          <div className="text-[15px] font-medium leading-7 text-zinc-900">
            <span>{promptExcerpt}</span>
            <span className="ml-2 inline-flex h-7 items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 align-middle text-[11px] font-medium text-zinc-500 whitespace-nowrap">
              {videoMeta.mode === 'first-last-frame' ? '首尾帧' : '主体参考'}
            </span>
            <span className="ml-2 inline-flex h-7 items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 align-middle text-[11px] font-medium text-zinc-500 whitespace-nowrap">
              {videoMeta.aspectRatio} · {videoMeta.resolution} · {videoMeta.duration}s
            </span>
          </div>
        </div>
      </div>

      <div className="py-1">
        <div className="flex flex-nowrap items-start gap-5 overflow-x-auto pb-1">
          {previewSlots.map((slot) => (
            <VideoPreviewTile
              key={`${task.id}-video-slot-${slot.index}`}
              asset={slot.asset}
              status={slot.status}
              statusText={slot.statusText}
              detailText={slot.detailText}
              resolutionLabel={
                slot.asset ? readVideoAssetResolutionLabel(slot.asset, videoMeta.resolution) : ''
              }
              pooled={slot.asset?.selected}
              style={{ width: 'clamp(148px, 24vw, 220px)' }}
              onOpen={slot.asset ? () => onOpenAsset(slot.asset as AiStudioAssetRecord) : undefined}
              onTogglePool={
                slot.asset
                  ? () => void state.toggleDispatchOutputPoolForTask(task.id, slot.asset?.id ?? '')
                  : undefined
              }
              onUseAsReference={
                slot.asset
                  ? () => void handleUseAsReference(slot.asset as AiStudioAssetRecord)
                  : undefined
              }
              referenceApplied={slot.asset ? currentReferencePaths.has(slot.asset.filePath) : false}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function ResultPanel({
  state,
  bottomSpacerHeight = 0
}: {
  state: UseAiStudioStateResult
  bottomSpacerHeight?: number
}): React.JSX.Element {
  const [lightboxAsset, setLightboxAsset] = useState<AiStudioAssetRecord | null>(null)
  const isVideoStudio = state.studioCapability === 'video'
  const historyTailRef = useRef<HTMLDivElement | null>(null)
  const latestHistoryTask = state.historyTasks[state.historyTasks.length - 1] ?? null
  const latestRevealHistoryKey =
    isVideoStudio && latestHistoryTask
      ? `${state.studioCapability}:${state.historyTasks.length}:${latestHistoryTask.id}:${latestHistoryTask.updatedAt}`
      : ''
  const previousLatestRevealHistoryKeyRef = useRef('')

  useLayoutEffect(() => {
    if (!isVideoStudio) return
    if (!latestRevealHistoryKey) {
      previousLatestRevealHistoryKeyRef.current = ''
      return
    }
    if (previousLatestRevealHistoryKeyRef.current === latestRevealHistoryKey) return
    previousLatestRevealHistoryKeyRef.current = latestRevealHistoryKey
    historyTailRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
  }, [isVideoStudio, latestRevealHistoryKey])

  if (state.historyTasks.length === 0) {
    return isVideoStudio ? (
      <VideoLightbox
        asset={lightboxAsset}
        open={Boolean(lightboxAsset)}
        onOpenChange={(next) => {
          if (!next) setLightboxAsset(null)
        }}
      />
    ) : (
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
        {state.historyTasks.map((task) =>
          isVideoStudio ? (
            <VideoHistoryTaskSection
              key={task.id}
              task={task}
              state={state}
              onOpenAsset={(asset) => setLightboxAsset(asset)}
            />
          ) : (
            <HistoryTaskSection
              key={task.id}
              task={task}
              state={state}
              onOpenAsset={(asset) => setLightboxAsset(asset)}
            />
          )
        )}
        <div aria-hidden="true" className="w-full shrink-0" style={{ height: `${Math.max(0, bottomSpacerHeight)}px` }} />
        <div ref={historyTailRef} aria-hidden="true" className="h-px w-full shrink-0" />
      </div>

      {isVideoStudio ? (
        <VideoLightbox
          asset={lightboxAsset}
          open={Boolean(lightboxAsset)}
          onOpenChange={(next) => {
            if (!next) setLightboxAsset(null)
          }}
        />
      ) : (
        <ImageLightbox
          asset={lightboxAsset}
          open={Boolean(lightboxAsset)}
          onOpenChange={(next) => {
            if (!next) setLightboxAsset(null)
          }}
        />
      )}
    </>
  )
}

export { ResultPanel }
