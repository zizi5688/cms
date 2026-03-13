import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLoadedImageBadgeLabel } from './imagePreviewBadgeHelpers.ts'

test('resolveLoadedImageBadgeLabel returns a 2K badge for 1792x2400 images', () => {
  assert.equal(resolveLoadedImageBadgeLabel({ width: 1792, height: 2400 }), '2K')
})

test('resolveLoadedImageBadgeLabel returns empty text for invalid dimensions', () => {
  assert.equal(resolveLoadedImageBadgeLabel({ width: 0, height: 2400 }), '')
  assert.equal(resolveLoadedImageBadgeLabel({ width: Number.NaN, height: 2400 }), '')
  assert.equal(resolveLoadedImageBadgeLabel(null), '')
})
