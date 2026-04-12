import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDefaultLocalGatewayConfig,
  mergeLocalGatewayConfig,
  normalizeLocalGatewayConfig,
  readLocalGatewayConfigFromStore
} from './localGatewayConfig.ts'

test('normalizeLocalGatewayConfig falls back to defaults', () => {
  const config = normalizeLocalGatewayConfig(null)
  assert.deepEqual(config, createDefaultLocalGatewayConfig())
})

test('mergeLocalGatewayConfig applies partial patch and keeps defaults', () => {
  const config = mergeLocalGatewayConfig(createDefaultLocalGatewayConfig(), {
    enabled: true,
    startAdminUi: false,
    chromeProfileDirectories: ['Profile 10', 'Profile 11']
  })
  assert.equal(config.enabled, true)
  assert.equal(config.startAdminUi, false)
  assert.equal(config.startCdpProxy, true)
  assert.equal(config.gatewayCmsProfileId, '')
  assert.deepEqual(config.chromeProfileDirectories, ['Profile 10', 'Profile 11'])
})

test('readLocalGatewayConfigFromStore normalizes persisted values', () => {
  const values = new Map([
    [
      'localGateway',
      {
        enabled: true,
        bundlePath: ' /tmp/gateway ',
        gatewayCmsProfileId: ' cms-gateway-profile ',
        chromeProfileDirectory: ' Profile 10 '
      }
    ]
  ])
  const store = {
    get(key) {
      return values.get(key)
    },
    set(key, value) {
      values.set(key, value)
    }
  }

  const config = readLocalGatewayConfigFromStore(store)
  assert.equal(config.enabled, true)
  assert.equal(config.bundlePath, '/tmp/gateway')
  assert.equal(config.gatewayCmsProfileId, 'cms-gateway-profile')
  assert.deepEqual(config.chromeProfileDirectories, ['Profile 10'])
  assert.deepEqual(values.get('localGateway'), config)
})
