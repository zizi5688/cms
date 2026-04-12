export type SmartGenerationPhase = 'connecting' | 'generating' | 'parsing' | null

const SMART_GENERATION_PHASE_LABELS: Record<Exclude<SmartGenerationPhase, null>, string> = {
  connecting: '连接中...',
  generating: '生成中...',
  parsing: '解析中...'
}

export function getSmartGenerationPhaseLabel(phase: SmartGenerationPhase): string {
  if (!phase) return ''
  return SMART_GENERATION_PHASE_LABELS[phase]
}

export function formatSmartGenerationElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0))
  return `已等待 ${safeSeconds} 秒`
}

export function resolveSmartGenerationFriendlyErrorMessage(errorMessage: string | null | undefined): string {
  const normalized = String(errorMessage ?? '').trim()
  if (!normalized) return ''

  if (/\b(timed out|timeout)\b/i.test(normalized)) {
    return '生成超时，请稍后重试'
  }

  if (/PROVIDER_DEFAULT_MISSING/i.test(normalized)) {
    return '未配置默认供应商，请到设置中选择'
  }

  if (/\b(network|fetch failed)\b/i.test(normalized)) {
    return '网络连接失败，请检查网关状态'
  }

  return '生成失败，请重试'
}
