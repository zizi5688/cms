import assert from 'node:assert/strict'
import test from 'node:test'

import { formatResolutionBadgeLabel } from './resolutionLabelHelpers.ts'

test('formatResolutionBadgeLabel returns 1K badge for 896x1200 images', () => {
  assert.equal(formatResolutionBadgeLabel(896, 1200), '1K')
})

test('formatResolutionBadgeLabel returns 2K badge for 1792x2400 images', () => {
  assert.equal(formatResolutionBadgeLabel(1792, 2400), '2K')
})

test('formatResolutionBadgeLabel returns empty text for invalid dimensions', () => {
  assert.equal(formatResolutionBadgeLabel(0, 2400), '')
  assert.equal(formatResolutionBadgeLabel(Number.NaN, 2400), '')
})
