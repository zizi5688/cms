import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { basename, extname, join, resolve } from 'path'

import ffmpeg from 'fluent-ffmpeg'
import ffprobeStaticImport from 'ffprobe-static'

import { prepareGeminiInlineImageFromPath } from './aiStudioGeminiInlineImageHelpers'
import {
  AI_STUDIO_FLOW_TASK_POLL_PATH,
  AI_STUDIO_FLOW_TASK_SUBMIT_PATH,
  buildAiStudioAsyncFlowSubmitPayload,
  isAiStudioAsyncFlowRoute,
  normalizeAiStudioAsyncFlowTaskPayload
} from './aiStudioFlowTaskHelpers'
import {
  AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS,
  normalizeAiStudioProviderFailureMessage,
  normalizeAiStudioProviderTransportErrorMessage,
  resolveAiStudioProviderRequestTimeoutMs
} from './aiStudioProviderErrorHelpers'
import { readWorkflowSourceDescriptor } from './aiStudioWorkflowSourceHelpers'
import { resolveAiStudioProviderConfig } from './aiStudioProviderConfigHelpers'
import {
  buildSeedanceVideoTaskPayload,
  buildGeminiGenerationConfig,
  buildImageGenerationDirectiveLines,
  isGeminiGenerateContentPath,
  isSeedanceVideoModel as isSeedanceRequestModel,
  resolveImageSizeForModel
} from './aiStudioRequestPayloadHelpers'
import { SqliteService } from './sqliteService'

export type AiStudioTemplateRecord = {
  id: string
  provider: string
  capability: 'image' | 'video' | 'chat'
  name: string
  promptText: string
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type AiStudioTaskStatus = 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'archived'
export type AiStudioBilledState = 'unbilled' | 'billable' | 'not_billable' | 'settled'

export type AiStudioTaskRecord = {
  id: string
  templateId: string | null
  provider: string
  sourceFolderPath: string | null
  productName: string
  status: AiStudioTaskStatus
  aspectRatio: string
  outputCount: number
  model: string
  promptExtra: string
  primaryImagePath: string | null
  referenceImagePaths: string[]
  inputImagePaths: string[]
  remoteTaskId: string | null
  latestRunId: string | null
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
  billedState: AiStudioBilledState
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type AiStudioAssetKind = 'input' | 'output'

export type AiStudioAssetRecord = {
  id: string
  taskId: string
  runId: string | null
  kind: AiStudioAssetKind
  role: string
  filePath: string
  previewPath: string | null
  originPath: string | null
  selected: boolean
  sortOrder: number
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type AiStudioRunRecord = {
  id: string
  taskId: string
  runIndex: number
  provider: string
  status: string
  remoteTaskId: string | null
  billedState: AiStudioBilledState
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
  runDir: string | null
  requestPayload: Record<string, unknown>
  responsePayload: Record<string, unknown>
  errorMessage: string | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

export type AiStudioAssetWriteInput = {
  id?: string
  taskId: string
  runId?: string | null
  kind?: AiStudioAssetKind
  role?: string
  filePath: string
  previewPath?: string | null
  originPath?: string | null
  selected?: boolean
  sortOrder?: number
  metadata?: Record<string, unknown>
}

export type AiStudioTaskCreateInput = {
  id?: string
  templateId?: string | null
  provider?: string
  sourceFolderPath?: string | null
  productName?: string
  status?: AiStudioTaskStatus
  aspectRatio?: string
  outputCount?: number
  model?: string
  promptExtra?: string
  primaryImagePath?: string | null
  referenceImagePaths?: string[]
  inputImagePaths?: string[]
  remoteTaskId?: string | null
  latestRunId?: string | null
  priceMinSnapshot?: number | null
  priceMaxSnapshot?: number | null
  billedState?: AiStudioBilledState
  metadata?: Record<string, unknown>
  assets?: AiStudioAssetWriteInput[]
}

export type AiStudioTaskUpdateInput = Partial<Omit<AiStudioTaskCreateInput, 'assets' | 'id'>>

export type AiStudioRunWriteInput = {
  runId?: string
  taskId: string
  provider?: string
  status?: string
  remoteTaskId?: string | null
  billedState?: AiStudioBilledState
  priceMinSnapshot?: number | null
  priceMaxSnapshot?: number | null
  requestPayload?: Record<string, unknown>
  responsePayload?: Record<string, unknown>
  errorMessage?: string | null
  startedAt?: number | null
  finishedAt?: number | null
}

export type AiStudioProviderConnectionResult = {
  success: boolean
  provider: string
  baseUrl: string
  model: string
  endpointPath: string
  checkedAt: number
  statusCode: number | null
  message: string
}

export type AiStudioRunExecutionResult = {
  task: AiStudioTaskRecord
  run: AiStudioRunRecord
  outputs: AiStudioAssetRecord[]
  completed: boolean
  status: string
  remoteTaskId: string | null
  billedState: AiStudioBilledState
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
}

type AiStudioProviderConfig = {
  provider: string
  baseUrl: string
  apiKey: string
  defaultImageModel: string
  endpointPath: string
  providerProfiles?: unknown
}

type DbConnection = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown
    get: (...args: unknown[]) => Record<string, unknown> | undefined
    all: (...args: unknown[]) => Array<Record<string, unknown>>
  }
  transaction: <T extends (...args: unknown[]) => unknown>(fn: T) => T
}

type AiStudioResolvedProjectContext = {
  projectId: string
  projectRootTaskId: string
  projectName: string
  projectPath: string | null
}

export type AiStudioProjectDeletionPlan = AiStudioResolvedProjectContext & {
  taskIds: string[]
}

function resolveStaticModule<T>(value: T): T {
  const maybe = value as unknown as { default?: T }
  return (
    maybe && typeof maybe === 'object' && 'default' in maybe && maybe.default
      ? maybe.default
      : value
  ) as T
}

function normalizePackagedBinaryPath(binaryPath: string): string {
  const normalized = String(binaryPath ?? '').trim()
  if (!normalized) return ''
  if (!app.isPackaged) return normalized
  return normalized.includes('app.asar')
    ? normalized.replace('app.asar', 'app.asar.unpacked')
    : normalized
}

function resolveFfprobePath(): string {
  const ffprobeStatic = resolveStaticModule(
    ffprobeStaticImport as unknown as { path?: string } | null
  )
  const raw = ffprobeStatic && typeof ffprobeStatic.path === 'string' ? ffprobeStatic.path : ''
  const resolved = normalizePackagedBinaryPath(raw)
  if (!resolved) throw new Error('[AI Studio] ffprobe-static path not found for current platform.')
  return resolved
}

let didConfigureVideoProbe = false

function ensureVideoProbeConfigured(): void {
  if (didConfigureVideoProbe) return
  ffmpeg.setFfprobePath(resolveFfprobePath())
  didConfigureVideoProbe = true
}

function normalizeVideoResolutionRequest(value: unknown): '720p' | '1080p' {
  const normalized = normalizeText(value).toLowerCase()
  return normalized === '1080p' ? '1080p' : '720p'
}

function toAllApiVideoSize(value: unknown): '720P' | '1080P' {
  return normalizeVideoResolutionRequest(value) === '1080p' ? '1080P' : '720P'
}

function buildVideoResolutionLabel(width: number, height: number): string {
  const shortEdge = Math.min(Math.abs(Math.floor(width)), Math.abs(Math.floor(height)))
  if (!Number.isFinite(shortEdge) || shortEdge <= 0) return ''
  if (shortEdge >= 2160) return '4K'
  if (shortEdge >= 1440) return '2K'
  if (shortEdge >= 1080) return '1080p'
  if (shortEdge >= 720) return '720p'
  return `${shortEdge}p`
}

function parseVideoSizeText(
  value: unknown
): { width: number; height: number; sizeText: string; resolutionLabel: string } | null {
  const normalized = normalizeText(value)
  if (!normalized) return null
  const matched = normalized.match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i)
  if (!matched) return null
  const width = Number.parseInt(matched[1] ?? '', 10)
  const height = Number.parseInt(matched[2] ?? '', 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return {
    width,
    height,
    sizeText: `${width}x${height}`,
    resolutionLabel: buildVideoResolutionLabel(width, height)
  }
}

async function probeVideoOutputResolution(
  filePath: string
): Promise<{ width: number; height: number; sizeText: string; resolutionLabel: string } | null> {
  const normalizedPath = normalizeText(filePath)
  if (!normalizedPath) return null
  ensureVideoProbeConfigured()
  return await new Promise((resolve) => {
    ffmpeg.ffprobe(normalizedPath, (error, metadata) => {
      if (error || !metadata) {
        resolve(null)
        return
      }
      const streams = Array.isArray(metadata.streams)
        ? (metadata.streams as Array<{ codec_type?: unknown; width?: unknown; height?: unknown }>)
        : []
      const videoStream = streams.find((stream) => stream.codec_type === 'video')
      const width = Number(videoStream?.width ?? 0)
      const height = Number(videoStream?.height ?? 0)
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        resolve(null)
        return
      }
      resolve({
        width,
        height,
        sizeText: `${width}x${height}`,
        resolutionLabel: buildVideoResolutionLabel(width, height)
      })
    })
  })
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value)
  return normalized || null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)))
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeStringArray(value)
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    return normalizeStringArray(parsed)
  } catch {
    return []
  }
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

function toJsonArray(value: unknown): string {
  return JSON.stringify(normalizeStringArray(value))
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.floor(parsed))
}

function normalizeNullableNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTaskStatus(value: unknown): AiStudioTaskStatus {
  const normalized = normalizeText(value)
  if (
    normalized === 'draft' ||
    normalized === 'ready' ||
    normalized === 'running' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'archived'
  ) {
    return normalized
  }
  return 'draft'
}

function normalizeBilledState(value: unknown): AiStudioBilledState {
  const normalized = normalizeText(value)
  if (
    normalized === 'unbilled' ||
    normalized === 'billable' ||
    normalized === 'not_billable' ||
    normalized === 'settled'
  ) {
    return normalized
  }
  return 'unbilled'
}

const GRSAI_DEFAULT_BASE_URL = 'https://grsaiapi.com'
const GRSAI_DRAW_PATH = '/v1/draw/nano-banana'
const GRSAI_RESULT_PATH = '/v1/draw/result'
const AI_VIDEO_CREATE_PATH = '/v1/video/create'
const AI_VIDEO_QUERY_PATH = '/v1/video/query'
const GRSAI_POLL_WEBHOOK_SENTINEL = '-1'
const DEFAULT_IMAGE_MODEL = 'nano-banana-fast'
const LEGACY_DEFAULT_IMAGE_MODEL = 'image-default'
const DEFAULT_ADD_WATERMARK = false
const CONNECTION_TEST_ID = '__codex_connection_test__'
const AI_STUDIO_VIDEO_DEBUG_MARKER = 'temp-video-debug-2026-03-12'
const AI_STUDIO_VIDEO_DEBUG_FILE_NAME = 'ai-studio-video-debug.jsonl'
const AI_STUDIO_IMAGE_DEBUG_MARKER = 'temp-image-debug-2026-03-13'
const AI_STUDIO_IMAGE_DEBUG_FILE_NAME = 'ai-studio-image-debug.jsonl'
const HTTP_IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
const HTTP_VIDEO_ACCEPT = 'video/mp4,video/webm,video/*,*/*;q=0.8'
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const GRSAI_PRICE_FALLBACKS: Record<string, { min: number; max: number }> = {
  'nano-banana-fast': { min: 0.022, max: 0.044 },
  'nano-banana': { min: 0.04, max: 0.08 },
  'nano-banana-pro': { min: 0.08, max: 0.16 },
  'gemini-2.5-flash-image-preview': { min: 0.022, max: 0.044 },
  'image-default': { min: 0.022, max: 0.044 }
}

function normalizeVideoCreateAspectRatio(
  model: string,
  aspectRatio: string
): '16:9' | '9:16' | null {
  const normalizedModel = normalizeText(model).toLowerCase()
  const normalizedAspectRatio = normalizeText(aspectRatio)
  if (normalizedAspectRatio !== '16:9' && normalizedAspectRatio !== '9:16') return null
  return normalizedModel.startsWith('veo3') ? normalizedAspectRatio : null
}

function resolveSeedanceVideoRatio(aspectRatio: string): 'adaptive' | '16:9' | '9:16' | '1:1' {
  const normalizedAspectRatio = normalizeText(aspectRatio)
  if (
    normalizedAspectRatio === 'adaptive' ||
    normalizedAspectRatio === '16:9' ||
    normalizedAspectRatio === '9:16' ||
    normalizedAspectRatio === '1:1'
  ) {
    return normalizedAspectRatio
  }
  return 'adaptive'
}

function normalizeVideoCreateInputPaths(model: string, inputPaths: string[]): string[] {
  const normalizedModel = normalizeText(model).toLowerCase()

  if (normalizedModel.includes('veo3-pro-frames') && inputPaths.length > 1) {
    throw new Error('[AI Studio] 当前模型仅支持上传 1 张首帧图片。')
  }

  if (normalizedModel.includes('frames') && inputPaths.length > 2) {
    throw new Error('[AI Studio] 当前首尾帧模型最多支持 2 张图片。')
  }

  if (normalizedModel.includes('components') && inputPaths.length > 3) {
    throw new Error('[AI Studio] 当前参考图模型最多支持 3 张图片。')
  }

  return inputPaths
}

function isVideoCreatePath(apiPath: string): boolean {
  const normalized = normalizeText(apiPath).toLowerCase()
  return (
    /(?:^|\/)v1\/video\/create(?:$|\?)/.test(normalized) ||
    /(?:^|\/)video\/create(?:$|\?)/.test(normalized)
  )
}

function isVolcContentGenerationTasksPath(apiPath: string): boolean {
  const normalized = normalizeText(apiPath).toLowerCase()
  return (
    /(?:^|\/)volc\/v1\/contents\/generations\/tasks(?:\/\{task_id\})?(?:$|\?)/.test(normalized) ||
    /(?:^|\/)contents\/generations\/tasks(?:\/\{task_id\})?(?:$|\?)/.test(normalized)
  )
}

function sanitizeBaseUrl(baseUrl: string): string {
  const normalized = normalizeText(baseUrl).replace(/\/+$/, '')
  return normalized || GRSAI_DEFAULT_BASE_URL
}

function normalizeConfiguredModel(value: unknown): string {
  const normalized = normalizeText(value)
  return normalized === LEGACY_DEFAULT_IMAGE_MODEL ? '' : normalized
}

function resolveConfiguredModel(value: unknown, fallback = DEFAULT_IMAGE_MODEL): string {
  return normalizeConfiguredModel(value) || fallback
}

