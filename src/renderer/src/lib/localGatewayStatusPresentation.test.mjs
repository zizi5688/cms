import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatLocalGatewayTimestamp,
  resolveLocalGatewayStatusPresentation
} from './localGatewayStatusPresentation.ts'

function createBaseState(overrides = {}) {
  return {
    overallStatus: 'degraded',
    services: [
      { name: 'adapter', ok: true, port: 8766, message: null },
      { name: 'gateway', ok: true, port: 4174, message: null },
      { name: 'adminUi', ok: true, port: 4175, message: null },
      { name: 'cdpProxy', ok: true, port: 3456, message: null },
      { name: 'chromeDebug', ok: true, port: 9333, message: null }
    ],
    capabilityChecks: {
      chat: { status: 'passing', ok: true, checkedAt: 1712217600000, message: null },
      image: { status: 'passing', ok: true, checkedAt: 1712217600000, message: null }
    },
    bundlePath: '/tmp/local-ai-gateway',
    lastStartedAt: 1712217600000,
    lastError: 'old bootstrap error',
    ...overrides
  }
}

function createConfig(overrides = {}) {
  return {
    enabled: true,
    bundlePath: '/tmp/local-ai-gateway',
    autoStartOnAppLaunch: true,
    startAdminUi: true,
    startCdpProxy: true,
    allowDedicatedChrome: true,
    chromeProfileDirectories: ['Profile 11'],
    gatewayCmsProfileId: '',
    prewarmImageOnLaunch: true,
    ...overrides
  }
}

test('formatLocalGatewayTimestamp hides zero and invalid timestamps instead of rendering 1970', () => {
  assert.equal(formatLocalGatewayTimestamp(null), '--')
  assert.equal(formatLocalGatewayTimestamp(0), '--')
  assert.equal(formatLocalGatewayTimestamp(Number.NaN), '--')
})

test('resolveLocalGatewayStatusPresentation stays green when real chat and image checks pass even if overallStatus is degraded from a stale error', () => {
  const presentation = resolveLocalGatewayStatusPresentation({
    state: createBaseState(),
    config: createConfig(),
    accounts: [
      {
        id: 'acct_profile_11',
        accountLabel: '2号-Ai专用',
        status: 'active',
        chromeProfileDirectory: 'Profile 11',
        lastFailedAt: null,
        consecutiveFailures: 0
      }
    ]
  })

  assert.equal(presentation.overview.ready, true)
  assert.equal(presentation.chat.ready, true)
  assert.equal(presentation.flow.ready, true)
  assert.equal(presentation.admin.ready, true)
  assert.equal(presentation.overview.label, '真实链路正常')
})

test('resolveLocalGatewayStatusPresentation marks chat red when the selected account is in cooldown even if the service probe is green', () => {
  const presentation = resolveLocalGatewayStatusPresentation({
    state: createBaseState(),
    config: createConfig(),
    accounts: [
      {
        id: 'acct_profile_11',
        accountLabel: '2号-Ai专用',
        status: 'cooldown',
        chromeProfileDirectory: 'Profile 11',
        lastFailedAt: 1712217600000,
        consecutiveFailures: 3
      }
    ]
  })

  assert.equal(presentation.chat.ready, false)
  assert.match(presentation.chat.label, /cooldown/)
  assert.equal(presentation.overview.ready, false)
})

test('resolveLocalGatewayStatusPresentation keeps flow red until a real image probe has passed', () => {
  const presentation = resolveLocalGatewayStatusPresentation({
    state: createBaseState({
      capabilityChecks: {
        chat: { status: 'passing', ok: true, checkedAt: 1712217600000, message: null },
        image: { status: 'unknown', ok: false, checkedAt: null, message: '尚未完成真实生图探测。' }
      }
    }),
    config: createConfig(),
    accounts: [
      {
        id: 'acct_profile_11',
        accountLabel: '2号-Ai专用',
        status: 'active',
        chromeProfileDirectory: 'Profile 11',
        lastFailedAt: null,
        consecutiveFailures: 0
      }
    ]
  })

  assert.equal(presentation.flow.ready, false)
  assert.equal(presentation.flow.label, '尚未完成真实生图探测。')
  assert.equal(presentation.overview.ready, false)
})
