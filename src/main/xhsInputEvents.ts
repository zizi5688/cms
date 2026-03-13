export type XhsSendInputEvent = {
  type: 'keyDown' | 'char' | 'keyUp'
  keyCode: string
}

function normalizeKeyName(key: string): 'Enter' | 'Space' | '' {
  const value = String(key ?? '').trim()
  if (value === 'Enter') return 'Enter'
  if (value === 'Space' || value === ' ') return 'Space'
  return ''
}

export function buildXhsSendKeyEvents(key: string): XhsSendInputEvent[] {
  const normalized = normalizeKeyName(key)
  if (normalized === 'Enter') {
    return [
      { type: 'keyDown', keyCode: 'Enter' },
      { type: 'char', keyCode: '\r' },
      { type: 'keyUp', keyCode: 'Enter' }
    ]
  }

  if (normalized === 'Space') {
    return [
      { type: 'keyDown', keyCode: 'Space' },
      { type: 'char', keyCode: ' ' },
      { type: 'keyUp', keyCode: 'Space' }
    ]
  }

  return []
}
