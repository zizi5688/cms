import type { AiProviderRouteCandidate } from '../../../lib/aiProviderProfiles.ts'

import type { GeneratedVideoNoteAsset } from './videoNotePreviewHelpers.ts'

type VideoSmartChatInput = {
  prompt: string
  imagePaths: string[]
}

type VideoComposerGenerateResult = {
  outputs: string[]
  failedCount: number
}

type VideoSmartGenerationUpdate =
  | { type: 'copy-attempt-start'; providerName: string }
  | { type: 'copy-generating-start' }
  | { type: 'copy-parsing-start'; rawCopyText: string }
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

type VideoSmartCopyResult =
  | {
      ok: true
      csvText: string
      rawCopyText: string
      providerName: string
    }
  | {
      ok: false
      message: string
      providerName: string
    }

type VideoSmartRenderResult =
  | {
      ok: true
      assets: GeneratedVideoNoteAsset[]
      reusedExistingAssets?: boolean
    }
  | {
      ok: false
      message: string
    }

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

export async function runVideoSmartGenerationFlow({
  chatInput,
  chatCandidates,
  existingPreviewAssets = [],
  startChatRun,
  startVideoRender,
  prepareGeneratedVideoPreviewAssets,
  extractCsvFromResponse,
  applyGenerationUpdate,
  addLog
}: {
  chatInput: VideoSmartChatInput
  chatCandidates: AiProviderRouteCandidate[]
  existingPreviewAssets?: GeneratedVideoNoteAsset[]
  startChatRun: (payload: {
    promptText: string
    imagePaths: string[]
    routeOverride?: AiProviderRouteCandidate
  }) => Promise<{
    outputText?: unknown
  }>
  startVideoRender: () => Promise<VideoComposerGenerateResult | null>
  prepareGeneratedVideoPreviewAssets: (videoPaths: string[]) => Promise<GeneratedVideoNoteAsset[]>
  extractCsvFromResponse: (rawText: string) => string
  applyGenerationUpdate: (update: VideoSmartGenerationUpdate) => void
  addLog?: (message: string) => void
}): Promise<{
  copyResult: VideoSmartCopyResult
  renderResult: VideoSmartRenderResult
}> {
  const normalizedExistingAssets = normalizeAssets(existingPreviewAssets)
  const isCopyOnlyRetry = normalizedExistingAssets.length > 0

  const renderPromise: Promise<VideoSmartRenderResult> = isCopyOnlyRetry
    ? (async () => {
        addLog?.(`[AI Studio] 视频笔记文案重试开始，复用 ${normalizedExistingAssets.length} 条已生成视频。`)
        return {
          ok: true,
          assets: normalizedExistingAssets,
          reusedExistingAssets: true
        }
      })()
    : (async () => {
        try {
          const result = await startVideoRender()
          if (!result || result.outputs.length === 0) {
            const message =
              result && result.failedCount > 0
                ? '本轮视频生成失败，请检查参数或素材后重试。'
                : '本轮视频生成未产出可用结果。'
            applyGenerationUpdate({
              type: 'render-error',
              message
            })
            addLog?.(`[AI Studio] 视频笔记生成失败：${message}`)
            return {
              ok: false,
              message
            }
          }

          const previewAssets = normalizeAssets(
            await prepareGeneratedVideoPreviewAssets(result.outputs)
          )
          if (previewAssets.length === 0) {
            const message = '已生成视频，但未能准备可预览的视频素材，请检查输出目录后重试。'
            applyGenerationUpdate({
              type: 'render-error',
              message
            })
            addLog?.(`[AI Studio] 视频笔记生成失败：${message}`)
            return {
              ok: false,
              message
            }
          }

          applyGenerationUpdate({
            type: 'render-success',
            assets: previewAssets
          })
          addLog?.(`[AI Studio] 视频已生成 ${previewAssets.length} 条，等待文案返回。`)
          if (result.failedCount > 0) {
            addLog?.(
              `[AI Studio] 视频笔记生成存在失败项：${result.failedCount} 条，已保留成功结果等待合流。`
            )
          }
          return {
            ok: true,
            assets: previewAssets
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          applyGenerationUpdate({
            type: 'render-error',
            message
          })
          addLog?.(`[AI Studio] 视频笔记生成失败：${message}`)
          return {
            ok: false,
            message
          }
        }
      })()

  const copyPromise = (async (): Promise<VideoSmartCopyResult> => {
    const attempts = chatCandidates.length > 0 ? chatCandidates : [undefined]
    let previousFailure: { providerName: string; message: string } | null = null

    for (const [index, candidate] of attempts.entries()) {
      const providerName = normalizeText(candidate?.providerName)
      if (index === 0) {
        applyGenerationUpdate({
          type: 'copy-attempt-start',
          providerName
        })
        if (providerName) {
          addLog?.(`[AI Studio] 视频笔记文案主供应商：${providerName}。`)
        }
      } else {
        applyGenerationUpdate({
          type: 'copy-fallback-start',
          failedProviderName: previousFailure?.providerName ?? '',
          failedMessage: previousFailure?.message ?? '',
          providerName
        })
        addLog?.(`[AI Studio] 视频笔记文案主供应商失败，切换到备用供应商：${providerName}。`)
      }

      try {
        applyGenerationUpdate({
          type: 'copy-generating-start'
        })
        const result = await startChatRun({
          promptText: chatInput.prompt,
          imagePaths: chatInput.imagePaths,
          ...(candidate ? { routeOverride: candidate } : {})
        })
        const rawCopyText = normalizeText(result?.outputText)
        applyGenerationUpdate({
          type: 'copy-parsing-start',
          rawCopyText
        })
        const csvText = normalizeText(extractCsvFromResponse(rawCopyText))
        applyGenerationUpdate({
          type: 'copy-success',
          csvText,
          rawCopyText
        })
        if (index > 0) {
          addLog?.(`[AI Studio] 视频笔记文案备用供应商成功：${providerName}。`)
        } else {
          addLog?.('[AI Studio] 视频笔记文案已返回，等待视频生成完成。')
        }
        if (isCopyOnlyRetry) {
          addLog?.('[AI Studio] 视频笔记文案重试成功，已复用现有视频结果。')
        }
        return {
          ok: true,
          csvText,
          rawCopyText,
          providerName
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        previousFailure = {
          providerName,
          message
        }
        const isLastAttempt = index === attempts.length - 1
        if (isLastAttempt) {
          applyGenerationUpdate({
            type: 'copy-error',
            providerName,
            message
          })
          addLog?.(
            attempts.length > 1
              ? `[AI Studio] 视频笔记文案主备供应商均失败：${message}`
              : `[AI Studio] 视频笔记智能生成失败：${message}`
          )
          if (isCopyOnlyRetry) {
            addLog?.(`[AI Studio] 视频笔记文案重试失败：${message}`)
          }
          return {
            ok: false,
            message,
            providerName
          }
        }
      }
    }

    const message = '[AI Studio] 未找到可用聊天供应商。'
    applyGenerationUpdate({
      type: 'copy-error',
      message
    })
    addLog?.(`[AI Studio] 视频笔记智能生成失败：${message}`)
    return {
      ok: false,
      message,
      providerName: ''
    }
  })()

  const [copyResult, renderResult] = await Promise.all([copyPromise, renderPromise])
  return {
    copyResult,
    renderResult
  }
}
