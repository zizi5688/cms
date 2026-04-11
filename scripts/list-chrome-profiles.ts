import { readFile, writeFile } from 'node:fs/promises'

import {
  getChromeLocalStatePath,
  getChromeProfilesOutputPath,
  getChromeUserDataDir,
  parseChromeProfilesFromLocalState,
  renderProfileTable
} from './chrome-profile-utils.ts'

async function main(): Promise<void> {
  const userDataDir = getChromeUserDataDir()
  const localStatePath = getChromeLocalStatePath()
  const outputPath = getChromeProfilesOutputPath()
  const rawLocalState = await readFile(localStatePath, 'utf8')
  const profiles = parseChromeProfilesFromLocalState(rawLocalState, userDataDir)

  if (profiles.length === 0) {
    throw new Error(`未在 ${localStatePath} 中找到 profile.info_cache`)
  }

  console.log(renderProfileTable(profiles))
  await writeFile(outputPath, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8')
  console.log(`\n已写入 ${outputPath}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
