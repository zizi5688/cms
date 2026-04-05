import { useMemo, useState } from 'react'
import type * as React from 'react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import type {
  AiCapability,
  AiModelProfile,
  AiProviderProfile
} from '@renderer/store/useCmsStore'
import type { AiModelProtocol } from '../../../../../shared/ai/aiProviderTypes'

const CAPABILITY_LABELS: Record<AiCapability, string> = {
  chat: '会话模型',
  image: '图片模型',
  video: '视频模型'
}

const DEFAULT_PLACEHOLDERS: Record<AiCapability, { model: string; endpoint: string }> = {
  chat: {
    model: '例如：gpt-4o-mini',
    endpoint: '例如：/v1/chat/completions'
  },
  image: {
    model: '例如：jimeng-image-3.0',
    endpoint: '例如：/v1/images/generations'
  },
  video: {
    model: '例如：seedance-1.0-pro',
    endpoint: '例如：/volc/v1/contents/generations/tasks'
  }
}

function protocolLabel(protocol: AiModelProtocol): string {
  if (protocol === 'google-genai') return 'Google GenAI'
  if (protocol === 'vendor-custom') return 'Vendor Custom'
  return 'OpenAI Compatible'
}

export function AiCapabilityModelList({
  capability,
  provider,
  onUpsertModel,
  onRemoveModel,
  onSetDefaultModel
}: {
  capability: AiCapability
  provider: AiProviderProfile
  onUpsertModel: (
    providerId: string,
    capability: AiCapability,
    model: Partial<AiModelProfile> & { modelName: string; endpointPath: string }
  ) => void
  onRemoveModel: (providerId: string, capability: AiCapability, modelId: string) => void
  onSetDefaultModel: (providerId: string, capability: AiCapability, modelId: string) => void
}): React.JSX.Element {
  const capabilityState = provider.capabilities[capability]
  const [draftModelName, setDraftModelName] = useState('')
  const [draftEndpointPath, setDraftEndpointPath] = useState('')
  const [draftProtocol, setDraftProtocol] = useState<AiModelProtocol>('openai')

  const placeholders = DEFAULT_PLACEHOLDERS[capability]
  const defaultModelName = useMemo(
    () =>
      capabilityState.models.find((model) => model.id === capabilityState.defaultModelId)?.modelName ??
      '',
    [capabilityState.defaultModelId, capabilityState.models]
  )

  const handleAddModel = (): void => {
    if (!draftModelName.trim() || !draftEndpointPath.trim()) return
    onUpsertModel(provider.id, capability, {
      modelName: draftModelName,
      endpointPath: draftEndpointPath,
      protocol: draftProtocol,
      enabled: true
    })
    setDraftModelName('')
    setDraftEndpointPath('')
    setDraftProtocol('openai')
  }

  return (
    <div className="rounded-[22px] border border-zinc-200 bg-white/95 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900">{CAPABILITY_LABELS[capability]}</div>
          <div className="mt-1 text-xs text-zinc-500">
            默认模型：{defaultModelName || '未设置'} · 共 {capabilityState.models.length} 个模型
          </div>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-[11px] font-medium ${
            capabilityState.enabled && capabilityState.models.length > 0
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-zinc-100 text-zinc-500'
          }`}
        >
          {capabilityState.enabled && capabilityState.models.length > 0 ? '已启用' : '未启用'}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {capabilityState.models.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4 text-xs text-zinc-500">
            当前能力还没有模型，先添加一个可用模型即可参与默认路由。
          </div>
        ) : null}

        {capabilityState.models.map((model) => {
          const isDefault = model.id === capabilityState.defaultModelId
          return (
            <div
              key={model.id}
              className={`rounded-[18px] border px-4 py-3 ${
                isDefault ? 'border-zinc-900 bg-zinc-950 text-white' : 'border-zinc-200 bg-zinc-50'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium">
                  {isDefault ? '默认模型' : protocolLabel(model.protocol)}
                </div>
                <div className="flex items-center gap-2">
                  {!isDefault ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 rounded-full px-3 text-[12px]"
                      onClick={() => onSetDefaultModel(provider.id, capability, model.id)}
                    >
                      设为默认
                    </Button>
                  ) : (
                    <span className="rounded-full bg-white/12 px-3 py-1 text-[11px] font-medium">
                      默认路由
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-full border-rose-200 px-3 text-[12px] text-rose-600 hover:bg-rose-50"
                    onClick={() => onRemoveModel(provider.id, capability, model.id)}
                  >
                    删除
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[1.15fr_1.4fr_180px]">
                <label className="flex flex-col gap-1.5">
                  <span className={`text-[11px] font-medium ${isDefault ? 'text-zinc-300' : 'text-zinc-500'}`}>
                    模型名
                  </span>
                  <Input
                    value={model.modelName}
                    onChange={(event) =>
                      onUpsertModel(provider.id, capability, {
                        ...model,
                        modelName: event.target.value,
                        endpointPath: model.endpointPath
                      })
                    }
                    className={isDefault ? 'border-white/10 bg-white/10 text-white' : ''}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className={`text-[11px] font-medium ${isDefault ? 'text-zinc-300' : 'text-zinc-500'}`}>
                    Endpoint
                  </span>
                  <Input
                    value={model.endpointPath}
                    onChange={(event) =>
                      onUpsertModel(provider.id, capability, {
                        ...model,
                        modelName: model.modelName,
                        endpointPath: event.target.value
                      })
                    }
                    className={isDefault ? 'border-white/10 bg-white/10 text-white' : ''}
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className={`text-[11px] font-medium ${isDefault ? 'text-zinc-300' : 'text-zinc-500'}`}>
                    协议
                  </span>
                  <select
                    value={model.protocol}
                    onChange={(event) =>
                      onUpsertModel(provider.id, capability, {
                        ...model,
                        modelName: model.modelName,
                        endpointPath: model.endpointPath,
                        protocol: event.target.value as AiModelProtocol
                      })
                    }
                    className={`h-10 rounded-[16px] border px-3 text-[13px] outline-none transition ${
                      isDefault
                        ? 'border-white/10 bg-white/10 text-white'
                        : 'border-zinc-200 bg-white text-zinc-900'
                    }`}
                  >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="google-genai">Google GenAI</option>
                    <option value="vendor-custom">Vendor Custom</option>
                  </select>
                </label>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 rounded-[18px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4">
        <div className="text-xs font-medium text-zinc-700">添加模型</div>
        <div className="mt-3 grid gap-3 md:grid-cols-[1.05fr_1.35fr_180px_auto]">
          <Input
            value={draftModelName}
            onChange={(event) => setDraftModelName(event.target.value)}
            placeholder={placeholders.model}
          />
          <Input
            value={draftEndpointPath}
            onChange={(event) => setDraftEndpointPath(event.target.value)}
            placeholder={placeholders.endpoint}
          />
          <select
            value={draftProtocol}
            onChange={(event) => setDraftProtocol(event.target.value as AiModelProtocol)}
            className="h-10 rounded-[16px] border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 outline-none transition"
          >
            <option value="openai">OpenAI Compatible</option>
            <option value="google-genai">Google GenAI</option>
            <option value="vendor-custom">Vendor Custom</option>
          </select>
          <Button
            type="button"
            className="h-10 rounded-[16px] px-4"
            onClick={handleAddModel}
            disabled={!draftModelName.trim() || !draftEndpointPath.trim()}
          >
            添加
          </Button>
        </div>
      </div>
    </div>
  )
}
