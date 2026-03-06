import { useMemo, useState } from 'react'
import type * as React from 'react'

import { ImagePlus, Images, Sparkles, Trash2, UploadCloud } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import {
  MAX_AI_STUDIO_REFERENCE_IMAGES,
  type AiStudioAssetRecord,
  type UseAiStudioStateResult
} from './useAiStudioState'

type DragTarget = 'primary' | 'reference' | null

type MediaSelectionLike = {
  originalPath?: string
  mediaType?: 'image' | 'video'
}

type ElectronPathFile = File & { path?: string }

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未设置'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function isSupportedImagePath(filePath: string): boolean {
  return /\.(jpg|jpeg|png|webp|heic)$/i.test(String(filePath ?? '').trim())
}

function fileSystemPathFromFile(file: File): string | undefined {
  const fromWebUtils = window.electronAPI?.getPathForFile?.(file)
  if (typeof fromWebUtils === 'string') {
    const normalized = fromWebUtils.trim()
    if (normalized) return normalized
  }

  const maybe = file as ElectronPathFile
  if (typeof maybe.path !== 'string') return undefined
  const normalized = maybe.path.trim()
  return normalized || undefined
}

function getDroppedImagePaths(files: FileList | File[]): string[] {
  return Array.from(files)
    .map((file) => fileSystemPathFromFile(file))
    .filter(
      (filePath): filePath is string =>
        typeof filePath === 'string' && isSupportedImagePath(filePath)
    )
}

