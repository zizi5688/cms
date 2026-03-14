import type { PublishTask } from '../taskManager'
import { SqliteService } from './sqliteService'

export type QueuedTask = Omit<PublishTask, 'scheduledAt'> & {
  scheduledAt: number | null
  lockedAt: number | null
  retryCount: number
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const text = value.trim()
  if (!text) return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

export class QueueService {
  private static instance: QueueService | null = null

  static getInstance(): QueueService {
    if (!QueueService.instance) QueueService.instance = new QueueService()
    return QueueService.instance
  }

  private constructor() {}

  hasProcessingTasks(): boolean {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) return false
    try {
      const row = sqlite.connection
        .prepare(`SELECT COUNT(1) AS count FROM tasks WHERE status = 'processing'`)
        .get() as { count?: unknown } | undefined
      const count = Number(row?.count ?? 0)
      return Number.isFinite(count) && count > 0
    } catch {
      return false
    }
  }

  recoverStalledTasks(timeoutMs = 300000): number {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) return 0

    const now = Date.now()
    const threshold = now - Math.max(0, Number(timeoutMs) || 0)

    const rows = sqlite.connection
      .prepare(
        `
          UPDATE tasks
          SET status = 'pending', locked_at = NULL
          WHERE status = 'processing'
            AND locked_at IS NOT NULL
            AND locked_at < ?
          RETURNING id;
        `
      )
      .all(threshold) as Array<{ id?: unknown }>

    for (const row of rows) {
      const id = String(row?.id ?? '').trim()
      if (id) console.warn(`Recovered stalled task: ${id}`)
    }

    return rows.length
  }

  markStalledTasksAsFailed(timeoutMs = 300000): number {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) return 0

    const now = Date.now()
    const threshold = now - Math.max(0, Number(timeoutMs) || 0)
    const errorMsg = '[System] 异常中断：发布期间应用退出或崩溃'

    const rows = sqlite.connection
      .prepare(
        `
          UPDATE tasks
          SET status = 'failed',
              errorMsg = ?,
              locked_at = NULL
          WHERE status = 'processing'
            AND locked_at IS NOT NULL
            AND locked_at < ?
          RETURNING id;
        `
      )
      .all(errorMsg, threshold) as Array<{ id?: unknown }>

    for (const row of rows) {
      const id = String(row?.id ?? '').trim()
      if (id) console.warn(`Marked stalled task as failed: ${id}`)
    }

    return rows.length
  }

  acquireNextTask(options?: { accountId?: string; taskIds?: string[] }): QueuedTask | null {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) return null

    const now = Date.now()
    const accountId = typeof options?.accountId === 'string' ? options.accountId.trim() : ''
    const taskIds =
      Array.isArray(options?.taskIds) && options!.taskIds.length > 0
        ? options!.taskIds.map((v) => String(v ?? '').trim()).filter(Boolean)
        : []
    const uniqueTaskIds = taskIds.length ? Array.from(new Set(taskIds)) : []

    const where: string[] = [`status = 'pending'`, `scheduledAt IS NOT NULL`, `scheduledAt <= ?`]
    const selectParams: unknown[] = [now]
    if (accountId) {
      where.push(`accountId = ?`)
      selectParams.push(accountId)
    }
    if (uniqueTaskIds.length) {
      const placeholders = uniqueTaskIds.map(() => '?').join(', ')
      where.push(`id IN (${placeholders})`)
      selectParams.push(...uniqueTaskIds)
    }
    const row = sqlite.connection
      .prepare(
        `
          UPDATE tasks
          SET status = 'processing',
              locked_at = ?,
              retry_count = retry_count + 1
          WHERE id = (
            SELECT id FROM tasks
            WHERE ${where.join(' AND ')}
            ORDER BY scheduledAt ASC
            LIMIT 1
          )
          RETURNING *;
        `
      )
      .get(now, ...selectParams) as Record<string, unknown> | undefined
    if (!row) return null


    const images = parseJsonStringArray(row.images)
    const tags = parseJsonStringArray(row.tags)
    const remixSourceTaskIds = parseJsonStringArray(row.remixSourceTaskIds)

    const task: QueuedTask = {
      id: String(row.id ?? ''),
      accountId: String(row.accountId ?? ''),
      status: row.status as QueuedTask['status'],
      mediaType: row.mediaType === 'video' ? 'video' : 'image',
      videoPath: typeof row.videoPath === 'string' && row.videoPath.trim() ? String(row.videoPath) : undefined,
      videoPreviewPath:
        typeof row.videoPreviewPath === 'string' && row.videoPreviewPath.trim() ? String(row.videoPreviewPath) : undefined,
      images,
      title: String(row.title ?? ''),
      content: String(row.content ?? ''),
      tags: tags.length ? tags : undefined,
      productId: typeof row.productId === 'string' && row.productId.trim() ? String(row.productId) : undefined,
      productName: typeof row.productName === 'string' && row.productName.trim() ? String(row.productName) : undefined,
      publishMode: 'immediate',
      transformPolicy: row.transformPolicy === 'remix_v1' ? 'remix_v1' : 'none',
      remixSessionId:
        typeof row.remixSessionId === 'string' && row.remixSessionId.trim()
          ? String(row.remixSessionId)
          : undefined,
      remixSourceTaskIds: remixSourceTaskIds.length > 0 ? remixSourceTaskIds : undefined,
      remixSeed: typeof row.remixSeed === 'string' && row.remixSeed.trim() ? String(row.remixSeed) : undefined,
      isRaw: Number(row.isRaw ?? 0) === 1,
      scheduledAt: row.scheduledAt == null ? null : Number(row.scheduledAt),
      publishedAt: row.publishedAt == null ? null : String(row.publishedAt),
      errorMsg: String(row.errorMsg ?? ''),
      errorMessage: typeof row.errorMessage === 'string' && row.errorMessage.trim() ? String(row.errorMessage) : undefined,
      createdAt: Number(row.createdAt ?? 0) || 0,
      lockedAt: row.locked_at == null ? null : Number(row.locked_at),
      retryCount: Number(row.retry_count ?? 0) || 0
    }

    if (task && task.scheduledAt === null) {
      console.error('CRITICAL: Queue picked up an unscheduled task!', task.id)
      try {
        sqlite.connection.prepare(`UPDATE tasks SET status = 'pending', locked_at = NULL WHERE id = ?`).run(task.id)
      } catch (error) {
        void error
      }
      return null
    }

    if (!task.id || !task.accountId) return null
    return task
  }

  completeTask(id: string): void {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) return
    const normalizedId = String(id ?? '').trim()
    if (!normalizedId) return

    sqlite.connection
      .prepare(`UPDATE tasks SET status = ?, locked_at = NULL WHERE id = ?`)
      .run('published', normalizedId)
  }

  failTask(id: string, errorMsg: string): void {
    const sqlite = SqliteService.getInstance()
    if (!sqlite.isInitialized) return
    const normalizedId = String(id ?? '').trim()
    if (!normalizedId) return

    const normalizedError = typeof errorMsg === 'string' ? errorMsg : String(errorMsg ?? '')

    sqlite.connection
      .prepare(
        `
          UPDATE tasks
          SET errorMsg = ?,
              status = CASE WHEN retry_count >= 3 THEN 'failed' ELSE 'pending' END,
              scheduledAt = CASE WHEN retry_count >= 3 THEN NULL ELSE scheduledAt END,
              locked_at = NULL
          WHERE id = ?
        `
      )
      .run(normalizedError, normalizedId)
  }
}
