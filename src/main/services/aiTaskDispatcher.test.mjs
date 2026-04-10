import assert from 'node:assert/strict'
import test from 'node:test'

import { dispatchAiTask } from './aiTaskDispatcher.ts'

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

test('dispatchAiTask routes direct mode requests to the matching capability executor', async () => {
  const calls = []
  const executors = {
    chat: async ({ route, request }) => {
      calls.push(['chat', route.providerId, request.input])
      return { ok: true, capability: 'chat' }
    },
    image: async ({ route, request }) => {
      calls.push(['image', route.providerId, request.input])
      return { ok: true, capability: 'image' }
    },
    video: async ({ route, request }) => {
      calls.push(['video', route.providerId, request.input])
      return { ok: true, capability: 'video' }
    }
  }

  const chatResult = await dispatchAiTask(
    STATE,
    { capability: 'chat', input: { prompt: 'hi' } },
    executors
  )
  const imageResult = await dispatchAiTask(
    STATE,
    { capability: 'image', input: { prompt: 'draw' } },
    executors
  )
  const videoResult = await dispatchAiTask(
    STATE,
    { capability: 'video', input: { prompt: 'animate' } },
    executors
  )

  assert.deepEqual(calls, [
    ['chat', 'provider-openai', { prompt: 'hi' }],
    ['image', 'provider-allapi', { prompt: 'draw' }],
    ['video', 'provider-volc', { prompt: 'animate' }]
  ])
  assert.deepEqual(chatResult, { ok: true, capability: 'chat' })
  assert.deepEqual(imageResult, { ok: true, capability: 'image' })
  assert.deepEqual(videoResult, { ok: true, capability: 'video' })
})

test('dispatchAiTask uses an async route resolver hook when provided', async () => {
  const calls = []

  const result = await dispatchAiTask(
    STATE,
    { capability: 'chat', input: { prompt: 'hi' } },
    {
      chat: async ({ route, request }) => {
        calls.push(['chat', route.providerId, request.input])
        return { ok: true, providerId: route.providerId }
      },
      image: async () => ({ ok: true }),
      video: async () => ({ ok: true })
    },
    {
      resolveRoute: async (_state, capability) => ({
        providerId: 'provider-local',
        providerName: 'Local',
        capability,
        baseUrl: 'http://127.0.0.1:4174',
        apiKey: 'local-dev-secret',
        modelId: 'model-gemini-web-chat',
        modelName: 'gemini-web-chat',
        endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
        protocol: 'google-genai'
      })
    }
  )

  assert.deepEqual(calls, [['chat', 'provider-local', { prompt: 'hi' }]])
  assert.deepEqual(result, { ok: true, providerId: 'provider-local' })
})

test('dispatchAiTask honors an explicit chat route override from request context', async () => {
  const calls = []

  const result = await dispatchAiTask(
    STATE,
    {
      capability: 'chat',
      input: { prompt: 'hi' },
      context: {
        routeOverride: {
          providerId: 'provider-gemini',
          providerName: 'gemini',
          baseUrl: 'https://gemini.example.com',
          apiKey: 'gemini-key',
          modelId: 'model-gemini-2.5-flash',
          modelName: 'gemini-2.5-flash',
          endpointPath: '/v1beta/models/gemini-2.5-flash:generateContent',
          protocol: 'google-genai'
        }
      }
    },
    {
      chat: async ({ route, request }) => {
        calls.push(['chat', route.providerId, route.modelName, request.input])
        return { ok: true, providerId: route.providerId, modelName: route.modelName }
      },
      image: async () => ({ ok: true }),
      video: async () => ({ ok: true })
    }
  )

  assert.deepEqual(calls, [['chat', 'provider-gemini', 'gemini-2.5-flash', { prompt: 'hi' }]])
  assert.deepEqual(result, {
    ok: true,
    providerId: 'provider-gemini',
    modelName: 'gemini-2.5-flash'
  })
})
