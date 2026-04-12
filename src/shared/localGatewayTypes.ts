import type { CmsChromeProfilePurpose } from './cmsChromeProfileTypes'

export type LocalGatewayConfig = {
  enabled: boolean
  bundlePath: string
  autoStartOnAppLaunch: boolean
  startAdminUi: boolean
  startCdpProxy: boolean
  allowDedicatedChrome: boolean
  chromeProfileDirectories: string[]
  gatewayCmsProfileId: string
  prewarmImageOnLaunch: boolean
}

export type LocalGatewayAccountStatus = 'active' | 'cooldown' | 'disabled'

export type LocalGatewayOverallStatus =
  | 'disabled'
  | 'unconfigured'
  | 'starting'
  | 'services_ready'
  | 'degraded'
  | 'failed'

export type LocalGatewayServiceName =
  | 'adapter'
  | 'gateway'
  | 'adminUi'
  | 'cdpProxy'
  | 'chromeDebug'

export type LocalGatewayServiceStatus = {
  name: LocalGatewayServiceName
  ok: boolean
  port: number
  message: string | null
}

export type LocalGatewayState = {
  overallStatus: LocalGatewayOverallStatus
  services: LocalGatewayServiceStatus[]
  bundlePath: string
  lastStartedAt: number | null
  lastError: string | null
}

export type LocalGatewayChromeProfile = {
  id: string
  profileDir: string
  nickname: string
  label: string
  purpose: CmsChromeProfilePurpose
  xhsLoggedIn: boolean
  lastLoginCheck: string | null
}

export type LocalGatewaySystemChromeProfile = {
  profileDirectory: string
  displayName: string
  email: string | null
  label: string
}

export type LocalGatewayAccountSummary = {
  id: string
  accountLabel: string
  status: LocalGatewayAccountStatus
  chromeProfileDirectory: string | null
  lastFailedAt: number | null
  consecutiveFailures: number
}

export type LocalGatewayInitializationResult = {
  success: boolean
  profileId: string
  profileDirectory: string
  output: string
}
