import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { KeywordManager } from './KeywordManager'
import { ProductTable } from './ProductTable'
import { SyncPanel } from './SyncPanel'

type ScoutKeyword = {
  id: string
  keyword: string
  sortMode: string
  isActive: boolean
  productCount: number
  lastSyncedAt: number | null
  createdAt: number
}

function ProductScout(): React.JSX.Element {
  const [keywords, setKeywords] = useState<ScoutKeyword[]>([])
  const [activeKeywordId, setActiveKeywordId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadKeywords = useCallback(async () => {
    try {
      const list = await window.api.cms.scout.keyword.list()
      setKeywords(list)
      if (list.length > 0 && !activeKeywordId) {
        setActiveKeywordId(list[0].id)
      }
    } catch (error) {
      console.error('Failed to load scout keywords:', error)
    } finally {
      setIsLoading(false)
    }
  }, [activeKeywordId])

  useEffect(() => {
    loadKeywords()
  }, [loadKeywords])

  const handleAddKeyword = async (keyword: string): Promise<void> => {
    try {
      const created = await window.api.cms.scout.keyword.add(keyword)
      setKeywords((prev) => [...prev, created])
      if (!activeKeywordId) setActiveKeywordId(created.id)
    } catch (error) {
      console.error('Failed to add keyword:', error)
    }
  }

  const handleRemoveKeyword = async (id: string): Promise<void> => {
    try {
      await window.api.cms.scout.keyword.remove(id)
      setKeywords((prev) => prev.filter((k) => k.id !== id))
      if (activeKeywordId === id) {
        const remaining = keywords.filter((k) => k.id !== id)
        setActiveKeywordId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (error) {
      console.error('Failed to remove keyword:', error)
    }
  }

  const handleSyncComplete = (): void => {
    loadKeywords()
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <div className="text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Top bar: Sync controls */}
      <SyncPanel onSyncComplete={handleSyncComplete} />

      {/* Main content: keyword sidebar + product table */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: Keyword manager */}
        <div className="w-56 shrink-0">
          <KeywordManager
            keywords={keywords}
            activeKeywordId={activeKeywordId}
            onSelect={setActiveKeywordId}
            onAdd={handleAddKeyword}
            onRemove={handleRemoveKeyword}
          />
        </div>

        {/* Right: Product table */}
        <div className="min-w-0 flex-1">
          {activeKeywordId ? (
            <ProductTable keywordId={activeKeywordId} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/10 text-sm text-zinc-400">
              {keywords.length === 0
                ? '添加关键词开始选品分析'
                : '选择一个关键词查看数据'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { ProductScout }
