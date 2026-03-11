import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePreviewSlotState } from './previewSlotHelpers.ts'

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
