import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasActivePreviewSlotRuntimeStates,
  resolvePreviewSlotState
} from './previewSlotHelpers.ts'

test('resolvePreviewSlotState marks the active slot as loading and future slots as queued', () => {
  assert.deepEqual(
    resolvePreviewSlotState({
      index: 2,
      asset: null,
      failureMessage: null,
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 2,
      runtimeState: null
    }),
    {
      status: 'loading',
      statusText: '结果生成中'
    }
  )

  assert.deepEqual(
    resolvePreviewSlotState({
      index: 4,
      asset: null,
      failureMessage: null,
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 2,
      runtimeState: null
    }),
    {
      status: 'loading',
      statusText: '排队中'
    }
  )
})

test('resolvePreviewSlotState prefers runtime state and failures over the shared stage label', () => {
  assert.deepEqual(
    resolvePreviewSlotState({
      index: 3,
      asset: null,
      failureMessage: null,
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 1,
      runtimeState: {
        status: 'cleaning',
        message: '去水印处理中'
      }
    }),
    {
      status: 'loading',
      statusText: '去水印处理中'
    }
  )

  assert.deepEqual(
    resolvePreviewSlotState({
      index: 5,
      asset: null,
      failureMessage: '服务仅返回 4/5 张结果',
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 1,
      runtimeState: {
        status: 'queued',
        message: '排队中'
      }
    }),
    {
      status: 'failed',
      statusText: '服务仅返回 4/5 张结果'
    }
  )
})

test('resolvePreviewSlotState appends elapsed time for generating runtime states', () => {
  assert.deepEqual(
    resolvePreviewSlotState({
      index: 1,
      asset: null,
      failureMessage: null,
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 1,
      nowMs: 80_000,
      runtimeState: {
        status: 'generating',
        message: '结果生成中',
        startedAt: 1_000
      }
    }),
    {
      status: 'loading',
      statusText: '结果生成中 · 已等待 01:19'
    }
  )
})

test('resolvePreviewSlotState lets an active rerun override stale slot content', () => {
  assert.deepEqual(
    resolvePreviewSlotState({
      index: 1,
      asset: { id: 'existing-video' },
      failureMessage: '上一次失败',
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 1,
      runtimeState: {
        status: 'generating',
        message: '结果生成中'
      }
    }),
    {
      status: 'loading',
      statusText: '结果生成中'
    }
  )
})

test('resolvePreviewSlotState appends elapsed time for queued runtime states', () => {
  assert.deepEqual(
    resolvePreviewSlotState({
      index: 2,
      asset: null,
      failureMessage: null,
      isRunning: true,
      currentLabel: '结果生成中',
      currentItemIndex: 1,
      nowMs: 18_500,
      runtimeState: {
        status: 'queued',
        message: '排队中',
        startedAt: 2_000
      }
    }),
    {
      status: 'loading',
      statusText: '排队中 · 已等待 00:16'
    }
  )
})

test('hasActivePreviewSlotRuntimeStates keeps the preview running when unfinished slots remain', () => {
  assert.equal(
    hasActivePreviewSlotRuntimeStates({
      2: {
        status: 'generating',
        message: '结果生成中',
        startedAt: 10_000
      },
      4: {
        status: 'queued',
        message: '排队中',
        startedAt: 6_000
      }
    }),
    true
  )

  assert.equal(
    hasActivePreviewSlotRuntimeStates({
      1: {
        status: 'failed',
        message: '生成失败'
      }
    }),
    false
  )

  assert.equal(hasActivePreviewSlotRuntimeStates({}), false)
  assert.equal(hasActivePreviewSlotRuntimeStates(null), false)
})
