import { useState } from 'react'
import type * as React from 'react'

import { ImageIcon, Video } from 'lucide-react'

import { Card } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'

import { ControlPanel } from './ControlPanel'
import { ResultPanel } from './ResultPanel'
import { TaskQueue } from './TaskQueue'
import { useAiStudioState } from './useAiStudioState'

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

  return (
    <Card className="flex h-full min-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-[34px] border border-zinc-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,244,245,0.96))] text-zinc-950 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <ResultPanel state={state} />
      </div>

      <div className="relative z-30 px-6 pb-5 pt-2">
        <div className="mx-auto w-full max-w-[920px]">
          <div className="mb-2 inline-flex items-center rounded-[18px] border border-zinc-200 bg-zinc-100/90 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => state.setStudioCapability('image')}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-[14px] px-3 text-[13px] font-medium transition',
                state.studioCapability === 'image'
                  ? 'bg-zinc-950 text-white'
                  : 'text-zinc-500 hover:text-zinc-900'
              )}
            >
              <ImageIcon className="h-4 w-4" />
              图片
            </button>
            <button
              type="button"
              onClick={() => state.setStudioCapability('video')}
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-[14px] px-3 text-[13px] font-medium transition',
                state.studioCapability === 'video'
                  ? 'bg-zinc-950 text-white'
                  : 'text-zinc-500 hover:text-zinc-900'
              )}
            >
              <Video className="h-4 w-4" />
              视频
            </button>
          </div>

          <div className="relative overflow-visible rounded-[28px] border border-zinc-200/90 bg-white/92 px-3.5 pt-2.5 pb-3 shadow-[0_18px_44px_rgba(15,23,42,0.06)] backdrop-blur">
            <TaskQueue state={state} promptDraft={promptDraft} onPromptChange={setPromptDraft} />
            <div className="relative z-30 mt-2.5 border-t border-zinc-200/80 pt-2.5">
              <ControlPanel state={state} promptDraft={promptDraft} />
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
