import type * as React from 'react'

import { AlertTriangle, CheckCircle2, Circle, FolderInput } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

import type { AiStudioTaskStatusFilter, UseAiStudioStateResult } from './useAiStudioState'

const FILTERS: Array<{ value: AiStudioTaskStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'running', label: '进行中' },
  { value: 'failed', label: '异常' },
  { value: 'completed', label: '完成' }
]

function TaskQueue({ state }: { state: UseAiStudioStateResult }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
        {FILTERS.map((filter) => {
          const active = filter.value === state.statusFilter
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => state.setStatusFilter(filter.value)}
              className={cn(
                'rounded-full border px-3 py-1 transition',
                active ? 'border-zinc-600 bg-zinc-50 text-zinc-950' : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-700'
              )}
            >
              {filter.label}
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => void state.importFolders()} disabled={state.isImporting}>
          <FolderInput className="h-4 w-4" />
          {state.isImporting ? '导入中...' : '导入文件夹'}
        </Button>
        <Button type="button" variant="outline" disabled={state.exceptionCount === 0}>
          <AlertTriangle className="h-4 w-4" />
          异常 {state.exceptionCount}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {state.visibleTasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 py-8 text-center text-sm text-zinc-500">
            先导入文件夹
          </div>
        ) : null}

        {state.visibleTasks.map((task) => {
          const isActive = task.id === state.activeTask?.id
          const isSelected = state.selectedTaskIds.includes(task.id)
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => state.setActiveTaskId(task.id)}
              className={cn(
                'group w-full rounded-2xl border p-3 text-left transition',
                isActive ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-950/70 hover:border-zinc-700'
              )}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  className="mt-0.5 text-zinc-400 transition hover:text-zinc-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    state.toggleTaskSelection(task.id)
                  }}
                >
                  {isSelected ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Circle className="h-4 w-4" />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                    <span>{task.id.slice(0, 8)}</span>
                    <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] tracking-normal text-zinc-300">
                      {task.status}
                    </span>
                  </div>
                  <div className="mt-2 truncate text-sm font-medium text-zinc-100">
                    {task.productName || '未命名任务'}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                    <span>{task.sourceCount} 张</span>
                    <span>{task.costLabel}</span>
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { TaskQueue }
