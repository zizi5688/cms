import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveQuickInsertPanelPosition } from './quickInsertPopoverPositionHelpers.ts'

test('positions the first-level quick-insert panel from the trigger button right edge when there is enough room', () => {
  assert.deepEqual(
    resolveQuickInsertPanelPosition({
      triggerRect: { left: 120, top: 420, right: 196, bottom: 448 },
      panelWidth: 252,
      viewportWidth: 1280,
      viewportPadding: 12
    }),
    {
      left: 196,
      top: 448,
      width: 252,
      transform: 'translateY(-100%)'
    }
  )
})

test('clamps the first-level quick-insert panel inside the viewport when the preferred right-edge anchor would overflow', () => {
  assert.deepEqual(
    resolveQuickInsertPanelPosition({
      triggerRect: { left: 1010, top: 420, right: 1088, bottom: 448 },
      panelWidth: 252,
      viewportWidth: 1280,
      viewportPadding: 12
    }),
    {
      left: 1016,
      top: 448,
      width: 252,
      transform: 'translateY(-100%)'
    }
  )
})
