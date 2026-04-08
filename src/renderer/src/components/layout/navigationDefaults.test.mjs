import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_ACTIVE_MODULE } from './navigationDefaults.ts'

test('default active module is aiStudio', () => {
  assert.equal(DEFAULT_ACTIVE_MODULE, 'aiStudio')
})