function PreviewTile({
  asset,
  title,
  hint,
  active,
  onClick,
  onRemove,
  compact = false
}: {
  asset: AiStudioAssetRecord | null
  title: string
  hint: string
  active?: boolean
  onClick: () => void
  onRemove?: () => void
  compact?: boolean
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset?.previewPath ?? asset?.filePath ?? '', workspacePath)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-zinc-950/80 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
        compact ? 'aspect-square' : 'aspect-[3/4]',
        active
          ? 'border-zinc-500 shadow-[0_0_0_1px_rgba(255,255,255,0.1)]'
          : 'border-zinc-800 hover:border-zinc-700'
      )}
    >
      {src ? (
        <>
          <img
            src={src}
            alt={basename(asset?.filePath)}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05),rgba(0,0,0,0.7))]" />
          <div className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-zinc-100 backdrop-blur">
            {title}
          </div>
          {onRemove ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove()
              }}
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/45 text-zinc-100 backdrop-blur transition hover:bg-black/60"
              aria-label={`移除${title}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
          <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur">
            <div className="truncate text-sm text-zinc-100">{basename(asset?.filePath)}</div>
            <div className="mt-1 text-[11px] text-zinc-400">点击或拖拽替换</div>
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-zinc-500">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/90 text-zinc-400">
            {compact ? <Images className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm text-zinc-200">{title}</div>
            <div className="mt-1 text-xs text-zinc-500">{hint}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskQueue({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const [dragTarget, setDragTarget] = useState<DragTarget>(null)
  const [isPickingPrimary, setIsPickingPrimary] = useState(false)
  const [isPickingReferences, setIsPickingReferences] = useState(false)

  const primaryAsset =
    state.activeInputAssets.find((asset) => asset.filePath === state.primaryImagePath) ?? null
  const referenceAssets = state.activeInputAssets.filter((asset) =>
    state.referenceImagePaths.includes(asset.filePath)
  )
  const referenceCount = referenceAssets.length
  const hasResetRisk = useMemo(() => {
    const task = state.activeTask
    if (!task) return false
    return task.outputAssets.length > 0 || Boolean(task.remoteTaskId) || Boolean(task.latestRunId)
  }, [state.activeTask])

  const pickPrimaryImage = async (): Promise<void> => {
    if (isPickingPrimary) return
    try {
      setIsPickingPrimary(true)
      const result = await window.electronAPI.openMediaFiles({ accept: 'image' })
      if (!result) return
      const items = Array.isArray(result) ? result : [result]
      const picked =
        (items as MediaSelectionLike[]).find((item) => item?.mediaType === 'image') ?? null
      const filePath = String(picked?.originalPath ?? '').trim()
      if (!filePath) return
      await state.assignPrimaryImage(filePath)
      addLog(`[AI Studio] 已设置主图：${basename(filePath)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 选择主图失败：${message}`)
      window.alert(`选择主图失败：${message}`)
    } finally {
      setIsPickingPrimary(false)
    }
  }

  const addReferenceImages = async (filePaths: string[]): Promise<void> => {
    const normalized = filePaths.filter((filePath) => isSupportedImagePath(filePath))
    if (normalized.length === 0) {
      window.alert('未检测到可用图片，请选择 jpg/jpeg/png/webp/heic 文件。')
      return
    }
    const { added, overflow } = await state.addReferenceImages(normalized)
    if (added > 0) {
      addLog(`[AI Studio] 已添加参考图：${added} 张`)
    }
    if (overflow > 0) {
      window.alert(
        `最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张参考图，已忽略超出的 ${overflow} 张。`
      )
    }
  }

  const pickReferenceImages = async (): Promise<void> => {
    if (isPickingReferences) return
    if (referenceCount >= MAX_AI_STUDIO_REFERENCE_IMAGES) {
      window.alert(`参考图最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张。`)
      return
    }
    try {
      setIsPickingReferences(true)
      const result = await window.electronAPI.openMediaFiles({
        multiSelections: true,
        accept: 'image'
      })
      if (!result) return
      const items = Array.isArray(result) ? result : [result]
      const filePaths = (items as MediaSelectionLike[])
        .filter((item) => item?.mediaType === 'image')
        .map((item) => String(item.originalPath ?? '').trim())
        .filter(Boolean)
      if (filePaths.length === 0) return
      await addReferenceImages(filePaths)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 选择参考图失败：${message}`)
      window.alert(`选择参考图失败：${message}`)
    } finally {
      setIsPickingReferences(false)
    }
  }

  const handleDrop = async (
    event: React.DragEvent<HTMLDivElement>,
    target: DragTarget
  ): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setDragTarget(null)

    const droppedFiles = Array.from(event.dataTransfer.files)
    const filePaths = getDroppedImagePaths(droppedFiles)
    if (filePaths.length === 0) {
      const fileNames = droppedFiles.map((file) => file.name).filter(Boolean)
      addLog(
        `[AI Studio] 拖拽未获取到可用图片路径：${fileNames.join(', ') || 'empty'}，请确认拖入的是本地图片文件。`
      )
      window.alert('拖入失败：未检测到本地图片路径，请从 Finder 拖入 jpg/jpeg/png/webp/heic 文件。')
      return
    }

    if (target === 'primary') {
      await state.assignPrimaryImage(filePaths[0] ?? null)
      addLog(`[AI Studio] 已拖入主图：${basename(filePaths[0])}`)
      if (filePaths.length > 1) {
        window.alert('主图只支持 1 张，已使用拖入的第一张图片。')
      }
      return
    }

    await addReferenceImages(filePaths)
  }

  const placeholderCount = Math.max(0, MAX_AI_STUDIO_REFERENCE_IMAGES - referenceAssets.length)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">
              Single Task Mode
            </div>
            <div className="mt-2 text-lg font-medium text-zinc-50">素材输入</div>
          </div>
          <div className="rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-400">
            1 主图 / {MAX_AI_STUDIO_REFERENCE_IMAGES} 参考图
          </div>
        </div>
        <div className="mt-3 text-sm leading-6 text-zinc-400">
          点击选择或直接拖拽图片到对应区域。主图必填，参考图可选，用于补充角度、材质或构图提示。
        </div>
        {hasResetRisk ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
            <Sparkles className="h-3.5 w-3.5" />
            更换当前素材会清空已有结果并重置为草稿
          </div>
        ) : null}
      </div>

      <div className="space-y-4 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-100">主图</div>
              <div className="mt-1 text-xs text-zinc-500">
                单次任务必填，建议使用最能代表商品正面的图片。
              </div>
            </div>
            {primaryAsset ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void state.assignPrimaryImage(null)}
              >
                清空
              </Button>
            ) : null}
          </div>
          <div
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'copy'
              setDragTarget('primary')
            }}
            onDragLeave={(event) => {
              event.stopPropagation()
              setDragTarget((prev) => (prev === 'primary' ? null : prev))
            }}
            onDrop={(event) => void handleDrop(event, 'primary')}
            className={cn(
              'rounded-2xl transition',
              dragTarget === 'primary' && 'ring-2 ring-zinc-500 ring-offset-2 ring-offset-zinc-950'
            )}
          >
            <PreviewTile
              asset={primaryAsset}
              title="主图"
              hint={isPickingPrimary ? '正在打开图片选择器...' : '点击选择主图，或把图片拖到这里'}
              active={dragTarget === 'primary'}
              onClick={() => void pickPrimaryImage()}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-100">参考图</div>
              <div className="mt-1 text-xs text-zinc-500">
                可选，最多 {MAX_AI_STUDIO_REFERENCE_IMAGES} 张。用于补充材质、角度、氛围与细节。
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void pickReferenceImages()}
              disabled={isPickingReferences || referenceCount >= MAX_AI_STUDIO_REFERENCE_IMAGES}
            >
              <ImagePlus className="h-4 w-4" />
              {referenceCount === 0 ? '添加参考图' : '继续添加'}
            </Button>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.dataTransfer.dropEffect = 'copy'
              setDragTarget('reference')
            }}
            onDragLeave={(event) => {
              event.stopPropagation()
              setDragTarget((prev) => (prev === 'reference' ? null : prev))
            }}
            onDrop={(event) => void handleDrop(event, 'reference')}
            className={cn(
              'rounded-2xl border border-dashed border-zinc-800 p-3 transition',
              dragTarget === 'reference' && 'border-zinc-500 bg-zinc-900/70'
            )}
          >
            <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
              <span>拖拽到这里可直接追加参考图</span>
              <span>
                {referenceCount}/{MAX_AI_STUDIO_REFERENCE_IMAGES}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {referenceAssets.map((asset) => (
                <PreviewTile
                  key={asset.id}
                  asset={asset}
                  title="参考图"
                  hint="点击添加或拖拽追加"
                  compact
                  onClick={() => void pickReferenceImages()}
                  onRemove={() => void state.removeReferenceImage(asset.filePath)}
                />
              ))}
              {Array.from({ length: placeholderCount }).map((_, index) => (
                <PreviewTile
                  key={`placeholder-${index}`}
                  asset={null}
                  title={`参考图 ${referenceAssets.length + index + 1}`}
                  hint="点击选择，或拖拽图片到这里"
                  compact
                  active={dragTarget === 'reference'}
                  onClick={() => void pickReferenceImages()}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { TaskQueue }
