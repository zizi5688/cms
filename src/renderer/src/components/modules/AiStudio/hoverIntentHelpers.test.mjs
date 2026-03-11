import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldDelayPreviewSwitch } from './hoverIntentHelpers.ts'

test('should delay submenu switching while pointer is moving into the current submenu corridor', () => {
  assert.equal(
    shouldDelayPreviewSwitch({
      previousPoint: { x: 240, y: 120 },
      currentPoint: { x: 310, y: 135 },
      submenuRect: { left: 420, top: 80, right: 668, bottom: 320 }
    }),
    true
  )
})

test('should not delay when pointer moves away from submenu', () => {
  assert.equal(
    shouldDelayPreviewSwitch({
      previousPoint: { x: 240, y: 120 },
      currentPoint: { x: 200, y: 130 },
      submenuRect: { left: 420, top: 80, right: 668, bottom: 320 }
    }),
    false
  )
})

test('should not delay when pointer path falls outside the submenu triangle', () => {
  assert.equal(
    shouldDelayPreviewSwitch({
      previousPoint: { x: 240, y: 120 },
      currentPoint: { x: 330, y: 360 },
      submenuRect: { left: 420, top: 80, right: 668, bottom: 320 }
    }),
    false
  )
})
