import type { GeneratedVideoNoteAsset } from './videoNotePreviewHelpers.ts'

export type VideoNoteGenerationBranchStatus = 'idle' | 'running' | 'success' | 'error'
export type VideoNoteCopyFailureRecord = {
  providerName: string
  message: string
}

export type VideoNoteGenerationMergeStatus =
  | 'idle'
  | 'running-both'
  | 'waiting-copy'
  | 'waiting-video'
  | 'ready-preview'
  | 'partial-failed'

export type VideoNoteGenerationState = {
  copyStatus: VideoNoteGenerationBranchStatus
  renderStatus: VideoNoteGenerationBranchStatus
  csvText: string
  rawCopyText: string
  previewAssets: GeneratedVideoNoteAsset[]
  copyError: string
  renderError: string
  copyAttemptProviderName: string
  copyFallbackProviderName: string
  copyAttemptCount: number
  copyFailureHistory: VideoNoteCopyFailureRecord[]
  canRetryCopyOnly: boolean
  mergeStatus: VideoNoteGenerationMergeStatus
  isReadyForPreview: boolean
}

type VideoNoteGenerationUpdate =
  | { type: 'start' }
  | { type: 'copy-attempt-start'; providerName: string }
  | {
      type: 'copy-fallback-start'
      failedProviderName: string
      failedMessage: string
      providerName: string
    }
  | { type: 'copy-success'; csvText: string; rawCopyText?: string }
  | { type: 'copy-error'; providerName?: string; message: string }
  | { type: 'render-success'; assets: GeneratedVideoNoteAsset[] }
  | { type: 'render-error'; message: string }

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeAssets(assets: GeneratedVideoNoteAsset[]): GeneratedVideoNoteAsset[] {
  return Array.isArray(assets)
    ? assets
        .map((asset) => {
          const videoPath = normalizeText(asset?.videoPath)
          const previewPath = normalizeText(asset?.previewPath)
          const coverImagePath = normalizeText(asset?.coverImagePath)

          return {
            videoPath,
            ...(previewPath ? { previewPath } : {}),
            ...(coverImagePath ? { coverImagePath } : {})
          }
        })
        .filter((asset) => asset.videoPath)
    : []
}

function normalizeCopyFailureRecord(
  record: Partial<VideoNoteCopyFailureRecord> | null | undefined
): VideoNoteCopyFailureRecord | null {
  const providerName = normalizeText(record?.providerName)
  const message = normalizeText(record?.message)
  if (!providerName || !message) return null
  return { providerName, message }
}

function appendCopyFailureRecord(
  history: VideoNoteCopyFailureRecord[] | null | undefined,
  record: Partial<VideoNoteCopyFailureRecord> | null | undefined
): VideoNoteCopyFailureRecord[] {
  const nextRecord = normalizeCopyFailureRecord(record)
  const normalizedHistory = Array.isArray(history)
    ? history
        .map((item) => normalizeCopyFailureRecord(item))
        .filter((item): item is VideoNoteCopyFailureRecord => Boolean(item))
    : []
  return nextRecord ? [...normalizedHistory, nextRecord] : normalizedHistory
}

function deriveMergeStatus(state: VideoNoteGenerationState): VideoNoteGenerationMergeStatus {
  const hasCsv = normalizeText(state.csvText).length > 0
  const hasAssets = normalizeAssets(state.previewAssets).length > 0

  if (state.copyStatus === 'success' && state.renderStatus === 'success' && hasCsv && hasAssets) {
    return 'ready-preview'
  }
  if (state.copyStatus === 'error' || state.renderStatus === 'error') {
    return 'partial-failed'
  }
  if (state.copyStatus === 'success' && state.renderStatus === 'running') {
    return 'waiting-video'
  }
  if (state.copyStatus === 'running' && state.renderStatus === 'success') {
    return 'waiting-copy'
  }
  if (state.copyStatus === 'running' || state.renderStatus === 'running') {
    return 'running-both'
  }
  return 'idle'
}

