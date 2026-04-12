import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyVideoNoteGenerationUpdate,
  createInitialVideoNoteGenerationState
} from './videoNoteGenerationOrchestrator.ts'
import { runVideoSmartGenerationFlow } from './videoSmartGenerationFlow.ts'

function createChatCandidate(providerId, providerName, modelName) {
  return {
    providerId,
    providerName,
    modelId: `${providerId}-model`,
    modelName,
    endpointPath: '/v1/chat/completions',
    baseUrl: `https://${providerId}.example.com`,
    apiKey: `${providerId}-key`,
    protocol: 'openai'
  }
}

function createFlowHarness(options = {}) {
  const logs = []
  const chatCalls = []
  let renderCalls = 0
  let state = options.initialState ?? createInitialVideoNoteGenerationState()
  const startChatRunImpl = options.startChatRunImpl ?? (async ({ routeOverride }) => ({
    outputText: `标题,正文\n${routeOverride?.providerName ?? 'default'},"正文"`
  }))
  const startVideoRenderImpl =
    options.startVideoRenderImpl ??
    (async () => ({
      outputs: ['/tmp/video-a.mp4'],
      failedCount: 0
    }))
  const prepareGeneratedVideoPreviewAssetsImpl =
    options.prepareGeneratedVideoPreviewAssetsImpl ??
    (async (videoPaths) =>
      videoPaths.map((videoPath) => ({
        videoPath,
        previewPath: `${videoPath}.preview`
      })))

  return {
    logs,
    chatCalls,
    get renderCalls() {
      return renderCalls
    },
    get state() {
      return state
    },
    run: () =>
      runVideoSmartGenerationFlow({
        chatInput: {
          prompt: '生成视频笔记文案',
          imagePaths: []
        },
        chatCandidates: options.chatCandidates ?? [
          createChatCandidate('provider-openai', 'openai', 'gpt-4o-mini'),
          createChatCandidate('provider-gemini', 'gemini', 'gemini-2.5-flash')
        ],
        existingPreviewAssets: options.existingPreviewAssets ?? [],
        startChatRun: async (payload) => {
          chatCalls.push(payload)
          return startChatRunImpl(payload)
        },
        startVideoRender: async () => {
          renderCalls += 1
          return startVideoRenderImpl()
        },
        prepareGeneratedVideoPreviewAssets: prepareGeneratedVideoPreviewAssetsImpl,
        extractCsvFromResponse: (rawText) => String(rawText ?? '').trim(),
        applyGenerationUpdate: (update) => {
          state = applyVideoNoteGenerationUpdate(state, update)
        },
        addLog: (message) => {
          logs.push(message)
        }
      })
  }
}

test('video smart generation uses the primary provider when it succeeds', async () => {
  const harness = createFlowHarness({
    initialState: applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
      type: 'start'
    })
  })

  const result = await harness.run()

  assert.equal(result.copyResult.ok, true)
  assert.equal(result.renderResult.ok, true)
  assert.equal(harness.chatCalls.length, 1)
  assert.equal(harness.chatCalls[0].routeOverride.providerId, 'provider-openai')
  assert.equal(harness.state.mergeStatus, 'ready-preview')
})

test('video smart generation falls back to the secondary provider after a primary copy failure', async () => {
  const harness = createFlowHarness({
    initialState: applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
      type: 'start'
    }),
    startChatRunImpl: async ({ routeOverride }) => {
      if (routeOverride?.providerId === 'provider-openai') {
        throw new Error('primary timeout')
      }
      return {
        outputText: '标题,正文\ngemini,"正文"'
      }
    }
  })

  const result = await harness.run()

  assert.equal(result.copyResult.ok, true)
  assert.deepEqual(
    harness.chatCalls.map((call) => call.routeOverride.providerId),
    ['provider-openai', 'provider-gemini']
  )
  assert.deepEqual(harness.state.copyFailureHistory, [
    {
      providerName: 'openai',
      message: 'primary timeout'
    }
  ])
  assert.equal(harness.state.mergeStatus, 'ready-preview')
})

test('video smart generation preserves rendered videos when both copy providers fail', async () => {
  const harness = createFlowHarness({
    initialState: applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
      type: 'start'
    }),
    startChatRunImpl: async ({ routeOverride }) => {
      throw new Error(`${routeOverride?.providerName} failed`)
    }
  })

  const result = await harness.run()

  assert.equal(result.copyResult.ok, false)
  assert.equal(result.renderResult.ok, true)
  assert.equal(harness.state.renderStatus, 'success')
  assert.equal(harness.state.copyStatus, 'error')
  assert.equal(harness.state.copyLifecyclePhase, null)
  assert.equal(harness.state.canRetryCopyOnly, true)
  assert.equal(harness.state.previewAssets.length, 1)
})

test('video smart generation clears overlay lifecycle when render fails before copy returns', async () => {
  const harness = createFlowHarness({
    initialState: applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
      type: 'start'
    }),
    startVideoRenderImpl: async () => {
      throw new Error('network disconnected')
    },
    startChatRunImpl: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            outputText: '标题,正文\nok,"正文"'
          })
        }, 10)
      })
  })

  const result = await harness.run()

  assert.equal(result.renderResult.ok, false)
  assert.equal(harness.state.renderStatus, 'error')
  assert.equal(harness.state.copyLifecyclePhase, null)
})

test('video smart generation copy-only retry reuses existing rendered assets', async () => {
  let state = createInitialVideoNoteGenerationState()
  state = applyVideoNoteGenerationUpdate(state, {
    type: 'render-success',
    assets: [
      {
        videoPath: '/tmp/video-a.mp4',
        previewPath: '/tmp/video-a-preview.mp4'
      }
    ]
  })
  state = applyVideoNoteGenerationUpdate(state, {
    type: 'copy-error',
    providerName: 'openai',
    message: 'primary timeout'
  })

  const harness = createFlowHarness({
    initialState: state,
    existingPreviewAssets: state.previewAssets
  })

  const result = await harness.run()

  assert.equal(result.copyResult.ok, true)
  assert.equal(result.renderResult.ok, true)
  assert.equal(result.renderResult.reusedExistingAssets, true)
  assert.deepEqual(result.renderResult.assets, state.previewAssets)
  assert.equal(harness.state.mergeStatus, 'ready-preview')
})

test('video smart generation copy-only retry does not rerun video generation', async () => {
  let state = createInitialVideoNoteGenerationState()
  state = applyVideoNoteGenerationUpdate(state, {
    type: 'render-success',
    assets: [
      {
        videoPath: '/tmp/video-a.mp4'
      }
    ]
  })
  state = applyVideoNoteGenerationUpdate(state, {
    type: 'copy-error',
    providerName: 'openai',
    message: 'primary timeout'
  })

  const harness = createFlowHarness({
    initialState: state,
    existingPreviewAssets: state.previewAssets,
    startVideoRenderImpl: async () => {
      throw new Error('video generation should not run during copy-only retry')
    }
  })

  await harness.run()

  assert.equal(harness.renderCalls, 0)
})