function buildProviderUrl(baseUrl: string, apiPath: string): string {
  const normalizedPath = normalizeText(apiPath)
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath
  }
  const normalizedBase = sanitizeBaseUrl(baseUrl)
  const safePath = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
  if (normalizedBase.endsWith('/v1') && safePath.startsWith('/v1/')) {
    return `${normalizedBase}${safePath.slice(3)}`
  }
  return `${normalizedBase}${safePath}`
}

function resolveProviderPathTemplate(
  apiPath: string,
  payload: Record<string, unknown>
): {
  apiPath: string
  payload: Record<string, unknown>
} {
  const normalizedPath = normalizeText(apiPath)
  if (!normalizedPath.includes('{')) {
    return { apiPath: normalizedPath, payload }
  }

  const remainingPayload = { ...payload }
  let resolvedPath = normalizedPath
  const tokens = Array.from(normalizedPath.matchAll(/\{([a-z0-9_]+)\}/gi))

  for (const [, rawToken = ''] of tokens) {
    const token = rawToken.toLowerCase()
    const candidateValue =
      token === 'task_id'
        ? normalizeNullableText(
            remainingPayload.task_id ?? remainingPayload.taskId ?? remainingPayload.id
          )
        : normalizeNullableText(remainingPayload[token])

    if (!candidateValue) {
      throw new Error(`[AI Studio] AI 服务路径参数 ${token} 不能为空。`)
    }

    resolvedPath = resolvedPath.replace(`{${rawToken}}`, encodeURIComponent(candidateValue))

    if (token === 'task_id') {
      delete remainingPayload.task_id
      delete remainingPayload.taskId
      delete remainingPayload.id
    } else {
      delete remainingPayload[token]
    }
  }

  return {
    apiPath: resolvedPath,
    payload: remainingPayload
  }
}

function normalizeAspectRatio(value: unknown): string {
  const normalized = normalizeText(value)
  if (
    normalized === '1:1' ||
    normalized === '3:4' ||
    normalized === '9:16' ||
    normalized === '16:9' ||
    normalized === 'auto'
  ) {
    return normalized
  }
  return '3:4'
}

function containsCjkText(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(normalizeText(value))
}

function isVeo3VideoModel(model: string): boolean {
  const normalized = normalizeText(model).toLowerCase()
  return normalized.startsWith('veo3') || normalized.startsWith('veo-3')
}

function buildVideoWhiteNoisePrompt(prompt: string): string {
  const normalized = normalizeText(prompt)
  const suffix = '系统尾注：背景音使用白噪音。'
  if (!normalized) return suffix
  return /白噪音/.test(normalized) ? normalized : `${normalized} ${suffix}`
}

function inferImageExtensionFromUrlOrType(source: string, contentType?: string | null): string {
  const type = normalizeText(contentType).toLowerCase()
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  if (type.includes('bmp')) return 'bmp'
  if (type.includes('avif')) return 'avif'
  if (type.includes('jpg') || type.includes('jpeg')) return 'jpg'

  const ext = extname(source).toLowerCase().replace('.', '')
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  const match = source.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)
  const parsed = String(match?.[1] ?? '').toLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'].includes(parsed)) {
    return parsed === 'jpeg' ? 'jpg' : parsed
  }
  return 'jpg'
}

function summarizeVideoDebugValue(value: unknown, keyHint = ''): unknown {
  if (value === null || value === undefined) return value

  if (typeof value === 'string') {
    const normalized = String(value)
    const lowerKey = keyHint.toLowerCase()
    if (lowerKey.includes('apikey') || lowerKey.includes('authorization')) {
      return '[redacted]'
    }
    if (/^data:image\//i.test(normalized) || /^data:video\//i.test(normalized)) {
      return {
        kind: /^data:image\//i.test(normalized) ? 'image-data-url' : 'video-data-url',
        prefix:
          normalized.slice(0, Math.min(normalized.indexOf(','), 48)).trim() ||
          normalized.slice(0, 48),
        length: normalized.length,
        sha1: createHash('sha1').update(normalized).digest('hex').slice(0, 12)
      }
    }
    if (
      normalized.length > 1200 &&
      !['prompt', 'effectivePrompt', 'negative_prompt', 'message', 'rawText'].includes(keyHint)
    ) {
      return {
        kind: 'long-text',
        length: normalized.length,
        sha1: createHash('sha1').update(normalized).digest('hex').slice(0, 12),
        preview: normalized.slice(0, 240)
      }
    }
    return normalized
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => summarizeVideoDebugValue(item, keyHint))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, summarizeVideoDebugValue(item, key)])
    )
  }

  return String(value)
}

function inferVideoExtensionFromUrlOrType(source: string, contentType?: string | null): string {
  const type = normalizeText(contentType).toLowerCase()
  if (type.includes('webm')) return 'webm'
  if (type.includes('quicktime')) return 'mov'
  if (type.includes('mp4') || type.includes('video')) return 'mp4'

  const ext = extname(source).toLowerCase().replace('.', '')
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return ext
  const match = source.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)
  const parsed = String(match?.[1] ?? '').toLowerCase()
  if (['mp4', 'mov', 'webm', 'm4v'].includes(parsed)) return parsed
  return 'mp4'
}

function inferMimeType(filePath: string): string {
  const ext = inferImageExtensionFromUrlOrType(filePath)
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'avif') return 'image/avif'
  return 'image/jpeg'
}

async function filePathToDataUrl(filePath: string): Promise<string> {
  const normalized = normalizeText(filePath)
  if (!normalized) throw new Error('[AI Studio] 图片路径不能为空。')
  const buffer = await readFile(normalized)
  if (!buffer || buffer.length <= 0)
    throw new Error(`[AI Studio] 图片为空：${basename(normalized)}`)
  return `data:${inferMimeType(normalized)};base64,${buffer.toString('base64')}`
}

function extractRemoteTaskId(
  payload: Record<string, unknown>,
  options?: { allowTopLevelId?: boolean }
): string | null {
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {}
  return (
    normalizeNullableText(data.id) ??
    normalizeNullableText(data.taskId) ??
    normalizeNullableText(data.task_id) ??
    normalizeNullableText(data.request_id) ??
    normalizeNullableText(payload.taskId) ??
    normalizeNullableText(payload.task_id) ??
    normalizeNullableText(payload.request_id) ??
    (options?.allowTopLevelId === false ? null : normalizeNullableText(payload.id)) ??
    null
  )
}

function isChatCompletionsPath(apiPath: string): boolean {
  return /\/chat\/completions(?:$|[?#])/i.test(normalizeText(apiPath))
}

function parseDataUrl(value: string): { mimeType: string; data: string } | null {
  const match = normalizeText(value).match(/^data:([^;,]+)?;base64,(.+)$/i)
  if (!match) return null
  return {
    mimeType: normalizeText(match[1]) || 'image/jpeg',
    data: normalizeText(match[2])
  }
}

function buildImagePromptDirective(payload: {
  prompt: string
  aspectRatio: string
  imageSize: string
  outputCount: number
  referenceCount: number
}): string {
  const lines = [
    normalizeText(payload.prompt),
    ...buildImageGenerationDirectiveLines({
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize,
      referenceCount: payload.referenceCount
    })
  ]
  return lines.filter(Boolean).join('\n')
}

function buildChatCompletionsPayload(payload: {
  model: string
  prompt: string
  aspectRatio: string
  imageSize: string
  outputCount: number
  urls: string[]
  referenceCount: number
}): Record<string, unknown> {
  return {
    model: payload.model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildImagePromptDirective({
              prompt: payload.prompt,
              aspectRatio: payload.aspectRatio,
              imageSize: payload.imageSize,
              outputCount: payload.outputCount,
              referenceCount: payload.referenceCount
            })
          },
          ...payload.urls.map((url) => ({
            type: 'image_url',
            image_url: { url }
          }))
        ]
      }
    ],
    modalities: ['TEXT', 'IMAGE'],
    stream: false
  }
}

function buildGeminiGenerateContentPayload(payload: {
  prompt: string
  aspectRatio: string
  imageSize: string
  outputCount: number
  urls: string[]
  referenceCount: number
}): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = []

  for (const url of payload.urls) {
    const parsed = parseDataUrl(url)
    if (!parsed) continue
    parts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.data
      }
    })
  }

  parts.push({
    text: buildImagePromptDirective({
      prompt: payload.prompt,
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize,
      outputCount: payload.outputCount,
      referenceCount: payload.referenceCount
    })
  })

  return {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: buildGeminiGenerationConfig({
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize,
      candidateCount: payload.outputCount
    })
  }
}

function normalizeInlineImageContent(value: string, mimeType?: string | null): string {
  const normalized = normalizeText(value)
  if (!normalized) return ''
  if (/^data:/i.test(normalized)) return normalized
  const safeMimeType = normalizeText(mimeType) || 'image/png'
  return `data:${safeMimeType};base64,${normalized}`
}

function extractImageUrlsFromText(text: string): string[] {
  const normalized = normalizeText(text)
  if (!normalized) return []

  const values = new Set<string>()
  const markdownMatches = normalized.matchAll(
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)/gi
  )
  for (const match of markdownMatches) {
    const value = normalizeText(match[1])
    if (value) values.add(value)
  }

  const directMatches = normalized.matchAll(
    /(https?:\/\/[^\s<>()]+|data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)/gi
  )
  for (const match of directMatches) {
    const value = normalizeText(match[1]).replace(/[),.;]+$/, '')
    if (value) values.add(value)
  }

  return Array.from(values)
}

function pushResultItem(
  bucket: Array<Record<string, unknown>>,
  item: Record<string, unknown> | null | undefined
): void {
  if (!item) return
  const url = normalizeText(item.url)
  const content = normalizeText(item.content)
  if (!url && !content) return

  const signature = url ? `url:${url}` : `content:${content.slice(0, 120)}`
  const exists = bucket.some((existing) => {
    const existingUrl = normalizeText(existing.url)
    const existingContent = normalizeText(existing.content)
    const existingSignature = existingUrl
      ? `url:${existingUrl}`
      : `content:${existingContent.slice(0, 120)}`
    return existingSignature === signature
  })
  if (exists) return

  bucket.push({
    ...item,
    ...(url ? { url } : {}),
    ...(content ? { content } : {})
  })
}

function collectArrayImageItems(value: unknown): Array<Record<string, unknown>> {
  const bucket: Array<Record<string, unknown>> = []
  if (!Array.isArray(value)) return bucket

  for (const entry of value) {
    if (typeof entry === 'string') {
      for (const url of extractImageUrlsFromText(entry)) {
        pushResultItem(bucket, { url })
      }
      continue
    }

    const record = asObject(entry)
    const imageUrlRecord = asObject(record.image_url)
    const inlineRecord = asObject(record.inlineData ?? record.inline_data)
    const fileDataRecord = asObject(record.fileData ?? record.file_data)
    const directUrl = normalizeText(
      imageUrlRecord.url ??
        record.url ??
        record.imageUrl ??
        fileDataRecord.fileUri ??
        fileDataRecord.file_uri
    )
    if (directUrl) {
      pushResultItem(bucket, { url: directUrl })
    }

    const inlineContent = normalizeInlineImageContent(
      normalizeText(
        inlineRecord.data ??
          record.b64_json ??
          record.base64 ??
          (typeof record.content === 'string' && /^data:/i.test(record.content)
            ? record.content
            : '')
      ),
      normalizeText(
        inlineRecord.mimeType ?? inlineRecord.mime_type ?? record.mimeType ?? record.mime_type
      )
    )
    if (inlineContent) {
      pushResultItem(bucket, { content: inlineContent })
    }

    const textValue = normalizeText(record.text ?? record.output_text)
    for (const url of extractImageUrlsFromText(textValue)) {
      pushResultItem(bucket, { url })
    }

    if (Array.isArray(record.content)) {
      for (const item of collectArrayImageItems(record.content)) {
        pushResultItem(bucket, item)
      }
    }
  }

  return bucket
}

function collectEnvelopeResultItems(
  envelope: Record<string, unknown>,
  bucket: Array<Record<string, unknown>>
): void {
  const legacyResults = Array.isArray(envelope.results) ? envelope.results : []
  for (const entry of legacyResults) {
    if (entry && typeof entry === 'object') {
      pushResultItem(bucket, entry as Record<string, unknown>)
    }
  }

  for (const item of collectArrayImageItems(Array.isArray(envelope.data) ? envelope.data : [])) {
    pushResultItem(bucket, item)
  }
  for (const item of collectArrayImageItems(envelope.images)) {
    pushResultItem(bucket, item)
  }

  const choices = Array.isArray(envelope.choices) ? envelope.choices : []
  for (const choice of choices) {
    const choiceRecord = asObject(choice)
    const message = asObject(choiceRecord.message)
    const messageContent = message.content ?? choiceRecord.content
    if (typeof messageContent === 'string') {
      for (const url of extractImageUrlsFromText(messageContent)) {
        pushResultItem(bucket, { url })
      }
    }
    for (const item of collectArrayImageItems(messageContent)) {
      pushResultItem(bucket, item)
    }
    for (const item of collectArrayImageItems(message.images)) {
      pushResultItem(bucket, item)
    }
  }

  const candidates = Array.isArray(envelope.candidates) ? envelope.candidates : []
  for (const candidate of candidates) {
    const parts = Array.isArray(asObject(asObject(candidate).content).parts)
      ? (asObject(asObject(candidate).content).parts as unknown[])
      : []
    for (const item of collectArrayImageItems(parts)) {
      pushResultItem(bucket, item)
    }
  }

  const looseText = normalizeText(envelope.text ?? envelope.output_text)
  for (const url of extractImageUrlsFromText(looseText)) {
    pushResultItem(bucket, { url })
  }
}

function looksLikeVideoUrl(value: string): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false
  if (/^data:video\//i.test(normalized)) return true
  if (/\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(normalized)) return true
  return /^https?:\/\//i.test(normalized) && /video|download/i.test(normalized)
}

