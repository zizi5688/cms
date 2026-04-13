export type QueuePublishOutcome =
  | { kind: 'published'; time: string }
  | { kind: 'draft_saved' }
  | { kind: 'invalid_success' }
  | { kind: 'failed'; error: string }

export function resolveQueuePublishOutcome(input: {
  success: boolean
  time?: string
  savedAsDraft?: boolean
  error?: string
}): QueuePublishOutcome {
  if (input.success) {
    if (input.savedAsDraft === true) {
      return { kind: 'draft_saved' }
    }

    const time = typeof input.time === 'string' ? input.time.trim() : ''
    if (time) {
      return { kind: 'published', time }
    }

    return { kind: 'invalid_success' }
  }

  const error = typeof input.error === 'string' && input.error.trim() ? input.error.trim() : '发布失败，请检查后重新排期。'
  return { kind: 'failed', error }
}
