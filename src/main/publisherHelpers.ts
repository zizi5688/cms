export type PublishWindowPreferences = {
  partitionKey: string
  preload: string
  showWindow?: boolean
}

export type PublishDebugState = {
  visual: boolean
  keepWindowOpen: boolean
  openDevTools: boolean
}

export type PublishNotificationPhase = 'start' | 'finish'

export type PublishNotificationInput = {
  phase: PublishNotificationPhase
  accountName?: string
  taskTitle?: string
  success?: boolean
  error?: string
}

export function shouldHidePublishWindowAfterNativeDialog(input: {
  debugState: PublishDebugState
  wasVisibleBeforeDialog: boolean
}): boolean {
  if (input.debugState.visual) return input.wasVisibleBeforeDialog === false
  return true
}

function normalizeSingleLine(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function normalizeMultiline(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  return normalized || fallback
}

function parseOptionalBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null
  const raw = value.trim().toLowerCase()
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return null
}

export function readPublishDebugState(env: NodeJS.ProcessEnv = process.env): PublishDebugState {
  return {
    visual: parseOptionalBool(env.CMS_PUBLISH_VISUAL) ?? false,
    keepWindowOpen: parseOptionalBool(env.CMS_PUBLISH_KEEP_OPEN) ?? false,
    openDevTools: parseOptionalBool(env.CMS_PUBLISH_OPEN_DEVTOOLS) ?? false
  }
}

export function buildPublishWorkerWindowOptions(
  input: PublishWindowPreferences
): {
  width: number
  height: number
  show: boolean
  autoHideMenuBar: boolean
  webPreferences: {
    partition: string
    preload: string
    sandbox: boolean
    nodeIntegration: boolean
    contextIsolation: boolean
    backgroundThrottling: boolean
  }
} {
  return {
    width: 1200,
    height: 900,
    show: input.showWindow === true,
    autoHideMenuBar: true,
    webPreferences: {
      partition: input.partitionKey,
      preload: input.preload,
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  }
}

export function buildPublishNotificationPayload(input: PublishNotificationInput): {
  title: string
  body: string
} {
  const accountName = normalizeSingleLine(input.accountName, '小红书账号')
  const taskTitle = normalizeMultiline(input.taskTitle, '未命名任务')
  if (input.phase === 'start') {
    return {
      title: `开始执行：${accountName}`,
      body: taskTitle
    }
  }

  const success = input.success !== false
  const error = normalizeMultiline(input.error, '')
  const body = !success && error ? `${taskTitle}\n${error}` : taskTitle
  return {
    title: `${success ? '执行完成' : '执行失败'}：${accountName}`,
    body
  }
}
