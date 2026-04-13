import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ensureAiStudioProviderReady,
  isLocalGatewayAiStudioBaseUrl
} from './aiStudioProviderReadiness.ts'

test('isLocalGatewayAiStudioBaseUrl recognizes local gateway origins', () => {
  assert.equal(isLocalGatewayAiStudioBaseUrl('http://127.0.0.1:4174'), true)
  assert.equal(isLocalGatewayAiStudioBaseUrl('http://localhost:4174/'), true)
  assert.equal(isLocalGatewayAiStudioBaseUrl('http://0.0.0.0:4174'), true)
  assert.equal(isLocalGatewayAiStudioBaseUrl('https://grsaiapi.com'), false)
})

test('ensureAiStudioProviderReady triggers readiness callback for local gateway image routes', async () => {
  const calls = []

  await ensureAiStudioProviderReady({
    config: { baseUrl: 'http://127.0.0.1:4174' },
    capability: 'image',
    ensureReady: async (_config, capability) => {
      calls.push(capability)
    }
  })

  assert.deepEqual(calls, ['image'])
})

test('ensureAiStudioProviderReady skips callback for non-local routes', async () => {
  let called = false

  await ensureAiStudioProviderReady({
    config: { baseUrl: 'https://grsaiapi.com' },
    capability: 'image',
    ensureReady: async () => {
      called = true
    }
  })

  assert.equal(called, false)
})
