import os from 'node:os'
import { pathToFileURL } from 'node:url'

import {
  findCmsProfileRecord,
  getCmsChromeDataDir,
  loadCmsAccountsConfig,
  parseProfileArgument,
  replaceCmsProfileRecord,
  saveCmsAccountsConfig
} from './chrome-profile-utils.ts'
import {
  checkCreatorLogin,
  closeBrowserSafely,
  launchCmsProfileBrowser,
  openCreatorCenter,
  prepareStealthPage,
  promptForNickname,
  waitForEnter
} from './cms-profile-runtime.ts'

export async function runCmsLoginFlow(profileId: string): Promise<{
  profileId: string
  nickname: string
  loggedIn: boolean
}> {
  const homeDir = os.homedir()
  const config = await loadCmsAccountsConfig(homeDir)
  if (!config) {
    throw new Error('未找到 cms-accounts.json，请先运行 setup-cms-profiles.ts')
  }

  const profile = findCmsProfileRecord(config, profileId)
  const browser = await launchCmsProfileBrowser({
    executablePath: config.chromeExecutable,
    userDataDir: getCmsChromeDataDir(homeDir),
    profileDir: profile.profileDir
  })

  try {
    const page = await browser.newPage()
    await prepareStealthPage(page)
    await openCreatorCenter(page)

    console.log(`正在为 ${profile.id} 登录，请在浏览器中操作`)
    console.log('已打开小红书创作者中心，请在浏览器中完成登录。')
    await waitForEnter('登录完成后，在终端按回车键继续...')

    const loginResult = await checkCreatorLogin(page)

    if (!loginResult.loggedIn) {
      const failedConfig = replaceCmsProfileRecord(config, {
        ...profile,
        xhsLoggedIn: false,
        lastLoginCheck: new Date().toISOString()
      })
      await saveCmsAccountsConfig(failedConfig, homeDir)
      console.log(`❌ 未检测到登录态，请重试 (${loginResult.reason})`)
      return {
        profileId: profile.id,
        nickname: profile.nickname,
        loggedIn: false
      }
    }

    const nickname = await promptForNickname(profile.id, profile.nickname)
    const updatedConfig = replaceCmsProfileRecord(config, {
      ...profile,
      nickname,
      xhsLoggedIn: true,
      lastLoginCheck: new Date().toISOString()
    })
    await saveCmsAccountsConfig(updatedConfig, homeDir)
    console.log('✅ 登录成功，已保存登录态')

    return {
      profileId: profile.id,
      nickname,
      loggedIn: true
    }
  } finally {
    await closeBrowserSafely(browser)
  }
}

async function main(): Promise<void> {
  const profileId = parseProfileArgument(process.argv.slice(2))
  await runCmsLoginFlow(profileId)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}
