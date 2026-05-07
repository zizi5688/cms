#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import net from 'node:net'

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 4174)
const CDP_PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 3456)
const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222)
const FLOW_PROJECT_URL_PATTERN = process.env.FLOW_PROJECT_URL_PATTERN || 'flow'
const HEALTH_LOG_MARKER = '[LocalGateway] Flow fetch hook missing during health poll; re-injected via CDP.'
const LOG_FILE = process.env.HEALTH_RECOVERY_LOG_FILE || ''

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function failPreflight(message) {
  console.error(message)
  process.exit(1)
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 1500)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.setTimeout(5000, () => {
      request.destroy(new Error('HTTP request timed out'))
    })
    request.on('error', reject)
  })
}

function createUrlMatcher(patternText) {
  if (!patternText.trim()) {
    return (url) => url.includes('flow')
  }
  try {
    const pattern = new RegExp(patternText, 'i')
    return (url) => pattern.test(url)
  } catch {
    const needle = patternText.toLowerCase()
    return (url) => url.toLowerCase().includes(needle)
  }
}

function resolveLogCandidates() {
  const candidates = []
  if (LOG_FILE) {
    candidates.push(LOG_FILE)
  }

  const userDataLogs = join(homedir(), 'Library', 'Application Support', 'super-cms', 'logs', 'local-gateway')
  candidates.push(join(userDataLogs, 'health-recovery.log'))
  candidates.push(join(userDataLogs, 'gateway.log'))
  candidates.push(join(userDataLogs, 'cdpProxy.log'))

  return [...new Set(candidates)]
}

function createLogWatcher(marker) {
  const candidates = resolveLogCandidates()
  const baselines = new Map()

  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue
      baselines.set(filePath, statSync(filePath).size)
    } catch {
      continue
    }
  }

  return {
    candidates,
    hasMarker() {
      for (const filePath of candidates) {
        try {
          if (!existsSync(filePath)) continue
          const start = baselines.get(filePath) ?? 0
          const content = readFileSync(filePath, 'utf8').slice(start)
          if (content.includes(marker)) {
            return true
          }
        } catch {
          continue
        }
      }
      return false
    }
  }
}

class CdpClient {
  constructor(webSocketDebuggerUrl) {
    this.webSocketDebuggerUrl = webSocketDebuggerUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.waiters = new Map()
  }

  async connect() {
    const WebSocketImpl = globalThis.WebSocket ?? (await import('ws')).default
    this.ws = new WebSocketImpl(this.webSocketDebuggerUrl)

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.ws.removeEventListener?.('open', onOpen)
        this.ws.removeEventListener?.('error', onError)
        this.ws.off?.('open', onOpen)
        this.ws.off?.('error', onError)
      }
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (event) => {
        cleanup()
        reject(new Error(event?.message || event?.error?.message || 'WebSocket connect failed'))
      }
      this.ws.addEventListener?.('open', onOpen)
      this.ws.addEventListener?.('error', onError)
      this.ws.on?.('open', onOpen)
      this.ws.on?.('error', onError)
    })

    const onMessage = (event) => {
      const raw = typeof event === 'string' ? event : event?.data ?? event
      const text = typeof raw === 'string' ? raw : raw.toString()
      const message = JSON.parse(text)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id)
        clearTimeout(timer)
        this.pending.delete(message.id)
        if (message.error) {
          reject(new Error(message.error.message || JSON.stringify(message.error)))
        } else {
          resolve(message.result ?? {})
        }
        return
      }
      if (message.method && this.waiters.has(message.method)) {
        const listeners = this.waiters.get(message.method)
        this.waiters.delete(message.method)
        for (const listener of listeners) {
          listener(message.params ?? {})
        }
      }
    }

    this.ws.addEventListener?.('message', onMessage)
    this.ws.on?.('message', onMessage)
    await this.send('Page.enable').catch(() => undefined)
    await this.send('Runtime.enable').catch(() => undefined)
  }

  send(method, params = {}, timeoutMs = 10000) {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(payload)
    })
  }

  waitForEvent(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const listeners = this.waiters.get(method) ?? []
        this.waiters.set(
          method,
          listeners.filter((listener) => listener !== onEvent)
        )
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      const onEvent = (params) => {
        clearTimeout(timer)
        resolve(params)
      }
      const listeners = this.waiters.get(method) ?? []
      listeners.push(onEvent)
      this.waiters.set(method, listeners)
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed')
    }
    return result.result?.value
  }

  async navigate(url) {
    const loadPromise = this.waitForEvent('Page.loadEventFired', 20000).catch(() => null)
    await this.send('Page.navigate', { url })
    await loadPromise
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      void 0
    }
  }
}

