import assert from 'node:assert/strict'
import test from 'node:test'

import { syncLocalGatewayAccounts } from './localGatewayAdminClient.ts'

test('syncLocalGatewayAccounts saves profile selection before reloading accounts', async () => {
  const calls = []

  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body ?? null
    })

    if (String(url).endsWith('/admin/profile-selection')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          selected: ['Profile 1', 'Profile 7'],
          missing: [],
          selectionPath: '/tmp/profile-selection.json',
          error: null
        })
      }
    }

    if (String(url).endsWith('/admin/accounts')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accounts: [
            {
              id: 'acct_1',
              accountLabel: 'Primary Gemini',
              status: 'active',
              chromeProfileDirectory: 'Profile 1',
              consecutiveFailures: 0
            }
          ]
        })
      }
    }

    return {
      ok: false,
      status: 404,
      json: async () => ({})
    }
  }

  const accounts = await syncLocalGatewayAccounts(fetchImpl, [
    {
      profileDirectory: ' Profile 1 ',
      displayName: 'Primary',
      email: 'primary@example.com',
      label: 'Primary · primary@example.com'
    },
    {
      profileDirectory: 'Profile 7',
      displayName: 'Backup',
      email: null,
      label: 'Backup'
    }
  ])

  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:4174/admin/profile-selection',
      method: 'PUT',
      body: JSON.stringify({
        selected: ['Profile 1', 'Profile 7']
      })
    },
    {
      url: 'http://127.0.0.1:4174/admin/accounts',
      method: 'GET',
      body: null
    }
  ])

  assert.deepEqual(accounts, [
    {
      id: 'acct_1',
      accountLabel: 'Primary Gemini',
      status: 'active',
      chromeProfileDirectory: 'Profile 1',
      lastFailedAt: null,
      consecutiveFailures: 0
    }
  ])
})
