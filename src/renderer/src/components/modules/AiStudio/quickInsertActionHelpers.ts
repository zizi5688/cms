export function resolveQuickInsertClickOutcome(params: {
  armedPreviewKey: string | null
  clickedPreviewKey: string
}): 'select' | 'execute' {
  const { armedPreviewKey, clickedPreviewKey } = params
  return armedPreviewKey === clickedPreviewKey ? 'execute' : 'select'
}

export function resolveQuickInsertButtonLabel(params: {
  armedPreviewKey: string | null
  itemPreviewKey: string
  defaultLabel: string
  armedLabel: string
}): string {
  const { armedPreviewKey, itemPreviewKey, defaultLabel, armedLabel } = params
  return armedPreviewKey === itemPreviewKey ? armedLabel : defaultLabel
}
