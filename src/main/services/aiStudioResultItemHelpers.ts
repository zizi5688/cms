import { createHash } from 'crypto'

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildImageResultItemSignature(item: Record<string, unknown>): string {
  const url = normalizeText(item.url)
  if (url) return `url:${url}`

  const content = normalizeText(item.content)
  if (!content) return ''
  return `content:${createHash('sha1').update(content).digest('hex')}`
}

export function pushUniqueAiStudioImageResultItem(
  bucket: Array<Record<string, unknown>>,
  item: Record<string, unknown> | null | undefined
): void {
  if (!item) return
  const url = normalizeText(item.url)
  const content = normalizeText(item.content)
  if (!url && !content) return

  const signature = buildImageResultItemSignature({ url, content })
  if (!signature) return

  const exists = bucket.some((existing) => buildImageResultItemSignature(existing) === signature)
  if (exists) return

  bucket.push({
    ...item,
    ...(url ? { url } : {}),
    ...(content ? { content } : {})
  })
}
