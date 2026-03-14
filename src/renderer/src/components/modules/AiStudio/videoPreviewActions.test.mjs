import assert from 'node:assert/strict'
import test from 'node:test'

import {
  claimVideoRetrySlot,
  releaseVideoRetrySlot,
  shouldShowVideoRegenerateAction
} from './videoPreviewActions.ts'

test('video preview slots expose regenerate for ready and failed states only', () => {
  assert.equal(shouldShowVideoRegenerateAction({ status: 'ready', hasAsset: true }), true)
  assert.equal(shouldShowVideoRegenerateAction({ status: 'failed', hasAsset: false }), true)
  assert.equal(shouldShowVideoRegenerateAction({ status: 'loading', hasAsset: false }), false)
  assert.equal(shouldShowVideoRegenerateAction({ status: 'idle', hasAsset: false }), false)
})

test('video slot retry lock allows only one in-flight retry per slot', () => {
  const inflight = new Set()

  assert.equal(claimVideoRetrySlot(inflight, 'task-1', 2), true)
  assert.equal(claimVideoRetrySlot(inflight, 'task-1', 2), false)

  releaseVideoRetrySlot(inflight, 'task-1', 2)

  assert.equal(claimVideoRetrySlot(inflight, 'task-1', 2), true)
})
