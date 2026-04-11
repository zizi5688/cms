import os from 'node:os'
import { join } from 'node:path'

import {
  findCmsProfileRecord,
  getCmsChromeDataDir,
  loadCmsAccountsConfig,
  parseProfileArgument
} from './chrome-profile-utils.ts'
import {
  checkCreatorLogin,
  closeBrowserSafely,
  delay,
  launchCmsProfileBrowser,
  moveWindowOffscreenOrMinimize,
  openCreatorCenter,
  prepareStealthPage,
  readChromeVersionDetails
} from './cms-profile-runtime.ts'

async function main(): Promise<void> {
  const profileId = parseProfileArgument(process.argv.slice(2))
  const homeDir = os.homedir()
  const config = await loadCmsAccountsConfig(homeDir)
  if (!config) {
    throw new Error('未找到 cms-accounts.json，请先运行 setup-cms-profiles.ts')
  }

  const profile = findCmsProfileRecord(config, profileId)
  const cmsDataDir = getCmsChromeDataDir(homeDir)
  const expectedProfilePath = join(cmsDataDir, profile.profileDir)

  const browser = await launchCmsProfileBrowser({
    executablePath: config.chromeExecutable,
    userDataDir: cmsDataDir,
    profileDir: profile.profileDir
  })

  try {
    const firstPage = (await browser.pages())[0] ?? (await browser.newPage())
    await moveWindowOffscreenOrMinimize(firstPage)

    const versionPage = await browser.newPage()
    await prepareStealthPage(versionPage)
    const versionDetails = await readChromeVersionDetails(versionPage)
    console.log(`Profile Path: ${versionDetails.profilePath}`)
    console.log(`User Data Dir: ${versionDetails.userDataDir}`)
    console.log(
      `Profile Path 校验: ${versionDetails.profilePath === expectedProfilePath ? '匹配' : '不匹配'}`
    )
    console.log(
      `User Data Dir 校验: ${versionDetails.userDataDir === cmsDataDir ? '匹配' : '不匹配'}`
    )

    const creatorPage = await browser.newPage()
    await prepareStealthPage(creatorPage)
    await openCreatorCenter(creatorPage)
    const loginResult = await checkCreatorLogin(creatorPage)
    console.log(`创作者中心最终 URL: ${loginResult.finalUrl}`)
    console.log(`创作者中心登录态: ${loginResult.loggedIn ? '已登录' : '未登录'} (${loginResult.reason})`)

    await delay(3_000)
  } finally {
    await closeBrowserSafely(browser)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
