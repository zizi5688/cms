import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_LIGHTBOX_MAX_ZOOM,
  IMAGE_LIGHTBOX_MIN_ZOOM,
  resolveImageLightboxStartIndex,
  shouldCloseImageLightboxFromBackdropClick,
  stepImageLightboxIndex,
  stepImageLightboxZoom
} from './imageLightboxHelpers.ts'

test('resolveImageLightboxStartIndex opens the clicked asset inside the current batch gallery', () => {
  assert.equal(resolveImageLightboxStartIndex(['asset-1', 'asset-2', 'asset-3'], 'asset-2'), 1)
  assert.equal(resolveImageLightboxStartIndex(['asset-1', 'asset-2', 'asset-3'], 'missing'), 0)
  assert.equal(resolveImageLightboxStartIndex([], 'asset-1'), 0)
})

test('stepImageLightboxIndex moves left and right while clamping at the gallery edges', () => {
  assert.equal(stepImageLightboxIndex(0, 4, 'previous'), 0)
  assert.equal(stepImageLightboxIndex(1, 4, 'next'), 2)
  assert.equal(stepImageLightboxIndex(3, 4, 'next'), 3)
  assert.equal(stepImageLightboxIndex(2, 4, 'previous'), 1)
})

test('stepImageLightboxZoom changes in fixed increments and respects min/max bounds', () => {
  assert.equal(stepImageLightboxZoom(IMAGE_LIGHTBOX_MIN_ZOOM, 'out'), IMAGE_LIGHTBOX_MIN_ZOOM)
  assert.equal(stepImageLightboxZoom(1, 'in'), 1.25)
  assert.equal(stepImageLightboxZoom(1.25, 'out'), 1)
  assert.equal(stepImageLightboxZoom(IMAGE_LIGHTBOX_MAX_ZOOM, 'in'), IMAGE_LIGHTBOX_MAX_ZOOM)
})

test('shouldCloseImageLightboxFromBackdropClick closes only when the backdrop itself is clicked', () => {
  const backdrop = { id: 'backdrop' }
  const content = { id: 'content' }

  assert.equal(
    shouldCloseImageLightboxFromBackdropClick({
      target: backdrop,
      currentTarget: backdrop
    }),
    true
  )

  assert.equal(
    shouldCloseImageLightboxFromBackdropClick({
      target: content,
      currentTarget: backdrop
    }),
    false
  )
})
