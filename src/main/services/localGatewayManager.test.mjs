import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { LocalGatewayManager } from './localGatewayManager.ts'

function createStore(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get(key) {
      return values.get(key)
    },
    set(key, value) {
      values.set(key, value)
    }
  }
}

test('LocalGatewayManager returns unconfigured when bundle is missing', async () => {
  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: '/tmp/does-not-exist',
        autoStartOnAppLaunch: true,
        startAdminUi: true,
        startCdpProxy: true
      }
    }),
    logsDir: join(tmpdir(), 'local-gateway-test-logs-missing'),
    healthDeps: {
      fetch: async () => ({ ok: false, status: 500 }),
      isPortListening: async () => false
    }
  })

  const state = await manager.autoStartIfEnabled()
  assert.equal(state.overallStatus, 'unconfigured')
  assert.match(String(state.lastError), /不存在/)
})

test('LocalGatewayManager reports services_ready when core services are healthy', async () => {
  const root = join(tmpdir(), `local-gateway-test-${Date.now()}`)
  mkdirSync(join(root, 'local-ai-gateway', 'python_adapter', '.venv', 'bin'), { recursive: true })
  mkdirSync(join(root, 'tools'), { recursive: true })
  mkdirSync(join(root, 'local-ai-gateway'), { recursive: true })
  mkdirSync(join(root, 'logs'), { recursive: true })
  writeFileSync(join(root, 'tools', 'cdp-proxy.mjs'), 'console.log("ok")\n')
  writeFileSync(join(root, 'local-ai-gateway', 'python_adapter', '.venv', 'bin', 'activate'), 'echo ok\n')

  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: root,
        autoStartOnAppLaunch: false,
        startAdminUi: true,
        startCdpProxy: true
      }
    }),
    logsDir: join(root, 'logs'),
    healthDeps: {
      fetch: async (url) => ({ ok: !String(url).includes('4175') ? true : true, status: 200 }),
      isPortListening: async () => false
    }
  })

  const state = await manager.refreshState()
  assert.equal(state.overallStatus, 'services_ready')
  rmSync(root, { recursive: true, force: true })
})
