import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalGatewayProcessManager } from './localGatewayProcessManager.ts'

function createConfig(root) {
  return {
    enabled: true,
    bundlePath: root,
    autoStartOnAppLaunch: false,
    startAdminUi: false,
    startCdpProxy: false,
    allowDedicatedChrome: false,
    chromeProfileDirectory: 'Profile 10',
    prewarmImageOnLaunch: false
  }
}

test('LocalGatewayProcessManager injects CHROME_PROFILE_DIRECTORY only into the gateway child process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'local-gateway-process-env-'))
  mkdirSync(join(root, 'local-ai-gateway', 'python_adapter', '.venv', 'bin'), { recursive: true })
  mkdirSync(join(root, 'local-ai-gateway'), { recursive: true })

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

  await manager.ensureServices(createConfig(root))

  assert.equal(spawnCalls.length, 2)
  assert.equal(spawnCalls[0].options.env.CHROME_PROFILE_DIRECTORY, undefined)
  assert.equal(spawnCalls[1].options.env.CHROME_PROFILE_DIRECTORY, 'Profile 10')
})
