import assert from 'node:assert/strict'
import test from 'node:test'

import {
  shouldSyncAiStudioImageImport,
  buildAiStudioImageImportKey
} from './workshopImportSyncHelpers.ts'

test('shouldSyncAiStudioImageImport rehydrates images when the same AI import arrives after local files were cleared', () => {
  const importedImagePaths = ['/tmp/look-a.jpg', '/tmp/look-b.jpg', '/tmp/look-c.jpg']
  const importKey = buildAiStudioImageImportKey(importedImagePaths)

  assert.equal(
    shouldSyncAiStudioImageImport({
      importedImagePaths,
      currentImageFiles: [],
      previousImportKey: importKey
    }),
    true
  )
})

test('shouldSyncAiStudioImageImport skips no-op syncs when the same AI import is already loaded', () => {
  const importedImagePaths = ['/tmp/look-a.jpg', '/tmp/look-b.jpg', '/tmp/look-c.jpg']
  const importKey = buildAiStudioImageImportKey(importedImagePaths)

  assert.equal(
    shouldSyncAiStudioImageImport({
      importedImagePaths,
      currentImageFiles: importedImagePaths,
      previousImportKey: importKey
    }),
    false
  )
})

test('shouldSyncAiStudioImageImport syncs when a different AI import arrives', () => {
  assert.equal(
    shouldSyncAiStudioImageImport({
      importedImagePaths: ['/tmp/look-d.jpg'],
      currentImageFiles: ['/tmp/look-a.jpg', '/tmp/look-b.jpg', '/tmp/look-c.jpg'],
      previousImportKey: buildAiStudioImageImportKey([
        '/tmp/look-a.jpg',
        '/tmp/look-b.jpg',
        '/tmp/look-c.jpg'
      ])
    }),
    true
  )
})
