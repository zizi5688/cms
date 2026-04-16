import type {
  LocalGatewayCapabilityCheck,
  LocalGatewayCapabilityChecks
} from '../../shared/localGatewayTypes.ts'

const LOCAL_GATEWAY_PUBLIC_BASE_URL = 'http://127.0.0.1:4174'
const LOCAL_GATEWAY_PUBLIC_API_KEY = 'local-dev-secret'
const DEFAULT_CHAT_PROBE_PROMPT = 'Reply with exactly OK.'
const DEFAULT_IMAGE_PROBE_PROMPT = 'Create a simple flat poster with one geometric shape.'

function createUnknownCapabilityCheck(message: string): LocalGatewayCapabilityCheck {
  return {
    status: 'unknown',
    ok: false,
    checkedAt: null,
    message
  }
}

function buildFailedCapabilityCheck(message: string): LocalGatewayCapabilityCheck {
  return {
    status: 'failing',
    ok: false,
    checkedAt: Date.now(),
    message: message.trim() || '真实请求失败。'
  }
}

function buildPassingCapabilityCheck(): LocalGatewayCapabilityCheck {
  return {
    status: 'passing',
    ok: true,
    checkedAt: Date.now(),
    message: null
  }
}

async function readJsonPayload(response: {
  json?: () => Promise<unknown>
}): Promise<Record<string, unknown>> {
  if (typeof response.json !== 'function') return {}
  const payload = await response.json().catch(() => ({}))
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
}

function extractGatewayErrorMessage(payload: Record<string, unknown>, status: number): string {
  const error = typeof payload.error === 'string' ? payload.error.trim() : ''
  if (error) return error
  return `HTTP ${status}`
}

function hasGeminiTextCandidate(payload: Record<string, unknown>): boolean {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  return candidates.some((candidate) => {
    const content =
      candidate && typeof candidate === 'object'
        ? (candidate as { content?: { parts?: Array<{ text?: unknown }> } }).content
        : null
    const parts = Array.isArray(content?.parts) ? content.parts : []
    return parts.some((part) => typeof part?.text === 'string' && part.text.trim().length > 0)
  })
}

function hasGeminiInlineImageCandidate(payload: Record<string, unknown>): boolean {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  return candidates.some((candidate) => {
    const content =
      candidate && typeof candidate === 'object'
        ? (candidate as { content?: { parts?: Array<{ inlineData?: { data?: unknown } }> } }).content
        : null
    const parts = Array.isArray(content?.parts) ? content.parts : []
    return parts.some(
      (part) =>
        part?.inlineData &&
        typeof part.inlineData === 'object' &&
        typeof part.inlineData.data === 'string' &&
        part.inlineData.data.trim().length > 0
    )
  })
}

async function runGatewayCapabilityProbe(input: {
  fetch: typeof fetch
  path: string
  prompt: string
  failureMessage: string
  isSuccessPayload: (payload: Record<string, unknown>) => boolean
}): Promise<LocalGatewayCapabilityCheck> {
  try {
    const response = await input.fetch(`${LOCAL_GATEWAY_PUBLIC_BASE_URL}${input.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOCAL_GATEWAY_PUBLIC_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: input.prompt }]
          }
        ]
      })
    })
    const payload = await readJsonPayload(response)
    if (!response.ok) {
      return buildFailedCapabilityCheck(extractGatewayErrorMessage(payload, response.status))
    }
    if (!input.isSuccessPayload(payload)) {
      return buildFailedCapabilityCheck(input.failureMessage)
    }
    return buildPassingCapabilityCheck()
  } catch (error) {
    return buildFailedCapabilityCheck(error instanceof Error ? error.message : String(error))
  }
}

export function createDefaultLocalGatewayCapabilityChecks(): LocalGatewayCapabilityChecks {
  return {
    chat: createUnknownCapabilityCheck('尚未完成真实聊天探测。'),
    image: createUnknownCapabilityCheck('尚未完成真实生图探测。')
  }
}

export async function probeLocalGatewayChatCapability(input: {
  fetch: typeof fetch
}): Promise<LocalGatewayCapabilityCheck> {
  return runGatewayCapabilityProbe({
    fetch: input.fetch,
    path: '/v1beta/models/gemini-web-chat:generateContent',
    prompt: DEFAULT_CHAT_PROBE_PROMPT,
    failureMessage: '真实聊天请求未返回文本。',
    isSuccessPayload: hasGeminiTextCandidate
  })
}

export async function probeLocalGatewayImageCapability(input: {
  fetch: typeof fetch
}): Promise<LocalGatewayCapabilityCheck> {
  return runGatewayCapabilityProbe({
    fetch: input.fetch,
    path: '/v1beta/models/flow-web-image:generateContent',
    prompt: DEFAULT_IMAGE_PROBE_PROMPT,
    failureMessage: '真实生图请求未返回图片数据。',
    isSuccessPayload: hasGeminiInlineImageCandidate
  })
}
