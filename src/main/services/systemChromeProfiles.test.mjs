import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getChromeUserDataDir,
  parseSystemChromeProfilesFromLocalState
} from './systemChromeProfiles.ts'

test('getChromeUserDataDir resolves the default macOS Chrome user data directory', () => {
  assert.equal(
    getChromeUserDataDir({
      platform: 'darwin',
      homeDir: '/Users/demo'
    }),
    '/Users/demo/Library/Application Support/Google/Chrome'
  )
})

test('getChromeUserDataDir resolves the default Windows Chrome user data directory', () => {
  assert.equal(
    getChromeUserDataDir({
      platform: 'win32',
      homeDir: 'C:\\Users\\demo'
    }),
    'C:\\Users\\demo\\AppData\\Local\\Google\\Chrome\\User Data'
  )
})

test('parseSystemChromeProfilesFromLocalState extracts profile directory, display name, and email', () => {
  const profiles = parseSystemChromeProfilesFromLocalState(
    JSON.stringify({
      profile: {
        info_cache: {
          'Profile 12': {
            name: 'Studio',
            user_name: 'studio@example.com'
          },
          'Profile 10': {
            name: 'Main',
            gaia_name: 'Main Account',
            user_name: 'main@example.com'
          }
        }
      }
    })
  )

  assert.deepEqual(profiles, [
    {
      profileDirectory: 'Profile 10',
      displayName: 'Main',
      email: 'main@example.com',
      label: 'Main · main@example.com'
    },
    {
      profileDirectory: 'Profile 12',
      displayName: 'Studio',
      email: 'studio@example.com',
      label: 'Studio · studio@example.com'
    }
  ])
})
