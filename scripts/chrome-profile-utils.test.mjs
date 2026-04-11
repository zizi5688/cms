import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import {
  assessPipeModeSupport,
  buildCmsAccountsConfig,
  cleanupSingletonArtifacts,
  getCmsAccountsConfigPath,
  getCmsChromeDataDir,
  hasFilesystemEntry,
  inspectChromeSingletonLock,
  parseCountArgument,
  parseChromeMajorVersion,
  parseChromeProfilesFromLocalState,
  parseProfileArgument,
  resolveRequestedProfile,
  summarizeLoginState,
  validateCmsNickname
} from './chrome-profile-utils.ts'

test('parseChromeProfilesFromLocalState returns sorted profile rows', () => {
  const localState = JSON.stringify({
    profile: {
      info_cache: {
        Default: { name: '主账号' },
        'Profile 3': { name: '测试号' }
      }
    }
  })

  const rows = parseChromeProfilesFromLocalState(localState, '/Users/demo/Library/Application Support/Google/Chrome')

  assert.deepEqual(rows, [
    {
      directoryName: 'Default',
      nickname: '主账号',
      fullPath: '/Users/demo/Library/Application Support/Google/Chrome/Default'
    },
    {
      directoryName: 'Profile 3',
      nickname: '测试号',
      fullPath: '/Users/demo/Library/Application Support/Google/Chrome/Profile 3'
    }
  ])
})

test('parseProfileArgument reads --profile value', () => {
  assert.equal(parseProfileArgument(['--profile', 'Profile 3']), 'Profile 3')
})

test('parseProfileArgument rejects missing value', () => {
  assert.throws(() => parseProfileArgument(['--profile']), /--profile/)
})

test('resolveRequestedProfile returns matching profile row', () => {
  const rows = [
    {
      directoryName: 'Default',
      nickname: '主账号',
      fullPath: '/tmp/chrome/Default'
    },
    {
      directoryName: 'Profile 3',
      nickname: '测试号',
      fullPath: '/tmp/chrome/Profile 3'
    }
  ]

  assert.deepEqual(resolveRequestedProfile(rows, 'Profile 3'), rows[1])
})

test('resolveRequestedProfile throws when profile is absent', () => {
  assert.throws(
    () => resolveRequestedProfile([], 'Profile 9'),
    /Profile 9/
  )
})

test('summarizeLoginState marks logged in when session cookie exists', () => {
  const result = summarizeLoginState({
    finalUrl: 'https://creator.xiaohongshu.com/publish/publish',
    cookies: [{ name: 'web_session', value: 'abc' }]
  })

  assert.equal(result.loggedIn, true)
  assert.match(result.reason, /cookie/)
})

test('summarizeLoginState marks logged out when redirected to login', () => {
  const result = summarizeLoginState({
    finalUrl: 'https://creator.xiaohongshu.com/login',
    cookies: []
  })

  assert.equal(result.loggedIn, false)
  assert.match(result.reason, /login/i)
})

test('summarizeLoginState marks logged in on creator home with creator session cookie', () => {
  const result = summarizeLoginState({
    finalUrl: 'https://creator.xiaohongshu.com/new/home',
    cookies: [{ name: 'galaxy_creator_session_id', value: 'abc' }]
  })

  assert.equal(result.loggedIn, true)
  assert.match(result.reason, /cookie/)
})

