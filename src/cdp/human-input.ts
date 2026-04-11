export type MousePoint = {
  x: number
  y: number
}

export type MouseState = {
  x: number
  y: number
}

export type HumanMoveSegment = 'main' | 'correction'

export type HumanMoveSample = {
  x: number
  y: number
  waitMs: number
  phase: number
  segment: HumanMoveSegment
  jitterX: number
  jitterY: number
}

export type HumanMovePlan = {
  from: MousePoint
  to: MousePoint
  totalDistance: number
  hadOvershoot: boolean
  samples: HumanMoveSample[]
}

export type HumanMoveDispatchEvent = HumanMoveSample & {
  index: number
  timestamp: number
}

export type HumanMoveOptions = {
  onPlan?: (plan: HumanMovePlan) => void
  onDispatched?: (event: HumanMoveDispatchEvent) => void
}

export type HumanClickOptions = {
  move?: HumanMoveOptions
}

function distance(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.hypot(toX - fromX, toY - fromY)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min))
}

function randomSignedBetween(min: number, max: number): number {
  const magnitude = randomBetween(min, max)
  return Math.random() < 0.5 ? -magnitude : magnitude
}

function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const oneMinusT = 1 - t
  return (
    oneMinusT ** 3 * p0 +
    3 * oneMinusT ** 2 * t * p1 +
    3 * oneMinusT * t ** 2 * p2 +
    t ** 3 * p3
  )
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function easeSlowFastSlow(t: number): number {
  const clamped = clamp(t, 0, 1)
  return 0.5 - Math.cos(Math.PI * clamped) / 2
}

function shouldApplyJitter(): boolean {
  return Math.random() < 0.45
}

function samplePhaseWaitMs(phase: number): number {
  if (phase <= 0.22 || phase >= 0.78) {
    return randomBetween(8, 12)
  }
  return randomBetween(14, 20)
}

export function sampleStepCount(totalDistance: number): number {
  if (totalDistance < 8) {
    return 18
  }
  if (totalDistance < 25) {
    return 18
  }
  if (totalDistance <= 120) {
    return clamp(Math.round(totalDistance / 4), 18, 30)
  }
  return clamp(Math.round(totalDistance / 6), 24, 48)
}

function buildBezierSegment(input: {
  from: MousePoint
  to: MousePoint
  steps: number
  segment: HumanMoveSegment
  spreadScale?: number
}): HumanMoveSample[] {
  const totalDistance = distance(input.from.x, input.from.y, input.to.x, input.to.y)
  const steps = Math.max(2, input.steps)
  const dx = input.to.x - input.from.x
  const dy = input.to.y - input.from.y
  const normalLength = Math.max(totalDistance, 1)
  const normalX = -dy / normalLength
  const normalY = dx / normalLength
  const spreadScale = input.spreadScale ?? 1
  const spread = Math.max(16, Math.min(96, totalDistance * 0.24)) * spreadScale
  const control1Offset = spread * (Math.random() * 2 - 1)
  const control2Offset = spread * (Math.random() * 2 - 1)
  const control1T = 0.2 + Math.random() * 0.18
  const control2T = 0.62 + Math.random() * 0.18

  const control1 = {
    x: input.from.x + dx * control1T + normalX * control1Offset,
    y: input.from.y + dy * control1T + normalY * control1Offset
  }
  const control2 = {
    x: input.from.x + dx * control2T + normalX * control2Offset,
    y: input.from.y + dy * control2T + normalY * control2Offset
  }

  const path: HumanMoveSample[] = []
  for (let index = 0; index < steps; index += 1) {
    const linearT = steps === 1 ? 1 : index / (steps - 1)
    const easedT = easeSlowFastSlow(linearT)
    const isBoundaryPoint = index === 0 || index === steps - 1
    const jitterX = isBoundaryPoint || !shouldApplyJitter() ? 0 : randomSignedBetween(1, 2)
    const jitterY = isBoundaryPoint || !shouldApplyJitter() ? 0 : randomSignedBetween(1, 2)
    path.push({
      x: cubicBezier(input.from.x, control1.x, control2.x, input.to.x, easedT) + jitterX,
      y: cubicBezier(input.from.y, control1.y, control2.y, input.to.y, easedT) + jitterY,
      waitMs: 0,
      phase: 0,
      segment: input.segment,
      jitterX,
      jitterY
    })
  }

  path[0] = { ...path[0], x: input.from.x, y: input.from.y, jitterX: 0, jitterY: 0 }
  path[path.length - 1] = {
    ...path[path.length - 1],
    x: input.to.x,
    y: input.to.y,
    jitterX: 0,
    jitterY: 0
  }
  return path
}

