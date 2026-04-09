import * as path from 'node:path'

export type CoverModalUploadSnapshot = {
  text: string
  imageSources: string[]
  selectedFileCount: number
  fileValues: string[]
}

export function normalizeImageSrcForCompare(src: string): string {
  const raw = String(src ?? '').trim()
  if (!raw) return ''
  return raw.replace(/[?#].*$/, '')
}

export function hasCoverSelectionSignal(
  now: CoverModalUploadSnapshot,
  coverAbsPath: string,
  baseline: CoverModalUploadSnapshot
): boolean {
  const coverBase = path.basename(coverAbsPath).toLowerCase()
  const coverStem = coverBase.includes('.') ? coverBase.slice(0, coverBase.lastIndexOf('.')) : coverBase

  if (now.selectedFileCount > baseline.selectedFileCount) return true
  if (coverBase && now.fileValues.some((v) => v.includes(coverBase))) return true
  if (coverBase && now.text.includes(coverBase)) return true
  if (coverStem && coverStem.length >= 6 && now.text.includes(coverStem)) return true

  const imageChanged = now.imageSources.join('|') !== baseline.imageSources.join('|')
  const textChanged = now.text !== baseline.text
  const uploadWords = ['上传中', '处理中', '已上传', '上传成功', '重新上传', '替换', '更换']
  if (uploadWords.some((w) => now.text.includes(w)) && (imageChanged || textChanged)) return true

  return false
}
