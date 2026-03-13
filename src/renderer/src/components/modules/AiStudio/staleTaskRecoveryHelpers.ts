type RecoverableTaskLike = {
  id: string
  status: string
  latestRunId: string | null
  remoteTaskId: string | null
  updatedAt: number
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function findAbandonedPreSubmitTaskIds<T extends RecoverableTaskLike>(
  tasks: T[],
  sessionStartedAt: number
): string[] {
  const safeSessionStartedAt = Number(sessionStartedAt)
  if (!Array.isArray(tasks) || !Number.isFinite(safeSessionStartedAt) || safeSessionStartedAt <= 0) {
    return []
  }

  return tasks
    .filter((task) => {
      const updatedAt = Number(task.updatedAt ?? 0)
      return (
        task.status === 'running' &&
        !hasValue(task.latestRunId) &&
        !hasValue(task.remoteTaskId) &&
        Number.isFinite(updatedAt) &&
        updatedAt > 0 &&
        updatedAt < safeSessionStartedAt
      )
    })
    .map((task) => task.id)
}
