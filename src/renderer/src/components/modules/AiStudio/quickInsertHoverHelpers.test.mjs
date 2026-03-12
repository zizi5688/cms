import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldKeepCurrentQuickInsertPreview } from './quickInsertHoverHelpers.ts'

test('keeps the current quick-insert preview while the pointer moves into the second-layer submenu corridor', () => {
  assert.equal(
    shouldKeepCurrentQuickInsertPreview({
      currentPreviewKey: 'template:split',
      nextPreviewKey: 'template:portrait',
      previousPoint: { x: 240, y: 120 },
      currentPoint: { x: 310, y: 135 },
      submenuRect: { left: 420, top: 80, right: 668, bottom: 320 }
    }),
    true
  )
})

test('switches the quick-insert preview normally when the pointer is not moving into the submenu corridor', () => {
  assert.equal(
    shouldKeepCurrentQuickInsertPreview({
      currentPreviewKey: 'template:split',
      nextPreviewKey: 'template:portrait',
      previousPoint: { x: 240, y: 120 },
      currentPoint: { x: 330, y: 360 },
      submenuRect: { left: 420, top: 80, right: 668, bottom: 320 }
    }),
    false
  )
})
