type VideoTaskLike = {
  id?: string
  assignedImages: string[]
  mediaType?: 'image' | 'video'
  videoPath?: string
}

function normalizePath(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sameImages(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function updateVideoTaskImagesById<T extends VideoTaskLike>(
  tasks: T[],
  taskId: string,
  nextImages: string[]
): { tasks: T[]; changed: boolean } {
  const normalizedTaskId = normalizePath(taskId)
  if (!normalizedTaskId) return { tasks, changed: false }
  let changed = false
  const nextTasks = tasks.map((task) => {
    const currentImages = Array.isArray(task.assignedImages) ? task.assignedImages : []
    if (normalizePath(task.id) !== normalizedTaskId) return task
    if (task.mediaType !== 'video') return task

    if (sameImages(currentImages, nextImages)) return task

    changed = true
    return {
      ...task,
      assignedImages: nextImages
    }
  })

  return { tasks: changed ? nextTasks : tasks, changed }
}

export function replaceVideoTaskCoverById<T extends VideoTaskLike>(
  tasks: T[],
  taskId: string,
  coverPath: string
): { tasks: T[]; changed: boolean } {
  const normalizedCoverPath = normalizePath(coverPath)
  if (!normalizedCoverPath) return { tasks, changed: false }
  return updateVideoTaskImagesById(tasks, taskId, [normalizedCoverPath])
}

export function restoreVideoTaskCoverById<T extends VideoTaskLike>(
  tasks: T[],
  taskId: string,
  fallbackCoverPath: string
): { tasks: T[]; changed: boolean } {
  const normalizedFallback = normalizePath(fallbackCoverPath)
  return updateVideoTaskImagesById(tasks, taskId, normalizedFallback ? [normalizedFallback] : [])
}
