import assert from 'node:assert/strict'
import test from 'node:test'

import { createInitialVideoNoteGenerationState } from './videoNoteGenerationOrchestrator.ts'
import { buildVideoNoteEditorViewModel } from './videoNoteEditorHelpers.ts'

test('video note editor view model switches labels for manual entry mode', () => {
  const result = buildVideoNoteEditorViewModel({
    entryMode: 'manual',
    generationState: createInitialVideoNoteGenerationState(),
    isGenerating: false
  })

  assert.equal(result.textareaPlaceholder, '输入 CSV 格式文案')
  assert.equal(result.generateButtonLabel, '开始生成')
  assert.equal(result.entryToggleLabel, '智能生成')
  assert.equal(result.statusText, '')
})

test('video note editor view model switches labels for smart entry mode', () => {
  const result = buildVideoNoteEditorViewModel({
    entryMode: 'smart',
    generationState: createInitialVideoNoteGenerationState(),
    isGenerating: false
  })

  assert.equal(result.textareaPlaceholder, '输入商品信息和额外说明提示词')
  assert.equal(result.generateButtonLabel, '智能生成')
  assert.equal(result.entryToggleLabel, '手动录入')
})

test('video note editor view model explains waiting states and partial failures', () => {
  const waitingCopy = buildVideoNoteEditorViewModel({
    entryMode: 'smart',
    generationState: {
      ...createInitialVideoNoteGenerationState(),
      copyStatus: 'running',
      renderStatus: 'success',
      mergeStatus: 'waiting-copy'
    },
    isGenerating: true
  })
  assert.equal(waitingCopy.statusText, '视频已完成，等待文案返回')

  const waitingVideo = buildVideoNoteEditorViewModel({
    entryMode: 'smart',
    generationState: {
      ...createInitialVideoNoteGenerationState(),
      copyStatus: 'success',
      renderStatus: 'running',
      mergeStatus: 'waiting-video'
    },
    isGenerating: true
  })
  assert.equal(waitingVideo.statusText, '文案已完成，等待视频生成')

  const partialFailed = buildVideoNoteEditorViewModel({
    entryMode: 'smart',
    generationState: {
      ...createInitialVideoNoteGenerationState(),
      copyStatus: 'error',
      renderStatus: 'success',
      copyError: 'gateway timeout',
      mergeStatus: 'partial-failed'
    },
    isGenerating: false
  })
  assert.equal(partialFailed.statusText, '文案生成失败，可改为手动录入或重试智能生成')
})

test('video note editor view model explains copy-only recovery when videos are preserved', () => {
  const recovery = buildVideoNoteEditorViewModel({
    entryMode: 'smart',
    generationState: {
      ...createInitialVideoNoteGenerationState(),
      copyStatus: 'error',
      renderStatus: 'success',
      previewAssets: [
        {
          videoPath: '/tmp/video-a.mp4'
        }
      ],
      canRetryCopyOnly: true,
      mergeStatus: 'partial-failed'
    },
    isGenerating: false
  })

  assert.equal(recovery.statusText, '文案生成失败，但视频已保留，可重试文案生成')
  assert.equal(recovery.generateButtonLabel, '重试文案')
})

test('video note editor view model explains fallback-in-progress messaging', () => {
  const fallbackWaiting = buildVideoNoteEditorViewModel({
    entryMode: 'smart',
    generationState: {
      ...createInitialVideoNoteGenerationState(),
      copyStatus: 'running',
      renderStatus: 'success',
      copyAttemptProviderName: 'gemini',
      copyFallbackProviderName: 'gemini',
      copyAttemptCount: 2,
      mergeStatus: 'waiting-copy'
    },
    isGenerating: true
  })

  assert.equal(fallbackWaiting.statusText, '主文案失败，已切换备用供应商，等待文案返回')
})
