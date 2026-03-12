import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewTileSurfaceClassNames } from './previewTileSurfaceHelpers.ts'

test('image preview tiles keep the border while preserving transparent surfaces', () => {
  const loading = resolvePreviewTileSurfaceClassNames('image', 'loading')
  const failed = resolvePreviewTileSurfaceClassNames('image', 'failed')
  const idle = resolvePreviewTileSurfaceClassNames('image', 'idle')

  assert.match(loading.shellClassName, /\bborder\b/)
  assert.match(loading.shellClassName, /\bborder-zinc-200\b/)
  assert.match(loading.shellClassName, /\bbg-transparent\b/)
  assert.doesNotMatch(loading.shellClassName, /shadow-\[/)
  assert.match(loading.loadingInnerClassName, /\bbg-transparent\b/)
  assert.match(failed.failedBodyClassName, /\bbg-transparent\b/)
  assert.match(idle.idleBodyClassName, /\bbg-transparent\b/)
})

test('video preview tiles keep the border while preserving transparent failure backgrounds', () => {
  const ready = resolvePreviewTileSurfaceClassNames('video', 'ready')
  const failed = resolvePreviewTileSurfaceClassNames('video', 'failed')
  const idle = resolvePreviewTileSurfaceClassNames('video', 'idle')

  assert.match(ready.shellClassName, /\bborder\b/)
  assert.match(ready.shellClassName, /\bborder-zinc-200\b/)
  assert.match(ready.shellClassName, /\bbg-transparent\b/)
  assert.doesNotMatch(ready.shellClassName, /shadow-\[/)
  assert.match(failed.failedBodyClassName, /\bbg-transparent\b/)
  assert.match(idle.idleBodyClassName, /\bbg-transparent\b/)
})
