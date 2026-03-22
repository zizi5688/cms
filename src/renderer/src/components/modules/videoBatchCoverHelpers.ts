type VideoTaskLike = {
  assignedImages: string[]
  mediaType?: 'image' | 'video'
  videoCoverMode?: 'auto' | 'manual'
}

function compareNaturalByFilename(left: string, right: string): number {
  const leftName = left.replace(/\\/g, '/').split('/').pop() ?? left
  const rightName = right.replace(/\\/g, '/').split('/').pop() ?? right
  return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortCoverImagePathsByNaturalFilename(paths: string[]): string[] {
  return [...paths].sort(compareNaturalByFilename)
}

export function applyBatchCoverPathsToVideoTasks<T extends VideoTaskLike>(
  tasks: T[],
  coverPaths: string[]
): { tasks: T[]; changed: boolean; appliedCount: number } {
  let changed = false
  let appliedCount = 0
  let nextCoverIndex = 0

  const nextTasks = tasks.map((task) => {
    if (task.mediaType !== 'video') return task

    const nextCoverPath = coverPaths[nextCoverIndex] ?? ''
    nextCoverIndex += 1
    if (!nextCoverPath) return task

    appliedCount += 1
    const nextImages = [nextCoverPath]
    const currentImages = Array.isArray(task.assignedImages) ? task.assignedImages : []
    const isSame =
      currentImages.length === nextImages.length &&
      currentImages.every((value, index) => value === nextImages[index])
    if (isSame) return task

    changed = true
    return {
      ...task,
      assignedImages: nextImages,
      videoCoverMode: 'manual'
    }
  })

  return {
    tasks: changed ? nextTasks : tasks,
    changed,
    appliedCount
  }
}
