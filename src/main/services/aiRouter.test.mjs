import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveChatRoute, resolveImageRoute, resolveVideoRoute } from './aiRouter.ts'

const STATE = {
  aiProvider: 'allapi',
  aiBaseUrl: 'https://allapi.example.com',
  aiApiKey: 'allapi-key',
  aiDefaultImageModel: 'jimeng-image-3.0',
  aiEndpointPath: '/v1/images/generations',
  aiRuntimeDefaults: {
    chatProviderId: 'provider-openai',
    imageProviderId: 'provider-allapi',
    videoProviderId: 'provider-volc'
  },
  aiProviderProfiles: [
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

test('resolveChatRoute resolveImageRoute and resolveVideoRoute support chat -> A / image -> B / video -> C', () => {
  const chatRoute = resolveChatRoute(STATE)
  const imageRoute = resolveImageRoute(STATE)
  const videoRoute = resolveVideoRoute(STATE)

  assert.equal(chatRoute.providerId, 'provider-openai')
  assert.equal(chatRoute.modelName, 'gpt-4o-mini')
  assert.equal(imageRoute.providerId, 'provider-allapi')
  assert.equal(imageRoute.modelName, 'jimeng-image-3.0')
  assert.equal(videoRoute.providerId, 'provider-volc')
  assert.equal(videoRoute.modelName, 'seedance-1.0-pro')
})

test('resolveImageRoute throws when the default provider is disabled', () => {
  assert.throws(
    () =>
      resolveImageRoute({
        ...STATE,
        aiProviderProfiles: STATE.aiProviderProfiles.map((profile) =>
          profile.id === 'provider-allapi' ? { ...profile, enabled: false } : profile
        )
      }),
    /AI_PROVIDER_DISABLED/
  )
})

test('resolveVideoRoute throws when the capability is disabled or missing a default model', () => {
  assert.throws(
    () =>
      resolveVideoRoute({
        ...STATE,
        aiProviderProfiles: STATE.aiProviderProfiles.map((profile) =>
          profile.id === 'provider-volc'
            ? {
                ...profile,
                capabilities: {
                  ...profile.capabilities,
                  video: { ...profile.capabilities.video, enabled: false }
                }
              }
            : profile
        )
      }),
    /AI_CAPABILITY_DISABLED/
  )

  assert.throws(
    () =>
      resolveVideoRoute({
        ...STATE,
        aiProviderProfiles: STATE.aiProviderProfiles.map((profile) =>
          profile.id === 'provider-volc'
            ? {
                ...profile,
                capabilities: {
                  ...profile.capabilities,
                  video: { ...profile.capabilities.video, defaultModelId: null }
                }
              }
            : profile
        )
      }),
    /AI_MODEL_MISSING/
  )
})

test('resolveChatRoute throws when the resolved model has no endpoint path', () => {
  assert.throws(
    () =>
      resolveChatRoute({
        ...STATE,
        aiProviderProfiles: STATE.aiProviderProfiles.map((profile) =>
          profile.id === 'provider-openai'
            ? {
                ...profile,
                capabilities: {
                  ...profile.capabilities,
                  chat: {
                    ...profile.capabilities.chat,
                    models: [
                      {
                        ...profile.capabilities.chat.models[0],
                        endpointPath: ''
                      }
                    ]
                  }
                }
              }
            : profile
        )
      }),
    /AI_ENDPOINT_MISSING/
  )
})