function pushVideoResultItem(
  bucket: Array<Record<string, unknown>>,
  item: Record<string, unknown> | null | undefined
): void {
  if (!item) return
  const url = normalizeText(item.url)
  const content = normalizeText(item.content)
  const mimeType = normalizeText(item.mimeType ?? item.contentType ?? item.type)
  const hintedVideo = mimeType.includes('video') || normalizeText(item.kind).includes('video')
  if (!url && !content) return
  if (url && !looksLikeVideoUrl(url) && !hintedVideo) return
  if (content && !/^data:video\//i.test(content) && !hintedVideo) return

  const signature = url ? `video-url:${url}` : `video-content:${content.slice(0, 120)}`
  if (
    bucket.some((existing) => {
      const existingUrl = normalizeText(existing.url)
      const existingContent = normalizeText(existing.content)
      const existingSignature = existingUrl
        ? `video-url:${existingUrl}`
        : `video-content:${existingContent.slice(0, 120)}`
      return existingSignature === signature
    })
  ) {
    return
  }

  bucket.push({
    ...item,
    ...(url ? { url } : {}),
    ...(content ? { content } : {})
  })
}

function collectVideoResultItemsFromValue(
  value: unknown,
  bucket: Array<Record<string, unknown>>,
  hint = ''
): void {
  if (!value) return

  if (typeof value === 'string') {
    const normalized = normalizeText(value)
    if (looksLikeVideoUrl(normalized)) {
      pushVideoResultItem(bucket, { url: normalized, kind: hint || 'video' })
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectVideoResultItemsFromValue(entry, bucket, hint))
    return
  }

  if (typeof value !== 'object') return
  const record = asObject(value)
  const mimeType = normalizeText(
    record.mimeType ?? record.mime_type ?? record.contentType ?? record.content_type ?? record.type
  )
  const directKeys = [
    'video_url',
    'url',
    'download_url',
    'file_url',
    'output_url',
    'result_url',
    'play_url'
  ]
  directKeys.forEach((key) => {
    const candidate = normalizeText(record[key])
    if (candidate) {
      pushVideoResultItem(bucket, { url: candidate, mimeType, kind: key })
    }
  })

  if (typeof record.content === 'string') {
    const normalizedContent = normalizeText(record.content)
    if (/^data:video\//i.test(normalizedContent)) {
      pushVideoResultItem(bucket, {
        content: normalizedContent,
        mimeType,
        kind: hint || 'video-content'
      })
    }
  }

  ;[
    'data',
    'detail',
    'result',
    'results',
    'outputs',
    'videos',
    'assets',
    'generations',
    'content',
    'response'
  ].forEach((key) => {
    if (record[key] !== undefined) {
      collectVideoResultItemsFromValue(record[key], bucket, key)
    }
  })
}

function extractVideoResultItems(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const bucket: Array<Record<string, unknown>> = []
  collectVideoResultItemsFromValue(payload, bucket, 'payload')
  return bucket
}

function extractVideoResultStatus(payload: Record<string, unknown>, fallback = 'running'): string {
  if (extractVideoResultItems(payload).length > 0) {
    return 'succeeded'
  }
  const data = asObject(payload.data)
  const detail = asObject(payload.detail)
  return normalizeRunStatus(detail.status ?? data.status ?? payload.status, fallback)
}

function normalizeRunStatus(value: unknown, fallback = 'running'): string {
  const normalized = normalizeText(value).toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'submitted' || normalized === 'queued' || normalized === 'running')
    return normalized
  if (normalized === 'succeeded' || normalized === 'completed' || normalized === 'success')
    return 'succeeded'
  if (normalized === 'failed' || normalized === 'error') return 'failed'
  return fallback
}

function extractResultStatus(payload: Record<string, unknown>, fallback = 'running'): string {
  if (extractResultItems(payload).length > 0) {
    return 'succeeded'
  }
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {}
  return normalizeRunStatus(data.status ?? payload.status, fallback)
}

function extractFailureReason(payload: Record<string, unknown>): string | null {
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {}
  const payloadError =
    payload.error && typeof payload.error === 'object'
      ? (payload.error as Record<string, unknown>)
      : null
  const payloadDetail =
    payload.detail && typeof payload.detail === 'object'
      ? (payload.detail as Record<string, unknown>)
      : null
  const dataDetail =
    data.detail && typeof data.detail === 'object' ? (data.detail as Record<string, unknown>) : null
  const details = Array.isArray(payload.details)
    ? payload.details
        .map((item) => {
          if (typeof item === 'string') return item.trim()
          if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>
            return normalizeText(record.message ?? record.msg ?? record.detail)
          }
          return ''
        })
        .filter(Boolean)
        .join(' | ')
    : ''

  return (
    normalizeNullableText(data.error) ??
    normalizeNullableText(data.failure_reason) ??
    normalizeNullableText(data.reason) ??
    normalizeNullableText(data.message) ??
    normalizeNullableText(data.msg) ??
    normalizeNullableText(payloadError?.message) ??
    normalizeNullableText(payloadError?.msg) ??
    normalizeNullableText(payloadDetail?.message) ??
    normalizeNullableText(payloadDetail?.msg) ??
    normalizeNullableText(payloadDetail?.error) ??
    normalizeNullableText(dataDetail?.message) ??
    normalizeNullableText(dataDetail?.msg) ??
    normalizeNullableText(dataDetail?.error) ??
    normalizeNullableText(payload.detail) ??
    normalizeNullableText(payload.msg) ??
    normalizeNullableText(payload.message) ??
    normalizeNullableText(details) ??
    normalizeNullableText(
      typeof payload.rawText === 'string' ? payload.rawText.slice(0, 400) : payload.rawText
    ) ??
    null
  )
}

function extractResultItems(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const bucket: Array<Record<string, unknown>> = []
  collectEnvelopeResultItems(payload, bucket)
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    collectEnvelopeResultItems(payload.data as Record<string, unknown>, bucket)
  }
  return bucket
}

function resolvePrompt(task: AiStudioTaskRecord, template: AiStudioTemplateRecord | null): string {
  const taskPrompt = normalizeText(task.promptExtra)
  if (taskPrompt) return taskPrompt

  const templatePrompt = normalizeText(template?.promptText)
  if (templatePrompt) return templatePrompt

  const productName = normalizeText(task.productName) || '当前商品'
  return `为商品「${productName}」生成一张电商静物图，保留主体材质与结构，适合后续筛图。`
}

function mergeTaskMetadata(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base = current && typeof current === 'object' ? current : {}
  return { ...base, ...patch }
}

function readAiStudioProjectMetadata(metadata: Record<string, unknown> | null | undefined): {
  projectId: string
  projectRootTaskId: string
  projectName: string
  projectPath: string | null
} | null {
  const base = metadata && typeof metadata === 'object' ? metadata : {}
  const projectRootTaskId = normalizeText(base.projectRootTaskId)
  const projectId = normalizeText(base.projectId) || projectRootTaskId
  if (!projectId) return null

  return {
    projectId,
    projectRootTaskId: projectRootTaskId || projectId,
    projectName: normalizeText(base.projectName),
    projectPath: normalizeNullableText(base.projectPath)
  }
}

function normalizeProjectDirectorySegment(value: string): string {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'project'
}

function detectFallbackPrice(model: string): { min: number | null; max: number | null } {
  const normalized = normalizeText(model).toLowerCase()
  const exact = GRSAI_PRICE_FALLBACKS[normalized]
  if (exact) return exact
  if (normalized.includes('pro')) return GRSAI_PRICE_FALLBACKS['nano-banana-pro']
  if (normalized.includes('fast')) return GRSAI_PRICE_FALLBACKS['nano-banana-fast']
  if (normalized.includes('nano-banana')) return GRSAI_PRICE_FALLBACKS['nano-banana']
  return { min: null, max: null }
}

function parseProviderCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toExecutionResult(
  task: AiStudioTaskRecord,
  run: AiStudioRunRecord,
  outputs: AiStudioAssetRecord[]
): AiStudioRunExecutionResult {
  return {
    task,
    run,
    outputs,
    completed: run.status === 'succeeded',
    status: run.status,
    remoteTaskId: run.remoteTaskId,
    billedState: run.billedState,
    priceMinSnapshot: run.priceMinSnapshot,
    priceMaxSnapshot: run.priceMaxSnapshot
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

type AiStudioVideoMetadataRecord = {
  profileId: string
  model: string
  adapterKind: 'allapi-unified'
  submitPath: string
  queryPath: string
  mode: 'subject-reference' | 'first-last-frame'
  subjectReferencePath: string | null
  firstFramePath: string | null
  lastFramePath: string | null
  aspectRatio: string
  resolution: string
  duration: number
  outputCount: number
}

function normalizeTemplateCapability(value: unknown): 'image' | 'video' | 'chat' {
  if (value === 'video') return 'video'
  if (value === 'chat') return 'chat'
  return 'image'
}

function readTaskCapability(task: Pick<AiStudioTaskRecord, 'metadata'>): 'image' | 'video' {
  const metadata = parseJsonObject(task.metadata)
  return metadata.capability === 'video' ? 'video' : 'image'
}

function readVideoMetadata(
  task: Pick<AiStudioTaskRecord, 'metadata'>
): AiStudioVideoMetadataRecord {
  const metadata = parseJsonObject(task.metadata)
  const video = asObject(metadata.video)
  return {
    profileId: normalizeText(video.profileId) || 'veo31-components',
    model: normalizeText(video.model) || 'veo3.1-components',
    adapterKind: 'allapi-unified',
    submitPath: normalizeText(video.submitPath) || AI_VIDEO_CREATE_PATH,
    queryPath: normalizeText(video.queryPath) || AI_VIDEO_QUERY_PATH,
    mode: video.mode === 'first-last-frame' ? 'first-last-frame' : 'subject-reference',
    subjectReferencePath: normalizeNullableText(video.subjectReferencePath),
    firstFramePath: normalizeNullableText(video.firstFramePath),
    lastFramePath: normalizeNullableText(video.lastFramePath),
    aspectRatio: ['9:16', '16:9', '1:1'].includes(normalizeText(video.aspectRatio))
      ? normalizeText(video.aspectRatio)
      : '9:16',
    resolution: normalizeText(video.resolution) || '720p',
    duration: normalizePositiveInteger(video.duration, 5),
    outputCount: normalizePositiveInteger(video.outputCount, 1)
  }
}

function uniqueNormalizedPaths(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)))
}

function mapTemplateRow(row: Record<string, unknown>): AiStudioTemplateRecord {
  return {
    id: normalizeText(row.id),
    provider: normalizeText(row.provider) || 'grsai',
    capability: normalizeTemplateCapability(row.capability),
    name: normalizeText(row.name),
    promptText: normalizeText(row.prompt_text),
    config: parseJsonObject(row.config_json),
    createdAt: Number(row.created_at ?? 0) || 0,
    updatedAt: Number(row.updated_at ?? 0) || 0
  }
}

function mapTaskRow(row: Record<string, unknown>): AiStudioTaskRecord {
  return {
    id: normalizeText(row.id),
    templateId: normalizeNullableText(row.template_id),
    provider: normalizeText(row.provider) || 'grsai',
    sourceFolderPath: normalizeNullableText(row.source_folder_path),
    productName: normalizeText(row.product_name),
    status: normalizeTaskStatus(row.status),
    aspectRatio: normalizeText(row.aspect_ratio) || '3:4',
    outputCount: normalizePositiveInteger(row.output_count, 1),
    model: normalizeText(row.model),
    promptExtra: normalizeText(row.prompt_extra),
    primaryImagePath: normalizeNullableText(row.primary_image_path),
    referenceImagePaths: parseJsonStringArray(row.reference_image_paths_json),
    inputImagePaths: parseJsonStringArray(row.input_image_paths_json),
    remoteTaskId: normalizeNullableText(row.remote_task_id),
    latestRunId: normalizeNullableText(row.latest_run_id),
    priceMinSnapshot: normalizeNullableNumber(row.price_min_snapshot),
    priceMaxSnapshot: normalizeNullableNumber(row.price_max_snapshot),
    billedState: normalizeBilledState(row.billed_state),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: Number(row.created_at ?? 0) || 0,
    updatedAt: Number(row.updated_at ?? 0) || 0
  }
}

