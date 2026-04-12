import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import process from 'node:process'

import type { LocalGatewaySystemChromeProfile } from '../../shared/localGatewayTypes.ts'

type ChromeUserDataDirOptions = {
  platform?: NodeJS.Platform
  homeDir?: string
  userDataDirOverride?: string | null
}

function normalizeNonEmptyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

export function getChromeUserDataDir(options: ChromeUserDataDirOptions = {}): string {
  const override =
    normalizeNonEmptyString(options.userDataDirOverride) ??
    normalizeNonEmptyString(process.env.CHROME_DEFAULT_USER_DATA_DIR)
  if (override) return override

  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? homedir()
  const pathApi = platform === 'win32' ? win32 : posix

  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')
  }

  if (platform === 'win32') {
    return pathApi.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
  }

  return pathApi.join(homeDir, '.config', 'google-chrome')
}

export function getChromeLocalStatePath(options: ChromeUserDataDirOptions = {}): string {
  return join(getChromeUserDataDir(options), 'Local State')
}

export function parseSystemChromeProfilesFromLocalState(
  rawLocalState: string
): LocalGatewaySystemChromeProfile[] {
  const parsed = JSON.parse(rawLocalState) as {
    profile?: {
      info_cache?: Record<
        string,
        {
          name?: string
          gaia_name?: string
          user_name?: string
          email?: string
        }
      >
    }
  }
  const infoCache = parsed.profile?.info_cache ?? {}

  return Object.entries(infoCache)
    .map(([profileDirectory, profile]) => {
      const displayName =
        normalizeNonEmptyString(profile?.name) ??
        normalizeNonEmptyString(profile?.gaia_name) ??
        profileDirectory
      const email =
        normalizeNonEmptyString(profile?.user_name) ?? normalizeNonEmptyString(profile?.email)

      return {
        profileDirectory,
        displayName,
        email,
        label: email ? `${displayName} · ${email}` : displayName
      }
    })
    .sort((left, right) => left.profileDirectory.localeCompare(right.profileDirectory))
}

export async function listSystemChromeProfiles(): Promise<LocalGatewaySystemChromeProfile[]> {
  const rawLocalState = await readFile(getChromeLocalStatePath(), 'utf8')
  return parseSystemChromeProfilesFromLocalState(rawLocalState)
}
