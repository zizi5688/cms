export type CmsPublishMode = 'electron' | 'cdp'
export type CmsChromeProfilePurpose = 'publisher' | 'gateway' | 'shared'

export type CmsChromeProfileRecord = {
  id: string
  nickname: string
  profileDir: string
  purpose?: CmsChromeProfilePurpose
  xhsLoggedIn: boolean
  lastLoginCheck: string | null
}

export type CmsChromeAccountsConfig = {
  profiles: CmsChromeProfileRecord[]
  chromeExecutable: string
  cmsDataDir: string
}

export type CmsChromeLoginVerificationResult = {
  accountId: string
  profileId: string
  profileDir: string
  loggedIn: boolean
  reason: string
  finalUrl: string
  checkedAt: string
}
