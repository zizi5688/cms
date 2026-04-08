import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultLocalGatewayConfig } from './localGatewayConfig.ts'
import {
  collectLocalGatewayServiceStatuses,
  createLocalGatewayState,
  resolveLocalGatewayOverallStatus
} from './localGatewayHealth.ts'

function createResponse(ok, status = ok ? 200 : 500) {
  return {
    ok,
    status
  }
}

test('collectLocalGatewayServiceStatuses reports enabled services and chrome debug port', async () => {
  const calls = []
  const services = await collectLocalGatewayServiceStatuses(createDefaultLocalGatewayConfig(), {
    fetch: async (url) => {
      calls.push(url)
      return createResponse(!String(url).includes('4175'))
    },
    isPortListening: async (port) => port === 9222
  })

  assert.equal(services.find((item) => item.name === 'adapter')?.ok, true)
  assert.equal(services.find((item) => item.name === 'adminUi')?.ok, false)
  assert.equal(services.find((item) => item.name === 'chromeDebug')?.ok, true)
  assert.equal(calls.length >= 4, true)
})

test('resolveLocalGatewayOverallStatus returns services_ready when core services are healthy', () => {
  const config = { ...createDefaultLocalGatewayConfig(), enabled: true }
  const status = resolveLocalGatewayOverallStatus({
    config,
    isConfigured: true,
    services: [
      { name: 'adapter', ok: true, port: 8766, message: null },
      { name: 'gateway', ok: true, port: 4174, message: null },
      { name: 'adminUi', ok: true, port: 4175, message: null },
      { name: 'cdpProxy', ok: true, port: 3456, message: null },
      { name: 'chromeDebug', ok: false, port: 9222, message: 'nope' }
    ]
  })
  assert.equal(status, 'services_ready')
})

test('createLocalGatewayState keeps last error and degraded status', () => {
  const config = { ...createDefaultLocalGatewayConfig(), enabled: true }
  const state = createLocalGatewayState({
    config,
    isConfigured: true,
    bundlePath: '/tmp/local-ai-gateway',
    lastError: 'admin ui failed',
    services: [
      { name: 'adapter', ok: true, port: 8766, message: null },
      { name: 'gateway', ok: true, port: 4174, message: null },
      { name: 'adminUi', ok: false, port: 4175, message: 'HTTP 500' },
      { name: 'cdpProxy', ok: true, port: 3456, message: null },
      { name: 'chromeDebug', ok: false, port: 9222, message: 'Chrome 未开启远程调试端口。' }
    ]
  })

  assert.equal(state.overallStatus, 'degraded')
  assert.equal(state.lastError, 'admin ui failed')
})
