export type VideoCoverMode = 'auto' | 'manual'

export function normalizeVideoCoverMode(value: unknown, fallback: VideoCoverMode = 'auto'): VideoCoverMode {
  if (value === 'auto' || value === 'manual') return value
  return fallback
}

export function normalizeVideoCoverModeForDb(value: unknown): VideoCoverMode {
  return normalizeVideoCoverMode(value, 'auto')
}
