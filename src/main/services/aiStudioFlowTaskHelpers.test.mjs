import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiStudioAsyncFlowSubmitPayload,
  isAiStudioAsyncFlowRoute,
  normalizeAiStudioAsyncFlowTaskPayload
} from './aiStudioFlowTaskHelpers.ts'

test('isAiStudioAsyncFlowRoute matches the Flow web image model and endpoint', () => {
  assert.equal(
    isAiStudioAsyncFlowRoute({
      model: 'flow-web-image',
      endpointPath: '/v1beta/models/flow-web-image:generateContent'
    }),
    true
  )
  assert.equal(
    isAiStudioAsyncFlowRoute({
      model: 'gemini-2.5-pro',
      endpointPath: '/v1beta/models/gemini-2.5-pro:generateContent'
    }),
    false
  )
})

test('buildAiStudioAsyncFlowSubmitPayload adds the public flow model name', () => {
  assert.deepEqual(
    buildAiStudioAsyncFlowSubmitPayload({
      model: 'flow-web-image',
      requestPayload: {
        contents: [{ role: 'user', parts: [{ text: 'draw a poster' }] }]
      }
    }),
    {
      publicModel: 'flow-web-image',
      contents: [{ role: 'user', parts: [{ text: 'draw a poster' }] }]
    }
  )
})

test('normalizeAiStudioAsyncFlowTaskPayload flattens successful task payloads for result parsing', () => {
  assert.deepEqual(
    normalizeAiStudioAsyncFlowTaskPayload({
      taskId: 'task_1',
      status: 'succeeded',
      response: {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'ZmFrZQ=='
                  }
                }
              ]
            }
          }
        ]
      }
    }),
    {
      taskId: 'task_1',
      status: 'succeeded',
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'ZmFrZQ=='
                }
              }
            ]
          }
        }
      ]
    }
  )
})

test('normalizeAiStudioAsyncFlowTaskPayload preserves failed task errors', () => {
  assert.deepEqual(
    normalizeAiStudioAsyncFlowTaskPayload({
      taskId: 'task_1',
      status: 'failed',
      error: 'FLOW_REQUEST_TIMEOUT: ...'
    }),
    {
      taskId: 'task_1',
      status: 'failed',
      error: 'FLOW_REQUEST_TIMEOUT: ...'
    }
  )
})
