import type * as React from 'react'

import { Sparkles } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'

import { ControlPanel } from './ControlPanel'
import { ResultPanel } from './ResultPanel'
import { TaskQueue } from './TaskQueue'
import { useAiStudioState } from './useAiStudioState'

function AiStudio(): React.JSX.Element {
  const state = useAiStudioState()

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col gap-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">
              AI Material Studio
            </div>
            <h1 className="mt-1 text-xl font-semibold text-zinc-50">AI素材工作台</h1>
            <div className="mt-2 text-sm text-zinc-400">
              两阶段串行工作流：先出 AI 母图并自动去印，再以当前 AI 母图连续生成子图。
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-300">
              单任务 / 两阶段
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              Gemini / OpenAI 兼容已接入
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[360px_420px_minmax(0,1fr)]">
        <Card className="border-zinc-800 bg-zinc-900/65 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-50">素材输入</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0">
            <TaskQueue state={state} />
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/70 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-50">两阶段控制台</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0">
            <ControlPanel state={state} />
          </CardContent>
        </Card>

        <Card className="min-h-0 border-zinc-800 bg-zinc-900/75 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="text-base text-zinc-50">母图 / 子图结果</CardTitle>
            <div className="text-xs text-zinc-500">
              {state.activeTask ? `${state.activeTask.sourceCount} 张输入素材` : '待导入'}
            </div>
          </CardHeader>
          <CardContent className="flex h-full min-h-0 flex-col gap-4">
            <ResultPanel state={state} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { AiStudio }
