import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiCapabilityRouteOptions,
  buildAiConfigPatch,
  buildVideoEndpointPair,
  resolveOrderedChatProviderCandidates,
  resolveAiTaskProviderSelection
} from './aiProviderProfiles.ts'

const RUNTIME_DEFAULTS = {
  chatProviderId: 'provider-openai',
  imageProviderId: 'provider-allapi',
  videoProviderId: 'provider-allapi'
}

const PROFILES = [
  {
    id: 'provider-openai',
    providerName: 'openai',
    baseUrl: 'https://openai.example.com',
    apiKey: 'openai-key',
    enabled: true,
    source: 'builtin',
    capabilities: {
      chat: {
        enabled: true,
        defaultModelId: 'model-gpt-4o-mini',
        models: [
          {
            id: 'model-gpt-4o-mini',
            modelName: 'gpt-4o-mini',
            endpointPath: '/v1/chat/completions',
            protocol: 'openai',
            enabled: true
          }
        ]
      },
      image: { enabled: false, defaultModelId: null, models: [] },
      video: { enabled: false, defaultModelId: null, models: [] }
    }
  },
  {
    id: 'provider-allapi',
    providerName: 'allapi',
    baseUrl: 'https://allapi.example.com',
    apiKey: 'allapi-key',
    enabled: true,
    source: 'custom',
    capabilities: {
      chat: { enabled: false, defaultModelId: null, models: [] },
      image: {
        enabled: true,
        defaultModelId: 'model-jimeng-image',
        models: [
          {
            id: 'model-jimeng-image',
            modelName: 'jimeng-image-3.0',
            endpointPath: '/v1/images/generations',
            protocol: 'openai',
            enabled: true
          },
          {
            id: 'model-flux-pro',
            modelName: 'flux-pro-1.1',
            endpointPath: '/v1/flux/pro',
            protocol: 'vendor-custom',
            enabled: true
          }
        ]
      },
      video: {
        enabled: true,
        defaultModelId: 'model-seedance',
        models: [
          {
            id: 'model-seedance',
            modelName: 'seedance-1.0-pro',
            endpointPath: '/volc/v1/contents/generations/tasks',
            protocol: 'vendor-custom',
            enabled: true
          }
        ]
      }
    }
  }
]

test('resolveAiTaskProviderSelection prefers the task provider and model within the requested capability', () => {
  const resolved = resolveAiTaskProviderSelection(PROFILES, {
    capability: 'image',
    taskProviderName: 'allapi',
    taskModelName: 'flux-pro-1.1',
    fallbackProviderId: RUNTIME_DEFAULTS.imageProviderId
  })

  assert.equal(resolved.providerName, 'allapi')
  assert.equal(resolved.modelName, 'flux-pro-1.1')
  assert.equal(resolved.endpointPath, '/v1/flux/pro')
  assert.equal(resolved.providerProfile?.apiKey, 'allapi-key')
})

test('resolveAiTaskProviderSelection falls back to the runtime default provider id for video capability', () => {
  const resolved = resolveAiTaskProviderSelection(PROFILES, {
    capability: 'video',
    taskProviderName: '',
    taskModelName: '',
    fallbackProviderId: RUNTIME_DEFAULTS.videoProviderId
  })

  assert.equal(resolved.providerName, 'allapi')
  assert.equal(resolved.modelName, 'seedance-1.0-pro')
  assert.equal(resolved.endpointPath, '/volc/v1/contents/generations/tasks')
})

test('resolveAiTaskProviderSelection can resolve the minimal chat route from capability defaults', () => {
  const resolved = resolveAiTaskProviderSelection(PROFILES, {
    capability: 'chat',
    taskProviderName: '',
    taskModelName: '',
    fallbackProviderId: RUNTIME_DEFAULTS.chatProviderId
  })

  assert.equal(resolved.providerName, 'openai')
  assert.equal(resolved.modelName, 'gpt-4o-mini')
  assert.equal(resolved.endpointPath, '/v1/chat/completions')
  assert.equal(resolved.providerProfile?.baseUrl, 'https://openai.example.com')
})

test('buildAiConfigPatch keeps runtime defaults and mirrors the selected image route into legacy fields', () => {
  const patch = buildAiConfigPatch(PROFILES, RUNTIME_DEFAULTS, 'allapi', 'jimeng-image-3.0')

  assert.deepEqual(patch.aiRuntimeDefaults, RUNTIME_DEFAULTS)
  assert.equal(patch.aiProvider, 'allapi')
  assert.equal(patch.aiBaseUrl, 'https://allapi.example.com')
  assert.equal(patch.aiApiKey, 'allapi-key')
  assert.equal(patch.aiDefaultImageModel, 'jimeng-image-3.0')
  assert.equal(patch.aiEndpointPath, '/v1/images/generations')
})

test('buildVideoEndpointPair keeps the Seedance submit endpoint and derives a task-id polling path', () => {
  assert.deepEqual(buildVideoEndpointPair('/volc/v1/contents/generations/tasks'), {
    submitPath: '/volc/v1/contents/generations/tasks',
    queryPath: '/volc/v1/contents/generations/tasks/{task_id}'
  })
})

test('resolveAiTaskProviderSelection ignores deleted providers when resolving capability defaults', () => {
  const resolved = resolveAiTaskProviderSelection(
    [
      {
        ...PROFILES[0],
        deleted: true
      },
      ...PROFILES.slice(1)
    ],
    {
      capability: 'chat',
      taskProviderName: '',
      taskModelName: '',
      fallbackProviderId: RUNTIME_DEFAULTS.chatProviderId
    }
  )

  assert.equal(resolved.providerProfile?.id, 'provider-allapi')
  assert.equal(resolved.providerName, 'allapi')
  assert.equal(resolved.modelProfile, null)
  assert.equal(resolved.modelName, '')
})

