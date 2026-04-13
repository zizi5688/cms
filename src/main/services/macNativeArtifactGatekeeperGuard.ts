import { createRequire } from 'node:module'

type MacNativeArtifactGatekeeperIssue = {
  moduleName: string
  detail: string
  command: string
}

type DetectMacNativeArtifactGatekeeperIssueOptions = {
  platform?: NodeJS.Platform
  appName?: string
  candidateModules?: string[]
  loadModule?: (moduleName: string) => unknown
}

type PromptForMacNativeArtifactRepairOptions = {
  issue: MacNativeArtifactGatekeeperIssue
  showMessageBox: (payload: {
    type: 'warning'
    title: string
    message: string
    detail: string
    buttons: string[]
    defaultId: number
    cancelId: number
    noLink: boolean
  }) => Promise<{ response: number }>
  writeClipboardText: (text: string) => void
}

const DEFAULT_NATIVE_MODULE_CANDIDATES = ['fsevents', 'better-sqlite3']
const GATEKEEPER_ERROR_PATTERNS = [/quarantine/i, /quarantined/i, /not verified/i]
const MODULE_NOT_FOUND_PATTERNS = [/cannot find module/i, /cannot find package/i, /module not found/i]
const nativeRequire = createRequire(import.meta.url)

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, error.stack].filter(Boolean).join('\n')
  }
  return String(error ?? '')
}

function summarizeError(detail: string): string {
  return detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? detail.trim()
}

function isModuleNotFoundError(detail: string): boolean {
  return MODULE_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(detail))
}

export function buildMacNativeArtifactRepairCommand(appName: string): string {
  const normalizedName = appName.replace(/\s+\[DEV\]$/, '').trim() || 'Super CMS'
  return `xattr -cr /Applications/${normalizedName.replace(/ /g, '\\ ')}.app`
}

export function detectMacNativeArtifactGatekeeperIssue(
  options: DetectMacNativeArtifactGatekeeperIssueOptions = {}
): MacNativeArtifactGatekeeperIssue | null {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') return null

  const appName = options.appName ?? 'Super CMS'
  const candidateModules = options.candidateModules ?? DEFAULT_NATIVE_MODULE_CANDIDATES
  const loadModule = options.loadModule ?? ((moduleName: string) => nativeRequire(moduleName))

  for (const moduleName of candidateModules) {
    try {
      loadModule(moduleName)
    } catch (error) {
      const detail = stringifyError(error)
      if (isModuleNotFoundError(detail)) {
        continue
      }
      if (!GATEKEEPER_ERROR_PATTERNS.some((pattern) => pattern.test(detail))) {
        continue
      }
      return {
        moduleName,
        detail,
        command: buildMacNativeArtifactRepairCommand(appName)
      }
    }
  }

  return null
}

export async function promptForMacNativeArtifactRepair(
  options: PromptForMacNativeArtifactRepairOptions
): Promise<boolean> {
  const summary = summarizeError(options.issue.detail)
  const { response } = await options.showMessageBox({
    type: 'warning',
    title: '需要解除 macOS 安全限制',
    message: '检测到 macOS 安全限制，请在终端执行以下命令后重启应用：',
    detail: `${options.issue.command}\n\n触发模块：${options.issue.moduleName}\n错误摘要：${summary}`,
    buttons: ['复制命令', '稍后处理'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  })

  if (response !== 0) {
    return false
  }

  options.writeClipboardText(options.issue.command)
  return true
}

export type { MacNativeArtifactGatekeeperIssue }