function sanitizeProjectDirectorySegment(value: string): string {
  const normalized = normalizeText(value)
  if (!normalized) return 'project'
  const cleaned = Array.from(normalized, (character) => (character >= ' ' ? character : ' ')).join(
    ''
  )
  return (
    cleaned
      .replace(/[<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  )
}

function mapAssetRow(row: Record<string, unknown>): AiStudioAssetRecord {
  return {
    id: normalizeText(row.id),
    taskId: normalizeText(row.task_id),
    runId: normalizeNullableText(row.run_id),
    kind: normalizeText(row.kind) === 'output' ? 'output' : 'input',
    role: normalizeText(row.role) || 'candidate',
    filePath: normalizeText(row.file_path),
    previewPath: normalizeNullableText(row.preview_path),
    originPath: normalizeNullableText(row.origin_path),
    selected: Number(row.selected ?? 0) === 1,
    sortOrder: Number(row.sort_order ?? 0) || 0,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: Number(row.created_at ?? 0) || 0,
    updatedAt: Number(row.updated_at ?? 0) || 0
  }
}

function mapRunRow(row: Record<string, unknown>): AiStudioRunRecord {
  return {
    id: normalizeText(row.id),
    taskId: normalizeText(row.task_id),
    runIndex: normalizePositiveInteger(row.run_index, 1),
    provider: normalizeText(row.provider) || 'grsai',
    status: normalizeText(row.status) || 'queued',
    remoteTaskId: normalizeNullableText(row.remote_task_id),
    billedState: normalizeBilledState(row.billed_state),
    priceMinSnapshot: normalizeNullableNumber(row.price_min_snapshot),
    priceMaxSnapshot: normalizeNullableNumber(row.price_max_snapshot),
    runDir: normalizeNullableText(row.run_dir),
    requestPayload: parseJsonObject(row.request_payload_json),
    responsePayload: parseJsonObject(row.response_payload_json),
    errorMessage: normalizeNullableText(row.error_message),
    startedAt: normalizeNullableNumber(row.started_at),
    finishedAt: normalizeNullableNumber(row.finished_at),
    createdAt: Number(row.created_at ?? 0) || 0,
    updatedAt: Number(row.updated_at ?? 0) || 0
  }
}

export class AiStudioService {
  constructor(
    private readonly resolveWorkspacePath: () => string,
    private readonly resolveProviderConfig: () => Partial<AiStudioProviderConfig> = () => ({})
  ) {}

  private get db(): DbConnection {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) {
      throw new Error('[AI Studio] SQLite 未初始化。')
    }
    sqlite.ensureAiStudioSchema()
    return sqlite.connection as DbConnection
  }

  private getWorkspacePath(): string {
    const workspacePath = resolve(String(this.resolveWorkspacePath() ?? '').trim())
    if (!workspacePath) {
      throw new Error('[AI Studio] 工作区未初始化。')
    }
    return workspacePath
  }

  private buildProjectDirectoryPath(projectName: string, projectId: string): string {
    const slug = normalizeProjectDirectorySegment(projectName)
    const shortId = normalizeProjectDirectorySegment(projectId).slice(0, 8) || 'project'
    return join(this.getWorkspacePath(), 'ai-studio', 'projects', `${slug}-${shortId}`)
  }

  private normalizeProjectStorage(
    taskId: string,
    sourceFolderPath: string | null,
    productName: string,
    metadata: Record<string, unknown>
  ): {
    sourceFolderPath: string | null
    metadata: Record<string, unknown>
  } {
    const projectMeta = readAiStudioProjectMetadata(metadata)
    if (!projectMeta) {
      return { sourceFolderPath, metadata }
    }

    const projectName = projectMeta.projectName || normalizeText(productName) || '未命名项目'
    const projectPath =
      projectMeta.projectPath ||
      sourceFolderPath ||
      this.buildProjectDirectoryPath(projectName, projectMeta.projectId || taskId)

    return {
      sourceFolderPath: projectPath,
      metadata: mergeTaskMetadata(metadata, {
        projectId: projectMeta.projectId || taskId,
        projectRootTaskId: projectMeta.projectRootTaskId || projectMeta.projectId || taskId,
        projectName,
        projectPath
      })
    }
  }

  private ensureTaskDirectorySync(dirPath: string | null | undefined): void {
    const normalized = normalizeNullableText(dirPath)
    if (!normalized) return
    mkdirSync(normalized, { recursive: true })
  }

  private resolveTaskProjectContext(
    task: Pick<AiStudioTaskRecord, 'id' | 'productName' | 'sourceFolderPath' | 'metadata'>
  ): AiStudioResolvedProjectContext {
    const metadata = readAiStudioProjectMetadata(task.metadata)
    const projectId = metadata?.projectId || normalizeText(task.id)
    const projectRootTaskId = metadata?.projectRootTaskId || projectId || normalizeText(task.id)

    return {
      projectId,
      projectRootTaskId,
      projectName: metadata?.projectName || normalizeText(task.productName) || '未命名项目',
      projectPath: metadata?.projectPath || normalizeNullableText(task.sourceFolderPath)
    }
  }

  private getVideoDebugLogPath(): string {
    return join(this.getWorkspacePath(), 'debug', AI_STUDIO_VIDEO_DEBUG_FILE_NAME)
  }

  private getImageDebugLogPath(): string {
    return join(this.getWorkspacePath(), 'debug', AI_STUDIO_IMAGE_DEBUG_FILE_NAME)
  }

  async ensureProjectDirectory(
    projectId: string,
    projectName?: string | null,
    preferredPath?: string | null
  ): Promise<{
    projectId: string
    dirPath: string
  }> {
    const normalizedProjectId = normalizeText(projectId)
    if (!normalizedProjectId) throw new Error('[AI Studio] projectId 不能为空。')

    const explicitPath = normalizeText(preferredPath)
    const dirPath =
      explicitPath ||
      join(
        this.getWorkspacePath(),
        'ai-studio',
        'projects',
        `${sanitizeProjectDirectorySegment(normalizeText(projectName) || '未命名项目')}-${normalizedProjectId.slice(0, 8)}`
      )

    await mkdir(dirPath, { recursive: true })

    return {
      projectId: normalizedProjectId,
      dirPath
    }
  }

  private async appendVideoDebugLog(
    stage: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const logPath = this.getVideoDebugLogPath()
    const entry = {
      marker: AI_STUDIO_VIDEO_DEBUG_MARKER,
      stage,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      payload: summarizeVideoDebugValue(payload)
    }

    try {
      await mkdir(join(this.getWorkspacePath(), 'debug'), { recursive: true })
      await appendFile(
        logPath,
        `${JSON.stringify(entry)}
`,
        'utf8'
      )
    } catch (error) {
      console.warn('[AI Studio][VideoDebug] 写入失败：', error)
    }
  }

  private async appendImageDebugLog(
    stage: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const logPath = this.getImageDebugLogPath()
    const entry = {
      marker: AI_STUDIO_IMAGE_DEBUG_MARKER,
      stage,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      payload: summarizeVideoDebugValue(payload)
    }

    try {
      await mkdir(join(this.getWorkspacePath(), 'debug'), { recursive: true })
      await appendFile(
        logPath,
        `${JSON.stringify(entry)}
`,
        'utf8'
      )
    } catch (error) {
      console.warn('[AI Studio][ImageDebug] 写入失败：', error)
    }
  }

  private getTaskOrThrow(taskId: string): AiStudioTaskRecord {
    const row = this.db.prepare(`SELECT * FROM ai_studio_tasks WHERE id = ? LIMIT 1`).get(taskId)
    if (!row) throw new Error(`[AI Studio] 任务不存在：${taskId}`)
    return mapTaskRow(row)
  }

  private getRunById(runId: string): AiStudioRunRecord | null {
    const row = this.db.prepare(`SELECT * FROM ai_studio_runs WHERE id = ? LIMIT 1`).get(runId)
    return row ? mapRunRow(row) : null
  }

  private getTemplateById(templateId: string | null | undefined): AiStudioTemplateRecord | null {
    const normalized = normalizeText(templateId)
    if (!normalized) return null
    const row = this.db
      .prepare(`SELECT * FROM ai_studio_templates WHERE id = ? LIMIT 1`)
      .get(normalized)
    return row ? mapTemplateRow(row) : null
  }

  private getTemplateByProviderAndName(
    provider: string,
    capability: 'image' | 'video' | 'chat',
    name: string
  ): AiStudioTemplateRecord | null {
    const normalizedProvider = normalizeText(provider)
    const normalizedCapability = normalizeTemplateCapability(capability)
    const normalizedName = normalizeText(name)
    if (!normalizedProvider || !normalizedName) return null
    const row = this.db
      .prepare(
        `SELECT * FROM ai_studio_templates WHERE provider = ? AND capability = ? AND name = ? LIMIT 1`
      )
      .get(normalizedProvider, normalizedCapability, normalizedName)
    return row ? mapTemplateRow(row) : null
  }

  private getProviderConfig(
    task?: AiStudioTaskRecord,
    capability: 'image' | 'video' | 'chat' = 'image'
  ): AiStudioProviderConfig {
    return resolveAiStudioProviderConfig(
      asObject(this.resolveProviderConfig()),
      task ?? null,
      capability
    )
  }

  private async requestProvider(
    apiPath: string,
    payload: Record<string, unknown>,
    options?: {
      method?: 'POST' | 'OPTIONS' | 'GET' | 'HEAD'
      allowStatusCodes?: number[]
      allowProviderCodes?: number[]
      providerConfig?: AiStudioProviderConfig
      timeoutMs?: number | null
      debugLogKind?: 'image' | 'video'
      debugContext?: Record<string, unknown>
    }
  ): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    const config = options?.providerConfig ?? this.getProviderConfig()
    if (!config.apiKey) {
      throw new Error('[AI Studio] 未配置 AI API Key。')
    }

    const method = options?.method ?? 'POST'
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json, text/plain, */*',
      'User-Agent': DEFAULT_USER_AGENT
    }
    const init: RequestInit = {
      method,
      headers
    }
    const timeoutMs = resolveAiStudioProviderRequestTimeoutMs(
      options?.timeoutMs === undefined ? AI_STUDIO_PROVIDER_REQUEST_TIMEOUT_MS : options.timeoutMs
    )
    const abortController = timeoutMs === null ? null : new AbortController()
    const timeoutHandle =
      timeoutMs === null || !abortController
        ? null
        : setTimeout(() => {
            abortController.abort()
          }, timeoutMs)
    if (abortController) {
      init.signal = abortController.signal
    }

    const resolvedRequest = resolveProviderPathTemplate(apiPath, payload)
    const resolvedApiPath = resolvedRequest.apiPath
    const resolvedPayload = resolvedRequest.payload
    let requestUrl = buildProviderUrl(config.baseUrl, resolvedApiPath)
    if (method === 'GET') {
      const searchUrl = new URL(requestUrl)
      Object.entries(resolvedPayload).forEach(([key, value]) => {
        if (value === null || value === undefined) return
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item === null || item === undefined) return
            searchUrl.searchParams.append(key, String(item))
          })
          return
        }
        searchUrl.searchParams.set(key, String(value))
      })
      requestUrl = searchUrl.toString()
    } else if (method !== 'HEAD' && method !== 'OPTIONS') {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(resolvedPayload)
    }

    const debugContext = options?.debugContext ?? null
    const debugLogger =
      options?.debugLogKind === 'image'
        ? this.appendImageDebugLog.bind(this)
        : options?.debugLogKind === 'video'
          ? this.appendVideoDebugLog.bind(this)
          : null
    if (debugContext) {
      await debugLogger?.(`${options?.debugLogKind ?? 'request'}.provider.request`, {
        ...debugContext,
        method,
        apiPath: resolvedApiPath,
        requestUrl,
        providerConfig: {
          provider: config.provider,
          baseUrl: config.baseUrl,
          endpointPath: config.endpointPath,
          defaultImageModel: config.defaultImageModel,
          apiKeyPresent: Boolean(config.apiKey)
        },
        payload: resolvedPayload
      })
    }

    let response: Response
    let rawText = ''
    try {
      response = await fetch(requestUrl, init)
      rawText = await response.text()
    } catch (error) {
      const normalizedError =
        normalizeAiStudioProviderTransportErrorMessage(error) ??
        (error instanceof Error ? error.message : String(error))
      if (debugContext) {
        await debugLogger?.(`${options?.debugLogKind ?? 'request'}.provider.fetch_error`, {
          ...debugContext,
          method,
          apiPath: resolvedApiPath,
          requestUrl,
          timeoutMs,
          error: normalizedError
        })
      }
      throw new Error(normalizedError)
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle)
      }
    }

    const statusCode = response.status
    let parsedPayload: Record<string, unknown> = {}
    if (rawText) {
      try {
        parsedPayload = asObject(JSON.parse(rawText))
      } catch {
        parsedPayload = { rawText }
      }
    }

    if (debugContext) {
      await debugLogger?.(`${options?.debugLogKind ?? 'request'}.provider.response`, {
        ...debugContext,
        method,
        apiPath: resolvedApiPath,
        requestUrl,
        timeoutMs,
        statusCode,
        responsePayload: parsedPayload
      })
    }

    if (statusCode === 401 || statusCode === 403) {
      throw new Error('[AI Studio] AI 服务认证失败，请检查 API Key。')
    }

    if (statusCode === 404) {
      throw new Error(
        apiPath === GRSAI_RESULT_PATH || apiPath === GRSAI_DRAW_PATH
          ? `[AI Studio] AI 服务地址无效（${method} ${requestUrl}），请检查 Base URL。`
          : `[AI Studio] AI 服务地址无效（${method} ${requestUrl}），请检查 Base URL 或 API 端点。`
      )
    }

    const allowStatusCodes = new Set(options?.allowStatusCodes ?? [])
    if (!response.ok && !allowStatusCodes.has(statusCode)) {
      throw new Error(
        normalizeAiStudioProviderFailureMessage({
          statusCode,
          payload: parsedPayload,
          fallback: `[AI Studio] AI 服务请求失败（HTTP ${statusCode}，${method} ${resolvedApiPath}）。`
        }) ?? `[AI Studio] AI 服务请求失败（HTTP ${statusCode}，${method} ${resolvedApiPath}）。`
      )
    }

    const providerCode = parseProviderCode(parsedPayload.code)
    const allowProviderCodes = new Set(options?.allowProviderCodes ?? [])
    if (providerCode !== null && providerCode !== 0 && !allowProviderCodes.has(providerCode)) {
      throw new Error(
        normalizeAiStudioProviderFailureMessage({
          statusCode,
          payload: parsedPayload,
          fallback: `[AI Studio] AI 服务请求失败（业务码 ${providerCode}）。`
        }) ?? `[AI Studio] AI 服务请求失败（业务码 ${providerCode}）。`
      )
    }

    return { statusCode, payload: parsedPayload }
  }

  private async resolvePriceSnapshot(
    model: string
  ): Promise<{ min: number | null; max: number | null }> {
    return detectFallbackPrice(model)
  }

  private async buildSubmitContext(taskId: string): Promise<{
    task: AiStudioTaskRecord
    template: AiStudioTemplateRecord | null
    model: string
    prompt: string
    requestPayload: Record<string, unknown>
    requestSnapshot: Record<string, unknown>
  }> {
    const task = this.getTaskOrThrow(taskId)
    const workflowSource = readWorkflowSourceDescriptor(task)
    const taskOutputAssets = this.listAssets({ taskId, kind: 'output' })

    let primaryImagePath = workflowSource.sourcePrimaryImagePath
    if (workflowSource.useCurrentAiMasterAsPrimary) {
      if (!workflowSource.currentAiMasterAssetId) {
        throw new Error('[AI Studio] 子图阶段缺少当前 AI 母图，请重新选择。')
      }
      const currentAiMasterAsset = taskOutputAssets.find(
        (asset) =>
          asset.id === workflowSource.currentAiMasterAssetId && normalizeText(asset.filePath)
      )
      if (!currentAiMasterAsset) {
        throw new Error('[AI Studio] 当前 AI 母图不存在或已失效，请重新选择。')
      }
      primaryImagePath = currentAiMasterAsset.filePath
    }

    const config = this.getProviderConfig(task, 'image')
    const template = this.getTemplateById(task.templateId)
    const prompt = resolvePrompt(task, template)
    const model = resolveConfiguredModel(
      task.model,
      config.defaultImageModel || DEFAULT_IMAGE_MODEL
    )
    const endpointPath = config.endpointPath || GRSAI_DRAW_PATH
    const sourceImagePaths = uniqueNormalizedPaths([
      primaryImagePath,
      ...workflowSource.sourceReferenceImagePaths
    ])
    if (sourceImagePaths.length === 0 && !isGeminiGenerateContentPath(endpointPath)) {
      throw new Error('[AI Studio] 当前模型至少需要一张输入图片，请先添加主图或参考图。')
    }

    const aspectRatio = normalizeAspectRatio(task.aspectRatio)
    const imageSize = resolveImageSizeForModel(model)
    const usesGeminiGenerateContent = isGeminiGenerateContentPath(endpointPath)
    const urls = await Promise.all(
      sourceImagePaths.map((filePath) =>
        usesGeminiGenerateContent
          ? prepareGeminiInlineImageFromPath(filePath).then((result) => result.dataUrl)
          : filePathToDataUrl(filePath)
      )
    )

    const requestPayload = isChatCompletionsPath(endpointPath)
      ? buildChatCompletionsPayload({
          model,
          prompt,
          aspectRatio,
          imageSize,
          outputCount: task.outputCount,
          urls,
          referenceCount: Math.max(0, urls.length - 1)
        })
      : usesGeminiGenerateContent
        ? buildGeminiGenerateContentPayload({
            prompt,
            aspectRatio,
            imageSize,
            outputCount: task.outputCount,
            urls,
            referenceCount: Math.max(0, urls.length - 1)
          })
        : {
            model,
            prompt,
            aspectRatio,
            imageSize,
            urls,
            addWatermark: DEFAULT_ADD_WATERMARK,
            webHook: GRSAI_POLL_WEBHOOK_SENTINEL,
            shutProgress: false
          }

    const protocol = isChatCompletionsPath(endpointPath)
      ? 'chat-completions'
      : usesGeminiGenerateContent
        ? 'gemini-generate-content'
        : 'grsai-compatible'

    const requestSnapshot = {
      model,
      prompt,
      aspectRatio,
      imageSize,
      endpointPath,
      protocol,
      workflowStage: workflowSource.activeStage || 'master-setup',
      currentAiMasterAssetId: workflowSource.currentAiMasterAssetId,
      webHook: GRSAI_POLL_WEBHOOK_SENTINEL,
      ...(protocol === 'grsai-compatible' ? { addWatermark: DEFAULT_ADD_WATERMARK } : {}),
      outputCount: task.outputCount,
      inputCount: urls.length,
      sourceFiles: sourceImagePaths.map((filePath) => basename(filePath))
    } satisfies Record<string, unknown>

    return { task, template, model, prompt, requestPayload, requestSnapshot }
  }

  private async buildVideoSubmitContext(taskId: string): Promise<{
    task: AiStudioTaskRecord
    model: string
    prompt: string
    requestPayload: Record<string, unknown>
    requestSnapshot: Record<string, unknown>
    submitPath: string
    queryPath: string
  }> {
    const task = this.getTaskOrThrow(taskId)
    const videoMeta = readVideoMetadata(task)
    const prompt = normalizeText(task.promptExtra)
    const model = normalizeText(videoMeta.model)
    const inputPaths = normalizeVideoCreateInputPaths(
      model,
      videoMeta.mode === 'first-last-frame'
        ? uniqueNormalizedPaths([videoMeta.firstFramePath, videoMeta.lastFramePath])
        : uniqueNormalizedPaths([videoMeta.subjectReferencePath])
    )

    if (inputPaths.length === 0) {
      throw new Error('[AI Studio] 视频模式至少需要一张输入图片。')
    }

    const images = await Promise.all(inputPaths.map((filePath) => filePathToDataUrl(filePath)))
    const submitPath = normalizeText(videoMeta.submitPath) || AI_VIDEO_CREATE_PATH
    const queryPath = normalizeText(videoMeta.queryPath) || AI_VIDEO_QUERY_PATH
    const usesSeedanceProtocol =
      isVolcContentGenerationTasksPath(submitPath) || isSeedanceRequestModel(model)
    const aspectRatio = normalizeVideoCreateAspectRatio(model, videoMeta.aspectRatio)
    const seedanceRatio = resolveSeedanceVideoRatio(videoMeta.aspectRatio)
    const shouldTranslatePrompt = containsCjkText(prompt)
    const disableAudio = isVeo3VideoModel(model)
    const effectivePrompt = buildVideoWhiteNoisePrompt(prompt)
    const requestedResolution = normalizeVideoResolutionRequest(videoMeta.resolution)
    const requestedSize = toAllApiVideoSize(requestedResolution)
    const shouldEnableUpsample = requestedResolution === '1080p'
    const requestPayload: Record<string, unknown> = usesSeedanceProtocol
      ? buildSeedanceVideoTaskPayload({
          model,
          prompt: effectivePrompt,
          mode: videoMeta.mode,
          imageUrls: images,
          aspectRatio: seedanceRatio,
          duration: videoMeta.duration
        })
      : {
          model,
          prompt: effectivePrompt,
          images,
          duration: videoMeta.duration,
          size: requestedSize,
          resolution: requestedResolution,
          watermark: false,
          enhance_prompt: false,
          translate: shouldTranslatePrompt,
          enable_upsample: shouldEnableUpsample
        }
    if (!usesSeedanceProtocol && aspectRatio) {
      requestPayload.aspect_ratio = aspectRatio
    }
    if (!usesSeedanceProtocol && disableAudio) {
      requestPayload.generate_audio = false
    }

    const requestSnapshot = {
      model: videoMeta.model,
      prompt,
      effectivePrompt,
      endpointPath: submitPath,
      queryPath,
      protocol: usesSeedanceProtocol ? 'seedance-volc-content-generation' : 'allapi-video-unified',
      mode: videoMeta.mode,
      aspectRatio: usesSeedanceProtocol ? seedanceRatio : videoMeta.aspectRatio,
      duration: videoMeta.duration,
      ...(usesSeedanceProtocol
        ? { watermark: false }
        : {
            resolution: requestedResolution,
            size: requestedSize,
            translate: shouldTranslatePrompt,
            enhancePrompt: false,
            enableUpsample: shouldEnableUpsample,
            disableAudio
          }),
      outputCount: videoMeta.outputCount,
      inputCount: inputPaths.length,
      sourceFiles: inputPaths.map((filePath) => basename(filePath))
    } satisfies Record<string, unknown>

    return {
      task,
      model: videoMeta.model,
      prompt,
      requestPayload,
      requestSnapshot,
      submitPath,
      queryPath
    }
  }

  private async persistFailedSubmit(
    taskId: string,
    requestSnapshot: Record<string, unknown>,
    errorMessage: string,
    capability: 'image' | 'video' = 'image'
  ): Promise<void> {
    const task = this.getTaskOrThrow(taskId)
    const config = this.getProviderConfig(task, capability)
    await this.recordRunAttempt({
      taskId,
      provider: config.provider,
      status: 'failed',
      billedState: 'not_billable',
      requestPayload: requestSnapshot,
      responsePayload: {},
      errorMessage,
      finishedAt: Date.now()
    })
  }

  private decodeBase64Content(
    value: string
  ): { buffer: Buffer; contentType: string | null } | null {
    const normalized = normalizeText(value)
    if (!normalized) return null

    const dataUrlMatch = normalized.match(/^data:([^;,]+)?;base64,(.+)$/i)
    if (dataUrlMatch) {
      const contentType = normalizeNullableText(dataUrlMatch[1])
      const raw = dataUrlMatch[2] ?? ''
      return { buffer: Buffer.from(raw, 'base64'), contentType }
    }

    const compact = normalized.replace(/\s+/g, '')
    if (
      !compact ||
      compact.length < 32 ||
      compact.length % 4 !== 0 ||
      !/^[a-z0-9+/=]+$/i.test(compact)
    ) {
      return null
    }

    try {
      const buffer = Buffer.from(compact, 'base64')
      if (!buffer || buffer.length <= 0) return null
      return { buffer, contentType: null }
    } catch {
      return null
    }
  }

  private async persistOutputItem(payload: {
    taskId: string
    runId: string
    runDir: string
    index: number
    item: Record<string, unknown>
  }): Promise<AiStudioAssetWriteInput | null> {
    const remoteUrl = normalizeText(payload.item.url)
    const inlineContent = normalizeText(payload.item.content)

    let buffer: Buffer | null = null
    let contentType: string | null = null
    let sourceLabel = remoteUrl || inlineContent

    if (/^https?:\/\//i.test(remoteUrl)) {
      const response = await fetch(remoteUrl, {
        headers: {
          Accept: HTTP_IMAGE_ACCEPT,
          'User-Agent': DEFAULT_USER_AGENT
        }
      })
      if (!response.ok) {
        throw new Error(`[AI Studio] 下载结果失败（HTTP ${response.status}）。`)
      }
      contentType = normalizeNullableText(response.headers.get('content-type'))
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      const decoded = this.decodeBase64Content(remoteUrl || inlineContent)
      if (!decoded) return null
      buffer = decoded.buffer
      contentType = decoded.contentType
      sourceLabel = remoteUrl || `inline-${payload.index + 1}`
    }

    if (!buffer || buffer.length <= 0) return null

    const ext = inferImageExtensionFromUrlOrType(sourceLabel, contentType)
    const fileName = `output-${String(payload.index + 1).padStart(3, '0')}.${ext}`
    const filePath = join(payload.runDir, fileName)
    await writeFile(filePath, buffer)

    return {
      id: `ai-output-${createHash('sha1').update(`${payload.runId}:${payload.index}`).digest('hex')}`,
      taskId: payload.taskId,
      runId: payload.runId,
      kind: 'output',
      role: 'candidate',
      filePath,
      previewPath: filePath,
      originPath: remoteUrl || null,
      selected: false,
      sortOrder: payload.index,
      metadata: {
        remoteUrl: remoteUrl || null,
        remoteContent: inlineContent ? '[inline-content]' : null,
        contentType
      }
    }
  }

  private async persistVideoOutputItem(payload: {
    taskId: string
    runId: string
    runDir: string
    index: number
    item: Record<string, unknown>
    requestedResolution?: string | null
    responseSize?: string | null
  }): Promise<AiStudioAssetWriteInput | null> {
    const remoteUrl = normalizeText(payload.item.url)
    const inlineContent = normalizeText(payload.item.content)

    let buffer: Buffer | null = null
    let contentType: string | null = null
    let sourceLabel = remoteUrl || inlineContent

    if (/^https?:\/\//i.test(remoteUrl)) {
      const response = await fetch(remoteUrl, {
        headers: {
          Accept: HTTP_VIDEO_ACCEPT,
          'User-Agent': DEFAULT_USER_AGENT
        }
      })
      if (!response.ok) {
        throw new Error(`[AI Studio] 下载视频结果失败（HTTP ${response.status}）。`)
      }
      contentType = normalizeNullableText(response.headers.get('content-type'))
      buffer = Buffer.from(await response.arrayBuffer())
    } else {
      const decoded = this.decodeBase64Content(remoteUrl || inlineContent)
      if (!decoded) return null
      buffer = decoded.buffer
      contentType = decoded.contentType
      sourceLabel = remoteUrl || `video-inline-${payload.index + 1}`
    }

    if (!buffer || buffer.length <= 0) return null

    const ext = inferVideoExtensionFromUrlOrType(sourceLabel, contentType)
    const fileName = `output-${String(payload.index + 1).padStart(3, '0')}.${ext}`
    const filePath = join(payload.runDir, fileName)
    await writeFile(filePath, buffer)

    const requestedResolution = normalizeVideoResolutionRequest(payload.requestedResolution)
    const requestedSize = toAllApiVideoSize(requestedResolution)
    const parsedResponseSize = parseVideoSizeText(payload.responseSize)
    const probedResolution = await probeVideoOutputResolution(filePath)
    const effectiveResolution = probedResolution ?? parsedResponseSize

    return {
      id: `ai-video-output-${createHash('sha1').update(`${payload.runId}:${payload.index}`).digest('hex')}`,
      taskId: payload.taskId,
      runId: payload.runId,
      kind: 'output',
      role: 'video-output',
      filePath,
      previewPath: null,
      originPath: remoteUrl || null,
      selected: false,
      sortOrder: payload.index,
      metadata: {
        remoteUrl: remoteUrl || null,
        remoteContent: inlineContent ? '[inline-content]' : null,
        contentType,
        requestedResolution,
        requestedSize,
        responseSize: payload.responseSize ?? null,
        videoWidth: effectiveResolution?.width ?? null,
        videoHeight: effectiveResolution?.height ?? null,
        videoSizeText: effectiveResolution?.sizeText ?? payload.responseSize ?? null,
        resolutionLabel: effectiveResolution?.resolutionLabel || requestedResolution
      }
    }
  }

  async testConnection(
    selection?: Partial<AiStudioProviderConfig> | null
  ): Promise<AiStudioProviderConnectionResult> {
    const selected = selection && typeof selection === 'object' ? selection : null
    const fallback = this.getProviderConfig()
    const config: AiStudioProviderConfig = selected
      ? {
          provider: normalizeText(selected.provider) || fallback.provider,
          baseUrl: sanitizeBaseUrl(normalizeText(selected.baseUrl) || fallback.baseUrl),
          apiKey: normalizeText(selected.apiKey) || fallback.apiKey,
          defaultImageModel: resolveConfiguredModel(
            selected.defaultImageModel,
            fallback.defaultImageModel
          ),
          endpointPath: normalizeText(selected.endpointPath) || fallback.endpointPath,
          providerProfiles: selected.providerProfiles ?? fallback.providerProfiles
        }
      : fallback
    const checkedAt = Date.now()
    const connectionApiPath = config.endpointPath || GRSAI_RESULT_PATH
    const isCustomEndpoint = Boolean(config.endpointPath)
    const looksLikeGeminiGenerateContent = isGeminiGenerateContentPath(connectionApiPath)
    const looksLikeChatCompletions = isChatCompletionsPath(connectionApiPath)
    const looksLikeSeedanceTaskEndpoint = isVolcContentGenerationTasksPath(connectionApiPath)
    const looksLikeVideoCreateEndpoint = isCustomEndpoint && isVideoCreatePath(connectionApiPath)

    const probePayload = looksLikeChatCompletions
      ? {
          model: config.defaultImageModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        }
      : looksLikeGeminiGenerateContent
        ? {
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            generationConfig: { responseModalities: ['TEXT'] }
          }
        : looksLikeSeedanceTaskEndpoint
          ? buildSeedanceVideoTaskPayload({
              model: config.defaultImageModel || 'seedance-1-5-pro',
              prompt: 'ping',
              mode: 'subject-reference',
              imageUrls: [],
              aspectRatio: 'adaptive',
              duration: 4
            })
          : looksLikeVideoCreateEndpoint
            ? {
                model: config.defaultImageModel || 'veo3.1-fast',
                prompt: 'ping',
                enhance_prompt: true,
                enable_upsample: true,
                aspect_ratio: '16:9'
              }
            : isCustomEndpoint
              ? {}
              : { id: CONNECTION_TEST_ID }

    const response = await this.requestProvider(
      connectionApiPath,
      probePayload,
      looksLikeChatCompletions || looksLikeGeminiGenerateContent
        ? { providerConfig: config }
        : looksLikeSeedanceTaskEndpoint
          ? {
              method: 'POST',
              allowStatusCodes: [400, 422],
              providerConfig: config
            }
          : looksLikeVideoCreateEndpoint
            ? { method: 'POST', providerConfig: config }
            : isCustomEndpoint
              ? {
                  method: 'POST',
                  allowStatusCodes: [400, 405, 422],
                  allowProviderCodes: [-22],
                  providerConfig: config
                }
              : { allowStatusCodes: [400], allowProviderCodes: [-22], providerConfig: config }
    )
    return {
      success: true,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.defaultImageModel,
      endpointPath: connectionApiPath,
      checkedAt,
      statusCode: response.statusCode,
      message: looksLikeGeminiGenerateContent
        ? '连接成功，Gemini generateContent 端点已响应。'
        : looksLikeChatCompletions
          ? '连接成功，chat/completions 端点已响应。'
          : config.endpointPath
            ? '连接成功，模型端点已响应。'
            : '连接成功，接口已响应。'
    }
  }

  private persistLatestSubmittedPrompt(
    taskId: string,
    requestSnapshot: Record<string, unknown>
  ): AiStudioTaskRecord {
    const task = this.getTaskOrThrow(taskId)
    const prompt = normalizeText(requestSnapshot.prompt)
    const endpointPath = normalizeText(requestSnapshot.endpointPath)
    return this.updateTask(taskId, {
      metadata: mergeTaskMetadata(task.metadata, {
        latestSubmittedPrompt: prompt,
        latestRequestSnapshot: requestSnapshot,
        latestSubmittedAt: Date.now(),
        latestSubmittedEndpointPath: endpointPath || null
      })
    })
  }

  async submitImageRun(taskId: string): Promise<AiStudioRunExecutionResult> {
    const task = this.getTaskOrThrow(taskId)
    const config = this.getProviderConfig(task, 'image')
    const context = await this.buildSubmitContext(taskId)
    const priceSnapshot = await this.resolvePriceSnapshot(context.model)
    const submitApiPath = config.endpointPath || GRSAI_DRAW_PATH
    const looksLikeChatCompletions = isChatCompletionsPath(submitApiPath)
    const looksLikeGeminiGenerateContent = isGeminiGenerateContentPath(submitApiPath)
    const usesAsyncFlowTask = isAiStudioAsyncFlowRoute({
      model: context.model,
      endpointPath: submitApiPath
    })

    await this.appendImageDebugLog('image.submit.context', {
      taskId,
      provider: task.provider,
      providerConfig: {
        provider: config.provider,
        baseUrl: config.baseUrl,
        endpointPath: config.endpointPath,
        defaultImageModel: config.defaultImageModel,
        apiKeyPresent: Boolean(config.apiKey)
      },
      submitPath: submitApiPath,
      requestSnapshot: context.requestSnapshot
    })

    try {
      const response = await this.requestProvider(
        usesAsyncFlowTask ? AI_STUDIO_FLOW_TASK_SUBMIT_PATH : submitApiPath,
        usesAsyncFlowTask
          ? buildAiStudioAsyncFlowSubmitPayload({
              model: context.model,
              requestPayload: context.requestPayload
            })
          : context.requestPayload,
        {
        providerConfig: config,
        debugLogKind: 'image',
        debugContext: {
          flow: usesAsyncFlowTask ? 'image-submit-async-task' : 'image-submit',
          taskId,
          model: context.model,
          submitPath: usesAsyncFlowTask ? AI_STUDIO_FLOW_TASK_SUBMIT_PATH : submitApiPath
        }
      }
      )
      this.persistLatestSubmittedPrompt(taskId, context.requestSnapshot)
      const directResultItems = extractResultItems(response.payload)

      if (!usesAsyncFlowTask && directResultItems.length > 0) {
        const run = await this.recordRunAttempt({
          taskId,
          provider: config.provider,
          status: 'succeeded',
          remoteTaskId: extractRemoteTaskId(response.payload, { allowTopLevelId: false }),
          billedState: 'billable',
          priceMinSnapshot: priceSnapshot.min,
          priceMaxSnapshot: priceSnapshot.max,
          requestPayload: context.requestSnapshot,
          responsePayload: response.payload,
          errorMessage: null,
          startedAt: Date.now(),
          finishedAt: Date.now()
        })

        const outputs = await this.downloadOutputs({
          taskId,
          runId: run.id,
          responsePayload: response.payload
        })
        await this.appendImageDebugLog('image.submit.direct_result', {
          taskId,
          runId: run.id,
          outputCount: outputs.length
        })
        const latestRun = this.getRunById(run.id) ?? run
        return toExecutionResult(this.getTaskOrThrow(taskId), latestRun, outputs)
      }

      const remoteTaskId = extractRemoteTaskId(response.payload, {
        allowTopLevelId: !(looksLikeChatCompletions || looksLikeGeminiGenerateContent)
      })
      if (!remoteTaskId) {
        throw new Error(
          extractFailureReason(response.payload) ??
            '[AI Studio] AI 服务既没有返回任务 ID，也没有返回可落盘的图片结果。'
        )
      }

      const run = await this.recordRunAttempt({
        taskId,
        provider: config.provider,
        status: 'submitted',
        remoteTaskId,
        billedState: 'billable',
        priceMinSnapshot: priceSnapshot.min,
        priceMaxSnapshot: priceSnapshot.max,
        requestPayload: context.requestSnapshot,
        responsePayload: response.payload,
        errorMessage: null,
        startedAt: Date.now()
      })

      await this.appendImageDebugLog('image.submit.accepted', {
        taskId,
        runId: run.id,
        remoteTaskId,
        asyncTask: usesAsyncFlowTask
      })

      return toExecutionResult(
        this.getTaskOrThrow(taskId),
        run,
        this.listAssets({ taskId, runId: run.id, kind: 'output' })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.persistLatestSubmittedPrompt(taskId, context.requestSnapshot)
      await this.persistFailedSubmit(taskId, context.requestSnapshot, message, 'image')
      await this.appendImageDebugLog('image.submit.error', {
        taskId,
        submitPath: submitApiPath,
        error: message
      })
      throw error
    }
  }

  async submitVideoRun(taskId: string): Promise<AiStudioRunExecutionResult> {
    const task = this.getTaskOrThrow(taskId)
    const config = this.getProviderConfig(task)
    const context = await this.buildVideoSubmitContext(taskId)
    const priceSnapshot = await this.resolvePriceSnapshot(context.model)
    const videoMeta = readVideoMetadata(task)

    await this.appendVideoDebugLog('video.submit.context', {
      taskId,
      provider: task.provider,
      providerConfig: {
        provider: config.provider,
        baseUrl: config.baseUrl,
        endpointPath: config.endpointPath,
        defaultImageModel: config.defaultImageModel,
        apiKeyPresent: Boolean(config.apiKey)
      },
      submitPath: context.submitPath,
      queryPath: context.queryPath,
      requestSnapshot: context.requestSnapshot,
      requestPayload: context.requestPayload,
      videoMeta: {
        model: videoMeta.model,
        mode: videoMeta.mode,
        aspectRatio: videoMeta.aspectRatio,
        duration: videoMeta.duration,
        resolution: videoMeta.resolution,
        subjectReferencePath: videoMeta.subjectReferencePath,
        firstFramePath: videoMeta.firstFramePath,
        lastFramePath: videoMeta.lastFramePath
      }
    })

    try {
      const response = await this.requestProvider(context.submitPath, context.requestPayload, {
        providerConfig: config,
        timeoutMs: null,
        debugContext: {
          flow: 'video-submit',
          taskId,
          model: context.model,
          submitPath: context.submitPath,
          queryPath: context.queryPath
        }
      })
      this.persistLatestSubmittedPrompt(taskId, context.requestSnapshot)
      const directResultItems = extractVideoResultItems(response.payload)

      if (directResultItems.length > 0) {
        const run = await this.recordRunAttempt({
          taskId,
          provider: config.provider,
          status: 'succeeded',
          remoteTaskId: extractRemoteTaskId(response.payload, { allowTopLevelId: false }),
          billedState: 'billable',
          priceMinSnapshot: priceSnapshot.min,
          priceMaxSnapshot: priceSnapshot.max,
          requestPayload: context.requestSnapshot,
          responsePayload: response.payload,
          errorMessage: null,
          startedAt: Date.now(),
          finishedAt: Date.now()
        })

        const outputs = await this.downloadVideoOutputs({
          taskId,
          runId: run.id,
          responsePayload: response.payload
        })
        const latestRun = this.getRunById(run.id) ?? run
        return toExecutionResult(this.getTaskOrThrow(taskId), latestRun, outputs)
      }

      const remoteTaskId = extractRemoteTaskId(response.payload)
      await this.appendVideoDebugLog('video.submit.accepted', {
        taskId,
        model: context.model,
        submitPath: context.submitPath,
        queryPath: context.queryPath,
        remoteTaskId,
        directResultCount: directResultItems.length,
        responsePayload: response.payload
      })
      if (!remoteTaskId) {
        throw new Error(
          extractFailureReason(response.payload) ?? '[AI Studio] AI 服务未返回视频任务 ID。'
        )
      }

      const run = await this.recordRunAttempt({
        taskId,
        provider: config.provider,
        status: 'submitted',
        remoteTaskId,
        billedState: 'billable',
        priceMinSnapshot: priceSnapshot.min,
        priceMaxSnapshot: priceSnapshot.max,
        requestPayload: context.requestSnapshot,
        responsePayload: response.payload,
        errorMessage: null,
        startedAt: Date.now()
      })

      return toExecutionResult(
        this.getTaskOrThrow(taskId),
        run,
        this.listAssets({ taskId, runId: run.id, kind: 'output' })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.appendVideoDebugLog('video.submit.error', {
        taskId,
        model: context.model,
        submitPath: context.submitPath,
        queryPath: context.queryPath,
        error: message,
        requestSnapshot: context.requestSnapshot
      })
      this.persistLatestSubmittedPrompt(taskId, context.requestSnapshot)
      await this.persistFailedSubmit(taskId, context.requestSnapshot, message, 'video')
      throw error
    }
  }

  async downloadOutputs(payload: {
    taskId: string
    runId: string
    responsePayload?: Record<string, unknown>
  }): Promise<AiStudioAssetRecord[]> {
    const taskId = normalizeText(payload.taskId)
    const runId = normalizeText(payload.runId)
    if (!taskId || !runId) throw new Error('[AI Studio] taskId / runId 不能为空。')

    const run = this.getRunById(runId)
    if (!run || run.taskId !== taskId) {
      throw new Error('[AI Studio] 运行记录不存在。')
    }

    const responsePayload = asObject(payload.responsePayload)
    const results = extractResultItems(responsePayload)
    if (results.length === 0) {
      return this.listAssets({ taskId, runId, kind: 'output' })
    }

    const runDir =
      normalizeText(run.runDir) || (await this.ensureTaskRunDirectory(taskId, run.runIndex)).dirPath
    const assetsToWrite: AiStudioAssetWriteInput[] = []
    const failures: string[] = []

    for (const [index, item] of results.entries()) {
      try {
        const written = await this.persistOutputItem({ taskId, runId, runDir, index, item })
        if (written) {
          assetsToWrite.push(written)
        } else {
          failures.push(`结果 ${index + 1} 缺少可下载内容。`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`结果 ${index + 1} 下载失败：${message}`)
      }
    }

    const persisted =
      assetsToWrite.length > 0
        ? this.upsertAssets(assetsToWrite)
        : this.listAssets({ taskId, runId, kind: 'output' })

    if (failures.length > 0) {
      await this.recordRunAttempt({
        runId,
        taskId,
        responsePayload: {
          ...run.responsePayload,
          downloadFailures: failures,
          resultCount: results.length
        },
        errorMessage: failures[0]
      })
    }

    return persisted
  }

  async downloadVideoOutputs(payload: {
    taskId: string
    runId: string
    responsePayload?: Record<string, unknown>
  }): Promise<AiStudioAssetRecord[]> {
    const taskId = normalizeText(payload.taskId)
    const runId = normalizeText(payload.runId)
    if (!taskId || !runId) throw new Error('[AI Studio] taskId / runId 不能为空。')

    const run = this.getRunById(runId)
    if (!run || run.taskId !== taskId) {
      throw new Error('[AI Studio] 运行记录不存在。')
    }

    const responsePayload = asObject(payload.responsePayload)
    const results = extractVideoResultItems(responsePayload)
    if (results.length === 0) {
      return this.listAssets({ taskId, runId, kind: 'output' })
    }

    const task = this.getTaskOrThrow(taskId)
    const videoMeta = readVideoMetadata(task)
    const responseSize = normalizeNullableText(responsePayload.size)
    const runDir =
      normalizeText(run.runDir) || (await this.ensureTaskRunDirectory(taskId, run.runIndex)).dirPath
    const assetsToWrite: AiStudioAssetWriteInput[] = []
    const failures: string[] = []

    for (let index = 0; index < results.length; index += 1) {
      try {
        const persisted = await this.persistVideoOutputItem({
          taskId,
          runId,
          runDir,
          index,
          item: results[index],
          requestedResolution: videoMeta.resolution,
          responseSize
        })
        if (persisted) assetsToWrite.push(persisted)
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }

    const persisted =
      assetsToWrite.length > 0
        ? this.upsertAssets(assetsToWrite)
        : this.listAssets({ taskId, runId, kind: 'output' })

    if (failures.length > 0) {
      await this.recordRunAttempt({
        runId,
        taskId,
        responsePayload: {
          ...run.responsePayload,
          downloadFailures: failures,
          resultCount: results.length
        },
        errorMessage: failures[0]
      })
    }

    return persisted
  }

  async pollVideoRunResult(payload: {
    taskId: string
    runId?: string | null
  }): Promise<AiStudioRunExecutionResult> {
    const taskId = normalizeText(payload.taskId)
    if (!taskId) throw new Error('[AI Studio] taskId 不能为空。')

    const task = this.getTaskOrThrow(taskId)
    const runId = normalizeText(payload.runId) || normalizeText(task.latestRunId)
    if (!runId) throw new Error('[AI Studio] 当前任务没有可轮询的运行记录。')

    const existingRun = this.getRunById(runId)
    if (!existingRun || existingRun.taskId !== taskId) {
      throw new Error('[AI Studio] 运行记录不存在。')
    }

    if (!existingRun.remoteTaskId) {
      throw new Error('[AI Studio] 当前运行缺少远端任务 ID。')
    }

    const requestSnapshot = asObject(existingRun.requestPayload)
    const queryPath =
      normalizeText(requestSnapshot.queryPath) ||
      readVideoMetadata(task).queryPath ||
      AI_VIDEO_QUERY_PATH
    const providerConfig = this.getProviderConfig(task, 'video')

    await this.appendVideoDebugLog('video.poll.context', {
      taskId,
      runId: existingRun.id,
      remoteTaskId: existingRun.remoteTaskId,
      queryPath,
      providerConfig: {
        provider: providerConfig.provider,
        baseUrl: providerConfig.baseUrl,
        endpointPath: providerConfig.endpointPath,
        defaultImageModel: providerConfig.defaultImageModel,
        apiKeyPresent: Boolean(providerConfig.apiKey)
      },
      requestSnapshot
    })

    const response = await this.requestProvider(
      queryPath,
      { id: existingRun.remoteTaskId },
      {
        method: 'GET',
        providerConfig,
        timeoutMs: null,
        debugContext: {
          flow: 'video-poll',
          taskId,
          runId: existingRun.id,
          remoteTaskId: existingRun.remoteTaskId,
          queryPath
        }
      }
    )
    const status = extractVideoResultStatus(response.payload, existingRun.status)
    const errorMessage = status === 'failed' ? extractFailureReason(response.payload) : null

    await this.appendVideoDebugLog('video.poll.parsed', {
      taskId,
      runId: existingRun.id,
      remoteTaskId: existingRun.remoteTaskId,
      queryPath,
      status,
      errorMessage,
      responsePayload: response.payload
    })

    const run = await this.recordRunAttempt({
      runId: existingRun.id,
      taskId,
      status,
      remoteTaskId: existingRun.remoteTaskId,
      billedState: existingRun.billedState,
      priceMinSnapshot: existingRun.priceMinSnapshot,
      priceMaxSnapshot: existingRun.priceMaxSnapshot,
      requestPayload: existingRun.requestPayload,
      responsePayload: response.payload,
      errorMessage,
      finishedAt: status === 'succeeded' || status === 'failed' ? Date.now() : null
    })

    const outputs =
      status === 'succeeded'
        ? await this.downloadVideoOutputs({
            taskId,
            runId: run.id,
            responsePayload: response.payload
          })
        : this.listAssets({ taskId, runId: run.id, kind: 'output' })

    return toExecutionResult(this.getTaskOrThrow(taskId), run, outputs)
  }

  async pollRunResult(payload: {
    taskId: string
    runId?: string | null
  }): Promise<AiStudioRunExecutionResult> {
    const taskId = normalizeText(payload.taskId)
    if (!taskId) throw new Error('[AI Studio] taskId 不能为空。')
    const task = this.getTaskOrThrow(taskId)
    return readTaskCapability(task) === 'video'
      ? this.pollVideoRunResult(payload)
      : this.pollImageRunResult(payload)
  }

  async pollImageRunResult(payload: {
    taskId: string
    runId?: string | null
  }): Promise<AiStudioRunExecutionResult> {
    const taskId = normalizeText(payload.taskId)
    if (!taskId) throw new Error('[AI Studio] taskId 不能为空。')

    const task = this.getTaskOrThrow(taskId)
    const runId = normalizeText(payload.runId) || normalizeText(task.latestRunId)
    if (!runId) throw new Error('[AI Studio] 当前任务没有可轮询的运行记录。')

    const existingRun = this.getRunById(runId)
    if (!existingRun || existingRun.taskId !== taskId) {
      throw new Error('[AI Studio] 运行记录不存在。')
    }

    if (!existingRun.remoteTaskId) {
      throw new Error('[AI Studio] 当前运行缺少远端任务 ID。')
    }

    const providerConfig = this.getProviderConfig(task, 'image')
    const requestSnapshot = asObject(existingRun.requestPayload)
    const usesAsyncFlowTask = isAiStudioAsyncFlowRoute({
      model: normalizeText(requestSnapshot.model) || task.model,
      endpointPath:
        normalizeText(requestSnapshot.endpointPath) ||
        providerConfig.endpointPath ||
        GRSAI_DRAW_PATH
    })
    const response = await this.requestProvider(
      usesAsyncFlowTask ? AI_STUDIO_FLOW_TASK_POLL_PATH : GRSAI_RESULT_PATH,
      usesAsyncFlowTask ? { taskId: existingRun.remoteTaskId } : { id: existingRun.remoteTaskId },
      usesAsyncFlowTask
        ? {
            method: 'GET',
            providerConfig,
            debugLogKind: 'image',
            debugContext: {
              flow: 'image-poll-async-task',
              taskId,
              runId: existingRun.id,
              remoteTaskId: existingRun.remoteTaskId
            }
          }
        : undefined
    )
    const normalizedResponsePayload = usesAsyncFlowTask
      ? normalizeAiStudioAsyncFlowTaskPayload(response.payload)
      : response.payload
    const status = extractResultStatus(normalizedResponsePayload, existingRun.status)
    const errorMessage = status === 'failed' ? extractFailureReason(normalizedResponsePayload) : null

    const run = await this.recordRunAttempt({
      runId: existingRun.id,
      taskId,
      status,
      remoteTaskId: existingRun.remoteTaskId,
      billedState: existingRun.billedState,
      priceMinSnapshot: existingRun.priceMinSnapshot,
      priceMaxSnapshot: existingRun.priceMaxSnapshot,
      requestPayload: existingRun.requestPayload,
      responsePayload: normalizedResponsePayload,
      errorMessage,
      finishedAt: status === 'succeeded' || status === 'failed' ? Date.now() : null
    })

    const outputs =
      status === 'succeeded'
        ? await this.downloadOutputs({
            taskId,
            runId: run.id,
            responsePayload: normalizedResponsePayload
          })
        : this.listAssets({ taskId, runId: run.id, kind: 'output' })

    return toExecutionResult(this.getTaskOrThrow(taskId), run, outputs)
  }

  async startRun(taskId: string): Promise<AiStudioRunExecutionResult> {
    const task = this.getTaskOrThrow(taskId)
    return readTaskCapability(task) === 'video'
      ? this.submitVideoRun(taskId)
      : this.submitImageRun(taskId)
  }

  async retryRun(taskId: string): Promise<AiStudioRunExecutionResult> {
    const task = this.getTaskOrThrow(taskId)
    return readTaskCapability(task) === 'video'
      ? this.submitVideoRun(taskId)
      : this.submitImageRun(taskId)
  }

  getRun(runId: string): AiStudioRunRecord | null {
    const normalizedRunId = normalizeText(runId)
    if (!normalizedRunId) return null
    return this.getRunById(normalizedRunId)
  }

  listTemplates(capability: 'image' | 'video' | 'chat' = 'image'): AiStudioTemplateRecord[] {
    const normalizedCapability = normalizeTemplateCapability(capability)
    const rows = this.db
      .prepare(
        `SELECT * FROM ai_studio_templates WHERE capability = ? ORDER BY updated_at DESC, created_at DESC`
      )
      .all(normalizedCapability)
    return rows.map(mapTemplateRow)
  }

  deleteTemplate(templateId: string): { success: boolean } {
    const normalizedId = normalizeText(templateId)
    if (!normalizedId) return { success: false }
    const changes = Number(
      (
        this.db.prepare(`DELETE FROM ai_studio_templates WHERE id = ?`).run(normalizedId) as {
          changes?: unknown
        }
      )?.changes ?? 0
    )
    return { success: Number.isFinite(changes) && changes > 0 }
  }

  upsertTemplate(input: {
    id?: string
    provider?: string
    capability?: 'image' | 'video' | 'chat'
    name: string
    promptText?: string
    config?: Record<string, unknown>
  }): AiStudioTemplateRecord {
    const provider = normalizeText(input.provider) || 'grsai'
    const capability = normalizeTemplateCapability(input.capability)
    const name = normalizeText(input.name)
    if (!name) throw new Error('[AI Studio] 模板名称不能为空。')
    const existing = this.getTemplateByProviderAndName(provider, capability, name)
    const normalizedId = normalizeText(input.id)
    const id = normalizedId || existing?.id || randomUUID()
    const promptText = normalizeText(input.promptText)
    const now = Date.now()

    try {
      this.db
        .prepare(
          `
            INSERT INTO ai_studio_templates (
              id, provider, capability, name, prompt_text, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              provider = excluded.provider,
              capability = excluded.capability,
              name = excluded.name,
              prompt_text = excluded.prompt_text,
              config_json = excluded.config_json,
              updated_at = excluded.updated_at;
          `
        )
        .run(id, provider, capability, name, promptText, toJson(input.config ?? {}), now, now)
    } catch (error) {
      if (
        error instanceof Error &&
        /(ai_studio_templates\.provider,\s*ai_studio_templates\.(capability,\s*)?name|idx_ai_studio_templates_provider_capability_name|idx_ai_studio_templates_provider_name)/i.test(
          error.message
        )
      ) {
        throw new Error('[AI Studio] 已存在同名提示词模板，请直接选择它或换一个名字。')
      }
      throw error
    }

    return mapTemplateRow(
      this.db.prepare(`SELECT * FROM ai_studio_templates WHERE id = ? LIMIT 1`).get(id) ?? {}
    )
  }

  createTask(input: AiStudioTaskCreateInput): AiStudioTaskRecord {
    const taskId = normalizeText(input.id) || randomUUID()
    const now = Date.now()
    const normalizedMetadata =
      input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
    const normalizedProject = this.normalizeProjectStorage(
      taskId,
      normalizeNullableText(input.sourceFolderPath),
      normalizeText(input.productName),
      normalizedMetadata
    )
    const record = {
      taskId,
      templateId: normalizeNullableText(input.templateId),
      provider: normalizeText(input.provider) || 'grsai',
      sourceFolderPath: normalizedProject.sourceFolderPath,
      productName: normalizeText(input.productName),
      status: normalizeTaskStatus(input.status),
      aspectRatio: normalizeText(input.aspectRatio) || '3:4',
      outputCount: normalizePositiveInteger(input.outputCount, 1),
      model: normalizeText(input.model),
      promptExtra: normalizeText(input.promptExtra),
      primaryImagePath: normalizeNullableText(input.primaryImagePath),
      referenceImagePaths: normalizeStringArray(input.referenceImagePaths),
      inputImagePaths: normalizeStringArray(input.inputImagePaths),
      remoteTaskId: normalizeNullableText(input.remoteTaskId),
      latestRunId: normalizeNullableText(input.latestRunId),
      priceMinSnapshot: normalizeNullableNumber(input.priceMinSnapshot),
      priceMaxSnapshot: normalizeNullableNumber(input.priceMaxSnapshot),
      billedState: normalizeBilledState(input.billedState),
      metadata: normalizedProject.metadata
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT INTO ai_studio_tasks (
              id, template_id, provider, source_folder_path, product_name, status, aspect_ratio,
              output_count, model, prompt_extra, primary_image_path, reference_image_paths_json,
              input_image_paths_json, remote_task_id, latest_run_id, price_min_snapshot,
              price_max_snapshot, billed_state, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          record.taskId,
          record.templateId,
          record.provider,
          record.sourceFolderPath,
          record.productName,
          record.status,
          record.aspectRatio,
          record.outputCount,
          record.model,
          record.promptExtra,
          record.primaryImagePath,
          toJsonArray(record.referenceImagePaths),
          toJsonArray(record.inputImagePaths),
          record.remoteTaskId,
          record.latestRunId,
          record.priceMinSnapshot,
          record.priceMaxSnapshot,
          record.billedState,
          toJson(record.metadata),
          now,
          now
        )

      if (Array.isArray(input.assets) && input.assets.length > 0) {
        this.upsertAssets(
          input.assets.map((asset, index) => ({
            ...asset,
            taskId: record.taskId,
            sortOrder: typeof asset.sortOrder === 'number' ? asset.sortOrder : index
          }))
        )
      }
    })

    tx()
    this.ensureTaskDirectorySync(record.sourceFolderPath)
    return this.getTaskOrThrow(record.taskId)
  }

  updateTask(taskId: string, patch: AiStudioTaskUpdateInput): AiStudioTaskRecord {
    const existing = this.getTaskOrThrow(taskId)
    const nextMetadata =
      patch.metadata !== undefined
        ? mergeTaskMetadata(existing.metadata, parseJsonObject(patch.metadata))
        : existing.metadata
    const nextSourceFolderPath =
      patch.sourceFolderPath !== undefined
        ? normalizeNullableText(patch.sourceFolderPath)
        : existing.sourceFolderPath
    const normalizedProject = this.normalizeProjectStorage(
      taskId,
      nextSourceFolderPath,
      patch.productName !== undefined ? normalizeText(patch.productName) : existing.productName,
      nextMetadata
    )
    const next = {
      templateId:
        patch.templateId !== undefined
          ? normalizeNullableText(patch.templateId)
          : existing.templateId,
      provider:
        patch.provider !== undefined
          ? normalizeText(patch.provider) || existing.provider
          : existing.provider,
      sourceFolderPath: normalizedProject.sourceFolderPath,
      productName:
        patch.productName !== undefined ? normalizeText(patch.productName) : existing.productName,
      status: patch.status !== undefined ? normalizeTaskStatus(patch.status) : existing.status,
      aspectRatio:
        patch.aspectRatio !== undefined
          ? normalizeText(patch.aspectRatio) || '3:4'
          : existing.aspectRatio,
      outputCount:
        patch.outputCount !== undefined
          ? normalizePositiveInteger(patch.outputCount, existing.outputCount)
          : existing.outputCount,
      model: patch.model !== undefined ? normalizeText(patch.model) : existing.model,
      promptExtra:
        patch.promptExtra !== undefined ? normalizeText(patch.promptExtra) : existing.promptExtra,
      primaryImagePath:
        patch.primaryImagePath !== undefined
          ? normalizeNullableText(patch.primaryImagePath)
          : existing.primaryImagePath,
      referenceImagePaths:
        patch.referenceImagePaths !== undefined
          ? normalizeStringArray(patch.referenceImagePaths)
          : existing.referenceImagePaths,
      inputImagePaths:
        patch.inputImagePaths !== undefined
          ? normalizeStringArray(patch.inputImagePaths)
          : existing.inputImagePaths,
      remoteTaskId:
        patch.remoteTaskId !== undefined
          ? normalizeNullableText(patch.remoteTaskId)
          : existing.remoteTaskId,
      latestRunId:
        patch.latestRunId !== undefined
          ? normalizeNullableText(patch.latestRunId)
          : existing.latestRunId,
      priceMinSnapshot:
        patch.priceMinSnapshot !== undefined
          ? normalizeNullableNumber(patch.priceMinSnapshot)
          : existing.priceMinSnapshot,
      priceMaxSnapshot:
        patch.priceMaxSnapshot !== undefined
          ? normalizeNullableNumber(patch.priceMaxSnapshot)
          : existing.priceMaxSnapshot,
      billedState:
        patch.billedState !== undefined
          ? normalizeBilledState(patch.billedState)
          : existing.billedState,
      metadata: normalizedProject.metadata,
      updatedAt: Date.now()
    }

    this.db
      .prepare(
        `
          UPDATE ai_studio_tasks
          SET template_id = ?,
              provider = ?,
              source_folder_path = ?,
              product_name = ?,
              status = ?,
              aspect_ratio = ?,
              output_count = ?,
              model = ?,
              prompt_extra = ?,
              primary_image_path = ?,
              reference_image_paths_json = ?,
              input_image_paths_json = ?,
              remote_task_id = ?,
              latest_run_id = ?,
              price_min_snapshot = ?,
              price_max_snapshot = ?,
              billed_state = ?,
              metadata_json = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        next.templateId,
        next.provider,
        next.sourceFolderPath,
        next.productName,
        next.status,
        next.aspectRatio,
        next.outputCount,
        next.model,
        next.promptExtra,
        next.primaryImagePath,
        toJsonArray(next.referenceImagePaths),
        toJsonArray(next.inputImagePaths),
        next.remoteTaskId,
        next.latestRunId,
        next.priceMinSnapshot,
        next.priceMaxSnapshot,
        next.billedState,
        toJson(next.metadata),
        next.updatedAt,
        taskId
      )

    this.ensureTaskDirectorySync(next.sourceFolderPath)
    return this.getTaskOrThrow(taskId)
  }

  deleteTask(taskId: string): { success: boolean } {
    return { success: this.deleteTasks([taskId]).success }
  }

  deleteTasks(taskIds: string[]): { success: boolean; deletedTaskIds: string[] } {
    const normalizedTaskIds = normalizeStringArray(taskIds)
    if (normalizedTaskIds.length === 0) {
      return { success: false, deletedTaskIds: [] }
    }

    const result = this.db
      .prepare(
        `DELETE FROM ai_studio_tasks WHERE id IN (${normalizedTaskIds.map(() => '?').join(', ')})`
      )
      .run(...normalizedTaskIds) as { changes?: number }

    return {
      success: Number(result?.changes ?? 0) > 0,
      deletedTaskIds: normalizedTaskIds
    }
  }

  resolveProjectDeletionPlan(taskId: string): AiStudioProjectDeletionPlan {
    const normalizedTaskId = normalizeText(taskId)
    if (!normalizedTaskId) throw new Error('[AI Studio] taskId 不能为空。')

    const listedTasks = this.listTasks({ limit: 10000 })
    const taskMap = new Map(listedTasks.map((task) => [task.id, task]))
    const seedTask = taskMap.get(normalizedTaskId) ?? this.getTaskOrThrow(normalizedTaskId)
    const seedProject = this.resolveTaskProjectContext(seedTask)

    const projectTasks = new Map<string, AiStudioTaskRecord>()
    for (const task of [...listedTasks, seedTask]) {
      const project = this.resolveTaskProjectContext(task)
      if (project.projectId !== seedProject.projectId) continue
      projectTasks.set(task.id, task)
    }

    const groupedTasks = Array.from(projectTasks.values())
    const rootTask =
      groupedTasks.find((task) => task.id === seedProject.projectRootTaskId) ?? seedTask
    const rootProject = this.resolveTaskProjectContext(rootTask)

    return {
      projectId: seedProject.projectId,
      projectRootTaskId: rootProject.projectRootTaskId || seedProject.projectRootTaskId,
      projectName: rootProject.projectName || seedProject.projectName || '未命名项目',
      projectPath:
        rootProject.projectPath ||
        groupedTasks
          .map((task) => this.resolveTaskProjectContext(task).projectPath)
          .find((path) => Boolean(path)) ||
        null,
      taskIds: Array.from(projectTasks.keys())
    }
  }

  listTasks(query?: { status?: string; ids?: string[]; limit?: number }): AiStudioTaskRecord[] {
    const where: string[] = []
    const params: unknown[] = []

    const status = normalizeText(query?.status)
    if (status) {
      where.push('status = ?')
      params.push(status)
    }

    const ids = normalizeStringArray(query?.ids)
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => '?').join(', ')})`)
      params.push(...ids)
    }

    const limit = normalizePositiveInteger(query?.limit, 200)
    const sql = `
      SELECT *
      FROM ai_studio_tasks
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `

    const rows = this.db.prepare(sql).all(...params, limit)
    return rows.map(mapTaskRow)
  }

  upsertAssets(inputs: AiStudioAssetWriteInput[]): AiStudioAssetRecord[] {
    if (!Array.isArray(inputs) || inputs.length === 0) return []
    const now = Date.now()
    const persistedIds: string[] = []
    const tx = this.db.transaction(() => {
      for (const input of inputs) {
        const id = normalizeText(input.id) || randomUUID()
        persistedIds.push(id)
        const taskId = normalizeText(input.taskId)
        if (!taskId) throw new Error('[AI Studio] 资产必须绑定 taskId。')
        const filePath = normalizeText(input.filePath)
        if (!filePath) throw new Error('[AI Studio] 资产 filePath 不能为空。')
        this.db
          .prepare(
            `
              INSERT INTO ai_studio_assets (
                id, task_id, run_id, kind, role, file_path, preview_path, origin_path,
                selected, sort_order, metadata_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                task_id = excluded.task_id,
                run_id = excluded.run_id,
                kind = excluded.kind,
                role = excluded.role,
                file_path = excluded.file_path,
                preview_path = excluded.preview_path,
                origin_path = excluded.origin_path,
                selected = excluded.selected,
                sort_order = excluded.sort_order,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            `
          )
          .run(
            id,
            taskId,
            normalizeNullableText(input.runId),
            normalizeText(input.kind) === 'output' ? 'output' : 'input',
            normalizeText(input.role) || 'candidate',
            filePath,
            normalizeNullableText(input.previewPath),
            normalizeNullableText(input.originPath),
            input.selected === true ? 1 : 0,
            typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)
              ? Math.floor(input.sortOrder)
              : 0,
            toJson(input.metadata ?? {}),
            now,
            now
          )
      }
    })

    tx()
    return this.listAssets({ ids: persistedIds })
  }

  listAssets(query?: {
    taskId?: string
    runId?: string
    kind?: string
    ids?: string[]
  }): AiStudioAssetRecord[] {
    const where: string[] = []
    const params: unknown[] = []

    const taskId = normalizeText(query?.taskId)
    if (taskId) {
      where.push('task_id = ?')
      params.push(taskId)
    }

    const runId = normalizeText(query?.runId)
    if (runId) {
      where.push('run_id = ?')
      params.push(runId)
    }

    const kind = normalizeText(query?.kind)
    if (kind) {
      where.push('kind = ?')
      params.push(kind)
    }

    const ids = normalizeStringArray(query?.ids)
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => '?').join(', ')})`)
      params.push(...ids)
    }

    const sql = `
      SELECT *
      FROM ai_studio_assets
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY sort_order ASC, created_at ASC
    `

    const rows = this.db.prepare(sql).all(...params)
    return rows.map(mapAssetRow)
  }

  async ensureTaskRunDirectory(
    taskId: string,
    runIndex?: number
  ): Promise<{
    taskId: string
    runIndex: number
    dirPath: string
  }> {
    const normalizedTaskId = normalizeText(taskId)
    if (!normalizedTaskId) throw new Error('[AI Studio] taskId 不能为空。')
    const task = this.getTaskOrThrow(normalizedTaskId)

    let resolvedRunIndex = runIndex
    if (!resolvedRunIndex || resolvedRunIndex <= 0) {
      const row = this.db
        .prepare(
          `SELECT COALESCE(MAX(run_index), 0) AS max_run_index FROM ai_studio_runs WHERE task_id = ?`
        )
        .get(normalizedTaskId)
      const maxRunIndex = Number(row?.max_run_index ?? 0) || 0
      resolvedRunIndex = maxRunIndex + 1
    }

    const projectMeta = readAiStudioProjectMetadata(task.metadata)
    const projectPath =
      projectMeta?.projectPath ||
      (projectMeta?.projectId ? normalizeText(task.sourceFolderPath) : '') ||
      (projectMeta?.projectId
        ? this.buildProjectDirectoryPath(projectMeta.projectName, projectMeta.projectId)
        : '')
    const dirPath = projectPath
      ? join(
          projectPath,
          'tasks',
          normalizedTaskId,
          `run-${String(resolvedRunIndex).padStart(3, '0')}`
        )
      : join(
          this.getWorkspacePath(),
          'ai-studio',
          'tasks',
          normalizedTaskId,
          `run-${String(resolvedRunIndex).padStart(3, '0')}`
        )
    await mkdir(dirPath, { recursive: true })

    return {
      taskId: normalizedTaskId,
      runIndex: resolvedRunIndex,
      dirPath
    }
  }

  async recordRunAttempt(input: AiStudioRunWriteInput): Promise<AiStudioRunRecord> {
    const taskId = normalizeText(input.taskId)
    if (!taskId) throw new Error('[AI Studio] taskId 不能为空。')
    this.getTaskOrThrow(taskId)

    const now = Date.now()
    const existingRunId = normalizeText(input.runId)
    const existingRun = existingRunId ? this.getRunById(existingRunId) : null

    if (existingRun) {
      const next = {
        provider: normalizeText(input.provider) || existingRun.provider,
        status: normalizeText(input.status) || existingRun.status,
        remoteTaskId:
          input.remoteTaskId !== undefined
            ? normalizeNullableText(input.remoteTaskId)
            : existingRun.remoteTaskId,
        billedState:
          input.billedState !== undefined
            ? normalizeBilledState(input.billedState)
            : existingRun.billedState,
        priceMinSnapshot:
          input.priceMinSnapshot !== undefined
            ? normalizeNullableNumber(input.priceMinSnapshot)
            : existingRun.priceMinSnapshot,
        priceMaxSnapshot:
          input.priceMaxSnapshot !== undefined
            ? normalizeNullableNumber(input.priceMaxSnapshot)
            : existingRun.priceMaxSnapshot,
        requestPayload:
          input.requestPayload !== undefined
            ? parseJsonObject(input.requestPayload)
            : existingRun.requestPayload,
        responsePayload:
          input.responsePayload !== undefined
            ? parseJsonObject(input.responsePayload)
            : existingRun.responsePayload,
        errorMessage:
          input.errorMessage !== undefined
            ? normalizeNullableText(input.errorMessage)
            : existingRun.errorMessage,
        startedAt:
          input.startedAt !== undefined
            ? normalizeNullableNumber(input.startedAt)
            : existingRun.startedAt,
        finishedAt:
          input.finishedAt !== undefined
            ? normalizeNullableNumber(input.finishedAt)
            : existingRun.finishedAt,
        updatedAt: now
      }

      this.db
        .prepare(
          `
            UPDATE ai_studio_runs
            SET provider = ?,
                status = ?,
                remote_task_id = ?,
                billed_state = ?,
                price_min_snapshot = ?,
                price_max_snapshot = ?,
                request_payload_json = ?,
                response_payload_json = ?,
                error_message = ?,
                started_at = ?,
                finished_at = ?,
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          next.provider,
          next.status,
          next.remoteTaskId,
          next.billedState,
          next.priceMinSnapshot,
          next.priceMaxSnapshot,
          toJson(next.requestPayload),
          toJson(next.responsePayload),
          next.errorMessage,
          next.startedAt,
          next.finishedAt,
          next.updatedAt,
          existingRun.id
        )

      this.updateTask(taskId, {
        latestRunId: existingRun.id,
        remoteTaskId: next.remoteTaskId,
        priceMinSnapshot: next.priceMinSnapshot,
        priceMaxSnapshot: next.priceMaxSnapshot,
        billedState: next.billedState,
        status:
          next.status === 'succeeded'
            ? 'completed'
            : next.status === 'failed'
              ? 'failed'
              : next.status === 'queued' || next.status === 'submitted' || next.status === 'running'
                ? 'running'
                : undefined
      })

      return this.getRunById(existingRun.id) as AiStudioRunRecord
    }

    const ensuredDir = await this.ensureTaskRunDirectory(taskId)
    const runId = randomUUID()
    const provider = normalizeText(input.provider) || 'grsai'
    const status = normalizeText(input.status) || 'queued'
    const remoteTaskId = normalizeNullableText(input.remoteTaskId)
    const billedState = normalizeBilledState(input.billedState)
    const priceMinSnapshot = normalizeNullableNumber(input.priceMinSnapshot)
    const priceMaxSnapshot = normalizeNullableNumber(input.priceMaxSnapshot)
    const requestPayload = parseJsonObject(input.requestPayload)
    const responsePayload = parseJsonObject(input.responsePayload)
    const errorMessage = normalizeNullableText(input.errorMessage)
    const startedAt = input.startedAt !== undefined ? normalizeNullableNumber(input.startedAt) : now
    const finishedAt =
      input.finishedAt !== undefined ? normalizeNullableNumber(input.finishedAt) : null

    this.db
      .prepare(
        `
          INSERT INTO ai_studio_runs (
            id, task_id, run_index, provider, status, remote_task_id, billed_state,
            price_min_snapshot, price_max_snapshot, run_dir, request_payload_json,
            response_payload_json, error_message, started_at, finished_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        runId,
        taskId,
        ensuredDir.runIndex,
        provider,
        status,
        remoteTaskId,
        billedState,
        priceMinSnapshot,
        priceMaxSnapshot,
        ensuredDir.dirPath,
        toJson(requestPayload),
        toJson(responsePayload),
        errorMessage,
        startedAt,
        finishedAt,
        now,
        now
      )

    this.updateTask(taskId, {
      latestRunId: runId,
      remoteTaskId,
      priceMinSnapshot,
      priceMaxSnapshot,
      billedState,
      status:
        status === 'succeeded'
          ? 'completed'
          : status === 'failed'
            ? 'failed'
            : status === 'queued' || status === 'submitted' || status === 'running'
              ? 'running'
              : undefined
    })

    return this.getRunById(runId) as AiStudioRunRecord
  }

  updateBilledState(payload: {
    taskId: string
    billedState: AiStudioBilledState
    priceMinSnapshot?: number | null
    priceMaxSnapshot?: number | null
    runId?: string | null
    remoteTaskId?: string | null
  }): AiStudioTaskRecord {
    const taskId = normalizeText(payload.taskId)
    if (!taskId) throw new Error('[AI Studio] taskId 不能为空。')

    const billedState = normalizeBilledState(payload.billedState)
    const priceMinSnapshot = normalizeNullableNumber(payload.priceMinSnapshot)
    const priceMaxSnapshot = normalizeNullableNumber(payload.priceMaxSnapshot)
    const remoteTaskId = normalizeNullableText(payload.remoteTaskId)

    const nextTask = this.updateTask(taskId, {
      billedState,
      priceMinSnapshot,
      priceMaxSnapshot,
      remoteTaskId: remoteTaskId ?? undefined
    })

    const runId = normalizeText(payload.runId)
    if (runId) {
      const now = Date.now()
      this.db
        .prepare(
          `
            UPDATE ai_studio_runs
            SET billed_state = ?,
                price_min_snapshot = ?,
                price_max_snapshot = ?,
                remote_task_id = COALESCE(?, remote_task_id),
                updated_at = ?
            WHERE id = ? AND task_id = ?
          `
        )
        .run(billedState, priceMinSnapshot, priceMaxSnapshot, remoteTaskId, now, runId, taskId)
    }

    return nextTask
  }

  markSelectedOutputs(payload: {
    taskId: string
    assetIds: string[]
    selected?: boolean
    clearOthers?: boolean
  }): AiStudioAssetRecord[] {
    const taskId = normalizeText(payload.taskId)
    if (!taskId) throw new Error('[AI Studio] taskId 不能为空。')
    this.getTaskOrThrow(taskId)

    const assetIds = normalizeStringArray(payload.assetIds)
    const shouldSelect = payload.selected !== false
    const clearOthers = payload.clearOthers === true
    const now = Date.now()

    const tx = this.db.transaction(() => {
      if (clearOthers) {
        if (assetIds.length > 0) {
          this.db
            .prepare(
              `UPDATE ai_studio_assets SET selected = 0, updated_at = ? WHERE task_id = ? AND kind = 'output' AND id NOT IN (${assetIds.map(() => '?').join(', ')})`
            )
            .run(now, taskId, ...assetIds)
        } else {
          this.db
            .prepare(
              `UPDATE ai_studio_assets SET selected = 0, updated_at = ? WHERE task_id = ? AND kind = 'output'`
            )
            .run(now, taskId)
        }
      }

      if (assetIds.length > 0) {
        this.db
          .prepare(
            `UPDATE ai_studio_assets SET selected = ?, updated_at = ? WHERE task_id = ? AND kind = 'output' AND id IN (${assetIds.map(() => '?').join(', ')})`
          )
          .run(shouldSelect ? 1 : 0, now, taskId, ...assetIds)
      }
    })

    tx()
    return this.listAssets({ taskId, kind: 'output' })
  }
}
