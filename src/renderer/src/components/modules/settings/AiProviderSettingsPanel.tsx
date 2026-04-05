import { useEffect, useMemo, useState } from 'react'
import type * as React from 'react'

import { Pencil, Plus } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  buildAiConfigPatch,
  resolveAiTaskProviderSelection
} from '@renderer/lib/aiProviderProfiles'
import type { CmsConfig } from '@renderer/store/useCmsStore'
import { BUILTIN_AI_PROVIDER_CATALOG } from '../../../../../shared/ai/providerCatalog'
import type {
  AiCapability,
  AiModelProfile,
  AiModelProtocol,
  AiProviderProfile,
  AiRuntimeDefaults
} from '../../../../../shared/ai/aiProviderTypes'

import {
  applyAiCapabilityDefaultSelection,
  buildAiModelHealthCacheSignature,
  createCustomAiProviderProfile,
  isAiModelHealthCacheFresh,
  mergeAiProviderProfilesWithCatalog,
  preserveDeletedAiProviderTombstones,
  removeAiCapabilityModel,
  setAiRuntimeDefaultProvider,
  upsertAiCapabilityModel
} from './aiProviderFormHelpers'

type ModelHealthState = 'idle' | 'checking' | 'healthy' | 'unhealthy'
type CachedModelHealthEntry = {
  status: Extract<ModelHealthState, 'healthy' | 'unhealthy'>
  checkedAt: number
  signature: string
}

type ProviderModelCard = {
  key: string
  providerId: string
  providerName: string
  capability: AiCapability
  modelId: string
  modelName: string
  endpointPath: string
  protocol: AiModelProtocol
  enabled: boolean
  isRouteSelected: boolean
}

const AI_MODEL_HEALTH_CACHE_KEY = 'cms.ai-provider-model-health.v1'

const CAPABILITY_META: Record<AiCapability, { label: string; className: string }> = {
  chat: { label: '会话', className: 'bg-violet-100 text-violet-700' },
  image: { label: '图片', className: 'bg-sky-100 text-sky-700' },
  video: { label: '视频', className: 'bg-emerald-100 text-emerald-700' }
}

function normalizeRuntimeDefaults(value: AiRuntimeDefaults | null | undefined): AiRuntimeDefaults {
  return {
    chatProviderId: value?.chatProviderId ?? null,
    imageProviderId: value?.imageProviderId ?? null,
    videoProviderId: value?.videoProviderId ?? null
  }
}

function buildSettingsPatch(
  profiles: AiProviderProfile[],
  runtimeDefaults: AiRuntimeDefaults,
  currentConfig: CmsConfig
) {
  const persistedProfiles = Array.isArray(currentConfig.aiProviderProfiles)
    ? currentConfig.aiProviderProfiles
    : []
  const nextProfiles = preserveDeletedAiProviderTombstones(profiles, persistedProfiles)
  const imageSelection = resolveAiTaskProviderSelection(profiles, {
    capability: 'image',
    fallbackProviderId: runtimeDefaults.imageProviderId,
    fallbackProviderName: currentConfig.aiProvider,
    fallbackModelName: currentConfig.aiDefaultImageModel
  })

  return buildAiConfigPatch(
    nextProfiles,
    runtimeDefaults,
    imageSelection.providerName || currentConfig.aiProvider,
    imageSelection.modelName || currentConfig.aiDefaultImageModel
  )
}

function countProviderModels(provider: AiProviderProfile): number {
  return (
    provider.capabilities.chat.models.length +
    provider.capabilities.image.models.length +
    provider.capabilities.video.models.length
  )
}

function getRuntimeDefaultProviderId(
  runtimeDefaults: AiRuntimeDefaults,
  capability: AiCapability
): string | null {
  if (capability === 'chat') return runtimeDefaults.chatProviderId
  if (capability === 'video') return runtimeDefaults.videoProviderId
  return runtimeDefaults.imageProviderId
}