test('buildAiCapabilityRouteOptions lists enabled image models as provider-model labels', () => {
  const options = buildAiCapabilityRouteOptions([
    ...PROFILES,
    {
      id: 'provider-disabled',
      providerName: 'disabled',
      baseUrl: 'https://disabled.example.com',
      apiKey: 'disabled-key',
      enabled: false,
      source: 'custom',
      capabilities: {
        chat: { enabled: false, defaultModelId: null, models: [] },
        image: {
          enabled: true,
          defaultModelId: 'model-disabled',
          models: [
            {
              id: 'model-disabled',
              modelName: 'disabled-image',
              endpointPath: '/v1/disabled',
              protocol: 'openai',
              enabled: true
            }
          ]
        },
        video: { enabled: false, defaultModelId: null, models: [] }
      }
    }
  ], 'image')

  assert.deepEqual(options, [
    {
      value: 'provider-allapi:model-flux-pro',
      providerId: 'provider-allapi',
      providerName: 'allapi',
      modelId: 'model-flux-pro',
      modelName: 'flux-pro-1.1',
      label: 'allapi - flux-pro-1.1'
    },
    {
      value: 'provider-allapi:model-jimeng-image',
      providerId: 'provider-allapi',
      providerName: 'allapi',
      modelId: 'model-jimeng-image',
      modelName: 'jimeng-image-3.0',
      label: 'allapi - jimeng-image-3.0'
    }
  ])
})

test('resolveOrderedChatProviderCandidates returns the configured default chat provider first', () => {
  const candidates = resolveOrderedChatProviderCandidates(PROFILES, {
    chatProviderId: 'provider-openai'
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].providerId, 'provider-openai')
  assert.equal(candidates[0].providerName, 'openai')
  assert.equal(candidates[0].modelId, 'model-gpt-4o-mini')
  assert.equal(candidates[0].modelName, 'gpt-4o-mini')
})

test('resolveOrderedChatProviderCandidates appends one eligible fallback after the primary', () => {
  const candidates = resolveOrderedChatProviderCandidates(
    [
      ...PROFILES,
      {
        id: 'provider-gemini',
        providerName: 'gemini',
        baseUrl: 'https://gemini.example.com',
        apiKey: 'gemini-key',
        enabled: true,
        source: 'custom',
        capabilities: {
          chat: {
            enabled: true,
            defaultModelId: 'model-gemini-2.5-flash',
            models: [
              {
                id: 'model-gemini-2.5-flash',
                modelName: 'gemini-2.5-flash',
                endpointPath: '/v1beta/models/gemini-2.5-flash:generateContent',
                protocol: 'google-genai',
                enabled: true
              }
            ]
          },
          image: { enabled: false, defaultModelId: null, models: [] },
          video: { enabled: false, defaultModelId: null, models: [] }
        }
      }
    ],
    {
      chatProviderId: 'provider-openai'
    }
  )

  assert.deepEqual(
    candidates.map((candidate) => candidate.providerId),
    ['provider-openai', 'provider-gemini']
  )
})

test('resolveOrderedChatProviderCandidates excludes deleted disabled or missing-key providers from fallback', () => {
  const candidates = resolveOrderedChatProviderCandidates(
    [
      ...PROFILES,
      {
        id: 'provider-deleted',
        providerName: 'deleted-chat',
        baseUrl: 'https://deleted.example.com',
        apiKey: 'deleted-key',
        enabled: true,
        deleted: true,
        source: 'custom',
        capabilities: {
          chat: {
            enabled: true,
            defaultModelId: 'model-deleted',
            models: [
              {
                id: 'model-deleted',
                modelName: 'deleted-model',
                endpointPath: '/v1/chat/completions',
                protocol: 'openai',
                enabled: true
              }
            ]
          },
          image: { enabled: false, defaultModelId: null, models: [] },
          video: { enabled: false, defaultModelId: null, models: [] }
        }
      },
      {
        id: 'provider-disabled-chat',
        providerName: 'disabled-chat',
        baseUrl: 'https://disabled-chat.example.com',
        apiKey: 'disabled-key',
        enabled: false,
        source: 'custom',
        capabilities: {
          chat: {
            enabled: true,
            defaultModelId: 'model-disabled-chat',
            models: [
              {
                id: 'model-disabled-chat',
                modelName: 'disabled-model',
                endpointPath: '/v1/chat/completions',
                protocol: 'openai',
                enabled: true
              }
            ]
          },
          image: { enabled: false, defaultModelId: null, models: [] },
          video: { enabled: false, defaultModelId: null, models: [] }
        }
      },
      {
        id: 'provider-missing-key',
        providerName: 'missing-key',
        baseUrl: 'https://missing-key.example.com',
        apiKey: '',
        enabled: true,
        source: 'custom',
        capabilities: {
          chat: {
            enabled: true,
            defaultModelId: 'model-missing-key',
            models: [
              {
                id: 'model-missing-key',
                modelName: 'missing-key-model',
                endpointPath: '/v1/chat/completions',
                protocol: 'openai',
                enabled: true
              }
            ]
          },
          image: { enabled: false, defaultModelId: null, models: [] },
          video: { enabled: false, defaultModelId: null, models: [] }
        }
      }
    ],
    {
      chatProviderId: 'provider-openai'
    }
  )

  assert.deepEqual(candidates.map((candidate) => candidate.providerId), ['provider-openai'])
})

test('resolveOrderedChatProviderCandidates never returns the same provider twice', () => {
  const candidates = resolveOrderedChatProviderCandidates(PROFILES, {
    chatProviderId: 'provider-openai'
  })

  assert.deepEqual(
    candidates.map((candidate) => candidate.providerId),
    ['provider-openai']
  )
})
