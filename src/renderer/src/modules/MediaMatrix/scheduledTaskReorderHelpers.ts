type ScheduledTaskLike = {
  id: string
  scheduledAt?: number | null
}

type ScheduledTaskReorderPlacement = 'before' | 'after'

function normalizeTaskId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isScheduledTask(task: ScheduledTaskLike | null | undefined): task is {
  id: string
  scheduledAt: number
} {
  return Boolean(
    task &&
      typeof task.id === 'string' &&
      task.id.trim() &&
      typeof task.scheduledAt === 'number' &&
      Number.isFinite(task.scheduledAt)
  )
}

export function buildScheduledTaskReorderPatches(input: {
  tasks: ScheduledTaskLike[]
  activeTaskId: string
  overTaskId: string
  placement: ScheduledTaskReorderPlacement
}): Array<{ id: string; scheduledAt: number }> {
  const activeTaskId = normalizeTaskId(input.activeTaskId)
  const overTaskId = normalizeTaskId(input.overTaskId)
  if (!activeTaskId || !overTaskId || activeTaskId === overTaskId) return []

  const scheduledTasks = (Array.isArray(input.tasks) ? input.tasks : [])
    .filter(isScheduledTask)
    .map((task, index) => ({
      id: task.id.trim(),
      scheduledAt: task.scheduledAt,
      index
    }))
    .sort((left, right) => left.scheduledAt - right.scheduledAt || left.index - right.index)

  if (scheduledTasks.length < 2) return []

  const activeIndex = scheduledTasks.findIndex((task) => task.id === activeTaskId)
  const overIndex = scheduledTasks.findIndex((task) => task.id === overTaskId)
  if (activeIndex < 0 || overIndex < 0) return []

  const reordered = scheduledTasks.slice()
  const [activeTask] = reordered.splice(activeIndex, 1)
  if (!activeTask) return []

  const nextOverIndex = reordered.findIndex((task) => task.id === overTaskId)
  if (nextOverIndex < 0) return []

  const insertIndex = input.placement === 'after' ? nextOverIndex + 1 : nextOverIndex
  reordered.splice(insertIndex, 0, activeTask)

  const isSameOrder = reordered.every((task, index) => task.id === scheduledTasks[index]?.id)
  if (isSameOrder) return []

  const timeSlots = scheduledTasks.map((task) => task.scheduledAt)
  return reordered.map((task, index) => ({
    id: task.id,
    scheduledAt: timeSlots[index] ?? task.scheduledAt
  }))
}
