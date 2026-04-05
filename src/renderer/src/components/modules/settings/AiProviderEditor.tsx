import type * as React from 'react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import type {
  AiCapability,
  AiModelProfile,
  AiProviderProfile
} from '@renderer/store/useCmsStore'
import type { AiRuntimeDefaults } from '../../../../../shared/ai/aiProviderTypes'

import { AiCapabilityModelList } from './AiCapabilityModelList'

function buildDefaultBadges(
  provider: AiProviderProfile,
  runtimeDefaults: AiRuntimeDefaults
): string[] {
  const badges: string[] = []
  if (runtimeDefaults.chatProviderId === provider.id) badges.push('会话默认')
  if (runtimeDefaults.imageProviderId === provider.id) badges.push('图片默认')
  if (runtimeDefaults.videoProviderId === provider.id) badges.push('视频默认')
  return badges
}

export function AiProviderEditor({
  provider,
  runtimeDefaults,
  onChangeProvider,
  onRemoveProvider,
  onUpsertModel,
  onRemoveModel,
  onSetDefaultModel
}: {
  provider: AiProviderProfile
  runtimeDefaults: AiRuntimeDefaults
  onChangeProvider: (providerId: string, patch: Partial<AiProviderProfile>) => void
  onRemoveProvider: (providerId: string) => void
  onUpsertModel: (
    providerId: string,
    capability: AiCapability,
    model: Partial<AiModelProfile> & { modelName: string; endpointPath: string }
  ) => void
  onRemoveModel: (providerId: string, capability: AiCapability, modelId: string) => void
  onSetDefaultModel: (providerId: string, capability: AiCapability, modelId: string) => void
}): React.JSX.Element {
  const isBuiltin = provider.source === 'builtin'
  const defaultBadges = buildDefaultBadges(provider, runtimeDefaults)

  return (
    <div className="rounded-[28px] border border-zinc-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,244,245,0.9))] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-lg font-semibold text-zinc-950">
              {provider.providerName || '未命名供应商'}
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                isBuiltin ? 'bg-zinc-950 text-white' : 'bg-sky-50 text-sky-700'
              }`}
            >
              {isBuiltin ? '内置供应商' : '自定义供应商'}
            </span>
            {defaultBadges.map((badge) => (
              <span key={badge} className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                {badge}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs leading-5 text-zinc-500">
            供应商级别只管理 Host、Key 和能力分组模型；业务页不再暴露底层配置。
          </div>
        </div>

        {!isBuiltin ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full border-rose-200 px-4 text-[12px] text-rose-600 hover:bg-rose-50"
            onClick={() => onRemoveProvider(provider.id)}
          >
            删除供应商
          </Button>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_1.2fr_1.1fr_120px]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-zinc-500">供应商名称</span>
          <Input
            value={provider.providerName}
            onChange={(event) => onChangeProvider(provider.id, { providerName: event.target.value })}
            readOnly={isBuiltin}
            className={isBuiltin ? 'bg-zinc-100 text-zinc-500' : ''}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-zinc-500">Base URL</span>
          <Input
            value={provider.baseUrl}
            onChange={(event) => onChangeProvider(provider.id, { baseUrl: event.target.value })}
            placeholder="https://api.example.com"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-zinc-500">API Key</span>
          <Input
            type="password"
            value={provider.apiKey}
            onChange={(event) => onChangeProvider(provider.id, { apiKey: event.target.value })}
            placeholder="填写该供应商的 API Key"
          />
        </label>

        <label className="flex items-end gap-2 rounded-[20px] border border-zinc-200 bg-white px-4 py-3">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(event) => onChangeProvider(provider.id, { enabled: event.target.checked })}
            className="h-4 w-4 rounded border-zinc-300"
          />
          <span className="text-sm font-medium text-zinc-700">启用供应商</span>
        </label>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {(['chat', 'image', 'video'] as AiCapability[]).map((capability) => (
          <AiCapabilityModelList
            key={`${provider.id}-${capability}`}
            capability={capability}
            provider={provider}
            onUpsertModel={onUpsertModel}
            onRemoveModel={onRemoveModel}
            onSetDefaultModel={onSetDefaultModel}
          />
        ))}
      </div>
    </div>
  )
}
