import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { listLocalGatewayChromeProfiles } from './localGatewayChromeProfiles.ts'

test('listLocalGatewayChromeProfiles reads and sorts profiles from Local State', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chrome-profiles-'))
  const localStatePath = join(root, 'Local State')
  await writeFile(
    localStatePath,
    JSON.stringify({
      profile: {
        info_cache: {
          'Profile 10': { name: 'Work', user_name: 'work@example.com' },
          Default: { name: 'Personal' }
        }
      }
    }),
    'utf-8'
  )

  const profiles = await listLocalGatewayChromeProfiles(localStatePath)
  assert.deepEqual(profiles, [
    {
      directory: 'Default',
      name: 'Personal',
      label: 'Personal (Default)',
      userName: null
    },
    {
      directory: 'Profile 10',
      name: 'Work',
      label: 'Work (Profile 10) - work@example.com',
      userName: 'work@example.com'
    }
  ])
})

test('listLocalGatewayChromeProfiles returns empty list when Local State is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chrome-profiles-missing-'))
  const localStatePath = join(root, 'Local State')

  const profiles = await listLocalGatewayChromeProfiles(localStatePath)

  assert.deepEqual(profiles, [])
})
