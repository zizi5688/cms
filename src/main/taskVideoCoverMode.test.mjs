import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeVideoCoverModeForDb } from './taskVideoCoverMode.ts'

test('normalizeVideoCoverModeForDb defaults missing values to auto for legacy compatibility', () => {
  assert.equal(normalizeVideoCoverModeForDb(undefined), 'auto')
  assert.equal(normalizeVideoCoverModeForDb(null), 'auto')
  assert.equal(normalizeVideoCoverModeForDb(''), 'auto')
})

test('normalizeVideoCoverModeForDb preserves explicit auto mode', () => {
  assert.equal(normalizeVideoCoverModeForDb('auto'), 'auto')
  assert.equal(normalizeVideoCoverModeForDb('manual'), 'manual')
})
