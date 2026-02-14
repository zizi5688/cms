import moment from 'moment'

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

function getWeekLabel(date: Date): string {
  const start = moment(date).startOf('week')
  const end = moment(start).add(6, 'day')
  if (start.isSame(end, 'year')) {
    if (start.isSame(end, 'month')) {
      return `${start.format('YYYY年 M月 D日')} - ${end.format('D日')}`
    }
    return `${start.format('YYYY年 M月 D日')} - ${end.format('M月 D日')}`
  }
  return `${start.format('YYYY年 M月 D日')} - ${end.format('YYYY年 M月 D日')}`
}

function getWeekDates(baseDate: Date): Date[] {
  const start = moment(baseDate).startOf('week').startOf('day')
  return Array.from({ length: 7 }, (_, idx) => moment(start).add(idx, 'day').toDate())
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

export { getTaskDisplayTime, getWeekDates, getWeekLabel, setDateKeepingTime, withDefaultStartTime }
