import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSelectableBatchPickAssetIds,
  buildBatchPickAssets,
  pruneBatchPickSelection,
  resolveUsedBatchPickAssetIds
} from './batchPickHelpers.ts'

test('resolveUsedBatchPickAssetIds marks assets that already exist in the note material strip', () => {
  const batchPickAssets = [
    { id: 'asset-a', filePath: '/tmp/a.png', previewPath: null },
    { id: 'asset-b', filePath: '/tmp/b.png', previewPath: null },
    { id: 'asset-c', filePath: '/tmp/c.png', previewPath: null }
  ]

  const noteMaterials = [
    { id: 'note-1', filePath: '/tmp/c.png', previewPath: null },
    { id: 'note-2', filePath: '/tmp/a.png', previewPath: null },
    { id: 'note-3', filePath: '/tmp/a.png', previewPath: null }
  ]

  assert.deepEqual(resolveUsedBatchPickAssetIds(batchPickAssets, noteMaterials), [
    'asset-a',
    'asset-c'
  ])
})

test('pruneBatchPickSelection removes used and unavailable asset ids while preserving order', () => {
  assert.deepEqual(
    pruneBatchPickSelection({
      selectedAssetIds: ['asset-a', 'asset-used', 'asset-b', 'asset-missing'],
      availableAssetIds: ['asset-a', 'asset-b', 'asset-used'],
      usedAssetIds: ['asset-used']
    }),
    ['asset-a', 'asset-b']
  )
})

test('buildSelectableBatchPickAssetIds excludes used assets and preserves the asset order', () => {
  assert.deepEqual(
    buildSelectableBatchPickAssetIds({
      assets: [{ id: 'asset-a' }, { id: 'asset-used' }, { id: 'asset-b' }],
      usedAssetIds: ['asset-used']
    }),
    ['asset-a', 'asset-b']
  )
})

test('buildBatchPickAssets keeps image outputs in display order and de-duplicates by file path', () => {
  const historyTasks = [
    {
      outputAssets: [
        {
          id: 'asset-2',
          filePath: '/tmp/b.png',
          previewPath: null,
          role: 'child-output',
          sortOrder: 2,
          createdAt: 20
        },
        {
          id: 'asset-1',
          filePath: '/tmp/a.png',
          previewPath: null,
          role: 'child-output',
          sortOrder: 1,
          createdAt: 10
        },
        {
          id: 'asset-dup',
          filePath: '/tmp/a.png',
          previewPath: null,
          role: 'child-output',
          sortOrder: 3,
          createdAt: 30
        },
        {
          id: 'asset-txt',
          filePath: '/tmp/readme.txt',
          previewPath: null,
          role: 'child-output',
          sortOrder: 4,
          createdAt: 40
        }
      ]
    }
  ]

  const assets = buildBatchPickAssets(historyTasks)
  assert.deepEqual(
    assets.map((asset) => asset.id),
    ['asset-1', 'asset-2']
  )
})
