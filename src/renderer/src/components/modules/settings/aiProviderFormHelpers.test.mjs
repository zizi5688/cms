import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyAiCapabilityDefaultSelection,
  buildAiModelHealthCacheSignature,
  createCustomAiProviderProfile,
  isAiModelHealthCacheFresh,
  mergeAiProviderProfilesWithCatalog,
  removeAiCapabilityModel,
  setAiRuntimeDefaultProvider,
  upsertAiCapabilityModel
} from './aiProviderFormHelpers.ts'

const BUILTIN = [
  {
    id: 'provider-openai',
    providerName: 'openai',
    baseUrl: 'https://openai.example.com',
    apiKey: '',
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
  }
]

test('createCustomAiProviderProfile initializes chat image and video capability groups', () => {
  const provider = createCustomAiProviderProfile()

  assert.equal(provider.source, 'custom')
  assert.equal(provider.enabled, true)
  assert.deepEqual(Object.keys(provider.capabilities), ['chat', 'image', 'video'])
  assert.equal(provider.capabilities.chat.models.length, 0)
  assert.equal(provider.capabilities.image.models.length, 0)
  assert.equal(provider.capabilities.video.models.length, 0)
})

test('upsertAiCapabilityModel writes model entries into the requested capability and keeps image mirror fields aligned', () => {
  const base = createCustomAiProviderProfile({
    id: 'provider-custom',
    providerName: 'custom'
  })

  const withChat = upsertAiCapabilityModel([base], 'provider-custom', 'chat', {
    modelName: 'gpt-4.1-mini',
    endpointPath: '/v1/chat/completions',
    protocol: 'openai'
  })
  const withImage = upsertAiCapabilityModel(withChat, 'provider-custom', 'image', {
    modelName: 'flux-1.1-pro',
    endpointPath: '/v1/images/generations',
    protocol: 'vendor-custom'
  })
  const withVideo = upsertAiCapabilityModel(withImage, 'provider-custom', 'video', {
    modelName: 'seedance-1.0-pro',
    endpointPath: '/volc/v1/contents/generations/tasks',
    protocol: 'vendor-custom'
  })

  const provider = withVideo[0]
  assert.equal(provider.capabilities.chat.models[0].modelName, 'gpt-4.1-mini')
  assert.equal(provider.capabilities.image.models[0].modelName, 'flux-1.1-pro')
  assert.equal(provider.capabilities.video.models[0].modelName, 'seedance-1.0-pro')
  assert.deepEqual(provider.models, provider.capabilities.image.models)
  assert.equal(provider.defaultModelId, provider.capabilities.image.defaultModelId)
})

test('removeAiCapabilityModel updates the correct capability default and clears image mirror when needed', () => {
  const base = createCustomAiProviderProfile({
    id: 'provider-custom',
    providerName: 'custom'
  })
  const withImage = upsertAiCapabilityModel([base], 'provider-custom', 'image', {
    id: 'model-a',
    modelName: 'flux-1.1-pro',
    endpointPath: '/v1/images/generations',
    protocol: 'vendor-custom'
  })
  const withSecondImage = upsertAiCapabilityModel(withImage, 'provider-custom', 'image', {
    id: 'model-b',
    modelName: 'flux-kontext',
    endpointPath: '/v1/images/kontext',
    protocol: 'vendor-custom'
  })
  const nextProfiles = removeAiCapabilityModel(withSecondImage, 'provider-custom', 'image', 'model-a')
  const provider = nextProfiles[0]

  assert.equal(provider.capabilities.image.models.length, 1)
  assert.equal(provider.capabilities.image.models[0].id, 'model-b')
  assert.equal(provider.capabilities.image.defaultModelId, 'model-b')
  assert.equal(provider.models[0].id, 'model-b')
  assert.equal(provider.defaultModelId, 'model-b')
})

test('setAiRuntimeDefaultProvider switches defaults independently per capability', () => {
  const nextDefaults = setAiRuntimeDefaultProvider(
    { chatProviderId: null, imageProviderId: null, videoProviderId: null },
    'chat',
    'provider-openai'
  )

  assert.deepEqual(nextDefaults, {
    chatProviderId: 'provider-openai',
    imageProviderId: null,
    videoProviderId: null
  })
})

