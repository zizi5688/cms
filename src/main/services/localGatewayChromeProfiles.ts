import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

import type { LocalGatewayChromeProfile } from '../../shared/localGatewayTypes.ts'

const DEFAULT_LOCAL_STATE_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
  'Local State'
)

export async function listLocalGatewayChromeProfiles(
  localStatePath = DEFAULT_LOCAL_STATE_PATH
): Promise<LocalGatewayChromeProfile[]> {
  let raw = ''
  try {
    raw = await readFile(localStatePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return []
    }
    throw error
  }
  const payload = JSON.parse(raw) as Record<string, unknown>
  const profile =
    payload.profile && typeof payload.profile === 'object'
      ? (payload.profile as Record<string, unknown>)
      : {}
  const infoCache =
    profile.info_cache && typeof profile.info_cache === 'object'
      ? (profile.info_cache as Record<string, unknown>)
      : {}

  const profiles = Object.entries(infoCache).map(([directory, value]) => {
    const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : directory
    const userName = typeof record.user_name === 'string' && record.user_name.trim() ? record.user_name.trim() : null
    return {
      directory,
      name,
      label: userName ? `${name} (${directory}) - ${userName}` : `${name} (${directory})`,
      userName
    }
  })

  return profiles.sort((left, right) => left.directory.localeCompare(right.directory))
}
