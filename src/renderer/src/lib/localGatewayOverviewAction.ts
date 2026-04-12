import type { LocalGatewayOverallStatus } from '../../../shared/localGatewayTypes'

export type LocalGatewayPrimaryActionKind = 'initialize'

export type LocalGatewayPrimaryAction = {
  label: '启动网关' | '启动 Chrome' | '重新启动'
  kind: LocalGatewayPrimaryActionKind
  busyLabel: '启动中...'
  isRestartStyle: boolean
  isFlowRecoveryAction: boolean
}

export function resolveLocalGatewayPrimaryAction(input: {
  overallStatus: LocalGatewayOverallStatus | null | undefined
  isChatCapabilityReady: boolean
  isFlowCapabilityReady: boolean
}): LocalGatewayPrimaryAction {
  const isFlowRecoveryAction =
    input.overallStatus === 'degraded' &&
    input.isChatCapabilityReady &&
    !input.isFlowCapabilityReady
  const isRestartStyle = input.overallStatus === 'services_ready'

  return {
    label: isRestartStyle ? '重新启动' : isFlowRecoveryAction ? '启动 Chrome' : '启动网关',
    kind: 'initialize',
    busyLabel: '启动中...',
    isRestartStyle,
    isFlowRecoveryAction
  }
}
