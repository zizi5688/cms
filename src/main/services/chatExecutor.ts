import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import type { AiTaskRequest } from './aiTaskDispatcher.ts'
import type { ResolvedAiRoute } from './aiRouter.ts'
import { prepareGeminiInlineImageFromPath } from './aiStudioGeminiInlineImageHelpers.ts'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

type ChatMessageContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
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

function getErrorLikeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function isLoopbackRequestUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '0.0.0.0' ||
      url.hostname === '::1' ||
      url.hostname === '[::1]'
    )
  } catch {
    return /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|::1)(?::\d+)?(?:\/|$)/i.test(
      normalizeText(value)
    )
  }
}

function describeNetworkFailure(error: unknown): string {
  const record = getErrorLikeRecord(error)
  const cause = getErrorLikeRecord(record.cause)
  const details = [
    normalizeText(record.message),
    normalizeText(cause.message),
    normalizeText(cause.code),
    normalizeText(cause.errno),
    normalizeText(cause.address),
    cause.port !== undefined && cause.port !== null ? String(cause.port) : ''
  ].filter(Boolean)

  return Array.from(new Set(details)).join(' | ')
}

function createFetchFailureMessage(requestUrl: string, error: unknown): string {
  const endpointLabel = isLoopbackRequestUrl(requestUrl) ? '本地网关' : 'AI 提供方'
  const guidance = isLoopbackRequestUrl(requestUrl)
    ? '请检查本地网关是否仍在运行，并确认相关端口可访问。'
    : '请检查供应商地址、网络连接或代理配置。'
  const detail = describeNetworkFailure(error)

  return `${endpointLabel}请求失败：${requestUrl}。${guidance}${detail ? ` 底层错误：${detail}` : ''}`
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

function parseDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = normalizeText(value).match(/^data:([^;,]+)?;base64,(.+)$/i)
  if (!match) return null
  return {
    mimeType: normalizeText(match[1]) || 'image/jpeg',
    data: normalizeText(match[2])
  }
}

function inferMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace('.', '')
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'avif') return 'image/avif'
  return 'image/jpeg'
}

async function filePathToDataUrl(filePath: string): Promise<string> {
  const normalized = normalizeText(filePath)
  if (!normalized) throw new ChatExecutorError('AI_CHAT_IMAGE_INVALID', 'Image path is empty.')
  const buffer = await readFile(normalized)
  if (!buffer || buffer.length <= 0) {
    throw new ChatExecutorError('AI_CHAT_IMAGE_INVALID', `Image is empty: ${basename(normalized)}`)
  }
  return `data:${inferMimeType(normalized)};base64,${buffer.toString('base64')}`
}

function resolveImageUrls(input: unknown): string[] {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  return Array.isArray(record.imageUrls)
    ? record.imageUrls.map((item) => normalizeText(item)).filter(Boolean)
    : []
}

async function normalizeChatRequestInput(
  route: ResolvedAiRoute,
  request: AiTaskRequest
): Promise<AiTaskRequest> {
  const input = request.input && typeof request.input === 'object' ? (request.input as Record<string, unknown>) : {}
  const imagePaths = Array.isArray(input.imagePaths)
    ? input.imagePaths.map((item) => normalizeText(item)).filter(Boolean)
    : []

  if (imagePaths.length === 0) return request

  const imageUrls = await Promise.all(
    imagePaths.map((filePath) =>
      isGeminiGenerateContentRoute(route)
        ? prepareGeminiInlineImageFromPath(filePath).then((result) => result.dataUrl)
        : filePathToDataUrl(filePath)
    )
  )

  return {
    ...request,
    input: {
      ...input,
      imageUrls: [...resolveImageUrls(input), ...imageUrls]
    }
  }
}

function buildOpenAiMessageContent(
  message: ChatMessage,
  imageUrls: string[],
  attachImages: boolean
): string | ChatMessageContentPart[] {
  if (!attachImages || imageUrls.length === 0) return message.content
  return [
    { type: 'text', text: message.content },
    ...imageUrls.map((url) => ({
      type: 'image_url' as const,
      image_url: { url }
    }))
  ]
}

