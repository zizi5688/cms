import type * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import type { AiCapability, AiProviderProfile } from '@renderer/store/useCmsStore'
import type { AiRuntimeDefaults } from '../../../../../shared/ai/aiProviderTypes'

const DEFAULT_KEY_BY_CAPABILITY: Record<AiCapability, keyof AiRuntimeDefaults> = {
  chat: 'chatProviderId',
  image: 'imageProviderId',
  video: 'videoProviderId'
}

const CAPABILITY_META: Record<AiCapability, { title: string; hint: string }> = {
  chat: {
    title: '会话默认路由',
    hint: '供主进程 chat route 和后续统一任务入口使用。'
  },
  image: {
    title: '图片默认路由',
    hint: 'AiStudio 图片链路默认从这里读取，不再在业务页选择供应商。'
  },
  video: {
    title: '视频默认路由',
    hint: 'AiStudio 视频链路默认从这里读取，不再在业务页选择供应商。'
  }
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

export function AiProviderDefaultsPanel({
  profiles,
  runtimeDefaults,
  onChange
}: {
  profiles: AiProviderProfile[]
  runtimeDefaults: AiRuntimeDefaults
  onChange: (capability: AiCapability, providerId: string | null) => void
}): React.JSX.Element {
  return (
    <Card className="border-zinc-200 bg-white/95 shadow-sm">
      <CardHeader>
        <CardTitle>默认能力路由</CardTitle>
        <CardDescription>
          MVP 按能力拆分默认供应商：支持 `chat -&gt; A / image -&gt; B / video -&gt; C`，也支持三类都指向同一家。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {(['chat', 'image', 'video'] as AiCapability[]).map((capability) => {
          const providers = getCapabilityProviders(profiles, capability)
          const currentProviderId = runtimeDefaults[DEFAULT_KEY_BY_CAPABILITY[capability]] ?? ''
          const currentProvider = providers.find((profile) => profile.id === currentProviderId) ?? null
          const currentModelName =
            currentProvider?.capabilities[capability].models.find(
              (model) => model.id === currentProvider.capabilities[capability].defaultModelId
            )?.modelName ?? '未设置'

          return (
            <div key={capability} className="rounded-[22px] border border-zinc-200 bg-zinc-50/80 p-4">
              <div className="text-sm font-semibold text-zinc-900">{CAPABILITY_META[capability].title}</div>
              <div className="mt-1 text-xs leading-5 text-zinc-500">{CAPABILITY_META[capability].hint}</div>
              <select
                value={currentProviderId}
                onChange={(event) => onChange(capability, event.target.value || null)}
                className="mt-4 h-10 w-full rounded-[16px] border border-zinc-200 bg-white px-3 text-[13px] text-zinc-900 outline-none transition"
              >
                <option value="">未设置默认供应商</option>
                {providers.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.providerName}
                  </option>
                ))}
              </select>
              <div className="mt-3 rounded-[16px] bg-white px-3 py-2 text-xs text-zinc-600">
                当前默认模型：{currentModelName}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
