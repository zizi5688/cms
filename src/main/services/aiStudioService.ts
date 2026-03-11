import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, extname, join, resolve } from 'path'

import { buildGeminiGenerationConfig, resolveImageSizeForModel } from './aiStudioRequestPayloadHelpers'
import { SqliteService } from './sqliteService'

export type AiStudioTemplateRecord = {
  id: string
  provider: string
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
}

type DbConnection = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown
    get: (...args: unknown[]) => Record<string, unknown> | undefined
    all: (...args: unknown[]) => Array<Record<string, unknown>>
  }
  transaction: <T extends (...args: unknown[]) => unknown>(fn: T) => T
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
const GRSAI_POLL_WEBHOOK_SENTINEL = '-1'
const DEFAULT_IMAGE_MODEL = 'nano-banana-fast'
const LEGACY_DEFAULT_IMAGE_MODEL = 'image-default'
const DEFAULT_ADD_WATERMARK = false
const CONNECTION_TEST_ID = '__codex_connection_test__'
const HTTP_IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const GRSAI_PRICE_FALLBACKS: Record<string, { min: number; max: number }> = {
  'nano-banana-fast': { min: 0.022, max: 0.044 },
  'nano-banana': { min: 0.04, max: 0.08 },
  'nano-banana-pro': { min: 0.08, max: 0.16 },
  'gemini-2.5-flash-image-preview': { min: 0.022, max: 0.044 },
  'image-default': { min: 0.022, max: 0.044 }
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

function normalizeAspectRatio(value: unknown): string {
  const normalized = normalizeText(value)
  if (
    normalized === '1:1' ||
    normalized === '3:4' ||
    normalized === '9:16' ||
    normalized === 'auto'
  ) {
    return normalized
  }
  return '3:4'
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
    normalizeNullableText(payload.taskId) ??
    normalizeNullableText(payload.task_id) ??
    (options?.allowTopLevelId === false ? null : normalizeNullableText(payload.id)) ??
    null
  )
}

