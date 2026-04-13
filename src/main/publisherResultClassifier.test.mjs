import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveQueuePublishOutcome } from './publisherResultClassifier.ts'

test('resolveQueuePublishOutcome returns published when success includes published time', () => {
  assert.deepEqual(
    resolveQueuePublishOutcome({
      success: true,
      time: '2026-04-13T10:00:00.000Z'
    }),
    {
      kind: 'published',
      time: '2026-04-13T10:00:00.000Z'
    }
  )
})

test('resolveQueuePublishOutcome returns draft_saved when Electron flow closes after auto-save', () => {
  assert.deepEqual(
    resolveQueuePublishOutcome({
      success: true,
      savedAsDraft: true
    }),
    {
      kind: 'draft_saved'
    }
  )
})

test('resolveQueuePublishOutcome flags invalid success without publish time or draft signal', () => {
  assert.deepEqual(
    resolveQueuePublishOutcome({
      success: true
    }),
    {
      kind: 'invalid_success'
    }
  )
})

test('resolveQueuePublishOutcome returns failed when publisher returns an error', () => {
  assert.deepEqual(
    resolveQueuePublishOutcome({
      success: false,
      error: '发布失败'
    }),
    {
      kind: 'failed',
      error: '发布失败'
    }
  )
})
