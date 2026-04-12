import type { VideoNoteGenerationState } from './videoNoteGenerationOrchestrator.ts'
import type { SmartGenerationPhase } from '../../ui/smartGenerationOverlayHelpers.ts'

export type VideoNoteEntryMode = 'smart' | 'manual'

export function resolveVideoSmartGenerationPhase(payload: {
  generationState: VideoNoteGenerationState
  isGenerating: boolean
}): SmartGenerationPhase {
  const { generationState, isGenerating } = payload
  if (!isGenerating) return null
  if (
    generationState.copyLifecyclePhase === 'connecting' ||
    generationState.copyLifecyclePhase === 'parsing'
  ) {
    return generationState.copyLifecyclePhase
  }
  if (
    generationState.mergeStatus === 'running-both' ||
    generationState.mergeStatus === 'waiting-copy' ||
    generationState.mergeStatus === 'waiting-video'
  ) {
    return 'generating'
  }
  return null
}

export function buildVideoNoteEditorViewModel({
  entryMode,
  generationState,
  isGenerating
}: {
  entryMode: VideoNoteEntryMode
  generationState: VideoNoteGenerationState
  isGenerating: boolean
}): {
  textareaPlaceholder: string
  generateButtonLabel: string
  entryToggleLabel: string
  statusText: string
  overlayPhase: SmartGenerationPhase
} {
  if (entryMode === 'manual') {
    return {
      textareaPlaceholder: '输入 CSV 格式文案',
      generateButtonLabel: isGenerating ? '生成中' : '开始生成',
      entryToggleLabel: '智能生成',
      statusText: '',
      overlayPhase: null
    }
  }

  let statusText = ''
  if (generationState.mergeStatus === 'waiting-copy') {
    statusText =
      generationState.copyAttemptCount > 1
        ? '主文案失败，已切换备用供应商，等待文案返回'
        : '视频已完成，等待文案返回'
  } else if (generationState.mergeStatus === 'waiting-video') {
    statusText = '文案已完成，等待视频生成'
  } else if (generationState.mergeStatus === 'partial-failed') {
    statusText =
      generationState.copyStatus === 'error'
        ? generationState.canRetryCopyOnly
          ? '文案生成失败，但视频已保留，可重试文案生成'
          : '文案生成失败，可改为手动录入或重试智能生成'
        : '视频生成失败，可直接重试视频生成'
  }

  return {
    textareaPlaceholder: '输入商品信息和额外说明提示词',
    generateButtonLabel: generationState.canRetryCopyOnly ? '重试文案' : '智能生成',
    entryToggleLabel: '手动录入',
    statusText,
    overlayPhase: resolveVideoSmartGenerationPhase({
      generationState,
      isGenerating
    })
  }
}
