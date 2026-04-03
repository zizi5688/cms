export const AI_STUDIO_NOTE_MATERIAL_DRAG_MIME = 'application/x-ai-studio-note-materials'

type NoteMaterialDragPayload = {
  paths: string[]
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

export function buildNoteMaterialDragPayload(paths: string[]): string {
  const payload: NoteMaterialDragPayload = {
    paths: uniqueStrings(paths)
  }
  return JSON.stringify(payload)
}

export function parseNoteMaterialDragPayload(value: string): string[] {
  const normalized = String(value ?? '').trim()
  if (!normalized) return []

  try {
    const parsed = JSON.parse(normalized) as NoteMaterialDragPayload | null
    return uniqueStrings(Array.isArray(parsed?.paths) ? parsed.paths : [])
  } catch {
    return []
  }
}
