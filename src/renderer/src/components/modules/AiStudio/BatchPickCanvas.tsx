import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { ArrowLeft, Check } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import {
  AI_STUDIO_NOTE_MATERIAL_DRAG_MIME,
  buildNoteMaterialDragPayload
} from './noteMaterialDragPayload'
import {
  BATCH_PICK_TILE_EMPTY_STATE_CLASS,
  BATCH_PICK_TILE_MEDIA_CLASS,
  BATCH_PICK_TILE_USED_BADGE_CLASS,
  resolveBatchPickTileOverlayClass,
  resolveBatchPickTileSelectionIndicatorClass
} from './batchPickTileClassHelpers'
import { buildSelectableBatchPickAssetIds } from './batchPickHelpers'
import type { AiStudioAssetRecord } from './useAiStudioState'

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function intersectRectangles(
  selectionRect: { left: number; top: number; right: number; bottom: number },
  tileRect: { left: number; top: number; right: number; bottom: number }
): boolean {
  return !(
    tileRect.right < selectionRect.left ||
    tileRect.left > selectionRect.right ||
    tileRect.bottom < selectionRect.top ||
    tileRect.top > selectionRect.bottom
  )
}

const BatchPickTile = memo(function BatchPickTile({
  asset,
  workspacePath,
  isSelected,
  isUsed,
  dragPayload,
  onToggleAsset
}: {
  asset: AiStudioAssetRecord
  workspacePath: string
  isSelected: boolean
  isUsed: boolean
  dragPayload: string
  onToggleAsset: (assetId: string) => void
}): React.JSX.Element {
  const src = useMemo(
    () => resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath),
    [asset.filePath, asset.previewPath, workspacePath]
  )

  return (
    <button
      type="button"
      data-batch-pick-tile="true"
      data-batch-pick-asset-id={asset.id}
      data-batch-pick-used={isUsed ? 'true' : 'false'}
      draggable={Boolean(dragPayload) && !isUsed}
      onClick={() => {
        if (isUsed) return
        onToggleAsset(asset.id)
      }}
      onDragStart={(event) => {
        if (!dragPayload || isUsed) {
          event.preventDefault()
          return
        }
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(AI_STUDIO_NOTE_MATERIAL_DRAG_MIME, dragPayload)
        event.dataTransfer.setData('text/plain', dragPayload)
      }}
      className={cn(
        'group relative overflow-hidden rounded-[8px] border bg-transparent text-left transition-transform duration-150 ease-out',
        isSelected
          ? 'border-sky-500/85 shadow-[0_0_0_2px_rgba(96,165,250,0.78),0_12px_30px_rgba(15,23,42,0.10)]'
          : isUsed
            ? 'cursor-default border-transparent shadow-none'
            : 'border-transparent shadow-none hover:-translate-y-[1px] hover:shadow-[0_16px_34px_rgba(15,23,42,0.05)]'
      )}
      style={{ contain: 'layout paint style' }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className={BATCH_PICK_TILE_MEDIA_CLASS}
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={BATCH_PICK_TILE_EMPTY_STATE_CLASS} />
      )}

      <div className={resolveBatchPickTileOverlayClass({ isSelected, isUsed })} />

      {!isUsed ? (
        <div className={resolveBatchPickTileSelectionIndicatorClass(isSelected)}>
          <Check className="h-3 w-3" strokeWidth={2.1} />
        </div>
      ) : null}

      {isUsed ? (
        <div className={BATCH_PICK_TILE_USED_BADGE_CLASS}>
          已使用
        </div>
      ) : null}
    </button>
  )
})

