import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultLocalGatewayConfig } from './localGatewayConfig.ts'
import {
  collectLocalGatewayServiceStatuses,
  createLocalGatewayState,
  isLocalGatewayImageRuntimeReady,
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
  const previousPort = process.env.LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT
  process.env.LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT = '9333'
  try {
    const services = await collectLocalGatewayServiceStatuses(createDefaultLocalGatewayConfig(), {
      fetch: async (url) => {
        calls.push(url)
        if (String(url).includes('3456')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ok',
              connected: true,
              chromePort: 9333
            })
          }
        }
        return createResponse(!String(url).includes('4175'))
      },
      isPortListening: async (port) => port === 9333
    })

    assert.equal(services.find((item) => item.name === 'adapter')?.ok, true)
    assert.equal(services.find((item) => item.name === 'adminUi')?.ok, false)
    assert.equal(services.find((item) => item.name === 'chromeDebug')?.ok, true)
    assert.equal(services.find((item) => item.name === 'chromeDebug')?.port, 9333)
    assert.equal(calls.length >= 4, true)
  } finally {
    if (previousPort === undefined) {
      delete process.env.LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT
    } else {
      process.env.LOCAL_AI_GATEWAY_CHROME_DEBUG_PORT = previousPort
    }
  }
})

test('collectLocalGatewayServiceStatuses marks cdp proxy degraded when dedicated chrome is not connected', async () => {
  const services = await collectLocalGatewayServiceStatuses(createDefaultLocalGatewayConfig(), {
    fetch: async (url) => {
      if (String(url).includes('3456')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'ok',
            connected: false,
            message: 'Chrome 未启动，需要执行初始化。'
          })
        }
      }
      return createResponse(true)
    },
    isPortListening: async () => false
  })

  assert.deepEqual(services.find((item) => item.name === 'cdpProxy'), {
    name: 'cdpProxy',
    ok: false,
    port: 3456,
    message: 'Chrome 未启动，需要执行初始化。'
  })
})

test('collectLocalGatewayServiceStatuses treats legacy cdp proxy payload with message as degraded', async () => {
  const services = await collectLocalGatewayServiceStatuses(createDefaultLocalGatewayConfig(), {
    fetch: async (url) => {
      if (String(url).includes('3456')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'ok',
            connected: null,
            message: 'Chrome 未启动，需要执行初始化。'
          })
        }
      }
      return createResponse(true)
    },
    isPortListening: async () => false
  })

  assert.deepEqual(services.find((item) => item.name === 'cdpProxy'), {
    name: 'cdpProxy',
    ok: false,
    port: 3456,
    message: 'Chrome 未启动，需要执行初始化。'
  })
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

test('isLocalGatewayImageRuntimeReady requires cdp proxy and chrome debug to stay ready', () => {
  const config = { ...createDefaultLocalGatewayConfig(), enabled: true, startCdpProxy: true }
  const baseServices = [
    { name: 'adapter', ok: true, port: 8766, message: null },
    { name: 'gateway', ok: true, port: 4174, message: null },
    { name: 'adminUi', ok: true, port: 4175, message: null }
  ]

  assert.equal(
    isLocalGatewayImageRuntimeReady({
      config,
      services: [
        ...baseServices,
        { name: 'cdpProxy', ok: false, port: 3456, message: 'Chrome 未启动，需要执行初始化。' },
        { name: 'chromeDebug', ok: true, port: 9333, message: null }
      ]
    }),
    false
  )

  assert.equal(
    isLocalGatewayImageRuntimeReady({
      config,
      services: [
        ...baseServices,
        { name: 'cdpProxy', ok: true, port: 3456, message: null },
        { name: 'chromeDebug', ok: false, port: 9333, message: 'Chrome 未开启远程调试端口。' }
      ]
    }),
    false
  )

  assert.equal(
    isLocalGatewayImageRuntimeReady({
      config,
      services: [
        ...baseServices,
        { name: 'cdpProxy', ok: true, port: 3456, message: null },
        { name: 'chromeDebug', ok: true, port: 9333, message: null }
      ]
    }),
    true
  )
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
