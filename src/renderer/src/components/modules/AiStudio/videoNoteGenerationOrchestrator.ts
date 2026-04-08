import type { GeneratedVideoNoteAsset } from './videoNotePreviewHelpers.ts'

export type VideoNoteGenerationBranchStatus = 'idle' | 'running' | 'success' | 'error'

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
  previewAssets: GeneratedVideoNoteAsset[]
  copyError: string
  renderError: string
  mergeStatus: VideoNoteGenerationMergeStatus
  isReadyForPreview: boolean
}

type VideoNoteGenerationUpdate =
  | { type: 'start' }
  | { type: 'copy-success'; csvText: string }
  | { type: 'copy-error'; message: string }
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

function deriveMergeStatus(state: VideoNoteGenerationState): VideoNoteGenerationMergeStatus {
  const hasCsv = normalizeText(state.csvText).length > 0
  const hasAssets = state.previewAssets.length > 0

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
  return {
    ...state,
    mergeStatus,
    isReadyForPreview: mergeStatus === 'ready-preview'
  }
}

export function createInitialVideoNoteGenerationState(): VideoNoteGenerationState {
  return withDerivedStatus({
    copyStatus: 'idle',
    renderStatus: 'idle',
    csvText: '',
    previewAssets: [],
    copyError: '',
    renderError: '',
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
        previewAssets: [],
        copyError: '',
        renderError: '',
        mergeStatus: 'running-both',
        isReadyForPreview: false
      })
    case 'copy-success':
      return withDerivedStatus({
        ...state,
        copyStatus: 'success',
        csvText: normalizeText(update.csvText),
        copyError: ''
      })
    case 'copy-error':
      return withDerivedStatus({
        ...state,
        copyStatus: 'error',
        copyError: normalizeText(update.message)
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
