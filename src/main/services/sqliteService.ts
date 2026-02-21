import { constants, existsSync } from 'fs'
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join, resolve } from 'path'

export class SqliteService {
  private static instance: SqliteService | null = null
  private static databaseCtor: unknown | null = null

  private db: any | null = null
  private dbPath: string | null = null

  static getInstance(): SqliteService {
    if (!SqliteService.instance) {
      SqliteService.instance = new SqliteService()
    }
    return SqliteService.instance
  }

  private constructor() {}

  get isInitialized(): boolean {
    return Boolean(this.db)
  }

  get databasePath(): string {
    return this.dbPath ?? ''
  }

  tryGetConnection(): any | null {
    return this.db
  }

  get connection(): any {
    if (!this.db) throw new Error('[SqliteService] Not initialized. Call init() first.')
    return this.db
  }

  private async loadDatabaseCtor(): Promise<any> {
    if (SqliteService.databaseCtor) return SqliteService.databaseCtor
    const imported = (await import('better-sqlite3')) as unknown as { default?: unknown }
    const ctor = (imported.default ?? imported) as unknown
    SqliteService.databaseCtor = ctor
    return ctor as any
  }

  ensureQueueColumns(): void {
    const db = this.db
    if (!db) return

    const columns = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name?: unknown }>
    const hasLockedAt = columns.some((col) => col?.name === 'locked_at')
    const hasRetryCount = columns.some((col) => col?.name === 'retry_count')
    const hasTransformPolicy = columns.some((col) => col?.name === 'transformPolicy')
    const hasRemixSessionId = columns.some((col) => col?.name === 'remixSessionId')
    const hasRemixSourceTaskIds = columns.some((col) => col?.name === 'remixSourceTaskIds')
    const hasRemixSeed = columns.some((col) => col?.name === 'remixSeed')

