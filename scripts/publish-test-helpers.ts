export type TrustedEventRecord = {
  type: string
  isTrusted: boolean
  target?: string
  timestamp?: number
  x?: number
  y?: number
}

export type MouseInteractionMetrics = {
  clickIndex: number
  moveCountBeforeClick: number
  pathCurved: boolean
  timingVaried: boolean
  trusted: boolean
  maxDeviation: number
  intervalSpread: number
}

export type MouseQualitySummary = {
  ok: boolean
  reason: string
  interactions: MouseInteractionMetrics[]
}

export function validateTrustedMouseEvents(events: TrustedEventRecord[]): {
  ok: boolean
  reason: string
} {
  const requiredTypes = ['mousedown', 'click']

  for (const type of requiredTypes) {
    const matching = events.filter((event) => event.type === type)
    if (matching.length === 0) {
      return {
        ok: false,
        reason: `缺少 ${type} 事件记录`
      }
    }

    if (matching.some((event) => !event.isTrusted)) {
      return {
        ok: false,
        reason: `${type} 事件存在 isTrusted=false`
      }
    }
  }

  return {
    ok: true,
    reason: 'mousedown 和 click 事件均为 trusted'
  }
}

function deviationFromLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x0: number,
  y0: number
): number {
  const numerator = Math.abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
  const denominator = Math.hypot(y2 - y1, x2 - x1)
  return denominator === 0 ? 0 : numerator / denominator
}

export function analyzeMouseInteractionQuality(events: TrustedEventRecord[]): MouseQualitySummary {
  const interactions: MouseInteractionMetrics[] = []
  let segmentStart = 0

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.type !== 'click') continue

    const segment = events.slice(segmentStart, index + 1)
    segmentStart = index + 1
    const moves = segment.filter(
      (item) =>
        item.type === 'mousemove' &&
        typeof item.x === 'number' &&
        typeof item.y === 'number' &&
        typeof item.timestamp === 'number'
    )
    const clicks = segment.filter((item) => item.type === 'mousedown' || item.type === 'click')
    const trusted = clicks.every((item) => item.isTrusted)

    let maxDeviation = 0
    if (moves.length >= 3) {
      const first = moves[0]
      const last = moves[moves.length - 1]
      for (const point of moves.slice(1, -1)) {
        maxDeviation = Math.max(
          maxDeviation,
          deviationFromLine(first.x!, first.y!, last.x!, last.y!, point.x!, point.y!)
        )
      }
    }

    const intervals: number[] = []
    for (let moveIndex = 1; moveIndex < moves.length; moveIndex += 1) {
      intervals.push(Math.max(0, moves[moveIndex].timestamp! - moves[moveIndex - 1].timestamp!))
    }
    const intervalSpread = intervals.length > 0 ? Math.max(...intervals) - Math.min(...intervals) : 0

    interactions.push({
      clickIndex: interactions.length,
      moveCountBeforeClick: moves.length,
      pathCurved: maxDeviation >= 1,
      timingVaried: intervalSpread >= 2,
      trusted,
      maxDeviation: Number(maxDeviation.toFixed(2)),
      intervalSpread
    })
  }

  if (interactions.length === 0) {
    return {
      ok: false,
      reason: '未捕获到 click 交互片段',
      interactions
    }
  }

  const failing = interactions.find(
    (interaction) =>
      interaction.moveCountBeforeClick < 15 ||
      !interaction.pathCurved ||
      !interaction.timingVaried ||
      !interaction.trusted
  )

  if (failing) {
    return {
      ok: false,
      reason: `点击片段 ${failing.clickIndex + 1} 未达标：move=${failing.moveCountBeforeClick}, curved=${failing.pathCurved}, varied=${failing.timingVaried}, trusted=${failing.trusted}`,
      interactions
    }
  }

  return {
    ok: true,
    reason: '所有点击片段均满足 move 数、曲率、时间差异和 trusted 要求',
    interactions
  }
}

export function summarizePublishResult(input: {
  titleFilled: boolean
  bodyFilled: boolean
  videoUploaded: boolean
  trustedEventsOk: boolean
}): string {
  return [
    `标题: ${input.titleFilled ? '成功' : '失败'}`,
    `正文: ${input.bodyFilled ? '成功' : '失败'}`,
    `视频: ${input.videoUploaded ? '成功' : '失败'}`,
    `isTrusted: ${input.trustedEventsOk ? '通过' : '失败'}`
  ].join('\n')
}
