import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveVideoCoverPreview } from './videoCoverPreviewHelpers.ts'

test('resolveVideoCoverPreview prefers the current manual cover when it exists', () => {
  assert.deepEqual(
    resolveVideoCoverPreview({
      manualCoverPath: ' /tmp/manual-cover.png ',
      fallbackCoverPath: '/tmp/first-frame.jpg'
    }),
    {
      path: '/tmp/manual-cover.png',
      source: 'manual'
    }
  )
})

test('resolveVideoCoverPreview falls back to the first frame when no manual cover exists', () => {
  assert.deepEqual(
    resolveVideoCoverPreview({
      manualCoverPath: '  ',
      fallbackCoverPath: ' /tmp/first-frame.jpg '
    }),
    {
      path: '/tmp/first-frame.jpg',
      source: 'first-frame'
    }
  )
})

test('resolveVideoCoverPreview returns an empty preview when neither path is available', () => {
  assert.deepEqual(
    resolveVideoCoverPreview({
      manualCoverPath: '',
      fallbackCoverPath: ''
    }),
    {
      path: '',
      source: 'none'
    }
  )
})