function withDerivedStatus(state: VideoNoteGenerationState): VideoNoteGenerationState {
  const mergeStatus = deriveMergeStatus(state)
  const previewAssets = normalizeAssets(state.previewAssets)
  const copyFailureHistory = appendCopyFailureRecord(state.copyFailureHistory, null)
  return {
    ...state,
    rawCopyText: normalizeText(state.rawCopyText),
    previewAssets,
    copyAttemptProviderName: normalizeText(state.copyAttemptProviderName),
    copyFallbackProviderName: normalizeText(state.copyFallbackProviderName),
    copyFailureHistory,
    canRetryCopyOnly:
      state.copyStatus === 'error' && state.renderStatus === 'success' && previewAssets.length > 0,
    mergeStatus,
    isReadyForPreview: mergeStatus === 'ready-preview'
  }
}

export function createInitialVideoNoteGenerationState(): VideoNoteGenerationState {
  return withDerivedStatus({
    copyStatus: 'idle',
    renderStatus: 'idle',
    csvText: '',
    rawCopyText: '',
    previewAssets: [],
    copyError: '',
    renderError: '',
    copyAttemptProviderName: '',
    copyFallbackProviderName: '',
    copyAttemptCount: 0,
    copyFailureHistory: [],
    canRetryCopyOnly: false,
    mergeStatus: 'idle',
    isReadyForPreview: false
  })
}

export function applyVideoNoteGenerationUpdate(
  state: VideoNoteGenerationState,
  update: VideoNoteGenerationUpdate
): VideoNoteGenerationState {
  switch (update.type) {
    case 'start':
      return withDerivedStatus({
        copyStatus: 'running',
        renderStatus: 'running',
        csvText: '',
        rawCopyText: '',
        previewAssets: [],
        copyError: '',
        renderError: '',
        copyAttemptProviderName: '',
        copyFallbackProviderName: '',
        copyAttemptCount: 0,
        copyFailureHistory: [],
        canRetryCopyOnly: false,
        mergeStatus: 'running-both',
        isReadyForPreview: false
      })
    case 'copy-attempt-start': {
      const providerName = normalizeText(update.providerName)
      return withDerivedStatus({
        ...state,
        copyStatus: 'running',
        csvText: '',
        rawCopyText: '',
        copyError: '',
        copyAttemptProviderName: providerName,
        copyAttemptCount: providerName ? state.copyAttemptCount + 1 : state.copyAttemptCount
      })
    }
    case 'copy-fallback-start': {
      const providerName = normalizeText(update.providerName)
      return withDerivedStatus({
        ...state,
        copyStatus: 'running',
        copyError: '',
        copyAttemptProviderName: providerName,
        copyFallbackProviderName: providerName,
        copyAttemptCount: providerName ? state.copyAttemptCount + 1 : state.copyAttemptCount,
        copyFailureHistory: appendCopyFailureRecord(state.copyFailureHistory, {
          providerName: update.failedProviderName,
          message: update.failedMessage
        })
      })
    }
    case 'copy-success':
      return withDerivedStatus({
        ...state,
        copyStatus: 'success',
        csvText: normalizeText(update.csvText),
        rawCopyText: normalizeText(update.rawCopyText) || normalizeText(update.csvText),
        copyError: ''
      })
    case 'copy-error':
      return withDerivedStatus({
        ...state,
        copyStatus: 'error',
        copyError: normalizeText(update.message),
        copyAttemptProviderName:
          normalizeText(update.providerName) || normalizeText(state.copyAttemptProviderName),
        copyFailureHistory: appendCopyFailureRecord(state.copyFailureHistory, {
          providerName: normalizeText(update.providerName) || normalizeText(state.copyAttemptProviderName),
          message: update.message
        })
      })
    case 'render-success':
      return withDerivedStatus({
        ...state,
        renderStatus: 'success',
        previewAssets: normalizeAssets(update.assets),
        renderError: ''
      })
    case 'render-error':
      return withDerivedStatus({
        ...state,
        renderStatus: 'error',
        renderError: normalizeText(update.message)
      })
  }
}
