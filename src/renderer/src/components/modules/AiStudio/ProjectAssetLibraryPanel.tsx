import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

import { Check, ImagePlus, Plus, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import {
  MAX_AI_STUDIO_REFERENCE_IMAGES,
  type AiStudioAssetRecord,
  type UseAiStudioStateResult
} from './useAiStudioState'

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function basename(filePath: string | null | undefined): string {
  const normalized = normalizeText(filePath)
  if (!normalized) return '未命名图片'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

async function pickLocalImages(): Promise<string[]> {
  const result = await window.electronAPI.openMediaFiles({
    multiSelections: true,
    accept: 'image'
  })
  if (!result) return []
  const items = Array.isArray(result) ? result : [result]
  return Array.from(new Set(items.map((item) => normalizeText(item?.originalPath)).filter(Boolean)))
}

function EmptyProjectAssetPopover({
  anchorRef,
  open,
  onClose,
  onCreate,
  isCreating
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  open: boolean
  onClose: () => void
  onCreate: () => void
  isCreating: boolean
}): React.JSX.Element | null {
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }

    const updatePanelStyle = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = 304
      const left = Math.min(
        Math.max(16, rect.left + rect.width / 2 - width / 2),
        Math.max(16, window.innerWidth - width - 16)
      )
      setPanelStyle({
        width,
        left,
        top: Math.max(16, rect.top - 14),
        transform: 'translateY(-100%)'
      })
    }

    updatePanelStyle()
    window.addEventListener('resize', updatePanelStyle)
    window.addEventListener('scroll', updatePanelStyle, true)
    return () => {
      window.removeEventListener('resize', updatePanelStyle)
      window.removeEventListener('scroll', updatePanelStyle, true)
    }
  }, [anchorRef, open])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      onClose()
    }
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [anchorRef, onClose, open])

  if (!open || !panelStyle || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed z-[260]" style={panelStyle}>
      <div
        ref={panelRef}
        className="rounded-[24px] border border-zinc-200 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.14)]"
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
          项目资产
        </div>
        <div className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-zinc-950">
          当前项目还没有资产
        </div>
        <div className="mt-2 text-sm leading-6 text-zinc-500">
          先把图片纳入这个项目的资产池，之后就能多选加入参考图。
        </div>
        <Button
          type="button"
          className="mt-5 inline-flex h-11 rounded-[16px] border border-zinc-900 bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          onClick={onCreate}
          disabled={isCreating}
        >
          <Plus className="mr-2 h-4 w-4" />
          {isCreating ? '创建中...' : '创建资产'}
        </Button>
      </div>
    </div>,
    document.body
  )
}