function isGeminiGenerateContentPath(apiPath: string): boolean {
  return /:generatecontent(?:$|[?#])/i.test(normalizeText(apiPath))
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
  outputCount: number
  referenceCount: number
}): string {
  const lines = [normalizeText(payload.prompt)]
  if (payload.aspectRatio) {
    lines.push(`输出比例：${payload.aspectRatio}。`)
  }
  if (payload.referenceCount > 0) {
    lines.push(
      `第 1 张输入图为主图，后续 ${payload.referenceCount} 张为参考图，请保留主体材质、结构与关键细节。`
    )
  } else {
    lines.push('请保留主体材质、结构与关键细节。')
  }
  return lines.filter(Boolean).join('\n')
}

function buildChatCompletionsPayload(payload: {
  model: string
  prompt: string
  aspectRatio: string
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
  const parts: Array<Record<string, unknown>> = [
    {
      text: buildImagePromptDirective({
        prompt: payload.prompt,
        aspectRatio: payload.aspectRatio,
        outputCount: payload.outputCount,
        referenceCount: payload.referenceCount
      })
    }
  ]

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

  return {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: buildGeminiGenerationConfig({
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize
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
    normalizeNullableText(payloadError?.message) ??
    normalizeNullableText(payloadError?.msg) ??
    normalizeNullableText(payload.detail) ??
    normalizeNullableText(data.failure_reason) ??
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

type AiStudioWorkflowSourceDescriptor = {
  activeStage: string
  currentAiMasterAssetId: string | null
  sourcePrimaryImagePath: string | null
  sourceReferenceImagePaths: string[]
  useCurrentAiMasterAsPrimary: boolean
}

function readWorkflowSourceDescriptor(task: AiStudioTaskRecord): AiStudioWorkflowSourceDescriptor {
  const metadata = parseJsonObject(task.metadata)
  const workflow = asObject(metadata.workflow)
  const activeStage = normalizeText(workflow.activeStage)
  const useCurrentAiMasterAsPrimary =
    activeStage === 'child-ready' ||
    activeStage === 'child-generating' ||
    activeStage === 'completed'

  const metadataReferencePaths = normalizeStringArray(workflow.sourceReferenceImagePaths)

  return {
    activeStage,
    currentAiMasterAssetId: useCurrentAiMasterAsPrimary
      ? normalizeNullableText(workflow.currentAiMasterAssetId)
      : null,
    sourcePrimaryImagePath: useCurrentAiMasterAsPrimary
      ? (normalizeNullableText(workflow.sourcePrimaryImagePath) ?? task.primaryImagePath)
      : task.primaryImagePath,
    sourceReferenceImagePaths: useCurrentAiMasterAsPrimary
      ? metadataReferencePaths.length > 0
        ? metadataReferencePaths
        : task.referenceImagePaths
      : task.referenceImagePaths,
    useCurrentAiMasterAsPrimary
  }
}

function uniqueNormalizedPaths(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)))
}

function mapTemplateRow(row: Record<string, unknown>): AiStudioTemplateRecord {
  return {
    id: normalizeText(row.id),
    provider: normalizeText(row.provider) || 'grsai',
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
    name: string
  ): AiStudioTemplateRecord | null {
    const normalizedProvider = normalizeText(provider)
    const normalizedName = normalizeText(name)
    if (!normalizedProvider || !normalizedName) return null
    const row = this.db
      .prepare(`SELECT * FROM ai_studio_templates WHERE provider = ? AND name = ? LIMIT 1`)
      .get(normalizedProvider, normalizedName)
    return row ? mapTemplateRow(row) : null
  }

  private getProviderConfig(): AiStudioProviderConfig {
    const provided = asObject(this.resolveProviderConfig())
    return {
      provider: normalizeText(provided.provider) || 'grsai',
      baseUrl: sanitizeBaseUrl(normalizeText(provided.baseUrl)),
      apiKey: normalizeText(provided.apiKey),
      defaultImageModel: resolveConfiguredModel(provided.defaultImageModel, DEFAULT_IMAGE_MODEL),
      endpointPath: normalizeText(provided.endpointPath)
    }
  }

  private async requestProvider(
    apiPath: string,
    payload: Record<string, unknown>,
    options?: {
      method?: 'POST' | 'OPTIONS' | 'GET' | 'HEAD'
      allowStatusCodes?: number[]
      allowProviderCodes?: number[]
    }
  ): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    const config = this.getProviderConfig()
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
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(payload)
    }

    const requestUrl = buildProviderUrl(config.baseUrl, apiPath)
    const response = await fetch(requestUrl, init)

    const statusCode = response.status
    const rawText = await response.text()
    let parsedPayload: Record<string, unknown> = {}
    if (rawText) {
      try {
        parsedPayload = asObject(JSON.parse(rawText))
      } catch {
        parsedPayload = { rawText }
      }
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
        extractFailureReason(parsedPayload) ??
          `[AI Studio] AI 服务请求失败（HTTP ${statusCode}，${method} ${apiPath}）。`
      )
    }

    const providerCode = parseProviderCode(parsedPayload.code)
    const allowProviderCodes = new Set(options?.allowProviderCodes ?? [])
    if (providerCode !== null && providerCode !== 0 && !allowProviderCodes.has(providerCode)) {
      throw new Error(
        extractFailureReason(parsedPayload) ??
          `[AI Studio] AI 服务请求失败（业务码 ${providerCode}）。`
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

    if (!primaryImagePath) {
      throw new Error('[AI Studio] 请先设置主图后再开始生成。')
    }

    const config = this.getProviderConfig()
    const template = this.getTemplateById(task.templateId)
    const prompt = resolvePrompt(task, template)
    const model = resolveConfiguredModel(
      task.model,
      config.defaultImageModel || DEFAULT_IMAGE_MODEL
    )
    const sourceImagePaths = uniqueNormalizedPaths([
      primaryImagePath,
      ...workflowSource.sourceReferenceImagePaths
    ])
    if (sourceImagePaths.length === 0) {
      throw new Error('[AI Studio] 至少需要一张输入图片。')
    }

    const urls = await Promise.all(sourceImagePaths.map((filePath) => filePathToDataUrl(filePath)))
    const aspectRatio = normalizeAspectRatio(task.aspectRatio)
    const endpointPath = config.endpointPath || GRSAI_DRAW_PATH
    const imageSize = resolveImageSizeForModel(model)

    const requestPayload = isChatCompletionsPath(endpointPath)
      ? buildChatCompletionsPayload({
          model,
          prompt,
          aspectRatio,
          outputCount: task.outputCount,
          urls,
          referenceCount: Math.max(0, urls.length - 1)
        })
      : isGeminiGenerateContentPath(endpointPath)
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
      : isGeminiGenerateContentPath(endpointPath)
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

  private async persistFailedSubmit(
    taskId: string,
    requestSnapshot: Record<string, unknown>,
    errorMessage: string
  ): Promise<void> {
    await this.recordRunAttempt({
      taskId,
      provider: this.getProviderConfig().provider,
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

  async testConnection(): Promise<AiStudioProviderConnectionResult> {
    const config = this.getProviderConfig()
    const checkedAt = Date.now()
    const connectionApiPath = config.endpointPath || GRSAI_RESULT_PATH
    const isCustomEndpoint = Boolean(config.endpointPath)
    const looksLikeGeminiGenerateContent = isGeminiGenerateContentPath(connectionApiPath)
    const looksLikeChatCompletions = isChatCompletionsPath(connectionApiPath)

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
        : isCustomEndpoint
          ? {}
          : { id: CONNECTION_TEST_ID }

    const response = await this.requestProvider(
      connectionApiPath,
      probePayload,
      looksLikeChatCompletions || looksLikeGeminiGenerateContent
        ? undefined
        : isCustomEndpoint
          ? {
              method: 'POST',
              allowStatusCodes: [400, 405, 422],
              allowProviderCodes: [-22]
            }
          : { allowStatusCodes: [400], allowProviderCodes: [-22] }
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
    const config = this.getProviderConfig()
    const context = await this.buildSubmitContext(taskId)
    const priceSnapshot = await this.resolvePriceSnapshot(context.model)
    const submitApiPath = config.endpointPath || GRSAI_DRAW_PATH
    const looksLikeChatCompletions = isChatCompletionsPath(submitApiPath)
    const looksLikeGeminiGenerateContent = isGeminiGenerateContentPath(submitApiPath)

    try {
      const response = await this.requestProvider(submitApiPath, context.requestPayload)
      this.persistLatestSubmittedPrompt(taskId, context.requestSnapshot)
      const directResultItems = extractResultItems(response.payload)

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

        const outputs = await this.downloadOutputs({
          taskId,
          runId: run.id,
          responsePayload: response.payload
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

      return toExecutionResult(
        this.getTaskOrThrow(taskId),
        run,
        this.listAssets({ taskId, runId: run.id, kind: 'output' })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.persistLatestSubmittedPrompt(taskId, context.requestSnapshot)
      await this.persistFailedSubmit(taskId, context.requestSnapshot, message)
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

  async pollRunResult(payload: {
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

    const response = await this.requestProvider(GRSAI_RESULT_PATH, { id: existingRun.remoteTaskId })
    const status = extractResultStatus(response.payload, existingRun.status)
    const errorMessage = status === 'failed' ? extractFailureReason(response.payload) : null

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
        ? await this.downloadOutputs({ taskId, runId: run.id, responsePayload: response.payload })
        : this.listAssets({ taskId, runId: run.id, kind: 'output' })

    return toExecutionResult(this.getTaskOrThrow(taskId), run, outputs)
  }

  async startRun(taskId: string): Promise<AiStudioRunExecutionResult> {
    return this.submitImageRun(taskId)
  }

  async retryRun(taskId: string): Promise<AiStudioRunExecutionResult> {
    return this.submitImageRun(taskId)
  }

  getRun(runId: string): AiStudioRunRecord | null {
    const normalizedRunId = normalizeText(runId)
    if (!normalizedRunId) return null
    return this.getRunById(normalizedRunId)
  }

  listTemplates(): AiStudioTemplateRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM ai_studio_templates ORDER BY updated_at DESC, created_at DESC`)
      .all()
    return rows.map(mapTemplateRow)
  }

  deleteTemplate(templateId: string): { success: boolean } {
    const normalizedId = normalizeText(templateId)
    if (!normalizedId) return { success: false }
    const changes = Number(
      (this.db.prepare(`DELETE FROM ai_studio_templates WHERE id = ?`).run(normalizedId) as { changes?: unknown })
        ?.changes ?? 0
    )
    return { success: Number.isFinite(changes) && changes > 0 }
  }

  upsertTemplate(input: {
    id?: string
    provider?: string
    name: string
    promptText?: string
    config?: Record<string, unknown>
  }): AiStudioTemplateRecord {
    const provider = normalizeText(input.provider) || 'grsai'
    const name = normalizeText(input.name)
    if (!name) throw new Error('[AI Studio] 模板名称不能为空。')
    const existing = this.getTemplateByProviderAndName(provider, name)
    const normalizedId = normalizeText(input.id)
    const id = normalizedId || existing?.id || randomUUID()
    const promptText = normalizeText(input.promptText)
    const now = Date.now()

    try {
      this.db
        .prepare(
          `
            INSERT INTO ai_studio_templates (
              id, provider, name, prompt_text, config_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              provider = excluded.provider,
              name = excluded.name,
              prompt_text = excluded.prompt_text,
              config_json = excluded.config_json,
              updated_at = excluded.updated_at;
          `
        )
        .run(id, provider, name, promptText, toJson(input.config ?? {}), now, now)
    } catch (error) {
      if (
        error instanceof Error &&
        /ai_studio_templates\.provider,\s*ai_studio_templates\.name/i.test(error.message)
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
    const record = {
      taskId,
      templateId: normalizeNullableText(input.templateId),
      provider: normalizeText(input.provider) || 'grsai',
      sourceFolderPath: normalizeNullableText(input.sourceFolderPath),
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
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
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
    return this.getTaskOrThrow(record.taskId)
  }

  updateTask(taskId: string, patch: AiStudioTaskUpdateInput): AiStudioTaskRecord {
    const existing = this.getTaskOrThrow(taskId)
    const next = {
      templateId:
        patch.templateId !== undefined
          ? normalizeNullableText(patch.templateId)
          : existing.templateId,
      provider:
        patch.provider !== undefined
          ? normalizeText(patch.provider) || existing.provider
          : existing.provider,
      sourceFolderPath:
        patch.sourceFolderPath !== undefined
          ? normalizeNullableText(patch.sourceFolderPath)
          : existing.sourceFolderPath,
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
      metadata:
        patch.metadata !== undefined
          ? mergeTaskMetadata(existing.metadata, parseJsonObject(patch.metadata))
          : existing.metadata,
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

    return this.getTaskOrThrow(taskId)
  }

  deleteTask(taskId: string): { success: boolean } {
    const normalizedTaskId = normalizeText(taskId)
    if (!normalizedTaskId) return { success: false }
    const result = this.db
      .prepare(`DELETE FROM ai_studio_tasks WHERE id = ?`)
      .run(normalizedTaskId) as { changes?: number }
    return { success: Number(result?.changes ?? 0) > 0 }
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
    this.getTaskOrThrow(normalizedTaskId)

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

    const dirPath = join(
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
