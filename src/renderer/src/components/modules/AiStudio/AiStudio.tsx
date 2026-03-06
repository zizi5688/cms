import type * as React from 'react'

import { Sparkles } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'

import { ControlPanel } from './ControlPanel'
import { TaskQueue } from './TaskQueue'
import { useAiStudioState } from './useAiStudioState'

function basename(filePath: string | null | undefined): string {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return '待生成'
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function toFileSrc(filePath: string | null | undefined): string | undefined {
  const normalized = String(filePath ?? '').trim()
  if (!normalized) return undefined
  return encodeURI(normalized.startsWith('file://') ? normalized : `file://${normalized}`)
}

function AiStudio(): React.JSX.Element {
  const state = useAiStudioState()

  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div>
          <div className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">AI Material Studio</div>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">AI素材工作台</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-full border border-zinc-800 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-300">
            批量 {state.batchCostSummary.label}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" />
            GRSAI Ready
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[280px_360px_minmax(0,1fr)]">
        <Card className="border-zinc-800 bg-zinc-900/65 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-50">片场</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0">
            <TaskQueue state={state} />
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/70 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-50">控制台</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0">
            <ControlPanel state={state} />
          </CardContent>
        </Card>

        <Card className="min-h-0 border-zinc-800 bg-zinc-900/75 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="text-base text-zinc-50">结果区</CardTitle>
            <div className="text-xs text-zinc-500">
              {state.activeTask ? `${state.activeTask.sourceCount} 张源图` : '待导入'}
            </div>
          </CardHeader>
          <CardContent className="flex h-full min-h-0 flex-col gap-4">
            {state.activeTask ? (
              <>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Current Task</div>
                      <div className="mt-2 text-lg font-medium text-zinc-100">
                        {state.activeTask.productName || '未命名任务'}
                      </div>
                    </div>
                    <div className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-400">
                      {state.activeTask.costLabel}
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {state.activeInputAssets.slice(0, 6).map((asset) => (
                    <div key={asset.id} className="space-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/75 p-3">
                      <div
                        className="aspect-[3/4] rounded-xl border border-zinc-800 bg-zinc-950 bg-cover bg-center"
                        style={toFileSrc(asset.filePath) ? { backgroundImage: `url(${toFileSrc(asset.filePath)})` } : undefined}
                      />
                      <div className="truncate text-xs text-zinc-400">{basename(asset.filePath)}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/20 p-4 text-xs text-zinc-500">
                  候选结果将在下一任务接入
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 p-8 text-sm text-zinc-500">
                导入文件夹后显示结果区上下文
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { AiStudio }
