import type { AiTaskRequest } from './aiTaskDispatcher.ts'
import type { ResolvedAiRoute } from './aiRouter.ts'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

type ChatExecutorInput = {
  route: ResolvedAiRoute
  request: AiTaskRequest
}

type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<Record<string, unknown>>
}>

export class ChatExecutorError extends Error {
  code: string
  status: number | null

  constructor(code: string, message: string, status: number | null = null) {
    super(`${code}: ${message}`)
    this.name = 'ChatExecutorError'
    this.code = code
    this.status = status
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildProviderUrl(baseUrl: string, endpointPath: string): string {
  const normalizedBaseUrl = normalizeText(baseUrl).replace(/\/+$/, '')
  const normalizedEndpoint = normalizeText(endpointPath)
  if (!normalizedBaseUrl) {
    throw new ChatExecutorError('AI_CHAT_BASE_URL_MISSING', 'Missing provider base URL.')
  }
  if (!normalizedEndpoint) {
    throw new ChatExecutorError('AI_CHAT_ENDPOINT_MISSING', 'Missing chat endpoint path.')
  }
  if (/^https?:\/\//i.test(normalizedEndpoint)) return normalizedEndpoint
  return `${normalizedBaseUrl}${normalizedEndpoint.startsWith('/') ? normalizedEndpoint : `/${normalizedEndpoint}`}`
}

function normalizeMessage(value: unknown): ChatMessage | null {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const role = normalizeText(record.role)
  const content = normalizeText(record.content)
  if (!content) return null
  if (role === 'system' || role === 'assistant' || role === 'tool') {
    return { role, content }
  }
  return { role: 'user', content }
}

function resolveMessages(input: unknown): ChatMessage[] {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message))
    : []
  if (messages.length > 0) return messages

  const prompt = normalizeText(record.prompt)
  if (prompt) {
    return [{ role: 'user', content: prompt }]
  }

  throw new ChatExecutorError('AI_CHAT_INPUT_INVALID', 'Chat input requires messages[] or prompt.')
}

function pickNumeric(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function createChatCompletionPayload(
  route: ResolvedAiRoute,
  request: AiTaskRequest
): Record<string, unknown> {
  if (route.protocol !== 'openai') {
    throw new ChatExecutorError(
      'AI_CHAT_PROTOCOL_UNSUPPORTED',
      `Protocol ${route.protocol} is not supported in MVP chat direct mode.`
    )
  }

  const input = request.input && typeof request.input === 'object' ? (request.input as Record<string, unknown>) : {}
  return {
    model: route.modelName,
    messages: resolveMessages(input),
    ...(pickNumeric(input, 'temperature') !== undefined
      ? { temperature: pickNumeric(input, 'temperature') }
      : {}),
    ...(pickNumeric(input, 'maxTokens') !== undefined
      ? { max_tokens: pickNumeric(input, 'maxTokens') }
      : {}),
    ...(typeof input.stream === 'boolean' ? { stream: input.stream } : {})
  }
}

function extractAssistantText(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice =
    choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>) : {}
  const message =
    firstChoice.message && typeof firstChoice.message === 'object'
      ? (firstChoice.message as Record<string, unknown>)
      : {}
  const content = message.content

  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        const part = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
        return typeof part.text === 'string' ? part.text.trim() : ''
      })
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }

  throw new ChatExecutorError(
    'AI_CHAT_RESPONSE_INVALID',
    'Provider response did not contain assistant text.'
  )
}

export async function executeChatTask(
  input: ChatExecutorInput,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<{
  mode: 'direct'
  capability: 'chat'
  route: ResolvedAiRoute
  outputText: string
  response: Record<string, unknown>
}> {
  const payload = createChatCompletionPayload(input.route, input.request)
  const requestUrl = buildProviderUrl(input.route.baseUrl, input.route.endpointPath)
  const response = await fetchImpl(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${input.route.apiKey}`
    },
    body: JSON.stringify(payload)
  })
  const body = await response.json()

  if (!response.ok) {
    const message =
      normalizeText((body.error as Record<string, unknown> | undefined)?.message) ||
      normalizeText(body.message) ||
      `Provider returned HTTP ${response.status}.`
    throw new ChatExecutorError('AI_CHAT_REQUEST_FAILED', message, response.status)
  }

  return {
    mode: 'direct',
    capability: 'chat',
    route: input.route,
    outputText: extractAssistantText(body),
    response: body
  }
}
