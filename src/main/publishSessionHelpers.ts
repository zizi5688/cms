export type PublishSessionMediaType = 'image' | 'video'

export type PublishSessionStepKey = 'prepare' | 'upload' | 'cover' | 'content' | 'publish'

export type PublishSessionStepState = 'pending' | 'active' | 'done' | 'error'

export type PublishSessionStatus = 'running' | 'succeeded' | 'failed'

export type PublishSessionStep = {
  key: PublishSessionStepKey
  label: string
  state: PublishSessionStepState
}

export type PublishSessionSnapshot = {
  sessionId: string
  queueTaskId?: string
  accountId: string
  accountName: string
  taskTitle: string
  mediaType: PublishSessionMediaType
  status: PublishSessionStatus
  steps: PublishSessionStep[]
  message: string
  error?: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
}

type PublishSessionStepDefinition = {
  key: PublishSessionStepKey
  label: string
}

type PublishStageUpdate = {
  stageKey: PublishSessionStepKey
  state: Extract<PublishSessionStepState, 'active' | 'done' | 'error'>
  message: string
}

const IMAGE_STEPS: PublishSessionStepDefinition[] = [
  { key: 'prepare', label: '准备发布环境' },
  { key: 'upload', label: '上传图文素材' },
  { key: 'content', label: '填写文案' },
  { key: 'publish', label: '提交发布' }
]

const VIDEO_STEPS: PublishSessionStepDefinition[] = [
  { key: 'prepare', label: '准备发布环境' },
  { key: 'upload', label: '上传视频' },
  { key: 'cover', label: '设置封面' },
  { key: 'content', label: '填写文案/挂车' },
  { key: 'publish', label: '提交发布' }
]

function getStepDefinitions(mediaType: PublishSessionMediaType): PublishSessionStepDefinition[] {
  return mediaType === 'video' ? VIDEO_STEPS : IMAGE_STEPS
}

function getStageLabel(mediaType: PublishSessionMediaType, stageKey: PublishSessionStepKey): string {
  const found = getStepDefinitions(mediaType).find((step) => step.key === stageKey)
  if (found) return found.label
  return stageKey
}

function normalizeMessageLine(message: string): string {
  const firstLine = String(message ?? '').split('\n')[0]?.trim() ?? ''
  if (!firstLine) return ''
  return firstLine.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*\[[^\]]+\]\s*/, '').trim()
}

function stripInlineLogTag(value: string): string {
  return String(value ?? '').replace(/^\[[^\]]+\]\s*/, '').trim()
}

