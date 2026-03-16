function normalizePathList(paths: string[]): string[] {
  return paths.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function pathListsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

export function buildAiStudioImageImportKey(paths: string[]): string {
  return normalizePathList(paths).join('\n')
}

export function shouldSyncAiStudioImageImport(input: {
  importedImagePaths: string[]
  currentImageFiles: string[]
  previousImportKey: string
}): boolean {
  const normalizedImported = normalizePathList(input.importedImagePaths)
  if (normalizedImported.length === 0) return false

  const normalizedCurrent = normalizePathList(input.currentImageFiles)
  if (!pathListsMatch(normalizedImported, normalizedCurrent)) return true

  const nextImportKey = buildAiStudioImageImportKey(normalizedImported)
  return nextImportKey !== String(input.previousImportKey ?? '').trim()
}
