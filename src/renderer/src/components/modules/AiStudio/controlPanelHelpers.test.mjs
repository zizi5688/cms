import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePrimaryGenerateButtonState } from './controlPanelHelpers.ts'

test('resolvePrimaryGenerateButtonState keeps image mode on the generate action even when another image batch is running', () => {
  assert.deepEqual(
    resolvePrimaryGenerateButtonState({
      isVideoStudio: false,
      isRunning: true,
      isInterrupting: false
    }),
    {
      actionLabel: '开始生成',
      intent: 'generate',
      disabled: false
    }
  )
})

test('resolvePrimaryGenerateButtonState keeps the video interrupt affordance unchanged', () => {
  assert.deepEqual(
    resolvePrimaryGenerateButtonState({
      isVideoStudio: true,
      isRunning: true,
      isInterrupting: true
    }),
    {
      actionLabel: '中断中...',
      intent: 'interrupt',
      disabled: true
    }
  )
})
