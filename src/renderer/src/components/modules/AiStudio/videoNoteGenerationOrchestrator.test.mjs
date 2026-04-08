import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyVideoNoteGenerationUpdate,
  createInitialVideoNoteGenerationState
} from './videoNoteGenerationOrchestrator.ts'

test('video note orchestration waits for videos when CSV finishes first', () => {
  const started = applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
    type: 'start'
  })

  const result = applyVideoNoteGenerationUpdate(started, {
    type: 'copy-success',
    csvText: '标题,正文\n视频笔记 A,"正文 A"'
  })

  assert.equal(result.copyStatus, 'success')
  assert.equal(result.renderStatus, 'running')
  assert.equal(result.mergeStatus, 'waiting-video')
  assert.equal(result.csvText, '标题,正文\n视频笔记 A,"正文 A"')
  assert.deepEqual(result.previewAssets, [])
  assert.equal(result.isReadyForPreview, false)
})

test('video note orchestration waits for CSV when videos finish first', () => {
  const started = applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
    type: 'start'
  })

  const result = applyVideoNoteGenerationUpdate(started, {
    type: 'render-success',
    assets: [
      {
        videoPath: '/tmp/video-a.mp4',
        coverImagePath: '/tmp/video-a-cover.jpg'
      }
    ]
  })

  assert.equal(result.copyStatus, 'running')
  assert.equal(result.renderStatus, 'success')
  assert.equal(result.mergeStatus, 'waiting-copy')
  assert.equal(result.csvText, '')
  assert.deepEqual(result.previewAssets, [
    {
      videoPath: '/tmp/video-a.mp4',
      coverImagePath: '/tmp/video-a-cover.jpg'
    }
  ])
  assert.equal(result.isReadyForPreview, false)
})

test('video note orchestration becomes ready when CSV and videos both succeed', () => {
  const afterCopy = applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
    type: 'copy-success',
    csvText: '标题,正文\n视频笔记 A,"正文 A"'
  })

  const result = applyVideoNoteGenerationUpdate(afterCopy, {
    type: 'render-success',
    assets: [
      {
        videoPath: '/tmp/video-a.mp4',
        previewPath: '/tmp/video-a-preview.mp4',
        coverImagePath: '/tmp/video-a-cover.jpg'
      }
    ]
  })

  assert.equal(result.copyStatus, 'success')
  assert.equal(result.renderStatus, 'success')
  assert.equal(result.mergeStatus, 'ready-preview')
  assert.equal(result.isReadyForPreview, true)
})

test('video note orchestration preserves rendered videos when copy generation fails', () => {
  const afterRender = applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
    type: 'render-success',
    assets: [
      {
        videoPath: '/tmp/video-a.mp4'
      }
    ]
  })

  const result = applyVideoNoteGenerationUpdate(afterRender, {
    type: 'copy-error',
    message: 'gateway timeout'
  })

  assert.equal(result.copyStatus, 'error')
  assert.equal(result.renderStatus, 'success')
  assert.equal(result.mergeStatus, 'partial-failed')
  assert.equal(result.copyError, 'gateway timeout')
  assert.deepEqual(result.previewAssets, [
    {
      videoPath: '/tmp/video-a.mp4'
    }
  ])
})

test('video note orchestration preserves CSV when video rendering fails', () => {
  const afterCopy = applyVideoNoteGenerationUpdate(createInitialVideoNoteGenerationState(), {
    type: 'copy-success',
    csvText: '标题,正文\n视频笔记 A,"正文 A"'
  })

  const result = applyVideoNoteGenerationUpdate(afterCopy, {
    type: 'render-error',
    message: 'ffmpeg failed'
  })

  assert.equal(result.copyStatus, 'success')
  assert.equal(result.renderStatus, 'error')
  assert.equal(result.mergeStatus, 'partial-failed')
  assert.equal(result.renderError, 'ffmpeg failed')
  assert.equal(result.csvText, '标题,正文\n视频笔记 A,"正文 A"')
})
