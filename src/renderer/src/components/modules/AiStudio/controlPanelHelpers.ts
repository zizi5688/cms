export function resolvePrimaryGenerateButtonState(input: {
  isVideoStudio: boolean
  isRunning: boolean
  isInterrupting: boolean
}): {
  actionLabel: string
  intent: 'generate' | 'interrupt'
  disabled: boolean
} {
  if (input.isVideoStudio && input.isRunning) {
    return {
      actionLabel: input.isInterrupting ? '中断中...' : '中断任务',
      intent: 'interrupt',
      disabled: input.isInterrupting
    }
  }

  return {
    actionLabel: '开始生成',
    intent: 'generate',
    disabled: false
  }
}
