import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindMasterGeneratedAssetsToSlots,
  bindMasterGeneratedAssetToSlot,
  buildSkippedMasterCleanupAssets
} from './masterCleanupHelpers.ts'

test('buildSkippedMasterCleanupAssets reuses the raw asset as the clean output when local cleanup is skipped', () => {
  const rawAsset = {
    id: 'asset-raw-1',
    taskId: 'task-1',
    runId: 'run-1',
    kind: 'output',
    role: 'master-raw',
    filePath: '/tmp/output-001.png',
    previewPath: '/tmp/output-001.preview.png',
    originPath: 'https://example.com/output-001.png',
    selected: false,
    sortOrder: 0,
    metadata: {
      stage: 'master',
      sequenceIndex: 1,
      outputIndex: 0,
      contentType: 'image/png'
    }
  }

  assert.deepEqual(buildSkippedMasterCleanupAssets(rawAsset, 1), [
    {
      ...rawAsset,
      metadata: {
        ...rawAsset.metadata,
        stage: 'master',
        sequenceIndex: 1,
        watermarkStatus: 'skipped',
        localCleanupSkipped: true
      }
    },
    {
      id: 'asset-raw-1:clean',
      taskId: 'task-1',
      runId: 'run-1',
      kind: 'output',
      role: 'master-clean',
      filePath: '/tmp/output-001.png',
      previewPath: '/tmp/output-001.preview.png',
      originPath: '/tmp/output-001.png',
      selected: false,
      sortOrder: 0,
      metadata: {
        stage: 'master',
        sequenceIndex: 1,
        sourceAssetId: 'asset-raw-1',
        watermarkStatus: 'skipped',
        localCleanupSkipped: true
      }
    }
  ])
})

test('buildSkippedMasterCleanupAssets falls back to the raw file path when the raw asset has no preview path', () => {
  const rawAsset = {
    id: 'asset-raw-2',
    taskId: 'task-2',
    runId: 'run-2',
    kind: 'output',
    role: 'master-raw',
    filePath: '/tmp/output-002.png',
    previewPath: null,
    originPath: null,
    selected: true,
    sortOrder: 2,
    metadata: {}
  }

  const [, cleanAsset] = buildSkippedMasterCleanupAssets(rawAsset, 3)
  assert.equal(cleanAsset.previewPath, '/tmp/output-002.png')
  assert.equal(cleanAsset.filePath, '/tmp/output-002.png')
  assert.equal(cleanAsset.metadata.localCleanupSkipped, true)
})

test('bindMasterGeneratedAssetToSlot preserves the existing slot binding when retrying a successful image slot', () => {
  const nextRawAsset = bindMasterGeneratedAssetToSlot(
    {
      id: 'provider-asset-new',
      taskId: 'task-1',
      runId: 'run-2',
      kind: 'output',
      role: 'ignored-provider-role',
      filePath: '/tmp/output-001-reroll.png',
      previewPath: '/tmp/output-001-reroll.preview.png',
      originPath: 'https://example.com/output-001-reroll.png',
      selected: false,
      sortOrder: 99,
      metadata: {
        providerTraceId: 'trace-1'
      }
    },
    1,
    {
      id: 'asset-raw-1',
      taskId: 'task-1',
      sortOrder: 0,
      selected: true
    }
  )

  assert.deepEqual(nextRawAsset, {
    id: 'asset-raw-1',
    taskId: 'task-1',
    runId: 'run-2',
    kind: 'output',
    role: 'master-raw',
    filePath: '/tmp/output-001-reroll.png',
    previewPath: '/tmp/output-001-reroll.preview.png',
    originPath: 'https://example.com/output-001-reroll.png',
    selected: true,
    sortOrder: 0,
    metadata: {
      providerTraceId: 'trace-1',
      stage: 'master',
      sequenceIndex: 1,
      outputIndex: 0,
      watermarkStatus: 'pending'
    }
  })
})

test('bindMasterGeneratedAssetToSlot falls back to the provider asset id when the image slot has no previous raw asset', () => {
  const nextRawAsset = bindMasterGeneratedAssetToSlot(
    {
      id: 'provider-asset-fresh',
      taskId: 'task-2',
      runId: 'run-9',
      kind: 'output',
      role: 'ignored-provider-role',
      filePath: '/tmp/output-003.png',
      previewPath: null,
      originPath: null,
      selected: false,
      sortOrder: 5,
      metadata: {}
    },
    3,
    null
  )

  assert.equal(nextRawAsset.id, 'provider-asset-fresh')
  assert.equal(nextRawAsset.taskId, 'task-2')
  assert.equal(nextRawAsset.sortOrder, 2)
  assert.equal(nextRawAsset.role, 'master-raw')
  assert.equal(nextRawAsset.metadata.sequenceIndex, 3)
})

test('bindMasterGeneratedAssetsToSlots preserves per-slot bindings across a single multi-output provider response', () => {
  const nextRawAssets = bindMasterGeneratedAssetsToSlots(
    [
      {
        id: 'provider-asset-1',
        taskId: 'task-1',
        runId: 'run-10',
        kind: 'output',
        role: 'ignored-provider-role',
        filePath: '/tmp/output-001.png',
        previewPath: '/tmp/output-001.preview.png',
        originPath: 'https://example.com/output-001.png',
        selected: false,
        sortOrder: 7,
        metadata: {
          providerTraceId: 'trace-a'
        }
      },
      {
        id: 'provider-asset-2',
        taskId: 'task-1',
        runId: 'run-10',
        kind: 'output',
        role: 'ignored-provider-role',
        filePath: '/tmp/output-002.png',
        previewPath: '/tmp/output-002.preview.png',
        originPath: 'https://example.com/output-002.png',
        selected: false,
        sortOrder: 8,
        metadata: {
          providerTraceId: 'trace-b'
        }
      }
    ],
    [
      {
        id: 'asset-slot-1',
        taskId: 'task-1',
        sortOrder: 0,
        selected: true
      },
      null
    ]
  )

  assert.deepEqual(nextRawAssets, [
    {
      id: 'asset-slot-1',
      taskId: 'task-1',
      runId: 'run-10',
      kind: 'output',
      role: 'master-raw',
      filePath: '/tmp/output-001.png',
      previewPath: '/tmp/output-001.preview.png',
      originPath: 'https://example.com/output-001.png',
      selected: true,
      sortOrder: 0,
      metadata: {
        providerTraceId: 'trace-a',
        stage: 'master',
        sequenceIndex: 1,
        outputIndex: 0,
        watermarkStatus: 'pending'
      }
    },
    {
      id: 'provider-asset-2',
      taskId: 'task-1',
      runId: 'run-10',
      kind: 'output',
      role: 'master-raw',
      filePath: '/tmp/output-002.png',
      previewPath: '/tmp/output-002.preview.png',
      originPath: 'https://example.com/output-002.png',
      selected: false,
      sortOrder: 1,
      metadata: {
        providerTraceId: 'trace-b',
        stage: 'master',
        sequenceIndex: 2,
        outputIndex: 0,
        watermarkStatus: 'pending'
      }
    }
  ])
})
