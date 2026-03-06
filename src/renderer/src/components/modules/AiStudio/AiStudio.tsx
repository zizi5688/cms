import type * as React from 'react'

import { Sparkles, Wand2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'

const queueItems = [
  { id: 'A-018', name: '羊绒开衫', status: '待生成', shots: 12, accent: 'from-fuchsia-500/30 via-rose-500/10 to-transparent' },
  { id: 'A-019', name: '真丝半裙', status: '草稿', shots: 8, accent: 'from-cyan-500/30 via-sky-500/10 to-transparent' },
  { id: 'A-020', name: '轻羽绒马甲', status: '异常', shots: 5, accent: 'from-amber-500/25 via-orange-500/10 to-transparent' }
] as const

const resultFrames = ['主视觉候选', '棚拍白底', '场景加深'] as const

function portraitFrame(label: string, tone: string): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
        <div className={`relative flex h-full w-full items-end overflow-hidden bg-gradient-to-br ${tone}`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_38%),linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.38)_100%)]" />
          <div className="absolute inset-x-5 top-5 h-8 rounded-full border border-white/10 bg-white/6 backdrop-blur" />
          <div className="absolute inset-x-6 bottom-6 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-sm">
            <div className="h-3 w-20 rounded-full bg-white/70" />
            <div className="mt-3 h-20 rounded-xl border border-white/10 bg-white/6" />
          </div>
        </div>
      </div>
      <div className="text-xs text-zinc-400">{label}</div>
    </div>
  )
}

function AiStudio(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div>
          <div className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">AI Material Studio</div>
          <h1 className="mt-1 text-xl font-semibold text-zinc-50">AI素材工作台</h1>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
          <Sparkles className="h-3.5 w-3.5" />
          GRSAI Ready
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[280px_320px_minmax(0,1fr)]">
        <Card className="border-zinc-800 bg-zinc-900/65 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-50">片场</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-200">全部</span>
              <span className="rounded-full border border-zinc-800 px-3 py-1">待生成</span>
              <span className="rounded-full border border-zinc-800 px-3 py-1">异常</span>
            </div>
            <div className="space-y-3">
              {queueItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="group w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
                >
                  <div className="flex items-start gap-3">
                    <div className={`relative aspect-[3/4] w-16 overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br ${item.accent}`}>
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(0,0,0,0.45))]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                        <span>{item.id}</span>
                        <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-2 truncate text-sm font-medium text-zinc-100">{item.name}</div>
                      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                        <span>{item.shots} 张源图</span>
                        <span>¥ 0.00</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/70 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-zinc-50">控制台</CardTitle>
          </CardHeader>
          <CardContent className="flex h-full flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">模板</div>
                <div className="mt-2 text-sm text-zinc-100">电商静物棚拍</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">比例 / 数量</div>
                <div className="mt-2 text-sm text-zinc-100">3:4 · 1 张</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-3 sm:col-span-2 xl:col-span-1">
                <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">模型</div>
                <div className="mt-2 text-sm text-zinc-100">GRSAI / image-default</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-2 text-xs text-zinc-500">主图</div>
                {portraitFrame('Primary', 'from-fuchsia-500/20 via-zinc-950 to-zinc-950')}
              </div>
              <div>
                <div className="mb-2 text-xs text-zinc-500">参考</div>
                {portraitFrame('Reference', 'from-cyan-500/20 via-zinc-950 to-zinc-950')}
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/70 p-4 text-sm text-zinc-400">
              高级要求
            </div>

            <Button type="button" className="mt-auto h-11 rounded-xl bg-zinc-50 text-zinc-950 hover:bg-white">
              <Wand2 className="mr-2 h-4 w-4" />
              开始生成
            </Button>
          </CardContent>
        </Card>

        <Card className="min-h-0 border-zinc-800 bg-zinc-900/75 shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="text-base text-zinc-50">结果区</CardTitle>
            <div className="text-xs text-zinc-500">0 / 3 已选</div>
          </CardHeader>
          <CardContent className="flex h-full min-h-0 flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {resultFrames.map((label, index) => (
                <div key={label} className="rounded-2xl border border-zinc-800 bg-zinc-950/75 p-3">
                  {portraitFrame(label, index === 0 ? 'from-violet-500/20 via-zinc-950 to-zinc-950' : index === 1 ? 'from-emerald-500/20 via-zinc-950 to-zinc-950' : 'from-amber-500/20 via-zinc-950 to-zinc-950')}
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 text-xs text-zinc-500">
              运行记录
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export { AiStudio }
