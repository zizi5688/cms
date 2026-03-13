import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAllowedVideoDurations,
  isFixedEightSecondVideoModel,
  normalizeVideoDurationForModel
} from './aiVideoProfiles.ts'

test('veo3 family models are treated as fixed 8-second outputs', () => {
  assert.equal(isFixedEightSecondVideoModel('veo3.1-fast-components'), true)
  assert.equal(isFixedEightSecondVideoModel('veo-3-fast'), true)
  assert.deepEqual(getAllowedVideoDurations('veo3.1-components'), [8])
})

test('non-veo models keep both 5-second and 8-second duration options', () => {
  assert.equal(isFixedEightSecondVideoModel('jimeng-video-3.0'), false)
  assert.deepEqual(getAllowedVideoDurations('jimeng-video-3.0'), [5, 8])
})

test('normalizeVideoDurationForModel clamps unsupported veo durations to 8 seconds', () => {
  assert.equal(normalizeVideoDurationForModel(5, 'veo3.1-fast-components', 5), 8)
  assert.equal(normalizeVideoDurationForModel(8, 'veo3.1-fast-components', 5), 8)
  assert.equal(normalizeVideoDurationForModel(5, 'jimeng-video-3.0', 8), 5)
})
