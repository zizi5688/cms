/**
 * dom-helpers.ts — 共享 DOM 工具函数
 *
 * 从 xhs-automation.ts 和 xhs-product-sync.js 中提取的公共工具函数，
 * 避免两个文件各自维护一份相同的实现。
 */

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))))
}

export function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// 可见性检测
// ---------------------------------------------------------------------------

export function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false
  if (!(el instanceof HTMLElement)) return false
  const style = window.getComputedStyle(el)
  if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

export function isVisibleForWait(el: Element | null | undefined): el is HTMLElement {
  if (!isVisible(el)) return false
  return (el as HTMLElement).offsetParent !== null
}

// ---------------------------------------------------------------------------
// 轮询等待
// ---------------------------------------------------------------------------

export type WaitForOptions = {
  timeoutMs?: number
  intervalMs?: number
  timeoutMessage?: string
}

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  { timeoutMs = 20_000, intervalMs = 250, timeoutMessage = '超时' }: WaitForOptions = {}
): Promise<NonNullable<T>> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value as NonNullable<T>
    } catch (error) {
      void error
    }
    await sleep(intervalMs)
  }
  throw new Error(timeoutMessage)
}

// ---------------------------------------------------------------------------
// 元素查找
// ---------------------------------------------------------------------------

export function queryFirstVisible<T extends Element>(selector: string): T | null {
  try {
    const nodes = Array.from(document.querySelectorAll(selector))
    return (nodes.find((n) => isVisible(n)) as T | undefined) || null
  } catch (error) {
    void error
    return null
  }
}

export function findByText(
  text: string,
  { selector = 'div, span, button, a', match = 'exact' }: { selector?: string; match?: 'exact' | 'contains' } = {}
): HTMLElement | null {
  const wanted = normalizeText(text)
  if (!wanted) return null

  const nodes = Array.from(document.querySelectorAll(selector)).filter((el): el is HTMLElement => isVisible(el))
  for (const el of nodes) {
    const candidate = normalizeText(el.innerText || el.textContent || '')
    if (!candidate) continue
    if (match === 'exact' && candidate === wanted) return el
    if (match === 'contains' && candidate.includes(wanted)) return el
  }
  return null
}

function getHtmlLength(el: Element): number {
  try {
    const html = typeof (el as HTMLElement).innerHTML === 'string' ? (el as HTMLElement).innerHTML : ''
    return html.length
  } catch (error) {
    void error
    return Number.POSITIVE_INFINITY
  }
}

export function findLeafByTextIncludes(keyword: string, root?: ParentNode | null): HTMLElement | null {
  const wanted = normalizeText(keyword)
  if (!wanted) return null

  const base = root || document.body

  let allCandidates: Element[] = []
  try {
    allCandidates = Array.from(base.querySelectorAll('*'))
  } catch (error) {
    void error
  }

  const matched: HTMLElement[] = []
  for (const el of allCandidates) {
    if (!(el instanceof HTMLElement)) continue
    if (!isVisibleForWait(el)) continue
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (!text.includes(wanted)) continue
    matched.push(el)
  }

  if (matched.length === 0) return null

  matched.sort((a, b) => {
    const al = getHtmlLength(a)
    const bl = getHtmlLength(b)
    if (al !== bl) return al - bl
    const ac = a.querySelectorAll ? a.querySelectorAll('*').length : 0
    const bc = b.querySelectorAll ? b.querySelectorAll('*').length : 0
    if (ac !== bc) return ac - bc
    return 0
  })

  const target = matched[0] || null
  if (!target) return null
  if (!isVisibleForWait(target)) return null
  return target
}

// ---------------------------------------------------------------------------
// Modal / Dialog 检测
// ---------------------------------------------------------------------------

export function getModalRoot(fromEl: Element | null): HTMLElement | null {
  if (!fromEl) return null
  const candidates = [
    fromEl.closest?.('[role="dialog"]') ?? null,
    fromEl.closest?.('[class*="modal"]') ?? null,
    fromEl.closest?.('[class*="Modal"]') ?? null,
    fromEl.closest?.('[class*="Dialog"]') ?? null
  ].filter(Boolean)
  return (candidates[0] as HTMLElement | null) ?? null
}

export function findTopMostVisibleModal(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')
  ).filter((el) => isVisible(el)) as HTMLElement[]
  if (dialogs.length === 0) return null

  let best = dialogs[0]
  let bestZ = Number.NEGATIVE_INFINITY
  for (const el of dialogs) {
    const z = Number.parseInt(window.getComputedStyle(el).zIndex || '0', 10)
    const zValue = Number.isFinite(z) ? z : 0
    if (zValue >= bestZ) {
      bestZ = zValue
      best = el
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 元素描述（用于日志）
// ---------------------------------------------------------------------------

export function describeElement(el: HTMLElement | null | undefined): Record<string, unknown> | null {
  if (!el) return null
  const text = normalizeText(el.innerText || el.textContent || '')
  const out: Record<string, unknown> = {
    tag: el.tagName.toLowerCase(),
    text: text ? text.slice(0, 200) : ''
  }
  const className = typeof el.className === 'string' ? el.className : ''
  if (className) out.className = className.slice(0, 200)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const placeholder = el.getAttribute('placeholder') || ''
    const ariaLabel = el.getAttribute('aria-label') || ''
    if (placeholder) out.placeholder = placeholder
    if (ariaLabel) out.ariaLabel = ariaLabel
  }
  return out
}

export function getElementLabel(el: Element | null): { tagName: string; className: string; text: string } {
  const tagName = String(el?.tagName || '')
  const className = typeof (el as HTMLElement)?.className === 'string' ? (el as HTMLElement).className : ''
  const text = normalizeText((el as HTMLElement)?.innerText || el?.textContent || '')
  return { tagName, className, text }
}
