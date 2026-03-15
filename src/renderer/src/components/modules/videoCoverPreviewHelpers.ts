export type VideoCoverPreviewSource = 'manual' | 'first-frame' | 'none'

function normalizePath(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveVideoCoverPreview(input: {
  manualCoverPath?: string | null
  fallbackCoverPath?: string | null
}): { path: string; source: VideoCoverPreviewSource } {
  const manualCoverPath = normalizePath(input.manualCoverPath)
  if (manualCoverPath) {
    return {
      path: manualCoverPath,
      source: 'manual'
    }
  }

  const fallbackCoverPath = normalizePath(input.fallbackCoverPath)
  if (fallbackCoverPath) {
    return {
      path: fallbackCoverPath,
      source: 'first-frame'
    }
  }

  return {
    path: '',
    source: 'none'
  }
}
