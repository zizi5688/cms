import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS,
  normalizeAiStudioProviderFailureMessage,
  normalizeAiStudioProviderTransportErrorMessage,
  resolveAiStudioProviderRequestTimeoutMs
} from './aiStudioProviderErrorHelpers.ts'

test('normalizeAiStudioProviderFailureMessage rewrites 502 gateway html into a concise message', () => {
  assert.equal(
    normalizeAiStudioProviderFailureMessage({
      statusCode: 502,
      payload: {
        rawText:
          '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>'
      },
      fallback: '[AI Studio] AI 服务请求失败（HTTP 502）。'
    }),
    '[AI Studio] AI 服务网关异常（502），请稍后重试。'
  )
})

test('normalizeAiStudioProviderFailureMessage reads top-level payload.error strings', () => {
  assert.equal(
    normalizeAiStudioProviderFailureMessage({
      statusCode: 500,
      payload: {
        error: 'Gateway returned a structured top-level error.'
      },
      fallback: '[AI Studio] AI 服务请求失败。'
    }),
    'Gateway returned a structured top-level error.'
  )
})

test('normalizeAiStudioProviderFailureMessage rewrites Flow protection budget exhaustion ahead of generic 502 handling', () => {
  assert.equal(
    normalizeAiStudioProviderFailureMessage({
      statusCode: 502,
      payload: {
        error:
          'FLOW_PROTECTION_TIMEOUT: Flow unusual activity protection triggered. Automatic recovery exceeded the 300 second request budget.'
      },
      fallback: '[AI Studio] AI 服务网关异常（502），请稍后重试。'
    }),
    '[AI Studio] Flow 命中风控，已在 300 秒内尝试自动恢复，但仍未恢复，请稍后重试。'
  )
})

test('normalizeAiStudioProviderFailureMessage rewrites Flow request budget exhaustion into a user-facing timeout', () => {
  assert.equal(
    normalizeAiStudioProviderFailureMessage({
      statusCode: 500,
      payload: {
        error: 'FLOW_REQUEST_TIMEOUT: Flow high-resolution download recovery exceeded the 300 second request budget.'
      },
      fallback: '[AI Studio] AI 服务请求失败。'
    }),
    '[AI Studio] Flow 在 300 秒内未完成本次结果回收，请稍后重试。'
  )
})

test('normalizeAiStudioProviderFailureMessage rewrites channel exhaustion into a user-facing retry hint', () => {
  assert.equal(
    normalizeAiStudioProviderFailureMessage({
      statusCode: 200,
      payload: {
        message:
          'No available channels for model gemini-3.1-flash-image-preview in group foo (request id: abc123)'
      },
      fallback: '[AI Studio] AI 服务请求失败。'
    }),
    '[AI Studio] 当前供应商该模型通道繁忙，请稍后重试。（request id: abc123）'
  )
})

test('normalizeAiStudioProviderTransportErrorMessage maps aborts to request timeout', () => {
  const error = new Error('This operation was aborted')
  error.name = 'AbortError'

  assert.equal(
    normalizeAiStudioProviderTransportErrorMessage(error),
    '[AI Studio] AI 服务请求超时，请稍后重试。'
  )
})

test('normalizeAiStudioProviderTransportErrorMessage rewrites connection resets', () => {
  assert.equal(
    normalizeAiStudioProviderTransportErrorMessage(
      new Error('read tcp 1.2.3.4:1234->5.6.7.8:443: read: connection reset by peer')
    ),
    '[AI Studio] AI 服务连接异常，请稍后重试。'
  )
})

test('resolveAiStudioProviderRequestTimeoutMs uses a 300 second default for image requests and allows disabling the timeout', () => {
  assert.equal(AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS, 300_000)
  assert.equal(resolveAiStudioProviderRequestTimeoutMs(undefined), 300_000)
  assert.equal(resolveAiStudioProviderRequestTimeoutMs(null), null)
})