function buildProviderModelCards(
  provider: AiProviderProfile,
  runtimeDefaults: AiRuntimeDefaults
): ProviderModelCard[] {
  return (['chat', 'image', 'video'] as AiCapability[]).flatMap((capability) => {
    const capabilityState = provider.capabilities[capability]
    const runtimeDefaultProviderId = getRuntimeDefaultProviderId(runtimeDefaults, capability)
    return capabilityState.models.map((model) => ({
      key: `${provider.id}:${capability}:${model.id}`,
      providerId: provider.id,
      providerName: provider.providerName,
      capability,
      modelId: model.id,
      modelName: model.modelName,
      endpointPath: model.endpointPath,
      protocol: model.protocol,
      enabled: model.enabled,
      isRouteSelected:
        runtimeDefaultProviderId === provider.id && capabilityState.defaultModelId === model.id
    }))
  })
}

function buildProviderLogo(providerName: string): string {
  const normalized = providerName.trim()
  return normalized ? normalized.slice(0, 2).toUpperCase() : 'AI'
}

function getCapabilityProviders(
  profiles: AiProviderProfile[],
  capability: AiCapability
): AiProviderProfile[] {
  return profiles.filter((profile) => {
    const capabilityState = profile.capabilities[capability]
    return profile.enabled && capabilityState.enabled && capabilityState.models.length > 0
  })
}

function readAiModelHealthCache(): Record<string, CachedModelHealthEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(AI_MODEL_HEALTH_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, CachedModelHealthEntry>)
      : {}
  } catch {
    return {}
  }
}

function writeAiModelHealthCache(cache: Record<string, CachedModelHealthEntry>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_MODEL_HEALTH_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore storage write failures and fall back to in-memory UI state.
  }
}

