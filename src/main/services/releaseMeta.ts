import { existsSync, readdirSync, statSync } from 'fs'
import { extname, join, resolve } from 'path'

export type AppReleaseMeta = {
  majorVersion: number
  updatedAt: string
}

const APP_RELEASE_META: AppReleaseMeta = {
  // 仅在功能里程碑（新增关键能力）时递增主版本号。
  majorVersion: 1,
  // 当无法自动解析源码最新修改时间时使用该兜底值。
  updatedAt: '2026-02-20 10:10'
}

const TRACKED_SOURCE_DIRS = ['src/main', 'src/preload', 'src/renderer/src']
const TRACKED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json'])

function formatDateTimeMinute(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function resolveLatestSourceMtimeMs(): number | null {
  const projectRoot = resolve(process.cwd())
  let latest = 0

  for (const relativeDir of TRACKED_SOURCE_DIRS) {
    const rootDir = join(projectRoot, relativeDir)
    if (!existsSync(rootDir)) continue

    const stack: string[] = [rootDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()
      if (!currentDir) continue

      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          stack.push(fullPath)
          continue
        }
        if (!entry.isFile()) continue
        if (!TRACKED_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
        const mtimeMs = statSync(fullPath).mtimeMs
        if (Number.isFinite(mtimeMs) && mtimeMs > latest) latest = mtimeMs
      }
    }
  }

  return latest > 0 ? latest : null
}

export function getAppReleaseMeta(): AppReleaseMeta {
  const latestMtimeMs = resolveLatestSourceMtimeMs()
  if (!latestMtimeMs) return { ...APP_RELEASE_META }
  return {
    majorVersion: APP_RELEASE_META.majorVersion,
    updatedAt: formatDateTimeMinute(new Date(latestMtimeMs))
  }
}
