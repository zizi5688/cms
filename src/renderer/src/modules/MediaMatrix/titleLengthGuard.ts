export const PENDING_POOL_TITLE_LIMIT = 20

export type TitleLengthIssue = {
  count: number
  limit: number
}

type SegmenterLike = {
  segment: (input: string) => Iterable<unknown>
}

type SegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => SegmenterLike

function createGraphemeSegmenter(): SegmenterLike | null {
  const intlObj = (globalThis as { Intl?: { Segmenter?: SegmenterCtor } }).Intl
  const Ctor = intlObj?.Segmenter
  if (!Ctor) return null
  try {
    return new Ctor('zh-CN', { granularity: 'grapheme' })
  } catch (_error) {
    return null
  }
}

export function countUserVisibleChars(value: unknown): number {
  const text = typeof value === 'string' ? value : String(value ?? '')
  if (!text) return 0

  const segmenter = createGraphemeSegmenter()
  if (segmenter) {
    let count = 0
    for (const _chunk of segmenter.segment(text)) count += 1
    return count
  }

  return Array.from(text).length
}

export function getTitleLengthIssue(value: unknown, limit = PENDING_POOL_TITLE_LIMIT): TitleLengthIssue | null {
  const count = countUserVisibleChars(value)
  return count > limit ? { count, limit } : null
}