function BatchPickCanvas({
  assets,
  selectedAssetIds,
  usedAssetIds,
  onToggleAsset,
  onSelectionChange,
  onExit,
  reservedSidebarWidth
}: {
  assets: AiStudioAssetRecord[]
  selectedAssetIds: string[]
  usedAssetIds: string[]
  onToggleAsset: (assetId: string) => void
  onSelectionChange: (nextAssetIds: string[]) => void
  onExit: () => void
  reservedSidebarWidth: number
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const selectedSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])
  const usedSet = useMemo(() => new Set(usedAssetIds), [usedAssetIds])
  const selectableAssetIds = useMemo(
    () => buildSelectableBatchPickAssetIds({ assets, usedAssetIds }),
    [assets, usedAssetIds]
  )
  const allSelectableSelected =
    selectableAssetIds.length > 0 && selectableAssetIds.every((assetId) => selectedSet.has(assetId))
  const selectedDragPaths = useMemo(
    () =>
      uniqueStrings(
        assets
          .filter((asset) => selectedSet.has(asset.id) && !usedSet.has(asset.id))
          .map((asset) => String(asset.filePath ?? '').trim())
      ),
    [assets, selectedSet, usedSet]
  )
  const selectedDragPayload = useMemo(
    () => (selectedDragPaths.length > 0 ? buildNoteMaterialDragPayload(selectedDragPaths) : ''),
    [selectedDragPaths]
  )
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const tileRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const gestureRef = useRef<{
    startX: number
    startY: number
    targetAssetId: string | null
  } | null>(null)
  const tileLayoutRef = useRef<
    Array<{ id: string; left: number; top: number; right: number; bottom: number }>
  >([])
  const lastEmittedSelectionRef = useRef<string[]>(selectedAssetIds)
  const suppressTileClickRef = useRef(false)
  const [selectionBox, setSelectionBox] = useState<{
    startX: number
    startY: number
    endX: number
    endY: number
  } | null>(null)

  const selectionOverlayStyle = selectionBox
    ? {
        left: `${Math.min(selectionBox.startX, selectionBox.endX)}px`,
        top: `${Math.min(selectionBox.startY, selectionBox.endY)}px`,
        width: `${Math.abs(selectionBox.endX - selectionBox.startX)}px`,
        height: `${Math.abs(selectionBox.endY - selectionBox.startY)}px`
      }
    : null
  const reservedCanvasInset = reservedSidebarWidth > 0 ? reservedSidebarWidth + 28 : 0
  const assetLaneStyle =
    reservedCanvasInset > 0 ? { maxWidth: `calc(100% - ${reservedCanvasInset}px)` } : undefined
  const handleTileToggle = useCallback(
    (assetId: string): void => {
      if (suppressTileClickRef.current) return
      onToggleAsset(assetId)
    },
    [onToggleAsset]
  )

  useEffect(() => {
    lastEmittedSelectionRef.current = selectedAssetIds
  }, [selectedAssetIds])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-6">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[14px] font-medium tracking-[0.03em] text-zinc-800">批量选图</div>
            <div className="mt-1 text-[12px] leading-5 text-zinc-400">
              点击选中，或按住鼠标在画布上框选，再拖到右侧创作中心素材区
            </div>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-zinc-200/70 bg-white/84 px-3 text-[11px] font-medium tracking-[0.03em] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-[10px] transition hover:border-zinc-200 hover:bg-white hover:text-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回结果
          </button>
        </div>

        <div
          className="mb-4 flex shrink-0 items-center justify-between px-1 pt-1"
          style={assetLaneStyle}
        >
          <div className="text-[11px] tracking-[0.05em] text-zinc-400">图片池</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                onSelectionChange(allSelectableSelected ? [] : selectableAssetIds)
              }}
              disabled={selectableAssetIds.length === 0}
              className={cn(
                'inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-medium tracking-[0.05em] shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-[8px] transition',
                selectableAssetIds.length > 0
                  ? 'border-zinc-200/70 bg-white/84 text-zinc-500 hover:border-zinc-200 hover:bg-white hover:text-zinc-900'
                  : 'cursor-not-allowed border-zinc-200/55 bg-white/65 text-zinc-300'
              )}
            >
              {allSelectableSelected ? '取消全选' : '全选'}
            </button>
            <div className="text-[11px] tracking-[0.05em] text-zinc-400">
              已选 {selectedAssetIds.length} / {assets.length}
            </div>
          </div>
        </div>

        <div
          ref={surfaceRef}
          onPointerDownCapture={(event) => {
            if (event.button !== 0) return
            const surface = surfaceRef.current
            if (!surface) return

            const target = event.target as HTMLElement | null
            const tileElement =
              target?.closest<HTMLElement>('[data-batch-pick-tile="true"]') ?? null
            const interactiveElement =
              target?.closest<HTMLElement>('button,a,input,textarea,select,[role="button"]') ?? null
            if (interactiveElement && !tileElement) return
            const targetAssetId = String(tileElement?.dataset.batchPickAssetId ?? '').trim() || null
            if (targetAssetId && usedSet.has(targetAssetId)) return
            if (targetAssetId && selectedSet.has(targetAssetId)) return

            event.preventDefault()
            const surfaceRect = surface.getBoundingClientRect()
            const startX = event.clientX - surfaceRect.left + surface.scrollLeft
            const startY = event.clientY - surfaceRect.top + surface.scrollTop
            gestureRef.current = { startX, startY, targetAssetId }
            tileLayoutRef.current = assets
              .map((asset) => {
                const tile = tileRefs.current[asset.id]
                if (!tile) return null
                const tileRect = tile.getBoundingClientRect()
                return {
                  id: asset.id,
                  left: tileRect.left - surfaceRect.left + surface.scrollLeft,
                  top: tileRect.top - surfaceRect.top + surface.scrollTop,
                  right: tileRect.right - surfaceRect.left + surface.scrollLeft,
                  bottom: tileRect.bottom - surfaceRect.top + surface.scrollTop
                }
              })
              .filter(
                (
                  tile
                ): tile is {
                  id: string
                  left: number
                  top: number
                  right: number
                  bottom: number
                } => Boolean(tile)
              )
            suppressTileClickRef.current = false
            lastEmittedSelectionRef.current = selectedAssetIds

            const handlePointerMove = (moveEvent: PointerEvent): void => {
              const currentSurface = surfaceRef.current
              const gesture = gestureRef.current
              if (!currentSurface || !gesture) return

              const currentRect = currentSurface.getBoundingClientRect()
              const endX = moveEvent.clientX - currentRect.left + currentSurface.scrollLeft
              const endY = moveEvent.clientY - currentRect.top + currentSurface.scrollTop
              if (Math.abs(endX - gesture.startX) < 4 && Math.abs(endY - gesture.startY) < 4) return

              suppressTileClickRef.current = true
              const nextBox = {
                startX: gesture.startX,
                startY: gesture.startY,
                endX,
                endY
              }
              setSelectionBox(nextBox)

              const selectionRect = {
                left: Math.min(nextBox.startX, nextBox.endX),
                top: Math.min(nextBox.startY, nextBox.endY),
                right: Math.max(nextBox.startX, nextBox.endX),
                bottom: Math.max(nextBox.startY, nextBox.endY)
              }

              const nextSelectedIds = tileLayoutRef.current
                .filter((tile) => !usedSet.has(tile.id) && intersectRectangles(selectionRect, tile))
                .map((tile) => tile.id)

              if (areStringArraysEqual(lastEmittedSelectionRef.current, nextSelectedIds)) return
              lastEmittedSelectionRef.current = nextSelectedIds
              onSelectionChange(nextSelectedIds)
            }

            const handlePointerUp = (): void => {
              const gesture = gestureRef.current
              gestureRef.current = null
              tileLayoutRef.current = []
              setSelectionBox(null)
              window.removeEventListener('pointermove', handlePointerMove)
              window.removeEventListener('pointerup', handlePointerUp)
              if (!suppressTileClickRef.current && !gesture?.targetAssetId) {
                onSelectionChange([])
              }
              window.setTimeout(() => {
                suppressTileClickRef.current = false
              }, 0)
            }

            window.addEventListener('pointermove', handlePointerMove)
            window.addEventListener('pointerup', handlePointerUp)
          }}
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-transparent [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div
            className="grid content-start gap-4 pb-6"
            style={{
              ...(assetLaneStyle ?? {}),
              gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))'
            }}
          >
            {assets.map((asset) => (
              <div
                key={asset.id}
                ref={(node) => {
                  tileRefs.current[asset.id] = node
                }}
              >
                <BatchPickTile
                  asset={asset}
                  workspacePath={workspacePath}
                  isSelected={selectedSet.has(asset.id)}
                  isUsed={usedSet.has(asset.id)}
                  dragPayload={selectedSet.has(asset.id) ? selectedDragPayload : ''}
                  onToggleAsset={handleTileToggle}
                />
              </div>
            ))}
          </div>

          {selectionOverlayStyle ? (
            <div
              className="pointer-events-none absolute z-20 rounded-[10px] border border-sky-400/85 bg-[rgba(56,189,248,0.24)] shadow-[0_0_0_1px_rgba(186,230,253,0.55),0_16px_40px_rgba(14,165,233,0.14)] backdrop-blur-[1px]"
              style={selectionOverlayStyle}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { BatchPickCanvas }
