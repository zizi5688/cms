import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveInitialVideoPreviewPath,
  resolvePreparedVideoPreviewPath,
  shouldFallbackToOriginalVideo
} from './videoPreviewSourceHelpers.ts'

test('resolveInitialVideoPreviewPath prefers an existing preview file before the original video file', () => {
  assert.equal(
    resolveInitialVideoPreviewPath('/tmp/source.mp4', '/tmp/preview.mp4'),
    '/tmp/preview.mp4'
  )
  assert.equal(resolveInitialVideoPreviewPath('/tmp/source.mp4', ''), '/tmp/source.mp4')
})

test('resolvePreparedVideoPreviewPath falls back to the original video when prepareVideoPreview returns an empty path', () => {
  assert.equal(
    resolvePreparedVideoPreviewPath({ previewPath: '/tmp/prepared.mp4' }, '/tmp/original.mp4'),
    '/tmp/prepared.mp4'
  )
  assert.equal(
    resolvePreparedVideoPreviewPath({ previewPath: null }, '/tmp/original.mp4'),
    '/tmp/original.mp4'
  )
})

test('shouldFallbackToOriginalVideo only retries once and only when a distinct original src exists', () => {
  assert.equal(
    shouldFallbackToOriginalVideo({
      resolvedOriginalVideoSrc: 'safe-file:///tmp/original.mp4',
      playableVideoSrc: 'safe-file:///tmp/prepared.mp4',
      didFallbackToOriginalVideo: false
    }),
    true
  )

  assert.equal(
    shouldFallbackToOriginalVideo({
      resolvedOriginalVideoSrc: 'safe-file:///tmp/original.mp4',
      playableVideoSrc: 'safe-file:///tmp/original.mp4',
      didFallbackToOriginalVideo: false
    }),
    false
  )

  assert.equal(
    shouldFallbackToOriginalVideo({
      resolvedOriginalVideoSrc: 'safe-file:///tmp/original.mp4',
      playableVideoSrc: 'safe-file:///tmp/prepared.mp4',
      didFallbackToOriginalVideo: true
    }),
    false
  )
})
