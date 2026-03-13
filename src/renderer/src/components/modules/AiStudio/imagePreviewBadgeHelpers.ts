function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function inferResolutionTier(width: number, height: number): string {
  const longestEdge = Math.max(width, height)
  if (longestEdge >= 1792) return '2K'
  if (longestEdge >= 896) return '1K'
  return ''
}

export function resolveLoadedImageBadgeLabel(
  dimensions: { width: number; height: number } | null | undefined
): string {
  if (!dimensions) return ''
  const width = normalizeDimension(dimensions.width)
  const height = normalizeDimension(dimensions.height)
  if (!width || !height) return ''

  return inferResolutionTier(width, height)
}
