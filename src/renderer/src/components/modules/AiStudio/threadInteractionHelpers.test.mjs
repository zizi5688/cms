import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPastedImageFilename,
  extractPastedImageCandidates,
  resolveThreadSourceFolderPath
} from './threadInteractionHelpers.ts'

test('resolveThreadSourceFolderPath returns the parent of the run folder when an output file exists', () => {
  assert.equal(
    resolveThreadSourceFolderPath({
      latestOutputFilePath: '/Users/z/workspace/ai-studio/task-001/run-001/result-1.png',
      sourceFolderPath: '/Users/z/source-assets'
    }),
    '/Users/z/workspace/ai-studio/task-001'
  )
})

test('resolveThreadSourceFolderPath falls back to sourceFolderPath when no output file exists', () => {
  assert.equal(
    resolveThreadSourceFolderPath({
      latestOutputFilePath: '',
      sourceFolderPath: '/Users/z/source-assets'
    }),
    '/Users/z/source-assets'
  )
})

test('buildPastedImageFilename derives an extension from mime type when the clipboard item has no name', () => {
  assert.equal(
    buildPastedImageFilename({
      originalName: '',
      mimeType: 'image/webp',
      nowMs: 1710000000000,
      index: 2
    }),
    'ai-studio-paste-1710000000000-2.webp'
  )
})

test('extractPastedImageCandidates prefers local file paths and ignores non-image clipboard files', () => {
  const imageFile = { type: 'image/png', name: 'paste.png' }
  const textFile = { type: 'text/plain', name: 'note.txt' }

  assert.deepEqual(
    extractPastedImageCandidates({
      clipboardFiles: [imageFile, textFile],
      clipboardItems: [],
      getPathForFile: (file) => (file === imageFile ? '/tmp/paste.png' : ''),
      nowMs: 1710000000000
    }),
    {
      filePaths: ['/tmp/paste.png'],
      blobFiles: []
    }
  )
})

test('extractPastedImageCandidates returns blob entries when clipboard images have no local path', () => {
  const clipboardImage = { type: 'image/png', name: '' }
  const result = extractPastedImageCandidates({
    clipboardFiles: [clipboardImage],
    clipboardItems: [],
    getPathForFile: () => '',
    nowMs: 1710000000000
  })

  assert.deepEqual(result.filePaths, [])
  assert.equal(result.blobFiles.length, 1)
  assert.equal(result.blobFiles[0]?.file, clipboardImage)
  assert.equal(result.blobFiles[0]?.filename, 'ai-studio-paste-1710000000000-1.png')
})

test('extractPastedImageCandidates gives clipboard blob files a unique filename even when the source name is fixed', () => {
  const clipboardImage = { type: 'image/jpeg', name: 'Screenshot.jpeg' }
  const result = extractPastedImageCandidates({
    clipboardFiles: [],
    clipboardItems: [
      {
        type: 'image/jpeg',
        getAsFile: () => clipboardImage
      }
    ],
    getPathForFile: () => '',
    nowMs: 1710000000000
  })

  assert.deepEqual(result.filePaths, [])
  assert.equal(result.blobFiles.length, 1)
  assert.equal(result.blobFiles[0]?.filename, 'Screenshot-1710000000000-1.jpeg')
})
