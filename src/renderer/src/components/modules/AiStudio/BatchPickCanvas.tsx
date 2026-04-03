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
  dragPayload,
  onToggleAsset
}: {
  asset: AiStudioAssetRecord
  workspacePath: string
  isSelected: boolean
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
      draggable={Boolean(dragPayload)}
      onClick={() => onToggleAsset(asset.id)}
      onDragStart={(event) => {
        if (!dragPayload) {
          event.preventDefault()
          return
        }
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(AI_STUDIO_NOTE_MATERIAL_DRAG_MIME, dragPayload)
      }}
      className={cn(
        'group relative overflow-hidden rounded-[20px] border bg-white text-left transition-transform duration-150 ease-out',
        isSelected
          ? 'border-sky-500 shadow-[0_18px_42px_rgba(14,165,233,0.18)]'
          : 'border-zinc-200/90 shadow-[0_8px_22px_rgba(15,23,42,0.04)] hover:-translate-y-[1px] hover:border-zinc-300 hover:shadow-[0_16px_34px_rgba(15,23,42,0.08)]'
      )}
      style={{ contain: 'layout paint style' }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="block aspect-[4/5] w-full bg-zinc-100 object-cover"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="aspect-[4/5] w-full bg-zinc-100" />
      )}

      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-[20px] transition',
          isSelected
            ? 'bg-sky-500/16 ring-[3px] ring-inset ring-sky-500 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.9)]'
            : 'bg-transparent'
        )}
      />

      <div
        className={cn(
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-[0_10px_24px_rgba(15,23,42,0.16)] transition',
          isSelected
            ? 'border-sky-500 bg-sky-500 text-white'
            : 'border-white/92 bg-white/96 text-transparent backdrop-blur-[4px] group-hover:text-zinc-300'
        )}
      >
        <Check className="h-4 w-4" />
      </div>

      {isSelected ? (
        <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center rounded-full border border-sky-500/70 bg-white/92 px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-sky-700 shadow-[0_8px_18px_rgba(14,165,233,0.12)]">
          已选中
        </div>
      ) : null}
    </button>
  )
})

function BatchPickCanvas({
  assets,
  selectedAssetIds,
  onToggleAsset,
  onSelectionChange,
  onExit,
  reservedSidebarWidth
}: {
  assets: AiStudioAssetRecord[]
  selectedAssetIds: string[]
  onToggleAsset: (assetId: string) => void
  onSelectionChange: (nextAssetIds: string[]) => void
  onExit: () => void
  reservedSidebarWidth: number
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const selectedSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds])
  const selectedDragPaths = useMemo(
    () =>
      uniqueStrings(
        assets
          .filter((asset) => selectedSet.has(asset.id))
          .map((asset) => String(asset.filePath ?? '').trim())
      ),
    [assets, selectedSet]
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
  const canvasColumnStyle =
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
      <div className="flex min-h-0 flex-1 flex-col" style={canvasColumnStyle}>
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
            className="inline-flex h-8 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-[11px] font-medium tracking-[0.03em] text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回结果
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <div className="text-[11px] tracking-[0.05em] text-zinc-400">线程图片池</div>
          <div className="text-[11px] tracking-[0.05em] text-zinc-400">
            已选 {selectedAssetIds.length} / {assets.length}
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
            const targetAssetId = String(tileElement?.dataset.batchPickAssetId ?? '').trim() || null
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
                .filter((tile) => intersectRectangles(selectionRect, tile))
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
          className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_14px_40px_rgba(15,23,42,0.05)]"
          style={{ overscrollBehavior: 'contain' }}
        >
          <div className="h-full overflow-x-hidden overflow-y-auto p-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div
              className="grid content-start gap-4 pb-6"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
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
                    dragPayload={selectedSet.has(asset.id) ? selectedDragPayload : ''}
                    onToggleAsset={handleTileToggle}
                  />
                </div>
              ))}
            </div>
          </div>

          {selectionOverlayStyle ? (
            <div
              className="pointer-events-none absolute rounded-[16px] border-2 border-sky-500/85 bg-sky-400/14 shadow-[0_0_0_1px_rgba(186,230,253,0.4),0_16px_40px_rgba(14,165,233,0.12)]"
              style={selectionOverlayStyle}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { BatchPickCanvas }
