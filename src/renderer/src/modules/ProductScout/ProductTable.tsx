import type * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@renderer/lib/utils'

type ScoutProduct = {
  id: string
  keywordId: string
  productName: string
  productUrl: string
  price: number | null
  addCart24h: string | null
  addCart24hValue: number
  totalSales: string | null
  threeMonthBuyers: string | null
  addCartTag: string | null
  positiveReviewTag: string | null
  collectionTag: string | null
  reviewCount: number
  productRating: number | null
  shopName: string | null
  shopUrl: string | null
  shopFans: string | null
  shopSales: string | null
  shopRating: number | null
  sortMode: string | null
  rankPosition: number | null
  firstSeenAt: number
  lastUpdatedAt: number
}

type SortKey = 'add_cart_24h_value' | 'price' | 'product_rating' | 'review_count' | 'rank_position' | 'last_updated_at'

type Props = {
  keywordId: string
}

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'add_cart_24h_value', label: '24h加购' },
  { key: 'price', label: '价格' },
  { key: 'product_rating', label: '评分' },
  { key: 'review_count', label: '评价数' },
  { key: 'rank_position', label: '排名' },
  { key: 'last_updated_at', label: '更新时间' }
]

function ProductTable({ keywordId }: Props): React.JSX.Element {
  const [products, setProducts] = useState<ScoutProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('add_cart_24h_value')
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC')

  const loadProducts = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await window.api.cms.scout.product.list({
        keywordId,
        sortBy,
        sortOrder,
        limit: 200
      })
      setProducts(list)
    } catch (error) {
      console.error('Failed to load products:', error)
    } finally {
      setIsLoading(false)
    }
  }, [keywordId, sortBy, sortOrder])

  useEffect(() => {
    loadProducts()
  }, [loadProducts])

  const handleSortClick = (key: SortKey): void => {
    if (key === sortBy) {
      setSortOrder((prev) => (prev === 'DESC' ? 'ASC' : 'DESC'))
    } else {
      setSortBy(key)
      setSortOrder('DESC')
    }
  }

  const handleExport = async (): Promise<void> => {
    try {
      const path = await window.api.cms.scout.export.excel({ keywordId })
      if (path) {
        console.log('Exported to:', path)
      }
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/10 text-sm text-zinc-400">
        加载中...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/10">
      {/* Header with sort + export */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">{products.length} 商品</span>
          <div className="flex gap-1">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => handleSortClick(opt.key)}
                className={cn(
                  'rounded px-2 py-0.5 text-[10px] transition-colors',
                  sortBy === opt.key
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {opt.label}
                {sortBy === opt.key && (sortOrder === 'DESC' ? ' ↓' : ' ↑')}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="rounded bg-zinc-700 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-600"
        >
          导出 Excel
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {products.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-500">
            暂无数据，请先同步或导入
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-900/95">
              <tr className="border-b border-zinc-800 text-left text-zinc-400">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="min-w-[180px] px-3 py-2 font-medium">商品名称</th>
                <th className="px-3 py-2 font-medium">价格</th>
                <th className="px-3 py-2 font-medium">24h加购</th>
                <th className="px-3 py-2 font-medium">销量</th>
                <th className="px-3 py-2 font-medium">3月购买</th>
                <th className="px-3 py-2 font-medium">评分</th>
                <th className="px-3 py-2 font-medium">评价数</th>
                <th className="min-w-[100px] px-3 py-2 font-medium">店铺</th>
                <th className="px-3 py-2 font-medium">店铺评分</th>
                <th className="px-3 py-2 font-medium">首次发现</th>
                <th className="px-3 py-2 font-medium">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, i) => (
                <tr
                  key={p.id}
                  className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30"
                >
                  <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                  <td className="max-w-[250px] truncate px-3 py-2 text-zinc-200" title={p.productName}>
                    {p.productName}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {p.price != null ? `¥${p.price}` : '-'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-orange-900/30 px-1.5 py-0.5 text-orange-300">
                      {p.addCart24hValue > 0 ? p.addCart24hValue.toLocaleString() : '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{p.totalSales || '-'}</td>
                  <td className="px-3 py-2 text-zinc-300">{p.threeMonthBuyers || '-'}</td>
                  <td className="px-3 py-2 text-zinc-300">
                    {p.productRating != null ? p.productRating.toFixed(1) : '-'}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {p.reviewCount > 0 ? p.reviewCount.toLocaleString() : '-'}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 text-zinc-300" title={p.shopName ?? ''}>
                    {p.shopName || '-'}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {p.shopRating != null ? p.shopRating.toFixed(1) : '-'}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{formatTime(p.firstSeenAt)}</td>
                  <td className="px-3 py-2 text-zinc-500">{formatTime(p.lastUpdatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export { ProductTable }
