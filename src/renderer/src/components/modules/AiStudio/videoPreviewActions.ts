import type { PreviewTileStatus } from './previewSlotHelpers'

export function shouldShowVideoRegenerateAction(input: {
  status: PreviewTileStatus
  hasAsset: boolean
}): boolean {
  return input.status === 'failed' || (input.status === 'ready' && input.hasAsset)
}

export function buildVideoRetrySlotKey(taskId: string, sequenceIndex: number): string {
  const normalizedTaskId = String(taskId ?? '').trim()
  const normalizedSequenceIndex = Math.max(1, Math.floor(Number(sequenceIndex) || 0))
  if (!normalizedTaskId || normalizedSequenceIndex <= 0) return ''
  return `${normalizedTaskId}#${normalizedSequenceIndex}`
}

export function claimVideoRetrySlot(
  inflight: Set<string>,
  taskId: string,
  sequenceIndex: number
): boolean {
  const key = buildVideoRetrySlotKey(taskId, sequenceIndex)
  if (!key || inflight.has(key)) return false
  inflight.add(key)
  return true
}

export function releaseVideoRetrySlot(
  inflight: Set<string>,
  taskId: string,
  sequenceIndex: number
): void {
  const key = buildVideoRetrySlotKey(taskId, sequenceIndex)
  if (!key) return
  inflight.delete(key)
}
