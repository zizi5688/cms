import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { createReadStream, createWriteStream, existsSync } from 'fs'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, posix, resolve, sep } from 'path'
import pLimit from 'p-limit'
import { spinText } from './utils/textSpinner'
import { mutateImage } from './services/imageMutator'
import { SqliteService } from './services/sqliteService'

export type PublishTaskStatus = 'pending' | 'processing' | 'failed' | 'publish_failed' | 'scheduled' | 'published'

export type PublishTaskMode = 'immediate'

export type PublishTask = {
  id: string
  accountId: string
  status: PublishTaskStatus
  mediaType: 'image' | 'video'
  videoPath?: string
  videoPreviewPath?: string
  images: string[]
  title: string
  content: string
  tags?: string[]
  productId?: string
  productName?: string
  publishMode: PublishTaskMode
  isRaw?: boolean
  scheduledAt?: number
  publishedAt: string | null
  errorMsg: string
  errorMessage?: string
  createdAt: number
}

export type CreateBatchProgress = {
  phase: 'start' | 'progress' | 'done'
  processed: number
  total: number
  created: number
  message: string
  requestId?: string
}

const XHS_TITLE_CHAR_LIMIT = 20

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeMultilineText(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function normalizeStatus(value: unknown): PublishTaskStatus | null {
  if (value === 'success') return 'published'
  if (value === 'draft_saved') return 'pending'
  if (
    value === 'pending' ||
    value === 'processing' ||
    value === 'failed' ||
    value === 'publish_failed' ||
    value === 'scheduled' ||
    value === 'published'
  )
    return value
  return null
}

function normalizePublishMode(value: unknown): PublishTaskMode {
  void value
  return 'immediate'
}

function normalizeMediaType(value: unknown): 'image' | 'video' {
  return value === 'video' ? 'video' : 'image'
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value ?? '').trim())
}

function isVideoExt(filePath: string): boolean {
  const ext = extname(String(filePath ?? '')).toLowerCase()
  return ext === '.mp4' || ext === '.mov'
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? '').trim())
}

function isAbsoluteFilePath(value: string): boolean {
  const v = String(value ?? '').trim()
  if (!v) return false
  if (isWindowsAbsolutePath(v)) return true
  if (v.startsWith('/')) return true
  return false
}

function normalizeAssetRelativePath(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const normalized = raw.replace(/\\/g, '/')
  return normalized
}

function isRemixTags(tags: string[]): boolean {
  for (const tag of tags) {
    const t = String(tag ?? '').trim()
    if (!t) continue
    if (t === '裂变') return true
    if (t.toLowerCase() === 'remix') return true
  }
  return false
}

function countXhsTitleChars(value: unknown): number {
  return String(value ?? '').length
}

function resolveGeneratedAssetsDir(): string {
  return join(app.getPath('userData'), 'generated_assets')
}

function isUnderDir(absPath: string, absDir: string): boolean {
  const aRaw = resolve(String(absPath ?? '').trim())
  const bRaw = resolve(String(absDir ?? '').trim())
  const a = isWindowsAbsolutePath(aRaw) ? aRaw.toLowerCase() : aRaw
  const b = isWindowsAbsolutePath(bRaw) ? bRaw.toLowerCase() : bRaw
  return a === b || a.startsWith(b + sep)
}

async function computeFileHashSha1(filePath: string, options?: { idleTimeoutMs?: number }): Promise<string> {
  const idleTimeoutMs = Math.max(5_000, Number(options?.idleTimeoutMs ?? 45_000))
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1')
    const stream = createReadStream(filePath)
    let timer: NodeJS.Timeout | null = null
    const clearTimer = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    const armIdleTimeout = (): void => {
      clearTimer()
      timer = setTimeout(() => {
        stream.destroy(new Error('[Asset] hash idle timeout'))
      }, idleTimeoutMs)
    }
    armIdleTimeout()
    stream.on('data', () => armIdleTimeout())
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', (error) => {
      clearTimer()
      reject(error)
    })
    stream.on('end', () => {
      clearTimer()
      resolve(hash.digest('hex'))
    })
  })
}

function computeBufferHashSha1(buffer: Buffer): string {
  const hash = createHash('sha1')
  hash.update(buffer)
  return hash.digest('hex')
}

async function convertHeicToJpegBuffer(input: Buffer): Promise<Buffer> {
  const imported = (await import('heic-convert')) as unknown as { default?: unknown }
  const convert = (imported.default ?? imported) as unknown as (options: {
    buffer: Buffer
    format: 'JPEG' | 'PNG'
    quality?: number
  }) => Promise<Buffer | Uint8Array | ArrayBuffer>

  const output = await convert({ buffer: input, format: 'JPEG', quality: 1 })
  if (Buffer.isBuffer(output)) return output
  if (output instanceof ArrayBuffer) return Buffer.from(new Uint8Array(output))
  return Buffer.from(output)
}

