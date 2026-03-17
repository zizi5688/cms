import assert from 'node:assert/strict'
import test from 'node:test'

import { buildVideoEndpointPair, resolveAiTaskProviderSelection } from './aiProviderProfiles.ts'

const PROFILES = [
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
      },
      {
        id: 'model-flux-pro',
        modelName: 'flux-pro-1.1',
        endpointPath: '/v1/flux/pro'
      }
    ],
    defaultModelId: 'model-jimeng-image'
  }
]

test('resolveAiTaskProviderSelection prefers the current task provider and model over global fallback', () => {
  const resolved = resolveAiTaskProviderSelection(PROFILES, {
    taskProviderName: 'allapi',
    taskModelName: 'flux-pro-1.1',
    fallbackProviderName: 'grsai',
    fallbackModelName: 'nano-banana'
  })

  assert.equal(resolved.providerName, 'allapi')
  assert.equal(resolved.modelName, 'flux-pro-1.1')
  assert.equal(resolved.endpointPath, '/v1/flux/pro')
  assert.equal(resolved.providerProfile?.apiKey, 'allapi-key')
})

test('resolveAiTaskProviderSelection falls back to the stored active provider when the task has no provider', () => {
  const resolved = resolveAiTaskProviderSelection(PROFILES, {
    taskProviderName: '',
    taskModelName: '',
    fallbackProviderName: 'allapi',
    fallbackModelName: 'jimeng-image-3.0'
  })

  assert.equal(resolved.providerName, 'allapi')
  assert.equal(resolved.modelName, 'jimeng-image-3.0')
  assert.equal(resolved.endpointPath, '/v1/images/generations')
  assert.equal(resolved.providerProfile?.baseUrl, 'https://allapi.example.com')
})

test('resolveAiTaskProviderSelection uses the provider default model when the task model is blank', () => {
  const resolved = resolveAiTaskProviderSelection(PROFILES, {
    taskProviderName: 'allapi',
    taskModelName: '',
    fallbackProviderName: 'grsai',
    fallbackModelName: 'nano-banana'
  })

  assert.equal(resolved.providerName, 'allapi')
  assert.equal(resolved.modelName, 'jimeng-image-3.0')
  assert.equal(resolved.endpointPath, '/v1/images/generations')
})

test('buildVideoEndpointPair keeps the Seedance submit endpoint and derives a task-id polling path', () => {
  assert.deepEqual(buildVideoEndpointPair('/volc/v1/contents/generations/tasks'), {
    submitPath: '/volc/v1/contents/generations/tasks',
    queryPath: '/volc/v1/contents/generations/tasks/{task_id}'
  })
})
