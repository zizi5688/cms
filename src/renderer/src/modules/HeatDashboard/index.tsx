import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@renderer/lib/utils'
import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { useCmsStore } from '@renderer/store/useCmsStore'

type DashboardMeta = {
  latestDate: string | null
  availableDates: string[]
  totalKeywords: number
  totalProducts: number
  lastImportAt: number | null
}

type KeywordHeat = {
  keyword: string
  todayHeat: number
  prevHeat: number | null
  deltaHeat: number | null
  growthRate: number | null
  productCount: number
  isAlert: boolean
  isRising2d: boolean
}

type TrendSeries = {
  keyword: string
  values: number[]
  max: number
  min: number
  volatility: number
}

type PotentialProduct = {
  productKey: string
  keyword: string
  productName: string
  productUrl: string | null
  cachedImageUrl: string | null
  price: number | null
  addCart24hValue: number
  prevAddCart24hValue: number | null
  deltaAddCart24h: number | null
  isNew: boolean
  firstSeenAt: number
  lastUpdatedAt: number
  shopName: string | null
  shopFans: string | null
  potentialScore: number
  suggestedAction: '优先种草' | '继续观察' | '暂缓'
}

type MarkedProduct = {
  id: string
  snapshotDate: string
  productKey: string
  keyword: string
  productName: string
  productUrl: string | null
  salePrice: number | null
  sourceImage1: string | null
  sourceImage2: string | null
  supplier1Name: string | null
  supplier1Url: string | null
  supplier1Price: number | null
  supplier2Name: string | null
  supplier2Url: string | null
  supplier2Price: number | null
  supplier3Name: string | null
  supplier3Url: string | null
  supplier3Price: number | null
  profit1: number | null
  profit2: number | null
  profit3: number | null
  bestProfitAmount: number | null
  sourcingStatus: 'idle' | 'running' | 'success' | 'failed'
  sourcingMessage: string | null
  sourcingUpdatedAt: number | null
  createdAt: number
  updatedAt: number
}

type KeywordRadarItem = {
  id: string
  keyword: string
  isSurging: boolean
  dailyGrowth: number | null
  trendData: number[]
}

type ProductCardModel = {
  id: string
  keyword: string
  name: string
  imageUrl: string | null
  productUrl: string | null
  price: number | null
  profit: number | null
  bestSupplierName: string | null
  bestSupplierUrl: string | null
  profitLevel: 'high' | 'medium' | 'low'
  potential: PotentialProduct
}

type BestSupplierInfo = {
  name: string | null
  url: string | null
  profit: number | null
}

type SourcingSupplierCandidate = {
  id: string
  name: string
  companyName: string | null
  url: string | null
  purchasePrice: number | null
  freightPrice: number | null
  moq: string | null
  netProfit: number | null
  netProfitRate: number | null
  serviceRateLabel: string
}

type SourcingSearchResult = {
  supplierName: string
  supplierTitle: string | null
  companyName: string | null
  price: number
  freightPrice: number | null
  moq: string
  repurchaseRate: string | null
  serviceRate48h: string | null
  imgUrl: string
  detailUrl: string
  netProfit: number
  isFallback: boolean
}

type SourcingDebugResult = {
  error: 'DEBUG_MODE_ACTIVE'
  url: string
}

type SourcingSearchResponse = SourcingSearchResult[] | SourcingDebugResult

