function setDateKeepingTime(date: Date, source: Date): Date {
  const next = new Date(date)
  next.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds())
  return next
}

function withDefaultStartTime(date: Date, timeText: string): Date {
  const next = new Date(date)
  const normalized = String(timeText ?? '').trim()
  const match = /^(\d{2}):(\d{2})$/.exec(normalized)
  const hour = match ? Number(match[1]) : 10
  const minute = match ? Number(match[2]) : 0
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    next.setHours(10, 0, 0, 0)
    return next
  }
  next.setHours(hour, minute, 0, 0)
  return next
}

function getTaskDisplayTime(task: CmsPublishTask): number | null {
  const scheduledAt = typeof task.scheduledAt === 'number' && Number.isFinite(task.scheduledAt) ? task.scheduledAt : null
  if (task.status === 'published') {
    const publishedAt = typeof task.publishedAt === 'string' ? task.publishedAt.trim() : ''
    const parsed = publishedAt ? Date.parse(publishedAt) : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  }
  return scheduledAt
}

export { getTaskDisplayTime, setDateKeepingTime, withDefaultStartTime }
