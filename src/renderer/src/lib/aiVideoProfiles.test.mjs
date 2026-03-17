import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAllowedVideoAspectRatios,
  getAllowedVideoDurations,
  isFixedEightSecondVideoModel,
  normalizeVideoAspectRatioForModel,
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

test('seedance models expose 4-second duration and adaptive ratio defaults', () => {
  assert.deepEqual(getAllowedVideoDurations('seedance-1-5-pro'), [4])
  assert.deepEqual(getAllowedVideoAspectRatios('seedance-1-5-pro'), ['adaptive', '16:9', '9:16', '1:1'])
  assert.equal(normalizeVideoDurationForModel(5, 'seedance-1-5-pro', 5), 4)
  assert.equal(normalizeVideoAspectRatioForModel('9:16', 'seedance-1-5-pro', 'adaptive'), '9:16')
  assert.equal(normalizeVideoAspectRatioForModel('bad', 'seedance-1-5-pro', '9:16'), '9:16')
})
