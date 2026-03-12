import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveQuickInsertButtonLabel,
  resolveQuickInsertClickOutcome
} from './quickInsertActionHelpers.ts'

test('first click on a different quick-insert item arms it instead of executing immediately', () => {
  assert.equal(
    resolveQuickInsertClickOutcome({
      armedPreviewKey: 'template:split',
      clickedPreviewKey: 'template:portrait'
    }),
    'select'
  )
})

test('first click still arms when the item is only being previewed and has not been armed yet', () => {
  assert.equal(
    resolveQuickInsertClickOutcome({
      armedPreviewKey: null,
      clickedPreviewKey: 'template:split'
    }),
    'select'
  )
})

test('second click on the already armed quick-insert item executes the action', () => {
  assert.equal(
    resolveQuickInsertClickOutcome({
      armedPreviewKey: 'template:split',
      clickedPreviewKey: 'template:split'
    }),
    'execute'
  )
})

test('armed template buttons switch their text to insert', () => {
  assert.equal(
    resolveQuickInsertButtonLabel({
      armedPreviewKey: 'template:split',
      itemPreviewKey: 'template:split',
      defaultLabel: '子图裂变',
      armedLabel: '插入'
    }),
    '插入'
  )
})

test('non-armed quick-insert buttons keep their original text', () => {
  assert.equal(
    resolveQuickInsertButtonLabel({
      armedPreviewKey: 'template:split',
      itemPreviewKey: 'template:portrait',
      defaultLabel: '人物仿图',
      armedLabel: '插入'
    }),
    '人物仿图'
  )
})
