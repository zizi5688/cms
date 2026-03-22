type VideoDispatchTaskLike = {
  id?: string
  title?: string
  assignedImages?: string[]
  mediaType?: 'image' | 'video'
  videoPath?: string
}

export type DuplicateVideoCoverEntry = {
  taskId: string
  title: string
  videoPath: string
}

export type DuplicateVideoCoverAssignment = {
  coverPath: string
  entries: DuplicateVideoCoverEntry[]
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fileNameFromPath(filePath: string): string {
  const normalized = normalizeText(filePath).replace(/\\/g, '/')
  if (!normalized) return ''
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? normalized
}

export function findDuplicateVideoCoverAssignments(
  tasks: VideoDispatchTaskLike[]
): DuplicateVideoCoverAssignment[] {
  const byCover = new Map<string, Map<string, DuplicateVideoCoverEntry>>()

  for (const task of tasks) {
    if (task?.mediaType !== 'video') continue

    const coverPath = normalizeText(task.assignedImages?.[0])
    const videoPath = normalizeText(task.videoPath)
    if (!coverPath || !videoPath) continue

    const coverGroup = byCover.get(coverPath) ?? new Map<string, DuplicateVideoCoverEntry>()
    if (!byCover.has(coverPath)) byCover.set(coverPath, coverGroup)
    if (coverGroup.has(videoPath)) continue

    coverGroup.set(videoPath, {
      taskId: normalizeText(task.id),
      title: normalizeText(task.title),
      videoPath
    })
  }

  return Array.from(byCover.entries())
    .map(([coverPath, entriesByVideo]) => ({
      coverPath,
      entries: Array.from(entriesByVideo.values()).sort((left, right) => left.videoPath.localeCompare(right.videoPath))
    }))
    .filter((group) => group.entries.length > 1)
    .sort((left, right) => left.coverPath.localeCompare(right.coverPath))
}

export function buildDuplicateVideoCoverWarningMessage(
  groups: DuplicateVideoCoverAssignment[]
): string {
  const normalizedGroups = Array.isArray(groups) ? groups.filter((group) => group.entries.length > 1) : []
  if (normalizedGroups.length === 0) return '未检测到重复视频封面。'

  const lines = ['检测到同一批次里不同视频复用了同一张封面，已停止派发。', '']
  normalizedGroups.forEach((group, index) => {
    lines.push(`${index + 1}. 封面：${fileNameFromPath(group.coverPath) || group.coverPath}`)
    group.entries.forEach((entry) => {
      const videoLabel = fileNameFromPath(entry.videoPath) || entry.videoPath
      const titleLabel = entry.title || '（无标题）'
      lines.push(`   - ${videoLabel} -> ${titleLabel}`)
    })
    if (index < normalizedGroups.length - 1) lines.push('')
  })
  lines.push('', '请先在“视频封面管理”里调整后再派发。')
  return lines.join('\n')
}
