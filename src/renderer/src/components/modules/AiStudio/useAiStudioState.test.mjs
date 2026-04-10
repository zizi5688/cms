import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_AI_STUDIO_CHILD_OUTPUT_COUNT,
  DEFAULT_AI_STUDIO_MASTER_OUTPUT_COUNT
} from './workflowDefaults.ts'
import {
  resolveStartChatRunSelection,
  resolveVideoSmartChatCandidates,
  validateStartChatRunSelection
} from './aiStudioChatRouteHelpers.ts'

test('workflow defaults keep the image master output count at one', () => {
  assert.equal(DEFAULT_AI_STUDIO_MASTER_OUTPUT_COUNT, 1)
  assert.equal(DEFAULT_AI_STUDIO_CHILD_OUTPUT_COUNT, 4)
})

const AI_CONFIG = {
  aiProvider: 'openai',
  aiRuntimeDefaults: {
    chatProviderId: 'provider-openai',
    imageProviderId: 'provider-allapi',
    videoProviderId: 'provider-allapi'
  }
}

const PROVIDER_PROFILES = [
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
]

test('AI Studio exposes primary and fallback chat candidates for smart video generation', () => {
  const candidates = resolveVideoSmartChatCandidates({
    aiConfig: AI_CONFIG,
    providerProfiles: PROVIDER_PROFILES
  })

  assert.deepEqual(
    candidates.map((candidate) => candidate.providerId),
    ['provider-openai', 'provider-gemini']
  )
})

test('startChatRun selection accepts an explicit provider route override and still validates required fields', () => {
  const selection = resolveStartChatRunSelection({
    aiConfig: AI_CONFIG,
    providerProfiles: PROVIDER_PROFILES,
    routeOverride: {
      providerId: 'provider-gemini',
      providerName: 'gemini',
      modelId: 'model-gemini-2.5-flash',
      modelName: 'gemini-2.5-flash',
      baseUrl: 'https://gemini.example.com',
      apiKey: 'gemini-key',
      endpointPath: '/v1beta/models/gemini-2.5-flash:generateContent',
      protocol: 'google-genai'
    }
  })

  assert.equal(selection.shouldUseRouteOverride, true)
  assert.equal(selection.route.providerId, 'provider-gemini')
  assert.equal(selection.route.modelName, 'gemini-2.5-flash')
  assert.equal(
    validateStartChatRunSelection({
      ...selection.route,
      apiKey: ''
    }).message,
    '[AI Studio] 请先填写聊天供应商 API Key。'
  )
})

test('startChatRun selection keeps default chat behavior when no explicit override is supplied', () => {
  const selection = resolveStartChatRunSelection({
    aiConfig: AI_CONFIG,
    providerProfiles: PROVIDER_PROFILES
  })

  assert.equal(selection.shouldUseRouteOverride, false)
  assert.equal(selection.route.providerId, 'provider-openai')
  assert.equal(selection.route.modelName, 'gpt-4o-mini')
  assert.equal(validateStartChatRunSelection(selection.route), null)
})