function stripDiagnosticSuffix(value: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  return normalized
    .replace(/\\n\{.*$/s, '')
    .replace(/\n\{.*$/s, '')
    .trim()
}

function resolveStageKey(stepName: string): PublishSessionStepKey {
  const normalized = String(stepName ?? '').trim()
  if (!normalized) return 'prepare'
  if (normalized.includes('上传视频封面')) return 'cover'
  if (normalized.includes('上传视频') || normalized.includes('图片上传')) return 'upload'
  if (normalized.includes('填写文案') || normalized.includes('填写标题') || normalized.includes('自动挂车')) {
    return 'content'
  }
  if (normalized.includes('发布前校验') || normalized.includes('点击发布')) return 'publish'
  if (normalized.includes('初始化') || normalized.includes('等待进入编辑界面')) return 'prepare'
  return 'prepare'
}

function buildStageMessage(
  mediaType: PublishSessionMediaType,
  stageKey: PublishSessionStepKey,
  state: PublishStageUpdate['state']
): string {
  const label = getStageLabel(mediaType, stageKey)
  if (state === 'done') {
    if (stageKey === 'publish') return '发布已提交'
    return `${label}已完成`
  }
  if (state === 'error') return `${label}失败`
  if (stageKey === 'publish') return '正在提交发布'
  return `正在${label}`
}

function buildStageDetailMessage(
  mediaType: PublishSessionMediaType,
  stageKey: PublishSessionStepKey,
  detail: string
): string {
  const label = getStageLabel(mediaType, stageKey)
  const normalizedDetail = String(detail ?? '').trim()
  if (!normalizedDetail) return `正在${label}`
  return `正在${label}（${normalizedDetail}）`
}

export function createPublishSessionSnapshot(input: {
  sessionId: string
  queueTaskId?: string
  accountId: string
  accountName: string
  taskTitle: string
  mediaType: PublishSessionMediaType
  startedAt?: number
}): PublishSessionSnapshot {
  const startedAt = Number.isFinite(input.startedAt) ? Math.floor(input.startedAt as number) : Date.now()
  const steps = getStepDefinitions(input.mediaType).map((step, index) => ({
    ...step,
    state: index === 0 ? ('active' as const) : ('pending' as const)
  }))
  return {
    sessionId: input.sessionId,
    queueTaskId: input.queueTaskId,
    accountId: input.accountId,
    accountName: input.accountName,
    taskTitle: input.taskTitle,
    mediaType: input.mediaType,
    status: 'running',
    steps,
    message: '正在准备发布环境',
    startedAt,
    updatedAt: startedAt
  }
}

export function applyPublishStageUpdate(
  snapshot: PublishSessionSnapshot,
  update: PublishStageUpdate
): PublishSessionSnapshot {
  const stageIndex = snapshot.steps.findIndex((step) => step.key === update.stageKey)
  if (stageIndex < 0) return snapshot

  const steps = snapshot.steps.map((step, index) => {
    if (index < stageIndex) return { ...step, state: 'done' as const }
    if (index > stageIndex) {
      return step.state === 'done' ? step : { ...step, state: 'pending' as const }
    }
    return { ...step, state: update.state }
  })

  return {
    ...snapshot,
    steps,
    message: update.message,
    updatedAt: Date.now()
  }
}

export function updatePublishSessionMessage(
  snapshot: PublishSessionSnapshot,
  message: string
): PublishSessionSnapshot {
  const normalized = String(message ?? '').trim()
  if (!normalized || normalized === snapshot.message) return snapshot
  return {
    ...snapshot,
    message: normalized,
    updatedAt: Date.now()
  }
}

export function completePublishSession(snapshot: PublishSessionSnapshot): PublishSessionSnapshot {
  const finishedAt = Date.now()
  return {
    ...snapshot,
    status: 'succeeded',
    steps: snapshot.steps.map((step) => ({ ...step, state: 'done' as const })),
    message: '发布完成',
    updatedAt: finishedAt,
    finishedAt
  }
}

export function failPublishSession(
  snapshot: PublishSessionSnapshot,
  failure: ReturnType<typeof buildPublishFailureSummary>
): PublishSessionSnapshot {
  const updated = applyPublishStageUpdate(snapshot, {
    stageKey: failure.stageKey,
    state: 'error',
    message: failure.message
  })
  const finishedAt = Date.now()
  return {
    ...updated,
    status: 'failed',
    error: failure.userMessage,
    message: failure.message,
    updatedAt: finishedAt,
    finishedAt
  }
}

export function derivePublishStageUpdate(
  message: string,
  mediaType: PublishSessionMediaType
): PublishStageUpdate | null {
  const line = normalizeMessageLine(message)
  if (!line) return null

  const productProgressMatch = /挂载商品\s+(\d+\/\d+)/.exec(line)
  if (productProgressMatch) {
    const progress = productProgressMatch[1] ?? ''
    return {
      stageKey: 'content',
      state: 'active',
      message: buildStageDetailMessage(mediaType, 'content', `挂载商品 ${progress}`)
    }
  }

  let matchedStep = ''
  let state: PublishStageUpdate['state'] | null = null

  if (line.startsWith('开始：')) {
    matchedStep = line.slice('开始：'.length).trim()
    state = 'active'
  } else if (line.startsWith('完成：')) {
    matchedStep = line.slice('完成：'.length).trim()
    state = 'done'
  } else {
    const failedMatch = /^\[XHS Automation\] StepFailed:\s*(.+?)\s*-\s*(.+)$/.exec(line)
    if (failedMatch) {
      matchedStep = failedMatch[1] ?? ''
      state = 'error'
    }
  }

  if (!matchedStep || !state) return null
  const stageKey = resolveStageKey(matchedStep)
  return {
    stageKey,
    state,
    message: buildStageMessage(mediaType, stageKey, state)
  }
}

export function derivePublishLiveMessage(
  message: string,
  mediaType: PublishSessionMediaType
): string | null {
  const line = normalizeMessageLine(message)
  if (!line) return null
  if (line.startsWith('开始：') || line.startsWith('完成：') || line.includes('StepFailed:')) return null

  const detail = stripInlineLogTag(line)
  if (!detail) return null

  const rules: Array<{ pattern: RegExp; resolve: (...args: string[]) => string }> = [
    {
      pattern: /^挂载商品\s+(\d+\/\d+)/,
      resolve: (progress) => buildStageDetailMessage(mediaType, 'content', `挂载商品 ${progress}`)
    },
    { pattern: /^正在尝试关闭可能遮挡的弹窗\/提示/, resolve: () => '正在处理页面弹窗' },
    { pattern: /^准备添加商品/, resolve: () => '正在准备挂车商品' },
    { pattern: /^正在打开“添加商品”弹窗/, resolve: () => '正在打开添加商品弹窗' },
    { pattern: /^弹窗已打开，等待列表初始化/, resolve: () => '正在加载商品列表' },
    { pattern: /^开始输入商品ID：/, resolve: () => '正在搜索商品' },
    { pattern: /^已输入 ID，等待搜索结果加载/, resolve: () => '正在等待商品搜索结果' },
    { pattern: /^选中第一个商品/, resolve: () => '正在勾选商品' },
    { pattern: /^已定位确认按钮，准备点击/, resolve: () => '正在确认挂车商品' },
    { pattern: /^商品添加流程结束/, resolve: () => '已完成一个挂车商品' },
    { pattern: /^准备点击：首个封面框/, resolve: () => '正在打开封面编辑' },
    { pattern: /^准备点击：封面弹窗确认按钮/, resolve: () => '正在确认封面' },
    {
      pattern: /^使用默认首帧，跳过手动设置封面/,
      resolve: () => buildStageDetailMessage(mediaType, 'cover', '默认首帧，跳过手动设置封面')
    },
    { pattern: /^正在点击发布按钮/, resolve: () => '正在提交发布' }
  ]

  for (const rule of rules) {
    const match = detail.match(rule.pattern)
    if (!match) continue
    return rule.resolve(...match.slice(1))
  }

  return null
}

export function buildPublishFailureSummary(
  message: string,
  mediaType: PublishSessionMediaType
): {
  stageKey: PublishSessionStepKey
  userMessage: string
  message: string
} {
  const line = normalizeMessageLine(message)
  const failedMatch = /^\[XHS Automation\] StepFailed:\s*(.+?)\s*-\s*(.+)$/.exec(line)
  if (failedMatch) {
    const rawStep = String(failedMatch[1] ?? '').trim()
    const rawReason = stripDiagnosticSuffix(String(failedMatch[2] ?? '').trim())
    const stageKey = resolveStageKey(rawStep)
    const label = getStageLabel(mediaType, stageKey)
    return {
      stageKey,
      userMessage: `${label}失败：${rawReason}`,
      message: `${label}失败`
    }
  }

  const normalized = line.replace(/^\[[^\]]+\]\s*/, '').trim() || '发布失败，请稍后重试。'
  const fallbackStageKey =
    normalized.includes('publishedAt') || normalized.includes('发布成功但未获取到')
      ? 'publish'
      : normalized.includes('未登录') || normalized.includes('登录态')
        ? 'prepare'
        : 'prepare'
  return {
    stageKey: fallbackStageKey,
    userMessage: normalized,
    message: '发布失败'
  }
}
