import assert from 'node:assert/strict'
import test from 'node:test'

import { listLocalGatewayChromeProfiles } from './localGatewayChromeProfiles.ts'

test('listLocalGatewayChromeProfiles maps CMS gateway profiles into local gateway options', async () => {
  const profiles = await listLocalGatewayChromeProfiles(async () => [
    {
      id: 'cms-gateway-profile',
      nickname: '本地网关专用',
      profileDir: 'cms-gateway-profile',
      purpose: 'gateway',
      xhsLoggedIn: false,
      lastLoginCheck: null
    },
    {
      id: 'cms-shared',
      nickname: '共享 Profile',
      profileDir: 'cms-shared',
      purpose: 'shared',
      xhsLoggedIn: true,
      lastLoginCheck: '2026-04-11T01:02:03.000Z'
    }
  ])

  assert.deepEqual(profiles, [
    {
      id: 'cms-gateway-profile',
      profileDir: 'cms-gateway-profile',
      nickname: '本地网关专用',
      purpose: 'gateway',
      xhsLoggedIn: false,
      lastLoginCheck: null,
      label: '本地网关专用 (cms-gateway-profile) · 网关专用 · 未登录'
    },
    {
      id: 'cms-shared',
      profileDir: 'cms-shared',
      nickname: '共享 Profile',
      purpose: 'shared',
      xhsLoggedIn: true,
      lastLoginCheck: '2026-04-11T01:02:03.000Z',
      label: '共享 Profile (cms-shared) · 共享 · 已登录'
    }
  ])
})

test('listLocalGatewayChromeProfiles returns empty when no CMS gateway profiles exist', async () => {
  const profiles = await listLocalGatewayChromeProfiles(async () => [])
  assert.deepEqual(profiles, [])
})