async function copyFileWithRetry(
  sourcePath: string,
  destPath: string,
  options?: { attempts?: number; timeoutMs?: number }
): Promise<void> {
  const attempts = Math.max(1, Number(options?.attempts ?? 3))
  const timeoutMs = Math.max(1_000, Number(options?.timeoutMs ?? 20_000))
  const destDir = dirname(destPath)
  await mkdir(destDir, { recursive: true })

  const tryOnce = async (): Promise<void> => {
    let timer: NodeJS.Timeout | null = null
    const readStream = createReadStream(sourcePath)
    const writeStream = createWriteStream(destPath)
    const clearTimer = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    const armIdleTimeout = (): void => {
      clearTimer()
      timer = setTimeout(() => {
        const timeoutError = new Error('[Asset] copy idle timeout')
        try {
          readStream.destroy(timeoutError)
        } catch {
          void 0
        }
        try {
          writeStream.destroy(timeoutError)
        } catch {
          void 0
        }
      }, timeoutMs)
    }

    const done = new Promise<void>((resolve, reject) => {
      const onError = (error: unknown): void => {
        try {
          readStream.destroy()
        } catch {
          void 0
        }
        try {
          writeStream.destroy()
        } catch {
          void 0
        }
        reject(error)
      }

      writeStream.on('error', onError)
      readStream.on('error', onError)
      writeStream.on('finish', () => resolve())
      readStream.on('data', () => armIdleTimeout())

      armIdleTimeout()
      readStream.pipe(writeStream)
    })

    try {
      await done
    } finally {
      clearTimer()
    }
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (attempt > 0) {
        const backoff = Math.min(4_000, 300 * Math.pow(2, attempt - 1))
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }

      await tryOnce()
      const info = await stat(destPath)
      if (!info.isFile() || info.size <= 0) throw new Error('[Asset] invalid copied file.')
      return
    } catch (error) {
      lastError = error
      try {
        await rm(destPath, { force: true })
      } catch {
        void 0
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('[Asset] copy failed.')
}

export class TaskManager {
  private sqlite: SqliteService
  private workspacePath: string | null
  private configStore: { get: (key: string) => unknown } | null

  constructor(
    _store?: unknown,
    options?: { workspacePath?: string; configStore?: { get: (key: string) => unknown } }
  ) {
    this.sqlite = SqliteService.getInstance()
    this.workspacePath = options?.workspacePath ? String(options.workspacePath).trim() : null
    this.configStore = options?.configStore ?? null
  }

  normalizeLegacyDraftTasks(): { modeUpdated: number; statusUpdated: number } {
    const db = this.sqlite.tryGetConnection()
    if (!db) return { modeUpdated: 0, statusUpdated: 0 }

    const modeResult = db
      .prepare(
        `
          UPDATE tasks
          SET publishMode = 'immediate'
          WHERE status != 'published' AND publishMode != 'immediate'
        `
      )
      .run()
    const statusResult = db
      .prepare(
        `
          UPDATE tasks
          SET status = 'pending'
          WHERE status = 'draft_saved'
        `
      )
      .run()

    return {
      modeUpdated: Number(modeResult.changes ?? 0),
      statusUpdated: Number(statusResult.changes ?? 0)
    }
  }

  listAll(): PublishTask[] {
    const db = this.sqlite.tryGetConnection()
    if (!db) return []

    const rows = db
      .prepare(
        `SELECT
          id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
          title, content, tags, productId, productName, publishMode,
          scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
        FROM tasks
        ORDER BY createdAt DESC`
      )
      .all() as Array<Record<string, unknown>>

    return rows.map((row) => this.rowToTask(row))
  }

  listByAccount(accountId: string): PublishTask[] {
    const normalizedAccountId = normalizeText(accountId)
    if (!normalizedAccountId) return []
    const db = this.sqlite.tryGetConnection()
    if (!db) return []

    const rows = db
      .prepare(
        `SELECT
          id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
          title, content, tags, productId, productName, publishMode,
          scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
        FROM tasks
        WHERE accountId = ?
        ORDER BY createdAt DESC`
      )
      .all(normalizedAccountId) as Array<Record<string, unknown>>

    return rows.map((row) => this.rowToTask(row))
  }

  listDueTasks(now: number): PublishTask[] {
    if (!this.sqlite.isInitialized) {
      console.warn('DB not ready, skipping task check')
      return []
    }
    const time = Number.isFinite(now) ? Math.floor(now) : Date.now()
    const db = this.sqlite.tryGetConnection()
    if (!db) return []

    const rows = db
      .prepare(
        `SELECT
          id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
          title, content, tags, productId, productName, publishMode,
          scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
        FROM tasks
        WHERE scheduledAt IS NOT NULL
          AND scheduledAt <= ?
          AND status = 'pending'
        ORDER BY scheduledAt ASC`
      )
      .all(time) as Array<Record<string, unknown>>

    return rows.map((row) => this.rowToTask(row))
  }

  async createBatch(
    tasks: Array<{
      accountId: string
      images?: string[]
      imagePath?: string
      mediaType?: 'image' | 'video'
      videoPath?: string
      title?: string
      content?: string
      productId?: string
      productName?: string
      publishMode?: PublishTaskMode
    }>,
    options?: { requestId?: string; onProgress?: (payload: CreateBatchProgress) => void }
  ): Promise<PublishTask[]> {
    const db = this.sqlite.tryGetConnection()
    if (!db) return []
    const batchStart = Date.now()

    const list = Array.isArray(tasks) ? tasks : []
    const total = list.length
    const requestId = normalizeText(options?.requestId)
    const createdAt = Date.now()
    const toCreate: PublishTask[] = []
    let processed = 0
    const emitProgress = (phase: CreateBatchProgress['phase'], message: string): void => {
      if (!options?.onProgress) return
      try {
        options.onProgress({
          phase,
          processed,
          total,
          created: toCreate.length,
          message,
          requestId: requestId || undefined
        })
      } catch {
        void 0
      }
    }
    emitProgress('start', total > 0 ? `开始派发（0/${total}）` : '没有可派发任务')

    const workspacePath = this.workspacePath ? this.workspacePath.trim() : ''
    const resolvedWorkspacePath = workspacePath ? resolve(workspacePath) : ''
    const importStrategy = this.configStore?.get('importStrategy') === 'move' ? 'move' : 'copy'
    const shouldLocalizeAssets = Boolean(workspacePath)
    const assetsImagesDir = shouldLocalizeAssets ? join(workspacePath, 'assets', 'images') : ''
    const assetsVideosDir = shouldLocalizeAssets ? join(workspacePath, 'assets', 'videos') : ''
    if (shouldLocalizeAssets) {
      await mkdir(assetsImagesDir, { recursive: true })
      await mkdir(assetsVideosDir, { recursive: true })
    }

    const sourcesToDelete = new Set<string>()
    const heicCache = new Map<string, { hash: string; jpeg: Buffer }>()
    const fileHashCache = new Map<string, string>()
    const localizedImageSourceCache = new Map<string, string>()
    const localizedVideoSourceCache = new Map<string, string>()
    let localizedImageSourceCount = 0
    let localizedVideoSourceCount = 0
    let reusedImageSourceHits = 0
    let reusedVideoSourceHits = 0
    const mutateLimit = pLimit(3)
    const generatedAssetsDir = resolveGeneratedAssetsDir()
    const isUnderWorkspace = (absPath: string): boolean => {
      if (!resolvedWorkspacePath) return false
      const resolved = resolve(absPath)
      const a = isWindowsAbsolutePath(resolved) ? resolved.toLowerCase() : resolved
      const b = isWindowsAbsolutePath(resolvedWorkspacePath) ? resolvedWorkspacePath.toLowerCase() : resolvedWorkspacePath
      return a === b || a.startsWith(b + sep)
    }

    for (const raw of list) {
      try {
      const currentTaskIndex = Math.min(processed + 1, total)
      const record = raw as unknown as Record<string, unknown>
      const accountId = normalizeText(record.accountId)
      const tags = Array.isArray(record.tags)
        ? (record.tags as unknown[]).map((v) => normalizeText(v)).filter(Boolean)
        : []
      const isRemix = isRemixTags(tags)

      const imagesFromArray = Array.isArray(record.images)
        ? (record.images as unknown[]).map((v) => normalizeText(v)).filter(Boolean)
        : []
      const legacyImagePath = normalizeText(record.imagePath)
      const explicitVideoPath = normalizeText(record.videoPath)
      const rawMediaPaths = imagesFromArray.length > 0 ? imagesFromArray : legacyImagePath ? [legacyImagePath] : []

      let inferredVideoPath = ''
      const rawImages: string[] = []
      for (const entry of rawMediaPaths) {
        const normalized = normalizeText(entry)
        if (!normalized) continue
        if (!inferredVideoPath && isVideoExt(normalized)) {
          inferredVideoPath = normalized
          continue
        }
        rawImages.push(normalized)
      }

      const recordMediaType = normalizeMediaType(record.mediaType)
      const wantsVideo = recordMediaType === 'video' || Boolean(explicitVideoPath || inferredVideoPath)
      const videoPathInput = normalizeText(explicitVideoPath || inferredVideoPath)

      if (!accountId) continue
      if (wantsVideo) {
        if (!videoPathInput) continue
      } else {
        if (rawImages.length === 0) continue
      }

      const images: string[] = []
      if (isRemix) {
        const mutated = await Promise.all(
          rawImages
            .map((imagePath) => normalizeText(imagePath))
            .filter(Boolean)
            .map(async (normalizedPath) => {
              if (isHttpUrl(normalizedPath)) return normalizedPath

              const isRelativeAsset = normalizedPath.startsWith('assets/') || normalizedPath.startsWith('assets\\')
              if (isRelativeAsset) {
                if (!shouldLocalizeAssets) return normalizeAssetRelativePath(normalizedPath)
                const rel = normalizeAssetRelativePath(normalizedPath)
                const abs = join(workspacePath, ...rel.split('/').filter(Boolean))
                try {
                  return await mutateLimit(() => mutateImage(abs))
                } catch {
                  return rel
                }
              }

              if (!isAbsoluteFilePath(normalizedPath)) return normalizedPath

              try {
                return await mutateLimit(() => mutateImage(normalizedPath))
              } catch {
                return normalizedPath
              }
            })
        )
        images.push(...mutated.filter(Boolean))
      } else {
        for (const imagePath of rawImages) {
          const normalizedPath = normalizeText(imagePath)
          if (!normalizedPath) continue
          if (isHttpUrl(normalizedPath)) {
            images.push(normalizedPath)
            continue
          }

          const isRelativeAsset = normalizedPath.startsWith('assets/') || normalizedPath.startsWith('assets\\')
          if (isRelativeAsset) {
            images.push(normalizeAssetRelativePath(normalizedPath))
            continue
          }

          if (!shouldLocalizeAssets || !isAbsoluteFilePath(normalizedPath)) {
            images.push(normalizedPath)
            continue
          }

          if (isUnderDir(normalizedPath, generatedAssetsDir)) {
            images.push(normalizedPath)
            continue
          }

          const cachedLocalizedImage = localizedImageSourceCache.get(normalizedPath)
          if (cachedLocalizedImage) {
            images.push(cachedLocalizedImage)
            reusedImageSourceHits += 1
            continue
          }
          emitProgress(
            'progress',
            `派发处理中（${currentTaskIndex}/${Math.max(total, 1)}）读取图片：${basename(normalizedPath)}`
          )

          const extLower = extname(normalizedPath).toLowerCase()
          const isHeic = extLower === '.heic'
          let fileHash: string
          let heicJpeg: Buffer | null = null
          if (isHeic) {
            const cached = heicCache.get(normalizedPath)
            if (cached) {
              fileHash = cached.hash
              heicJpeg = cached.jpeg
            } else {
              heicJpeg = await convertHeicToJpegBuffer(await readFile(normalizedPath))
              fileHash = computeBufferHashSha1(heicJpeg)
              heicCache.set(normalizedPath, { hash: fileHash, jpeg: heicJpeg })
              fileHashCache.set(normalizedPath, fileHash)
            }
          } else {
            const cachedHash = fileHashCache.get(normalizedPath)
            if (cachedHash) {
              fileHash = cachedHash
            } else {
              fileHash = await computeFileHashSha1(normalizedPath)
              fileHashCache.set(normalizedPath, fileHash)
            }
          }
          const fileName = isHeic ? `${fileHash}.jpg` : `${fileHash}${extLower}`
          const destAbsPath = join(assetsImagesDir, fileName)
          if (!existsSync(destAbsPath)) {
            if (isHeic) {
              await writeFile(destAbsPath, heicJpeg!)
            } else {
              await copyFileWithRetry(normalizedPath, destAbsPath, { attempts: 3, timeoutMs: 25_000 })
            }
          } else {
            const info = await stat(destAbsPath)
            if (!info.isFile() || info.size <= 0) {
              if (isHeic) {
                await writeFile(destAbsPath, heicJpeg!)
              } else {
                await copyFileWithRetry(normalizedPath, destAbsPath, { attempts: 3, timeoutMs: 25_000 })
              }
            }
          }
          if (importStrategy === 'move' && !isUnderWorkspace(normalizedPath)) {
            sourcesToDelete.add(normalizedPath)
          }
          const rel = normalizeAssetRelativePath(posix.join('assets', 'images', fileName))
          localizedImageSourceCache.set(normalizedPath, rel)
          localizedImageSourceCount += 1
          images.push(rel)
        }
      }

      let videoPath: string | undefined = undefined
      if (wantsVideo) {
        const normalizedPath = normalizeText(videoPathInput)
        if (!normalizedPath) continue
        if (isHttpUrl(normalizedPath)) {
          videoPath = normalizedPath
        } else {
          const isRelativeAsset = normalizedPath.startsWith('assets/') || normalizedPath.startsWith('assets\\')
          if (isRelativeAsset) {
            videoPath = normalizeAssetRelativePath(normalizedPath)
          } else if (!shouldLocalizeAssets || !isAbsoluteFilePath(normalizedPath)) {
            videoPath = normalizedPath
          } else if (isUnderDir(normalizedPath, generatedAssetsDir)) {
            videoPath = normalizedPath
          } else {
            const cachedLocalizedVideo = localizedVideoSourceCache.get(normalizedPath)
            if (cachedLocalizedVideo) {
              videoPath = cachedLocalizedVideo
              reusedVideoSourceHits += 1
            } else {
              emitProgress(
                'progress',
                `派发处理中（${currentTaskIndex}/${Math.max(total, 1)}）读取视频：${basename(normalizedPath)}`
              )
              const extLower = extname(normalizedPath).toLowerCase()
              const cachedHash = fileHashCache.get(normalizedPath)
              const fileHash = cachedHash ?? (await computeFileHashSha1(normalizedPath))
              if (!cachedHash) fileHashCache.set(normalizedPath, fileHash)
              const fileName = `${fileHash}${extLower}`
              const destAbsPath = join(assetsVideosDir, fileName)
              if (!existsSync(destAbsPath)) {
                await copyFileWithRetry(normalizedPath, destAbsPath, { attempts: 3, timeoutMs: 60_000 })
              } else {
                const info = await stat(destAbsPath)
                if (!info.isFile() || info.size <= 0) {
                  await copyFileWithRetry(normalizedPath, destAbsPath, { attempts: 3, timeoutMs: 60_000 })
                }
              }
              if (importStrategy === 'move' && !isUnderWorkspace(normalizedPath)) {
                sourcesToDelete.add(normalizedPath)
              }
              videoPath = normalizeAssetRelativePath(posix.join('assets', 'videos', fileName))
              localizedVideoSourceCache.set(normalizedPath, videoPath)
              localizedVideoSourceCount += 1
            }
          }
        }
      }

      const mediaType: 'image' | 'video' = wantsVideo ? 'video' : 'image'
      if (mediaType === 'image' && images.length === 0) continue
      if (mediaType === 'video' && !videoPath) continue

      const normalizedTitle = normalizeText(record.title)
      const normalizedContent = normalizeMultilineText(record.content)
      const title = isRemix ? normalizeText(spinText(normalizedTitle)) : normalizedTitle
      const content = isRemix ? normalizeMultilineText(spinText(normalizedContent)) : normalizedContent

      const next: PublishTask = {
        id: randomUUID(),
        accountId,
        status: 'pending',
        mediaType,
        videoPath,
        videoPreviewPath: typeof record.videoPreviewPath === 'string' ? normalizeText(record.videoPreviewPath) || undefined : undefined,
        images,
        title,
        content,
        tags: tags.length > 0 ? Array.from(new Set(tags)) : undefined,
        productId: normalizeText(record.productId) || undefined,
        productName: normalizeText(record.productName) || undefined,
        publishMode: 'immediate',
        scheduledAt: Number.isFinite(record.scheduledAt) ? Math.floor(record.scheduledAt as number) : undefined,
        publishedAt: null,
        errorMsg: '',
        errorMessage: '',
        createdAt
      }
      toCreate.push(next)
      } finally {
        processed += 1
        emitProgress('progress', `派发处理中（${Math.min(processed, total)}/${total}）`)
      }
    }

    if (toCreate.length === 0) {
      emitProgress('done', '派发完成：0 条任务')
      return []
    }
    const insert = db.prepare(
      `INSERT INTO tasks (
        id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
        title, content, tags, productId, productName, publishMode,
        scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
      ) VALUES (
        @id, @accountId, @status, @mediaType, @images, @videoPath, @videoPreviewPath,
        @title, @content, @tags, @productId, @productName, @publishMode,
        @scheduledAt, @publishedAt, @createdAt, @errorMsg, @errorMessage, @isRaw
      )`
    )
    const tx = db.transaction(() => {
      for (const task of toCreate) {
        insert.run(this.toDbTask(task))
      }
    })
    tx()

    if (importStrategy === 'move' && sourcesToDelete.size > 0) {
      for (const sourcePath of sourcesToDelete) {
        if (!sourcePath) continue
        if (isUnderWorkspace(sourcePath)) continue
        try {
          await rm(sourcePath, { force: true })
        } catch {
          void 0
        }
      }
    }

    if (shouldLocalizeAssets) {
      const elapsedMs = Date.now() - batchStart
      console.info(
        `[TaskManager] createBatch completed in ${elapsedMs}ms ` +
          `(tasks=${toCreate.length}, uniqueImages=${localizedImageSourceCount}, imageReuseHits=${reusedImageSourceHits}, ` +
          `uniqueVideos=${localizedVideoSourceCount}, videoReuseHits=${reusedVideoSourceHits}, hashCacheSize=${fileHashCache.size}).`
      )
    }
    emitProgress('done', `派发完成：${toCreate.length} 条任务`)

    return toCreate.slice().sort((a, b) => b.createdAt - a.createdAt)
  }

  delete(taskId: string): boolean {
    const normalizedId = normalizeText(taskId)
    if (!normalizedId) return false
    const db = this.sqlite.tryGetConnection()
    if (!db) return false
    const result = db.prepare(`DELETE FROM tasks WHERE id = ?`).run(normalizedId)
    return (result.changes ?? 0) > 0
  }

  deleteBatch(taskIds: string[]): { deleted: number; deletedIds: string[] } {
    const ids = Array.isArray(taskIds) ? taskIds.map((id) => normalizeText(id)).filter(Boolean) : []
    if (ids.length === 0) return { deleted: 0, deletedIds: [] }
    const unique = Array.from(new Set(ids))
    const db = this.sqlite.tryGetConnection()
    if (!db) return { deleted: 0, deletedIds: [] }
    const placeholders = unique.map(() => '?').join(', ')
    const selectIds = db.prepare(`SELECT id FROM tasks WHERE id IN (${placeholders})`).all(...unique) as Array<{ id?: unknown }>
    const deletedIds = selectIds.map((row) => (typeof row.id === 'string' ? row.id : '')).filter(Boolean)
    if (deletedIds.length === 0) return { deleted: 0, deletedIds: [] }

    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...unique)
    })
    tx()

    return { deleted: deletedIds.length, deletedIds }
  }

  updateStatus(taskId: string, status: PublishTaskStatus): PublishTask | null {
    const normalizedId = normalizeText(taskId)
    const nextStatus = normalizeStatus(status)
    if (!normalizedId || !nextStatus) return null
    const db = this.sqlite.tryGetConnection()
    if (!db) return null
    const result = db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run(nextStatus, normalizedId)
    if ((result.changes ?? 0) <= 0) return null
    return this.getById(normalizedId)
  }

  updateBatch(
    taskIds: string[],
    updates: unknown
  ): PublishTask[] {
    const ids = Array.isArray(taskIds) ? taskIds.map((id) => normalizeText(id)).filter(Boolean) : []
    if (ids.length === 0) return []
    const unique = Array.from(new Set(ids))
    const patchRecord = updates && typeof updates === 'object' ? (updates as Record<string, unknown>) : {}
    const db = this.sqlite.tryGetConnection()
    if (!db) return []
    const currentById = this.getByIds(unique)
    if (currentById.length === 0) return []

    const map = new Map(currentById.map((t) => [t.id, t]))
    const updatedList: PublishTask[] = []
    for (const id of unique) {
      const current = map.get(id)
      if (!current) continue
      const next = this.applyUpdates(current, patchRecord)
      this.assertScheduleTitleLength(next, patchRecord)
      updatedList.push(next)
    }

    const updateStmt = db.prepare(
      `UPDATE tasks SET
        status=@status,
        mediaType=@mediaType,
        images=@images,
        videoPath=@videoPath,
        videoPreviewPath=@videoPreviewPath,
        title=@title,
        content=@content,
        tags=@tags,
        productId=@productId,
        productName=@productName,
        publishMode=@publishMode,
        scheduledAt=@scheduledAt,
        publishedAt=@publishedAt,
        errorMsg=@errorMsg,
        errorMessage=@errorMessage,
        isRaw=@isRaw
      WHERE id=@id`
    )
    const tx = db.transaction(() => {
      for (const task of updatedList) updateStmt.run(this.toDbTask(task))
    })
    tx()

    return updatedList
  }

  updateMany(
    patches: Array<{ id: string; updates: unknown }>
  ): PublishTask[] {
    const list = Array.isArray(patches) ? patches : []
    if (list.length === 0) return []

    const normalized = list
      .map((patch) => {
        const record = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
        const id = normalizeText(record.id)
        const updates = record.updates && typeof record.updates === 'object' ? (record.updates as Record<string, unknown>) : null
        if (!id || !updates) return null
        return { id, updates }
      })
      .filter((patch): patch is { id: string; updates: Record<string, unknown> } => Boolean(patch))

    if (normalized.length === 0) return []

    const byId = new Map<string, Record<string, unknown>>()
    for (const patch of normalized) {
      byId.set(patch.id, patch.updates)
    }

    const ids = Array.from(byId.keys())
    const existing = this.getByIds(ids)
    if (existing.length === 0) return []

    const updatedList: PublishTask[] = []
    for (const task of existing) {
      const updates = byId.get(task.id)
      if (!updates) continue
      const next = this.applyUpdates(task, updates)
      this.assertScheduleTitleLength(next, updates)
      updatedList.push(next)
    }

    const db = this.sqlite.tryGetConnection()
    if (!db) return []
    const updateStmt = db.prepare(
      `UPDATE tasks SET
        status=@status,
        mediaType=@mediaType,
        images=@images,
        videoPath=@videoPath,
        videoPreviewPath=@videoPreviewPath,
        title=@title,
        content=@content,
        tags=@tags,
        productId=@productId,
        productName=@productName,
        publishMode=@publishMode,
        scheduledAt=@scheduledAt,
        publishedAt=@publishedAt,
        errorMsg=@errorMsg,
        errorMessage=@errorMessage,
        isRaw=@isRaw
      WHERE id=@id`
    )
    const tx = db.transaction(() => {
      for (const task of updatedList) updateStmt.run(this.toDbTask(task))
    })
    tx()

    return updatedList
  }

  private applyUpdates(task: PublishTask, record: Record<string, unknown>): PublishTask {
    const nextTitle = typeof record.title === 'string' ? normalizeText(record.title) : null
    const nextContent = typeof record.content === 'string' ? normalizeMultilineText(record.content) : null
    const nextProductId = typeof record.productId === 'string' ? normalizeText(record.productId) || undefined : undefined
    const nextProductName = typeof record.productName === 'string' ? normalizeText(record.productName) || undefined : undefined
    const nextErrorMsg =
      typeof record.errorMsg === 'string'
        ? record.errorMsg
        : typeof record.errorMessage === 'string'
          ? record.errorMessage
          : null
    const nextMode = 'publishMode' in record ? normalizePublishMode(record.publishMode) : null
    const nextStatus = normalizeStatus(record.status) ?? null
    const nextIsRaw =
      'isRaw' in record ? (typeof record.isRaw === 'boolean' ? record.isRaw : record.isRaw === null ? undefined : null) : null
    const nextScheduledAt =
      'scheduledAt' in record
        ? Number.isFinite(record.scheduledAt)
          ? Math.floor(record.scheduledAt as number)
          : record.scheduledAt === null
            ? undefined
            : null
        : null

    const nextMediaType = 'mediaType' in record ? normalizeMediaType(record.mediaType) : null
    const nextVideoPath =
      'videoPath' in record
        ? typeof record.videoPath === 'string'
          ? normalizeText(record.videoPath) || undefined
          : record.videoPath === null
            ? undefined
            : null
        : null

    const nextVideoPreviewPath =
      'videoPreviewPath' in record
        ? typeof record.videoPreviewPath === 'string'
          ? normalizeText(record.videoPreviewPath) || undefined
          : record.videoPreviewPath === null
            ? undefined
            : null
        : null

    let nextPublishedAt: string | null | undefined = undefined
    if ('publishedAt' in record) {
      if (record.publishedAt === null) {
        nextPublishedAt = null
      } else if (typeof record.publishedAt === 'string') {
        const candidate = record.publishedAt.trim()
        const parsed = Date.parse(candidate)
        nextPublishedAt = Number.isFinite(parsed) ? candidate : null
      } else if (Number.isFinite(record.publishedAt)) {
        nextPublishedAt = new Date(Math.floor(record.publishedAt as number)).toISOString()
      } else {
        nextPublishedAt = null
      }
    }

    const nextImages = Array.isArray(record.images)
      ? (record.images as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
      : null

    const scheduledAtTouched = nextScheduledAt !== null
    const shouldForcePendingAfterReschedule =
      nextStatus === null &&
      scheduledAtTouched &&
      typeof nextScheduledAt === 'number' &&
      Number.isFinite(nextScheduledAt) &&
      task.status !== 'published'
    const resolvedStatus =
      nextStatus !== null ? nextStatus : shouldForcePendingAfterReschedule ? 'pending' : task.status
    const resolvedPublishedAt = nextPublishedAt !== undefined ? nextPublishedAt : task.publishedAt
    const resolvedVideoPath = nextVideoPath !== null ? nextVideoPath : task.videoPath
    const resolvedVideoPreviewPath = nextVideoPreviewPath !== null ? nextVideoPreviewPath : task.videoPreviewPath
    const resolvedMediaType = nextMediaType !== null ? nextMediaType : task.mediaType

    return {
      ...task,
      images: nextImages !== null ? nextImages : task.images,
      title: nextTitle !== null ? nextTitle : task.title,
      content: nextContent !== null ? nextContent : task.content,
      productId: typeof record.productId === 'string' ? nextProductId : task.productId,
      productName: typeof record.productName === 'string' ? nextProductName : task.productName,
      errorMsg: nextErrorMsg !== null ? nextErrorMsg : task.errorMsg,
      errorMessage: nextErrorMsg !== null ? nextErrorMsg : task.errorMessage,
      publishMode: nextMode !== null ? nextMode : task.publishMode,
      isRaw: nextIsRaw !== null ? nextIsRaw : task.isRaw,
      status: resolvedStatus,
      scheduledAt: nextScheduledAt !== null ? nextScheduledAt : task.scheduledAt,
      publishedAt: resolvedPublishedAt,
      mediaType: resolvedMediaType === 'video' && !resolvedVideoPath ? 'image' : resolvedMediaType,
      videoPath: resolvedMediaType === 'video' ? resolvedVideoPath : undefined,
      videoPreviewPath: resolvedMediaType === 'video' ? resolvedVideoPreviewPath : undefined
    }
  }

  private assertScheduleTitleLength(task: PublishTask, record: Record<string, unknown>): void {
    const isCurrentlyScheduled = typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt)
    const isSchedulingToSpecificTime = 'scheduledAt' in record && Number.isFinite(record.scheduledAt)
    if (!isCurrentlyScheduled && !isSchedulingToSpecificTime) return
    const titleCount = countXhsTitleChars(task.title)
    if (titleCount <= XHS_TITLE_CHAR_LIMIT) return
    throw new Error(`标题超 ${XHS_TITLE_CHAR_LIMIT}（${titleCount}/${XHS_TITLE_CHAR_LIMIT}），请先修改标题后再排期。`)
  }

  private parseJsonStringArray(value: unknown): string[] {
    if (typeof value !== 'string' || !value.trim()) return []
    try {
      const parsed = JSON.parse(value) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.map((v) => normalizeText(v)).filter(Boolean)
    } catch {
      return []
    }
  }

  private rowToTask(row: Record<string, unknown>): PublishTask {
    const id = typeof row.id === 'string' ? row.id : ''
    const accountId = typeof row.accountId === 'string' ? row.accountId : ''
    const status = normalizeStatus(row.status) ?? 'pending'
    const mediaType = normalizeMediaType(row.mediaType)
    const images = this.parseJsonStringArray(row.images)
    const tags = this.parseJsonStringArray(row.tags)
    const videoPath = typeof row.videoPath === 'string' && row.videoPath.trim() ? row.videoPath : undefined
    const videoPreviewPath =
      typeof row.videoPreviewPath === 'string' && row.videoPreviewPath.trim() ? row.videoPreviewPath : undefined
    const title = typeof row.title === 'string' ? row.title : ''
    const content = typeof row.content === 'string' ? row.content : ''
    const productId = typeof row.productId === 'string' && row.productId.trim() ? row.productId : undefined
    const productName = typeof row.productName === 'string' && row.productName.trim() ? row.productName : undefined
    const publishMode = normalizePublishMode(row.publishMode)
    const scheduledAt = typeof row.scheduledAt === 'number' && Number.isFinite(row.scheduledAt) ? row.scheduledAt : undefined
    const publishedAt = typeof row.publishedAt === 'string' && row.publishedAt.trim() ? row.publishedAt : null
    const createdAt = typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : Date.now()
    const errorMsg = typeof row.errorMsg === 'string' ? row.errorMsg : ''
    const errorMessage = typeof row.errorMessage === 'string' && row.errorMessage.trim() ? row.errorMessage : undefined
    const isRaw = row.isRaw === 1 || row.isRaw === true ? true : undefined

    return {
      id,
      accountId,
      status,
      mediaType: mediaType === 'video' && !videoPath ? 'image' : mediaType,
      videoPath: mediaType === 'video' ? videoPath : undefined,
      videoPreviewPath: mediaType === 'video' ? videoPreviewPath : undefined,
      images,
      title,
      content,
      tags: tags.length > 0 ? tags : undefined,
      productId,
      productName,
      publishMode,
      isRaw,
      scheduledAt,
      publishedAt,
      errorMsg,
      errorMessage,
      createdAt
    }
  }

  private toDbTask(task: PublishTask): Record<string, unknown> {
    return {
      id: task.id,
      accountId: task.accountId,
      status: task.status,
      mediaType: task.mediaType,
      images: JSON.stringify(Array.isArray(task.images) ? task.images : []),
      videoPath: task.videoPath ?? null,
      videoPreviewPath: task.videoPreviewPath ?? null,
      title: task.title,
      content: task.content,
      tags: task.tags && task.tags.length > 0 ? JSON.stringify(task.tags) : null,
      productId: task.productId ?? null,
      productName: task.productName ?? null,
      publishMode: task.publishMode,
      scheduledAt: typeof task.scheduledAt === 'number' ? task.scheduledAt : null,
      publishedAt: task.publishedAt ?? null,
      createdAt: task.createdAt,
      errorMsg: task.errorMsg,
      errorMessage: task.errorMessage ?? null,
      isRaw: task.isRaw ? 1 : 0
    }
  }

  private getById(taskId: string): PublishTask | null {
    const db = this.sqlite.tryGetConnection()
    if (!db) return null
    const row = db
      .prepare(
        `SELECT
          id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
          title, content, tags, productId, productName, publishMode,
          scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
        FROM tasks
        WHERE id = ?
        LIMIT 1`
      )
      .get(taskId) as Record<string, unknown> | undefined
    return row ? this.rowToTask(row) : null
  }

  private getByIds(ids: string[]): PublishTask[] {
    const normalized = Array.isArray(ids) ? ids.map((id) => normalizeText(id)).filter(Boolean) : []
    if (normalized.length === 0) return []
    const unique = Array.from(new Set(normalized))
    const placeholders = unique.map(() => '?').join(', ')
    const db = this.sqlite.tryGetConnection()
    if (!db) return []
    const rows = db
      .prepare(
        `SELECT
          id, accountId, status, mediaType, images, videoPath, videoPreviewPath,
          title, content, tags, productId, productName, publishMode,
          scheduledAt, publishedAt, createdAt, errorMsg, errorMessage, isRaw
        FROM tasks
        WHERE id IN (${placeholders})`
      )
      .all(...unique) as Array<Record<string, unknown>>

    return rows.map((row) => this.rowToTask(row))
  }
}
