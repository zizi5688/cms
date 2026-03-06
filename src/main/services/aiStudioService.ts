import { randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { join, resolve } from 'path'

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
  constructor(private readonly resolveWorkspacePath: () => string) {}

  private get db(): DbConnection {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) {
      throw new Error('[AI Studio] SQLite 未初始化。')
    }
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

  listTemplates(): AiStudioTemplateRecord[] {
    const rows = this.db.prepare(`SELECT * FROM ai_studio_templates ORDER BY updated_at DESC, created_at DESC`).all()
    return rows.map(mapTemplateRow)
  }

  upsertTemplate(input: {
    id?: string
    provider?: string
    name: string
    promptText?: string
    config?: Record<string, unknown>
  }): AiStudioTemplateRecord {
    const id = normalizeText(input.id) || randomUUID()
    const provider = normalizeText(input.provider) || 'grsai'
    const name = normalizeText(input.name)
    if (!name) throw new Error('[AI Studio] 模板名称不能为空。')
    const promptText = normalizeText(input.promptText)
    const now = Date.now()
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

    return mapTemplateRow(this.db.prepare(`SELECT * FROM ai_studio_templates WHERE id = ? LIMIT 1`).get(id) ?? {})
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
      templateId: patch.templateId !== undefined ? normalizeNullableText(patch.templateId) : existing.templateId,
      provider: patch.provider !== undefined ? normalizeText(patch.provider) || existing.provider : existing.provider,
      sourceFolderPath:
        patch.sourceFolderPath !== undefined ? normalizeNullableText(patch.sourceFolderPath) : existing.sourceFolderPath,
      productName: patch.productName !== undefined ? normalizeText(patch.productName) : existing.productName,
      status: patch.status !== undefined ? normalizeTaskStatus(patch.status) : existing.status,
      aspectRatio: patch.aspectRatio !== undefined ? normalizeText(patch.aspectRatio) || '3:4' : existing.aspectRatio,
      outputCount:
        patch.outputCount !== undefined ? normalizePositiveInteger(patch.outputCount, existing.outputCount) : existing.outputCount,
      model: patch.model !== undefined ? normalizeText(patch.model) : existing.model,
      promptExtra: patch.promptExtra !== undefined ? normalizeText(patch.promptExtra) : existing.promptExtra,
      primaryImagePath:
        patch.primaryImagePath !== undefined ? normalizeNullableText(patch.primaryImagePath) : existing.primaryImagePath,
      referenceImagePaths:
        patch.referenceImagePaths !== undefined ? normalizeStringArray(patch.referenceImagePaths) : existing.referenceImagePaths,
      inputImagePaths:
        patch.inputImagePaths !== undefined ? normalizeStringArray(patch.inputImagePaths) : existing.inputImagePaths,
      remoteTaskId: patch.remoteTaskId !== undefined ? normalizeNullableText(patch.remoteTaskId) : existing.remoteTaskId,
      latestRunId: patch.latestRunId !== undefined ? normalizeNullableText(patch.latestRunId) : existing.latestRunId,
      priceMinSnapshot:
        patch.priceMinSnapshot !== undefined ? normalizeNullableNumber(patch.priceMinSnapshot) : existing.priceMinSnapshot,
      priceMaxSnapshot:
        patch.priceMaxSnapshot !== undefined ? normalizeNullableNumber(patch.priceMaxSnapshot) : existing.priceMaxSnapshot,
      billedState:
        patch.billedState !== undefined ? normalizeBilledState(patch.billedState) : existing.billedState,
      metadata: patch.metadata !== undefined ? parseJsonObject(patch.metadata) : existing.metadata,
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
    const result = this.db.prepare(`DELETE FROM ai_studio_tasks WHERE id = ?`).run(normalizedTaskId) as { changes?: number }
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
            typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder) ? Math.floor(input.sortOrder) : 0,
            toJson(input.metadata ?? {}),
            now,
            now
          )
      }
    })

    tx()
    return this.listAssets({ ids: persistedIds })
  }

  listAssets(query?: { taskId?: string; runId?: string; kind?: string; ids?: string[] }): AiStudioAssetRecord[] {
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

  async ensureTaskRunDirectory(taskId: string, runIndex?: number): Promise<{
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
        .prepare(`SELECT COALESCE(MAX(run_index), 0) AS max_run_index FROM ai_studio_runs WHERE task_id = ?`)
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
          input.remoteTaskId !== undefined ? normalizeNullableText(input.remoteTaskId) : existingRun.remoteTaskId,
        billedState:
          input.billedState !== undefined ? normalizeBilledState(input.billedState) : existingRun.billedState,
        priceMinSnapshot:
          input.priceMinSnapshot !== undefined ? normalizeNullableNumber(input.priceMinSnapshot) : existingRun.priceMinSnapshot,
        priceMaxSnapshot:
          input.priceMaxSnapshot !== undefined ? normalizeNullableNumber(input.priceMaxSnapshot) : existingRun.priceMaxSnapshot,
        requestPayload:
          input.requestPayload !== undefined ? parseJsonObject(input.requestPayload) : existingRun.requestPayload,
        responsePayload:
          input.responsePayload !== undefined ? parseJsonObject(input.responsePayload) : existingRun.responsePayload,
        errorMessage:
          input.errorMessage !== undefined ? normalizeNullableText(input.errorMessage) : existingRun.errorMessage,
        startedAt: input.startedAt !== undefined ? normalizeNullableNumber(input.startedAt) : existingRun.startedAt,
        finishedAt: input.finishedAt !== undefined ? normalizeNullableNumber(input.finishedAt) : existingRun.finishedAt,
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
    const finishedAt = input.finishedAt !== undefined ? normalizeNullableNumber(input.finishedAt) : null

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
            .prepare(`UPDATE ai_studio_assets SET selected = 0, updated_at = ? WHERE task_id = ? AND kind = 'output'`)
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