    if (!hasLockedAt) {
      db.exec(`ALTER TABLE tasks ADD COLUMN locked_at INTEGER;`)
    }
    if (!hasRetryCount) {
      db.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0;`)
    }
    if (!hasTransformPolicy) {
      db.exec(`ALTER TABLE tasks ADD COLUMN transformPolicy TEXT NOT NULL DEFAULT 'none';`)
    }
    if (!hasRemixSessionId) {
      db.exec(`ALTER TABLE tasks ADD COLUMN remixSessionId TEXT;`)
    }
    if (!hasRemixSourceTaskIds) {
      db.exec(`ALTER TABLE tasks ADD COLUMN remixSourceTaskIds TEXT;`)
    }
    if (!hasRemixSeed) {
      db.exec(`ALTER TABLE tasks ADD COLUMN remixSeed TEXT;`)
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_remixSessionId ON tasks (remixSessionId);`)
  }

  async init(workspacePath: string): Promise<{
    migrationResult?: { migrated: boolean; inserted: { accounts: number; tasks: number; products: number }; source: string }
  }> {
    const normalizedWorkspacePath = String(workspacePath ?? '').trim()
    if (!normalizedWorkspacePath) throw new Error('[SqliteService] workspacePath is required.')

    const resolvedWorkspacePath = resolve(normalizedWorkspacePath)
    await mkdir(resolvedWorkspacePath, { recursive: true })
    await access(resolvedWorkspacePath, constants.W_OK)

    const targetPath = join(resolvedWorkspacePath, 'cms.sqlite')
    if (this.db && this.dbPath === targetPath) return {}

    this.close()

    let DatabaseCtor: any
    try {
      DatabaseCtor = await this.loadDatabaseCtor()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[SqliteService] Failed to load better-sqlite3: ${message}`)
    }

    const db = new DatabaseCtor(targetPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')

    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        partitionKey TEXT NOT NULL,
        lastLoginTime INTEGER,
        status TEXT NOT NULL DEFAULT 'offline'
      );

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        accountId TEXT NOT NULL,
        name TEXT NOT NULL,
        price TEXT NOT NULL,
        cover TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        accountId TEXT NOT NULL,
        status TEXT NOT NULL,
        mediaType TEXT NOT NULL,
        images TEXT NOT NULL DEFAULT '[]',
        videoPath TEXT,
        videoPreviewPath TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        productId TEXT,
        productName TEXT,
        publishMode TEXT NOT NULL,
        transformPolicy TEXT NOT NULL DEFAULT 'none',
        remixSessionId TEXT,
        remixSourceTaskIds TEXT,
        remixSeed TEXT,
        scheduledAt INTEGER,
        publishedAt TEXT,
        createdAt INTEGER NOT NULL,
        errorMsg TEXT NOT NULL DEFAULT '',
        errorMessage TEXT,
        isRaw INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_products_accountId ON products (accountId);
      CREATE INDEX IF NOT EXISTS idx_tasks_accountId ON tasks (accountId);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
      CREATE INDEX IF NOT EXISTS idx_tasks_scheduledAt ON tasks (scheduledAt);
      CREATE INDEX IF NOT EXISTS idx_tasks_createdAt ON tasks (createdAt);

      CREATE TRIGGER IF NOT EXISTS trg_accounts_delete_tasks
      AFTER DELETE ON accounts
      BEGIN
        DELETE FROM tasks WHERE accountId = OLD.id;
      END;
    `)

    const accountColumns = db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name?: unknown }>
    const hasStatusColumn = accountColumns.some((col) => col?.name === 'status')
    if (!hasStatusColumn) {
      db.exec(`ALTER TABLE accounts ADD COLUMN status TEXT NOT NULL DEFAULT 'offline'`)
    }

    this.db = db
    this.dbPath = targetPath
    this.ensureQueueColumns()

    let migrationResult: { migrated: boolean; inserted: { accounts: number; tasks: number; products: number }; source: string } | undefined

    const jsonPath = join(resolvedWorkspacePath, 'db.json')
    const bakPath = join(resolvedWorkspacePath, 'db.json.bak')
    if (existsSync(jsonPath) && !existsSync(bakPath)) {
      const result = await this.migrateFromJSON(resolvedWorkspacePath)
      migrationResult = { ...result, source: 'db.json' }
    }
    const bakMergedMark = join(resolvedWorkspacePath, '.dbjson_bak_merged')
    if (existsSync(bakPath) && !existsSync(bakMergedMark)) {
      const result = await this.migrateFromJSONFile(resolvedWorkspacePath, bakPath, { archive: false, sourceLabel: 'db.json.bak' })
      if (!migrationResult || (result.migrated && !migrationResult.migrated)) {
        migrationResult = { ...result, source: 'db.json.bak' }
      }
      try {
        await writeFile(bakMergedMark, String(Date.now()), 'utf-8')
      } catch {
        void 0
      }
    }
    return { migrationResult }
  }

  async migrateFromJSON(workspacePath: string): Promise<{
    migrated: boolean
    inserted: { accounts: number; tasks: number; products: number }
    reason?: string
  }> {
    const db = this.db
    if (!db) throw new Error('[SqliteService] Not initialized. Call init() first.')

    const resolvedWorkspacePath = resolve(String(workspacePath ?? '').trim())
    if (!resolvedWorkspacePath) {
      return { migrated: false, inserted: { accounts: 0, tasks: 0, products: 0 }, reason: 'missing_workspacePath' }
    }

    const jsonPath = join(resolvedWorkspacePath, 'db.json')
    if (!existsSync(jsonPath)) {
      return { migrated: false, inserted: { accounts: 0, tasks: 0, products: 0 }, reason: 'db_json_not_found' }
    }
    return this.migrateFromJSONFile(resolvedWorkspacePath, jsonPath, { archive: true, sourceLabel: 'db.json' })
  }

  private async migrateFromJSONFile(
    workspacePath: string,
    sourcePath: string,
    options: { archive: boolean; sourceLabel: string }
  ): Promise<{
    migrated: boolean
    inserted: { accounts: number; tasks: number; products: number }
    reason?: string
  }> {
    const db = this.db
    if (!db) throw new Error('[SqliteService] Not initialized. Call init() first.')

    const resolvedWorkspacePath = resolve(String(workspacePath ?? '').trim())
    if (!resolvedWorkspacePath) {
      return { migrated: false, inserted: { accounts: 0, tasks: 0, products: 0 }, reason: 'missing_workspacePath' }
    }

    const resolvedSourcePath = resolve(String(sourcePath ?? '').trim())
    if (!resolvedSourcePath || !existsSync(resolvedSourcePath)) {
      return { migrated: false, inserted: { accounts: 0, tasks: 0, products: 0 }, reason: 'db_json_not_found' }
    }

    const raw = await readFile(resolvedSourcePath, 'utf-8')
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[SqliteService] Failed to parse ${options.sourceLabel}: ${message}`)
    }

    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    const accounts = Array.isArray(record.accounts) ? record.accounts : []
    const tasks = Array.isArray(record.xhs_tasks) ? record.xhs_tasks : []
    const products = Array.isArray(record.xhs_products) ? record.xhs_products : []

    const insertAccount = db.prepare(
      `INSERT OR IGNORE INTO accounts (id, name, partitionKey, lastLoginTime)
       VALUES (@id, @name, @partitionKey, @lastLoginTime)`
    )
    const insertProduct = db.prepare(
      `INSERT OR IGNORE INTO products (id, accountId, name, price, cover)
       VALUES (@id, @accountId, @name, @price, @cover)`
    )

    const insertTask = db.prepare(
      `INSERT OR IGNORE INTO tasks (
        id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
        title, content, tags, productId, productName, publishMode, transformPolicy,
        remixSessionId, remixSourceTaskIds, remixSeed,
        scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
      ) VALUES (
        @id, @accountId, @status, @mediaType, @images, @videoPath, @videoPreviewPath,
        @title, @content, @tags, @productId, @productName, @publishMode, @transformPolicy,
        @remixSessionId, @remixSourceTaskIds, @remixSeed,
        @scheduledAt, @publishedAt, @createdAt, @errorMsg, @errorMessage, @isRaw
      )`
    )
    const selectTask = db.prepare(`SELECT id, accountId, scheduledAt, images, videoPath, videoPreviewPath FROM tasks WHERE id = ?`)
    const patchTask = db.prepare(
      `UPDATE tasks SET
        scheduledAt = COALESCE(@scheduledAt, scheduledAt),
        images = CASE WHEN images IS NULL OR images = '' OR images = '[]' THEN @images ELSE images END,
        videoPath = COALESCE(videoPath, @videoPath),
        videoPreviewPath = COALESCE(videoPreviewPath, @videoPreviewPath)
      WHERE id = @id`
    )

    const normalizeString = (value: unknown): string => (typeof value === 'string' ? value : value != null ? String(value) : '').trim()
    const normalizeOptionalString = (value: unknown): string | null => {
      const text = normalizeString(value)
      return text ? text : null
    }
    const normalizeTimestampOrNull = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
      const text = typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : ''
      if (!text) return null
      const asNum = Number(text)
      if (Number.isFinite(asNum)) return Math.floor(asNum)
      const parsedTime = Date.parse(text)
      return Number.isFinite(parsedTime) ? parsedTime : null
    }
    const normalizeStringArray = (value: unknown): string[] => {
      if (Array.isArray(value)) return value.map((v) => normalizeString(v)).filter(Boolean)
      if (typeof value === 'string') {
        const text = value.trim()
        if (!text) return []
        try {
          const parsed = JSON.parse(text) as unknown
          if (Array.isArray(parsed)) return parsed.map((v) => normalizeString(v)).filter(Boolean)
        } catch {
          return []
        }
      }
      return []
    }
    const toJsonText = (value: unknown): string => {
      try {
        return JSON.stringify(value)
      } catch {
        return '[]'
      }
    }

    const inserted = { accounts: 0, tasks: 0, products: 0 }

    const tx = db.transaction(() => {
      for (const item of accounts) {
        if (!item || typeof item !== 'object') continue
        const a = item as Record<string, unknown>
        const id = normalizeString(a.id)
        const name = normalizeString(a.name)
        const partitionKey = normalizeString(a.partitionKey)
        if (!id || !name || !partitionKey) continue
        const result = insertAccount.run({
          id,
          name,
          partitionKey,
          lastLoginTime: normalizeTimestampOrNull(a.lastLoginTime)
        })
        inserted.accounts += Number(result?.changes) || 0
      }

      for (const item of products) {
        if (!item || typeof item !== 'object') continue
        const p = item as Record<string, unknown>
        const id = normalizeString(p.id)
        const accountId = normalizeString(p.accountId)
        const name = normalizeString(p.name)
        const price = normalizeString(p.price)
        const cover = normalizeString(p.cover)
        if (!id || !accountId || !name || !price || !cover) continue
        const result = insertProduct.run({ id, accountId, name, price, cover })
        inserted.products += Number(result?.changes) || 0
      }

      for (const item of tasks) {
        if (!item || typeof item !== 'object') continue
        const t = item as Record<string, unknown>
        const legacyId = normalizeString(t.id)
        const accountId = normalizeString(t.accountId)
        if (!accountId) continue

        const imagesArray = normalizeStringArray(t.images)
        const tagsArray = Array.isArray(t.tags) ? normalizeStringArray(t.tags) : null
        const videoPath = normalizeOptionalString(t.videoPath)
        const videoPreviewPath = normalizeOptionalString(t.videoPreviewPath)

        const status = (() => {
          const rawStatus = normalizeString(t.status)
          return rawStatus || 'pending'
        })()
        const mediaType = (() => {
          const raw = normalizeString(t.mediaType)
          if (raw === 'video' || raw === 'image') return raw
          return videoPath ? 'video' : 'image'
        })()
        const publishMode = (() => {
          const raw = normalizeString(t.publishMode)
          void raw
          return 'immediate'
        })()
        const transformPolicy = normalizeString(t.transformPolicy) === 'remix_v1' ? 'remix_v1' : 'none'
        const remixSessionId = normalizeOptionalString(t.remixSessionId)
        const remixSourceTaskIds = (() => {
          const ids = normalizeStringArray(t.remixSourceTaskIds)
          return ids.length > 0 ? toJsonText(ids) : null
        })()
        const remixSeed = normalizeOptionalString(t.remixSeed)

        const createdAt = (() => {
          const num = normalizeTimestampOrNull(t.createdAt)
          return num != null ? num : Date.now()
        })()

        const rawTime = (t as { scheduledAt?: unknown; scheduleTime?: unknown; startTime?: unknown }).scheduledAt ??
          (t as { scheduleTime?: unknown }).scheduleTime ??
          (t as { startTime?: unknown }).startTime
        const scheduledAt =
          typeof rawTime === 'number' && Number.isFinite(rawTime) ? Math.floor(rawTime) : normalizeTimestampOrNull(rawTime)
        const publishedAt = normalizeOptionalString(t.publishedAt)
        const errorMsg = normalizeString(t.errorMsg)
        const errorMessage = normalizeOptionalString(t.errorMessage)

        const resolvedId = legacyId || randomUUID()
        const existing = selectTask.get(resolvedId) as { accountId?: unknown } | undefined
        if (existing && typeof existing.accountId === 'string' && existing.accountId.trim() && existing.accountId.trim() !== accountId) {
          const newId = randomUUID()
          const result = insertTask.run({
            id: newId,
            accountId,
            status,
            mediaType,
            images: toJsonText(imagesArray),
            videoPath,
            videoPreviewPath,
            title: normalizeString(t.title),
            content: normalizeString(t.content),
            tags: tagsArray ? toJsonText(tagsArray) : null,
            productId: normalizeOptionalString(t.productId),
            productName: normalizeOptionalString(t.productName),
            publishMode,
            transformPolicy,
            remixSessionId,
            remixSourceTaskIds,
            remixSeed,
            scheduledAt,
            publishedAt,
            createdAt,
            errorMsg,
            errorMessage,
            isRaw: t.isRaw === true ? 1 : 0
          })
          inserted.tasks += Number(result?.changes) || 0
          continue
        }

        const result = insertTask.run({
          id: resolvedId,
          accountId,
          status,
          mediaType,
          images: toJsonText(imagesArray),
          videoPath,
          videoPreviewPath,
          title: normalizeString(t.title),
          content: normalizeString(t.content),
          tags: tagsArray ? toJsonText(tagsArray) : null,
          productId: normalizeOptionalString(t.productId),
          productName: normalizeOptionalString(t.productName),
          publishMode,
          transformPolicy,
          remixSessionId,
          remixSourceTaskIds,
          remixSeed,
          scheduledAt,
          publishedAt,
          createdAt,
          errorMsg,
          errorMessage,
          isRaw: t.isRaw === true ? 1 : 0
        })
        inserted.tasks += Number(result?.changes) || 0
        if ((Number(result?.changes) || 0) <= 0) {
          patchTask.run({
            id: resolvedId,
            scheduledAt,
            images: toJsonText(imagesArray),
            videoPath,
            videoPreviewPath
          })
        }
      }
    })

    tx()

    console.log(`[Migration] Successfully merged data from ${options.sourceLabel}`)
    if (options.archive) {
      try {
        const bakPath = join(resolvedWorkspacePath, 'db.json.bak')
        if (!existsSync(bakPath)) {
          await rename(resolvedSourcePath, bakPath)
          await copyFile(bakPath, resolvedSourcePath)
        }
      } catch (error) {
        console.warn('[Migration] Failed to archive db.json:', error)
      }
    }

    return { migrated: inserted.accounts + inserted.tasks + inserted.products > 0, inserted }
  }

  close(): void {
    if (!this.db) return
    try {
      this.db.close()
    } finally {
      this.db = null
      this.dbPath = null
    }
  }
}
