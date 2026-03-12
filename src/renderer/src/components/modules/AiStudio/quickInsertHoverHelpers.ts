import type { HoverPoint, HoverRect } from './hoverIntentHelpers'

function triangleArea(a: HoverPoint, b: HoverPoint, c: HoverPoint): number {
  return Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2)
}

function isPointInTriangle(
  point: HoverPoint,
  a: HoverPoint,
  b: HoverPoint,
  c: HoverPoint
): boolean {
  const totalArea = triangleArea(a, b, c)
  if (totalArea === 0) return false

  const area1 = triangleArea(point, b, c)
  const area2 = triangleArea(a, point, c)
  const area3 = triangleArea(a, b, point)

  return Math.abs(totalArea - (area1 + area2 + area3)) < 0.5
}

export function shouldKeepCurrentQuickInsertPreview(params: {
  currentPreviewKey: string | null
  nextPreviewKey: string | null
  previousPoint: HoverPoint | null
  currentPoint: HoverPoint | null
  submenuRect: HoverRect | null
}): boolean {
  const { currentPreviewKey, nextPreviewKey, previousPoint, currentPoint, submenuRect } = params

  if (!currentPreviewKey || !nextPreviewKey) return false
  if (currentPreviewKey === nextPreviewKey) return false
  if (!previousPoint || !currentPoint || !submenuRect) return false
  if (currentPoint.x <= previousPoint.x) return false

  return isPointInTriangle(
    currentPoint,
    previousPoint,
    { x: submenuRect.left, y: submenuRect.top },
    { x: submenuRect.left, y: submenuRect.bottom }
  )
}
