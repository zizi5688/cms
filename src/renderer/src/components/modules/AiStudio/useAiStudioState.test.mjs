import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_AI_STUDIO_CHILD_OUTPUT_COUNT,
  DEFAULT_AI_STUDIO_MASTER_OUTPUT_COUNT
} from './workflowDefaults.ts'

test('workflow defaults keep the image master output count at one', () => {
  assert.equal(DEFAULT_AI_STUDIO_MASTER_OUTPUT_COUNT, 1)
  assert.equal(DEFAULT_AI_STUDIO_CHILD_OUTPUT_COUNT, 4)
})