function HeatDashboard(): React.JSX.Element {
  const workspacePath = useCmsStore((s) => s.workspacePath)
  const selectedKeywordId = useCmsStore((s) => s.selectedKeywordId)
  const selectedProductId = useCmsStore((s) => s.selectedProductId)
  const setSelectedKeywordId = useCmsStore((s) => s.setSelectedKeywordId)
  const setSelectedProductId = useCmsStore((s) => s.setSelectedProductId)

  const [meta, setMeta] = useState<DashboardMeta | null>(null)
  const [keywordHeat, setKeywordHeat] = useState<KeywordHeat[]>([])
  const [trendSeries, setTrendSeries] = useState<TrendSeries[]>([])
  const [potentialProducts, setPotentialProducts] = useState<PotentialProduct[]>([])
  const [markedProducts, setMarkedProducts] = useState<MarkedProduct[]>([])

  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false)
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [isMarkingTodo, setIsMarkingTodo] = useState(false)
  const [isSourcing, setIsSourcing] = useState(false)
  const [isSourcingRunning, setIsSourcingRunning] = useState(false)
  const [isBindingSupplier, setIsBindingSupplier] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [quickLookProductId, setQuickLookProductId] = useState<string | null>(null)
  const [queuedImageMap, setQueuedImageMap] = useState<Record<string, string>>({})
  const [queueLoadingMap, setQueueLoadingMap] = useState<Record<string, boolean>>({})
  const [sourcingMarked, setSourcingMarked] = useState<MarkedProduct | null>(null)
  const [sourcingSearchCandidates, setSourcingSearchCandidates] = useState<SourcingSupplierCandidate[] | null>(null)
  const [selectedSupplierIndex, setSelectedSupplierIndex] = useState(0)

  const keywordRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [focusedKeywordIndex, setFocusedKeywordIndex] = useState(0)
  const requestedQueueProductIdsRef = useRef<Set<string>>(new Set())

  const snapshotDate = meta?.latestDate ?? ''

  const loadMeta = useCallback(async (): Promise<void> => {
    const nextMeta = await window.api.cms.scout.dashboard.meta()
    setMeta(nextMeta)
  }, [])

  const loadKeywordsAndTrends = useCallback(async (): Promise<void> => {
    if (!snapshotDate) {
      setKeywordHeat([])
      setTrendSeries([])
      return
    }

    setIsLoadingKeywords(true)
    try {
      const [keywords, trends] = await Promise.all([
        window.api.cms.scout.dashboard.keywordHeat({ snapshotDate, limit: 60 }) as Promise<
          KeywordHeat[]
        >,
        window.api.cms.scout.dashboard.trends({ snapshotDate, days: 7, limit: 60 }) as Promise<{
          dates: string[]
          series: TrendSeries[]
        }>
      ])
      setKeywordHeat(keywords)
      setTrendSeries(trends.series)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`读取关键词失败：${msg}`)
    } finally {
      setIsLoadingKeywords(false)
    }
  }, [snapshotDate])

  const loadProducts = useCallback(async (): Promise<void> => {
    if (!snapshotDate || !selectedKeywordId) {
      setPotentialProducts([])
      setMarkedProducts([])
      return
    }

    setIsLoadingProducts(true)
    try {
      const [products, marked] = await Promise.all([
        window.api.cms.scout.dashboard.potentialProducts({
          snapshotDate,
          keyword: selectedKeywordId,
          limit: 120,
          sortBy: 'potentialScore',
          sortOrder: 'DESC'
        }) as Promise<PotentialProduct[]>,
        window.api.cms.scout.dashboard.markedProducts({
          snapshotDate,
          keyword: selectedKeywordId
        }) as Promise<MarkedProduct[]>
      ])
      setPotentialProducts(products)
      setMarkedProducts(marked)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`读取商品失败：${msg}`)
    } finally {
      setIsLoadingProducts(false)
    }
  }, [selectedKeywordId, snapshotDate])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    void loadKeywordsAndTrends()
  }, [loadKeywordsAndTrends])

  const trendMap = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const row of trendSeries) map.set(row.keyword, row.values ?? [])
    return map
  }, [trendSeries])

  const keywordItems = useMemo<KeywordRadarItem[]>(() => {
    return keywordHeat.map((item) => ({
      id: item.keyword,
      keyword: item.keyword,
      isSurging: item.isAlert || item.isRising2d,
      dailyGrowth: item.growthRate,
      trendData: trendMap.get(item.keyword) ?? []
    }))
  }, [keywordHeat, trendMap])

  useEffect(() => {
    if (keywordItems.length === 0) {
      if (selectedKeywordId) setSelectedKeywordId(null)
      return
    }

    const stillExists = selectedKeywordId
      ? keywordItems.some((item) => item.id === selectedKeywordId)
      : false
    if (!stillExists) {
      setSelectedKeywordId(keywordItems[0].id)
    }
  }, [keywordItems, selectedKeywordId, setSelectedKeywordId])

  useEffect(() => {
    const selectedIdx = keywordItems.findIndex((item) => item.id === selectedKeywordId)
    setFocusedKeywordIndex(selectedIdx >= 0 ? selectedIdx : 0)
  }, [keywordItems, selectedKeywordId])

  useEffect(() => {
    void loadProducts()
  }, [loadProducts])

  useEffect(() => {
    setQueuedImageMap({})
    setQueueLoadingMap({})
    requestedQueueProductIdsRef.current.clear()
  }, [selectedKeywordId, snapshotDate])

  useEffect(() => {
    return window.api.cms.scout.dashboard.onXhsImageUpdated(({ productId, imageUrl }) => {
      setQueuedImageMap((prev) => {
        if (prev[productId] === imageUrl) return prev
        return { ...prev, [productId]: imageUrl }
      })
      setQueueLoadingMap((prev) => {
        if (!prev[productId]) return prev
        const next = { ...prev }
        delete next[productId]
        return next
      })
      setMarkedProducts((prev) =>
        prev.map((item) =>
          item.productKey === productId && !item.sourceImage1
            ? { ...item, sourceImage1: imageUrl, updatedAt: Date.now() }
            : item
        )
      )
    })
  }, [])

  const markedByProductKey = useMemo(() => {
    const map = new Map<string, MarkedProduct>()
    for (const item of markedProducts) map.set(item.productKey, item)
    return map
  }, [markedProducts])

  const productCards = useMemo<ProductCardModel[]>(() => {
    return potentialProducts.map((item) => {
      const marked = markedByProductKey.get(item.productKey)
      const bestSupplier = pickBestSupplier(marked)
      const rawProfit = bestSupplier.profit ?? marked?.bestProfitAmount ?? item.potentialScore * 10

      return {
        id: item.productKey,
        keyword: item.keyword,
        name: item.productName,
        imageUrl:
          queuedImageMap[item.productKey] ??
          marked?.sourceImage1 ??
          marked?.sourceImage2 ??
          item.cachedImageUrl ??
          null,
        productUrl: item.productUrl,
        price: item.price,
        profit: Number.isFinite(rawProfit) ? rawProfit : null,
        bestSupplierName: bestSupplier.name,
        bestSupplierUrl: bestSupplier.url,
        profitLevel: toProfitLevel(rawProfit),
        potential: item
      }
    })
  }, [markedByProductKey, potentialProducts, queuedImageMap])

  const enqueueMissingCoverFetch = useCallback((productId: string, xiaohongshuUrl: string): void => {
    const normalizedProductId = String(productId ?? '').trim()
    const normalizedUrl = String(xiaohongshuUrl ?? '').trim()
    if (!normalizedProductId || !normalizedUrl) return
    if (!isLikelyXhsGoodsDetailUrl(normalizedUrl)) return
    if (requestedQueueProductIdsRef.current.has(normalizedProductId)) return
    requestedQueueProductIdsRef.current.add(normalizedProductId)
    setQueueLoadingMap((prev) => ({ ...prev, [normalizedProductId]: true }))
    window.api.cms.scout.dashboard.fetchXhsImage({
      productId: normalizedProductId,
      xiaohongshuUrl: normalizedUrl
    })
  }, [])

  useEffect(() => {
    if (productCards.length === 0) {
      if (selectedProductId) setSelectedProductId(null)
      return
    }
    const exists = selectedProductId
      ? productCards.some((item) => item.id === selectedProductId)
      : false
    if (!exists) {
      setSelectedProductId(productCards[0].id)
    }
  }, [productCards, selectedProductId, setSelectedProductId])

  const selectedProduct = useMemo(
    () => productCards.find((item) => item.id === selectedProductId) ?? null,
    [productCards, selectedProductId]
  )

  const quickLookProduct = useMemo(
    () => productCards.find((item) => item.id === quickLookProductId) ?? null,
    [productCards, quickLookProductId]
  )

  const handleSelectKeyword = useCallback(
    (keywordId: string) => {
      setSelectedKeywordId(keywordId)
      setSelectedProductId(null)
    },
    [setSelectedKeywordId, setSelectedProductId]
  )

  const handleKeywordListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()

      const delta = event.key === 'ArrowDown' ? 1 : -1
      const total = keywordItems.length
      if (total === 0) return

      const next = (index + delta + total) % total
      setFocusedKeywordIndex(next)
      const nextItem = keywordItems[next]
      if (nextItem) {
        handleSelectKeyword(nextItem.id)
        keywordRefs.current[next]?.focus()
      }
    },
    [handleSelectKeyword, keywordItems]
  )

  useEffect(() => {
    setIsSourcing(false)
    setIsSourcingRunning(false)
    setIsBindingSupplier(false)
    setSourcingMarked(null)
    setSourcingSearchCandidates(null)
    setSelectedSupplierIndex(0)
  }, [selectedKeywordId, selectedProductId])

  const saveSelectedProduct = useCallback(async () => {
    if (!selectedProduct || !snapshotDate) return null
    const result = await window.api.cms.scout.dashboard.markPotential({
      snapshotDate,
      products: [
        {
          productKey: selectedProduct.id,
          keyword: selectedProduct.keyword,
          productName: selectedProduct.name,
          productUrl: selectedProduct.productUrl,
          salePrice: selectedProduct.price
        }
      ]
    })
    const marked = (await window.api.cms.scout.dashboard.markedProducts({
      snapshotDate,
      keyword: selectedKeywordId ?? undefined
    })) as MarkedProduct[]
    setMarkedProducts(marked)
    return { result, marked }
  }, [selectedKeywordId, selectedProduct, snapshotDate])

  const sourcingCandidates = useMemo<SourcingSupplierCandidate[]>(() => {
    if (Array.isArray(sourcingSearchCandidates)) return sourcingSearchCandidates
    return buildSourcingCandidates(sourcingMarked)
  }, [sourcingMarked, sourcingSearchCandidates])

  useEffect(() => {
    if (selectedSupplierIndex < sourcingCandidates.length) return
    setSelectedSupplierIndex(0)
  }, [selectedSupplierIndex, sourcingCandidates.length])

  useEffect(() => {
    const offLoginNeeded = window.api.cms.scout.dashboard.onSourcingLoginNeeded(() => {
      setStatusText('检测到 1688 未登录，请在弹出的窗口完成登录后继续。')
    })
    const offCaptchaNeeded = window.api.cms.scout.dashboard.onSourcingCaptchaNeeded(() => {
      setStatusText('检测到验证码，请在弹出的窗口中完成验证后继续。')
    })
    return () => {
      offLoginNeeded()
      offCaptchaNeeded()
    }
  }, [])

  const handleAddTodo = useCallback(async (): Promise<void> => {
    if (!selectedProduct || !snapshotDate) {
      setStatusText('请先选择商品后再加入待办')
      return
    }
    setIsMarkingTodo(true)
    try {
      const saved = await saveSelectedProduct()
      if (!saved) {
        setStatusText('加入待办失败：未找到当前商品')
        return
      }
      const { result } = saved
      setStatusText(`加入待办成功：新增 ${result.upserted}，已存在 ${result.skipped}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`加入待办失败：${msg}`)
    } finally {
      setIsMarkingTodo(false)
    }
  }, [saveSelectedProduct, selectedProduct, snapshotDate])

  const handleStartSourcing = useCallback(async (): Promise<void> => {
    if (!selectedProduct || !snapshotDate) {
      setStatusText('请先选择商品后再执行搜同款')
      return
    }

    setIsSourcing(true)
    setIsSourcingRunning(true)
    setSelectedSupplierIndex(0)
    setSourcingSearchCandidates([])
    try {
      const saved = await saveSelectedProduct()
      if (!saved) {
        setStatusText('搜同款失败：未找到当前商品')
        return
      }
      const targetMarked = saved.marked.find((item) => item.productKey === selectedProduct.id) ?? null
      if (!targetMarked) {
        setStatusText('搜同款失败：商品未成功加入待办')
        return
      }
      const imageUrl = pickSourcingImageUrl(
        selectedProduct.potential.cachedImageUrl,
        targetMarked.sourceImage1
      )
      if (!imageUrl) {
        setStatusText('搜同款失败：未找到可用主图（cover_cache/source_image_1）')
        return
      }
      const targetPrice = targetMarked.salePrice ?? selectedProduct.price
      if (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0) {
        setStatusText('搜同款失败：目标售价无效')
        return
      }
      const keyword = selectedProduct.name || targetMarked.productName || targetMarked.keyword
      const response = (await window.api.cms.scout.dashboard.search1688ByImage({
        imageUrl,
        targetPrice,
        productId: targetMarked.productKey,
        keyword
      })) as SourcingSearchResponse
      if (isSourcingDebugResult(response)) {
        const now = Date.now()
        const manualMarked: MarkedProduct = {
          ...targetMarked,
          sourceImage1: imageUrl,
          sourcingStatus: 'running',
          sourcingMessage: `人工介入中：${response.url}`,
          sourcingUpdatedAt: now,
          updatedAt: now
        }
        setSourcingMarked(manualMarked)
        setMarkedProducts((prev) => {
          const idx = prev.findIndex((item) => item.id === manualMarked.id)
          if (idx < 0) return [manualMarked, ...prev]
          const next = prev.slice()
          next[idx] = manualMarked
          return next
        })
        setSourcingSearchCandidates([])
        setStatusText(`进入法医调试模式：请在弹出的 1688 窗口手动处理，当前页面 ${response.url}`)
        return
      }
      const results = response
      const sourced = mergeSourcingResultIntoMarked(targetMarked, imageUrl, results)
      setSourcingSearchCandidates(buildSourcingCandidatesFromSearchResults(results, targetPrice))
      setSourcingMarked(sourced)
      setMarkedProducts((prev) => {
        const idx = prev.findIndex((item) => item.id === sourced.id)
        if (idx < 0) return [sourced, ...prev]
        const next = prev.slice()
        next[idx] = sourced
        return next
      })
      setSelectedSupplierIndex(pickSupplierIndexByBestProfit(sourced))

      if (sourced.sourcingStatus === 'failed') {
        setStatusText(`搜同款失败：${sourced.sourcingMessage ?? '未命中供应商'}`)
        return
      }
      const withFallback = results.some((item) => item.isFallback)
      setStatusText(`搜同款完成（${withFallback ? '关键词兜底' : '图搜'}），选择候选供应商后点击“绑定供应商”保存。`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`搜同款失败：${msg}`)
    } finally {
      setIsSourcingRunning(false)
    }
  }, [saveSelectedProduct, selectedProduct, snapshotDate])

  const handleBindSupplier = useCallback(async (): Promise<void> => {
    if (!selectedProduct || !snapshotDate) {
      setStatusText('请先选择商品后再绑定供应商')
      return
    }
    const chosen = sourcingCandidates[selectedSupplierIndex] ?? null
    if (!chosen) {
      setStatusText('请先选择候选供应商后再绑定')
      return
    }
    setIsBindingSupplier(true)
    try {
      const saved = (await window.api.cms.scout.dashboard.bindSupplier({
        snapshotDate,
        productKey: selectedProduct.id,
        supplierName: chosen.name,
        companyName: chosen.companyName,
        supplierUrl: chosen.url,
        supplierPrice: chosen.purchasePrice,
        supplierNetProfit: chosen.netProfit,
        supplierMoq: chosen.moq,
        supplierFreightPrice: chosen.freightPrice,
        supplierServiceRateLabel: chosen.serviceRateLabel,
        sourceImage1: sourcingMarked?.sourceImage1 ?? selectedProduct.imageUrl ?? null
      })) as MarkedProduct | null
      if (!saved) {
        setStatusText('绑定失败：未找到待办记录，请先加入待办后重试')
        return
      }
      setSourcingMarked(saved)
      setMarkedProducts((prev) => {
        const idx = prev.findIndex((item) => item.id === saved.id || item.productKey === saved.productKey)
        if (idx < 0) return [saved, ...prev]
        const next = prev.slice()
        next[idx] = saved
        return next
      })
      setStatusText(`供应商绑定完成：${saved.supplier1Name ?? chosen.name ?? '未命名店铺'}`)
      setIsSourcing(false)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`绑定失败：${msg}`)
    } finally {
      setIsBindingSupplier(false)
    }
  }, [selectedProduct, selectedSupplierIndex, snapshotDate, sourcingCandidates, sourcingMarked])

  const handleCopyLink = useCallback(async (): Promise<void> => {
    if (!selectedProduct?.productUrl) {
      setStatusText('当前商品没有可复制链接')
      return
    }

    try {
      await navigator.clipboard.writeText(selectedProduct.productUrl)
      setStatusText('商品链接已复制')
    } catch {
      setStatusText('复制失败，请检查剪贴板权限')
    }
  }, [selectedProduct?.productUrl])

  const handleQuickPurchase = useCallback((): void => {
    if (!selectedProduct) return
    const target = selectedProduct.bestSupplierUrl || selectedProduct.productUrl
    if (!target) {
      setStatusText('没有可打开的采购链接')
      return
    }
    window.open(target, '_blank', 'noopener,noreferrer')
  }, [selectedProduct])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      if (!selectedProductId) return
      event.preventDefault()
      void handleAddTodo()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleAddTodo, selectedProductId])

  const sourcingTargetImage =
    sourcingMarked?.sourceImage1 ??
    sourcingMarked?.sourceImage2 ??
    selectedProduct?.imageUrl ??
    null
  const sourcingTargetPrice = sourcingMarked?.salePrice ?? selectedProduct?.price ?? null

  return (
    <div className="relative h-full w-full bg-zinc-950 text-zinc-100">
      <div
        className={cn(
          'grid h-full w-full',
          isSourcing ? 'pb-[276px]' : selectedProduct ? 'pb-16' : 'pb-0'
        )}
        style={{ gridTemplateColumns: '320px minmax(0, 1fr)' }}
      >
        <aside className="flex h-full min-h-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 bg-zinc-900/90 px-3 py-2.5">
            <div className="text-sm font-semibold text-zinc-100">趋势雷达</div>
            <div className="mt-1 text-xs text-zinc-400">
              {snapshotDate ? `快照日：${snapshotDate}` : '暂无快照数据'}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-900/80 p-1">
            {keywordItems.length === 0 && !isLoadingKeywords ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-4 text-xs text-zinc-500">
                暂无关键词数据
              </div>
            ) : (
              <ul className="space-y-4">
                {keywordItems.map((item, index) => (
                  <li key={item.id}>
                    <TrendKeywordListItem
                      item={item}
                      active={item.id === selectedKeywordId}
                      tabIndex={focusedKeywordIndex === index ? 0 : -1}
                      onClick={() => handleSelectKeyword(item.id)}
                      onKeyDown={(event) => handleKeywordListKeyDown(event, index)}
                      ref={(el) => {
                        keywordRefs.current[index] = el
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto bg-zinc-800/45">
          <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/92 px-4 py-3 backdrop-blur">
            <div className="text-sm text-zinc-200">
              {selectedKeywordId ? `关键词：${selectedKeywordId}` : '请选择关键词'}
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              关键词 {meta?.totalKeywords ?? 0} 个，商品 {meta?.totalProducts ?? 0} 个
            </div>
            {statusText && <div className="mt-1 text-xs text-zinc-400">{statusText}</div>}
          </header>

          <div className="p-4">
            {productCards.length === 0 && !isLoadingProducts ? (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-6 text-sm text-zinc-400">
                当前关键词暂无商品数据
              </div>
            ) : (
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))'
                }}
              >
                {productCards.map((card) => (
                  <ProductCard
                    key={card.id}
                    card={card}
                    workspacePath={workspacePath}
                    focused={card.id === selectedProductId}
                    onSelect={() => setSelectedProductId(card.id)}
                    onQuickLook={() => setQuickLookProductId(card.id)}
                    onRequestMissingImage={enqueueMissingCoverFetch}
                    isImageFetching={queueLoadingMap[card.id] === true}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {selectedProduct && (
        <footer className="absolute bottom-0 left-0 right-0 z-30 h-16 border-t border-zinc-700 bg-zinc-900/95">
          <div className="flex h-full items-center gap-4 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="h-11 w-9 shrink-0 overflow-hidden rounded border border-zinc-700 bg-zinc-800">
                <SelectedThumb
                  src={selectedProduct.imageUrl}
                  alt={selectedProduct.name}
                  workspacePath={workspacePath}
                />
              </div>

              <div className="min-w-0">
                <div className="truncate text-sm text-zinc-100" title={selectedProduct.name}>
                  {selectedProduct.name}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <div className="truncate text-xs text-zinc-400">
                最优供应商：{selectedProduct.bestSupplierName || '待抓取'}
              </div>
              <div className="text-xl font-bold leading-tight text-emerald-400">
                净利: {formatMoney(selectedProduct.profit)}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="rounded border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
                onClick={() => void handleStartSourcing()}
                disabled={isSourcingRunning}
              >
                {isSourcingRunning ? '搜同款中...' : '搜同款'}
              </button>
              <button
                type="button"
                className="rounded border border-zinc-600 bg-transparent px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
                onClick={handleQuickPurchase}
              >
                一键采购
              </button>
              <button
                type="button"
                className="rounded border border-zinc-600 bg-transparent px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800"
                onClick={() => void handleCopyLink()}
              >
                复制链接
              </button>
              <button
                type="button"
                className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                onClick={() => void handleAddTodo()}
                disabled={isMarkingTodo}
                title="快捷键：Cmd/Ctrl + S"
              >
                {isMarkingTodo ? '加入中...' : '加入待办'}
              </button>
            </div>
          </div>
        </footer>
      )}

      <SourcingPanel
        isOpen={isSourcing}
        isRunning={isSourcingRunning}
        workspacePath={workspacePath}
        xhsImage={sourcingTargetImage}
        targetPrice={sourcingTargetPrice}
        candidates={sourcingCandidates}
        selectedSupplierIndex={selectedSupplierIndex}
        onSelectSupplier={setSelectedSupplierIndex}
        onClose={() => setIsSourcing(false)}
        onBindSupplier={() => void handleBindSupplier()}
        isBinding={isBindingSupplier}
      />

      {quickLookProduct && (
        <QuickLookModal
          product={quickLookProduct}
          workspacePath={workspacePath}
          onClose={() => setQuickLookProductId(null)}
        />
      )}
    </div>
  )
}

type TrendKeywordListItemProps = {
  item: KeywordRadarItem
  active: boolean
  tabIndex: number
  onClick: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}

const TrendKeywordListItem = React.forwardRef<HTMLButtonElement, TrendKeywordListItemProps>(
  function TrendKeywordListItem(
    { item, active, tabIndex, onClick, onKeyDown },
    ref
  ): React.JSX.Element {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'h-16 w-full rounded-md px-2 py-1 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500',
          active ? 'bg-gray-800 text-zinc-100' : 'bg-transparent text-zinc-300 hover:bg-gray-800'
        )}
        onClick={onClick}
        onKeyDown={onKeyDown}
        tabIndex={tabIndex}
      >
        <div className="flex items-center gap-1 text-sm font-semibold">
          <span className="truncate">{item.keyword}</span>
          {item.isSurging && <span aria-label="surging">🔥</span>}
        </div>

        <div className="mt-0.5 h-4 w-full">
          <KeywordSparkline data={item.trendData} growth={item.dailyGrowth} />
        </div>

        <div className="mt-0.5 text-[10px] text-zinc-400">
          增长: {formatGrowth(item.dailyGrowth)}
        </div>
      </button>
    )
  }
)

function KeywordSparkline({
  data,
  growth
}: {
  data: number[]
  growth: number | null
}): React.JSX.Element {
  if (!Array.isArray(data) || data.length < 2) {
    return <div className="text-xs text-zinc-500">正在收集数据...</div>
  }

  const width = 100
  const height = 16
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const isRising = growth != null && growth > 0
  const stroke = isRising ? '#FF4D4F' : '#10B981'
  const gradientId = isRising ? 'grad-red' : 'grad-green'

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return { x, y }
  })
  const linePath = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-full w-full">
      <defs>
        <linearGradient id="grad-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10B981" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="grad-red" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF4D4F" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#FF4D4F" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />

      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeOpacity="1"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type ProductCardProps = {
  card: ProductCardModel
  workspacePath: string
  focused: boolean
  onSelect: () => void
  onQuickLook: () => void
  onRequestMissingImage: (productId: string, xiaohongshuUrl: string) => void
  isImageFetching: boolean
}

function ProductCard({
  card,
  workspacePath,
  focused,
  onSelect,
  onQuickLook,
  onRequestMissingImage,
  isImageFetching
}: ProductCardProps): React.JSX.Element {
  useEffect(() => {
    if (hasValidImageUrl(card.imageUrl)) return
    if (!isLikelyXhsGoodsDetailUrl(card.productUrl)) return
    onRequestMissingImage(card.id, card.productUrl ?? '')
  }, [card.id, card.imageUrl, card.productUrl, onRequestMissingImage])

  return (
    <article
      className={cn(
        'group aspect-[3/4] rounded-lg bg-gray-800/90 p-1.5 transition duration-200',
        focused
          ? 'bg-gray-700/95 shadow-[0_0_0_1px_rgba(113,113,122,0.9)]'
          : 'hover:-translate-y-0.5 hover:bg-gray-700/85'
      )}
    >
      <button
        type="button"
        className="flex h-full w-full flex-col gap-1.5 text-left focus:outline-none"
        onClick={onSelect}
        onFocus={onSelect}
        onKeyDown={(event) => {
          if (event.key === ' ') {
            event.preventDefault()
            onQuickLook()
          }
        }}
      >
        <div className="h-[85%] min-h-0">
          <ProductImage
            key={`${card.id}:${card.imageUrl ?? 'none'}`}
            src={card.imageUrl}
            alt={card.name}
            workspacePath={workspacePath}
            price={card.price}
            profitLevel={card.profitLevel}
            isFetching={isImageFetching}
          />
        </div>

        <div className="flex h-[15%] min-h-0 items-center px-1">
          <div className="w-full truncate text-xs text-zinc-100" title={card.name}>
            {card.name}
          </div>
        </div>
      </button>
    </article>
  )
}

function ProductImage({
  src,
  alt,
  workspacePath,
  price,
  profitLevel,
  isFetching
}: {
  src: string | null
  alt: string
  workspacePath: string
  price: number | null
  profitLevel: 'high' | 'medium' | 'low'
  isFetching: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [isInView, setIsInView] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || isInView) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '180px 0px' }
    )

    observer.observe(host)
    return () => observer.disconnect()
  }, [isInView])

  const resolvedSrc = useMemo(() => {
    if (!src) return ''
    return resolveLocalImage(src, workspacePath)
  }, [src, workspacePath])

  const showImage = Boolean(resolvedSrc && isInView && !hasError)

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-md bg-zinc-800">
      <div
        className={cn(
          'absolute inset-0 bg-zinc-700/90 transition-opacity',
          isLoaded ? 'opacity-0' : 'animate-pulse opacity-100'
        )}
      />

      {showImage ? (
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
            isLoaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true)
            setIsLoaded(false)
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-500">
          {src ? '图片加载中...' : isFetching ? '封面抓取中...' : '暂无图片'}
        </div>
      )}

      <div className="absolute bottom-1.5 left-1.5 rounded-sm bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
        {formatMoney(price)}
      </div>

      <ProfitDot level={profitLevel} />
    </div>
  )
}

function SelectedThumb({
  src,
  alt,
  workspacePath
}: {
  src: string | null
  alt: string
  workspacePath: string
}): React.JSX.Element {
  const resolved = src ? resolveLocalImage(src, workspacePath) : ''
  if (!resolved) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
        无图
      </div>
    )
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  )
}

function ProfitDot({ level }: { level: 'high' | 'medium' | 'low' }): React.JSX.Element {
  const cls =
    level === 'high' ? 'bg-emerald-500' : level === 'medium' ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <span className={cn('absolute right-2 top-2 h-2 w-2 rounded-full', cls)} aria-hidden="true" />
  )
}

type QuickLookModalProps = {
  product: ProductCardModel
  workspacePath: string
  onClose: () => void
}

function QuickLookModal({
  product,
  workspacePath,
  onClose
}: QuickLookModalProps): React.JSX.Element {
  const src = product.imageUrl ? resolveLocalImage(product.imageUrl, workspacePath) : ''

  useEffect(() => {
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-[720px] max-w-full rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-100">快速预览 (Quick Look)</div>
            <div className="mt-1 text-xs text-zinc-400">{product.name}</div>
          </div>
          <button
            type="button"
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div
          className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800"
          style={{ aspectRatio: '3 / 4' }}
        >
          {src ? (
            <img
              src={src}
              alt={product.name}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">
              暂无图片
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type SourcingPanelProps = {
  isOpen: boolean
  isRunning: boolean
  isBinding: boolean
  workspacePath: string
  xhsImage: string | null
  targetPrice: number | null
  candidates: SourcingSupplierCandidate[]
  selectedSupplierIndex: number
  onSelectSupplier: (index: number) => void
  onBindSupplier: () => void
  onClose: () => void
}

function SourcingPanel({
  isOpen,
  isRunning,
  isBinding,
  workspacePath,
  xhsImage,
  targetPrice,
  candidates,
  selectedSupplierIndex,
  onSelectSupplier,
  onBindSupplier,
  onClose
}: SourcingPanelProps): React.JSX.Element {
  const resolvedTargetImage = xhsImage ? resolveLocalImage(xhsImage, workspacePath) : ''
  const selectedSupplier = candidates[selectedSupplierIndex] ?? null
  const bindDisabled = isRunning || isBinding || candidates.length === 0

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 z-50 px-4 pb-4 transition-all duration-300 ease-out',
        isOpen ? 'translate-y-0 opacity-100' : 'translate-y-[105%] opacity-0'
      )}
      aria-hidden={!isOpen}
    >
      <section className="pointer-events-auto rounded-xl border border-zinc-700 bg-[#1a1a1a] p-4 shadow-[0_-18px_45px_rgba(0,0,0,0.58)]">
        <div className="flex items-center justify-between border-b border-zinc-700 pb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/90">搜同款</div>
            <div className="mt-0.5 text-xs text-zinc-300">
              {isRunning ? '正在搜同款并提取供应商...' : '选择供应商后点击“绑定供应商”保存'}
            </div>
          </div>
          <button
            type="button"
            className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onClose}
            disabled={isRunning}
          >
            关闭
          </button>
        </div>

        <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: '1fr 4fr 1.2fr' }}>
          <div className="relative h-[208px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 p-1">
            {resolvedTargetImage ? (
              <img
                src={resolvedTargetImage}
                alt="xhs target"
                className="h-full w-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                暂无目标图
              </div>
            )}
            <div className="absolute left-2 top-2 rounded-md border border-amber-400/80 bg-black/80 px-2 py-1 text-[11px] font-semibold text-amber-300">
              目标售价: {formatMoney(targetPrice)}
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            {candidates.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {isRunning ? '供应商抓取中...' : '暂无供应商候选'}
              </div>
            ) : (
              <div className="flex h-full gap-2 overflow-x-auto pb-1">
                {candidates.map((candidate, index) => (
                  <SupplierCard
                    key={candidate.id}
                    candidate={candidate}
                    selected={index === selectedSupplierIndex}
                    onSelect={() => onSelectSupplier(index)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex h-[208px] flex-col justify-between rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-400">操作</div>
              <div className="mt-2 text-xs text-zinc-300">
                {selectedSupplier ? (
                  <>
                    <div className="truncate font-medium text-zinc-100">
                      {selectedSupplier.companyName || selectedSupplier.name}
                    </div>
                    <div className="mt-1 text-zinc-400">48h揽收: {selectedSupplier.serviceRateLabel}</div>
                  </>
                ) : (
                  <div className="text-zinc-500">请选择候选供应商</div>
                )}
              </div>
            </div>

            <button
              type="button"
              className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-bold text-zinc-950 shadow-[0_0_22px_rgba(16,185,129,0.3)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={bindDisabled}
              onClick={onBindSupplier}
            >
              {isBinding ? '保存中...' : '绑定供应商'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function SupplierCard({
  candidate,
  selected,
  onSelect
}: {
  candidate: SourcingSupplierCandidate
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const isHighMargin = (candidate.netProfitRate ?? 0) > 30
  const netProfitClass = isHighMargin ? 'text-emerald-300' : 'text-orange-300'
  const purchaseText = formatMoney(candidate.purchasePrice)
  const freightText = formatMoney(candidate.freightPrice)
  const moqText = candidate.moq ? String(candidate.moq).trim() : '--'
  const profitRateText =
    candidate.netProfitRate == null || !Number.isFinite(candidate.netProfitRate)
      ? '--%'
      : `${candidate.netProfitRate.toFixed(1)}%`
  const handleCardClick = (): void => {
    onSelect()
    if (!candidate.url) return
    void window.api.cms.system.openExternal(candidate.url).catch(() => void 0)
  }

  return (
    <button
      type="button"
      className={cn(
        'min-w-[220px] cursor-pointer rounded-md border bg-zinc-950/90 p-2 text-left transition hover:bg-gray-800',
        selected
          ? 'border-emerald-500/90 shadow-[0_0_0_1px_rgba(16,185,129,0.75)]'
          : 'border-zinc-800 hover:border-zinc-600'
      )}
      onClick={handleCardClick}
    >
      <div className="truncate text-xs font-semibold text-zinc-100">{candidate.name}</div>
      <div className="mt-1 text-[11px] text-zinc-400">48h揽收: {candidate.serviceRateLabel}</div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-900/80 p-1.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">进货价</div>
          <div className="mt-1 text-2xl font-black leading-none text-amber-300">{purchaseText}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/80 p-1.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">预估毛利</div>
          <div className={cn('mt-1 text-2xl font-black leading-none', netProfitClass)}>
            {formatMoney(candidate.netProfit)}
          </div>
          <div className={cn('mt-1 text-xs font-semibold', netProfitClass)}>{profitRateText}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
        <span>起批: {moqText}</span>
        <span>运费: {freightText}</span>
      </div>
    </button>
  )
}

function buildSourcingCandidates(marked: MarkedProduct | null): SourcingSupplierCandidate[] {
  if (!marked) return []

  const rawSuppliers = [
    {
      id: 'supplier-1',
      name: marked.supplier1Name,
      url: marked.supplier1Url,
      purchasePrice: marked.supplier1Price,
      netProfit: marked.profit1
    },
    {
      id: 'supplier-2',
      name: marked.supplier2Name,
      url: marked.supplier2Url,
      purchasePrice: marked.supplier2Price,
      netProfit: marked.profit2
    },
    {
      id: 'supplier-3',
      name: marked.supplier3Name,
      url: marked.supplier3Url,
      purchasePrice: marked.supplier3Price,
      netProfit: marked.profit3
    }
  ]

  const serviceRateLabels = extractServiceRateLabels(marked.sourcingMessage, rawSuppliers.length)

  return rawSuppliers
    .map((item, index) => {
      const normalizedName = String(item.name ?? '').trim()
      const hasPayload = Boolean(normalizedName || item.url || item.purchasePrice != null || item.netProfit != null)
      if (!hasPayload) return null
      return {
        id: item.id,
        name: normalizedName || `供应商 ${index + 1}`,
        companyName: null as string | null,
        url: item.url,
        purchasePrice: item.purchasePrice,
        freightPrice: null as number | null,
        moq: null as string | null,
        netProfit: item.netProfit,
        netProfitRate: calcNetProfitRate(marked.salePrice, item.netProfit),
        serviceRateLabel: serviceRateLabels[index] ?? '95%'
      }
    })
    .filter((item): item is SourcingSupplierCandidate => item != null)
}

function buildSourcingCandidatesFromSearchResults(
  results: SourcingSearchResult[],
  targetPrice: number | null
): SourcingSupplierCandidate[] {
  const fallback = ['98%', '95%', '92%', '89%', '85%']
  return results.map((item, index) => ({
    id: `search-${index + 1}`,
    name:
      normalizeTextValue(item.companyName) ||
      normalizeTextValue(item.supplierName) ||
      normalizeTextValue(item.supplierTitle) ||
      `店铺 ${index + 1}`,
    companyName: normalizeTextValue(item.companyName),
    url: item.detailUrl || null,
    purchasePrice: Number.isFinite(item.price) ? item.price : null,
    freightPrice: Number.isFinite(item.freightPrice) ? item.freightPrice : null,
    moq: normalizeTextValue(item.moq),
    netProfit: Number.isFinite(item.netProfit) ? item.netProfit : null,
    netProfitRate: calcNetProfitRate(targetPrice, Number.isFinite(item.netProfit) ? item.netProfit : null),
    serviceRateLabel:
      normalizeTextValue(item.serviceRate48h) ||
      normalizeTextValue(item.repurchaseRate) ||
      (fallback[index] ?? fallback[fallback.length - 1])
  }))
}

function mergeSourcingResultIntoMarked(
  marked: MarkedProduct,
  imageUrl: string,
  results: SourcingSearchResult[]
): MarkedProduct {
  const now = Date.now()
  const top = results.slice(0, 3)
  const p1 = Number.isFinite(top[0]?.netProfit) ? top[0]!.netProfit : null
  const p2 = Number.isFinite(top[1]?.netProfit) ? top[1]!.netProfit : null
  const p3 = Number.isFinite(top[2]?.netProfit) ? top[2]!.netProfit : null
  return {
    ...marked,
    sourceImage1: imageUrl,
    supplier1Name: getSupplierDisplayName(top[0]),
    supplier1Url: top[0]?.detailUrl ?? null,
    supplier1Price: Number.isFinite(top[0]?.price) ? top[0]!.price : null,
    supplier2Name: getSupplierDisplayName(top[1]),
    supplier2Url: top[1]?.detailUrl ?? null,
    supplier2Price: Number.isFinite(top[1]?.price) ? top[1]!.price : null,
    supplier3Name: getSupplierDisplayName(top[2]),
    supplier3Url: top[2]?.detailUrl ?? null,
    supplier3Price: Number.isFinite(top[2]?.price) ? top[2]!.price : null,
    profit1: p1,
    profit2: p2,
    profit3: p3,
    bestProfitAmount: getBestProfit([p1, p2, p3]),
    sourcingStatus: results.length > 0 ? 'success' : 'failed',
    sourcingMessage:
      results.length > 0
        ? `完成：${results.some((item) => item.isFallback) ? '关键词兜底' : '图搜'}命中 ${results.length} 家`
        : '未检索到可用供应商，请先打开 1688 登录窗口后重试',
    sourcingUpdatedAt: now,
    updatedAt: now
  }
}

function pickSourcingImageUrl(cachedImageUrl: string | null, sourceImage1: string | null): string | null {
  if (hasValidImageUrl(cachedImageUrl)) return String(cachedImageUrl).trim()
  if (hasValidImageUrl(sourceImage1)) return String(sourceImage1).trim()
  return null
}

function extractServiceRateLabels(message: string | null, count: number): string[] {
  const labels: string[] = []
  const normalizedMessage = String(message ?? '')
  const matcher = /48\s*[Hh]\s*揽收[:：]?\s*([1-9]\d?(?:\.\d+)?)\s*%/g
  let match: RegExpExecArray | null = null
  while ((match = matcher.exec(normalizedMessage)) !== null) {
    labels.push(`${match[1]}%`)
  }

  const fallback = [98, 95, 92, 89, 85]
  while (labels.length < count) {
    const next = fallback[labels.length] ?? fallback[fallback.length - 1]
    labels.push(`${next}%`)
  }
  return labels.slice(0, count)
}

function normalizeTextValue(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : null
}

function getSupplierDisplayName(row: SourcingSearchResult | undefined): string | null {
  if (!row) return null
  return normalizeTextValue(row.companyName) || normalizeTextValue(row.supplierName)
}

function isSourcingDebugResult(payload: SourcingSearchResponse): payload is SourcingDebugResult {
  return !Array.isArray(payload) && payload?.error === 'DEBUG_MODE_ACTIVE'
}

function calcNetProfitRate(salePrice: number | null, netProfit: number | null): number | null {
  if (salePrice == null || !Number.isFinite(salePrice) || salePrice <= 0) return null
  if (netProfit == null || !Number.isFinite(netProfit)) return null
  return Number(((netProfit / salePrice) * 100).toFixed(1))
}

function pickSupplierIndexByBestProfit(marked: MarkedProduct): number {
  const profits = [marked.profit1, marked.profit2, marked.profit3]
  let bestIndex = 0
  let bestValue = Number.NEGATIVE_INFINITY
  for (let i = 0; i < profits.length; i += 1) {
    const value = profits[i]
    if (value == null || !Number.isFinite(value)) continue
    if (value > bestValue) {
      bestValue = value
      bestIndex = i
    }
  }
  return bestIndex
}

function getBestProfit(values: Array<number | null>): number | null {
  const candidates = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

function pickBestSupplier(marked?: MarkedProduct): BestSupplierInfo {
  if (!marked) return { name: null, url: null, profit: null }

  const candidates: BestSupplierInfo[] = [
    { name: marked.supplier1Name, url: marked.supplier1Url, profit: marked.profit1 },
    { name: marked.supplier2Name, url: marked.supplier2Url, profit: marked.profit2 },
    { name: marked.supplier3Name, url: marked.supplier3Url, profit: marked.profit3 }
  ]

  let best: BestSupplierInfo = { name: null, url: null, profit: null }
  for (const item of candidates) {
    if (item.profit == null) continue
    if (best.profit == null || item.profit > best.profit) best = item
  }

  return best
}

function toProfitLevel(raw: number | null): 'high' | 'medium' | 'low' {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  if (value >= 15) return 'high'
  if (value >= 8) return 'medium'
  return 'low'
}

function isLikelyXhsGoodsDetailUrl(url: string | null): boolean {
  const normalized = String(url ?? '').trim()
  if (!normalized) return false
  return /^https?:\/\/(?:www\.)?xiaohongshu\.com\/goods-detail\//i.test(normalized)
}

function hasValidImageUrl(url: string | null): boolean {
  const normalized = String(url ?? '').trim()
  if (!normalized) return false
  const lower = normalized.toLowerCase()
  if (lower.includes('placeholder') || lower.includes('default') || lower.includes('sprite')) return false
  return true
}

function formatGrowth(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-'
  const percent = value * 100
  const sign = percent >= 0 ? '+' : ''
  return `${sign}${percent.toFixed(1)}%`
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '¥--'
  return `¥${value.toFixed(1)}`
}

export { HeatDashboard }
