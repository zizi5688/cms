import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type WindowMode = 'visible' | 'minimized' | 'offscreen' | 'edge-visible'

type BatchRunSummary = {
  index: number
  ok: boolean
  durationMs: number
  reportPath: string
  chromeClosedCleanly: boolean
  error?: string
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profile = parseRequiredArg(argv, '--profile')
  const count = Number(parseOptionalArg(argv, '--count') ?? '5')
  const windowMode = (parseOptionalArg(argv, '--window-mode') ?? 'offscreen') as WindowMode
  const outputDir = resolve(
    parseOptionalArg(argv, '--output-dir') ||
      join(os.homedir(), 'chrome-cms-data', 'reports', `publish-dryrun-batch-${Date.now()}`)
  )

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('参数 --count 必须是正整数')
  }

  mkdirSync(outputDir, { recursive: true })
  const summaries: BatchRunSummary[] = []

  for (let index = 1; index <= Math.floor(count); index += 1) {
    summaries.push(await runBatchItem(profile, index, windowMode, outputDir))
  }

  const successCount = summaries.filter((item) => item.ok).length
  const report = {
    profile,
    count: Math.floor(count),
    windowMode,
    generatedAt: new Date().toISOString(),
    successCount,
    allSucceeded: successCount === Math.floor(count),
    summaries
  }

  const reportPath = join(outputDir, 'publish-dryrun-batch-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`批量 dryRun 报告已保存: ${reportPath}`)
  console.log(`成功: ${successCount}/${Math.floor(count)}`)
  for (const summary of summaries) {
    console.log(
      `run-${summary.index}: ${summary.ok ? '成功' : '失败'} (${summary.durationMs}ms, close=${
        summary.chromeClosedCleanly ? 'ok' : 'stale-lock'
      })${summary.error ? ` - ${summary.error}` : ''}`
    )
  }
}

async function runBatchItem(
  profile: string,
  index: number,
  windowMode: WindowMode,
  outputDir: string
): Promise<BatchRunSummary> {
  const reportPath = join(outputDir, `run-${index}.json`)
  const lockPath = join(os.homedir(), 'chrome-cms-data', 'SingletonLock')

  const startedAt = Date.now()
  try {
    await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/publish-test.ts',
      '--profile',
      profile,
      '--stage',
      'dryrun',
      '--window-mode',
      windowMode,
      '--hold-ms',
      '0',
      '--report-path',
      reportPath
    ], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024 * 20
    })

    const parsed = JSON.parse(readFileSync(reportPath, 'utf-8')) as Record<string, unknown>
    return {
      index,
      ok: parsed.ok === true,
      durationMs: Date.now() - startedAt,
      reportPath,
      chromeClosedCleanly: !existsSync(lockPath)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      index,
      ok: false,
      durationMs: Date.now() - startedAt,
      reportPath,
      chromeClosedCleanly: !existsSync(lockPath),
      error: message
    }
  }
}

function parseRequiredArg(argv: string[], name: string): string {
  const value = parseOptionalArg(argv, name)
  if (!value) throw new Error(`缺少参数 ${name}`)
  return value
}

function parseOptionalArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const raw = String(argv[index + 1] ?? '').trim()
  return raw || undefined
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
