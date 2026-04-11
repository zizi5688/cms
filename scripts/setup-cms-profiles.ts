import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'

import {
  buildCmsAccountsConfig,
  getChromeLocalStatePath,
  getChromeProfilesOutputPath,
  getChromeUserDataDir,
  getCmsChromeDataDir,
  loadCmsAccountsConfig,
  parseChromeProfilesFromLocalState,
  parseCountArgument,
  renderProfileTable,
  saveCmsAccountsConfig
} from './chrome-profile-utils.ts'

async function ensureDefaultChromeProfileSnapshot(): Promise<void> {
  const outputPath = getChromeProfilesOutputPath()
  if (existsSync(outputPath)) {
    console.log(`已存在默认 Chrome Profile 对照表，跳过生成: ${outputPath}`)
    return
  }

  const localStatePath = getChromeLocalStatePath()
  const rawLocalState = await readFile(localStatePath, 'utf8')
  const profiles = parseChromeProfilesFromLocalState(rawLocalState, getChromeUserDataDir())
  if (profiles.length === 0) {
    throw new Error(`未在 ${localStatePath} 中找到 profile.info_cache`)
  }

  console.log(renderProfileTable(profiles))
  await writeFile(outputPath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8')
  console.log(`已写入 ${outputPath}`)
}

async function main(): Promise<void> {
  const count = parseCountArgument(process.argv.slice(2), 10)
  const homeDir = os.homedir()
  const cmsDataDir = getCmsChromeDataDir(homeDir)

  await ensureDefaultChromeProfileSnapshot()
  await mkdir(cmsDataDir, { recursive: true })

  const existingConfig = await loadCmsAccountsConfig(homeDir)
  const config = buildCmsAccountsConfig({
    homeDir,
    count,
    existingProfiles: existingConfig?.profiles ?? []
  })

  for (const profile of config.profiles) {
    await mkdir(`${cmsDataDir}/${profile.profileDir}`, { recursive: true })
  }

  await saveCmsAccountsConfig(config, homeDir)

  console.log(`已创建 ${config.profiles.length} 个 CMS 专用 Profile，接下来需要为每个 Profile 登录小红书账号`)
  for (const profile of config.profiles) {
    console.log(`- ${profile.id} (${profile.nickname || '未命名'})`)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
