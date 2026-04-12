import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatSmartGenerationElapsedSeconds,
  getSmartGenerationPhaseLabel,
  resolveSmartGenerationFriendlyErrorMessage
} from './smartGenerationOverlayHelpers.ts'

test('smart generation overlay helpers map phase labels', () => {
  assert.equal(getSmartGenerationPhaseLabel('connecting'), '连接中...')
  assert.equal(getSmartGenerationPhaseLabel('generating'), '生成中...')
  assert.equal(getSmartGenerationPhaseLabel('parsing'), '解析中...')
  assert.equal(getSmartGenerationPhaseLabel(null), '')
})

test('smart generation overlay helpers format elapsed seconds defensively', () => {
  assert.equal(formatSmartGenerationElapsedSeconds(12), '已等待 12 秒')
  assert.equal(formatSmartGenerationElapsedSeconds(-3), '已等待 0 秒')
  assert.equal(formatSmartGenerationElapsedSeconds(4.9), '已等待 4 秒')
})

test('smart generation overlay helpers map raw errors to friendly messages', () => {
  assert.equal(
    resolveSmartGenerationFriendlyErrorMessage('Request timed out after 120000ms'),
    '生成超时，请稍后重试'
  )
  assert.equal(
    resolveSmartGenerationFriendlyErrorMessage('AI_PROVIDER_DEFAULT_MISSING: chat route'),
    '未配置默认供应商，请到设置中选择'
  )
  assert.equal(
    resolveSmartGenerationFriendlyErrorMessage('TypeError: fetch failed'),
    '网络连接失败，请检查网关状态'
  )
  assert.equal(
    resolveSmartGenerationFriendlyErrorMessage('unexpected csv parse error'),
    '生成失败，请重试'
  )
})
