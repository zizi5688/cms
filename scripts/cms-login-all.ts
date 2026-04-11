import os from 'node:os'

import { loadCmsAccountsConfig } from './chrome-profile-utils.ts'
import { runCmsLoginFlow } from './cms-login.ts'

async function main(): Promise<void> {
  const config = await loadCmsAccountsConfig(os.homedir())
  if (!config) {
    throw new Error('未找到 cms-accounts.json，请先运行 setup-cms-profiles.ts')
  }

  const pendingProfiles = config.profiles.filter((profile) => !profile.xhsLoggedIn)
  if (pendingProfiles.length === 0) {
    console.log('所有 CMS Profile 都已经完成登录。')
    return
  }

  const results: Array<{ profileId: string; nickname: string; loggedIn: boolean }> = []

  for (const profile of pendingProfiles) {
    console.log(`\n正在为 ${profile.id} 登录，请在浏览器中操作`)
    const result = await runCmsLoginFlow(profile.id)
    results.push(result)
  }

  console.log('\n登录完成汇总：')
  for (const result of results) {
    const label = result.nickname ? `${result.profileId} (${result.nickname})` : result.profileId
    console.log(`${label}: ${result.loggedIn ? '✅ 已登录' : '❌ 未登录'}`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
