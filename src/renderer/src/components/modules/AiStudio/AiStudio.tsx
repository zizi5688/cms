import { useLayoutEffect, useRef, useState } from 'react'
import type * as React from 'react'

import { ImageIcon, Video } from 'lucide-react'

import { Card } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'

import { ControlPanel } from './ControlPanel'
import { ResultPanel } from './ResultPanel'
import { TaskQueue } from './TaskQueue'
import { useAiStudioState } from './useAiStudioState'

const AI_STUDIO_CANVAS_SURFACE_CLASS =
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,244,245,0.96))]'

function readPromptSeed(state: ReturnType<typeof useAiStudioState>): string {
  return String(
    state.activeTask?.promptExtra ?? state.masterPromptExtra ?? state.childPromptExtra ?? ''
  ).trim()
}

function AiStudioCanvas({
  state,
  initialPromptDraft
}: {
  state: ReturnType<typeof useAiStudioState>
  initialPromptDraft: string
}): React.JSX.Element {
  const [promptDraft, setPromptDraft] = useState(initialPromptDraft)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [composerOverlayPadding, setComposerOverlayPadding] = useState(420)

  useLayoutEffect(() => {
    const updateOverlayPadding = (): void => {
      const overlayHeight = overlayRef.current?.offsetHeight ?? 0
      const extraGap = 28
      setComposerOverlayPadding(overlayHeight > 0 ? overlayHeight + extraGap : 420)
    }

    updateOverlayPadding()

    const currentOverlay = overlayRef.current
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && currentOverlay
        ? new ResizeObserver(() => {
            updateOverlayPadding()
          })
        : null

    if (currentOverlay && resizeObserver) {
      resizeObserver.observe(currentOverlay)
    }

    window.addEventListener('resize', updateOverlayPadding)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateOverlayPadding)
    }
  }, [promptDraft, state.studioCapability])

  return (
    <Card
      className={cn(
        'relative flex h-full min-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-[34px] border border-zinc-200/80 text-zinc-950 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur',
        AI_STUDIO_CANVAS_SURFACE_CLASS
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <ResultPanel state={state} bottomSpacerHeight={composerOverlayPadding} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-5 pt-2">
        <div ref={overlayRef} className="pointer-events-auto mx-auto flex w-full max-w-[920px] flex-col gap-3">
          <div
            className={cn(
              'inline-flex items-center self-start rounded-[18px] border border-black/8 p-1 shadow-[0_8px_18px_rgba(15,23,42,0.04)]',
              AI_STUDIO_CANVAS_SURFACE_CLASS
            )}
          >
            <button
              type="button"
              onClick={() => state.setStudioCapability('image')}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-[14px] border px-3 text-[13px] font-medium transition',
                state.studioCapability === 'image'
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900'
              )}
            >
              <ImageIcon className="h-4 w-4" />
              图片
            </button>
            <button
              type="button"
              onClick={() => state.setStudioCapability('video')}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-[14px] border px-3 text-[13px] font-medium transition',
                state.studioCapability === 'video'
                  ? 'border-zinc-950 bg-zinc-950 text-white'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900'
              )}
            >
              <Video className="h-4 w-4" />
              视频
            </button>
          </div>

          <div
            className={cn(
              'rounded-[28px] border border-black/8 px-3.5 pt-2.5 pb-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)]',
              AI_STUDIO_CANVAS_SURFACE_CLASS
            )}
          >
            <TaskQueue state={state} promptDraft={promptDraft} onPromptChange={setPromptDraft} />
            <div className="relative z-30 mt-2.5 pt-2.5 before:absolute before:left-4 before:right-4 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-black/8 before:to-transparent">
              <ControlPanel
                state={state}
                promptDraft={promptDraft}
                onPromptClear={() => setPromptDraft('')}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function AiStudio(): React.JSX.Element {
  const state = useAiStudioState()
  return (
    <AiStudioCanvas
      key={`${state.studioCapability}:${state.activeTask?.id ?? 'empty'}`}
      state={state}
      initialPromptDraft={readPromptSeed(state)}
    />
  )
}

export { AiStudio }
