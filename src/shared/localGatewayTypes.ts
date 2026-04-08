export type LocalGatewayConfig = {
  enabled: boolean
  bundlePath: string
  autoStartOnAppLaunch: boolean
  startAdminUi: boolean
  startCdpProxy: boolean
  allowDedicatedChrome: boolean
  chromeProfileDirectory: string
  prewarmImageOnLaunch: boolean
}

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
  directory: string
  name: string
  label: string
  userName: string | null
}

export type LocalGatewayInitializationResult = {
  success: boolean
  profileDirectory: string
  output: string
}
