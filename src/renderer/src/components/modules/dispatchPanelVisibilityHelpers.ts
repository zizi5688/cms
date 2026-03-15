export function shouldShowDispatchPanel(input: {
  selectedDispatchCount: number
  isManualCoverEditorOpen: boolean
}): boolean {
  if (input.isManualCoverEditorOpen) return false
  return input.selectedDispatchCount > 0
}