test('applyAiCapabilityDefaultSelection switches the current capability provider and model together', () => {
  const providerA = createCustomAiProviderProfile({
    id: 'provider-a',
    providerName: 'Provider A',
    capabilities: {
      chat: { enabled: false, defaultModelId: null, models: [] },
      image: {
        enabled: true,
        defaultModelId: 'model-a-image',
        models: [
          {
            id: 'model-a-image',
            modelName: 'image-a',
            endpointPath: '/v1/images/a',
            protocol: 'openai',
            enabled: true
          }
        ]
      },
      video: { enabled: false, defaultModelId: null, models: [] }
    }
  })
  const providerB = createCustomAiProviderProfile({
    id: 'provider-b',
    providerName: 'Provider B',
    capabilities: {
      chat: { enabled: false, defaultModelId: null, models: [] },
      image: {
        enabled: true,
        defaultModelId: 'model-b-old',
        models: [
          {
            id: 'model-b-old',
            modelName: 'image-b-old',
            endpointPath: '/v1/images/b-old',
            protocol: 'openai',
            enabled: true
          },
          {
            id: 'model-b-new',
            modelName: 'image-b-new',
            endpointPath: '/v1/images/b-new',
            protocol: 'openai',
            enabled: true
          }
        ]
      },
      video: { enabled: false, defaultModelId: null, models: [] }
    }
  })

  const result = applyAiCapabilityDefaultSelection(
    [providerA, providerB],
    {
      chatProviderId: null,
      imageProviderId: 'provider-a',
      videoProviderId: null
    },
    'provider-b',
    'image',
    'model-b-new'
  )

  assert.equal(result.runtimeDefaults.imageProviderId, 'provider-b')
  assert.equal(result.profiles[0].capabilities.image.defaultModelId, 'model-a-image')
  assert.equal(result.profiles[1].capabilities.image.defaultModelId, 'model-b-new')
})

test('mergeAiProviderProfilesWithCatalog overlays saved provider credentials onto builtin catalog entries', () => {
  const merged = mergeAiProviderProfilesWithCatalog(BUILTIN, [
    {
      ...BUILTIN[0],
      baseUrl: 'https://proxy.example.com',
      apiKey: 'secret-key'
    }
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].baseUrl, 'https://proxy.example.com')
  assert.equal(merged[0].apiKey, 'secret-key')
  assert.equal(merged[0].capabilities.chat.models[0].modelName, 'gpt-4o-mini')
})

test('mergeAiProviderProfilesWithCatalog deduplicates legacy migrated providers that share the builtin providerName', () => {
  const merged = mergeAiProviderProfilesWithCatalog(
    [
      ...BUILTIN,
      {
        id: 'provider-grsai',
        providerName: 'grsai',
        baseUrl: 'https://grsai.example.com',
        apiKey: '',
        enabled: true,
        source: 'builtin',
        capabilities: {
          chat: { enabled: false, defaultModelId: null, models: [] },
          image: {
            enabled: true,
            defaultModelId: 'model-image-default',
            models: [
              {
                id: 'model-image-default',
                modelName: 'nano-banana-fast',
                endpointPath: '/v1/draw/nano-banana',
                protocol: 'openai',
                enabled: true
              }
            ]
          },
          video: { enabled: false, defaultModelId: null, models: [] }
        },
        models: [],
        defaultModelId: null
      }
    ],
    [
      {
        id: 'legacy-custom-grsai',
        providerName: 'grsai',
        baseUrl: 'https://legacy-grsai.example.com',
        apiKey: 'legacy-key',
        enabled: true,
        source: 'custom',
        capabilities: {
          chat: { enabled: false, defaultModelId: null, models: [] },
          image: {
            enabled: true,
            defaultModelId: 'legacy-image',
            models: [
              {
                id: 'legacy-image',
                modelName: 'nano-banana-fast',
                endpointPath: '/legacy/draw',
                protocol: 'openai',
                enabled: true
              }
            ]
          },
          video: { enabled: false, defaultModelId: null, models: [] }
        },
        models: [],
        defaultModelId: null
      }
    ]
  )

  assert.equal(merged.filter((profile) => profile.providerName === 'grsai').length, 1)
  assert.equal(merged.find((profile) => profile.providerName === 'grsai')?.baseUrl, 'https://legacy-grsai.example.com')
  assert.equal(merged.find((profile) => profile.providerName === 'grsai')?.apiKey, 'legacy-key')
})

test('mergeAiProviderProfilesWithCatalog keeps builtin provider tombstones deleted so they do not reappear after save', () => {
  const merged = mergeAiProviderProfilesWithCatalog(BUILTIN, [
    {
      ...BUILTIN[0],
      deleted: true
    }
  ])

  assert.equal(merged.length, 0)
})

test('buildAiModelHealthCacheSignature changes when routing-relevant provider or model fields change', () => {
  const base = buildAiModelHealthCacheSignature(
    {
      providerName: 'openai',
      baseUrl: 'https://api.openai.com',
      enabled: true
    },
    {
      modelName: 'gpt-4o-mini',
      endpointPath: '/v1/chat/completions',
      enabled: true
    }
  )
  const changed = buildAiModelHealthCacheSignature(
    {
      providerName: 'openai',
      baseUrl: 'https://proxy.example.com',
      enabled: true
    },
    {
      modelName: 'gpt-4o-mini',
      endpointPath: '/v1/chat/completions',
      enabled: true
    }
  )

  assert.notEqual(base, changed)
})

test('isAiModelHealthCacheFresh only keeps checks from the same calendar day', () => {
  const now = new Date('2026-04-05T12:00:00+08:00').getTime()
  const sameDay = new Date('2026-04-05T01:00:00+08:00').getTime()
  const previousDay = new Date('2026-04-04T23:59:59+08:00').getTime()

  assert.equal(isAiModelHealthCacheFresh(sameDay, now), true)
  assert.equal(isAiModelHealthCacheFresh(previousDay, now), false)
  assert.equal(isAiModelHealthCacheFresh(null, now), false)
})