export function buildHumanMovePlan(input: {
  fromX: number
  fromY: number
  toX: number
  toY: number
}): HumanMovePlan {
  const from = { x: input.fromX, y: input.fromY }
  const to = { x: input.toX, y: input.toY }
  const totalDistance = distance(from.x, from.y, to.x, to.y)
  const hasMeaningfulDistance = totalDistance >= 1
  const canOvershoot = totalDistance >= 8
  const shouldOvershoot = hasMeaningfulDistance && canOvershoot && Math.random() < 0.1

  let samples: HumanMoveSample[]

  if (!hasMeaningfulDistance) {
    samples = [
      {
        x: to.x,
        y: to.y,
        waitMs: 0,
        phase: 1,
        segment: 'main',
        jitterX: 0,
        jitterY: 0
      }
    ]
  } else if (shouldOvershoot) {
    const unitX = (to.x - from.x) / Math.max(totalDistance, 1)
    const unitY = (to.y - from.y) / Math.max(totalDistance, 1)
    const normalX = -unitY
    const normalY = unitX
    const overshootDistance = clamp(Math.round(totalDistance * 0.06), 4, 18)
    const sideDrift = randomSignedBetween(1, 4)
    const overshootTarget: MousePoint = {
      x: to.x + unitX * overshootDistance + normalX * sideDrift,
      y: to.y + unitY * overshootDistance + normalY * sideDrift
    }

    const mainSteps = sampleStepCount(totalDistance + overshootDistance)
    const correctionSteps = clamp(Math.round(overshootDistance * 1.5), 6, 14)
    const mainPath = buildBezierSegment({
      from,
      to: overshootTarget,
      steps: mainSteps,
      segment: 'main'
    })
    const correctionPath = buildBezierSegment({
      from: overshootTarget,
      to,
      steps: correctionSteps,
      segment: 'correction',
      spreadScale: 0.45
    })
    samples = [...mainPath, ...correctionPath.slice(1)]
  } else {
    const mainSteps = sampleStepCount(totalDistance)
    samples = buildBezierSegment({
      from,
      to,
      steps: mainSteps,
      segment: 'main'
    })
  }

  const finalized = samples.map((sample, index) => {
    const phase = samples.length <= 1 ? 1 : index / (samples.length - 1)
    const waitMs = index === samples.length - 1 ? 0 : samplePhaseWaitMs(phase)
    return {
      ...sample,
      phase,
      waitMs
    }
  })

  if (finalized.length > 0) {
    finalized[0] = { ...finalized[0], x: from.x, y: from.y, jitterX: 0, jitterY: 0 }
    finalized[finalized.length - 1] = {
      ...finalized[finalized.length - 1],
      x: to.x,
      y: to.y,
      jitterX: 0,
      jitterY: 0,
      waitMs: 0
    }
  }

  return {
    from,
    to,
    totalDistance,
    hadOvershoot: shouldOvershoot,
    samples: finalized
  }
}

export function buildMousePath(input: {
  fromX: number
  fromY: number
  toX: number
  toY: number
}): MousePoint[] {
  return buildHumanMovePlan(input).samples.map((sample) => ({ x: sample.x, y: sample.y }))
}

export async function humanMove(
  client: import('puppeteer').CDPSession,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  options: HumanMoveOptions = {}
): Promise<MouseState> {
  const plan = buildHumanMovePlan({ fromX, fromY, toX, toY })
  options.onPlan?.(plan)

  for (let index = 0; index < plan.samples.length; index += 1) {
    const sample = plan.samples[index]

    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: sample.x,
      y: sample.y
    })
    options.onDispatched?.({
      ...sample,
      x: sample.x,
      y: sample.y,
      index,
      timestamp: Date.now()
    })
    if (sample.waitMs > 0) {
      await delay(sample.waitMs)
    }
  }

  return { x: toX, y: toY }
}

export async function humanClick(
  client: import('puppeteer').CDPSession,
  mouse: MouseState,
  targetX: number,
  targetY: number,
  options: HumanClickOptions = {}
): Promise<MouseState> {
  const nextMouse = await humanMove(client, mouse.x, mouse.y, targetX, targetY, options.move)
  await delay(randomBetween(48, 96))
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: nextMouse.x,
    y: nextMouse.y,
    button: 'left',
    clickCount: 1
  })
  await delay(randomBetween(22, 40))
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: nextMouse.x,
    y: nextMouse.y,
    button: 'left',
    clickCount: 1
  })
  return nextMouse
}

export async function humanType(
  client: import('puppeteer').CDPSession,
  text: string
): Promise<void> {
  await client.send('Input.insertText', { text })
}
