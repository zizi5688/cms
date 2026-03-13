export const AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS = 180_000

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
  const error =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>)
      : null

  return (
    normalizeText(data?.message) ||
    normalizeText(data?.error) ||
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
