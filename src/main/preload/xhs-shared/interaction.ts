/**
 * interaction.ts — 完整的浏览器事件链模拟
 *
 * 替代原有 SyncHumanizer / Humanizer 的简单 3 事件点击，
 * 提供完整的 mouseenter → mouseover → mousemove(轨迹) → mousedown → mouseup → click 序列，
 * 以及渐进式滚动和高斯分布延迟。
 */

// ---------------------------------------------------------------------------
// 高斯分布随机数 (Box-Muller 变换)
// ---------------------------------------------------------------------------

function gaussianRandom(mean: number, stddev: number): number {
  const u1 = Math.random() || 0.0001
  const u2 = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return mean + z * stddev
}

/**
 * 生成 [min, max] 范围内的高斯随机延迟（毫秒）
 * 均值在区间中点，标准差约为区间宽度的 1/4
 */
export function gaussianDelay(min: number, max: number): number {
  const lo = Math.max(0, Math.floor(min))
  const hi = Math.max(lo, Math.floor(max))
  if (hi <= lo) return lo
  const mean = (lo + hi) / 2
  const stddev = (hi - lo) / 4
  const value = Math.round(gaussianRandom(mean, stddev))
  return Math.max(lo, Math.min(hi, value))
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(ms))))
}

// ---------------------------------------------------------------------------
// 鼠标位置追踪
// ---------------------------------------------------------------------------

let lastMouseX = 0
let lastMouseY = 0

function updateLastMousePosition(x: number, y: number): void {
  lastMouseX = x
  lastMouseY = y
}

// ---------------------------------------------------------------------------
// Bezier 曲线鼠标路径
// ---------------------------------------------------------------------------

type Point = { x: number; y: number }

/**
 * 三次 Bezier 曲线插值
 */
function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  const uuu = uu * u
  const ttt = tt * t
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  }
}

/**
 * 生成从 start 到 end 的鼠标移动路径点
 * 使用随机控制点的 Bezier 曲线模拟真实鼠标轨迹
 */
function generateMousePath(start: Point, end: Point, steps: number): Point[] {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  // 控制点偏移量与距离成正比，但有上限
  const offset = Math.min(dist * 0.3, 80)

  const cp1: Point = {
    x: start.x + dx * 0.25 + (Math.random() - 0.5) * offset,
    y: start.y + dy * 0.25 + (Math.random() - 0.5) * offset
  }
  const cp2: Point = {
    x: start.x + dx * 0.75 + (Math.random() - 0.5) * offset,
    y: start.y + dy * 0.75 + (Math.random() - 0.5) * offset
  }

  const points: Point[] = []
  const actualSteps = Math.max(3, steps)
  for (let i = 1; i <= actualSteps; i++) {
    const t = i / actualSteps
    const p = cubicBezier(start, cp1, cp2, end, t)
    // 添加微小抖动
    points.push({
      x: p.x + (Math.random() - 0.5) * 2,
      y: p.y + (Math.random() - 0.5) * 2
    })
  }

  return points
}

// ---------------------------------------------------------------------------
// 事件分发工具
// ---------------------------------------------------------------------------

function dispatchMouse(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  extra?: Partial<MouseEventInit>
): void {
  try {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x + (window.screenX || 0),
        screenY: y + (window.screenY || 0),
        button: 0,
        buttons: type === 'mousedown' || type === 'mousemove' ? 1 : 0,
        ...extra
      })
    )
  } catch {
    // 静默
  }
}

// ---------------------------------------------------------------------------
// simulateClick — 完整的点击事件链
// ---------------------------------------------------------------------------

export type ClickOptions = {
  /** 点击前高亮颜色 (CSS outline)，null 表示不高亮 */
  highlightColor?: string | null
  /** 点击前延迟范围 [min, max] ms */
  preDelayRange?: [number, number]
  /** 鼠标移动步数（距离越远步数越多） */
  moveSteps?: number
  /** 是否输出日志 */
  log?: boolean
  /** 日志描述 */
  description?: string
}

const DEFAULT_CLICK_OPTIONS: Required<ClickOptions> = {
  highlightColor: '#ef4444',
  preDelayRange: [400, 1200],
  moveSteps: 0, // 0 = auto
  log: true,
  description: ''
}

