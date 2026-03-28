import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'
import { createPortal } from 'react-dom'

import {
  ArrowUp,
  Check,
  ChevronDown,
  Clapperboard,
  FlaskConical,
  Plus,
  Send,
  Trash2,
  X
} from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import geminiLogo from '@renderer/assets/ai-model-logos/gemini.svg'
import { getAllowedVideoAspectRatios, getAllowedVideoDurations } from '@renderer/lib/aiVideoProfiles'
import {
  buildAiConfigPatch,
  findAiModelProfile,
  findAiProviderProfile,
  normalizeAiEndpointPath,
  normalizeAiProviderValue,
  resolveAiTaskProviderSelection
} from '@renderer/lib/aiProviderProfiles'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { DEFAULT_GRSAI_IMAGE_MODEL } from '@renderer/lib/grsaiModels'
import { cn } from '@renderer/lib/utils'
import { useCmsStore, type AiProviderProfile } from '@renderer/store/useCmsStore'

import {
  normalizeOutputCountDraftOnBlur,
  parseOutputCountDraft
} from './outputCountDraftHelpers'
import { resolvePrimaryGenerateButtonState } from './controlPanelHelpers'
import { canStartPoolRemix, resolvePoolSendButtonText } from './poolDispatchHelpers'
import { hasActivePreviewSlotRuntimeStates } from './previewSlotHelpers'
import type { AiStudioAssetRecord, UseAiStudioStateResult } from './useAiStudioState'

const VIDEO_MODE_OPTIONS = [
  { value: 'subject-reference', label: '主体参考' },
  { value: 'first-last-frame', label: '首尾帧' }
] as const
const VIDEO_ASPECT_RATIO_OPTIONS = [
  { value: 'adaptive', label: '自适应' },
  { value: '9:16', label: '竖版 9:16' },
  { value: '16:9', label: '横版 16:9' },
  { value: '1:1', label: '方图 1:1' }
] as const
const VIDEO_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' }
] as const
const VIDEO_DURATION_OPTIONS = [
  { value: 4, label: '4 秒' },
  { value: 5, label: '5 秒' },
  { value: 8, label: '8 秒' }
] as const

const CONTROL_FIELD_LABEL_CLASS = 'text-[11px] font-medium tracking-[0.04em] text-zinc-500'
const MODEL_CONFIGURATOR_FIELD_CLASS =
  'h-10 rounded-[16px] border border-zinc-200 bg-zinc-50 px-3 text-[13px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-sky-400'

type ProviderConnectionPayload = {
  provider: string
  baseUrl: string
  apiKey: string
  defaultImageModel: string
  endpointPath: string
}

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '未命名文件'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function isVideoAsset(asset: AiStudioAssetRecord): boolean {
  if (asset.role === 'video-output') return true
  return /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(String(asset.filePath ?? '').trim())
}

