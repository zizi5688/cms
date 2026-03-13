export type PreviewTileStatus = 'ready' | 'loading' | 'failed' | 'idle'

export type PreviewSlotRuntimeState = {
  status: 'queued' | 'generating' | 'cleaning' | 'failed'
  message?: string
  startedAt?: number
}

export function hasActivePreviewSlotRuntimeStates(
  runtimeStates: Record<number, PreviewSlotRuntimeState> | null | undefined
): boolean {
  if (!runtimeStates || typeof runtimeStates !== 'object') return false
  return Object.values(runtimeStates).some(
    (runtimeState) =>
      runtimeState != null &&
      (runtimeState.status === 'queued' ||
        runtimeState.status === 'generating' ||
        runtimeState.status === 'cleaning')
  )
}

function formatElapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatRuntimeStatusText(
  message: string,
  runtimeState: PreviewSlotRuntimeState,
  nowMs?: number
): string {
  const baseMessage = String(message ?? '').trim()
  const startedAt = Number(runtimeState.startedAt ?? 0)
  const safeNowMs = Number(nowMs ?? 0)
  if (!baseMessage || !Number.isFinite(startedAt) || startedAt <= 0 || !Number.isFinite(safeNowMs)) {
    return baseMessage
  }

  const elapsedMs = Math.max(0, safeNowMs - startedAt)
  return `${baseMessage} · 已等待 ${formatElapsedLabel(elapsedMs)}`
}

export function resolvePreviewSlotState(input: {
  index: number
  asset: unknown | null
  failureMessage: string | null
  isRunning: boolean
  currentLabel: string
  currentItemIndex: number
  nowMs?: number
  runtimeState?: PreviewSlotRuntimeState | null
}): { status: PreviewTileStatus; statusText: string } {
  if (input.failureMessage) {
    return {
      status: 'failed',
      statusText: input.failureMessage
    }
  }

  if (input.asset) {
    return {
      status: 'ready',
      statusText: ''
    }
  }

  if (input.runtimeState) {
    if (input.runtimeState.status === 'failed') {
      return {
        status: 'failed',
        statusText: input.runtimeState.message || '生成失败'
      }
    }

    if (input.runtimeState.status === 'cleaning') {
      return {
        status: 'loading',
        statusText: formatRuntimeStatusText(
          input.runtimeState.message || '去水印处理中',
          input.runtimeState,
          input.nowMs
        )
      }
    }

    if (input.runtimeState.status === 'generating') {
      return {
        status: 'loading',
        statusText: formatRuntimeStatusText(
          input.runtimeState.message || '结果生成中',
          input.runtimeState,
          input.nowMs
        )
      }
    }

    return {
      status: 'loading',
      statusText: formatRuntimeStatusText(
        input.runtimeState.message || '排队中',
        input.runtimeState,
        input.nowMs
      )
    }
  }

  if (!input.isRunning) {
    return {
      status: 'idle',
      statusText: ''
    }
  }

  if (input.currentItemIndex > 0 && input.index > input.currentItemIndex) {
    return {
      status: 'loading',
      statusText: '排队中'
    }
  }

  return {
    status: 'loading',
    statusText: input.currentLabel || '处理中'
  }
}
