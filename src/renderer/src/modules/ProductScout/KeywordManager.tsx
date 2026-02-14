import type * as React from 'react'
import { useState } from 'react'
import { cn } from '@renderer/lib/utils'

type ScoutKeyword = {
  id: string
  keyword: string
  sortMode: string
  isActive: boolean
  productCount: number
  lastSyncedAt: number | null
  createdAt: number
}

type Props = {
  keywords: ScoutKeyword[]
  activeKeywordId: string | null
  onSelect: (id: string) => void
  onAdd: (keyword: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
}

function KeywordManager({ keywords, activeKeywordId, onSelect, onAdd, onRemove }: Props): React.JSX.Element {
  const [newKeyword, setNewKeyword] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const handleAdd = async (): Promise<void> => {
    const trimmed = newKeyword.trim()
    if (!trimmed) return
    if (keywords.some((k) => k.keyword === trimmed)) return

    setIsAdding(true)
    try {
      await onAdd(trimmed)
      setNewKeyword('')
    } finally {
      setIsAdding(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const formatTime = (ts: number | null): string => {
    if (!ts) return '未同步'
    const d = new Date(ts)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/10">
      {/* Header */}
      <div className="border-b border-zinc-800 px-3 py-2">
        <div className="text-xs font-medium text-zinc-300">关键词</div>
      </div>

      {/* Add input */}
      <div className="flex gap-1 border-b border-zinc-800 p-2">
        <input
          type="text"
          value={newKeyword}
          onChange={(e) => setNewKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入关键词..."
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-600"
          disabled={isAdding}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={isAdding || !newKeyword.trim()}
          className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-40"
        >
          +
        </button>
      </div>

      {/* Keyword list */}
      <div className="flex-1 overflow-auto p-1">
        {keywords.length === 0 ? (
          <div className="p-3 text-center text-xs text-zinc-500">暂无关键词</div>
        ) : (
          keywords.map((kw) => (
            <button
              key={kw.id}
              type="button"
              onClick={() => onSelect(kw.id)}
              className={cn(
                'group flex w-full items-start gap-1 rounded-md px-2 py-1.5 text-left transition-colors',
                kw.id === activeKeywordId
                  ? 'bg-zinc-800 text-zinc-50'
                  : 'text-zinc-300 hover:bg-zinc-800/60'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{kw.keyword}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{kw.productCount} 商品</span>
                  <span>{formatTime(kw.lastSyncedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(kw.id)
                }}
                className="mt-0.5 hidden text-zinc-500 hover:text-red-400 group-hover:inline"
                title="删除"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export { KeywordManager }