test('hasFilesystemEntry returns true for broken symlink lock markers', () => {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'chrome-lock-test-'))
  const linkPath = join(tmpDir, 'SingletonLock')

  try {
    symlinkSync('missing-target', linkPath)
    assert.equal(hasFilesystemEntry(linkPath), true)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('inspectChromeSingletonLock reports active when pid is alive', () => {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'chrome-lock-active-'))
  const linkPath = join(tmpDir, 'SingletonLock')

  try {
    symlinkSync('ZdeMac-mini.local-85275', linkPath)
    const result = inspectChromeSingletonLock(linkPath, (pid) => pid === 85275)
    assert.equal(result.status, 'active')
    assert.equal(result.pid, 85275)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('inspectChromeSingletonLock reports stale when pid is gone', () => {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'chrome-lock-stale-'))
  const linkPath = join(tmpDir, 'SingletonLock')

  try {
    symlinkSync('ZdeMac-mini.local-85275', linkPath)
    const result = inspectChromeSingletonLock(linkPath, () => false)
    assert.equal(result.status, 'stale')
    assert.equal(result.pid, 85275)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('cleanupSingletonArtifacts removes stale singleton entries', () => {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'chrome-lock-clean-'))

  try {
    symlinkSync('host-1', join(tmpDir, 'SingletonLock'))
    symlinkSync('cookie', join(tmpDir, 'SingletonCookie'))
    symlinkSync('socket', join(tmpDir, 'SingletonSocket'))

    cleanupSingletonArtifacts(tmpDir)

    assert.equal(hasFilesystemEntry(join(tmpDir, 'SingletonLock')), false)
    assert.equal(hasFilesystemEntry(join(tmpDir, 'SingletonCookie')), false)
    assert.equal(hasFilesystemEntry(join(tmpDir, 'SingletonSocket')), false)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('parseChromeMajorVersion extracts major version', () => {
  assert.equal(parseChromeMajorVersion('Google Chrome 146.0.7680.178'), 146)
})

test('assessPipeModeSupport blocks default user data dir on Chrome 136+', () => {
  const result = assessPipeModeSupport({
    chromeMajorVersion: 146,
    userDataDir: '/Users/demo/Library/Application Support/Google/Chrome',
    defaultUserDataDir: '/Users/demo/Library/Application Support/Google/Chrome'
  })

  assert.equal(result.supported, false)
  assert.match(result.reason, /136\+/)
})

test('assessPipeModeSupport allows older Chrome versions', () => {
  const result = assessPipeModeSupport({
    chromeMajorVersion: 135,
    userDataDir: '/Users/demo/Library/Application Support/Google/Chrome',
    defaultUserDataDir: '/Users/demo/Library/Application Support/Google/Chrome'
  })

  assert.equal(result.supported, true)
})

test('getCmsChromeDataDir resolves to standalone CMS directory', () => {
  assert.equal(getCmsChromeDataDir('/Users/demo'), '/Users/demo/chrome-cms-data')
  assert.equal(
    getCmsAccountsConfigPath('/Users/demo'),
    '/Users/demo/chrome-cms-data/cms-accounts.json'
  )
})

test('buildCmsAccountsConfig creates requested number of profiles', () => {
  const config = buildCmsAccountsConfig({
    homeDir: '/Users/demo',
    count: 3,
    existingProfiles: []
  })

  assert.equal(config.profiles.length, 3)
  assert.deepEqual(config.profiles[0], {
    id: 'cms-profile-1',
    nickname: '',
    profileDir: 'cms-profile-1',
    xhsLoggedIn: false,
    lastLoginCheck: null
  })
  assert.equal(config.chromeExecutable, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  assert.equal(config.cmsDataDir, '/Users/demo/chrome-cms-data')
})

test('buildCmsAccountsConfig preserves existing state and appends missing profiles', () => {
  const config = buildCmsAccountsConfig({
    homeDir: '/Users/demo',
    count: 3,
    existingProfiles: [
      {
        id: 'cms-profile-1',
        nickname: '主号',
        profileDir: 'cms-profile-1',
        xhsLoggedIn: true,
        lastLoginCheck: '2026-04-10T13:00:00.000Z'
      }
    ]
  })

  assert.equal(config.profiles.length, 3)
  assert.deepEqual(config.profiles[0], {
    id: 'cms-profile-1',
    nickname: '主号',
    profileDir: 'cms-profile-1',
    xhsLoggedIn: true,
    lastLoginCheck: '2026-04-10T13:00:00.000Z'
  })
  assert.deepEqual(config.profiles[2], {
    id: 'cms-profile-3',
    nickname: '',
    profileDir: 'cms-profile-3',
    xhsLoggedIn: false,
    lastLoginCheck: null
  })
})

test('parseCountArgument reads --count value and falls back to default', () => {
  assert.equal(parseCountArgument([], 10), 10)
  assert.equal(parseCountArgument(['--count', '12'], 10), 12)
})

test('parseCountArgument rejects invalid values', () => {
  assert.throws(() => parseCountArgument(['--count', '0'], 10), /--count/)
  assert.throws(() => parseCountArgument(['--count', 'abc'], 10), /--count/)
})

test('validateCmsNickname requires non-empty nickname', () => {
  assert.equal(validateCmsNickname('  蔓半拍-主号  '), '蔓半拍-主号')
  assert.throws(() => validateCmsNickname('   '), /昵称/)
})
