import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldShowDispatchPanel } from './dispatchPanelVisibilityHelpers.ts'

test('shouldShowDispatchPanel hides the dispatch board while the manual cover editor is open', () => {
  assert.equal(
    shouldShowDispatchPanel({
      selectedDispatchCount: 1,
      isManualCoverEditorOpen: true
    }),
    false
  )
})

test('shouldShowDispatchPanel shows the dispatch board when tasks are selected and no modal is open', () => {
  assert.equal(
    shouldShowDispatchPanel({
      selectedDispatchCount: 2,
      isManualCoverEditorOpen: false
    }),
    true
  )
})

test('shouldShowDispatchPanel stays hidden when nothing is selected', () => {
  assert.equal(
    shouldShowDispatchPanel({
      selectedDispatchCount: 0,
      isManualCoverEditorOpen: false
    }),
    false
  )
})
