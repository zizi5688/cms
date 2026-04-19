import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalGatewayProcessManager } from './localGatewayProcessManager.ts'
import { resolveLocalGatewayDedicatedChromeUserDataDir } from './localGatewayRuntime.ts'

function createConfig(root) {
  return {
    enabled: true,
    bundlePath: root,
    autoStartOnAppLaunch: false,
    startAdminUi: false,
    startCdpProxy: false,
    allowDedicatedChrome: false,
    chromeProfileDirectories: ['Profile 10', 'Profile 11'],
    prewarmImageOnLaunch: false
  }
}

test('LocalGatewayProcessManager injects gateway and cdp proxy environment for dedicated chrome routing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'local-gateway-process-env-'))
  mkdirSync(join(root, 'local-ai-gateway', 'python_adapter', '.venv', 'bin'), { recursive: true })
  mkdirSync(join(root, 'local-ai-gateway'), { recursive: true })
  mkdirSync(join(root, 'tools'), { recursive: true })

  const spawnCalls = []
  const healthChecks = new Map()

  const manager = new LocalGatewayProcessManager({
    logsDir: join(root, 'logs'),
    fetchImpl: async (url) => {
      const current = healthChecks.get(url) ?? 0
      healthChecks.set(url, current + 1)
      return { ok: current > 0 }
    },
    spawnImpl: (command, args, options) => {
      spawnCalls.push({ command, args, options })
      return {
        pid: spawnCalls.length,
        killed: false,
        stdout: new PassThrough(),
        stderr: new PassThrough()
      }
    }
  })

  await manager.ensureServices({
    ...createConfig(root),
    startCdpProxy: true
  })

  assert.equal(spawnCalls.length, 3)
  assert.equal(
    spawnCalls[0].args[1],
    '.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8766'
  )
  assert.equal(spawnCalls[0].options.env.CHROME_PROFILE_DIRECTORY, undefined)
  assert.equal(spawnCalls[1].options.env.CHROME_PROFILE_DIRECTORY, 'Profile 10')
  assert.equal(spawnCalls[2].options.env.CDP_PROXY_CHROME_PORT, '9333')
  assert.equal(
    spawnCalls[2].options.env.CDP_PROXY_CHROME_USER_DATA_DIR,
    resolveLocalGatewayDedicatedChromeUserDataDir(root)
  )
})

test('resolveLocalGatewayDedicatedChromeUserDataDir defaults outside the bundle on macOS', () => {
  if (process.platform !== 'darwin') return

  assert.equal(
    resolveLocalGatewayDedicatedChromeUserDataDir('/tmp/ignored-bundle-root'),
    join(
      homedir(),
      'Library',
      'Application Support',
      'Local AI Gateway',
      'runtime',
      'chrome-remote-debug-user-data'
    )
  )
})
