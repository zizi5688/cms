export type QuickInsertTriggerRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export function resolveQuickInsertPanelPosition(params: {
  triggerRect: QuickInsertTriggerRect
  panelWidth: number
  viewportWidth: number
  viewportPadding: number
}): {
  left: number
  top: number
  width: number
  transform: 'translateY(-100%)'
} {
  const { triggerRect, panelWidth, viewportWidth, viewportPadding } = params
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.right),
    Math.max(viewportPadding, viewportWidth - panelWidth - viewportPadding)
  )

  return {
    left,
    top: Math.max(viewportPadding, triggerRect.bottom),
    width: panelWidth,
    transform: 'translateY(-100%)'
  }
}
