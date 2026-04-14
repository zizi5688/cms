import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BATCH_PICK_TILE_EMPTY_STATE_CLASS,
  BATCH_PICK_TILE_MEDIA_CLASS,
  BATCH_PICK_TILE_USED_BADGE_CLASS,
  resolveBatchPickTileOverlayClass,
  resolveBatchPickTileSelectionIndicatorClass
} from './batchPickTileClassHelpers.ts'

function expectPointerEventsNone(value) {
  assert.match(value, /\bpointer-events-none\b/)
}

test('batch pick tile child layers disable pointer events so the draggable tile remains the drag initiator', () => {
  expectPointerEventsNone(BATCH_PICK_TILE_MEDIA_CLASS)
  expectPointerEventsNone(BATCH_PICK_TILE_EMPTY_STATE_CLASS)
  expectPointerEventsNone(resolveBatchPickTileOverlayClass({ isSelected: true, isUsed: false }))
  expectPointerEventsNone(resolveBatchPickTileOverlayClass({ isSelected: false, isUsed: true }))
  expectPointerEventsNone(resolveBatchPickTileSelectionIndicatorClass(true))
  expectPointerEventsNone(BATCH_PICK_TILE_USED_BADGE_CLASS)
})

test('batch pick tile overlay helpers keep the selected and used visual states', () => {
  assert.match(
    resolveBatchPickTileOverlayClass({ isSelected: true, isUsed: false }),
    /ring-\[2\.5px\].*ring-sky-400\/90/
  )
  assert.match(
    resolveBatchPickTileOverlayClass({ isSelected: false, isUsed: true }),
    /from-black\/54 via-black\/6/
  )
  assert.match(resolveBatchPickTileSelectionIndicatorClass(false), /group-hover:text-white\/80/)
})
