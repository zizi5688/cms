import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'

type SyncLogEntry = {
  id: string
  syncedAt: number
  sessionId: string | null
  keywordsCount: number
  productsCount: number
  status: string
}

type Props = {
  onSyncComplete: () => void
}

function SyncPanel({ onSyncComplete }: Props): React.JSX.Element {
  const [history, setHistory] = useState<SyncLogEntry[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const list = (await window.api.cms.scout.sync.history()) as SyncLogEntry[]
      setHistory(list.slice(0, 3))
    } catch (error) {
      console.error('Failed to load sync history:', error)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const handleImportFile = async (): Promise<void> => {
    setIsImporting(true)
    setLastResult(null)
    try {
      const result = await window.api.cms.scout.sync.importFile()
      if (result) {
        setLastResult(`导入成功：${result.keywordsUpdated} 个关键词，${result.productsUpserted} 条商品`)
        onSyncComplete()
        loadHistory()
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setLastResult(`导入失败：${msg}`)
    } finally {
      setIsImporting(false)
    }
  }

  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/10 px-4 py-2">
      {/* Import button */}
      <button
        type="button"
        onClick={handleImportFile}
        disabled={isImporting}
        className="shrink-0 rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600 disabled:opacity-40"
      >
        {isImporting ? '导入中...' : '导入 JSON'}
      </button>

      {/* Result message */}
      {lastResult && (
        <span className="shrink-0 text-xs text-zinc-400">{lastResult}</span>
      )}

      {/* Sync history */}
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {history.length === 0 ? (
          <span className="text-xs text-zinc-500">暂无同步记录</span>
        ) : (
          history.map((entry) => (
            <span key={entry.id} className="shrink-0 text-[10px] text-zinc-500">
              {formatTime(entry.syncedAt)} · {entry.productsCount} 商品
            </span>
          ))
        )}
      </div>
    </div>
  )
}

export { SyncPanel }
