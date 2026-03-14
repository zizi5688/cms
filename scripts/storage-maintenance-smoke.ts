import { mkdtempSync, existsSync } from 'fs'
import { copyFile, mkdir, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import os from 'os'
import { basename, join, resolve } from 'path'
import {
  StorageMaintenanceService,
  type StorageMaintenanceLogLevel
} from '../src/main/services/storageMaintenanceService'

type AssertContext = {
  failures: string[]
}

function assertTrue(ctx: AssertContext, condition: boolean, message: string): void {
  if (!condition) {
    ctx.failures.push(message)
  }
}

async function exists(path: string): Promise<boolean> {
  return existsSync(path)
}

async function markOld(path: string, daysAgo: number): Promise<void> {
  const now = Date.now()
  const ts = now - daysAgo * 24 * 60 * 60 * 1000
  const d = new Date(ts)
  await utimes(path, d, d)
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(resolve(join(path, '..')), { recursive: true })
}

type FakeTaskRow = {
  id: string
  images: string[]
  mediaType: 'image' | 'video'
  status: string
  videoPath: string | null
}

type FakeStatement = {
  all: (...args: unknown[]) => Array<Record<string, unknown>>
  run: (params?: unknown) => unknown
}

class FakeDb {
  private tasks: FakeTaskRow[] = []

  addTask(row: FakeTaskRow): void {
    this.tasks.push({
      id: row.id,
      images: Array.isArray(row.images) ? row.images.slice() : [],
      mediaType: row.mediaType,
      status: typeof row.status === 'string' ? row.status : 'pending',
      videoPath: row.videoPath
    })
  }

  listVideoTasks(): Array<{ id: string; status: string; videoPath: string }> {
    return this.tasks
      .filter((task) => task.mediaType === 'video' && typeof task.videoPath === 'string' && task.videoPath.trim() !== '')
      .map((task) => ({ id: task.id, status: task.status, videoPath: String(task.videoPath) }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  prepare(sql: string): FakeStatement {
    const normalizedSql = String(sql ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

    if (normalizedSql.includes('from tasks, json_each(tasks.images)')) {
      return {
        all: (...args: unknown[]) => {
          const likeRaw = typeof args[0] === 'string' ? args[0] : '%generated_assets%'
          const needle = likeRaw.replaceAll('%', '')
          const out: Array<Record<string, unknown>> = []
          const seen = new Set<string>()
          for (const task of this.tasks) {
            for (const imagePath of task.images) {
              if (!imagePath.includes(needle)) continue
              if (seen.has(imagePath)) continue
              seen.add(imagePath)
              out.push({ value: imagePath })
            }
          }
          return out
        },
        run: () => ({})
      }
    }

    if (
      normalizedSql.includes('select id, videopath') &&
      normalizedSql.includes('from tasks') &&
      normalizedSql.includes("mediatype = 'video'")
    ) {
      return {
        all: () => {
          return this.listVideoTasks().map((row) => ({ id: row.id, status: row.status, videoPath: row.videoPath }))
        },
        run: () => ({})
      }
    }

    if (normalizedSql.includes('update tasks set videopath') && normalizedSql.includes('where id = @id')) {
      return {
        all: () => [],
        run: (params?: unknown) => {
          const row = (params ?? {}) as Record<string, unknown>
          const id = typeof row.id === 'string' ? row.id : ''
          const videoPath = typeof row.videoPath === 'string' ? row.videoPath : null
          const target = this.tasks.find((task) => task.id === id)
          if (target) target.videoPath = videoPath
          return { changes: target ? 1 : 0 }
        }
      }
    }

    throw new Error(`[smoke] unsupported SQL in fake DB: ${sql}`)
  }
}

function short(path: string): string {
  const normalized = String(path ?? '').trim()
  const marker = '/tmp/'
  const idx = normalized.indexOf(marker)
  if (idx >= 0) return normalized.slice(idx)
  return normalized
}

async function main(): Promise<void> {
  const ctx: AssertContext = { failures: [] }
  const tmpRoot = mkdtempSync(join(os.tmpdir(), 'cms-storage-maintenance-smoke-'))
  const workspacePath = join(tmpRoot, 'workspace')
  const userDataPath = join(tmpRoot, 'userData')
  const archivePath = process.env.CMS_STORAGE_SMOKE_ARCHIVE_PATH
    ? resolve(process.env.CMS_STORAGE_SMOKE_ARCHIVE_PATH)
    : join(tmpRoot, 'archive')
  const oldDays = 10

  console.log('[smoke] sandbox root:', tmpRoot)
  console.log('[smoke] archive path:', archivePath)

  try {
    await mkdir(workspacePath, { recursive: true })
    await mkdir(userDataPath, { recursive: true })
    await mkdir(archivePath, { recursive: true })
    await mkdir(join(userDataPath, 'generated_assets'), { recursive: true })
    await mkdir(join(userDataPath, 'generated_videos'), { recursive: true })
    await mkdir(join(userDataPath, 'temp_covers'), { recursive: true })
    await mkdir(join(userDataPath, 'temp_previews'), { recursive: true })
    await mkdir(join(userDataPath, 'Partitions'), { recursive: true })

    const generatedAssetReferenced = join(userDataPath, 'generated_assets', 'ref.jpg')
    const generatedAssetOrphan = join(userDataPath, 'generated_assets', 'orphan.jpg')
    const generatedVideoA = join(userDataPath, 'generated_videos', 'story.mp4')
    const generatedVideoB = join(userDataPath, 'generated_videos', 'story-copy.mp4')
    const generatedVideoPending = join(userDataPath, 'generated_videos', 'story-pending.mp4')
    const tempCoverOld = join(userDataPath, 'temp_covers', 'old-cover.png')
    const tempPreviewOld = join(userDataPath, 'temp_previews', 'old-preview.png')
    const tempCoverFresh = join(userDataPath, 'temp_covers', 'fresh-cover.png')
    const partitionKeep = join(userDataPath, 'Partitions', 'xhs_acc_keep')
    const partitionDeleteManaged = join(userDataPath, 'Partitions', 'xhs_acc_old')
    const partitionDeleteUnmanaged = join(userDataPath, 'Partitions', 'third_party_other')

    await writeFile(generatedAssetReferenced, 'ref')
    await writeFile(generatedAssetOrphan, 'orphan')
    await writeFile(generatedVideoA, 'video-a')
    await writeFile(generatedVideoB, 'video-b')
    await writeFile(generatedVideoPending, 'video-pending')
    await writeFile(tempCoverOld, 'old-cover')
    await writeFile(tempPreviewOld, 'old-preview')
    await writeFile(tempCoverFresh, 'fresh-cover')
    await mkdir(partitionKeep, { recursive: true })
    await writeFile(join(partitionKeep, 'keep-cookie.txt'), 'keep')
    await mkdir(partitionDeleteManaged, { recursive: true })
    await writeFile(join(partitionDeleteManaged, 'old-cookie.txt'), 'old')
    await mkdir(partitionDeleteUnmanaged, { recursive: true })
    await writeFile(join(partitionDeleteUnmanaged, 'other-cookie.txt'), 'other')

    await markOld(generatedAssetReferenced, oldDays)
    await markOld(generatedAssetOrphan, oldDays)
    await markOld(generatedVideoA, oldDays)
    await markOld(generatedVideoB, oldDays)
    await markOld(generatedVideoPending, oldDays)
    await markOld(tempCoverOld, oldDays)
    await markOld(tempPreviewOld, oldDays)
    await markOld(partitionDeleteManaged, oldDays)
    await markOld(partitionDeleteUnmanaged, oldDays)

    const fakeDb = new FakeDb()
    fakeDb.addTask({
      id: 'task-ref',
      images: [generatedAssetReferenced],
      mediaType: 'image',
      status: 'pending',
      videoPath: null
    })
    fakeDb.addTask({
      id: 'task-video-a',
      images: [],
      mediaType: 'video',
      status: 'published',
      videoPath: generatedVideoA
    })
    fakeDb.addTask({
      id: 'task-video-b',
      images: [],
      mediaType: 'video',
      status: 'failed',
      videoPath: generatedVideoB
    })
    fakeDb.addTask({
      id: 'task-video-pending',
      images: [],
      mediaType: 'video',
      status: 'pending',
      videoPath: generatedVideoPending
    })

    const preSeedArchiveVideo = join(archivePath, 'super-cms-archive', 'generated_videos', basename(generatedVideoA))
    await ensureParent(preSeedArchiveVideo)
    await writeFile(preSeedArchiveVideo, 'older-different-content')

    const logs: Array<{ level: StorageMaintenanceLogLevel; message: string }> = []
    const config = new Map<string, unknown>([
      ['storageMaintenanceEnabled', true],
      ['storageMaintenanceStartTime', '02:30'],
      ['storageMaintenanceRetainDays', 7],
      ['storageArchivePath', archivePath]
    ])

    const service = new StorageMaintenanceService({
      getConfig: (key: string) => config.get(key),
      getWorkspacePath: () => workspacePath,
      getUserDataPath: () => userDataPath,
      getActivePartitionNames: () => ['xhs_acc_keep'],
      tryGetSqliteConnection: () =>
        ({
          prepare: (sql: string) => fakeDb.prepare(sql)
        }) as {
          prepare: (sql: string) => {
            all: (...args: unknown[]) => Array<Record<string, unknown>>
            run: (params?: unknown) => unknown
          }
        },
      log: (level: StorageMaintenanceLogLevel, message: string) => {
        logs.push({ level, message })
      }
    })

    console.log('[smoke] run dry-run...')
    const drySummary = await service.runNow({ reason: 'smoke-dry-run', dryRun: true })
    assertTrue(
      ctx,
      drySummary.results.orphanAssetsDeleted === 1,
      `dry-run orphanAssetsDeleted expected 1, got ${drySummary.results.orphanAssetsDeleted}`
    )
    assertTrue(
      ctx,
      drySummary.results.orphanPartitionsDeleted === 1,
      `dry-run orphanPartitionsDeleted expected 1, got ${drySummary.results.orphanPartitionsDeleted}`
    )
    assertTrue(
      ctx,
      drySummary.results.tempFilesDeleted === 2,
      `dry-run tempFilesDeleted expected 2, got ${drySummary.results.tempFilesDeleted}`
    )
    assertTrue(
      ctx,
      drySummary.results.migratedVideos === 2,
      `dry-run migratedVideos expected 2, got ${drySummary.results.migratedVideos}`
    )
    assertTrue(
      ctx,
      drySummary.results.skippedMigrations >= 1,
      `dry-run skippedMigrations expected >=1, got ${drySummary.results.skippedMigrations}`
    )
    assertTrue(ctx, await exists(generatedAssetOrphan), 'dry-run should not remove orphan asset')
    assertTrue(ctx, await exists(generatedVideoA), 'dry-run should not migrate video A')
    assertTrue(ctx, await exists(generatedVideoPending), 'dry-run should not migrate pending video')
    assertTrue(ctx, await exists(tempCoverOld), 'dry-run should not remove old temp cover')

    console.log('[smoke] run real-run...')
    const realSummary = await service.runNow({ reason: 'smoke-real-run', dryRun: false })
    const runId = realSummary.runId
    console.log('[smoke] real-run id:', runId)
    console.log('[smoke] real-run results:', JSON.stringify(realSummary.results))

    assertTrue(ctx, !(await exists(generatedAssetOrphan)), 'real-run should remove orphan generated asset')
    assertTrue(ctx, await exists(generatedAssetReferenced), 'real-run should keep referenced generated asset')
    assertTrue(ctx, !(await exists(tempCoverOld)), 'real-run should remove old temp cover')
    assertTrue(ctx, !(await exists(tempPreviewOld)), 'real-run should remove old temp preview')
    assertTrue(ctx, await exists(tempCoverFresh), 'real-run should keep fresh temp cover')
    assertTrue(ctx, !(await exists(partitionDeleteManaged)), 'real-run should remove managed orphan partition')
    assertTrue(ctx, await exists(partitionDeleteUnmanaged), 'real-run should keep unmanaged partition')
    assertTrue(ctx, await exists(partitionKeep), 'real-run should keep active partition')

    const archivedVideosDir = join(archivePath, 'super-cms-archive', 'generated_videos')
    const archivedEntries = (await readdir(archivedVideosDir)).filter((name) => name.startsWith('story'))
    assertTrue(ctx, archivedEntries.length >= 2, `expected at least 2 archived story files, got ${archivedEntries.length}`)
    assertTrue(ctx, !(await exists(generatedVideoA)), 'real-run should migrate video A out of generated_videos')
    assertTrue(ctx, !(await exists(generatedVideoB)), 'real-run should migrate video B out of generated_videos')
    assertTrue(ctx, await exists(generatedVideoPending), 'real-run should keep pending status video in generated_videos')
    assertTrue(
      ctx,
      realSummary.results.skippedMigrations >= 1,
      `real-run skippedMigrations expected >=1, got ${realSummary.results.skippedMigrations}`
    )

    const taskVideoRows = fakeDb.listVideoTasks()
    for (const row of taskVideoRows) {
      if (row.id === 'task-video-pending') {
        assertTrue(
          ctx,
          row.videoPath === generatedVideoPending,
          `task ${row.id} videoPath should keep local path, got ${row.videoPath}`
        )
        continue
      }
      assertTrue(
        ctx,
        row.videoPath.startsWith(archivedVideosDir),
        `task ${row.id} videoPath should remap to archive, got ${row.videoPath}`
      )
    }

    console.log('[smoke] run rollback...')
    const rollbackResult = await service.rollback(runId)
    console.log('[smoke] rollback result:', JSON.stringify(rollbackResult))
    assertTrue(ctx, rollbackResult.success, `rollback expected success, got errors=${rollbackResult.errors.join('; ')}`)
    assertTrue(ctx, await exists(generatedAssetOrphan), 'rollback should restore orphan asset from recycle')
    assertTrue(ctx, await exists(partitionDeleteManaged), 'rollback should restore managed partition from recycle')
    assertTrue(ctx, await exists(tempCoverOld), 'rollback should restore old temp cover')
    assertTrue(ctx, await exists(tempPreviewOld), 'rollback should restore old temp preview')
    assertTrue(ctx, await exists(generatedVideoA), 'rollback should restore source video A copy')
    assertTrue(ctx, await exists(generatedVideoB), 'rollback should restore source video B copy')
    assertTrue(ctx, await exists(generatedVideoPending), 'rollback should keep pending video untouched')

    const manifestsDir = join(userDataPath, 'storage-maintenance', 'manifests')
    const manifestPath = join(manifestsDir, `${runId}.json`)
    assertTrue(ctx, await exists(manifestPath), `manifest file should exist: ${manifestPath}`)

    if (ctx.failures.length > 0) {
      console.error('[smoke] FAILED')
      for (const failure of ctx.failures) {
        console.error(' -', failure)
      }
      console.error('[smoke] sandbox:', short(tmpRoot))
      process.exitCode = 1
      return
    }

    console.log('[smoke] PASS')
    console.log('[smoke] sandbox:', short(tmpRoot))
    console.log('[smoke] notes: forensics data retained under sandbox for inspection')
    console.log('[smoke] log lines captured:', logs.length)
  } finally {
    const shouldClean = process.env.CMS_STORAGE_SMOKE_CLEAN === '1'
    if (shouldClean) {
      await rm(tmpRoot, { recursive: true, force: true })
    }
  }
}

void main()
