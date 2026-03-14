import { createHash } from 'crypto'
import { createReadStream, existsSync } from 'fs'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'

export type StorageMaintenanceLogLevel = 'info' | 'error'

export type StorageMaintenanceState = {
  enabled: boolean
  running: boolean
  locked: boolean
  lockReason: string | null
  nextRunAt: number | null
  lastRunAt: number | null
  lastRunId: string | null
}

export type StorageMaintenanceSummary = {
  runId: string
  mode: 'scheduled' | 'manual'
  startedAt: number
  finishedAt: number
  durationMs: number
  results: {
    orphanAssetsDeleted: number
    orphanAssetsDeletedBytes: number
    orphanPartitionsDeleted: number
    orphanPartitionsDeletedBytes: number
    tempFilesDeleted: number
    tempFilesDeletedBytes: number
    migratedVideos: number
    migratedVideoBytes: number
    skippedMigrations: number
  }
  notes: string[]
  manifestPath: string
}

type MaintenanceConfig = {
  enabled: boolean
  startTime: string
  retainDays: number
  archivePath: string
}

type ManifestOperation =
  | {
      kind: 'delete_file'
      path: string
      size: number
      reversible: boolean
      recyclePath?: string
    }
  | {
      kind: 'delete_dir'
      path: string
      size: number
      reversible: boolean
      recyclePath?: string
    }
  | {
      kind: 'migrate_file'
      sourcePath: string
      targetPath: string
      size: number
      sha1: string
    }

type ManifestDoc = {
  version: 1
  runId: string
  mode: 'scheduled' | 'manual'
  startedAt: number
  finishedAt: number
  config: MaintenanceConfig
  workspacePath: string
  userDataPath: string
  notes: string[]
  operations: ManifestOperation[]
  summary: StorageMaintenanceSummary['results']
}

type StorageMaintenanceServiceOptions = {
  getConfig: (key: string) => unknown
  getWorkspacePath: () => string
  getUserDataPath: () => string
  getActivePartitionNames: () => string[]
  isTaskPipelineBusy?: () => boolean
  tryGetSqliteConnection: () => {
    prepare: (sql: string) => {
      all: (...args: unknown[]) => Array<Record<string, unknown>>
      run: (params?: unknown) => unknown
    }
  } | null
  log: (level: StorageMaintenanceLogLevel, message: string) => void
}

const DEFAULT_START_TIME = '02:30'
const DEFAULT_RETAIN_DAYS = 7
const MIN_RETAIN_DAYS = 1
const MAX_RETAIN_DAYS = 120
const MIN_MANIFEST_KEEP_DAYS = 7

function isTaskStatusSafeForArchiveMigration(status: unknown): boolean {
  const normalized = typeof status === 'string' ? status.trim() : ''
  return normalized === 'published' || normalized === 'failed' || normalized === 'publish_failed'
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}

function normalizeStartTime(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return DEFAULT_START_TIME
  return text
}

function normalizeArchivePath(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  return resolve(text)
}

function parseStartTimeToMinutes(startTime: string): number {
  const [hh, mm] = startTime.split(':').map((item) => Number(item))
  const hours = Number.isFinite(hh) ? hh : 2
  const minutes = Number.isFinite(mm) ? mm : 30
  return hours * 60 + minutes
}

function nowMs(): number {
  return Date.now()
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
}

async function hashFileSha1(filePath: string): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const hasher = createHash('sha1')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hasher.update(chunk))
    stream.on('error', (error) => reject(error))
    stream.on('end', () => resolvePromise(hasher.digest('hex')))
  })
}

async function removeEmptyDirsUpward(startDir: string, stopDir: string): Promise<void> {
  let current = resolve(startDir)
  const root = resolve(stopDir)
  while (current.startsWith(root) && current !== root) {
    let entries: Array<{ name: string }> = []
    try {
      entries = (await readdir(current, { withFileTypes: true })) as unknown as Array<{ name: string }>
    } catch {
      return
    }
    if (entries.length > 0) return
    try {
      await rm(current, { recursive: false, force: true })
    } catch {
      return
    }
    current = resolve(join(current, '..'))
  }
}

export class StorageMaintenanceService {
  private readonly options: StorageMaintenanceServiceOptions
  private running = false
  private lockReason: string | null = null
  private nextRunAt: number | null = null
  private lastRunAt: number | null = null
  private lastRunId: string | null = null