export function AiProviderSettingsPanel({
  config,
  updateConfig
}: {
  config: CmsConfig
  updateConfig: (patch: Partial<CmsConfig>) => void
}): React.JSX.Element {
  const persistedProfiles = Array.isArray(config.aiProviderProfiles)
    ? config.aiProviderProfiles
    : []
  const runtimeDefaults = useMemo(
    () => normalizeRuntimeDefaults(config.aiRuntimeDefaults),
    [config.aiRuntimeDefaults]
  )
  const mergedProfiles = useMemo(
    () => mergeAiProviderProfilesWithCatalog(BUILTIN_AI_PROVIDER_CATALOG, persistedProfiles),
    [persistedProfiles]
  )

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null)
  const [isProviderPanelOpen, setIsProviderPanelOpen] = useState(false)
  const [providerDraftName, setProviderDraftName] = useState('')
  const [providerDraftBaseUrl, setProviderDraftBaseUrl] = useState('')
  const [providerDraftApiKey, setProviderDraftApiKey] = useState('')
  const [providerDraftEnabled, setProviderDraftEnabled] = useState(true)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isCreateModelPanelOpen, setIsCreateModelPanelOpen] = useState(false)
  const [isEditModelPanelOpen, setIsEditModelPanelOpen] = useState(false)
  const [newModelCapability, setNewModelCapability] = useState<AiCapability>('chat')
  const [newModelName, setNewModelName] = useState('')
  const [newModelEndpoint, setNewModelEndpoint] = useState('')
  const [editModelName, setEditModelName] = useState('')
  const [editModelEndpoint, setEditModelEndpoint] = useState('')
  const [modelHealth, setModelHealth] = useState<Record<string, ModelHealthState>>({})

  useEffect(() => {
    const hydratedProfiles = preserveDeletedAiProviderTombstones(mergedProfiles, persistedProfiles)
    const needsCatalogHydration =
      hydratedProfiles.length !== persistedProfiles.length ||
      hydratedProfiles.some(
        (profile, index) =>
          persistedProfiles[index]?.id !== profile.id ||
          Boolean(persistedProfiles[index]?.deleted) !== Boolean(profile.deleted)
      )
    const needsRuntimeDefaults =
      runtimeDefaults.chatProviderId !== config.aiRuntimeDefaults.chatProviderId ||
      runtimeDefaults.imageProviderId !== config.aiRuntimeDefaults.imageProviderId ||
      runtimeDefaults.videoProviderId !== config.aiRuntimeDefaults.videoProviderId

    if (!needsCatalogHydration && !needsRuntimeDefaults) return
    updateConfig(buildSettingsPatch(mergedProfiles, runtimeDefaults, config))
  }, [config, mergedProfiles, persistedProfiles, runtimeDefaults, updateConfig])

  useEffect(() => {
    if (mergedProfiles.length === 0) {
      setSelectedProviderId(null)
      return
    }
    if (selectedProviderId && mergedProfiles.some((profile) => profile.id === selectedProviderId))
      return
    setSelectedProviderId(mergedProfiles[0]?.id ?? null)
  }, [mergedProfiles, selectedProviderId])

  const applyPatch = (nextProfiles: AiProviderProfile[], nextDefaults = runtimeDefaults): void => {
    updateConfig(buildSettingsPatch(nextProfiles, nextDefaults, config))
  }

  const handleAddProvider = (): void => {
    const nextProvider = createCustomAiProviderProfile({
      providerName: `自定义供应商 ${mergedProfiles.filter((profile) => profile.source === 'custom').length + 1}`
    })
    applyPatch([...mergedProfiles, nextProvider])
    setSelectedProviderId(nextProvider.id)
    setIsProviderPanelOpen(true)
  }

  const handleChangeProvider = (providerId: string, patch: Partial<AiProviderProfile>): void => {
    const nextProfiles = mergedProfiles.map((profile) =>
      profile.id === providerId ? { ...profile, ...patch } : profile
    )
    applyPatch(nextProfiles)
  }

  const handleRemoveProvider = (providerId: string): void => {
    const targetProvider = mergedProfiles.find((profile) => profile.id === providerId)
    if (!targetProvider) return
    const nextProfiles =
      targetProvider.source === 'builtin'
        ? mergedProfiles.map((profile) =>
            profile.id === providerId ? { ...profile, deleted: true, enabled: false } : profile
          )
        : mergedProfiles.filter((profile) => profile.id !== providerId)
    let nextDefaults = runtimeDefaults
    ;(['chat', 'image', 'video'] as AiCapability[]).forEach((capability) => {
      const key =
        capability === 'chat'
          ? 'chatProviderId'
          : capability === 'video'
            ? 'videoProviderId'
            : 'imageProviderId'
      if (nextDefaults[key] === providerId) {
        nextDefaults = setAiRuntimeDefaultProvider(nextDefaults, capability, null)
      }
    })
    applyPatch(nextProfiles, nextDefaults)
    setSelectedProviderId(nextProfiles[0]?.id ?? null)
    setSelectedModelKey(null)
    setIsProviderPanelOpen(false)
    setIsDeleteConfirmOpen(false)
    setIsEditModelPanelOpen(false)
    setIsCreateModelPanelOpen(false)
  }

  const handleUpsertModel = (
    providerId: string,
    capability: AiCapability,
    model: Partial<AiModelProfile> & { modelName: string; endpointPath: string }
  ): void => {
    applyPatch(upsertAiCapabilityModel(mergedProfiles, providerId, capability, model))
  }

  const handleRemoveModel = (
    providerId: string,
    capability: AiCapability,
    modelId: string
  ): void => {
    applyPatch(removeAiCapabilityModel(mergedProfiles, providerId, capability, modelId))
    setSelectedModelKey((current) =>
      current === `${providerId}:${capability}:${modelId}` ? null : current
    )
  }

  const handleSetDefaultModel = (
    providerId: string,
    capability: AiCapability,
    modelId: string
  ): void => {
    const result = applyAiCapabilityDefaultSelection(
      mergedProfiles,
      runtimeDefaults,
      providerId,
      capability,
      modelId
    )
    applyPatch(result.profiles, result.runtimeDefaults)
  }

  const selectedProvider =
    mergedProfiles.find((profile) => profile.id === selectedProviderId) ?? mergedProfiles[0] ?? null
  const providerById = useMemo(
    () => new Map(mergedProfiles.map((profile) => [profile.id, profile])),
    [mergedProfiles]
  )
  const scopedModelCards = useMemo(
    () => (selectedProvider ? buildProviderModelCards(selectedProvider, runtimeDefaults) : []),
    [runtimeDefaults, selectedProvider]
  )
  const filteredModelCards = scopedModelCards
  const selectedModel =
    filteredModelCards.find((card) => card.key === selectedModelKey) ??
    scopedModelCards.find((card) => card.key === selectedModelKey) ??
    null

  const resetCreateModelDraft = (): void => {
    setNewModelCapability('chat')
    setNewModelName('')
    setNewModelEndpoint('')
  }

  const resetEditModelDraft = (): void => {
    setEditModelName('')
    setEditModelEndpoint('')
  }

  useEffect(() => {
    if (!selectedProvider) return
    setProviderDraftName(selectedProvider.providerName)
    setProviderDraftBaseUrl(selectedProvider.baseUrl)
    setProviderDraftApiKey(selectedProvider.apiKey)
    setProviderDraftEnabled(selectedProvider.enabled)
  }, [selectedProvider])

  useEffect(() => {
    if (!selectedModel) return
    setEditModelName(selectedModel.modelName)
    setEditModelEndpoint(selectedModel.endpointPath)
  }, [selectedModel])

  const probeModel = async (
    card: ProviderModelCard,
    options?: { force?: boolean; cancelled?: () => boolean }
  ): Promise<void> => {
    const provider = providerById.get(card.providerId) ?? null
    const signature =
      provider
        ? buildAiModelHealthCacheSignature(provider, {
            modelName: card.modelName,
            endpointPath: card.endpointPath,
            enabled: card.enabled
          })
        : ''
    const cache = readAiModelHealthCache()
    const cachedEntry = cache[card.key]
    const force = options?.force === true

    if (
      !force &&
      cachedEntry &&
      cachedEntry.signature === signature &&
      isAiModelHealthCacheFresh(cachedEntry.checkedAt)
    ) {
      setModelHealth((current) => ({
        ...current,
        [card.key]: cachedEntry.status
      }))
      return
    }

    setModelHealth((current) => ({
      ...current,
      [card.key]: 'checking'
    }))

    if (
      !provider ||
      !provider.enabled ||
      !provider.baseUrl.trim() ||
      !card.enabled ||
      !card.modelName.trim() ||
      !card.endpointPath.trim()
    ) {
      if (!options?.cancelled?.()) {
        const nextCache = readAiModelHealthCache()
        nextCache[card.key] = {
          status: 'unhealthy',
          checkedAt: Date.now(),
          signature
        }
        writeAiModelHealthCache(nextCache)
        setModelHealth((current) => ({
          ...current,
          [card.key]: 'unhealthy'
        }))
      }
      return
    }

    try {
      await window.api.cms.aiStudio.provider.testConnection({
        provider: provider.providerName,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        defaultImageModel: card.modelName,
        endpointPath: card.endpointPath
      })
      if (!options?.cancelled?.()) {
        const nextCache = readAiModelHealthCache()
        nextCache[card.key] = {
          status: 'healthy',
          checkedAt: Date.now(),
          signature
        }
        writeAiModelHealthCache(nextCache)
        setModelHealth((current) => ({
          ...current,
          [card.key]: 'healthy'
        }))
      }
    } catch {
      if (!options?.cancelled?.()) {
        const nextCache = readAiModelHealthCache()
        nextCache[card.key] = {
          status: 'unhealthy',
          checkedAt: Date.now(),
          signature
        }
        writeAiModelHealthCache(nextCache)
        setModelHealth((current) => ({
          ...current,
          [card.key]: 'unhealthy'
        }))
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    if (filteredModelCards.length === 0) return

    for (const card of filteredModelCards) {
      void probeModel(card, {
        cancelled: () => cancelled
      })
    }

    return () => {
      cancelled = true
    }
  }, [filteredModelCards, providerById])

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-white text-zinc-950 shadow-[0_24px_90px_rgba(15,23,42,0.06)]">
      <div className="relative px-6 py-6">
        <div className="text-[30px] font-semibold tracking-[-0.04em] text-zinc-950">
          AI 供应商
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {(['chat', 'image', 'video'] as AiCapability[]).map((capability) => {
            const providers = getCapabilityProviders(mergedProfiles, capability)
            const currentProviderId =
              capability === 'chat'
                ? (runtimeDefaults.chatProviderId ?? '')
                : capability === 'image'
                  ? (runtimeDefaults.imageProviderId ?? '')
                  : (runtimeDefaults.videoProviderId ?? '')
            const currentProvider =
              providers.find((profile) => profile.id === currentProviderId) ?? null
            const currentProviderName = currentProvider?.providerName ?? '未设置供应商'
            const currentModelName =
              currentProvider?.capabilities[capability].models.find(
                (model) => model.id === currentProvider.capabilities[capability].defaultModelId
              )?.modelName ?? '未设置'

            return (
              <div
                key={capability}
                className="rounded-[22px] bg-white px-4 py-4 shadow-[0_8px_24px_rgba(24,24,27,0.04)]"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${CAPABILITY_META[capability].className}`}
                  >
                    {CAPABILITY_META[capability].label}
                  </span>
                  <span className="text-[13px] font-semibold text-zinc-900">默认路由</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white px-4 py-3">
                  <div className="min-w-0 truncate text-[14px] font-semibold text-zinc-900">
                    {currentProviderName}
                  </div>
                  <div className="min-w-0 truncate text-right text-[12px] text-slate-500">
                    {currentModelName}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-6 bg-white">
          <div className="mb-4 px-2 text-[13px] font-medium tracking-[0.16em] text-zinc-500">
            PROVIDERS
          </div>
          <div
            className="flex items-start gap-4"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}
          >
            <div className="shrink-0" style={{ width: 320, minWidth: 320, flex: '0 0 320px' }}>
              <div className="space-y-2">
                {mergedProfiles.map((provider) => {
                  const modelCount = countProviderModels(provider)
                  const isActive =
                    (selectedProvider?.id ?? mergedProfiles[0]?.id ?? null) === provider.id
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        setSelectedProviderId(provider.id)
                        setSelectedModelKey(null)
                      }}
                      className={`w-full rounded-[22px] px-4 py-4 text-left transition ${
                        isActive
                          ? 'bg-zinc-50 text-zinc-950 shadow-[0_8px_20px_rgba(24,24,27,0.05)]'
                          : 'bg-white text-zinc-700 hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-800 shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
                          {buildProviderLogo(provider.providerName)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[15px] font-semibold">
                            {provider.providerName || '未命名供应商'}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500">
                            {provider.source === 'builtin' ? '内置' : '自定义'} · {modelCount}{' '}
                            个模型
                          </div>
                        </div>
                        {isActive ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setIsProviderPanelOpen(true)
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
                              aria-label="编辑供应商连接设置"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setIsCreateModelPanelOpen(true)
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
                              aria-label="新增模型"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={handleAddProvider}
                  className="flex h-12 w-full items-center justify-center rounded-[18px] bg-zinc-50 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                  aria-label="新增供应商"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div
              className="min-w-0 flex-1 overflow-hidden rounded-[22px] bg-zinc-50 px-3 py-3"
              style={{ flex: '1 1 0%', minWidth: 0, overflow: 'hidden' }}
            >
              {selectedProvider ? (
                <>
                  <div className="space-y-2">
                    {filteredModelCards.map((card) => {
                      const healthState = modelHealth[card.key] ?? 'idle'
                      const healthClassName =
                        healthState === 'healthy'
                          ? 'bg-emerald-500'
                          : healthState === 'unhealthy'
                            ? 'bg-rose-500'
                            : 'bg-zinc-300'
                      const healthLabel =
                        healthState === 'healthy'
                          ? '节点可用'
                          : healthState === 'unhealthy'
                            ? '节点不可用'
                            : '节点检测中'
                      const isChecking = healthState === 'checking'

                      return (
                        <div
                          key={card.key}
                          className={`flex items-center gap-3 rounded-[16px] px-3 py-2 transition ${
                            selectedModelKey === card.key
                              ? 'bg-white'
                              : 'bg-transparent hover:bg-white/80'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              void probeModel(card, { force: true })
                            }}
                            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                            aria-label={`${healthLabel}，点击重测`}
                            title={`${healthLabel}，点击重测`}
                          >
                            <span
                              className={`inline-flex h-2.5 w-2.5 rounded-full ${healthClassName} ${
                                isChecking ? 'animate-pulse' : ''
                              }`}
                            />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-zinc-200 bg-white text-[12px] font-semibold text-zinc-700">
                              {buildProviderLogo(card.providerName)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[15px] font-semibold text-zinc-950">
                                {card.modelName}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${CAPABILITY_META[card.capability].className}`}
                                >
                                  {CAPABILITY_META[card.capability].label}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedModelKey(card.key)
                              setIsEditModelPanelOpen(true)
                            }}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
                            aria-label="编辑模型"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleSetDefaultModel(card.providerId, card.capability, card.modelId)
                              setSelectedModelKey(card.key)
                            }}
                            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm transition ${
                              card.isRouteSelected
                                ? 'border-zinc-950 bg-zinc-950 text-white'
                                : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300 hover:text-zinc-700'
                            }`}
                            aria-label={card.isRouteSelected ? '当前生效模型' : '设为当前生效模型'}
                          >
                            ✓
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : null}

              {selectedProvider && filteredModelCards.length === 0 ? (
                <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-white px-6 py-14 text-center text-[13px] text-slate-500">
                  这个供应商还没有模型，先新增一个模型。
                </div>
              ) : null}

              {!selectedProvider ? (
                <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-zinc-200 bg-white px-6 py-14 text-center text-[13px] text-slate-500">
                  还没有可用供应商，先新增一个供应商再配置模型。
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {selectedProvider && isProviderPanelOpen ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(250,250,249,0.98)] px-4">
          <div className="w-full max-w-[620px] rounded-[30px] border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[20px] font-semibold text-zinc-950">供应商连接设置</div>
                <div className="mt-1 text-[12px] text-slate-500">
                  {selectedProvider.providerName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsDeleteConfirmOpen(false)
                  setIsProviderPanelOpen(false)
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl leading-none text-slate-500 transition hover:bg-slate-50 hover:text-zinc-900"
                aria-label="关闭供应商设置面板"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">供应商名称</span>
                <Input
                  value={providerDraftName}
                  onChange={(event) => setProviderDraftName(event.target.value)}
                  readOnly={selectedProvider.source === 'builtin'}
                  className={
                    selectedProvider.source === 'builtin'
                      ? 'border-zinc-200 bg-zinc-100 text-zinc-500'
                      : 'border-zinc-200 bg-white text-zinc-900'
                  }
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">Base URL</span>
                  <Input
                    value={providerDraftBaseUrl}
                    onChange={(event) => setProviderDraftBaseUrl(event.target.value)}
                    placeholder="https://api.example.com"
                    className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">API Key</span>
                  <Input
                    type="password"
                    value={providerDraftApiKey}
                    onChange={(event) => setProviderDraftApiKey(event.target.value)}
                    placeholder="填写该供应商的 API Key"
                    className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                  />
                </label>
              </div>

              <div className="flex items-center gap-4 px-1 py-2">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={providerDraftEnabled}
                    onChange={(event) => setProviderDraftEnabled(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  <span className="text-[13px] font-medium text-zinc-700">启用</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  className="text-[13px] font-medium text-rose-600 transition hover:text-rose-700"
                >
                  删除
                </button>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div />
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-zinc-300 bg-white px-4 text-zinc-700 hover:bg-zinc-50"
                  onClick={() => {
                    setIsDeleteConfirmOpen(false)
                    setIsProviderPanelOpen(false)
                  }}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="rounded-full bg-zinc-950 px-4 text-white hover:bg-zinc-800"
                  onClick={() => {
                    handleChangeProvider(selectedProvider.id, {
                      providerName:
                        selectedProvider.source === 'builtin'
                          ? selectedProvider.providerName
                          : providerDraftName.trim() || selectedProvider.providerName,
                      baseUrl: providerDraftBaseUrl.trim(),
                      apiKey: providerDraftApiKey.trim(),
                      enabled: providerDraftEnabled
                    })
                    setIsDeleteConfirmOpen(false)
                    setIsProviderPanelOpen(false)
                  }}
                >
                  保存设置
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedProvider && isDeleteConfirmOpen ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(250,250,249,0.98)] px-4">
          <div className="w-full max-w-[420px] rounded-[28px] border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <div className="text-[20px] font-semibold text-zinc-950">确认删除供应商</div>
            <div className="mt-3 text-[13px] leading-6 text-slate-500">
              删除后，这个供应商下的模型和默认路由都会被移除。
            </div>
            <div className="mt-2 text-[13px] font-medium text-zinc-900">
              {selectedProvider.providerName}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-zinc-300 bg-white px-4 text-zinc-700 hover:bg-zinc-50"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                className="rounded-full bg-rose-600 px-4 text-white hover:bg-rose-700"
                onClick={() => handleRemoveProvider(selectedProvider.id)}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedProvider && selectedModel && isEditModelPanelOpen ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(250,250,249,0.98)] px-4">
          <div className="w-full max-w-[620px] rounded-[30px] border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[20px] font-semibold text-zinc-950">模型设置</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${CAPABILITY_META[selectedModel.capability].className}`}
                  >
                    {CAPABILITY_META[selectedModel.capability].label}
                  </span>
                  {selectedModel.isRouteSelected ? (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-700">
                      当前生效
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditModelPanelOpen(false)
                  resetEditModelDraft()
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl leading-none text-slate-500 transition hover:bg-slate-50 hover:text-zinc-900"
                aria-label="关闭模型设置面板"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">模型名</span>
                <Input
                  value={editModelName}
                  onChange={(event) => setEditModelName(event.target.value)}
                  className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">Endpoint</span>
                <Input
                  value={editModelEndpoint}
                  onChange={(event) => setEditModelEndpoint(event.target.value)}
                  className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                />
              </label>

            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-3">
                {!selectedModel.isRouteSelected ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      handleSetDefaultModel(
                        selectedModel.providerId,
                        selectedModel.capability,
                        selectedModel.modelId
                      )
                    }}
                  >
                    设为当前
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-rose-200 text-rose-600 hover:bg-rose-50"
                  onClick={() => {
                    handleRemoveModel(
                      selectedModel.providerId,
                      selectedModel.capability,
                      selectedModel.modelId
                    )
                    setIsEditModelPanelOpen(false)
                    resetEditModelDraft()
                  }}
                >
                  删除模型
                </Button>
              </div>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-zinc-300 bg-white px-4 text-zinc-700 hover:bg-zinc-50"
                  onClick={() => {
                    setIsEditModelPanelOpen(false)
                    resetEditModelDraft()
                  }}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  className="rounded-full bg-zinc-950 px-4 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500"
                  disabled={!editModelName.trim() || !editModelEndpoint.trim()}
                  onClick={() => {
                    handleUpsertModel(selectedModel.providerId, selectedModel.capability, {
                      id: selectedModel.modelId,
                      modelName: editModelName,
                      endpointPath: editModelEndpoint,
                      protocol: selectedModel.protocol,
                      enabled: true
                    })
                    setIsEditModelPanelOpen(false)
                    resetEditModelDraft()
                  }}
                >
                  保存模型
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedProvider && isCreateModelPanelOpen ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(250,250,249,0.98)] px-4">
          <div className="w-full max-w-[560px] rounded-[30px] border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[20px] font-semibold text-zinc-950">新增模型</div>
                <div className="mt-1 text-[12px] text-slate-500">
                  添加到 {selectedProvider.providerName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateModelPanelOpen(false)
                  resetCreateModelDraft()
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl leading-none text-slate-500 transition hover:bg-slate-50 hover:text-zinc-900"
                aria-label="关闭新增模型面板"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">能力</span>
                <select
                  value={newModelCapability}
                  onChange={(event) => setNewModelCapability(event.target.value as AiCapability)}
                  className="h-11 rounded-[16px] border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 outline-none"
                >
                  <option value="chat">会话模型</option>
                  <option value="image">图片模型</option>
                  <option value="video">视频模型</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">模型名</span>
                <Input
                  value={newModelName}
                  onChange={(event) => setNewModelName(event.target.value)}
                  placeholder="例如：gpt-4o-mini"
                  className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-slate-500">Endpoint</span>
                <Input
                  value={newModelEndpoint}
                  onChange={(event) => setNewModelEndpoint(event.target.value)}
                  placeholder="例如：/v1/chat/completions"
                  className="border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400"
                />
              </label>

            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-full border-zinc-300 bg-white px-4 text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  setIsCreateModelPanelOpen(false)
                  resetCreateModelDraft()
                }}
              >
                取消
              </Button>
              <Button
                type="button"
                className="rounded-full bg-zinc-950 px-4 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500"
                disabled={!newModelName.trim() || !newModelEndpoint.trim()}
                onClick={() => {
                  handleUpsertModel(selectedProvider.id, newModelCapability, {
                    modelName: newModelName,
                    endpointPath: newModelEndpoint,
                    enabled: true
                  })
                  resetCreateModelDraft()
                  setIsCreateModelPanelOpen(false)
                }}
              >
                保存模型
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
