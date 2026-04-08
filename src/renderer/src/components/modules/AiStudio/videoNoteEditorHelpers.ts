import type { VideoNoteGenerationState } from './videoNoteGenerationOrchestrator.ts'

export type VideoNoteEntryMode = 'smart' | 'manual'

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
} {
  if (entryMode === 'manual') {
    return {
      textareaPlaceholder: '输入 CSV 格式文案',
      generateButtonLabel: isGenerating ? '生成中' : '开始生成',
      entryToggleLabel: '智能生成',
      statusText: ''
    }
  }

  let statusText = ''
  if (generationState.mergeStatus === 'waiting-copy') {
    statusText = '视频已完成，等待文案返回'
  } else if (generationState.mergeStatus === 'waiting-video') {
    statusText = '文案已完成，等待视频生成'
  } else if (generationState.mergeStatus === 'partial-failed') {
    statusText =
      generationState.copyStatus === 'error'
        ? '文案生成失败，可改为手动录入或重试智能生成'
        : '视频生成失败，可直接重试视频生成'
  }

  return {
    textareaPlaceholder: '输入商品信息和额外说明提示词',
    generateButtonLabel: isGenerating ? '生成中' : '智能生成',
    entryToggleLabel: '手动录入',
    statusText
  }
}
