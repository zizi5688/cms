function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function inferResolutionTier(width: number, height: number): string {
  const longestEdge = Math.max(width, height)
  if (longestEdge >= 1792) return '2K'
  if (longestEdge >= 896) return '1K'
  return ''
}

export function formatResolutionBadgeLabel(width: number, height: number): string {
  const normalizedWidth = normalizeDimension(width)
  const normalizedHeight = normalizeDimension(height)
  if (!normalizedWidth || !normalizedHeight) return ''

  return inferResolutionTier(normalizedWidth, normalizedHeight)
}
