import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAiStudioProviderConfig } from './aiStudioProviderConfigHelpers.ts'

const CONFIG = {
  provider: 'grsai',
  baseUrl: 'https://grs.example.com',
  apiKey: 'grs-key',
  defaultImageModel: 'nano-banana',
  endpointPath: '/v1/draw/nano-banana',
  aiRuntimeDefaults: {
    chatProviderId: 'provider-openai',
    imageProviderId: 'provider-allapi',
    videoProviderId: 'provider-volc'
  },
  providerProfiles: [
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
      },
      models: [],
      defaultModelId: null
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
            }
          ]
        },
        video: { enabled: false, defaultModelId: null, models: [] }
      },
      models: [
        {
          id: 'model-jimeng-image',
          modelName: 'jimeng-image-3.0',
          endpointPath: '/v1/images/generations',
          protocol: 'openai',
          enabled: true
        }
      ],
      defaultModelId: 'model-jimeng-image'
    },
    {
      id: 'provider-volc',
      providerName: 'volc',
      baseUrl: 'https://volc.example.com',
      apiKey: 'volc-key',
      enabled: true,
      source: 'custom',
      capabilities: {
        chat: { enabled: false, defaultModelId: null, models: [] },
        image: { enabled: false, defaultModelId: null, models: [] },
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
      },
      models: [],
      defaultModelId: null
    }
  ]
}

test('resolveAiStudioProviderConfig uses the image runtime default route before legacy compatibility fields', () => {
  const resolved = resolveAiStudioProviderConfig(CONFIG, {
    provider: '',
    model: '',
    metadata: {}
  }, 'image')

  assert.equal(resolved.provider, 'allapi')
  assert.equal(resolved.baseUrl, 'https://allapi.example.com')
  assert.equal(resolved.apiKey, 'allapi-key')
  assert.equal(resolved.defaultImageModel, 'jimeng-image-3.0')
  assert.equal(resolved.endpointPath, '/v1/images/generations')
})

test('resolveAiStudioProviderConfig reads the video runtime default route from videoProviderId and video default model', () => {
  const resolved = resolveAiStudioProviderConfig(CONFIG, {
    provider: '',
    model: '',
    metadata: {}
  }, 'video')

  assert.equal(resolved.provider, 'volc')
  assert.equal(resolved.baseUrl, 'https://volc.example.com')
  assert.equal(resolved.apiKey, 'volc-key')
  assert.equal(resolved.defaultImageModel, 'seedance-1.0-pro')
  assert.equal(resolved.endpointPath, '/volc/v1/contents/generations/tasks')
})

test('resolveAiStudioProviderConfig uses the runtime default for legacy image tasks without a pinned route mode', () => {
  const resolved = resolveAiStudioProviderConfig(CONFIG, {
    provider: 'grsai',
    model: 'nano-banana',
    metadata: {}
  }, 'image')

  assert.equal(resolved.provider, 'allapi')
  assert.equal(resolved.defaultImageModel, 'jimeng-image-3.0')
})

test('resolveAiStudioProviderConfig still allows explicit task provider and model to override the runtime default when pinned', () => {
  const resolved = resolveAiStudioProviderConfig(CONFIG, {
    provider: 'grsai',
    model: 'nano-banana',
    metadata: { imageRouteMode: 'task-pinned' }
  }, 'image')

  assert.equal(resolved.provider, 'grsai')
  assert.equal(resolved.defaultImageModel, 'nano-banana')
})
