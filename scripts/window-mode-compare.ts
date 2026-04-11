import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type WindowMode = 'offscreen' | 'edge-visible'

type CompareRunSummary = {
  mode: WindowMode
  ok: boolean
  durationMs: number
  reportPath: string
  screenshotPath?: string
  tagsScreenshotPath?: string
  eventLogPath?: string
  debugLogPath?: string
  failureStep?: string
  error?: string
  finalDetection?: {
    webdriver: boolean
    hasProcess: boolean
    isTrusted: boolean | null
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const profile = parseRequiredArg(argv, '--profile')
  const outputDir = resolve(
    parseOptionalArg(argv, '--output-dir') ||
      join(os.homedir(), 'chrome-cms-data', 'reports', `window-mode-compare-${Date.now()}`)
  )
  mkdirSync(outputDir, { recursive: true })

  const summaries: CompareRunSummary[] = []
  for (const mode of ['offscreen', 'edge-visible'] as const) {
    summaries.push(await runMode(profile, mode, outputDir))
  }

  const preferred =
    summaries.find((item) => item.mode === 'edge-visible' && item.ok) ??
    summaries.find((item) => item.ok) ??
    null

  const report = {
    profile,
    generatedAt: new Date().toISOString(),
    outputDir,
    preferredDefaultMode: preferred?.mode ?? null,
    summaries
  }

  const reportPath = join(outputDir, 'window-mode-compare-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`窗口模式对比报告已保存: ${reportPath}`)
  for (const summary of summaries) {
    console.log(
      `${summary.mode}: ${summary.ok ? '成功' : '失败'} (${summary.durationMs}ms)${
        summary.error ? ` - ${summary.error}` : ''
      }`
    )
  }
  console.log(`推荐默认模式: ${report.preferredDefaultMode ?? '无（两种模式均失败）'}`)
}

async function runMode(profile: string, mode: WindowMode, outputDir: string): Promise<CompareRunSummary> {
  const reportPath = join(outputDir, `${mode}-publish-test-report.json`)
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
      mode,
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
      mode,
      ok: parsed.ok === true,
      durationMs: Date.now() - startedAt,
      reportPath,
      screenshotPath: asOptionalString(parsed.screenshotPath),
      tagsScreenshotPath: asOptionalString(parsed.tagsScreenshotPath),
      eventLogPath: asOptionalString(parsed.eventLogPath),
      debugLogPath: asOptionalString(parsed.debugLogPath),
      failureStep: asOptionalString(parsed.failureStep),
      finalDetection: isRecord(parsed.finalDetection)
        ? {
            webdriver: parsed.finalDetection.webdriver === true,
            hasProcess: parsed.finalDetection.hasProcess === true,
            isTrusted:
              typeof parsed.finalDetection.isTrusted === 'boolean'
                ? parsed.finalDetection.isTrusted
                : null
          }
        : undefined
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      mode,
      ok: false,
      durationMs: Date.now() - startedAt,
      reportPath,
      error: message
    }
  }
}

function parseRequiredArg(argv: string[], name: string): string {
  const value = parseOptionalArg(argv, name)
  if (!value) {
    throw new Error(`缺少参数 ${name}`)
  }
  return value
}

function parseOptionalArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const raw = String(argv[index + 1] ?? '').trim()
  return raw || undefined
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object'
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
