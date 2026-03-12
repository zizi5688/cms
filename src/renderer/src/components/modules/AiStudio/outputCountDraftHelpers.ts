type OutputCountValidationOptions = {
  fieldLabel: string
  min: number
  max?: number
}

export function parseOutputCountDraft(
  rawValue: string,
  options: OutputCountValidationOptions
): number {
  const normalized = String(rawValue ?? '').trim()
  if (!normalized) {
    throw new Error(`请先填写${options.fieldLabel}。`)
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${options.fieldLabel}必须是正整数。`)
  }

  const parsed = Number.parseInt(normalized, 10)
  if (parsed < options.min) {
    throw new Error(`${options.fieldLabel}不能小于 ${options.min}。`)
  }
  if (typeof options.max === 'number' && parsed > options.max) {
    throw new Error(`${options.fieldLabel}不能大于 ${options.max}。`)
  }
  return parsed
}

export function normalizeOutputCountDraftOnBlur(
  rawValue: string,
  options: OutputCountValidationOptions
): string {
  const normalized = String(rawValue ?? '').trim()
  if (!normalized) return ''

  try {
    return String(parseOutputCountDraft(normalized, options))
  } catch {
    return rawValue
  }
}