export async function simulateClick(
  element: HTMLElement,
  options?: ClickOptions
): Promise<void> {
  if (!(element instanceof HTMLElement)) return

  const opts = { ...DEFAULT_CLICK_OPTIONS, ...options }
  const desc = opts.description || describeElementBrief(element)

  if (opts.log) {
    console.log(`[Interaction] 准备点击：${desc}`)
  }

  // 1. 高亮目标（可选）
  let restoreStyle: (() => void) | null = null
  if (opts.highlightColor) {
    const prevOutline = element.style.outline
    const prevZIndex = element.style.zIndex
    try {
      element.style.outline = `3px solid ${opts.highlightColor}`
      element.style.zIndex = '99999'
    } catch {
      // 静默
    }
    restoreStyle = () => {
      try {
        element.style.outline = prevOutline
        element.style.zIndex = prevZIndex
      } catch {
        // 静默
      }
    }
  }

  // 2. 等待（高斯分布）
  const preDelay = gaussianDelay(opts.preDelayRange[0], opts.preDelayRange[1])
  await sleep(preDelay)

  // 3. 计算目标位置（中心 + 随机偏移）
  const rect = element.getBoundingClientRect()
  const targetX = rect.left + rect.width / 2 + (Math.random() * 8 - 4)
  const targetY = rect.top + rect.height / 2 + (Math.random() * 8 - 4)

  // 4. 鼠标移动轨迹
  const dist = Math.sqrt(
    Math.pow(targetX - lastMouseX, 2) + Math.pow(targetY - lastMouseY, 2)
  )
  const steps = opts.moveSteps > 0
    ? opts.moveSteps
    : Math.max(4, Math.min(20, Math.round(dist / 50)))

  const path = generateMousePath(
    { x: lastMouseX, y: lastMouseY },
    { x: targetX, y: targetY },
    steps
  )

  // mouseenter + mouseover 在进入元素时触发
  dispatchMouse(element, 'mouseenter', path[0]?.x ?? targetX, path[0]?.y ?? targetY)
  dispatchMouse(element, 'mouseover', path[0]?.x ?? targetX, path[0]?.y ?? targetY)

  // mousemove 沿路径
  for (const point of path) {
    dispatchMouse(element, 'mousemove', point.x, point.y)
    await sleep(gaussianDelay(8, 25))
  }

  updateLastMousePosition(targetX, targetY)

  // 5. mousedown → 短暂延迟 → mouseup → click
  dispatchMouse(element, 'mousedown', targetX, targetY)
  await sleep(gaussianDelay(30, 80))
  dispatchMouse(element, 'mouseup', targetX, targetY)
  await sleep(gaussianDelay(5, 15))
  dispatchMouse(element, 'click', targetX, targetY)

  // 6. 恢复样式
  if (restoreStyle) {
    restoreStyle()
  }
}

// ---------------------------------------------------------------------------
// simulateScroll — 渐进式滚动
// ---------------------------------------------------------------------------

export type ScrollOptions = {
  /** 滚动方向 */
  direction?: 'down' | 'up'
  /** 目标滚动位置（绝对值），null 表示滚到底/顶 */
  targetPosition?: number | null
  /** 滚动步数 */
  steps?: number
  /** 每步之间的延迟范围 [min, max] ms */
  stepDelay?: [number, number]
}

export async function simulateScroll(
  container?: HTMLElement | null,
  options?: ScrollOptions
): Promise<void> {
  const opts = {
    direction: 'down' as const,
    targetPosition: null as number | null,
    steps: 6,
    stepDelay: [60, 180] as [number, number],
    ...options
  }

  const scrollEl = container || document.scrollingElement || document.documentElement
  if (!scrollEl) return

  const currentTop = scrollEl.scrollTop
  const maxScroll = scrollEl.scrollHeight - (scrollEl instanceof HTMLElement ? scrollEl.clientHeight : window.innerHeight)

  let target: number
  if (opts.targetPosition !== null) {
    target = Math.max(0, Math.min(maxScroll, opts.targetPosition))
  } else {
    target = opts.direction === 'down' ? maxScroll : 0
  }

  const totalDelta = target - currentTop
  if (Math.abs(totalDelta) < 5) return

  const steps = Math.max(3, opts.steps)
  const stepSize = totalDelta / steps

  for (let i = 1; i <= steps; i++) {
    const nextTop = i === steps ? target : currentTop + stepSize * i
    const deltaY = i === steps ? (target - scrollEl.scrollTop) : stepSize

    // dispatch wheel 事件
    try {
      const wheelTarget = container || document
      wheelTarget.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: deltaY,
          deltaMode: 0 // DOM_DELTA_PIXEL
        })
      )
    } catch {
      // 静默
    }

    // 实际滚动
    scrollEl.scrollTop = nextTop

    await sleep(gaussianDelay(opts.stepDelay[0], opts.stepDelay[1]))
  }
}

/**
 * 滚动到底部（替代 scrollPageToBottom）
 */
export async function scrollToBottom(
  container?: HTMLElement | null,
  retries = 3
): Promise<void> {
  for (let i = 0; i < retries; i++) {
    await simulateScroll(container, { direction: 'down', steps: 5 + Math.floor(Math.random() * 4) })
    await sleep(gaussianDelay(200, 600))
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function describeElementBrief(el: HTMLElement): string {
  const tag = el.tagName?.toLowerCase() || '?'
  const cls = typeof el.className === 'string' ? el.className.slice(0, 40) : ''
  const text = (el.innerText || el.textContent || '').slice(0, 20).trim()
  return `<${tag}${cls ? ` class="${cls}"` : ''}>${text ? ` "${text}"` : ''}`
}
