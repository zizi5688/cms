export const AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS = 300_000

export function resolveAiStudioProviderRequestTimeoutMs(timeoutMs?: number | null): number | null {
  if (timeoutMs === null) return null
  return Math.max(
    1_000,
    Math.floor(Number(timeoutMs ?? AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS) || 0)
  )
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractRequestId(message: string): string {
  const matched = message.match(/request id:\s*([^)]+)\)?/i)
  return matched?.[1]?.trim() ?? ''
}

function extractPayloadMessage(payload: Record<string, unknown> | null | undefined): string {
  if (!payload || typeof payload !== 'object') return ''

  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : null
  const topLevelErrorMessage = normalizeText(payload.error)
  const error =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>)
      : null

  return (
    normalizeText(data?.message) ||
    normalizeText(data?.error) ||
    topLevelErrorMessage ||
    normalizeText(payload.message) ||
    normalizeText(payload.msg) ||
    normalizeText(error?.message) ||
    normalizeText(error?.msg) ||
    normalizeText(payload.rawText)
  )
}

export function normalizeAiStudioProviderFailureMessage(input: {
  statusCode?: number | null
  payload?: Record<string, unknown> | null
  fallback?: string | null
}): string | null {
  const statusCode = Number(input.statusCode ?? 0)
  const payloadMessage = extractPayloadMessage(input.payload)
  const fallback = normalizeText(input.fallback)
  const requestId = extractRequestId(payloadMessage)
  const requestIdSuffix = requestId ? `（request id: ${requestId}）` : ''
  const requestTimeoutSeconds = Math.floor(AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS / 1000)

  if (/FLOW_PROTECTION_TIMEOUT/i.test(payloadMessage)) {
    return `[AI Studio] Flow 命中风控，已在 ${requestTimeoutSeconds} 秒内尝试自动恢复，但仍未恢复，请稍后重试。`
  }

  if (/FLOW_REQUEST_TIMEOUT/i.test(payloadMessage)) {
    return `[AI Studio] Flow 在 ${requestTimeoutSeconds} 秒内未完成本次结果回收，请稍后重试。`
  }

  if (
    /Flow unusual activity protection triggered|we noticed some unusual activity|Flow rate limit protection triggered|Flow access protection triggered/i.test(
      payloadMessage
    )
  ) {
    return '[AI Studio] Flow 当前命中风控，请稍后重试。'
  }

  if (statusCode === 502 || /502\s+Bad\s+Gateway/i.test(payloadMessage)) {
    return '[AI Studio] AI 服务网关异常（502），请稍后重试。'
  }

  if (/No available channels/i.test(payloadMessage)) {
    return `[AI Studio] 当前供应商该模型通道繁忙，请稍后重试。${requestIdSuffix}`
  }

  if (payloadMessage) return payloadMessage
  return fallback || null
}

export function normalizeAiStudioProviderTransportErrorMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message.trim() : String(error ?? '').trim()
  const errorName = error instanceof Error ? error.name : ''

  if (errorName === 'AbortError' || /\b(timeout|timed out|aborted)\b/i.test(message)) {
    return '[AI Studio] AI 服务请求超时，请稍后重试。'
  }

  if (
    /\b(connection reset|socket hang up|econnreset|etimedout|eai_again|enotfound|network)\b/i.test(
      message
    )
  ) {
    return '[AI Studio] AI 服务连接异常，请稍后重试。'
  }

  return message || null
}
