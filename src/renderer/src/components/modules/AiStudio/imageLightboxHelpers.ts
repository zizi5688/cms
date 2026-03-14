export const IMAGE_LIGHTBOX_MIN_ZOOM = 1
export const IMAGE_LIGHTBOX_MAX_ZOOM = 4
export const IMAGE_LIGHTBOX_ZOOM_STEP = 0.25

export function resolveImageLightboxStartIndex(
  assetIds: string[],
  activeAssetId: string | null | undefined
): number {
  const normalizedActiveAssetId = String(activeAssetId ?? '').trim()
  if (!normalizedActiveAssetId || assetIds.length === 0) return 0

  const matchedIndex = assetIds.findIndex((assetId) => assetId === normalizedActiveAssetId)
  return matchedIndex >= 0 ? matchedIndex : 0
}

export function stepImageLightboxIndex(
  currentIndex: number,
  total: number,
  direction: 'previous' | 'next'
): number {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0))
  if (safeTotal <= 1) return 0

  const safeCurrentIndex = Math.min(Math.max(0, Math.floor(Number(currentIndex) || 0)), safeTotal - 1)
  if (direction === 'previous') {
    return Math.max(0, safeCurrentIndex - 1)
  }
  return Math.min(safeTotal - 1, safeCurrentIndex + 1)
}

export function clampImageLightboxZoom(value: number): number {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return IMAGE_LIGHTBOX_MIN_ZOOM
  return Math.min(IMAGE_LIGHTBOX_MAX_ZOOM, Math.max(IMAGE_LIGHTBOX_MIN_ZOOM, numericValue))
}

export function shouldCloseImageLightboxFromBackdropClick(input: {
  target: EventTarget | null
  currentTarget: EventTarget | null
}): boolean {
  return input.target != null && input.target === input.currentTarget
}

export function stepImageLightboxZoom(
  currentZoom: number,
  direction: 'in' | 'out'
): number {
  const delta = direction === 'in' ? IMAGE_LIGHTBOX_ZOOM_STEP : -IMAGE_LIGHTBOX_ZOOM_STEP
  return clampImageLightboxZoom(Math.round((currentZoom + delta) * 100) / 100)
}
