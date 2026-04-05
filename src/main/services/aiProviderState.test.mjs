import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readResolvedAiProviderStateFromStore,
  resolveAiProviderState,
  resolveUpdatedAiProviderState,
  syncResolvedAiProviderStateToStore
} from './aiProviderState.ts'

test('resolveAiProviderState migrates legacy image fields into image capability and runtime defaults', () => {
  const state = resolveAiProviderState(
    undefined,
    {
      provider: 'grsai',
      baseUrl: 'https://grs.example.com',
      apiKey: 'grs-key',
      modelName: 'nano-banana',
      endpointPath: '/v1/draw/nano-banana'
    },
    undefined
  )

  assert.equal(state.aiProvider, 'grsai')
  assert.equal(state.aiBaseUrl, 'https://grs.example.com')
  assert.equal(state.aiApiKey, 'grs-key')
  assert.equal(state.aiDefaultImageModel, 'nano-banana')
  assert.equal(state.aiEndpointPath, '/v1/draw/nano-banana')
  assert.ok(state.aiRuntimeDefaults.imageProviderId)
  assert.equal(state.aiRuntimeDefaults.chatProviderId, null)
  assert.equal(state.aiRuntimeDefaults.videoProviderId, null)
  assert.equal(state.aiProviderProfiles[0].capabilities.image.models[0].modelName, 'nano-banana')
  assert.equal(state.aiProviderProfiles[0].models[0].modelName, 'nano-banana')
})

test('resolveAiProviderState migrates legacy flat models into capabilities.image and preserves empty chat/video groups', () => {
  const state = resolveAiProviderState(
    [
      {
        id: 'provider-allapi',
        providerName: 'allapi',
        baseUrl: 'https://allapi.example.com',
        apiKey: 'allapi-key',
        models: [
          {
            id: 'model-jimeng-image',
            modelName: 'jimeng-image-3.0',
            endpointPath: '/v1/images/generations'
          }
        ],
        defaultModelId: 'model-jimeng-image'
      }
    ],
    {
      provider: 'allapi',
      baseUrl: '',
      apiKey: '',
      modelName: '',
      endpointPath: ''
    },
    undefined
  )

  assert.equal(state.aiProviderProfiles[0].capabilities.image.models[0].modelName, 'jimeng-image-3.0')
  assert.equal(state.aiProviderProfiles[0].capabilities.chat.models.length, 0)
  assert.equal(state.aiProviderProfiles[0].capabilities.video.models.length, 0)
  assert.equal(state.aiRuntimeDefaults.imageProviderId, 'provider-allapi')
})

test('resolveUpdatedAiProviderState keeps legacy image mirror fields aligned when compatibility patch adds a model', () => {
  const currentState = resolveAiProviderState(
    [],
    {
      provider: 'grsai',
      baseUrl: '',
      apiKey: '',
      modelName: '',
      endpointPath: ''
    },
    undefined
  )

  const nextState = resolveUpdatedAiProviderState(currentState, {
    aiProvider: 'allapi',
    aiBaseUrl: 'https://allapi.example.com',
    aiApiKey: 'allapi-key',
    aiDefaultImageModel: 'jimeng-image-3.0',
    aiEndpointPath: '/v1/images/generations'
  })

  assert.equal(nextState.aiProvider, 'allapi')
  assert.equal(nextState.aiDefaultImageModel, 'jimeng-image-3.0')
  assert.equal(nextState.aiEndpointPath, '/v1/images/generations')
  assert.equal(nextState.aiProviderProfiles.at(-1)?.capabilities.image.models.at(-1)?.modelName, 'jimeng-image-3.0')
  assert.equal(nextState.aiRuntimeDefaults.imageProviderId, nextState.aiProviderProfiles.at(-1)?.id ?? null)
})

test('readResolvedAiProviderStateFromStore and syncResolvedAiProviderStateToStore round-trip runtime defaults and legacy image fields', () => {
  const values = new Map([
    ['aiProvider', 'allapi'],
    ['aiBaseUrl', 'https://allapi.example.com'],
    ['aiApiKey', 'allapi-key'],
    ['aiDefaultImageModel', 'jimeng-image-3.0'],
    ['aiEndpointPath', '/v1/images/generations'],
    [
      'aiProviderProfiles',
      [
        {
          id: 'provider-allapi',
          providerName: 'allapi',
          baseUrl: 'https://allapi.example.com',
          apiKey: 'allapi-key',
          models: [
            {
              id: 'model-jimeng-image',
              modelName: 'jimeng-image-3.0',
              endpointPath: '/v1/images/generations'
            }
          ],
          defaultModelId: 'model-jimeng-image'
        }
      ]
    ],
    ['aiRuntimeDefaults', { chatProviderId: null, imageProviderId: 'provider-allapi', videoProviderId: null }]
  ])

  const store = {
    get(key) {
      return values.get(key)
    },
    set(key, value) {
      values.set(key, value)
    }
  }

  const state = readResolvedAiProviderStateFromStore(store)
  syncResolvedAiProviderStateToStore(store, state)

  assert.equal(values.get('aiProvider'), 'allapi')
  assert.equal(values.get('aiDefaultImageModel'), 'jimeng-image-3.0')
  assert.deepEqual(values.get('aiRuntimeDefaults'), {
    chatProviderId: null,
    imageProviderId: 'provider-allapi',
    videoProviderId: null
  })
})

test('resolveAiProviderState ignores deleted providers when normalizing runtime defaults and legacy mirrors', () => {
  const state = resolveAiProviderState(
    [
      {
        id: 'provider-openai',
        providerName: 'openai',
        baseUrl: 'https://openai.example.com',
        apiKey: 'openai-key',
        enabled: true,
        deleted: true,
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
      }
    ],
    {
      provider: 'openai',
      baseUrl: '',
      apiKey: '',
      modelName: '',
      endpointPath: ''
    },
    {
      chatProviderId: 'provider-openai',
      imageProviderId: 'provider-openai',
      videoProviderId: null
    }
  )

  assert.equal(state.aiProvider, 'openai')
  assert.equal(state.aiBaseUrl, '')
  assert.equal(state.aiApiKey, '')
  assert.equal(state.aiRuntimeDefaults.chatProviderId, null)
  assert.equal(state.aiRuntimeDefaults.imageProviderId, null)
})
