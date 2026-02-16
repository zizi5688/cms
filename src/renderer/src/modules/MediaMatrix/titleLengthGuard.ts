export const PENDING_POOL_TITLE_LIMIT = 20

export type TitleLengthIssue = {
  count: number
  limit: number
}

export function countUserVisibleChars(value: unknown): number {
  const text = typeof value === 'string' ? value : String(value ?? '')
  // 对齐小红书标题计数口径：UTF-16 code units（emoji 通常记作 2）
  return text.length
}

export function getTitleLengthIssue(value: unknown, limit = PENDING_POOL_TITLE_LIMIT): TitleLengthIssue | null {
  const count = countUserVisibleChars(value)
  return count > limit ? { count, limit } : null
}
