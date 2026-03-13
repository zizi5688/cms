import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewTileSurfaceClassNames } from './previewTileSurfaceHelpers.ts'

test('image preview tiles keep the border while giving loading placeholders a solid base surface', () => {
  const loading = resolvePreviewTileSurfaceClassNames('image', 'loading')
  const failed = resolvePreviewTileSurfaceClassNames('image', 'failed')
  const idle = resolvePreviewTileSurfaceClassNames('image', 'idle')

  assert.match(loading.shellClassName, /\bborder\b/)
  assert.match(loading.shellClassName, /\bborder-zinc-200\b/)
  assert.doesNotMatch(loading.shellClassName, /shadow-\[/)
  assert.match(loading.loadingInnerClassName, /\bbg-zinc-100\b/)
  assert.match(idle.idleBodyClassName, /\bbg-zinc-100\b/)
  assert.match(failed.failedBodyClassName, /\bbg-transparent\b/)
})

test('video preview tiles reuse the solid loading base while preserving transparent failure backgrounds', () => {
  const ready = resolvePreviewTileSurfaceClassNames('video', 'ready')
  const loading = resolvePreviewTileSurfaceClassNames('video', 'loading')
  const failed = resolvePreviewTileSurfaceClassNames('video', 'failed')
  const idle = resolvePreviewTileSurfaceClassNames('video', 'idle')

  assert.match(ready.shellClassName, /\bborder\b/)
  assert.match(ready.shellClassName, /\bborder-zinc-200\b/)
  assert.match(ready.shellClassName, /\bbg-transparent\b/)
  assert.doesNotMatch(ready.shellClassName, /shadow-\[/)
  assert.match(loading.loadingInnerClassName, /\bbg-zinc-100\b/)
  assert.match(failed.failedBodyClassName, /\bbg-transparent\b/)
  assert.match(idle.idleBodyClassName, /\bbg-zinc-100\b/)
})