function pickNumeric(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isGeminiGenerateContentRoute(route: ResolvedAiRoute): boolean {
  return /:generatecontent(?:$|[?#])/i.test(normalizeText(route.endpointPath))
}

function createOpenAiChatPayload(route: ResolvedAiRoute, request: AiTaskRequest): Record<string, unknown> {
  const input = request.input && typeof request.input === 'object' ? (request.input as Record<string, unknown>) : {}
  const imageUrls = resolveImageUrls(input)
  let attachedImageCount = 0
  return {
    model: route.modelName,
    messages: resolveMessages(input).map((message) => {
      const shouldAttachImages = message.role === 'user' && attachedImageCount === 0 && imageUrls.length > 0
      if (shouldAttachImages) attachedImageCount += 1
      return {
        role: message.role,
        content: buildOpenAiMessageContent(message, imageUrls, shouldAttachImages)
      }
    }),
    ...(pickNumeric(input, 'temperature') !== undefined
      ? { temperature: pickNumeric(input, 'temperature') }
      : {}),
    ...(pickNumeric(input, 'maxTokens') !== undefined
      ? { max_tokens: pickNumeric(input, 'maxTokens') }
      : {}),
    ...(typeof input.stream === 'boolean' ? { stream: input.stream } : {})
  }
}

function createGeminiChatPayload(request: AiTaskRequest): Record<string, unknown> {
  const imageUrls = resolveImageUrls(request.input)
  let attachedImageCount = 0
  return {
    contents: resolveMessages(request.input).map((message) => {
      const shouldAttachImages =
        message.role === 'user' && attachedImageCount === 0 && imageUrls.length > 0
      if (shouldAttachImages) attachedImageCount += 1
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: shouldAttachImages
          ? [
              ...imageUrls
                .map((url) => parseDataUrl(url))
                .filter((item): item is { mimeType: string; data: string } => Boolean(item))
                .map((item) => ({
                  inlineData: {
                    mimeType: item.mimeType,
                    data: item.data
                  }
                })),
              { text: message.content }
            ]
          : [{ text: message.content }]
      }
    })
  }
}

export function createChatCompletionPayload(
  route: ResolvedAiRoute,
  request: AiTaskRequest
): Record<string, unknown> {
  if (route.protocol === 'openai' && !isGeminiGenerateContentRoute(route)) {
    return createOpenAiChatPayload(route, request)
  }
  if (route.protocol === 'google-genai' || isGeminiGenerateContentRoute(route)) {
    return createGeminiChatPayload(request)
  }
  throw new ChatExecutorError(
    'AI_CHAT_PROTOCOL_UNSUPPORTED',
    `Protocol ${route.protocol} is not supported in MVP chat direct mode.`
  )
}

function extractOpenAiAssistantText(payload: Record<string, unknown>): string {
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

function extractGeminiAssistantText(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  const firstCandidate =
    candidates[0] && typeof candidates[0] === 'object'
      ? (candidates[0] as Record<string, unknown>)
      : {}
  const content =
    firstCandidate.content && typeof firstCandidate.content === 'object'
      ? (firstCandidate.content as Record<string, unknown>)
      : {}
  const parts = Array.isArray(content.parts) ? content.parts : []
  const text = parts
    .map((item) => {
      const part = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      return typeof part.text === 'string' ? part.text.trim() : ''
    })
    .filter(Boolean)
    .join('\n\n')

  if (text) return text

  throw new ChatExecutorError(
    'AI_CHAT_RESPONSE_INVALID',
    'Provider response did not contain Gemini text parts.'
  )
}

function extractAssistantText(route: ResolvedAiRoute, payload: Record<string, unknown>): string {
  if (route.protocol === 'google-genai' || isGeminiGenerateContentRoute(route)) {
    return extractGeminiAssistantText(payload)
  }
  return extractOpenAiAssistantText(payload)
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
  const normalizedRequest = await normalizeChatRequestInput(input.route, input.request)
  const payload = createChatCompletionPayload(input.route, normalizedRequest)
  const requestUrl = buildProviderUrl(input.route.baseUrl, input.route.endpointPath)
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchImpl(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${input.route.apiKey}`
      },
      body: JSON.stringify(payload)
    })
  } catch (error) {
    throw new ChatExecutorError('AI_CHAT_NETWORK_ERROR', createFetchFailureMessage(requestUrl, error))
  }

  let body: Record<string, unknown>
  try {
    body = await response.json()
  } catch (error) {
    const detail = describeNetworkFailure(error)
    throw new ChatExecutorError(
      'AI_CHAT_RESPONSE_INVALID',
      `提供方响应解析失败：${requestUrl}${detail ? `。底层错误：${detail}` : ''}`,
      response.status
    )
  }

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
    outputText: extractAssistantText(input.route, body),
    response: body
  }
}
