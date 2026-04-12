import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLocalGatewayPrimaryAction } from './localGatewayOverviewAction.ts'

test('failed overview action uses initialize logic with start label', () => {
  assert.deepEqual(
    resolveLocalGatewayPrimaryAction({
      overallStatus: 'failed',
      isChatCapabilityReady: false,
      isFlowCapabilityReady: false
    }),
    {
      label: '启动网关',
      kind: 'initialize',
      busyLabel: '启动中...',
      isRestartStyle: false,
      isFlowRecoveryAction: false
    }
  )
})

test('degraded overview action uses initialize logic for chrome recovery', () => {
  assert.deepEqual(
    resolveLocalGatewayPrimaryAction({
      overallStatus: 'degraded',
      isChatCapabilityReady: true,
      isFlowCapabilityReady: false
    }),
    {
      label: '启动 Chrome',
      kind: 'initialize',
      busyLabel: '启动中...',
      isRestartStyle: false,
      isFlowRecoveryAction: true
    }
  )
})

test('services_ready overview action still uses initialize logic and loading label', () => {
  assert.deepEqual(
    resolveLocalGatewayPrimaryAction({
      overallStatus: 'services_ready',
      isChatCapabilityReady: true,
      isFlowCapabilityReady: true
    }),
    {
      label: '重新启动',
      kind: 'initialize',
      busyLabel: '启动中...',
      isRestartStyle: true,
      isFlowRecoveryAction: false
    }
  )
})
