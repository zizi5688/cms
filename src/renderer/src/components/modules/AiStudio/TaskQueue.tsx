import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

import { ArrowRightLeft, History, ImagePlus, Sparkles, Trash2, Upload, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

import {
  MAX_AI_STUDIO_REFERENCE_IMAGES,
  type AiStudioAssetRecord,
  type UseAiStudioStateResult
} from './useAiStudioState'

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

function uniqueStrings(values: string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()

  values.forEach((value) => {
    const normalized = String(value ?? '').trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    next.push(normalized)
  })

  return next
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

type PromptTemplateOption = UseAiStudioStateResult['templates'][number]

function buildTemplatePreview(promptText: string): string {
  const normalized = String(promptText ?? '').trim()
  if (!normalized) return '暂无模板内容'
  return normalized
}

function mergePromptDraft(currentPrompt: string, incomingPrompt: string): string {
  const normalizedIncoming = String(incomingPrompt ?? '').trim()
  if (!normalizedIncoming) return String(currentPrompt ?? '').trim()

  const normalizedCurrent = String(currentPrompt ?? '').trim()
  if (!normalizedCurrent) return normalizedIncoming
  if (normalizedCurrent.includes(normalizedIncoming)) return normalizedCurrent
  return `${normalizedCurrent}

${normalizedIncoming}`
}

function PromptTemplateModal({
  open,
  title,
  name,
  promptText,
  isSaving,
  onNameChange,
  onPromptTextChange,
  onClose,
  onSave
}: {
  open: boolean
  title: string
  name: string
  promptText: string
  isSaving: boolean
  onNameChange: (value: string) => void
  onPromptTextChange: (value: string) => void
  onClose: () => void
  onSave: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/35 p-4 backdrop-blur-sm [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <button
        type="button"
        className="absolute inset-0"
        aria-label="关闭模板弹窗"
        onClick={onClose}
      />
      <div className="relative z-10 my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-[560px] flex-col rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_30px_100px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-zinc-950">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900"
            aria-label="关闭模板弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className="mt-5 flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-700">模板名字</span>
            <Input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="例如：人物仿图 / 商品精修 / 服饰换装"
              className="h-11 rounded-[16px] border-zinc-200 bg-zinc-50 px-4 text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-zinc-300"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-zinc-700">提示词内容</span>
            <Textarea
              value={promptText}
              onChange={(event) => onPromptTextChange(event.target.value)}
              placeholder="输入这个模板对应的提示词内容..."
              className="min-h-[180px] resize-none rounded-[18px] border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-7 text-zinc-950 placeholder:text-zinc-400 focus-visible:ring-zinc-300 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            />
          </label>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-[16px] border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900"
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="button"
            className="rounded-[16px] bg-zinc-950 text-white hover:bg-zinc-800"
            onClick={onSave}
            disabled={isSaving}
          >
            保存模板
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function QuickInsertPopover({
  templates,
  onCreate,
  onInsert,
  onEdit,
  onDelete
}: {
  templates: PromptTemplateOption[]
  onCreate: () => void
  onInsert: (template: PromptTemplateOption) => void
  onEdit: (template: PromptTemplateOption) => void
  onDelete: (template: PromptTemplateOption) => void
}): React.JSX.Element {
  const [hoveredPreview, setHoveredPreview] = useState<
    { type: 'create' } | { type: 'template'; template: PromptTemplateOption } | null
  >(null)

  return (
    <div className="group/quick relative shrink-0 self-start pr-2 -mr-2">
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100/90 px-2.5 text-[11px] font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-white hover:text-zinc-700"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate max-[1180px]:hidden">快捷插入</span>
      </button>

      <div
        className="pointer-events-none absolute bottom-full left-0 z-[120] pb-2 opacity-0 transition duration-150 group-hover/quick:pointer-events-auto group-hover/quick:opacity-100 group-focus-within/quick:pointer-events-auto group-focus-within/quick:opacity-100"
        onMouseLeave={() => setHoveredPreview(null)}
      >
        <div className="relative w-[252px] rounded-[20px] border border-zinc-200 bg-white p-1.5 shadow-[0_22px_48px_rgba(15,23,42,0.16)]">
          <div
            className="max-h-[170px] overflow-y-auto pr-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            <div className="grid grid-cols-3 gap-1">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={onCreate}
                  onMouseEnter={() => setHoveredPreview({ type: 'create' })}
                  onFocus={() => setHoveredPreview({ type: 'create' })}
                  className="flex h-8 w-full items-center justify-center rounded-[11px] border border-dashed border-zinc-300 bg-zinc-50/85 px-1.5 text-center text-[11px] font-medium text-zinc-900 transition hover:border-zinc-400 hover:bg-white"
                  title="新增模板"
                >
                  <span className="block w-full truncate">新增模板</span>
                </button>
              </div>

              {templates.map((template) => (
                <div key={template.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onInsert(template)}
                    onMouseEnter={() => setHoveredPreview({ type: 'template', template })}
                    onFocus={() => setHoveredPreview({ type: 'template', template })}
                    className="flex h-8 w-full items-center justify-center rounded-[11px] border border-zinc-200 bg-zinc-50/70 px-1.5 text-center text-[11px] font-medium text-zinc-900 transition hover:border-zinc-300 hover:bg-white"
                    title={template.name}
                  >
                    <span className="block w-full truncate">{template.name}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {hoveredPreview ? (
            <div
              className="absolute left-full top-0 z-[140] pl-2"
              onMouseEnter={() => setHoveredPreview((prev) => prev)}
            >
              <div className="absolute inset-y-0 left-0 w-2" />
              <div className="w-[248px] rounded-[20px] border border-zinc-200 bg-white p-3 shadow-[0_22px_48px_rgba(15,23,42,0.16)]">
                {hoveredPreview.type === 'create' ? (
                  <div className="text-[12px] leading-5 text-zinc-600">
                    录入模板名字和提示词内容，后续就能从这里快速插入到本次输入框。
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-[13px] font-medium leading-5 text-zinc-900">
                        <span className="block truncate">{hoveredPreview.template.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className="text-[11px] font-medium text-zinc-500 transition hover:text-zinc-900"
                          onClick={(event) => {
                            event.stopPropagation()
                            onEdit(hoveredPreview.template)
                          }}
                        >
                          修改
                        </button>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-rose-500 transition hover:text-rose-600"
                          onClick={(event) => {
                            event.stopPropagation()
                            onDelete(hoveredPreview.template)
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div
                      className="mt-2 max-h-[176px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-zinc-600 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                      {buildTemplatePreview(hoveredPreview.template.promptText)}
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function UploadMenuContent({
  onUpload,
  disabled
}: {
  onUpload: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onUpload()
        }}
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center gap-2 whitespace-nowrap rounded-[14px] border border-zinc-200 bg-white px-3 text-left text-sm text-zinc-700 transition hover:bg-zinc-100',
          disabled && 'cursor-wait opacity-70'
        )}
      >
        <Upload className="h-4 w-4" />
        <span>本地上传</span>
      </button>
      <button
        type="button"
        disabled
        className="flex h-9 w-full items-center gap-2 whitespace-nowrap rounded-[14px] border border-zinc-200 bg-zinc-50 px-3 text-left text-sm text-zinc-400"
      >
        <History className="h-4 w-4" />
        <span>从历史选择</span>
      </button>
    </div>
  )
}

function AddThumbTrigger({
  onUpload,
  disabled
}: {
  onUpload: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="group/thumb relative shrink-0 pr-3 -mr-3">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
        }}
        disabled={disabled}
        className={cn(
          'flex h-[74px] w-[56px] items-center justify-center rounded-[14px] border border-dashed border-zinc-300 bg-white text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-700',
          disabled && 'cursor-wait opacity-70'
        )}
        aria-label="继续添加参考图"
      >
        <ImagePlus className="h-4 w-4" />
      </button>
      <div className="pointer-events-none absolute left-full top-1/2 z-[60] -translate-y-1/2 translate-x-1 opacity-0 transition duration-150 group-hover/thumb:pointer-events-auto group-hover/thumb:translate-x-0 group-hover/thumb:opacity-100 group-focus-within/thumb:pointer-events-auto group-focus-within/thumb:translate-x-0 group-focus-within/thumb:opacity-100">
        <div className="w-[184px] rounded-[20px] border border-zinc-200 bg-white p-3 shadow-[0_22px_48px_rgba(15,23,42,0.16)]">
          <UploadMenuContent onUpload={onUpload} disabled={disabled} />
        </div>
      </div>
    </div>
  )
}

function HoverPanel({
  assets,
  canAddMore,
  onUpload,
  onPreview,
  onRemove,
  disabled
}: {
  assets?: AiStudioAssetRecord[]
  canAddMore?: boolean
  onUpload: () => void
  onPreview?: (asset: AiStudioAssetRecord) => void
  onRemove?: (asset: AiStudioAssetRecord) => void
  disabled?: boolean
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const previewAssets = (assets ?? []).slice(0, MAX_AI_STUDIO_REFERENCE_IMAGES)
  const hasAssets = previewAssets.length > 0

  return (
    <div className="pointer-events-none absolute left-full top-1/2 z-50 flex items-center -translate-y-1/2 translate-x-1 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100">
      <div className="w-3 shrink-0" />
      <div
        className={cn(
          'rounded-[22px] border border-zinc-200 bg-white p-3 shadow-[0_22px_48px_rgba(15,23,42,0.16)]',
          hasAssets ? 'w-max' : 'w-[156px]'
        )}
      >
        {hasAssets ? (
          <div className="relative flex items-center gap-2 rounded-[18px] border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            {previewAssets.map((asset) => {
              const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)
              return (
                <div
                  key={asset.id}
                  className="group/thumb-item relative overflow-hidden rounded-[14px] border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300"
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onPreview?.(asset)
                    }}
                    className="block"
                  >
                    <div className="h-[74px] w-[56px] overflow-hidden bg-zinc-100">
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
                          <ImagePlus className="h-4 w-4" />
                        </div>
                      )}
                    </div>
                  </button>
                  {onRemove ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemove(asset)
                      }}
                      className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 opacity-0 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 group-hover/thumb-item:opacity-100"
                      aria-label="删除该参考图"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              )
            })}
            {canAddMore ? <AddThumbTrigger onUpload={onUpload} disabled={disabled} /> : null}
          </div>
        ) : (
          <UploadMenuContent onUpload={onUpload} disabled={disabled} />
        )}
      </div>
    </div>
  )
}

function EmptyReferenceCard({
  onUpload,
  disabled
}: {
  onUpload: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="group relative h-[104px] w-[78px] shrink-0">
      <button
        type="button"
        onClick={onUpload}
        disabled={disabled}
        className={cn(
          'flex h-full w-full items-center justify-center rounded-[22px] border border-dashed border-zinc-300 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(244,244,245,0.92))] text-zinc-400 shadow-sm transition hover:border-zinc-400 hover:text-zinc-700',
          disabled && 'cursor-wait opacity-70'
        )}
        aria-label="添加参考图"
      >
        <ImagePlus className="h-5 w-5" />
      </button>
      <HoverPanel
        onUpload={onUpload}
        canAddMore
        onPreview={undefined}
        onRemove={undefined}
        disabled={disabled}
      />
    </div>
  )
}

function ReferenceStackCard({
  assets,
  canAddMore,
  disabled,
  onUpload,
  onPreview,
  onRemoveFront
}: {
  assets: AiStudioAssetRecord[]
  canAddMore: boolean
  disabled?: boolean
  onUpload: () => void
  onPreview: (asset: AiStudioAssetRecord) => void
  onRemoveFront: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const previewAssets = assets.slice(0, 3)
  const frontAsset = assets[0] ?? null
  const fanLayouts =
    previewAssets.length >= 3
      ? [
          { x: -6, y: 1, rotate: -3.5 },
          { x: -3, y: 0.5, rotate: -1.8 },
          { x: 0, y: 0, rotate: 0.4 }
        ]
      : previewAssets.length === 2
        ? [
            { x: -3.5, y: 0.5, rotate: -2.2 },
            { x: 0, y: 0, rotate: 0.4 }
          ]
        : [{ x: 0, y: 0, rotate: 0 }]

  return (
    <div className="group relative h-[108px] w-[84px] shrink-0">
      {previewAssets
        .slice()
        .reverse()
        .map((asset, index) => {
          const layout = fanLayouts[index] ?? fanLayouts[fanLayouts.length - 1]
          const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)

          return (
            <div
              key={asset.id}
              className="absolute bottom-0 right-0 overflow-hidden rounded-[22px] border border-zinc-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition-transform duration-200 group-hover:shadow-[0_16px_32px_rgba(15,23,42,0.14)]"
              style={{
                width: '78px',
                height: '104px',
                zIndex: 10 + index,
                transformOrigin: 'right bottom',
                transform: `translate(${layout.x}px, ${layout.y}px) rotate(${layout.rotate}deg)`
              }}
            >
              {src ? (
                <img
                  src={src}
                  alt={basename(asset.filePath)}
                  className="h-full w-full object-cover"
                  draggable={false}
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-zinc-100 text-zinc-400">
                  <ImagePlus className="h-4 w-4" />
                </div>
              )}
            </div>
          )
        })}

      {canAddMore ? (
        <HoverPanel
          assets={assets}
          canAddMore={canAddMore}
          onUpload={onUpload}
          onPreview={onPreview}
          onRemove={onRemoveFront}
          disabled={disabled}
        />
      ) : (
        <HoverPanel
          assets={assets}
          canAddMore={false}
          onUpload={() => {}}
          onPreview={onPreview}
          onRemove={onRemoveFront}
          disabled
        />
      )}

      {assets.length > 1 ? (
        <div className="absolute right-0 top-0 z-40 inline-flex min-w-7 items-center justify-center rounded-full bg-zinc-950 px-2 py-1 text-[11px] font-medium text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] transition group-hover:opacity-0">
          {assets.length}
        </div>
      ) : null}

      {frontAsset ? (
        <button
          type="button"
          onClick={() => onPreview(frontAsset)}
          className="absolute bottom-0 right-0 z-30 h-[104px] w-[78px] rounded-[22px]"
          aria-label="预览参考图"
        />
      ) : null}
    </div>
  )
}

function VideoInputCard({
  title,
  asset,
  disabled,
  onUpload,
  onPreview,
  onRemove
}: {
  title: string
  asset: AiStudioAssetRecord | null
  disabled?: boolean
  onUpload: () => void
  onPreview: (asset: AiStudioAssetRecord) => void
  onRemove: () => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = asset ? resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath) : ''

  return (
    <div className="group relative flex w-[78px] shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (asset) {
            onPreview(asset)
            return
          }
          onUpload()
        }}
        disabled={disabled}
        className={cn(
          'relative h-[104px] w-[78px] overflow-hidden rounded-[22px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,244,245,0.92))] shadow-[0_8px_22px_rgba(15,23,42,0.08)] transition',
          asset
            ? 'border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-300'
            : 'border-dashed border-zinc-300 text-zinc-400 hover:border-zinc-400 hover:text-zinc-700',
          disabled && 'cursor-wait opacity-70'
        )}
      >
        {src ? (
          <img
            src={src}
            alt={title}
            className="h-full w-full object-cover"
            draggable={false}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-zinc-400">
            <ImagePlus className="h-4 w-4" />
            <span className="text-[10px] font-medium">上传图片</span>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(15,23,42,0.72))] px-1.5 py-1.5 text-center text-[10px] font-medium text-white">
          {title}
        </div>
      </button>

      {asset ? (
        <div className="pointer-events-none absolute right-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onUpload()
            }}
            disabled={disabled}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-wait disabled:opacity-70"
            aria-label={`替换${title}`}
            title="替换"
          >
            <Upload className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRemove()
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:border-rose-200 hover:bg-white hover:text-rose-500"
            aria-label={`删除${title}`}
            title="删除"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function TaskQueue({
  state,
  promptDraft,
  onPromptChange
}: {
  state: UseAiStudioStateResult
  promptDraft: string
  onPromptChange: (value: string) => void
}): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const [previewAsset, setPreviewAsset] = useState<AiStudioAssetRecord | null>(null)
  const [isPickingImages, setIsPickingImages] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [templateDraftName, setTemplateDraftName] = useState('')
  const [templateDraftPromptText, setTemplateDraftPromptText] = useState('')
  const [isSavingTemplateModal, setIsSavingTemplateModal] = useState(false)

  const isVideoStudio = state.studioCapability === 'video'
  const videoMeta = state.videoMeta
  const primaryAsset =
    state.activeInputAssets.find((asset) => asset.filePath === state.primaryImagePath) ?? null
  const referenceAssets = state.activeInputAssets.filter((asset) =>
    state.referenceImagePaths.includes(asset.filePath)
  )
  const inputAssets = useMemo(() => {
    const next: AiStudioAssetRecord[] = []
    if (primaryAsset) next.push(primaryAsset)
    const existing = new Set(next.map((asset) => asset.filePath))
    referenceAssets.forEach((asset) => {
      if (!existing.has(asset.filePath)) next.push(asset)
    })
    return next
  }, [primaryAsset, referenceAssets])
  const subjectAsset =
    state.activeInputAssets.find((asset) => asset.filePath === videoMeta.subjectReferencePath) ??
    null
  const firstFrameAsset =
    state.activeInputAssets.find((asset) => asset.filePath === videoMeta.firstFramePath) ?? null
  const lastFrameAsset =
    state.activeInputAssets.find((asset) => asset.filePath === videoMeta.lastFramePath) ?? null
  const canAddMore = inputAssets.length < MAX_AI_STUDIO_REFERENCE_IMAGES
  const promptComposerMinHeight = isVideoStudio
    ? videoMeta.mode === 'first-last-frame'
      ? 148
      : 132
    : inputAssets.length > 0
      ? 136
      : 124

  const handleOpenTemplateModal = (): void => {
    setEditingTemplateId(null)
    setTemplateDraftName('')
    setTemplateDraftPromptText(promptDraft.trim())
    setIsTemplateModalOpen(true)
  }

  const handleEditTemplate = (template: PromptTemplateOption): void => {
    setEditingTemplateId(template.id)
    setTemplateDraftName(template.name)
    setTemplateDraftPromptText(template.promptText)
    setIsTemplateModalOpen(true)
  }

  const handleSaveTemplate = async (): Promise<void> => {
    try {
      const name = templateDraftName.trim()
      const promptText = templateDraftPromptText.trim()
      if (!name) {
        throw new Error('请先输入模板名字。')
      }
      if (!promptText) {
        throw new Error('请先输入提示词内容。')
      }
      setIsSavingTemplateModal(true)
      const saved = await state.saveTemplate({ templateId: editingTemplateId, name, promptText })
      if (editingTemplateId) {
        addLog(`[AI Studio] 已更新提示词模板：${saved.name}`)
      } else {
        onPromptChange(mergePromptDraft(promptDraft, saved.promptText))
        addLog('[AI Studio] 已新建提示词模板')
      }
      setIsTemplateModalOpen(false)
      setEditingTemplateId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 保存提示词模板失败：${message}`)
      window.alert(message)
    } finally {
      setIsSavingTemplateModal(false)
    }
  }

  const handleDeleteTemplate = async (template: PromptTemplateOption): Promise<void> => {
    const confirmed = window.confirm(`确认删除提示词模板“${template.name}”吗？`)
    if (!confirmed) return
    try {
      const deleted = await state.deleteTemplate(template.id)
      if (!deleted) {
        throw new Error('删除失败，请稍后重试。')
      }
      addLog(`[AI Studio] 已删除提示词模板：${template.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 删除提示词模板失败：${message}`)
      window.alert(message)
    }
  }

  const handleInsertTemplate = (template: PromptTemplateOption): void => {
    onPromptChange(mergePromptDraft(promptDraft, template.promptText))
    addLog(`[AI Studio] 已插入提示词模板：${template.name}`)
  }

  const pickLocalImages = async (multiSelections = true): Promise<string[]> => {
    const result = await window.electronAPI.openMediaFiles({
      multiSelections,
      accept: 'image'
    })
    if (!result) return []
    const items = Array.isArray(result) ? result : [result]
    return items
      .map((item) => String(item?.originalPath ?? '').trim())
      .filter((filePath) => isSupportedImagePath(filePath))
  }

  const addInputImages = async (filePaths: string[]): Promise<void> => {
    const normalized = uniqueStrings(filePaths.filter((filePath) => isSupportedImagePath(filePath)))
    if (normalized.length === 0) {
      window.alert('未检测到可用图片，请选择 jpg/jpeg/png/webp/heic 文件。')
      return
    }

    const existingSet = new Set(inputAssets.map((asset) => asset.filePath))
    const incoming = normalized.filter((filePath) => !existingSet.has(filePath))
    const availableSlots = Math.max(0, MAX_AI_STUDIO_REFERENCE_IMAGES - inputAssets.length)
    const accepted = incoming.slice(0, availableSlots)
    const overflow = Math.max(0, incoming.length - accepted.length)

    if (accepted.length === 0) {
      if (overflow > 0) {
        window.alert(
          `最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张参考图，已忽略超出的 ${overflow} 张。`
        )
      }
      return
    }

    if (!primaryAsset) {
      const [nextPrimary, ...nextReferences] = accepted
      if (nextPrimary) {
        await state.assignPrimaryImage(nextPrimary)
      }
      if (nextReferences.length > 0) {
        await state.addReferenceImages(nextReferences)
      }
      addLog(`[AI Studio] 已导入参考图：${accepted.length} 张`)
    } else {
      const { added } = await state.addReferenceImages(accepted)
      if (added > 0) {
        addLog(`[AI Studio] 已添加参考图：${added} 张`)
      }
    }

    if (overflow > 0) {
      window.alert(
        `最多支持 ${MAX_AI_STUDIO_REFERENCE_IMAGES} 张参考图，已忽略超出的 ${overflow} 张。`
      )
    }
  }

  const pickInputImages = async (): Promise<void> => {
    if (isPickingImages || !canAddMore) return
    try {
      setIsPickingImages(true)
      const filePaths = await pickLocalImages(true)
      if (filePaths.length === 0) return
      await addInputImages(filePaths)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 选择参考图失败：${message}`)
      window.alert(`选择参考图失败：${message}`)
    } finally {
      setIsPickingImages(false)
    }
  }

  const pickVideoInput = async (slot: 'subject' | 'first' | 'last'): Promise<void> => {
    if (isPickingImages) return
    try {
      setIsPickingImages(true)
      const filePaths = await pickLocalImages(false)
      const nextPath = filePaths[0] ?? ''
      if (!nextPath) return
      if (slot === 'subject') {
        await state.setVideoSubjectReference(nextPath)
        addLog('[AI Studio] 已设置主体参考图')
        return
      }
      if (slot === 'first') {
        await state.setVideoFirstFrame(nextPath)
        addLog('[AI Studio] 已设置首帧')
        return
      }
      await state.setVideoLastFrame(nextPath)
      addLog('[AI Studio] 已设置尾帧')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 选择视频参考图失败：${message}`)
      window.alert(`选择视频参考图失败：${message}`)
    } finally {
      setIsPickingImages(false)
    }
  }

  const handleRemoveAsset = async (asset: AiStudioAssetRecord): Promise<void> => {
    if (primaryAsset?.id === asset.id) {
      const nextPrimary = referenceAssets[0] ?? null
      await state.assignPrimaryImage(nextPrimary?.filePath ?? null)
      return
    }
    await state.removeReferenceImage(asset.filePath)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragActive(false)

    const filePaths = getDroppedImagePaths(event.dataTransfer.files)
    if (filePaths.length === 0) {
      window.alert('拖入失败：未检测到本地图片路径，请从 Finder 拖入 jpg/jpeg/png/webp/heic 文件。')
      return
    }

    if (!isVideoStudio) {
      await addInputImages(filePaths)
      return
    }

    if (videoMeta.mode === 'subject-reference') {
      await state.setVideoSubjectReference(filePaths[0] ?? null)
      return
    }

    const [firstFramePath, lastFramePath] = filePaths
    if (firstFramePath) {
      await state.setVideoFirstFrame(firstFramePath)
    }
    if (lastFramePath) {
      await state.setVideoLastFrame(lastFramePath)
    }
    if (filePaths.length > 2) {
      window.alert('首尾帧模式最多接收 2 张图，已忽略其余图片。')
    }
  }

  return (
    <>
      <div
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
          setIsDragActive(true)
        }}
        onDragLeave={(event) => {
          event.stopPropagation()
          setIsDragActive(false)
        }}
        onDrop={(event) => void handleDrop(event)}
        className={cn(
          'transition',
          isDragActive && 'rounded-[26px] bg-sky-50/40 ring-1 ring-sky-200/80'
        )}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 py-0">
          <div className="flex flex-col items-start gap-1.5 pt-0.5">
            {isVideoStudio ? (
              <>
                {videoMeta.mode === 'subject-reference' ? (
                  <VideoInputCard
                    title="主体参考"
                    asset={subjectAsset}
                    disabled={isPickingImages}
                    onUpload={() => void pickVideoInput('subject')}
                    onPreview={(asset) => setPreviewAsset(asset)}
                    onRemove={() => void state.setVideoSubjectReference(null)}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <VideoInputCard
                      title="首帧"
                      asset={firstFrameAsset}
                      disabled={isPickingImages}
                      onUpload={() => void pickVideoInput('first')}
                      onPreview={(asset) => setPreviewAsset(asset)}
                      onRemove={() => void state.setVideoFirstFrame(null)}
                    />
                    <button
                      type="button"
                      onClick={() => void state.swapVideoFrames()}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
                      aria-label="互换首尾帧"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </button>
                    <VideoInputCard
                      title="尾帧"
                      asset={lastFrameAsset}
                      disabled={isPickingImages}
                      onUpload={() => void pickVideoInput('last')}
                      onPreview={(asset) => setPreviewAsset(asset)}
                      onRemove={() => void state.setVideoLastFrame(null)}
                    />
                  </div>
                )}
              </>
            ) : inputAssets.length > 0 ? (
              <ReferenceStackCard
                assets={inputAssets}
                canAddMore={canAddMore}
                disabled={isPickingImages}
                onUpload={() => void pickInputImages()}
                onPreview={(asset) => setPreviewAsset(asset)}
                onRemoveFront={(asset) => void handleRemoveAsset(asset)}
              />
            ) : (
              <EmptyReferenceCard
                onUpload={() => void pickInputImages()}
                disabled={isPickingImages}
              />
            )}

            <QuickInsertPopover
              templates={state.templates}
              onCreate={handleOpenTemplateModal}
              onInsert={handleInsertTemplate}
              onEdit={handleEditTemplate}
              onDelete={(template) => void handleDeleteTemplate(template)}
            />
          </div>

          <div className="min-w-0 self-stretch pt-0.5">
            <Textarea
              value={promptDraft}
              onChange={(event) => onPromptChange(event.target.value)}
              placeholder={
                isVideoStudio
                  ? '描述镜头运动、节奏、主体动作和氛围，例如：主体轻微转身，镜头缓慢推近，背景光影流动。'
                  : '输入本次提示词...'
              }
              className="h-full max-h-none w-full resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-6 text-zinc-900 shadow-none placeholder:text-zinc-400 focus-visible:ring-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              style={{ minHeight: `${promptComposerMinHeight}px`, scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            />
          </div>
        </div>
      </div>

      <ImageLightbox
        asset={previewAsset}
        open={Boolean(previewAsset)}
        onOpenChange={(next) => {
          if (!next) setPreviewAsset(null)
        }}
      />

      <PromptTemplateModal
        open={isTemplateModalOpen}
        title={editingTemplateId ? '修改提示词模板' : '新增提示词模板'}
        name={templateDraftName}
        promptText={templateDraftPromptText}
        isSaving={isSavingTemplateModal}
        onNameChange={setTemplateDraftName}
        onPromptTextChange={setTemplateDraftPromptText}
        onClose={() => {
          setIsTemplateModalOpen(false)
          setEditingTemplateId(null)
        }}
        onSave={() => void handleSaveTemplate()}
      />
    </>
  )
}

export { TaskQueue }