  constructor(options: StorageMaintenanceServiceOptions) {
    this.options = options
  }

  getState(): StorageMaintenanceState {
    const config = this.readConfig()
    return {
      enabled: config.enabled,
      running: this.running,
      locked: this.running,
      lockReason: this.lockReason,
      nextRunAt: this.nextRunAt,
      lastRunAt: this.lastRunAt,
      lastRunId: this.lastRunId
    }
  }

  isLocked(): boolean {
    return this.running
  }

  assertWritable(action: string): void {
    if (!this.running) return
    const error = new Error(`[StorageMaintenance] 当前正在执行存储维护，暂不可执行：${action}`)
    ;(error as { code?: string }).code = 'STORAGE_MAINTENANCE_LOCKED'
    throw error
  }

  updateSchedule(): void {
    const config = this.readConfig()
    this.nextRunAt = config.enabled ? this.computeNextRunAt(config.startTime) : null
  }

  dispose(): void {
    this.nextRunAt = null
  }

  async runNow(options?: { reason?: string; dryRun?: boolean }): Promise<StorageMaintenanceSummary> {
    const reason = typeof options?.reason === 'string' ? options.reason.trim() : ''
    return await this.run('manual', reason || 'manual-trigger', options?.dryRun === true)
  }

  async rollback(runId: string): Promise<{ success: boolean; restored: number; errors: string[] }> {
    if (this.running) {
      throw new Error('[StorageMaintenance] rollback is not allowed while maintenance is running.')
    }
    const normalizedRunId = String(runId ?? '').trim()
    if (!normalizedRunId) throw new Error('[StorageMaintenance] runId is required for rollback.')

    const manifestPath = join(this.getManifestsDir(), `${normalizedRunId}.json`)
    const raw = await readFile(manifestPath, 'utf-8')
    const doc = JSON.parse(raw) as ManifestDoc
    const errors: string[] = []
    let restored = 0

    const operations = Array.isArray(doc.operations) ? doc.operations.slice().reverse() : []
    for (const operation of operations) {
      try {
        if (operation.kind === 'migrate_file') {
          const sourcePath = resolve(operation.sourcePath)
          const targetPath = resolve(operation.targetPath)
          if (!existsSync(targetPath)) continue
          if (existsSync(sourcePath)) continue
          await ensureDir(resolve(join(sourcePath, '..')))
          await copyFile(targetPath, sourcePath)
          const copiedSha1 = await hashFileSha1(sourcePath)
          if (copiedSha1 !== operation.sha1) {
            await unlink(sourcePath).catch(() => void 0)
            throw new Error(`checksum mismatch on rollback copy: ${basename(sourcePath)}`)
          }
          restored += 1
          continue
        }

        if (operation.reversible && operation.recyclePath) {
          const recyclePath = resolve(operation.recyclePath)
          if (!existsSync(recyclePath)) continue
          const targetPath = resolve(operation.path)
          await ensureDir(resolve(join(targetPath, '..')))
          await this.movePath(recyclePath, targetPath, operation.kind === 'delete_dir')
          restored += 1
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(message)
      }
    }

    return { success: errors.length === 0, restored, errors }
  }

  private async run(mode: 'scheduled' | 'manual', reason: string, dryRun: boolean): Promise<StorageMaintenanceSummary> {
    if (this.running) {
      throw new Error('[StorageMaintenance] maintenance is already running.')
    }
    if (typeof this.options.isTaskPipelineBusy === 'function' && this.options.isTaskPipelineBusy()) {
      const error = new Error('[StorageMaintenance] 发布任务正在运行，暂不可执行存储维护。')
      ;(error as { code?: string }).code = 'PUBLISH_PIPELINE_ACTIVE'
      throw error
    }

    this.running = true
    this.lockReason = reason

    const startedAt = nowMs()
    const runId = this.buildRunId(startedAt)
    const notes: string[] = []
    const operations: ManifestOperation[] = []
    const config = this.readConfig()
    const userDataPath = this.options.getUserDataPath()
    const workspacePath = this.options.getWorkspacePath()
    const retainMs = config.retainDays * 24 * 60 * 60 * 1000
    const cutoff = nowMs() - retainMs

    const summary: StorageMaintenanceSummary['results'] = {
      orphanAssetsDeleted: 0,
      orphanAssetsDeletedBytes: 0,
      orphanPartitionsDeleted: 0,
      orphanPartitionsDeletedBytes: 0,
      tempFilesDeleted: 0,
      tempFilesDeletedBytes: 0,
      migratedVideos: 0,
      migratedVideoBytes: 0,
      skippedMigrations: 0
    }

    try {
      const referencedAssets = this.collectReferencedGeneratedAssets()
      await this.cleanOrphanGeneratedAssets({
        dirPath: join(userDataPath, 'generated_assets'),
        referencedAssets,
        cutoff,
        runId,
        config,
        dryRun,
        summary,
        operations,
        notes
      })

      const activePartitions = new Set(
        this.options
          .getActivePartitionNames()
          .map((item) => String(item ?? '').trim())
          .filter(Boolean)
      )
      activePartitions.add('scout-sourcing')
      activePartitions.add('scout-xhs-cover')
      activePartitions.add('scout-xhs-cover-relaxed')
      activePartitions.add('xhs_note_preview')

      await this.cleanOrphanPartitions({
        partitionsDir: join(userDataPath, 'Partitions'),
        activePartitions,
        cutoff,
        runId,
        config,
        dryRun,
        summary,
        operations,
        notes
      })

      await this.cleanTempFiles({
        dirPath: join(userDataPath, 'temp_covers'),
        cutoff,
        runId,
        config,
        dryRun,
        summary,
        operations,
        notes
      })
      await this.cleanTempFiles({
        dirPath: join(userDataPath, 'temp_previews'),
        cutoff,
        runId,
        config,
        dryRun,
        summary,
        operations,
        notes
      })

      await this.migrateOldGeneratedVideos({
        generatedVideosDir: join(userDataPath, 'generated_videos'),
        cutoff,
        runId,
        config,
        dryRun,
        summary,
        operations,
        notes
      })

      if (!dryRun) {
        await this.purgeOldManifestsAndRecycle(runId, config)
      }

      const finishedAt = nowMs()
      const manifestDoc: ManifestDoc = {
        version: 1,
        runId,
        mode,
        startedAt,
        finishedAt,
        config,
        workspacePath,
        userDataPath,
        notes,
        operations,
        summary
      }
      const manifestPath = join(this.getManifestsDir(), `${runId}.json`)
      await ensureDir(this.getManifestsDir())
      await writeFile(manifestPath, JSON.stringify(manifestDoc, null, 2), 'utf-8')

      const result: StorageMaintenanceSummary = {
        runId,
        mode,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        results: summary,
        notes,
        manifestPath
      }

      this.lastRunAt = finishedAt
      this.lastRunId = runId
      this.updateSchedule()
      this.options.log(
        'info',
        `[StorageMaintenance] run completed (${mode}) assets=${summary.orphanAssetsDeleted} partitions=${summary.orphanPartitionsDeleted} temp=${summary.tempFilesDeleted} migratedVideos=${summary.migratedVideos}`
      )

      return result
    } finally {
      this.running = false
      this.lockReason = null
    }
  }

  private collectReferencedGeneratedAssets(): Set<string> {
    const set = new Set<string>()
    const db = this.options.tryGetSqliteConnection()
    if (!db) return set

    try {
      const rows = db
        .prepare(
          `SELECT DISTINCT value
             FROM tasks, json_each(tasks.images)
            WHERE value LIKE ?`
        )
        .all('%generated_assets%') as Array<Record<string, unknown>>
      for (const row of rows) {
        const raw = typeof row.value === 'string' ? row.value.trim() : ''
        if (!raw) continue
        set.add(raw)
        try {
          set.add(resolve(raw))
        } catch {
          void 0
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.log('error', `[StorageMaintenance] failed to read asset references: ${message}`)
    }

    return set
  }

  private buildTaskVideoReferenceIndex():
    | {
        refsByPath: Map<string, Array<{ taskId: string; status: string }>>
        updateTaskPath: (taskIds: string[], nextVideoPath: string) => void
      }
    | null {
    const db = this.options.tryGetSqliteConnection()
    if (!db) return null

    try {
      const rows = db
        .prepare(
          `SELECT id, videoPath, status
             FROM tasks
            WHERE mediaType = 'video'
              AND videoPath IS NOT NULL
              AND TRIM(videoPath) <> ''`
        )
        .all() as Array<Record<string, unknown>>

      const refsByPath = new Map<string, Array<{ taskId: string; status: string }>>()
      for (const row of rows) {
        const taskId = typeof row.id === 'string' ? row.id.trim() : ''
        const rawVideoPath = typeof row.videoPath === 'string' ? row.videoPath.trim() : ''
        const status = typeof row.status === 'string' ? row.status.trim() : ''
        if (!taskId || !rawVideoPath || !isAbsolute(rawVideoPath)) continue
        const absoluteVideoPath = resolve(rawVideoPath)
        const refs = refsByPath.get(absoluteVideoPath) ?? []
        refs.push({ taskId, status })
        refsByPath.set(absoluteVideoPath, refs)
      }

      const updateTaskStmt = db.prepare(`UPDATE tasks SET videoPath = @videoPath WHERE id = @id`)
      return {
        refsByPath,
        updateTaskPath: (taskIds: string[], nextVideoPath: string): void => {
          const normalizedPath = String(nextVideoPath ?? '').trim()
          if (!normalizedPath) return
          for (const taskId of taskIds) {
            updateTaskStmt.run({
              id: taskId,
              videoPath: normalizedPath
            })
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.log('error', `[StorageMaintenance] failed to build task video reference index: ${message}`)
      return null
    }
  }

  private async cleanOrphanGeneratedAssets(input: {
    dirPath: string
    referencedAssets: Set<string>
    cutoff: number
    runId: string
    config: MaintenanceConfig
    dryRun: boolean
    summary: StorageMaintenanceSummary['results']
    operations: ManifestOperation[]
    notes: string[]
  }): Promise<void> {
    if (!existsSync(input.dirPath)) return
    const entries = await readdir(input.dirPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const fullPath = join(input.dirPath, entry.name)
      const normalizedPath = resolve(fullPath)
      const referenced = input.referencedAssets.has(fullPath) || input.referencedAssets.has(normalizedPath)
      if (referenced) continue

      const fileStats = await stat(fullPath).catch(() => null)
      if (!fileStats || !fileStats.isFile()) continue
      if (Number(fileStats.mtimeMs || 0) > input.cutoff) continue

      const size = Number(fileStats.size || 0)
      const { reversible, recyclePath } = await this.removePath({
        path: fullPath,
        isDir: false,
        runId: input.runId,
        config: input.config,
        dryRun: input.dryRun
      })
      if (!input.dryRun && input.config.archivePath && !reversible) {
        input.notes.push(`[StorageMaintenance] 跳过 orphan asset 删除：${basename(fullPath)}`)
        continue
      }
      input.summary.orphanAssetsDeleted += 1
      input.summary.orphanAssetsDeletedBytes += size
      input.operations.push({ kind: 'delete_file', path: fullPath, size, reversible, recyclePath })
    }
  }

  private async cleanOrphanPartitions(input: {
    partitionsDir: string
    activePartitions: Set<string>
    cutoff: number
    runId: string
    config: MaintenanceConfig
    dryRun: boolean
    summary: StorageMaintenanceSummary['results']
    operations: ManifestOperation[]
    notes: string[]
  }): Promise<void> {
    if (!existsSync(input.partitionsDir)) return
    const entries = await readdir(input.partitionsDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const name = String(entry.name ?? '').trim()
      if (!name || input.activePartitions.has(name) || !this.isManagedPartitionName(name)) continue

      const fullPath = join(input.partitionsDir, name)
      const dirStats = await stat(fullPath).catch(() => null)
      if (!dirStats || !dirStats.isDirectory()) continue
      if (Number(dirStats.mtimeMs || 0) > input.cutoff) continue

      const size = await this.calculateDirSize(fullPath)
      const { reversible, recyclePath } = await this.removePath({
        path: fullPath,
        isDir: true,
        runId: input.runId,
        config: input.config,
        dryRun: input.dryRun
      })
      if (!input.dryRun && input.config.archivePath && !reversible) {
        input.notes.push(`[StorageMaintenance] 跳过 orphan partition 删除：${name}`)
        continue
      }
      input.summary.orphanPartitionsDeleted += 1
      input.summary.orphanPartitionsDeletedBytes += size
      input.operations.push({ kind: 'delete_dir', path: fullPath, size, reversible, recyclePath })
    }
  }

  private async cleanTempFiles(input: {
    dirPath: string
    cutoff: number
    runId: string
    config: MaintenanceConfig
    dryRun: boolean
    summary: StorageMaintenanceSummary['results']
    operations: ManifestOperation[]
    notes: string[]
  }): Promise<void> {
    if (!existsSync(input.dirPath)) return
    const entries = await readdir(input.dirPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const fullPath = join(input.dirPath, entry.name)
      const fileStats = await stat(fullPath).catch(() => null)
      if (!fileStats || !fileStats.isFile()) continue
      if (Number(fileStats.mtimeMs || 0) > input.cutoff) continue

      const size = Number(fileStats.size || 0)
      const { reversible, recyclePath } = await this.removePath({
        path: fullPath,
        isDir: false,
        runId: input.runId,
        config: input.config,
        dryRun: input.dryRun
      })
      if (!input.dryRun && input.config.archivePath && !reversible) {
        input.notes.push(`[StorageMaintenance] 跳过 temp 文件删除：${basename(fullPath)}`)
        continue
      }
      input.summary.tempFilesDeleted += 1
      input.summary.tempFilesDeletedBytes += size
      input.operations.push({ kind: 'delete_file', path: fullPath, size, reversible, recyclePath })
    }
  }

  private async migrateOldGeneratedVideos(input: {
    generatedVideosDir: string
    cutoff: number
    runId: string
    config: MaintenanceConfig
    dryRun: boolean
    summary: StorageMaintenanceSummary['results']
    operations: ManifestOperation[]
    notes: string[]
  }): Promise<void> {
    if (!existsSync(input.generatedVideosDir)) return

    const archiveBase = input.config.archivePath
    if (!archiveBase) {
      input.notes.push('archivePath 未配置，跳过视频迁移。')
      input.summary.skippedMigrations += 1
      return
    }

    const archiveDir = join(archiveBase, 'super-cms-archive', 'generated_videos')
    await ensureDir(archiveDir)
    const taskVideoRefs = this.buildTaskVideoReferenceIndex()
    if (!taskVideoRefs) {
      input.notes.push('sqlite 不可用，跳过视频迁移以避免影响历史回看。')
      input.summary.skippedMigrations += 1
      return
    }

    const entries = await readdir(input.generatedVideosDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const sourcePath = join(input.generatedVideosDir, entry.name)
      const sourceStats = await stat(sourcePath).catch(() => null)
      if (!sourceStats || !sourceStats.isFile()) continue
      if (Number(sourceStats.mtimeMs || 0) > input.cutoff) continue

      const size = Number(sourceStats.size || 0)
      try {
        const sourceAbsPath = resolve(sourcePath)
        const referencedTaskRefs = taskVideoRefs.refsByPath.get(sourceAbsPath) ?? []
        const hasNonTerminalTaskRefs = referencedTaskRefs.some((ref) => !isTaskStatusSafeForArchiveMigration(ref.status))
        if (hasNonTerminalTaskRefs) {
          input.summary.skippedMigrations += 1
          input.notes.push(`[StorageMaintenance] 跳过迁移（存在待处理任务引用）：${basename(sourcePath)}`)
          continue
        }

        if (input.dryRun) {
          input.summary.migratedVideos += 1
          input.summary.migratedVideoBytes += size
          continue
        }

        const sourceSha1 = await hashFileSha1(sourcePath)
        const targetBasePath = join(archiveDir, entry.name)
        const target = await this.resolveArchiveTargetPath(targetBasePath, sourceSha1)

        if (!target.alreadyPresent) {
          await ensureDir(dirname(target.path))
          const stagingPath = `${target.path}.tmp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
          await copyFile(sourcePath, stagingPath)
          const stagingSha1 = await hashFileSha1(stagingPath)
          if (stagingSha1 !== sourceSha1) {
            await unlink(stagingPath).catch(() => void 0)
            throw new Error(`[StorageMaintenance] video archive checksum mismatch: ${basename(sourcePath)}`)
          }
          await rename(stagingPath, target.path)
        }

        const referencedTaskIds = referencedTaskRefs.map((ref) => ref.taskId)
        if (referencedTaskIds.length > 0) {
          taskVideoRefs.updateTaskPath(referencedTaskIds, target.path)
          const targetAbsPath = resolve(target.path)
          const existing = taskVideoRefs.refsByPath.get(targetAbsPath) ?? []
          taskVideoRefs.refsByPath.set(
            targetAbsPath,
            existing.concat(referencedTaskRefs.map((ref) => ({ taskId: ref.taskId, status: ref.status })))
          )
          taskVideoRefs.refsByPath.delete(sourceAbsPath)
          input.notes.push(`[StorageMaintenance] 已更新 ${referencedTaskIds.length} 条任务视频路径：${basename(sourcePath)}`)
        }

        await unlink(sourcePath)
        input.summary.migratedVideos += 1
        input.summary.migratedVideoBytes += size
        input.operations.push({
          kind: 'migrate_file',
          sourcePath,
          targetPath: target.path,
          size,
          sha1: sourceSha1
        })
      } catch (error) {
        input.summary.skippedMigrations += 1
        const message = error instanceof Error ? error.message : String(error)
        input.notes.push(`[StorageMaintenance] 视频迁移失败，已跳过：${basename(sourcePath)} (${message})`)
        this.options.log('error', `[StorageMaintenance] migrate video skipped: ${basename(sourcePath)} (${message})`)
      }
    }
  }

  private async removePath(input: {
    path: string
    isDir: boolean
    runId: string
    config: MaintenanceConfig
    dryRun: boolean
  }): Promise<{ reversible: boolean; recyclePath?: string }> {
    if (input.dryRun) return { reversible: false }

    const archivePath = input.config.archivePath
    if (!archivePath) {
      if (input.isDir) {
        await rm(input.path, { recursive: true, force: true })
      } else {
        await unlink(input.path).catch(() => void 0)
      }
      return { reversible: false }
    }

    const recyclePath = this.buildRecyclePath(input.path, input.runId, archivePath)
    await ensureDir(dirname(recyclePath))
    await rm(recyclePath, { recursive: true, force: true }).catch(() => void 0)

    try {
      await this.movePath(input.path, recyclePath, input.isDir)
      await removeEmptyDirsUpward(resolve(join(input.path, '..')), this.options.getUserDataPath())
      return { reversible: true, recyclePath }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.options.log('error', `[StorageMaintenance] recycle move failed, source kept: ${input.path} (${message})`)
      return { reversible: false }
    }
  }

  private async calculateDirSize(dirPath: string): Promise<number> {
    let total = 0
    const stack = [dirPath]
    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) continue
      const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          stack.push(full)
          continue
        }
        if (!entry.isFile()) continue
        const info = await stat(full).catch(() => null)
        if (!info || !info.isFile()) continue
        total += Number(info.size || 0)
      }
    }
    return total
  }

  private async purgeOldManifestsAndRecycle(currentRunId: string, config: MaintenanceConfig): Promise<void> {
    const manifestsDir = this.getManifestsDir()
    const recycleRoot = config.archivePath ? join(config.archivePath, 'super-cms-archive', 'recycle') : ''
    const keepDays = Math.max(MIN_MANIFEST_KEEP_DAYS, config.retainDays)
    const keepMs = keepDays * 24 * 60 * 60 * 1000

    if (existsSync(manifestsDir)) {
      const entries = await readdir(manifestsDir, { withFileTypes: true }).catch(() => [])
      const now = nowMs()
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const runId = entry.name.replace(/\.json$/i, '')
        if (runId === currentRunId) continue
        const full = join(manifestsDir, entry.name)
        const info = await stat(full).catch(() => null)
        if (!info || !info.isFile()) continue
        if (now - Number(info.mtimeMs || 0) <= keepMs) continue
        await unlink(full).catch(() => void 0)
      }
    }

    if (recycleRoot && existsSync(recycleRoot)) {
      const entries = await readdir(recycleRoot, { withFileTypes: true }).catch(() => [])
      const now = nowMs()
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const full = join(recycleRoot, entry.name)
        const info = await stat(full).catch(() => null)
        if (!info || !info.isDirectory()) continue
        if (now - Number(info.mtimeMs || 0) <= keepMs) continue
        await rm(full, { recursive: true, force: true }).catch(() => void 0)
      }
    }
  }

  private computeNextRunAt(startTime: string): number {
    const now = new Date()
    const minutes = parseStartTimeToMinutes(startTime)
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    const next = new Date(now)
    next.setHours(hours, mins, 0, 0)
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1)
    }
    return next.getTime()
  }

  private buildRunId(ts: number): string {
    const d = new Date(ts)
    const parts = [
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0')
    ]
    return `run-${parts.join('')}-${Math.random().toString(16).slice(2, 7)}`
  }

  private readConfig(): MaintenanceConfig {
    const enabledRaw = this.options.getConfig('storageMaintenanceEnabled')
    const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : false
    const startTime = normalizeStartTime(this.options.getConfig('storageMaintenanceStartTime'))
    const retainDays = toPositiveInt(
      this.options.getConfig('storageMaintenanceRetainDays'),
      DEFAULT_RETAIN_DAYS,
      MIN_RETAIN_DAYS,
      MAX_RETAIN_DAYS
    )
    const archivePath = normalizeArchivePath(this.options.getConfig('storageArchivePath'))
    return { enabled, startTime, retainDays, archivePath }
  }

  private getManifestsDir(): string {
    return join(this.options.getUserDataPath(), 'storage-maintenance', 'manifests')
  }

  private buildRecyclePath(sourcePath: string, runId: string, archivePath: string): string {
    const recycleRoot = join(archivePath, 'super-cms-archive', 'recycle', runId)
    const absoluteSourcePath = resolve(sourcePath)
    const userDataRoot = resolve(this.options.getUserDataPath())
    const rel = relative(userDataRoot, absoluteSourcePath)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return join(recycleRoot, rel)
    }

    const safeName = basename(absoluteSourcePath).replace(/[^A-Za-z0-9._-]/g, '_') || 'item'
    const hash = createHash('sha1').update(absoluteSourcePath).digest('hex').slice(0, 12)
    return join(recycleRoot, '_external', `${safeName}-${hash}`)
  }

  private isManagedPartitionName(name: string): boolean {
    return name.startsWith('xhs_') || name.startsWith('scout-') || name === 'xhs_note_preview'
  }

  private async movePath(sourcePath: string, targetPath: string, isDir: boolean): Promise<void> {
    try {
      await rename(sourcePath, targetPath)
      return
    } catch (error) {
      if (!this.canFallbackToCopy(error)) {
        throw error
      }
    }

    if (isDir) {
      await cp(sourcePath, targetPath, { recursive: true, force: true, errorOnExist: false })
      await rm(sourcePath, { recursive: true, force: true })
      return
    }

    await copyFile(sourcePath, targetPath)
    await unlink(sourcePath)
  }

  private canFallbackToCopy(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code
    if (typeof code !== 'string') return true
    return code === 'EXDEV' || code === 'EPERM' || code === 'EINVAL' || code === 'ENOTSUP'
  }

  private async resolveArchiveTargetPath(
    targetBasePath: string,
    sourceSha1: string
  ): Promise<{ path: string; alreadyPresent: boolean }> {
    if (!existsSync(targetBasePath)) {
      return { path: targetBasePath, alreadyPresent: false }
    }

    try {
      const existingSha1 = await hashFileSha1(targetBasePath)
      if (existingSha1 === sourceSha1) {
        return { path: targetBasePath, alreadyPresent: true }
      }
    } catch {
      void 0
    }

    const ext = extname(targetBasePath)
    const name = ext ? basename(targetBasePath, ext) : basename(targetBasePath)
    const dir = dirname(targetBasePath)
    const shortHash = sourceSha1.slice(0, 8)
    for (let i = 0; i < 100; i += 1) {
      const suffix = i === 0 ? `-${shortHash}` : `-${shortHash}-${i}`
      const candidate = join(dir, `${name}${suffix}${ext}`)
      if (!existsSync(candidate)) {
        return { path: candidate, alreadyPresent: false }
      }
      try {
        const existingSha1 = await hashFileSha1(candidate)
        if (existingSha1 === sourceSha1) {
          return { path: candidate, alreadyPresent: true }
        }
      } catch {
        void 0
      }
    }

    throw new Error(`[StorageMaintenance] cannot resolve archive target path: ${basename(targetBasePath)}`)
  }
}
