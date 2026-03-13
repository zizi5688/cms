function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveInitialVideoPreviewPath(
  originalPath: string | null | undefined,
  previewPath?: string | null
): string {
  return normalizeText(previewPath) || normalizeText(originalPath)
}

export function resolvePreparedVideoPreviewPath(
  prepared: { previewPath?: string | null } | null | undefined,
  originalPath: string
): string {
  return normalizeText(prepared?.previewPath) || normalizeText(originalPath)
}

export function shouldFallbackToOriginalVideo(input: {
  resolvedOriginalVideoSrc: string
  playableVideoSrc: string
  didFallbackToOriginalVideo: boolean
}): boolean {
  const resolvedOriginalVideoSrc = normalizeText(input.resolvedOriginalVideoSrc)
  const playableVideoSrc = normalizeText(input.playableVideoSrc)
  if (!resolvedOriginalVideoSrc) return false
  if (input.didFallbackToOriginalVideo) return false
  return playableVideoSrc !== resolvedOriginalVideoSrc
}
