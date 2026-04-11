import { listGatewayCmsChromeProfiles } from '../../cdp/chrome-launcher.ts'
import type { CmsChromeProfileRecord } from '../../shared/cmsChromeProfileTypes'
import type { LocalGatewayChromeProfile } from '../../shared/localGatewayTypes.ts'

export function mapCmsProfilesToLocalGatewayProfiles(
  profiles: CmsChromeProfileRecord[]
): LocalGatewayChromeProfile[] {
  return profiles
    .map((profile) => {
      const nickname = typeof profile.nickname === 'string' && profile.nickname.trim() ? profile.nickname.trim() : profile.id
      const purpose: LocalGatewayChromeProfile['purpose'] = profile.purpose === 'shared' ? 'shared' : 'gateway'
      const status = profile.xhsLoggedIn ? '已登录' : '未登录'
      return {
        id: profile.id,
        profileDir: profile.profileDir,
        nickname,
        purpose,
        xhsLoggedIn: profile.xhsLoggedIn,
        lastLoginCheck: profile.lastLoginCheck,
        label: `${nickname} (${profile.profileDir}) · ${purpose === 'gateway' ? '网关专用' : '共享'} · ${status}`
      }
    })
    .sort((left, right) => left.profileDir.localeCompare(right.profileDir))
}

export async function listLocalGatewayChromeProfiles(
  listProfiles: () => Promise<CmsChromeProfileRecord[]> = listGatewayCmsChromeProfiles
): Promise<LocalGatewayChromeProfile[]> {
  const profiles = await listProfiles()
  return mapCmsProfilesToLocalGatewayProfiles(profiles)
}
