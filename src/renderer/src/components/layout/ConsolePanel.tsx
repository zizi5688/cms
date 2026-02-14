import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'

import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

function ConsolePanel(): React.JSX.Element {
  const logs = useCmsStore((s) => s.logs)
  const clearLogs = useCmsStore((s) => s.clearLogs)
  const [isExpanded, setIsExpanded] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // 自动滚动逻辑
  useEffect(() => {
    if (isExpanded) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [logs.length, isExpanded])

  return (
    <section
      className={cn(
        'flex w-full flex-col border-t border-zinc-800 bg-black transition-all duration-300 ease-in-out',
        isExpanded ? 'h-[28vh]' : 'h-10'
      )}
    >
      {/* Header Bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800/50 px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            控制台日志
            <span className="ml-1 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px]">
              {logs.length}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={clearLogs}
            disabled={logs.length === 0}
            aria-label="清空日志"
            title="清空"
            className="h-7 w-7 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={scrollContainerRef}
        className={cn(
          'min-h-0 flex-1 overflow-auto px-4 py-2 font-mono text-[12px] leading-relaxed transition-opacity duration-200',
          isExpanded ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-600">
            暂无日志。
          </div>
        ) : (
          logs.map((line, index) => {
            const isError = line.includes('错误') || line.includes('Error') || line.includes('失败')
            const isStep = line.includes('[步骤')
            const isSystem = line.startsWith('[System]')
            return (
              <div
                key={`${index}-${line}`}
                className={cn(
                  'break-all py-0.5',
                  isError ? 'text-red-400' : isSystem ? 'text-yellow-400' : isStep ? 'text-blue-400' : 'text-zinc-300'
                )}
              >
                {line}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  )
}

export { ConsolePanel }