function PoolPreviewThumb({
  asset,
  onRemove
}: {
  asset: AiStudioAssetRecord
  onRemove: (asset: AiStudioAssetRecord) => void
}): React.JSX.Element {
  const workspacePath = useCmsStore((store) => store.workspacePath)
  const src = resolveLocalImage(asset.previewPath ?? asset.filePath, workspacePath)
  const video = isVideoAsset(asset)

  return (
    <div className="group/thumb-item relative shrink-0 overflow-hidden rounded-[14px] border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300">
      <div className="h-[74px] w-[56px] overflow-hidden bg-zinc-100">
        {src ? (
          video ? (
            <div className="relative h-full w-full bg-zinc-950">
              <video
                src={src}
                className="h-full w-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
              <div className="absolute inset-x-0 bottom-0 inline-flex items-center justify-center bg-black/55 py-1 text-[10px] font-medium text-white">
                <Clapperboard className="mr-1 h-3 w-3" />
                视频
              </div>
            </div>
          ) : (
            <img
              src={src}
              alt={basename(asset.filePath)}
              className="h-full w-full object-cover"
              draggable={false}
              loading="lazy"
            />
          )
        ) : null}
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove(asset)
        }}
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white bg-white text-zinc-700 opacity-0 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-950 group-hover/thumb-item:opacity-100"
        aria-label="移出图池"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function PooledOutputPopover({
  anchorRef,
  open,
  assets,
  showRemixShortcut,
  onStartRemix,
  onRemove,
  onMouseEnter,
  onMouseLeave
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  open: boolean
  assets: AiStudioAssetRecord[]
  showRemixShortcut: boolean
  onStartRemix: () => void
  onRemove: (asset: AiStudioAssetRecord) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}): React.JSX.Element | null {
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }

    const updatePanelStyle = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const panelWidth = 272
      const viewportPadding = 12
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
      )
      setPanelStyle({
        left,
        top: Math.max(viewportPadding, rect.top - 8),
        width: panelWidth,
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
  }, [anchorRef, assets.length, open])

  if (!open || !panelStyle || assets.length === 0 || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed z-[260] pb-2"
      style={panelStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="rounded-[20px] border border-zinc-200 bg-white p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
        <div className="flex w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {showRemixShortcut ? (
            <button
              type="button"
              onClick={onStartRemix}
              className="inline-flex h-[74px] w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-[14px] border border-zinc-200 bg-zinc-950 px-2 text-center text-[11px] font-medium text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-800"
            >
              <Clapperboard className="h-4 w-4" />
              <span className="leading-4">开始混剪</span>
            </button>
          ) : null}
          {assets.map((asset) => (
            <PoolPreviewThumb key={asset.id} asset={asset} onRemove={onRemove} />
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

function createProviderProfile(
  providerName: string,
  baseUrl: string,
  apiKey: string
): AiProviderProfile {
  return {
    id: crypto.randomUUID(),
    providerName,
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    models: [],
    defaultModelId: null
  }
}

function resolveModelVisual(modelName: string): {
  logoSrc: string | null
  badgeText: string
  badgeClassName: string
} {
  const normalized = normalizeAiProviderValue(modelName).toLowerCase()

  if (normalized.includes('gemini')) {
    return {
      logoSrc: geminiLogo,
      badgeText: 'GM',
      badgeClassName: 'bg-white'
    }
  }

  if (normalized.includes('nano-banana')) {
    return {
      logoSrc: null,
      badgeText: 'NB',
      badgeClassName:
        'bg-gradient-to-br from-lime-200 via-emerald-300 to-green-400 text-emerald-950'
    }
  }

  const fallbackText =
    normalized
      .split(/[^a-z0-9]+/i)
      .filter(Boolean)[0]
      ?.slice(0, 2)
      .toUpperCase() || 'AI'

  return {
    logoSrc: null,
    badgeText: fallbackText,
    badgeClassName: 'bg-gradient-to-br from-sky-500 via-violet-500 to-fuchsia-500 text-white'
  }
}

function ModelTriggerButton({
  label,
  modelName,
  isOpen,
  onClick,
  disabled
}: {
  label: string
  modelName?: string
  isOpen?: boolean
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  const triggerVisual = resolveModelVisual(modelName ?? '')
  const hasModel = Boolean(String(modelName ?? '').trim())

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-full items-center justify-between rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-left text-[12px] transition hover:border-zinc-300 focus-visible:border-sky-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex min-w-0 items-center gap-2 pr-3">
        {hasModel ? (
          <span
            className={cn(
              'inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-semibold',
              triggerVisual.badgeClassName
            )}
          >
            {triggerVisual.logoSrc ? (
              <img src={triggerVisual.logoSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <span>{triggerVisual.badgeText}</span>
            )}
          </span>
        ) : null}
        <span className="min-w-0 truncate text-[12px] font-medium text-zinc-900">{label}</span>
      </span>
      <ChevronDown
        className={cn('h-4 w-4 shrink-0 text-zinc-400 transition', isOpen && 'rotate-180')}
      />
    </button>
  )
}

type SharedModelConfiguratorProps = {
  panelTitle: string
  panelDescription: string
  closeAriaLabel: string
  triggerWrapperClassName: string
  emptyTriggerLabel: string
  currentProviderName: string
  currentModelName: string
  providerProfiles: AiProviderProfile[]
  isOpen: boolean
  activeProviderName: string
  activeProviderProfile: AiProviderProfile | null
  isCreatingProvider: boolean
  providerNameDraft: string
  providerBaseUrlDraft: string
  providerApiKeyDraft: string
  providerDraftDirty: boolean
  isCreatingModel: boolean
  modelNameDraft: string
  modelEndpointDraft: string
  modelNamePlaceholder: string
  modelEndpointPlaceholder: string
  testingModelKey: string
  verifiedModelKeys: string[]
  failedModelKeys: string[]
  onOpen: () => void
  onClose: () => void
  onSelectProvider: (providerName: string) => void
  onStartCreateProvider: () => void
  onProviderNameDraftChange: (value: string) => void
  onProviderBaseUrlDraftChange: (value: string) => void
  onProviderApiKeyDraftChange: (value: string) => void
  onSaveProvider: () => void | Promise<void>
  onCancelCreateProvider: () => void
  onDeleteProvider: () => void | Promise<void>
  onStartCreateModel: () => void
  onModelNameDraftChange: (value: string) => void
  onModelEndpointDraftChange: (value: string) => void
  onSaveModel: () => void | Promise<void>
  onCancelCreateModel: () => void
  onChooseModel: (
    providerProfile: AiProviderProfile,
    modelName: string,
    endpointPath: string
  ) => void | Promise<void>
  onTestModel: (
    providerProfile: AiProviderProfile,
    modelName: string,
    endpointPath: string
  ) => void | Promise<void>
  onDeleteModel: (
    providerProfile: AiProviderProfile,
    modelId: string,
    modelName: string
  ) => void | Promise<void>
}

function SharedModelConfigurator({
  panelTitle,
  panelDescription,
  closeAriaLabel,
  triggerWrapperClassName,
  emptyTriggerLabel,
  currentProviderName,
  currentModelName,
  providerProfiles,
  isOpen,
  activeProviderName,
  activeProviderProfile,
  isCreatingProvider,
  providerNameDraft,
  providerBaseUrlDraft,
  providerApiKeyDraft,
  providerDraftDirty,
  isCreatingModel,
  modelNameDraft,
  modelEndpointDraft,
  modelNamePlaceholder,
  modelEndpointPlaceholder,
  testingModelKey,
  verifiedModelKeys,
  failedModelKeys,
  onOpen,
  onClose,
  onSelectProvider,
  onStartCreateProvider,
  onProviderNameDraftChange,
  onProviderBaseUrlDraftChange,
  onProviderApiKeyDraftChange,
  onSaveProvider,
  onCancelCreateProvider,
  onDeleteProvider,
  onStartCreateModel,
  onModelNameDraftChange,
  onModelEndpointDraftChange,
  onSaveModel,
  onCancelCreateModel,
  onChooseModel,
  onTestModel,
  onDeleteModel
}: SharedModelConfiguratorProps): React.JSX.Element {
  const hasProviders = providerProfiles.length > 0
  const triggerLabel = currentModelName || (hasProviders ? '选择模型' : emptyTriggerLabel)

  return (
    <>
      <label className={triggerWrapperClassName}>
        <span className={CONTROL_FIELD_LABEL_CLASS}>模型</span>
        <ModelTriggerButton
          label={triggerLabel}
          modelName={currentModelName}
          isOpen={isOpen}
          onClick={() => {
            if (isOpen) {
              onClose()
              return
            }
            onOpen()
          }}
        />
      </label>

      {isOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[220] flex items-center justify-center bg-black/10 p-4"
              onMouseDown={onClose}
            >
              <div
                className="w-[min(560px,calc(100vw-24px))] max-h-[72vh] overflow-hidden rounded-[24px] border border-zinc-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
                  <div>
                    <div className="text-[15px] font-semibold text-zinc-900">{panelTitle}</div>
                    <div className="mt-1 text-[12px] leading-5 text-zinc-500">
                      {panelDescription}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-700"
                    aria-label={closeAriaLabel}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="max-h-[calc(72vh-88px)] overflow-y-auto px-5 py-4">
                  {!hasProviders && !isCreatingProvider ? (
                    <div className="flex min-h-[180px] items-center justify-center rounded-[22px] border border-dashed border-zinc-200 bg-zinc-50/70">
                      <Button
                        type="button"
                        onClick={onStartCreateProvider}
                        className="h-11 rounded-full bg-zinc-950 px-5 text-[13px] text-white hover:bg-zinc-800"
                      >
                        <Plus className="h-4 w-4" />
                        新增模型供应商
                      </Button>
                    </div>
                  ) : null}

                  {(hasProviders || isCreatingProvider) && (
                    <div className="overflow-hidden rounded-[22px] border border-zinc-200 bg-zinc-50/70">
                      {hasProviders ? (
                        <div className="flex items-end gap-1 overflow-x-auto px-4 pt-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                          {providerProfiles.map((profile) => {
                            const active =
                              !isCreatingProvider && profile.providerName === activeProviderName
                            return (
                              <button
                                key={profile.id}
                                type="button"
                                onClick={() => onSelectProvider(profile.providerName)}
                                className={cn(
                                  'inline-flex h-11 shrink-0 items-center rounded-t-[16px] border border-b-0 px-4 text-[12px] font-medium transition',
                                  active
                                    ? 'border-zinc-300 bg-white text-zinc-950'
                                    : 'border-zinc-200 bg-zinc-100/90 text-zinc-500 hover:bg-white hover:text-zinc-800'
                                )}
                              >
                                {profile.providerName}
                              </button>
                            )
                          })}
                          <button
                            type="button"
                            onClick={onStartCreateProvider}
                            className={cn(
                              'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-t-[16px] border border-b-0 transition',
                              isCreatingProvider
                                ? 'border-zinc-300 bg-white text-zinc-950'
                                : 'border-zinc-200 bg-zinc-100/90 text-zinc-500 hover:bg-white hover:text-zinc-800'
                            )}
                            aria-label="新增供应商"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}

                      <div
                        className={cn('bg-white p-4', hasProviders && 'border-t border-zinc-200')}
                      >
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {isCreatingProvider ? (
                            <label className="flex flex-col gap-1.5 md:col-span-2">
                              <span className="text-[11px] font-medium text-zinc-500">
                                供应商名称
                              </span>
                              <input
                                value={providerNameDraft}
                                onChange={(event) => onProviderNameDraftChange(event.target.value)}
                                placeholder="例如：allapi"
                                className={MODEL_CONFIGURATOR_FIELD_CLASS}
                                spellCheck={false}
                              />
                            </label>
                          ) : null}

                          <label className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-zinc-500">
                              Host / Base URL
                            </span>
                            <input
                              value={providerBaseUrlDraft}
                              onChange={(event) => onProviderBaseUrlDraftChange(event.target.value)}
                              placeholder="https://api.allapi.store"
                              className={MODEL_CONFIGURATOR_FIELD_CLASS}
                              spellCheck={false}
                            />
                          </label>

                          <label className="flex flex-col gap-1.5">
                            <span className="text-[11px] font-medium text-zinc-500">API Key</span>
                            <input
                              type="password"
                              value={providerApiKeyDraft}
                              onChange={(event) => onProviderApiKeyDraftChange(event.target.value)}
                              placeholder="填写当前供应商自己的 Key"
                              className={MODEL_CONFIGURATOR_FIELD_CLASS}
                              autoComplete="new-password"
                              spellCheck={false}
                            />
                          </label>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {isCreatingProvider ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void onSaveProvider()}
                                className="h-9 rounded-full border-zinc-200 bg-white px-4 text-[12px] text-zinc-700 hover:bg-zinc-50"
                              >
                                保存供应商
                              </Button>
                              {hasProviders ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={onCancelCreateProvider}
                                  className="h-9 rounded-full border-zinc-200 bg-white px-4 text-[12px] text-zinc-700 hover:bg-zinc-50"
                                >
                                  取消
                                </Button>
                              ) : null}
                            </>
                          ) : activeProviderProfile ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void onSaveProvider()}
                                disabled={!providerDraftDirty}
                                className="h-9 rounded-full border-zinc-200 bg-white px-4 text-[12px] text-zinc-700 hover:bg-zinc-50 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                              >
                                保存修改
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void onDeleteProvider()}
                                className="h-9 rounded-full border-rose-200 bg-rose-50 px-4 text-[12px] text-rose-600 hover:bg-rose-100 hover:text-rose-700"
                              >
                                删除供应商
                              </Button>
                            </>
                          ) : null}
                        </div>

                        {!isCreatingProvider && activeProviderProfile ? (
                          <div className="mt-5 border-t border-zinc-100 pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-[13px] font-semibold text-zinc-900">模型</div>
                                <div className="mt-1 text-[11px] text-zinc-500">
                                  点击模型即可切换；右侧按钮支持测试连接和删除模型。
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={onStartCreateModel}
                                className="h-9 rounded-full border-zinc-200 bg-white px-4 text-[12px] text-zinc-700 hover:bg-zinc-50"
                              >
                                <Plus className="h-4 w-4" />
                                新增模型
                              </Button>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {activeProviderProfile.models.map((model) => {
                                const applied =
                                  activeProviderProfile.providerName === currentProviderName &&
                                  model.modelName === currentModelName
                                const modelVisual = resolveModelVisual(model.modelName)
                                const modelKey = `${activeProviderProfile.id}:${normalizeAiProviderValue(model.modelName)}:${normalizeAiEndpointPath(model.endpointPath)}`
                                const testing = testingModelKey === modelKey
                                const verified = verifiedModelKeys.includes(modelKey)
                                const failed = failedModelKeys.includes(modelKey)
                                return (
                                  <div
                                    key={model.id}
                                    className={cn(
                                      'inline-flex items-center gap-1.5 rounded-full border px-2 py-1.5 transition',
                                      applied
                                        ? 'border-zinc-900 bg-zinc-950 text-white'
                                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-white'
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void onChooseModel(
                                          activeProviderProfile,
                                          model.modelName,
                                          model.endpointPath
                                        )
                                      }
                                      className="inline-flex items-center gap-2 rounded-full px-2 py-0.5 text-[12px] font-medium"
                                    >
                                      <span
                                        className={cn(
                                          'inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-semibold',
                                          modelVisual.badgeClassName
                                        )}
                                      >
                                        {modelVisual.logoSrc ? (
                                          <img
                                            src={modelVisual.logoSrc}
                                            alt=""
                                            className="h-full w-full object-cover"
                                          />
                                        ) : (
                                          <span>{modelVisual.badgeText}</span>
                                        )}
                                      </span>
                                      <span className="max-w-[172px] truncate">
                                        {model.modelName}
                                      </span>
                                      {applied ? (
                                        <span className="text-[10px] opacity-80">当前</span>
                                      ) : null}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        void onTestModel(
                                          activeProviderProfile,
                                          model.modelName,
                                          model.endpointPath
                                        )
                                      }}
                                      className={cn(
                                        'inline-flex h-7 w-7 items-center justify-center rounded-full transition',
                                        applied
                                          ? 'bg-white/12 text-white hover:bg-white/18'
                                          : 'bg-white text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
                                      )}
                                      aria-label={`测试模型 ${model.modelName}`}
                                      title={
                                        verified
                                          ? '已验证，可再次测试'
                                          : failed
                                            ? '测试失败，可重试'
                                            : '测试模型'
                                      }
                                      disabled={testing}
                                    >
                                      {verified && !testing ? (
                                        <Check className="h-3.5 w-3.5" />
                                      ) : failed && !testing ? (
                                        <X className="h-3.5 w-3.5" />
                                      ) : (
                                        <FlaskConical
                                          className={cn('h-3.5 w-3.5', testing && 'animate-pulse')}
                                        />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        void onDeleteModel(
                                          activeProviderProfile,
                                          model.id,
                                          model.modelName
                                        )
                                      }}
                                      className={cn(
                                        'inline-flex h-7 w-7 items-center justify-center rounded-full transition',
                                        applied
                                          ? 'bg-white/12 text-white hover:bg-white/18'
                                          : 'bg-white text-zinc-500 hover:bg-zinc-100 hover:text-rose-600'
                                      )}
                                      aria-label={`删除模型 ${model.modelName}`}
                                      title="删除模型"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )
                              })}
                              {activeProviderProfile.models.length === 0 ? (
                                <div className="rounded-[16px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3 text-[12px] text-zinc-400">
                                  当前供应商还没有模型，点“新增模型”即可。
                                </div>
                              ) : null}
                            </div>

                            {isCreatingModel ? (
                              <div className="mt-4 grid grid-cols-1 gap-3 rounded-[18px] border border-zinc-200 bg-zinc-50/70 p-3">
                                <label className="flex flex-col gap-1.5">
                                  <span className="text-[11px] font-medium text-zinc-500">
                                    模型名称
                                  </span>
                                  <input
                                    value={modelNameDraft}
                                    onChange={(event) => onModelNameDraftChange(event.target.value)}
                                    placeholder={modelNamePlaceholder}
                                    className={MODEL_CONFIGURATOR_FIELD_CLASS}
                                    spellCheck={false}
                                  />
                                </label>

                                <label className="flex flex-col gap-1.5">
                                  <span className="text-[11px] font-medium text-zinc-500">
                                    模型 API 端点
                                  </span>
                                  <input
                                    value={modelEndpointDraft}
                                    onChange={(event) =>
                                      onModelEndpointDraftChange(event.target.value)
                                    }
                                    placeholder={modelEndpointPlaceholder}
                                    className={MODEL_CONFIGURATOR_FIELD_CLASS}
                                    spellCheck={false}
                                  />
                                </label>

                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void onSaveModel()}
                                    className="h-9 rounded-full border-zinc-200 bg-white px-4 text-[12px] text-zinc-700 hover:bg-zinc-50"
                                  >
                                    保存模型
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={onCancelCreateModel}
                                    className="h-9 rounded-full border-zinc-200 bg-white px-4 text-[12px] text-zinc-700 hover:bg-zinc-50"
                                  >
                                    取消
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function ImageModelConfigurator({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const task = state.activeTask
  const config = useCmsStore((store) => store.config)
  const updateConfig = useCmsStore((store) => store.updateConfig)
  const addLog = useCmsStore((store) => store.addLog)
  const providerProfiles = Array.isArray(config.aiProviderProfiles) ? config.aiProviderProfiles : []
  const currentSelection = useMemo(
    () =>
      resolveAiTaskProviderSelection(providerProfiles, {
        taskProviderName: task?.provider,
        taskModelName: task?.model,
        fallbackProviderName: config.aiProvider,
        fallbackModelName: config.aiDefaultImageModel || DEFAULT_GRSAI_IMAGE_MODEL
      }),
    [config.aiDefaultImageModel, config.aiProvider, providerProfiles, task?.model, task?.provider]
  )
  const currentProviderName = currentSelection.providerName
  const currentModelName = currentSelection.modelName
  const [isOpen, setIsOpen] = useState(false)
  const [activeProviderName, setActiveProviderName] = useState('')
  const [isCreatingProvider, setIsCreatingProvider] = useState(false)
  const [providerNameDraft, setProviderNameDraft] = useState('')
  const [providerBaseUrlDraft, setProviderBaseUrlDraft] = useState('')
  const [providerApiKeyDraft, setProviderApiKeyDraft] = useState('')
  const [isCreatingModel, setIsCreatingModel] = useState(false)
  const [modelNameDraft, setModelNameDraft] = useState('')
  const [modelEndpointDraft, setModelEndpointDraft] = useState('')
  const [testingModelKey, setTestingModelKey] = useState('')
  const [verifiedModelKeys, setVerifiedModelKeys] = useState<string[]>([])
  const [failedModelKeys, setFailedModelKeys] = useState<string[]>([])

  const hasProviders = providerProfiles.length > 0
  const activeProviderProfile = useMemo(
    () =>
      normalizeAiProviderValue(activeProviderName)
        ? findAiProviderProfile(providerProfiles, activeProviderName)
        : null,
    [activeProviderName, providerProfiles]
  )
  const providerDraftDirty = useMemo(() => {
    if (!activeProviderProfile || isCreatingProvider) return false
    return (
      providerBaseUrlDraft.trim() !== activeProviderProfile.baseUrl.trim() ||
      providerApiKeyDraft.trim() !== activeProviderProfile.apiKey.trim()
    )
  }, [activeProviderProfile, isCreatingProvider, providerApiKeyDraft, providerBaseUrlDraft])

  const persistAiPatch = async (
    nextPatch: ReturnType<typeof buildAiConfigPatch>
  ): Promise<void> => {
    updateConfig(nextPatch)
    try {
      await window.electronAPI.saveConfig(nextPatch)
    } catch {
      addLog('[AI Studio] 保存图片模型配置失败。')
    }
  }

  const persistProviderProfiles = async (
    nextProfiles: AiProviderProfile[],
    preferredProviderName = currentProviderName,
    preferredModelName = currentModelName
  ): Promise<void> => {
    await persistAiPatch(
      buildAiConfigPatch(nextProfiles, preferredProviderName, preferredModelName)
    )
  }

  const syncProviderEditor = (providerName: string): void => {
    const providerProfile = findAiProviderProfile(providerProfiles, providerName)
    setActiveProviderName(providerProfile?.providerName ?? normalizeAiProviderValue(providerName))
    setProviderNameDraft('')
    setProviderBaseUrlDraft(providerProfile?.baseUrl ?? '')
    setProviderApiKeyDraft(providerProfile?.apiKey ?? '')
    setIsCreatingProvider(false)
    setIsCreatingModel(false)
    setModelNameDraft('')
    setModelEndpointDraft('')
  }

  const openConfigurator = (): void => {
    if (hasProviders) {
      syncProviderEditor(currentProviderName || providerProfiles[0]?.providerName || '')
    } else {
      setActiveProviderName('')
      setIsCreatingProvider(false)
      setProviderNameDraft('')
      setProviderBaseUrlDraft('')
      setProviderApiKeyDraft('')
      setIsCreatingModel(false)
      setModelNameDraft('')
      setModelEndpointDraft('')
    }
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen])

  const startCreateProvider = (): void => {
    setIsCreatingProvider(true)
    setActiveProviderName('')
    setProviderNameDraft('')
    setProviderBaseUrlDraft('')
    setProviderApiKeyDraft('')
    setIsCreatingModel(false)
    setModelNameDraft('')
    setModelEndpointDraft('')
  }

  const handleSaveProvider = async (): Promise<void> => {
    try {
      const providerName = normalizeAiProviderValue(
        isCreatingProvider
          ? providerNameDraft
          : activeProviderProfile?.providerName ||
              activeProviderName ||
              providerProfiles[0]?.providerName
      )
      const baseUrl = providerBaseUrlDraft.trim()
      const apiKey = providerApiKeyDraft.trim()
      if (!providerName) throw new Error('请先填写供应商名称。')
      if (!baseUrl) throw new Error('请先填写 Host / Base URL。')
      if (!apiKey) throw new Error('请先填写 API Key。')

      const existingProvider = findAiProviderProfile(providerProfiles, providerName)
      const nextProfiles = existingProvider
        ? providerProfiles.map((profile) =>
            profile.id === existingProvider.id ? { ...profile, baseUrl, apiKey } : profile
          )
        : [...providerProfiles, createProviderProfile(providerName, baseUrl, apiKey)]

      await persistProviderProfiles(nextProfiles, providerName, currentModelName)
      syncProviderEditor(providerName)
      addLog(`[AI Studio] 已保存图片供应商：${providerName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 保存图片供应商失败：${message}`)
      window.alert(message)
    }
  }

  const handleDeleteProvider = async (): Promise<void> => {
    if (!activeProviderProfile) return
    const confirmed = window.confirm(`确定删除供应商“${activeProviderProfile.providerName}”吗？`)
    if (!confirmed) return

    try {
      const nextProfiles = providerProfiles.filter(
        (profile) => profile.id !== activeProviderProfile.id
      )
      const nextProviderName = nextProfiles[0]?.providerName ?? ''
      await persistProviderProfiles(nextProfiles, nextProviderName, '')
      syncProviderEditor(nextProviderName)
      if (currentProviderName === activeProviderProfile.providerName && nextProviderName) {
        await state.setImageProvider(nextProviderName)
      }
      addLog(`[AI Studio] 已删除图片供应商：${activeProviderProfile.providerName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 删除图片供应商失败：${message}`)
      window.alert(message)
    }
  }

  const startCreateModel = (): void => {
    if (!activeProviderProfile) {
      window.alert('请先保存并选择供应商。')
      return
    }
    setIsCreatingModel(true)
    setModelNameDraft('')
    setModelEndpointDraft('')
  }

  const handleSaveModel = async (): Promise<void> => {
    try {
      if (!activeProviderProfile) throw new Error('请先保存并选择供应商。')
      const modelName = normalizeAiProviderValue(modelNameDraft)
      const endpointPath = normalizeAiEndpointPath(modelEndpointDraft)
      if (!modelName) throw new Error('请先填写模型名称。')
      if (!endpointPath) throw new Error('请先填写模型 API 端点。')

      const nextProfiles = providerProfiles.map((profile) => {
        if (profile.id !== activeProviderProfile.id) return profile
        const existingModel = findAiModelProfile(profile, modelName)
        if (existingModel) {
          return {
            ...profile,
            models: profile.models.map((model) =>
              model.id === existingModel.id ? { ...model, endpointPath } : model
            ),
            defaultModelId: existingModel.id
          }
        }
        const nextModelId = crypto.randomUUID()
        return {
          ...profile,
          models: [
            ...profile.models,
            {
              id: nextModelId,
              modelName,
              endpointPath
            }
          ],
          defaultModelId: profile.defaultModelId
        }
      })

      await persistProviderProfiles(nextProfiles, activeProviderProfile.providerName, modelName)
      setIsCreatingModel(false)
      setModelNameDraft('')
      setModelEndpointDraft('')
      addLog(`[AI Studio] 已保存图片模型：${activeProviderProfile.providerName} / ${modelName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 保存图片模型失败：${message}`)
      window.alert(message)
    }
  }

  const handleChooseModel = async (
    providerProfile: AiProviderProfile,
    modelName: string
  ): Promise<void> => {
    try {
      await state.setImageModel({
        provider: providerProfile.providerName,
        model: modelName
      })
      await persistAiPatch(
        buildAiConfigPatch(providerProfiles, providerProfile.providerName, modelName)
      )
      addLog(`[AI Studio] 已切换图片模型：${providerProfile.providerName} / ${modelName}`)
      setIsOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 切换图片模型失败：${message}`)
      window.alert(message)
    }
  }

  const handleTestModel = async (
    providerProfile: AiProviderProfile,
    modelName: string,
    endpointPath: string
  ): Promise<void> => {
    const normalizedModel = normalizeAiProviderValue(modelName)
    const normalizedEndpoint = normalizeAiEndpointPath(endpointPath)
    const testKey = `${providerProfile.id}:${normalizedModel}:${normalizedEndpoint}`
    if (!normalizedModel || !normalizedEndpoint) {
      window.alert('请先确保该模型已填写模型名和 API 端点。')
      return
    }

    setTestingModelKey(testKey)
    try {
      const result = await window.api.cms.aiStudio.provider.testConnection({
        provider: providerProfile.providerName,
        baseUrl: providerProfile.baseUrl,
        apiKey: providerProfile.apiKey,
        defaultImageModel: normalizedModel,
        endpointPath: normalizedEndpoint
      } satisfies ProviderConnectionPayload)
      addLog(
        `[AI Studio] ${result.message}（Provider: ${result.provider} / Model: ${result.model} / Endpoint: ${result.endpointPath}）`
      )
      setVerifiedModelKeys((prev) => Array.from(new Set([...prev, testKey])))
      setFailedModelKeys((prev) => prev.filter((key) => key !== testKey))
    } catch (error) {
      setVerifiedModelKeys((prev) => prev.filter((key) => key !== testKey))
      setFailedModelKeys((prev) => Array.from(new Set([...prev, testKey])))
      const message = error instanceof Error ? error.message : String(error)
      addLog(
        `[AI Studio] 图片模型测试失败：${message}（Provider: ${providerProfile.providerName} / Model: ${normalizedModel} / Endpoint: ${normalizedEndpoint}）`
      )
      window.alert(
        [
          '图片模型测试失败',
          `原因：${message}`,
          `Provider: ${providerProfile.providerName}`,
          `Model: ${normalizedModel}`,
          `Endpoint: ${normalizedEndpoint}`
        ].join('\n')
      )
    } finally {
      setTestingModelKey('')
    }
  }

  const handleDeleteModel = async (
    providerProfile: AiProviderProfile,
    modelId: string,
    modelName: string
  ): Promise<void> => {
    const confirmed = window.confirm(`确定删除模型“${modelName}”吗？`)
    if (!confirmed) return

    try {
      const nextProfiles = providerProfiles.map((profile) => {
        if (profile.id !== providerProfile.id) return profile
        const nextModels = profile.models.filter((model) => model.id !== modelId)
        const nextDefaultModelId =
          profile.defaultModelId && nextModels.some((model) => model.id === profile.defaultModelId)
            ? profile.defaultModelId
            : (nextModels[0]?.id ?? null)
        return {
          ...profile,
          models: nextModels,
          defaultModelId: nextDefaultModelId
        }
      })

      const nextProviderProfile =
        nextProfiles.find((profile) => profile.id === providerProfile.id) ?? null
      const fallbackModel = nextProviderProfile?.models[0] ?? null

      await persistAiPatch(
        buildAiConfigPatch(
          nextProfiles,
          providerProfile.providerName,
          fallbackModel?.modelName ?? ''
        )
      )
      setVerifiedModelKeys((prev) =>
        prev.filter(
          (key) => !key.startsWith(`${providerProfile.id}:${normalizeAiProviderValue(modelName)}:`)
        )
      )
      setFailedModelKeys((prev) =>
        prev.filter(
          (key) => !key.startsWith(`${providerProfile.id}:${normalizeAiProviderValue(modelName)}:`)
        )
      )

      if (providerProfile.providerName === currentProviderName && modelName === currentModelName) {
        if (fallbackModel) {
          await state.setImageModel({
            provider: providerProfile.providerName,
            model: fallbackModel.modelName
          })
        } else {
          await state.setImageProvider(providerProfile.providerName)
        }
      }

      addLog(`[AI Studio] 已删除图片模型：${providerProfile.providerName} / ${modelName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 删除图片模型失败：${message}`)
      window.alert(message)
    }
  }

  return (
    <SharedModelConfigurator
      panelTitle="图片模型设置"
      panelDescription="供应商保存名称、Host 和 Key；模型保存模型名和 API 端点。点模型即可直接切换到当前图片任务。"
      closeAriaLabel="关闭图片模型设置"
      triggerWrapperClassName="flex w-[148px] min-w-[148px] shrink-0 flex-col gap-1"
      emptyTriggerLabel="新增供应商"
      currentProviderName={currentProviderName}
      currentModelName={currentModelName}
      providerProfiles={providerProfiles}
      isOpen={isOpen}
      activeProviderName={activeProviderName}
      activeProviderProfile={activeProviderProfile}
      isCreatingProvider={isCreatingProvider}
      providerNameDraft={providerNameDraft}
      providerBaseUrlDraft={providerBaseUrlDraft}
      providerApiKeyDraft={providerApiKeyDraft}
      providerDraftDirty={providerDraftDirty}
      isCreatingModel={isCreatingModel}
      modelNameDraft={modelNameDraft}
      modelEndpointDraft={modelEndpointDraft}
      modelNamePlaceholder="例如：gemini-2.5-flash-image-preview"
      modelEndpointPlaceholder="例如：/v1/chat/completions"
      testingModelKey={testingModelKey}
      verifiedModelKeys={verifiedModelKeys}
      failedModelKeys={failedModelKeys}
      onOpen={openConfigurator}
      onClose={() => setIsOpen(false)}
      onSelectProvider={syncProviderEditor}
      onStartCreateProvider={startCreateProvider}
      onProviderNameDraftChange={setProviderNameDraft}
      onProviderBaseUrlDraftChange={setProviderBaseUrlDraft}
      onProviderApiKeyDraftChange={setProviderApiKeyDraft}
      onSaveProvider={handleSaveProvider}
      onCancelCreateProvider={() => syncProviderEditor(providerProfiles[0]?.providerName || '')}
      onDeleteProvider={handleDeleteProvider}
      onStartCreateModel={startCreateModel}
      onModelNameDraftChange={setModelNameDraft}
      onModelEndpointDraftChange={setModelEndpointDraft}
      onSaveModel={handleSaveModel}
      onCancelCreateModel={() => {
        setIsCreatingModel(false)
        setModelNameDraft('')
        setModelEndpointDraft('')
      }}
      onChooseModel={(providerProfile, modelName) => handleChooseModel(providerProfile, modelName)}
      onTestModel={handleTestModel}
      onDeleteModel={handleDeleteModel}
    />
  )
}

function VideoModelConfigurator({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  const task = state.activeTask
  const videoMeta = state.videoMeta
  const config = useCmsStore((store) => store.config)
  const updateConfig = useCmsStore((store) => store.updateConfig)
  const addLog = useCmsStore((store) => store.addLog)
  const providerProfiles = Array.isArray(config.aiProviderProfiles) ? config.aiProviderProfiles : []
  const currentProviderName = normalizeAiProviderValue(task?.provider)
  const currentModelName = String(videoMeta.model ?? '').trim()
  const [isOpen, setIsOpen] = useState(false)
  const [activeProviderName, setActiveProviderName] = useState('')
  const [isCreatingProvider, setIsCreatingProvider] = useState(false)
  const [providerNameDraft, setProviderNameDraft] = useState('')
  const [providerBaseUrlDraft, setProviderBaseUrlDraft] = useState('')
  const [providerApiKeyDraft, setProviderApiKeyDraft] = useState('')
  const [isCreatingModel, setIsCreatingModel] = useState(false)
  const [modelNameDraft, setModelNameDraft] = useState('')
  const [modelEndpointDraft, setModelEndpointDraft] = useState('')
  const [testingModelKey, setTestingModelKey] = useState('')
  const [verifiedModelKeys, setVerifiedModelKeys] = useState<string[]>([])
  const [failedModelKeys, setFailedModelKeys] = useState<string[]>([])

  const hasProviders = providerProfiles.length > 0
  const activeProviderProfile = useMemo(
    () =>
      normalizeAiProviderValue(activeProviderName)
        ? findAiProviderProfile(providerProfiles, activeProviderName)
        : null,
    [activeProviderName, providerProfiles]
  )
  const providerDraftDirty = useMemo(() => {
    if (!activeProviderProfile || isCreatingProvider) return false
    return (
      providerBaseUrlDraft.trim() !== activeProviderProfile.baseUrl.trim() ||
      providerApiKeyDraft.trim() !== activeProviderProfile.apiKey.trim()
    )
  }, [activeProviderProfile, isCreatingProvider, providerApiKeyDraft, providerBaseUrlDraft])

  const syncProviderEditor = (providerName: string): void => {
    const providerProfile = findAiProviderProfile(providerProfiles, providerName)
    setActiveProviderName(providerProfile?.providerName ?? normalizeAiProviderValue(providerName))
    setProviderNameDraft('')
    setProviderBaseUrlDraft(providerProfile?.baseUrl ?? '')
    setProviderApiKeyDraft(providerProfile?.apiKey ?? '')
    setIsCreatingProvider(false)
    setIsCreatingModel(false)
    setModelNameDraft('')
    setModelEndpointDraft('')
  }

  const openConfigurator = (): void => {
    if (hasProviders) {
      syncProviderEditor(currentProviderName || providerProfiles[0]?.providerName || '')
    } else {
      setActiveProviderName('')
      setIsCreatingProvider(false)
      setProviderNameDraft('')
      setProviderBaseUrlDraft('')
      setProviderApiKeyDraft('')
      setIsCreatingModel(false)
      setModelNameDraft('')
      setModelEndpointDraft('')
    }
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen])

  const persistProviderProfiles = async (nextProfiles: AiProviderProfile[]): Promise<void> => {
    updateConfig({ aiProviderProfiles: nextProfiles })
    try {
      await window.electronAPI.saveConfig({ aiProviderProfiles: nextProfiles })
    } catch {
      addLog('[AI Studio] 保存视频模型配置失败。')
    }
  }

  const startCreateProvider = (): void => {
    setIsCreatingProvider(true)
    setActiveProviderName('')
    setProviderNameDraft('')
    setProviderBaseUrlDraft('')
    setProviderApiKeyDraft('')
    setIsCreatingModel(false)
    setModelNameDraft('')
    setModelEndpointDraft('')
  }

  const handleSaveProvider = async (): Promise<void> => {
    try {
      const providerName = normalizeAiProviderValue(
        isCreatingProvider
          ? providerNameDraft
          : activeProviderProfile?.providerName ||
              activeProviderName ||
              providerProfiles[0]?.providerName
      )
      const baseUrl = providerBaseUrlDraft.trim()
      const apiKey = providerApiKeyDraft.trim()
      if (!providerName) throw new Error('请先填写供应商名称。')
      if (!baseUrl) throw new Error('请先填写 Host / Base URL。')
      if (!apiKey) throw new Error('请先填写 API Key。')

      const existingProvider = findAiProviderProfile(providerProfiles, providerName)
      const nextProfiles = existingProvider
        ? providerProfiles.map((profile) =>
            profile.id === existingProvider.id ? { ...profile, baseUrl, apiKey } : profile
          )
        : [...providerProfiles, createProviderProfile(providerName, baseUrl, apiKey)]

      await persistProviderProfiles(nextProfiles)
      syncProviderEditor(providerName)
      addLog(`[AI Studio] 已保存视频供应商：${providerName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 保存视频供应商失败：${message}`)
      window.alert(message)
    }
  }

  const handleDeleteProvider = async (): Promise<void> => {
    if (!activeProviderProfile) return
    const confirmed = window.confirm(`确定删除供应商“${activeProviderProfile.providerName}”吗？`)
    if (!confirmed) return

    try {
      const nextProfiles = providerProfiles.filter(
        (profile) => profile.id !== activeProviderProfile.id
      )
      await persistProviderProfiles(nextProfiles)
      const nextProviderName = nextProfiles[0]?.providerName ?? ''
      syncProviderEditor(nextProviderName)
      await state.setVideoProvider(nextProviderName)
      addLog(`[AI Studio] 已删除视频供应商：${activeProviderProfile.providerName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 删除视频供应商失败：${message}`)
      window.alert(message)
    }
  }

  const startCreateModel = (): void => {
    if (!activeProviderProfile) {
      window.alert('请先保存并选择供应商。')
      return
    }
    setIsCreatingModel(true)
    setModelNameDraft('')
    setModelEndpointDraft('')
  }

  const handleSaveModel = async (): Promise<void> => {
    try {
      if (!activeProviderProfile) throw new Error('请先保存并选择供应商。')
      const modelName = normalizeAiProviderValue(modelNameDraft)
      const endpointPath = normalizeAiEndpointPath(modelEndpointDraft)
      if (!modelName) throw new Error('请先填写模型名称。')
      if (!endpointPath) throw new Error('请先填写模型 API 端点。')

      const nextProfiles = providerProfiles.map((profile) => {
        if (profile.id !== activeProviderProfile.id) return profile
        const existingModel = findAiModelProfile(profile, modelName)
        if (existingModel) {
          return {
            ...profile,
            models: profile.models.map((model) =>
              model.id === existingModel.id ? { ...model, endpointPath } : model
            ),
            defaultModelId: existingModel.id
          }
        }
        return {
          ...profile,
          models: [
            ...profile.models,
            {
              id: crypto.randomUUID(),
              modelName,
              endpointPath
            }
          ],
          defaultModelId: profile.defaultModelId
        }
      })

      await persistProviderProfiles(nextProfiles)
      setIsCreatingModel(false)
      setModelNameDraft('')
      setModelEndpointDraft('')
      addLog(`[AI Studio] 已保存视频模型：${activeProviderProfile.providerName} / ${modelName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 保存视频模型失败：${message}`)
      window.alert(message)
    }
  }

  const handleChooseModel = async (
    providerProfile: AiProviderProfile,
    modelName: string,
    endpointPath: string
  ): Promise<void> => {
    try {
      await state.setVideoProvider(providerProfile.providerName)
      await state.setVideoModel({
        provider: providerProfile.providerName,
        model: modelName,
        endpointPath
      })
      addLog(`[AI Studio] 已切换视频模型：${providerProfile.providerName} / ${modelName}`)
      setIsOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 切换视频模型失败：${message}`)
      window.alert(message)
    }
  }

  const handleTestModel = async (
    providerProfile: AiProviderProfile,
    modelName: string,
    endpointPath: string
  ): Promise<void> => {
    const normalizedModel = normalizeAiProviderValue(modelName)
    const normalizedEndpoint = normalizeAiEndpointPath(endpointPath)
    const testKey = `${providerProfile.id}:${normalizedModel}:${normalizedEndpoint}`
    if (!normalizedModel || !normalizedEndpoint) {
      window.alert('请先确保该模型已填写模型名和 API 端点。')
      return
    }

    setTestingModelKey(testKey)
    try {
      const result = await window.api.cms.aiStudio.provider.testConnection({
        provider: providerProfile.providerName,
        baseUrl: providerProfile.baseUrl,
        apiKey: providerProfile.apiKey,
        defaultImageModel: normalizedModel,
        endpointPath: normalizedEndpoint
      } satisfies ProviderConnectionPayload)
      addLog(
        `[AI Studio] ${result.message}（Provider: ${result.provider} / Model: ${result.model} / Endpoint: ${result.endpointPath}）`
      )
      setVerifiedModelKeys((prev) => Array.from(new Set([...prev, testKey])))
      setFailedModelKeys((prev) => prev.filter((key) => key !== testKey))
    } catch (error) {
      setVerifiedModelKeys((prev) => prev.filter((key) => key !== testKey))
      setFailedModelKeys((prev) => Array.from(new Set([...prev, testKey])))
      const message = error instanceof Error ? error.message : String(error)
      addLog(
        `[AI Studio] 模型测试失败：${message}（Provider: ${providerProfile.providerName} / Model: ${normalizedModel} / Endpoint: ${normalizedEndpoint}）`
      )
      window.alert(
        [
          '模型测试失败',
          `原因：${message}`,
          `Provider: ${providerProfile.providerName}`,
          `Model: ${normalizedModel}`,
          `Endpoint: ${normalizedEndpoint}`
        ].join('\n')
      )
    } finally {
      setTestingModelKey('')
    }
  }

  const handleDeleteModel = async (
    providerProfile: AiProviderProfile,
    modelId: string,
    modelName: string
  ): Promise<void> => {
    const confirmed = window.confirm(`确定删除模型“${modelName}”吗？`)
    if (!confirmed) return

    try {
      const nextProfiles = providerProfiles.map((profile) => {
        if (profile.id !== providerProfile.id) return profile
        const nextModels = profile.models.filter((model) => model.id !== modelId)
        const nextDefaultModelId =
          profile.defaultModelId && nextModels.some((model) => model.id === profile.defaultModelId)
            ? profile.defaultModelId
            : (nextModels[0]?.id ?? null)
        return {
          ...profile,
          models: nextModels,
          defaultModelId: nextDefaultModelId
        }
      })

      await persistProviderProfiles(nextProfiles)
      setVerifiedModelKeys((prev) =>
        prev.filter(
          (key) => !key.startsWith(`${providerProfile.id}:${normalizeAiProviderValue(modelName)}:`)
        )
      )
      setFailedModelKeys((prev) =>
        prev.filter(
          (key) => !key.startsWith(`${providerProfile.id}:${normalizeAiProviderValue(modelName)}:`)
        )
      )

      if (providerProfile.providerName === currentProviderName && modelName === currentModelName) {
        const nextProviderProfile =
          nextProfiles.find((profile) => profile.id === providerProfile.id) ?? null
        const fallbackModel = nextProviderProfile?.models[0] ?? null
        await state.setVideoModel({
          provider: providerProfile.providerName,
          model: fallbackModel?.modelName ?? '',
          endpointPath: fallbackModel?.endpointPath ?? ''
        })
      }

      addLog(`[AI Studio] 已删除视频模型：${providerProfile.providerName} / ${modelName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 删除视频模型失败：${message}`)
      window.alert(message)
    }
  }

  return (
    <SharedModelConfigurator
      panelTitle="视频模型设置"
      panelDescription="供应商保存名称、Host 和 Key；模型保存模型名和 API 端点。点模型即可直接切换到当前视频任务。"
      closeAriaLabel="关闭模型设置"
      triggerWrapperClassName="relative flex min-w-[198px] flex-[1.25] flex-col gap-1"
      emptyTriggerLabel="新增模型供应商"
      currentProviderName={currentProviderName}
      currentModelName={currentModelName}
      providerProfiles={providerProfiles}
      isOpen={isOpen}
      activeProviderName={activeProviderName}
      activeProviderProfile={activeProviderProfile}
      isCreatingProvider={isCreatingProvider}
      providerNameDraft={providerNameDraft}
      providerBaseUrlDraft={providerBaseUrlDraft}
      providerApiKeyDraft={providerApiKeyDraft}
      providerDraftDirty={providerDraftDirty}
      isCreatingModel={isCreatingModel}
      modelNameDraft={modelNameDraft}
      modelEndpointDraft={modelEndpointDraft}
      modelNamePlaceholder="例如：jimeng-video-3.0"
      modelEndpointPlaceholder="例如：/v1/video/create"
      testingModelKey={testingModelKey}
      verifiedModelKeys={verifiedModelKeys}
      failedModelKeys={failedModelKeys}
      onOpen={openConfigurator}
      onClose={() => setIsOpen(false)}
      onSelectProvider={syncProviderEditor}
      onStartCreateProvider={startCreateProvider}
      onProviderNameDraftChange={setProviderNameDraft}
      onProviderBaseUrlDraftChange={setProviderBaseUrlDraft}
      onProviderApiKeyDraftChange={setProviderApiKeyDraft}
      onSaveProvider={handleSaveProvider}
      onCancelCreateProvider={() => syncProviderEditor(providerProfiles[0]?.providerName || '')}
      onDeleteProvider={handleDeleteProvider}
      onStartCreateModel={startCreateModel}
      onModelNameDraftChange={setModelNameDraft}
      onModelEndpointDraftChange={setModelEndpointDraft}
      onSaveModel={handleSaveModel}
      onCancelCreateModel={() => {
        setIsCreatingModel(false)
        setModelNameDraft('')
        setModelEndpointDraft('')
      }}
      onChooseModel={handleChooseModel}
      onTestModel={handleTestModel}
      onDeleteModel={handleDeleteModel}
    />
  )
}

function ControlPanel({
  state,
  promptDraft,
  onPromptClear
}: {
  state: UseAiStudioStateResult
  promptDraft: string
  onPromptClear: () => void
}): React.JSX.Element {
  const addLog = useCmsStore((store) => store.addLog)
  const config = useCmsStore((store) => store.config)
  const task = state.activeTask
  const isVideoStudio = state.studioCapability === 'video'
  const currentImageSelection = useMemo(
    () =>
      resolveAiTaskProviderSelection(
        Array.isArray(config.aiProviderProfiles) ? config.aiProviderProfiles : [],
        {
          taskProviderName: task?.provider,
          taskModelName: task?.model,
          fallbackProviderName: config.aiProvider,
          fallbackModelName: config.aiDefaultImageModel || DEFAULT_GRSAI_IMAGE_MODEL
        }
      ),
    [
      config.aiDefaultImageModel,
      config.aiProvider,
      config.aiProviderProfiles,
      task?.model,
      task?.provider
    ]
  )
  const currentImageModel = currentImageSelection.modelName || DEFAULT_GRSAI_IMAGE_MODEL
  const currentVideoMeta = state.videoMeta
  const availableVideoAspectRatioOptions = useMemo(
    () =>
      VIDEO_ASPECT_RATIO_OPTIONS.filter((option) =>
        getAllowedVideoAspectRatios(currentVideoMeta.model).includes(option.value)
      ),
    [currentVideoMeta.model]
  )
  const availableVideoDurationOptions = useMemo(
    () =>
      VIDEO_DURATION_OPTIONS.filter((option) =>
        getAllowedVideoDurations(currentVideoMeta.model).includes(option.value)
      ),
    [currentVideoMeta.model]
  )
  const requestedImageCount = Math.max(1, state.masterOutputCount || 1)
  const requestedVideoCount = Math.max(1, currentVideoMeta.outputCount || 1)
  const previewRuntimeStates = task ? state.previewSlotRuntimeByTaskId[task.id] ?? {} : null
  const isRunning =
    task?.status === 'running' ||
    (!isVideoStudio && hasActivePreviewSlotRuntimeStates(previewRuntimeStates))
  const isInterrupting = task ? state.interruptingTaskIds.includes(task.id) : false
  const primaryActionState = resolvePrimaryGenerateButtonState({
    isVideoStudio,
    isRunning,
    isInterrupting
  })
  const poolTriggerRef = useRef<HTMLDivElement | null>(null)
  const poolCloseTimerRef = useRef<number | null>(null)

  const [imageOutputCountDraft, setImageOutputCountDraft] = useState(String(requestedImageCount))
  const [videoOutputCountDraft, setVideoOutputCountDraft] = useState(String(requestedVideoCount))
  const [isPoolPopoverOpen, setIsPoolPopoverOpen] = useState(false)

  useEffect(() => {
    setImageOutputCountDraft(String(requestedImageCount))
  }, [requestedImageCount, task?.id])

  useEffect(() => {
    setVideoOutputCountDraft(String(requestedVideoCount))
  }, [requestedVideoCount, task?.id, state.studioCapability])

  useEffect(() => {
    if (state.pooledOutputCount > 0) return
    setIsPoolPopoverOpen(false)
  }, [state.pooledOutputCount])

  useEffect(
    () => () => {
      if (poolCloseTimerRef.current === null) return
      window.clearTimeout(poolCloseTimerRef.current)
    },
    []
  )

  const handleGenerate = async (): Promise<void> => {
    try {
      const promptText = promptDraft.trim()
      if (!promptText) {
        throw new Error('请先输入提示词。')
      }

      if (isVideoStudio) {
        const normalizedRequestedCount = parseOutputCountDraft(videoOutputCountDraft, {
          fieldLabel: '输出条数',
          min: 1,
          max: 4
        })
        setVideoOutputCountDraft(String(normalizedRequestedCount))
        await state.setVideoOutputCount(normalizedRequestedCount)
        await state.startVideoWorkflow({
          taskId: task?.id ?? null,
          promptText,
          onStarted: onPromptClear
        })
        addLog('[AI Studio] 已启动视频生成任务')
        return
      }

      const normalizedRequestedCount = parseOutputCountDraft(imageOutputCountDraft, {
        fieldLabel: '输出张数',
        min: 1
      })
      setImageOutputCountDraft(String(normalizedRequestedCount))
      if (task) {
        await state.setMasterOutputCount(normalizedRequestedCount)
      }
      await state.startMasterWorkflow({
        taskId: task?.id ?? null,
        promptText,
        model: currentImageModel,
        requestedCount: normalizedRequestedCount,
        templateId: null,
        onStarted: onPromptClear
      })
      addLog('[AI Studio] 已启动生成任务')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 生成失败：${message}`)
      window.alert(message)
    }
  }

  const handleSendPool = async (): Promise<void> => {
    try {
      await state.sendPooledOutputsToWorkshop()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 发送素材池失败：${message}`)
      window.alert(message)
    }
  }

  const handleStartRemix = async (): Promise<void> => {
    try {
      await state.sendPooledOutputsToVideoComposer()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[AI Studio] 开始混剪失败：${message}`)
      window.alert(message)
    }
  }

  const clearPoolCloseTimer = (): void => {
    if (poolCloseTimerRef.current === null) return
    window.clearTimeout(poolCloseTimerRef.current)
    poolCloseTimerRef.current = null
  }

  const openPoolPopover = (): void => {
    clearPoolCloseTimer()
    if (state.pooledOutputCount <= 0) return
    setIsPoolPopoverOpen(true)
  }

  const scheduleClosePoolPopover = (): void => {
    clearPoolCloseTimer()
    poolCloseTimerRef.current = window.setTimeout(() => {
      setIsPoolPopoverOpen(false)
      poolCloseTimerRef.current = null
    }, 90)
  }

  const actionButtonClass =
    'relative inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-zinc-950 bg-white px-3 text-[12px] font-medium text-zinc-950 shadow-[0_8px_20px_rgba(15,23,42,0.08)] hover:bg-zinc-50 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400'
  const fieldClass =
    'h-8 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 text-[12px] text-zinc-900 outline-none transition focus:border-sky-400'
  const canStartPooledRemix = canStartPoolRemix(state.pooledOutputAssets)
  const sendPoolButtonText = resolvePoolSendButtonText()

  return (
    <div className="relative z-30 flex min-w-0 items-end gap-2 overflow-x-auto overflow-y-visible pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-0 flex-1 flex-nowrap items-end gap-2">
        {isVideoStudio ? (
          <>
            <VideoModelConfigurator state={state} />

            <label className="flex w-[104px] min-w-[104px] shrink-0 flex-col gap-1">
              <span className={CONTROL_FIELD_LABEL_CLASS}>模式</span>
              <select
                value={currentVideoMeta.mode}
                onChange={(event) => void state.setVideoMode(event.target.value as never)}
                className={fieldClass}
              >
                {VIDEO_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex w-[104px] min-w-[104px] shrink-0 flex-col gap-1">
              <span className={CONTROL_FIELD_LABEL_CLASS}>比例</span>
              <select
                value={currentVideoMeta.aspectRatio}
                onChange={(event) => void state.setVideoAspectRatio(event.target.value as never)}
                className={fieldClass}
              >
                {availableVideoAspectRatioOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex w-[88px] min-w-[88px] shrink-0 flex-col gap-1">
              <span className={CONTROL_FIELD_LABEL_CLASS}>清晰度</span>
              <select
                value={currentVideoMeta.resolution}
                onChange={(event) => void state.setVideoResolution(event.target.value as never)}
                className={fieldClass}
              >
                {VIDEO_RESOLUTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex w-[76px] min-w-[76px] shrink-0 flex-col gap-1">
              <span className={CONTROL_FIELD_LABEL_CLASS}>时长</span>
              <select
                value={String(currentVideoMeta.duration)}
                onChange={(event) =>
                  void state.setVideoDuration(Number(event.target.value) as never)
                }
                className={fieldClass}
              >
                {availableVideoDurationOptions.map((option) => (
                  <option key={option.value} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex w-[80px] min-w-[80px] shrink-0 flex-col gap-1">
              <span className={CONTROL_FIELD_LABEL_CLASS}>条数</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={videoOutputCountDraft}
                onChange={(event) => setVideoOutputCountDraft(event.target.value)}
                onBlur={() => {
                  const normalizedValue = normalizeOutputCountDraftOnBlur(videoOutputCountDraft, {
                    fieldLabel: '输出条数',
                    min: 1,
                    max: 4
                  })
                  setVideoOutputCountDraft(normalizedValue)
                  if (/^\d+$/.test(String(normalizedValue))) {
                    void state.setVideoOutputCount(Number.parseInt(normalizedValue, 10))
                  }
                }}
                className={fieldClass}
              />
            </label>
          </>
        ) : (
          <>
            <ImageModelConfigurator state={state} />

            <label className="flex w-[76px] min-w-[76px] shrink-0 flex-col gap-1">
              <span className={CONTROL_FIELD_LABEL_CLASS}>输出张数</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={imageOutputCountDraft}
                onChange={(event) => setImageOutputCountDraft(event.target.value)}
                onBlur={() => {
                  const normalizedValue = normalizeOutputCountDraftOnBlur(imageOutputCountDraft, {
                    fieldLabel: '输出张数',
                    min: 1
                  })
                  setImageOutputCountDraft(normalizedValue)
                  if (/^\d+$/.test(String(normalizedValue))) {
                    void state.setMasterOutputCount(Number.parseInt(normalizedValue, 10))
                  }
                }}
                className={fieldClass}
                disabled={!task}
              />
            </label>
          </>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
        <div
          ref={poolTriggerRef}
          className="relative z-[120] shrink-0"
          onMouseEnter={openPoolPopover}
          onMouseLeave={scheduleClosePoolPopover}
          onFocusCapture={openPoolPopover}
          onBlurCapture={scheduleClosePoolPopover}
        >
          <Button
            type="button"
            className={cn(actionButtonClass, 'gap-1.5')}
            onClick={() => void handleSendPool()}
            disabled={state.pooledOutputCount <= 0}
          >
            <Send className="h-3.5 w-3.5" />
            <span className="max-[1320px]:hidden">{sendPoolButtonText}</span>
            {state.pooledOutputCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-zinc-950 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                {state.pooledOutputCount}
              </span>
            ) : null}
          </Button>
        </div>

        <PooledOutputPopover
          anchorRef={poolTriggerRef}
          open={state.pooledOutputCount > 0 && isPoolPopoverOpen}
          assets={state.pooledOutputAssets}
          showRemixShortcut={canStartPooledRemix}
          onStartRemix={() => void handleStartRemix()}
          onRemove={(targetAsset) =>
            void state.toggleDispatchOutputPoolForTask(targetAsset.taskId, targetAsset.id)
          }
          onMouseEnter={openPoolPopover}
          onMouseLeave={scheduleClosePoolPopover}
        />

        <Button
          type="button"
          className={cn(actionButtonClass, 'gap-1.5')}
          onClick={() => {
            if (primaryActionState.intent === 'interrupt') {
              void state.interruptActiveTask()
              return
            }
            void handleGenerate()
          }}
          disabled={primaryActionState.disabled}
        >
          <ArrowUp className="h-3.5 w-3.5" />
          <span className="max-[1320px]:hidden">{primaryActionState.actionLabel}</span>
        </Button>
      </div>
    </div>
  )
}

export { ControlPanel }
