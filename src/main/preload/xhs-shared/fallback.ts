/**
 * fallback.ts — 自动化降级框架
 *
 * 当自动化选择器失效时，弹出 alert 提示用户手动操作，
 * 然后轮询等待用户操作完成。
 *
 * 扩展自 xhs-automation.ts 中 openDraftBoxAutoOrManual() 的 alert 模式。
 */

import { sleep } from './dom-helpers'

// ---------------------------------------------------------------------------
// 通用降级函数
// ---------------------------------------------------------------------------

export type FallbackOptions<T> = {
  /** 选择器 ID（用于日志） */
  selectorId: string
  /** 自动化尝试函数 */
  autoFn: () => Promise<T>
  /** 弹窗提示文案，null 表示不弹窗直接抛异常 */
  manualPrompt?: string | null
  /** 等待人工操作的超时（毫秒） */
  timeoutMs?: number
  /** 轮询间隔（毫秒） */
  intervalMs?: number
  /** 人工操作完成后的验证条件 */
  waitCondition?: () => T | null | undefined
}

/**
 * 先尝试自动化，失败后降级到人工操作。
 *
 * 流程：autoFn() → 失败 → alert 提示 → 轮询 waitCondition → 超时则抛异常
 */
export async function withFallback<T>(options: FallbackOptions<T>): Promise<T> {
  const {
    selectorId,
    autoFn,
    manualPrompt = null,
    timeoutMs = 120_000,
    intervalMs = 500,
    waitCondition
  } = options

  // 1. 先尝试自动化
  try {
    const result = await autoFn()
    return result
  } catch (autoError) {
    console.log(`[Fallback] 自动化失败 (${selectorId}):`, autoError instanceof Error ? autoError.message : String(autoError))

    // 2. 如果没有人工降级配置，直接抛
    if (!manualPrompt || !waitCondition) {
      throw autoError
    }

    // 3. 弹窗提示用户手动操作
    try {
      window.alert(`🤖 Lyra: ${manualPrompt}`)
    } catch {
      // alert 可能被阻止
    }

    // 4. 轮询等待用户操作完成
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const result = waitCondition()
        if (result !== null && result !== undefined) {
          console.log(`[Fallback] 人工操作完成 (${selectorId})`)
          return result
        }
      } catch {
        // 静默
      }
      await sleep(intervalMs)
    }

    throw new Error(`[Fallback] 超时：${selectorId} 未完成人工操作（${Math.round(timeoutMs / 1000)}s）`)
  }
}
