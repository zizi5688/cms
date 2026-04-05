import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiConfigPatch,
  buildVideoEndpointPair,
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
