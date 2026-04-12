import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function createConfiguredBundleRoot(root) {
  mkdirSync(join(root, 'local-ai-gateway', 'python_adapter', '.venv', 'bin'), { recursive: true })
  mkdirSync(join(root, 'local-ai-gateway-startup', 'scripts'), { recursive: true })
  mkdirSync(join(root, 'tools'), { recursive: true })
  mkdirSync(join(root, 'logs'), { recursive: true })
  writeFileSync(join(root, 'tools', 'cdp-proxy.mjs'), 'console.log("ok")\n')
  writeFileSync(join(root, 'local-ai-gateway', 'python_adapter', '.venv', 'bin', 'activate'), 'echo ok\n')
}

test('LocalGatewayManager returns unconfigured when bundle is missing', async () => {
  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: '/tmp/does-not-exist',
        autoStartOnAppLaunch: true,
        startAdminUi: true,
        startCdpProxy: true,
        gatewayCmsProfileId: 'cms-gateway-profile'
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
  createConfiguredBundleRoot(root)

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

test('LocalGatewayManager initializeGateway records startup time after bootstrap succeeds', async (t) => {
  const root = join(tmpdir(), `local-gateway-init-success-${Date.now()}`)
  createConfiguredBundleRoot(root)
  writeFileSync(
    join(root, 'local-ai-gateway-startup', 'scripts', 'bootstrap_local_ai_gateway.sh'),
    'echo "bootstrap ok"\n',
    'utf-8'
  )

  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: root,
        autoStartOnAppLaunch: false,
        startAdminUi: true,
        startCdpProxy: true,
        gatewayCmsProfileId: 'cms-gateway-profile'
      }
    }),
    logsDir: join(root, 'logs'),
    chromeDeps: {
      resolveCmsProfile: async () => ({
        profile: {
          id: 'cms-gateway-profile',
          nickname: '本地网关专用',
          profileDir: 'cms-gateway-profile',
          purpose: 'gateway',
          xhsLoggedIn: false,
          lastLoginCheck: null
        },
        runtime: {
          executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          userDataDir: '/tmp/chrome-cms-data'
        }
      })
    },
    healthDeps: {
      fetch: async () => ({ ok: true, status: 200 }),
      isPortListening: async () => true
    }
  })

  const result = await manager.initializeGateway()
  const state = manager.getState()

  assert.equal(result.success, true)
  assert.equal(result.profileId, 'cms-gateway-profile')
  assert.equal(result.profileDirectory, 'cms-gateway-profile')
  assert.match(result.output, /bootstrap ok/)
  assert.equal(state.overallStatus, 'services_ready')
  assert.equal(state.lastError, null)
  assert.ok(state.lastStartedAt)

  rmSync(root, { recursive: true, force: true })
})

test('LocalGatewayManager initializeGateway records failure in state when bootstrap fails', async () => {
  const root = join(tmpdir(), `local-gateway-init-failed-${Date.now()}`)
  createConfiguredBundleRoot(root)
  writeFileSync(
    join(root, 'local-ai-gateway-startup', 'scripts', 'bootstrap_local_ai_gateway.sh'),
    'echo "bootstrap failed" >&2\nexit 12\n',
    'utf-8'
  )

  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: root,
        autoStartOnAppLaunch: false,
        startAdminUi: true,
        startCdpProxy: true,
        gatewayCmsProfileId: 'cms-gateway-profile'
      }
    }),
    logsDir: join(root, 'logs'),
    chromeDeps: {
      resolveCmsProfile: async () => ({
        profile: {
          id: 'cms-gateway-profile',
          nickname: '本地网关专用',
          profileDir: 'cms-gateway-profile',
          purpose: 'gateway',
          xhsLoggedIn: false,
          lastLoginCheck: null
        },
        runtime: {
          executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          userDataDir: '/tmp/chrome-cms-data'
        }
      })
    },
    healthDeps: {
      fetch: async () => ({ ok: true, status: 200 }),
      isPortListening: async () => true
    }
  })

  await assert.rejects(() => manager.initializeGateway(), /bootstrap failed/)

  const state = manager.getState()
  assert.match(String(state.lastError), /bootstrap failed/)
  assert.equal(state.overallStatus, 'degraded')
  assert.equal(state.lastStartedAt, null)

  rmSync(root, { recursive: true, force: true })
})

test('LocalGatewayManager ensureReadyForCapability initializes image bootstrap only once per app session', async () => {
  const root = join(tmpdir(), `local-gateway-ensure-image-${Date.now()}`)
  createConfiguredBundleRoot(root)
  writeFileSync(
    join(root, 'local-ai-gateway-startup', 'scripts', 'bootstrap_local_ai_gateway.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
COUNT_FILE="${root}/init-count.txt"
count=0
if [[ -f "${root}/init-count.txt" ]]; then
  count="$(cat "${root}/init-count.txt")"
fi
count=$((count + 1))
printf '%s' "\${count}" > "${root}/init-count.txt"
echo "bootstrap run \${count}"
`,
    'utf-8'
  )

  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: root,
        autoStartOnAppLaunch: false,
        startAdminUi: true,
        startCdpProxy: true,
        gatewayCmsProfileId: 'cms-gateway-profile'
      }
    }),
    logsDir: join(root, 'logs'),
    chromeDeps: {
      resolveCmsProfile: async () => ({
        profile: {
          id: 'cms-gateway-profile',
          nickname: '本地网关专用',
          profileDir: 'cms-gateway-profile',
          purpose: 'gateway',
          xhsLoggedIn: false,
          lastLoginCheck: null
        },
        runtime: {
          executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          userDataDir: '/tmp/chrome-cms-data'
        }
      })
    },
    healthDeps: {
      fetch: async () => ({ ok: true, status: 200 }),
      isPortListening: async () => true
    }
  })

  await manager.ensureReadyForCapability('image')
  await manager.ensureReadyForCapability('image')

  assert.equal(readFileSync(join(root, 'init-count.txt'), 'utf-8'), '1')
  assert.equal(manager.getState().overallStatus, 'services_ready')

  rmSync(root, { recursive: true, force: true })
})

test('LocalGatewayManager ensureReadyForCapability does not require CMS gateway profile for chat', async () => {
  const root = join(tmpdir(), `local-gateway-ensure-chat-${Date.now()}`)
  createConfiguredBundleRoot(root)

  const manager = new LocalGatewayManager({
    store: createStore({
      localGateway: {
        enabled: true,
        bundlePath: root,
        autoStartOnAppLaunch: false,
        startAdminUi: true,
        startCdpProxy: true,
        gatewayCmsProfileId: ''
      }
    }),
    logsDir: join(root, 'logs'),
    chromeDeps: {
      resolveCmsProfile: async () => {
        throw new Error('chat readiness should not resolve CMS gateway profile')
      }
    },
    healthDeps: {
      fetch: async (url) => {
        const normalized = String(url)
        if (normalized.includes('8766/health') || normalized.includes('4174/health')) {
          return { ok: true, status: 200 }
        }
        if (normalized.includes('4175') || normalized.includes('3456/health')) {
          return { ok: false, status: 503 }
        }
        return { ok: false, status: 500 }
      },
      isPortListening: async () => false
    }
  })

  const state = await manager.ensureReadyForCapability('chat')

  assert.equal(state.overallStatus, 'degraded')
  assert.equal(manager.getState().overallStatus, 'degraded')

  rmSync(root, { recursive: true, force: true })
})
