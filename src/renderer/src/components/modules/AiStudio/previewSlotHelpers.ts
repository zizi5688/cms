export type PreviewTileStatus = 'ready' | 'loading' | 'failed' | 'idle'

export type PreviewSlotRuntimeState = {
  status: 'queued' | 'generating' | 'cleaning' | 'failed'
  message?: string
}

export function resolvePreviewSlotState(input: {
  index: number
  asset: unknown | null
  failureMessage: string | null
  isRunning: boolean
  currentLabel: string
  currentItemIndex: number
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
        statusText: input.runtimeState.message || '去水印处理中'
      }
    }

    if (input.runtimeState.status === 'generating') {
      return {
        status: 'loading',
        statusText: input.runtimeState.message || '结果生成中'
      }
    }

    return {
      status: 'loading',
      statusText: input.runtimeState.message || '排队中'
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
