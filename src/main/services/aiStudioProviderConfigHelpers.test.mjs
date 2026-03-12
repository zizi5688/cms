import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAiStudioProviderConfig } from './aiStudioProviderConfigHelpers.ts'

const CONFIG = {
  provider: 'grsai',
  baseUrl: 'https://grs.example.com',
  apiKey: 'grs-key',
  defaultImageModel: 'nano-banana',
  endpointPath: '/v1/draw/nano-banana',
  providerProfiles: [
    {
      id: 'provider-grsai',
      providerName: 'grsai',
      baseUrl: 'https://grs.example.com',
      apiKey: 'grs-key',
      models: [
        {
          id: 'model-nano-banana',
          modelName: 'nano-banana',
          endpointPath: '/v1/draw/nano-banana'
        }
      ],
      defaultModelId: 'model-nano-banana'
    },
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
}

test('resolveAiStudioProviderConfig uses the image task provider and model before the global compatibility fields', () => {
  const resolved = resolveAiStudioProviderConfig(CONFIG, {
    provider: 'allapi',
    model: 'jimeng-image-3.0',
    metadata: {}
  })

  assert.equal(resolved.provider, 'allapi')
  assert.equal(resolved.baseUrl, 'https://allapi.example.com')
  assert.equal(resolved.apiKey, 'allapi-key')
  assert.equal(resolved.defaultImageModel, 'jimeng-image-3.0')
  assert.equal(resolved.endpointPath, '/v1/images/generations')
})

test('resolveAiStudioProviderConfig falls back to the saved compatibility fields for legacy image tasks', () => {
  const resolved = resolveAiStudioProviderConfig(CONFIG, {
    provider: '',
    model: '',
    metadata: {}
  })

  assert.equal(resolved.provider, 'grsai')
  assert.equal(resolved.baseUrl, 'https://grs.example.com')
  assert.equal(resolved.apiKey, 'grs-key')
  assert.equal(resolved.defaultImageModel, 'nano-banana')
  assert.equal(resolved.endpointPath, '/v1/draw/nano-banana')
})
