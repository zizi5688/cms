function toSafeFileUrl(filePath: string): string {
  const normalized = String(filePath ?? '').replace(/\\/g, '/')
  const withLeadingSlash = /^[A-Za-z]:[/]/.test(normalized) ? `/${normalized}` : normalized
  const encoded = encodeURI(withLeadingSlash).replaceAll('#', '%23').replaceAll('?', '%3F')
  return `safe-file://${encoded}`
}

function isHttpUrl(value: string): boolean {
  return /^https?:[/]{2}/i.test(String(value ?? '').trim())
}

function normalizeRemoteImageUrl(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' && url.hostname.toLowerCase() === 'qimg.xiaohongshu.com') {
      url.protocol = 'https:'
      return url.toString()
    }
  } catch {
    return raw
  }
  return raw
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(String(value ?? '').trim())
}

function isAbsolutePathLike(value: string): boolean {
  const v = String(value ?? '').trim()
  if (!v) return false
  if (v.startsWith('/')) return true
  if (isWindowsAbsolutePath(v)) return true
  return false
}

export function resolveLocalImage(inputPath: string, workspacePath?: string): string {
  const raw = String(inputPath ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith('safe-file://')) return raw
  if (raw.startsWith('blob:') || raw.startsWith('data:')) return raw
  if (raw.startsWith('file://')) {
    try {
      const u = new URL(raw)
      const decoded = decodeURIComponent(u.pathname || '')
      if (decoded) return toSafeFileUrl(decoded)
    } catch {
      return raw
    }
  }
  if (isHttpUrl(raw)) return normalizeRemoteImageUrl(raw)

  const ws = String(workspacePath ?? '').trim()
  if (isAbsolutePathLike(raw)) return toSafeFileUrl(raw)

  if (!ws) return toSafeFileUrl(raw)

  const normalizedRel = raw.replace(/\\/g, '/')
  const joined = ws.replace(/[\\/]+$/, '') + '/' + normalizedRel.replace(/^[/]+/, '')
  return toSafeFileUrl(joined)
}
