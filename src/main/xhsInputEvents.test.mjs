import assert from 'node:assert/strict'
import test from 'node:test'

import { buildXhsSendKeyEvents } from './xhsInputEvents.ts'

test('buildXhsSendKeyEvents returns the Enter key sequence used by the preload bridge', () => {
  assert.deepEqual(buildXhsSendKeyEvents('Enter'), [
    { type: 'keyDown', keyCode: 'Enter' },
    { type: 'char', keyCode: '\r' },
    { type: 'keyUp', keyCode: 'Enter' }
  ])
})

test('buildXhsSendKeyEvents returns the Space key sequence for topic confirmation', () => {
  assert.deepEqual(buildXhsSendKeyEvents('Space'), [
    { type: 'keyDown', keyCode: 'Space' },
    { type: 'char', keyCode: ' ' },
    { type: 'keyUp', keyCode: 'Space' }
  ])
})

test('buildXhsSendKeyEvents ignores unsupported keys', () => {
  assert.deepEqual(buildXhsSendKeyEvents('Tab'), [])
})