function ProjectAssetPickerModal({
  open,
  selectedIds,
  allAssets,
  onClose,
  onToggleAsset,
  onConfirm,
  onCreate,
  isCreating,
  isConfirming
}: {
  open: boolean
  selectedIds: Set<string>
  allAssets: AiStudioAssetRecord[]
  onClose: () => void
  onToggleAsset: (assetId: string) => void
  onConfirm: () => void
  onCreate: () => void
  isCreating: boolean
  isConfirming: boolean
}): React.JSX.Element | null {
  const workspacePath = useCmsStore((store) => store.workspacePath)

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') return null

  const selectedCount = selectedIds.size

  return createPortal(
    <div className="fixed inset-0 z-[280] flex items-center justify-center bg-[rgba(244,246,248,0.72)] p-4 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="关闭资产选取面板"
        onClick={onClose}
      />

      <div className="relative z-10 flex h-[min(78vh,820px)] w-[min(1120px,96vw)] flex-col overflow-hidden rounded-[32px] border border-zinc-200 bg-white shadow-[0_32px_120px_rgba(15,23,42,0.16)]">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-5">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
              项目资产
            </div>
            <div className="mt-2 text-[28px] font-semibold tracking-[-0.05em] text-zinc-950">
              资产选取
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 rounded-[16px] border-zinc-300 bg-white px-4 text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
              onClick={onCreate}
              disabled={isCreating}
            >
              <ImagePlus className="mr-2 h-4 w-4" />
              {isCreating ? '创建中...' : '创建资产'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-950"
              aria-label="关闭资产选取面板"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {allAssets.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {allAssets.map((asset) => {
                const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)
                const selected = selectedIds.has(asset.id)

                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onToggleAsset(asset.id)}
                    className={cn(
                      'group relative overflow-hidden rounded-[20px] border bg-zinc-50 text-left transition',
                      selected
                        ? 'border-zinc-900 shadow-[0_16px_40px_rgba(15,23,42,0.14)]'
                        : 'border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_16px_32px_rgba(15,23,42,0.08)]'
                    )}
                  >
                    <div className="aspect-[4/5] overflow-hidden bg-zinc-100">
                      {src ? (
                        <img
                          src={src}
                          alt={basename(asset.filePath)}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-zinc-400">
                          预览不可用
                        </div>
                      )}
                    </div>

                    <div
                      className={cn(
                        'absolute left-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full border transition',
                        selected
                          ? 'border-zinc-950 bg-zinc-950 text-white'
                          : 'border-white/80 bg-white/80 text-transparent backdrop-blur'
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </div>

                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/48 to-transparent px-2.5 pb-2.5 pt-8">
                      <div className="truncate text-[11px] font-medium text-white/92">
                        {basename(asset.filePath)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-[28px] border border-dashed border-zinc-200 bg-zinc-50/80 text-center">
              <div className="text-[18px] font-semibold tracking-[-0.03em] text-zinc-900">
                当前项目还没有资产
              </div>
              <div className="mt-2 max-w-[320px] text-sm leading-6 text-zinc-500">
                先创建项目资产，再从这里多选加入参考图。
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-5">
          <div className="text-[18px] text-zinc-500">
            已选 <span className="font-semibold text-zinc-950">{selectedCount}</span> 张图片
          </div>
          <Button
            type="button"
            className="h-12 rounded-[18px] border border-zinc-900 bg-zinc-950 px-7 text-base font-medium text-white hover:bg-zinc-800 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
            onClick={onConfirm}
            disabled={selectedCount === 0 || isConfirming}
          >
            {isConfirming ? '加入中...' : '确认'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function ProjectAssetLibraryPanel({
  state,
  hasPromptDraft = false,
  className
}: {
  state: UseAiStudioStateResult
  hasPromptDraft?: boolean
  className?: string
}): React.JSX.Element | null {
  const addLog = useCmsStore((store) => store.addLog)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [showEmptyPopover, setShowEmptyPopover] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const allAssets = state.currentProjectAssetLibrary ?? []

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((assetId) => allAssets.some((asset) => asset.id === assetId))
    )
  }, [allAssets])

  if (state.studioCapability !== 'image') return null

  const handleCreateAssets = async (): Promise<void> => {
    try {
      setIsCreating(true)
      const filePaths = await pickLocalImages()
      if (filePaths.length === 0) return
      const addedAssets = await state.addProjectAssetsToLibrary(filePaths)
      if (addedAssets.length > 0) {
        setSelectedIds((current) =>
          Array.from(new Set([...current, ...addedAssets.map((asset) => asset.id)]))
        )
        addLog(`[AI Studio] 已添加项目资产：${addedAssets.length} 张`)
      }
      setShowEmptyPopover(false)
      setShowPicker(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 创建项目资产失败：${message}`)
      window.alert(`创建项目资产失败：${message}`)
    } finally {
      setIsCreating(false)
    }
  }

  const handleConfirm = async (): Promise<void> => {
    const selectedAssets = allAssets.filter((asset) => selectedIds.includes(asset.id))
    const selectedPaths = selectedAssets
      .map((asset) => normalizeText(asset.filePath))
      .filter(Boolean)
    if (selectedPaths.length === 0) return

    try {
      setIsConfirming(true)
      const existingSet = new Set(
        (state.activeInputAssets ?? [])
          .map((asset) => normalizeText(asset.filePath))
          .filter(Boolean)
      )
      const incoming = selectedPaths.filter((filePath) => !existingSet.has(filePath))
      const availableSlots = Math.max(
        0,
        MAX_AI_STUDIO_REFERENCE_IMAGES - (state.activeInputAssets?.length ?? 0)
      )
      const accepted = incoming.slice(0, availableSlots)
      const overflow = Math.max(0, incoming.length - accepted.length)

      if (accepted.length === 0) {
        if (overflow > 0) {
          window.alert(
            `最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张参考图，已忽略超出的 ${overflow} 张。`
          )
          return
        }
        window.alert('所选资产已都在当前参考图里。')
        return
      }

      const nextPrimaryImagePath = state.primaryImagePath ?? accepted[0] ?? null
      const nextReferenceImagePaths = state.primaryImagePath
        ? [...state.referenceImagePaths, ...accepted]
        : [...state.referenceImagePaths, ...accepted.slice(1)]
      const shouldConfirmReset =
        hasPromptDraft || Boolean(state.primaryImagePath) || state.referenceImagePaths.length > 0

      await state.applyInputSelection(
        {
          primaryImagePath: nextPrimaryImagePath,
          referenceImagePaths: nextReferenceImagePaths
        },
        {
          confirmReset: shouldConfirmReset
        }
      )

      addLog(`[AI Studio] 已从项目资产加入参考图：${accepted.length} 张`)
      if (overflow > 0) {
        window.alert(
          `最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张参考图，已忽略超出的 ${overflow} 张。`
        )
      }
      setShowPicker(false)
      setSelectedIds([])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 从项目资产加入参考图失败：${message}`)
      window.alert(`从项目资产加入参考图失败：${message}`)
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (allAssets.length === 0) {
            setShowEmptyPopover((current) => !current)
            setShowPicker(false)
            return
          }
          setShowEmptyPopover(false)
          setShowPicker(true)
        }}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-[0_8px_20px_rgba(15,23,42,0.06)] transition hover:border-zinc-300 hover:text-zinc-950',
          className
        )}
      >
        <ImagePlus className="h-3.5 w-3.5" />
        <span>资产</span>
      </button>

      <EmptyProjectAssetPopover
        anchorRef={triggerRef}
        open={showEmptyPopover}
        onClose={() => setShowEmptyPopover(false)}
        onCreate={() => void handleCreateAssets()}
        isCreating={isCreating}
      />

      <ProjectAssetPickerModal
        open={showPicker}
        selectedIds={new Set(selectedIds)}
        allAssets={allAssets}
        onClose={() => {
          setShowPicker(false)
          setSelectedIds([])
        }}
        onToggleAsset={(assetId) => {
          setSelectedIds((current) =>
            current.includes(assetId)
              ? current.filter((currentId) => currentId !== assetId)
              : [...current, assetId]
          )
        }}
        onConfirm={() => void handleConfirm()}
        onCreate={() => void handleCreateAssets()}
        isCreating={isCreating}
        isConfirming={isConfirming}
      />
    </>
  )
}
