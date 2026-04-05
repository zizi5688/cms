import type { AiProviderProfile } from './aiProviderTypes.ts'

export const BUILTIN_AI_PROVIDER_CATALOG: AiProviderProfile[] = [
  {
    id: 'provider-openai',
    providerName: 'openai',
    baseUrl: 'https://api.openai.com',
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
            enabled: true,
            tags: ['chat', 'default']
          }
        ]
      },
      image: {
        enabled: false,
        defaultModelId: null,
        models: []
      },
      video: {
        enabled: false,
        defaultModelId: null,
        models: []
      }
    },
    models: [],
    defaultModelId: null
  },
  {
    id: 'provider-grsai',
    providerName: 'grsai',
    baseUrl: 'https://grsaiapi.com',
    apiKey: '',
    enabled: true,
    source: 'builtin',
    capabilities: {
      chat: {
        enabled: false,
        defaultModelId: null,
        models: []
      },
      image: {
        enabled: true,
        defaultModelId: 'model-nano-banana-fast',
        models: [
          {
            id: 'model-nano-banana-fast',
            modelName: 'nano-banana-fast',
            endpointPath: '/v1/draw/nano-banana',
            protocol: 'openai',
            enabled: true,
            tags: ['image', 'default']
          }
        ]
      },
      video: {
        enabled: false,
        defaultModelId: null,
        models: []
      }
    },
    models: [],
    defaultModelId: null
  },
  {
    id: 'provider-allapi',
    providerName: 'allapi',
    baseUrl: 'https://api.allapi.ai',
    apiKey: '',
    enabled: true,
    source: 'builtin',
    capabilities: {
      chat: {
        enabled: false,
        defaultModelId: null,
        models: []
      },
      image: {
        enabled: true,
        defaultModelId: 'model-jimeng-image-3',
        models: [
          {
            id: 'model-jimeng-image-3',
            modelName: 'jimeng-image-3.0',
            endpointPath: '/v1/images/generations',
            protocol: 'openai',
            enabled: true,
            tags: ['image']
          }
        ]
      },
      video: {
        enabled: true,
        defaultModelId: 'model-seedance-1-pro',
        models: [
          {
            id: 'model-seedance-1-pro',
            modelName: 'seedance-1.0-pro',
            endpointPath: '/volc/v1/contents/generations/tasks',
            protocol: 'vendor-custom',
            enabled: true,
            tags: ['video']
          }
        ]
      }
    },
    models: [],
    defaultModelId: null
  }
]
