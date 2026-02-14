import { app } from 'electron'
import { existsSync } from 'fs'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import ElectronStore from 'electron-store'
import { is } from '@electron-toolkit/utils'

type ElectronStoreCtor = new <T extends Record<string, unknown> = Record<string, unknown>>() => ElectronStore<T>
const StoreCtor = ((ElectronStore as unknown as { default?: ElectronStoreCtor }).default ??
  (ElectronStore as unknown as ElectronStoreCtor)) as ElectronStoreCtor

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatBackupTimestamp(date: Date): string {
  const yyyy = date.getFullYear()
  const mm = pad2(date.getMonth() + 1)
  const dd = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mi = pad2(date.getMinutes())
  const ss = pad2(date.getSeconds())
  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`
}

function resolveWorkspacePath(): string {
  const store = new StoreCtor<{ workspacePath?: string }>()
  const stored = store.get('workspacePath')
  const normalized = typeof stored === 'string' ? stored.trim() : ''
  return normalized || join(app.getPath('documents'), is.dev ? 'SuperCMS_Data_Dev' : 'SuperCMS_Data')
}

function getFileCreatedTimeMs(stats: Awaited<ReturnType<typeof stat>>): number {
  const birth = Number(stats.birthtimeMs || 0)
  if (Number.isFinite(birth) && birth > 0) return birth
  const mtime = Number(stats.mtimeMs || 0)
  if (Number.isFinite(mtime) && mtime > 0) return mtime
  return 0
}

export async function performBackup(): Promise<void> {
  const workspacePath = resolveWorkspacePath()
  const dbFilePath = join(workspacePath, 'cms.sqlite')
  if (!existsSync(dbFilePath)) return

  const backupsDir = join(app.getPath('userData'), 'backups')
  await mkdir(backupsDir, { recursive: true })

  const backupName = `cms_backup_${formatBackupTimestamp(new Date())}.sqlite`
  const backupPath = join(backupsDir, backupName)

  const data = await readFile(dbFilePath)
  await writeFile(backupPath, data)

  const dirents = await readdir(backupsDir, { withFileTypes: true })
  const candidates = dirents
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith('cms_backup_') && (name.endsWith('.sqlite') || name.endsWith('.json')))

  const items = await Promise.all(
    candidates.map(async (name) => {
      const absolutePath = join(backupsDir, name)
      try {
        const stats = await stat(absolutePath)
        return { name, absolutePath, createdAtMs: getFileCreatedTimeMs(stats) }
      } catch {
        return { name, absolutePath, createdAtMs: 0 }
      }
    })
  )

  items.sort((a, b) => b.createdAtMs - a.createdAtMs)

  const maxKeep = 7
  const toDelete = items.slice(maxKeep)
  for (const item of toDelete) {
    try {
      await unlink(item.absolutePath)
    } catch {
      void 0
    }
  }
}