async function findFlowProjectTarget() {
  const targets = await httpJson(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json`)
  const matchUrl = createUrlMatcher(FLOW_PROJECT_URL_PATTERN)
  const pages = Array.isArray(targets) ? targets.filter((target) => target.type === 'page') : []
  return [...pages].reverse().find((target) => matchUrl(String(target.url || ''))) ?? null
}

async function waitForHookActive(client, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const active = await client
      .evaluate('Boolean(window.fetch && window.fetch.__flowHookActive === true)')
      .catch(() => false)
    if (active === true) {
      return Math.ceil((Date.now() - startedAt) / 1000)
    }
    await sleep(5000)
  }
  return null
}

async function clearHookMarkers(client) {
  await client.evaluate(`(() => {
    if (window.fetch) window.fetch.__flowHookActive = undefined;
    window.__LOCAL_AI_FLOW_ORIGINAL_FETCH = undefined;
    return true;
  })()`)
}

async function runHookRecoveryTest(client) {
  await sleep(5000)
  await clearHookMarkers(client)
  const elapsed = await waitForHookActive(client, 60000)
  return elapsed == null
    ? { ok: false, line: '[FAIL] hook 丢失自动恢复' }
    : { ok: true, line: `[PASS] hook 丢失自动恢复 (恢复耗时: ${elapsed}s)` }
}

async function runNavigationRecoveryTest(client, flowUrl) {
  await sleep(5000)
  await client.navigate('about:blank')
  await sleep(5000)
  await client.navigate(flowUrl)
  const elapsed = await waitForHookActive(client, 90000)
  return elapsed == null
    ? { ok: false, line: '[FAIL] 页面导航恢复' }
    : { ok: true, line: `[PASS] 页面导航恢复 (恢复耗时: ${elapsed}s)` }
}

async function main() {
  const [gatewayOk, cdpProxyOk, chromeOk] = await Promise.all([
    isPortListening(GATEWAY_PORT),
    isPortListening(CDP_PROXY_PORT),
    isPortListening(CHROME_DEBUG_PORT)
  ])

  if (!gatewayOk || !cdpProxyOk || !chromeOk) {
    failPreflight('请先启动网关')
  }

  const target = await findFlowProjectTarget().catch(() => null)
  if (!target?.webSocketDebuggerUrl || !target?.url) {
    failPreflight('请先打开 Flow 项目页')
  }

  const client = new CdpClient(target.webSocketDebuggerUrl)
  const logWatcher = createLogWatcher(HEALTH_LOG_MARKER)
  const results = []

  try {
    await client.connect()

    results.push(await runHookRecoveryTest(client))
    results.push(await runNavigationRecoveryTest(client, target.url))

    await sleep(5000)
    const finalHookElapsed = await waitForHookActive(client, 90000)
    if (finalHookElapsed == null) {
      results.push({ ok: false, line: '[FAIL] 脚本结束前未能恢复 Flow hook' })
    }

    results.push(
      logWatcher.hasMarker()
        ? { ok: true, line: '[PASS] 日志包含 hook 重注入记录' }
        : {
            ok: false,
            line: `[FAIL] 日志包含 hook 重注入记录 (未在候选日志中找到，候选: ${logWatcher.candidates.join(', ')})`
          }
    )
  } finally {
    await client.navigate(target.url).catch(() => undefined)
    await waitForHookActive(client, 90000).catch(() => undefined)
    client.close()
  }

  for (const result of results) {
    console.log(result.line)
  }

  if (results.some((result) => !result.ok)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
