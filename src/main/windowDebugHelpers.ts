export type InspectableWindowSummary = {
  id: number
  title: string
  url: string
  visible: boolean
}

const DEFAULT_WINDOW_DEBUG_PORT = 4196

type BrowserWindowLike = {
  isDestroyed: () => boolean
  isVisible: () => boolean
  webContents?: {
    id?: number
    getTitle?: () => string
    getURL?: () => string
  } | null
}

type ReadOnlyValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

const FORBIDDEN_SCRIPT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(?:^|[^\w$.])(?:fetch|XMLHttpRequest|WebSocket)\s*\(/i, reason: '只允许只读调试脚本，禁止网络请求。' },
  { pattern: /\.\s*(?:click|submit|focus|blur|play|pause|remove|append|prepend|before|after|replaceWith|dispatchEvent|setAttribute|removeAttribute)\s*\(/i, reason: '只允许只读调试脚本，禁止触发 DOM 行为。' },
  { pattern: /(?:^|[^\w$.])(?:postMessage|alert|confirm|prompt|open)\s*\(/i, reason: '只允许只读调试脚本，禁止触发窗口副作用。' },
  { pattern: /\b(?:history\.(?:pushState|replaceState|back|forward|go)|location\.(?:assign|replace|reload))\s*\(/i, reason: '只允许只读调试脚本，禁止页面导航。' },
  { pattern: /(?:^|[^\w$.])(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear)\s*\(/i, reason: '只允许只读调试脚本，禁止改写存储。' },
  { pattern: /(?:^|[^\w$.])document\.(?:write|open|close)\s*\(/i, reason: '只允许只读调试脚本，禁止改写文档。' }
]

const FORBIDDEN_ASSIGNMENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\blocation\.(?:href|hash|search|pathname)\s*=(?!=)/i, reason: '只允许只读调试脚本，禁止修改 location。' },
  { pattern: /\bdocument\.(?:title|cookie)\s*=(?!=)/i, reason: '只允许只读调试脚本，禁止修改 document。' },
  { pattern: /\.\s*files\s*=(?!=)/i, reason: '只允许只读调试脚本，禁止写入文件输入框。' }
]

export function listInspectableWindows(windows: BrowserWindowLike[]): InspectableWindowSummary[] {
  return windows
    .filter((win) => win && typeof win.isDestroyed === 'function' && win.isDestroyed() === false)
    .map((win) => {
      const id = Number(win.webContents?.id ?? 0)
      if (!Number.isFinite(id) || id <= 0) return null
      const title = typeof win.webContents?.getTitle === 'function' ? String(win.webContents.getTitle() || '').trim() : ''
      const url = typeof win.webContents?.getURL === 'function' ? String(win.webContents.getURL() || '').trim() : ''
      return {
        id,
        title,
        url,
        visible: typeof win.isVisible === 'function' ? win.isVisible() : false
      } satisfies InspectableWindowSummary
    })
    .filter((item): item is InspectableWindowSummary => Boolean(item))
    .sort((a, b) => a.id - b.id)
}

export function validateReadOnlyWindowDebugScript(script: string): ReadOnlyValidationResult {
  const normalized = String(script ?? '').trim()
  if (!normalized) {
    return { ok: false, reason: '调试脚本不能为空。' }
  }

  for (const entry of FORBIDDEN_SCRIPT_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return { ok: false, reason: entry.reason }
    }
  }

  for (const entry of FORBIDDEN_ASSIGNMENT_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return { ok: false, reason: entry.reason }
    }
  }

  return { ok: true }
}

export function resolveWindowDebugPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.CMS_WINDOW_DEBUG_PORT ?? '').trim()
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_DEBUG_PORT
  const normalized = Math.floor(parsed)
  if (normalized < 1024 || normalized > 65535) return DEFAULT_WINDOW_DEBUG_PORT
  return normalized
}

export function normalizeWindowDebugFilePaths(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}
