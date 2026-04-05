import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getBuiltinAiProviderCatalog,
  normalizeAiProviderProfiles
} from './aiProviderCatalogHelpers.ts'

test('getBuiltinAiProviderCatalog returns builtin providers grouped by chat image and video capabilities', () => {
  const catalog = getBuiltinAiProviderCatalog()

  assert.ok(catalog.length > 0)
  assert.ok(catalog.every((provider) => provider.source === 'builtin'))
  assert.ok(
    catalog.some(
      (provider) =>
        provider.capabilities.chat.models.length > 0 ||
        provider.capabilities.image.models.length > 0 ||
        provider.capabilities.video.models.length > 0
    )
  )
  assert.ok(
    catalog.every((provider) =>
      ['chat', 'image', 'video'].every((capability) => provider.capabilities[capability])
    )
  )
})

test('normalizeAiProviderProfiles trims values, backfills capability defaults, and keeps the image mirror fields aligned', () => {
  const [provider] = normalizeAiProviderProfiles([
    {
      id: ' provider-custom ',
      providerName: ' Custom Provider ',
      baseUrl: ' https://custom.example.com/ ',
      apiKey: ' secret-key ',
      source: 'custom',
      enabled: true,
      capabilities: {
        image: {
          enabled: true,
          defaultModelId: '',
          models: [
            {
              id: ' model-image ',
              modelName: ' custom-image-v1 ',
              endpointPath: 'v1/images',
              protocol: '',
              enabled: true
            }
          ]
        }
      }
    }
  ])

  assert.equal(provider.id, 'provider-custom')
  assert.equal(provider.providerName, 'Custom Provider')
  assert.equal(provider.baseUrl, 'https://custom.example.com')
  assert.equal(provider.apiKey, 'secret-key')
  assert.equal(provider.capabilities.chat.enabled, false)
  assert.equal(provider.capabilities.image.defaultModelId, 'model-image')
  assert.equal(provider.capabilities.image.models[0].endpointPath, '/v1/images')
  assert.equal(provider.capabilities.image.models[0].protocol, 'openai')
  assert.deepEqual(provider.models, provider.capabilities.image.models)
  assert.equal(provider.defaultModelId, 'model-image')
})

test('normalizeAiProviderProfiles preserves deleted provider tombstones', () => {
  const [provider] = normalizeAiProviderProfiles([
    {
      id: 'provider-openai',
      providerName: 'openai',
      deleted: true
    }
  ])

  assert.equal(provider.deleted, true)
})
