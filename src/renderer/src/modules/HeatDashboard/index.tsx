import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  OperationalProductCard,
  type OperationalProduct
} from './components/OperationalProductCard'
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
  shopUrl: string | null
  cachedImageUrl: string | null
  price: number | null
  addCart24hValue: number
  prevAddCart24hValue: number | null
  prev_cart_value: number | null
  deltaAddCart24h: number | null
  totalSales: string | null
  recent_3m_sales: string | null
  cart_tag: string | null
  fav_tag: string | null
  imported_at: string | null
  shopSales: string | null
  productRating: number | null
  shopRating: number | null
  isNew: boolean
  firstSeenAt: number
  lastUpdatedAt: number
  positiveReviewTag: string | null
  shopName: string | null
  shopFans: string | null
  scout_strategy_tag: 'flawed_hot' | 'exploding_new' | null
  shop_dna_tag: 'viral_product' | null
  lifecycle_status: 'exploding' | 'mature' | 'declining' | 'new'
  isAlert?: boolean
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
  imageUrl: string | null
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
type SourcingEmptyState = {
  title: string
  detail: string
  showLoginAction?: boolean
  showRetryCoverAction?: boolean
  showRetrySourcingAction?: boolean
}

type CoverDebugState = {
  visual: boolean
  keepWindowOpen: boolean
  openDevTools: boolean
  logPath: string
}

type ProductFilterKey = 'all' | 'alert' | 'flawed_hot' | 'exploding_new'

const FILTER_PILLS: Array<{ key: ProductFilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'alert', label: '异动预警' },
  { key: 'flawed_hot', label: '低分热销' },
  { key: 'exploding_new', label: '飙升新品' }
]

const PRODUCT_PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640' viewBox='0 0 640 640'%3E%3Cdefs%3E%3ClinearGradient id='bg' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%23f3f4f6'/%3E%3Cstop offset='100%25' stop-color='%23e5e7eb'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='640' fill='url(%23bg)'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239ca3af' font-family='Arial' font-size='28'%3ENo Image%3C/text%3E%3C/svg%3E"

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
  const [isImportingSnapshot, setIsImportingSnapshot] = useState(false)
  const [isDeletingSnapshot, setIsDeletingSnapshot] = useState(false)
  const [isDeletingKeywordSnapshot, setIsDeletingKeywordSnapshot] = useState(false)
  const [deletingKeywordId, setDeletingKeywordId] = useState<string | null>(null)
  const [isSourcing, setIsSourcing] = useState(false)
  const [isSourcingRunning, setIsSourcingRunning] = useState(false)
  const [isBindingSupplier, setIsBindingSupplier] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState('')
  const [quickLookProductId, setQuickLookProductId] = useState<string | null>(null)
  const [supplierDetailUrl, setSupplierDetailUrl] = useState<string | null>(null)
  const [queuedImageMap, setQueuedImageMap] = useState<Record<string, string>>({})
  const [queueLoadingMap, setQueueLoadingMap] = useState<Record<string, boolean>>({})
  const [queueErrorMap, setQueueErrorMap] = useState<Record<string, string>>({})
  const [coverDebugState, setCoverDebugState] = useState<CoverDebugState | null>(null)
  const [coverDebugLines, setCoverDebugLines] = useState<string[]>([])
  const [isCoverDebugPanelOpen, setIsCoverDebugPanelOpen] = useState(false)
  const [isCoverDebugUpdating, setIsCoverDebugUpdating] = useState(false)
  const [activeFilter, setActiveFilter] = useState<ProductFilterKey>('all')
  const [sourcingMarked, setSourcingMarked] = useState<MarkedProduct | null>(null)
  const [sourcingSearchCandidates, setSourcingSearchCandidates] = useState<SourcingSupplierCandidate[] | null>(null)
  const [sourcingEmptyState, setSourcingEmptyState] = useState<SourcingEmptyState | null>(null)
  const [selectedSupplierIndex, setSelectedSupplierIndex] = useState(0)

  const keywordRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [focusedKeywordIndex, setFocusedKeywordIndex] = useState(0)
  const requestedQueueProductIdsRef = useRef<Set<string>>(new Set())

  const availableSnapshotDates = meta?.availableDates ?? []
  const snapshotDate = selectedSnapshotDate

  const loadMeta = useCallback(async (): Promise<void> => {
    const nextMeta = await window.api.cms.scout.dashboard.meta()
    setMeta(nextMeta)
  }, [])

  useEffect(() => {
    if (availableSnapshotDates.length === 0) {
      if (selectedSnapshotDate) setSelectedSnapshotDate('')
      return
    }
    if (selectedSnapshotDate && availableSnapshotDates.includes(selectedSnapshotDate)) return
    const next = meta?.latestDate && availableSnapshotDates.includes(meta.latestDate)
      ? meta.latestDate
      : availableSnapshotDates[0] ?? ''
    if (next !== selectedSnapshotDate) setSelectedSnapshotDate(next)
  }, [availableSnapshotDates, meta?.latestDate, selectedSnapshotDate])

  const loadCoverDebugState = useCallback(async (): Promise<void> => {
    try {
      const next = (await window.api.cms.scout.dashboard.coverDebugState()) as CoverDebugState
      setCoverDebugState(next)
    } catch {
      // noop
    }
  }, [])

  const loadCoverDebugLog = useCallback(async (limit = 100): Promise<void> => {
    try {
      const result = (await window.api.cms.scout.dashboard.coverDebugLog({ limit })) as {
        logPath: string
        lines: string[]
      }
      setCoverDebugLines(Array.isArray(result.lines) ? result.lines : [])
      setCoverDebugState((prev) => {
        if (!prev) return prev
        return { ...prev, logPath: result.logPath || prev.logPath }
      })
    } catch {
      // noop
    }
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
    void loadCoverDebugState()
  }, [loadCoverDebugState])

  useEffect(() => {
    const refreshOnForeground = (): void => {
      void loadMeta()
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void loadMeta()
      }
    }
    window.addEventListener('focus', refreshOnForeground)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshOnForeground)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
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
    setQueueErrorMap({})
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
      setQueueErrorMap((prev) => {
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

  useEffect(() => {
    return window.api.cms.scout.dashboard.onXhsImageFetchFailed(({ productId, reason }) => {
      setQueueLoadingMap((prev) => {
        if (!prev[productId]) return prev
        const next = { ...prev }
        delete next[productId]
        return next
      })
      setQueueErrorMap((prev) => ({ ...prev, [productId]: reason }))
      setStatusText(`封面抓取失败（${productId.slice(0, 10)}）：${reason}`)
    })
  }, [])

  useEffect(() => {
    if (!isCoverDebugPanelOpen) return
    void loadCoverDebugLog(120)
    const timer = window.setInterval(() => {
      void loadCoverDebugLog(120)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [isCoverDebugPanelOpen, loadCoverDebugLog])

  const markedByProductKey = useMemo(() => {
    const map = new Map<string, MarkedProduct>()
    for (const item of markedProducts) map.set(item.productKey, item)
    return map
  }, [markedProducts])

  const keywordAlertMap = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const item of keywordHeat) {
      map.set(item.keyword, item.isAlert)
    }
    return map
  }, [keywordHeat])

  const filteredPotentialProducts = useMemo(() => {
    if (activeFilter === 'all') return potentialProducts
    return potentialProducts.filter((item) => {
      const isAlert = typeof item.isAlert === 'boolean' ? item.isAlert : (keywordAlertMap.get(item.keyword) ?? false)
      if (activeFilter === 'alert') return isAlert
      if (activeFilter === 'flawed_hot') return item.scout_strategy_tag === 'flawed_hot'
      return item.scout_strategy_tag === 'exploding_new'
    })
  }, [activeFilter, keywordAlertMap, potentialProducts])
  const activeFilterLabel = useMemo(() => {
    return FILTER_PILLS.find((pill) => pill.key === activeFilter)?.label ?? '全部'
  }, [activeFilter])

  const productCards = useMemo<ProductCardModel[]>(() => {
    return filteredPotentialProducts.map((item) => {
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
  }, [filteredPotentialProducts, markedByProductKey, queuedImageMap])

  const enqueueMissingCoverFetch = useCallback((productId: string, xiaohongshuUrl: string): void => {
    const normalizedProductId = String(productId ?? '').trim()
    const normalizedUrl = String(xiaohongshuUrl ?? '').trim()
    if (!normalizedProductId || !normalizedUrl) return
    if (!isLikelyXhsGoodsDetailUrl(normalizedUrl)) return
    if (requestedQueueProductIdsRef.current.has(normalizedProductId)) return
    requestedQueueProductIdsRef.current.add(normalizedProductId)
    setQueueLoadingMap((prev) => ({ ...prev, [normalizedProductId]: true }))
    setQueueErrorMap((prev) => {
      if (!prev[normalizedProductId]) return prev
      const next = { ...prev }
      delete next[normalizedProductId]
      return next
    })
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
    setSourcingEmptyState(null)
    setSelectedSupplierIndex(0)
  }, [selectedKeywordId, selectedProductId])

  const saveSelectedProduct = useCallback(
    async (targetProduct: ProductCardModel) => {
      if (!snapshotDate) return null
      const result = await window.api.cms.scout.dashboard.markPotential({
        snapshotDate,
        products: [
          {
            productKey: targetProduct.id,
            keyword: targetProduct.keyword,
            productName: targetProduct.name,
            productUrl: targetProduct.productUrl,
            salePrice: targetProduct.price
          }
        ]
      })
      const marked = (await window.api.cms.scout.dashboard.markedProducts({
        snapshotDate,
        keyword: selectedKeywordId ?? undefined
      })) as MarkedProduct[]
      setMarkedProducts(marked)
      return { result, marked }
    },
    [selectedKeywordId, snapshotDate]
  )

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
      setSourcingEmptyState({
        title: '1688 未登录',
        detail: '当前会话没有可用登录态，自动搜同款无法继续。',
        showLoginAction: true,
        showRetrySourcingAction: true
      })
    })
    const offCaptchaNeeded = window.api.cms.scout.dashboard.onSourcingCaptchaNeeded(() => {
      setStatusText('检测到验证码，请在弹出的窗口中完成验证后继续。')
      setSourcingEmptyState({
        title: '检测到验证码',
        detail: '请先在 1688 登录窗口完成验证，再点击重试。',
        showLoginAction: true,
        showRetrySourcingAction: true
      })
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
    try {
      const saved = await saveSelectedProduct(selectedProduct)
      if (!saved) {
        setStatusText('加入待办失败：未找到当前商品')
        return
      }
      const { result } = saved
      setStatusText(`加入待办成功：新增 ${result.upserted}，已存在 ${result.skipped}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`加入待办失败：${msg}`)
    }
  }, [saveSelectedProduct, selectedProduct, snapshotDate])

  const handleStartSourcing = useCallback(
    async (targetProduct?: ProductCardModel): Promise<void> => {
      const activeProduct = targetProduct ?? selectedProduct
      if (!activeProduct || !snapshotDate) {
        setStatusText('请先选择商品后再执行搜同款')
        return
      }

      setIsSourcing(true)
      setIsSourcingRunning(false)
      setSelectedSupplierIndex(0)
      setSourcingSearchCandidates([])
      setSourcingEmptyState(null)
      try {
        const saved = await saveSelectedProduct(activeProduct)
        if (!saved) {
          setSourcingEmptyState({
            title: '未找到当前商品',
            detail: '商品未成功写入待办列表，无法继续搜同款。',
            showRetrySourcingAction: true
          })
          setStatusText('搜同款失败：未找到当前商品')
          return
        }
        const targetMarked = saved.marked.find((item) => item.productKey === activeProduct.id) ?? null
        if (!targetMarked) {
          setSourcingEmptyState({
            title: '商品未成功加入待办',
            detail: '请先确认快照数据正常，再重试搜同款。',
            showRetrySourcingAction: true
          })
          setStatusText('搜同款失败：商品未成功加入待办')
          return
        }
        const imageUrl = pickSourcingImageUrl(
          activeProduct.potential.cachedImageUrl,
          targetMarked.sourceImage1
        )
        if (!imageUrl) {
          setSourcingEmptyState({
            title: '缺少可用主图',
            detail: '当前卡片没有可用于图搜的主图（cover_cache/source_image_1）。',
            showRetryCoverAction: true,
            showRetrySourcingAction: true
          })
          setStatusText('搜同款失败：未找到可用主图（cover_cache/source_image_1）')
          return
        }
        const targetPrice = targetMarked.salePrice ?? activeProduct.price
        if (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0) {
          setSourcingEmptyState({
            title: '目标售价无效',
            detail: '目标售价为空或小于等于 0，无法计算利润并筛选候选。',
            showRetrySourcingAction: true
          })
          setStatusText('搜同款失败：目标售价无效')
          return
        }

        const has1688Login = await window.api.cms.scout.dashboard.check1688Login().catch(() => false)
        if (!has1688Login) {
          setSourcingEmptyState({
            title: '1688 未登录',
            detail: '当前生产会话缺少 1688 登录态，请先登录后再执行搜同款。',
            showLoginAction: true,
            showRetrySourcingAction: true
          })
          setStatusText('搜同款未开始：检测到 1688 未登录，请先登录')
          return
        }

        setIsSourcingRunning(true)
        const keyword = activeProduct.name || targetMarked.productName || targetMarked.keyword
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
          setSourcingEmptyState({
            title: '进入人工介入模式',
            detail: `自动流程已暂停，请在弹出的 1688 页面手动处理后重试。当前页面：${response.url}`,
            showLoginAction: true,
            showRetrySourcingAction: true
          })
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
          setSourcingEmptyState({
            title: '未检索到可用供应商',
            detail: sourced.sourcingMessage ?? '图搜与关键词兜底均未返回可用候选。',
            showLoginAction: true,
            showRetrySourcingAction: true
          })
          setStatusText(`搜同款失败：${sourced.sourcingMessage ?? '未命中供应商'}`)
          return
        }
        setSourcingEmptyState(null)
        const withFallback = results.some((item) => item.isFallback)
        setStatusText(`搜同款完成（${withFallback ? '关键词兜底' : '图搜'}），选择候选供应商后点击“绑定供应商”保存。`)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        setSourcingEmptyState({
          title: '搜同款执行失败',
          detail: msg || '未知错误',
          showLoginAction: /1688|登录|验证码|captcha/i.test(msg),
          showRetrySourcingAction: true
        })
        setStatusText(`搜同款失败：${msg}`)
      } finally {
        setIsSourcingRunning(false)
      }
    },
    [saveSelectedProduct, selectedProduct, snapshotDate]
  )

  const handleBindSupplier = useCallback(async (targetIndex?: number): Promise<void> => {
    if (!selectedProduct || !snapshotDate) {
      setStatusText('请先选择商品后再绑定供应商')
      return
    }
    const bindIndex =
      typeof targetIndex === 'number' && Number.isFinite(targetIndex)
        ? Math.max(0, Math.floor(targetIndex))
        : selectedSupplierIndex
    if (bindIndex !== selectedSupplierIndex) {
      setSelectedSupplierIndex(bindIndex)
    }
    const chosen = sourcingCandidates[bindIndex] ?? null
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

  const handleOpen1688Login = useCallback(async (): Promise<void> => {
    try {
      const opened = await window.api.cms.scout.dashboard.open1688Login()
      if (!opened) {
        setStatusText('打开 1688 登录窗口失败，请稍后重试')
        return
      }
      setStatusText('已打开 1688 登录窗口，请先完成登录后重试搜同款')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`打开 1688 登录窗口失败：${msg}`)
    }
  }, [])

  const handleOpenSupplierDetailInApp = useCallback((supplierUrl: string | null): void => {
    const target = String(supplierUrl ?? '').trim()
    if (!target) {
      setStatusText('当前供应商暂无可打开链接')
      return
    }
    try {
      const parsed = new URL(target)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setStatusText('打开 1688 详情失败：链接协议无效')
        return
      }
      const hostname = String(parsed.hostname ?? '').toLowerCase()
      if (!/(^|\.)1688\.com$/i.test(hostname)) {
        setStatusText('打开 1688 详情失败：当前链接并非 1688 页面')
        return
      }
      setSupplierDetailUrl(parsed.toString())
      setStatusText('已在当前窗口内打开 1688 供应商详情页')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`打开 1688 详情失败：链接无效（${msg}）`)
    }
  }, [])

  const handleRetrySourcingCover = useCallback((): void => {
    const activeProduct = selectedProduct
    if (!activeProduct) {
      setStatusText('请先选择商品后再重试抓图')
      return
    }
    if (!isLikelyXhsGoodsDetailUrl(activeProduct.productUrl)) {
      setStatusText('当前商品链接不是小红书商品详情页，无法自动抓封面')
      return
    }
    enqueueMissingCoverFetch(activeProduct.id, activeProduct.productUrl ?? '')
    setStatusText('已重新提交封面抓取任务，请稍候再重试搜同款')
  }, [enqueueMissingCoverFetch, selectedProduct])

  const handleOpenExternalLink = useCallback(
    async (targetUrl: string | null, label: '商品' | '店铺'): Promise<void> => {
      const target = String(targetUrl ?? '').trim()
      if (!target) {
        setStatusText(`当前${label}暂无可打开链接`)
        return
      }
      try {
        await window.api.cms.system.openExternal(target)
      } catch {
        setStatusText(`打开${label}链接失败`)
      }
    },
    []
  )

  const handleCopyProductLink = useCallback(async (productUrl: string | null): Promise<void> => {
    const target = String(productUrl ?? '').trim()
    if (!target) {
      setStatusText('当前商品暂无可复制链接')
      return
    }
    try {
      await navigator.clipboard.writeText(target)
      setStatusText('商品链接已复制')
    } catch {
      setStatusText('复制失败，请检查剪贴板权限')
    }
  }, [])

  const handleUpdateCoverDebugState = useCallback(
    async (patch: Partial<Pick<CoverDebugState, 'visual' | 'keepWindowOpen' | 'openDevTools'>>): Promise<void> => {
      if (isCoverDebugUpdating) return
      setIsCoverDebugUpdating(true)
      try {
        const next = (await window.api.cms.scout.dashboard.setCoverDebugState(patch)) as CoverDebugState
        setCoverDebugState(next)
        setStatusText(
          `抓取调试已更新（封面/搜同款）：可视=${next.visual ? '开' : '关'}，保留窗口=${next.keepWindowOpen ? '开' : '关'}，DevTools=${next.openDevTools ? '开' : '关'}`
        )
        if (isCoverDebugPanelOpen) {
          void loadCoverDebugLog(120)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        setStatusText(`抓取调试开关更新失败：${msg}`)
      } finally {
        setIsCoverDebugUpdating(false)
      }
    },
    [isCoverDebugPanelOpen, isCoverDebugUpdating, loadCoverDebugLog]
  )

  const handleImportSnapshotExcel = useCallback(async (): Promise<void> => {
    if (isImportingSnapshot) return
    setIsImportingSnapshot(true)
    try {
      const result = (await window.api.cms.scout.dashboard.importExcelFile()) as
        | {
            snapshotDates: string[]
            rowsUpserted: number
            productsMapped: number
            keywordsCount: number
            sourceFile: string
          }
        | null
      if (!result) {
        setStatusText('已取消上传快照表格')
        return
      }
      const sourceName = String(result.sourceFile || '')
        .split(/[\\/]/)
        .filter(Boolean)
        .pop()
      await loadMeta()
      await Promise.all([loadKeywordsAndTrends(), loadProducts()])
      setStatusText(
        `快照导入完成：${sourceName || '未知文件'}，写入 ${result.rowsUpserted} 行，映射 ${result.productsMapped} 个商品`
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`快照导入失败：${msg}`)
    } finally {
      setIsImportingSnapshot(false)
    }
  }, [isImportingSnapshot, loadKeywordsAndTrends, loadMeta, loadProducts])

  const handleSnapshotDateChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>): void => {
      const next = String(event.target.value ?? '').trim()
      setSelectedSnapshotDate(next)
      setSelectedKeywordId(null)
      setSelectedProductId(null)
      setPotentialProducts([])
      setMarkedProducts([])
      setQueuedImageMap({})
      setQueueLoadingMap({})
      requestedQueueProductIdsRef.current.clear()
      setStatusText(next ? `已切换快照日：${next}` : '已清空快照日选择')
    },
    [setSelectedKeywordId, setSelectedProductId]
  )

  const handleDeleteSnapshot = useCallback(async (): Promise<void> => {
    if (isDeletingSnapshot) return
    if (!snapshotDate) {
      setStatusText('暂无可删除快照')
      return
    }
    const confirmed = window.confirm(`确认删除快照日 ${snapshotDate} 的数据吗？此操作不可撤销。`)
    if (!confirmed) return

    setIsDeletingSnapshot(true)
    try {
      const result = (await window.api.cms.scout.dashboard.deleteSnapshot({
        snapshotDate
      })) as {
        snapshotDate: string
        deletedSnapshotRows: number
        deletedWatchlistRows: number
        deletedProductMapRows: number
        deletedCoverCacheRows: number
      }
      setSelectedKeywordId(null)
      setSelectedProductId(null)
      setPotentialProducts([])
      setMarkedProducts([])
      setQueuedImageMap({})
      setQueueLoadingMap({})
      requestedQueueProductIdsRef.current.clear()
      await loadMeta()
      setStatusText(
        `已删除快照 ${result.snapshotDate}：快照 ${result.deletedSnapshotRows} 行，待办 ${result.deletedWatchlistRows} 行`
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`删除快照失败：${msg}`)
    } finally {
      setIsDeletingSnapshot(false)
    }
  }, [isDeletingSnapshot, loadMeta, setSelectedKeywordId, setSelectedProductId, snapshotDate])

  const handleDeleteKeywordSnapshot = useCallback(async (keywordId?: string): Promise<void> => {
    if (isDeletingKeywordSnapshot) return
    if (!snapshotDate) {
      setStatusText('请先选择快照日')
      return
    }
    const targetKeyword = String(keywordId ?? selectedKeywordId ?? '').trim()
    if (!targetKeyword) {
      setStatusText('请先选择要删除的关键词页')
      return
    }
    const confirmed = window.confirm(
      `确认删除快照日 ${snapshotDate} 下关键词「${targetKeyword}」的全部数据吗？此操作不可撤销。`
    )
    if (!confirmed) return

    setIsDeletingKeywordSnapshot(true)
    setDeletingKeywordId(targetKeyword)
    try {
      const result = (await window.api.cms.scout.dashboard.deleteKeywordSnapshot({
        snapshotDate,
        keyword: targetKeyword
      })) as {
        snapshotDate: string
        keyword: string
        deletedSnapshotRows: number
        deletedWatchlistRows: number
        deletedProductMapRows: number
        deletedCoverCacheRows: number
      }
      setSelectedKeywordId(null)
      setSelectedProductId(null)
      setPotentialProducts([])
      setMarkedProducts([])
      setQueuedImageMap({})
      setQueueLoadingMap({})
      requestedQueueProductIdsRef.current.clear()
      await Promise.all([loadMeta(), loadKeywordsAndTrends()])
      setStatusText(
        `已删除 ${result.snapshotDate} / ${result.keyword}：快照 ${result.deletedSnapshotRows} 行，待办 ${result.deletedWatchlistRows} 行`
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setStatusText(`删除关键词页失败：${msg}`)
    } finally {
      setIsDeletingKeywordSnapshot(false)
      setDeletingKeywordId(null)
    }
  }, [
    isDeletingKeywordSnapshot,
    loadKeywordsAndTrends,
    loadMeta,
    selectedKeywordId,
    setSelectedKeywordId,
    setSelectedProductId,
    snapshotDate
  ])

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
          isSourcing ? 'pb-[276px]' : 'pb-0'
        )}
        style={{ gridTemplateColumns: '320px minmax(0, 1fr)' }}
      >
        <aside className="flex h-full min-h-0 flex-col border-r border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 bg-zinc-900/90 px-3 py-2.5">
            <div className="text-sm font-semibold text-zinc-100">趋势雷达</div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-zinc-400">
              <div className="flex min-w-0 items-center gap-1">
                <span className="shrink-0">快照日：</span>
                <select
                  className="h-6 min-w-[124px] max-w-[172px] rounded border border-zinc-700 bg-zinc-950 px-1.5 text-[11px] text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/60 disabled:cursor-not-allowed disabled:opacity-60"
                  value={snapshotDate}
                  onChange={handleSnapshotDateChange}
                  disabled={availableSnapshotDates.length === 0 || isImportingSnapshot}
                >
                  {availableSnapshotDates.length === 0 ? (
                    <option value="">暂无快照数据</option>
                  ) : (
                    availableSnapshotDates.map((date) => (
                      <option key={date} value={date}>
                        {date}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <button
                type="button"
                className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleDeleteSnapshot()}
                disabled={!snapshotDate || isDeletingSnapshot || isDeletingKeywordSnapshot || isImportingSnapshot}
              >
                {isDeletingSnapshot ? '删除中...' : '删除当日'}
              </button>
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
                      deleting={isDeletingKeywordSnapshot && deletingKeywordId === item.id}
                      canDelete={Boolean(snapshotDate) && !isDeletingSnapshot && !isDeletingKeywordSnapshot && !isImportingSnapshot}
                      tabIndex={focusedKeywordIndex === index ? 0 : -1}
                      onClick={() => handleSelectKeyword(item.id)}
                      onDelete={() => void handleDeleteKeywordSnapshot(item.id)}
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

          <div className="border-t border-zinc-800 bg-zinc-900/95 p-2">
            <button
              type="button"
              className="w-full rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-55"
              onClick={() => void handleImportSnapshotExcel()}
              disabled={isImportingSnapshot}
            >
              {isImportingSnapshot ? '上传中...' : '上传快照表格'}
            </button>
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {FILTER_PILLS.map((pill) => (
                <button
                  key={pill.key}
                  type="button"
                  className={cn(
                    'rounded-full px-3 py-1 text-[11px] font-semibold transition-colors',
                    activeFilter === pill.key
                      ? 'bg-gray-800 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                  onClick={() => setActiveFilter(pill.key)}
                >
                  {pill.label}
                </button>
              ))}
              <div className="group relative inline-flex items-center">
                <span className="ml-2 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-400 text-xs text-gray-400">
                  ?
                </span>
                <div className="invisible absolute top-full z-50 mt-2 w-64 rounded bg-gray-800 p-3 text-xs text-white opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100">
                  <div className="space-y-2">
                    <p>🚀 爆发期：24h加购环比增长 &gt; 50%</p>
                    <p>👑 成熟期：环比波动在 -20% 至 50% 之间</p>
                    <p>🥀 衰退期：24h加购环比下跌 &gt; 20%</p>
                    <p>🌱 测款期：首次被系统抓取的新商品</p>
                  </div>
                </div>
              </div>
              <span className="text-[11px] text-zinc-400">
                已显示 {productCards.length} / {potentialProducts.length}
              </span>
            </div>
            {import.meta.env.DEV && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-200 transition hover:bg-zinc-800"
                    onClick={() => setIsCoverDebugPanelOpen((prev) => !prev)}
                  >
                    {isCoverDebugPanelOpen ? '收起抓取调试' : '抓取调试'}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50',
                      coverDebugState?.visual
                        ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                        : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
                    )}
                    onClick={() =>
                      void handleUpdateCoverDebugState({
                        visual: !(coverDebugState?.visual === true)
                      })
                    }
                    disabled={isCoverDebugUpdating}
                  >
                    可视抓取: {coverDebugState?.visual ? '开' : '关'}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50',
                      coverDebugState?.keepWindowOpen
                        ? 'border-amber-400/60 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                        : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
                    )}
                    onClick={() =>
                      void handleUpdateCoverDebugState({
                        keepWindowOpen: !(coverDebugState?.keepWindowOpen === true)
                      })
                    }
                    disabled={isCoverDebugUpdating}
                  >
                    保留窗口: {coverDebugState?.keepWindowOpen ? '开' : '关'}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50',
                      coverDebugState?.openDevTools
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30'
                        : 'border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800'
                    )}
                    onClick={() =>
                      void handleUpdateCoverDebugState({
                        openDevTools: !(coverDebugState?.openDevTools === true)
                      })
                    }
                    disabled={isCoverDebugUpdating}
                  >
                    DevTools: {coverDebugState?.openDevTools ? '开' : '关'}
                  </button>
                </div>
                {isCoverDebugPanelOpen && (
                  <div className="mt-2 rounded-md border border-zinc-700 bg-black/35 p-2">
                    <div className="mb-1 text-[11px] text-zinc-400">
                      实时日志：{coverDebugState?.logPath ? coverDebugState.logPath : '-'}
                    </div>
                    <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-zinc-300">
                      {coverDebugLines.length > 0 ? coverDebugLines.join('\n') : '暂无日志'}
                    </pre>
                  </div>
                )}
              </>
            )}
          </header>

          <div className="p-4">
            {productCards.length === 0 && !isLoadingProducts ? (
              <div className="rounded-xl border border-zinc-700 bg-zinc-900/40 p-6 text-sm text-zinc-400">
                {potentialProducts.length === 0
                  ? '当前关键词暂无商品数据'
                  : `筛选「${activeFilterLabel}」下暂无商品`}
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
                    onOpenProductLink={() => void handleOpenExternalLink(card.productUrl, '商品')}
                    onOpenShopLink={() =>
                      void handleOpenExternalLink(card.potential.shopUrl || card.bestSupplierUrl, '店铺')
                    }
                    onCopyLink={() => void handleCopyProductLink(card.productUrl)}
                    onSameStyle={() => {
                      setSelectedProductId(card.id)
                      void handleStartSourcing(card)
                    }}
                    onCompetitorAnalysis={() => {
                      setSelectedProductId(card.id)
                      setQuickLookProductId(card.id)
                    }}
                    onRequestMissingImage={enqueueMissingCoverFetch}
                    isImageFetching={queueLoadingMap[card.id] === true}
                    imageFetchError={queueErrorMap[card.id] ?? null}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <SourcingPanel
        isOpen={isSourcing}
        isRunning={isSourcingRunning}
        workspacePath={workspacePath}
        xhsImage={sourcingTargetImage}
        targetPrice={sourcingTargetPrice}
        candidates={sourcingCandidates}
        emptyState={sourcingEmptyState}
        selectedSupplierIndex={selectedSupplierIndex}
        onSelectSupplier={setSelectedSupplierIndex}
        onClose={() => {
          setIsSourcing(false)
          setSourcingEmptyState(null)
        }}
        onBindSupplier={(index) => void handleBindSupplier(index)}
        onOpen1688Login={() => void handleOpen1688Login()}
        onOpenSupplierDetail={(url) => void handleOpenSupplierDetailInApp(url)}
        onRetryCoverFetch={handleRetrySourcingCover}
        onRetrySourcing={() => void handleStartSourcing()}
        isBinding={isBindingSupplier}
      />

      {quickLookProduct && (
        <QuickLookModal
          product={quickLookProduct}
          workspacePath={workspacePath}
          onClose={() => setQuickLookProductId(null)}
        />
      )}

      {supplierDetailUrl && (
        <SupplierDetailInAppModal
          url={supplierDetailUrl}
          onClose={() => {
            setSupplierDetailUrl(null)
            setStatusText('已关闭 1688 内置详情页')
          }}
        />
      )}
    </div>
  )
}

type TrendKeywordListItemProps = {
  item: KeywordRadarItem
  active: boolean
  deleting: boolean
  canDelete: boolean
  tabIndex: number
  onClick: () => void
  onDelete: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}

const TrendKeywordListItem = React.forwardRef<HTMLButtonElement, TrendKeywordListItemProps>(
  function TrendKeywordListItem(
    { item, active, deleting, canDelete, tabIndex, onClick, onDelete, onKeyDown },
    ref
  ): React.JSX.Element {
    return (
      <div className="group relative">
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
          <div className="flex items-center gap-1 pr-16 text-sm font-semibold">
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
        <button
          type="button"
          className={cn(
            'absolute right-1 top-1 rounded border px-1.5 py-0.5 text-[10px] transition',
            'border-amber-500/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20',
            active || deleting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            (!canDelete || deleting) && 'pointer-events-none opacity-45'
          )}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!canDelete || deleting) return
            onDelete()
          }}
          title={`删除关键词页：${item.keyword}`}
          aria-label={`删除关键词页：${item.keyword}`}
        >
          {deleting ? '删除中' : '删页'}
        </button>
      </div>
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
  onOpenProductLink: () => void
  onOpenShopLink: () => void
  onCopyLink: () => void
  onSameStyle: () => void
  onCompetitorAnalysis: () => void
  onRequestMissingImage: (productId: string, xiaohongshuUrl: string) => void
  isImageFetching: boolean
  imageFetchError: string | null
}

function ProductCard({
  card,
  workspacePath,
  focused,
  onSelect,
  onQuickLook,
  onOpenProductLink,
  onOpenShopLink,
  onCopyLink,
  onSameStyle,
  onCompetitorAnalysis,
  onRequestMissingImage,
  isImageFetching,
  imageFetchError
}: ProductCardProps): React.JSX.Element {
  useEffect(() => {
    if (hasValidImageUrl(card.imageUrl)) return
    if (!isLikelyXhsGoodsDetailUrl(card.productUrl)) return
    onRequestMissingImage(card.id, card.productUrl ?? '')
  }, [card.id, card.imageUrl, card.productUrl, onRequestMissingImage])

  const readyImageUrl = useMemo(() => {
    if (!hasValidImageUrl(card.imageUrl)) return PRODUCT_PLACEHOLDER_IMAGE
    const resolved = resolveLocalImage(String(card.imageUrl), workspacePath)
    return resolved || PRODUCT_PLACEHOLDER_IMAGE
  }, [card.imageUrl, workspacePath])

  const operationalProduct = useMemo<OperationalProduct>(() => {
    const addCart24h = Number.isFinite(card.potential.addCart24hValue) ? card.potential.addCart24hValue : 0
    return {
      title: card.name,
      productUrl: card.productUrl,
      price: Number.isFinite(card.price) ? Number(card.price) : 0,
      velocity24h: Math.max(0, Math.round(addCart24h)),
      prevCartValue: card.potential.prev_cart_value ?? card.potential.prevAddCart24hValue,
      productSales: card.potential.totalSales,
      recent3mSales: card.potential.recent_3m_sales,
      cartTag: card.potential.cart_tag,
      favTag: card.potential.fav_tag,
      shopSales: card.potential.shopSales,
      productRating: card.potential.productRating,
      shopName: card.potential.shopName || card.bestSupplierName || '待绑定店铺',
      shopUrl: card.potential.shopUrl || card.bestSupplierUrl || null,
      shopRating: card.potential.shopRating,
      isNewArrival: card.potential.isNew,
      positiveReviewTag: card.potential.positiveReviewTag,
      shopFans: card.potential.shopFans,
      scout_strategy_tag: card.potential.scout_strategy_tag,
      shop_dna_tag: card.potential.shop_dna_tag,
      lifecycle_status: card.potential.lifecycle_status,
      importedAt: Number.isFinite(card.potential.firstSeenAt)
        ? card.potential.firstSeenAt
        : Number.isFinite(card.potential.lastUpdatedAt)
          ? card.potential.lastUpdatedAt
          : null,
      importedAtLabel: card.potential.imported_at,
      imageUrl: readyImageUrl
    }
  }, [card, readyImageUrl])

  return (
    <article className={cn('transition duration-200', focused ? 'ring-2 ring-cyan-400/70' : 'hover:-translate-y-0.5')}>
      <div
        role="button"
        tabIndex={0}
        className="h-full w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
        onClick={onSelect}
        onFocus={onSelect}
        onKeyDown={(event) => {
          if (event.key === ' ') {
            event.preventDefault()
            onQuickLook()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onSelect()
          }
        }}
      >
        <div className="relative">
          <OperationalProductCard
            product={operationalProduct}
            onOpenProduct={card.productUrl ? onOpenProductLink : undefined}
            onOpenShop={operationalProduct.shopUrl ? onOpenShopLink : undefined}
            onCopyLink={onCopyLink}
            onSameStyle={onSameStyle}
            onCompetitorAnalysis={onCompetitorAnalysis}
          />
          {isImageFetching && !hasValidImageUrl(card.imageUrl) && (
            <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
              封面抓取中...
            </div>
          )}
          {!isImageFetching && !hasValidImageUrl(card.imageUrl) && imageFetchError && (
            <div className="pointer-events-none absolute left-2 top-2 rounded bg-rose-700/85 px-2 py-1 text-[11px] text-white">
              {formatImageFetchErrorLabel(imageFetchError)}
            </div>
          )}
        </div>
      </div>
    </article>
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

type SupplierDetailInAppModalProps = {
  url: string
  onClose: () => void
}

function SupplierDetailInAppModal({
  url,
  onClose
}: SupplierDetailInAppModalProps): React.JSX.Element {
  const WebviewTag = 'webview' as any

  useEffect(() => {
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5">
      <div className="flex h-[92vh] w-[96vw] max-w-[1600px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-[0_14px_55px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-700 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">1688 内置详情页</div>
            <div className="truncate text-[11px] text-zinc-400">{url}</div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-white">
          <WebviewTag src={url} partition="persist:scout-sourcing" className="h-full w-full" allowpopups="true" />
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
  emptyState: SourcingEmptyState | null
  selectedSupplierIndex: number
  onSelectSupplier: (index: number) => void
  onBindSupplier: (index: number) => void
  onOpen1688Login: () => void
  onOpenSupplierDetail: (url: string | null) => void
  onRetryCoverFetch: () => void
  onRetrySourcing: () => void
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
  emptyState,
  selectedSupplierIndex,
  onSelectSupplier,
  onBindSupplier,
  onOpen1688Login,
  onOpenSupplierDetail,
  onRetryCoverFetch,
  onRetrySourcing,
  onClose
}: SourcingPanelProps): React.JSX.Element {
  const resolvedTargetImage = xhsImage ? resolveLocalImage(xhsImage, workspacePath) : ''

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
              {isRunning
                ? '正在搜同款并提取供应商...'
                : emptyState
                  ? '请根据提示完成前置条件，再重试搜同款'
                  : '选择候选供应商后，可直接在卡片内点击“绑定供应商”'}
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

        <div className="mt-4 grid h-[336px] gap-4" style={{ gridTemplateColumns: '1.35fr 5.65fr' }}>
          <div className="relative h-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 p-1">
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

          <div className="h-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 p-3">
            {candidates.length === 0 ? (
              isRunning ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  供应商抓取中...
                </div>
              ) : emptyState ? (
                <div className="flex h-full items-center justify-center">
                  <div className="w-full max-w-[560px] rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-center">
                    <div className="text-sm font-semibold text-amber-200">{emptyState.title}</div>
                    <div className="mt-2 text-xs leading-5 text-zinc-300">{emptyState.detail}</div>
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {emptyState.showLoginAction && (
                        <button
                          type="button"
                          className="rounded border border-cyan-400/60 bg-cyan-500/15 px-3 py-1 text-[11px] text-cyan-100 transition hover:bg-cyan-500/25"
                          onClick={onOpen1688Login}
                        >
                          去登录 1688
                        </button>
                      )}
                      {emptyState.showRetryCoverAction && (
                        <button
                          type="button"
                          className="rounded border border-zinc-600 bg-zinc-800/70 px-3 py-1 text-[11px] text-zinc-200 transition hover:bg-zinc-700"
                          onClick={onRetryCoverFetch}
                        >
                          先抓主图
                        </button>
                      )}
                      {emptyState.showRetrySourcingAction && (
                        <button
                          type="button"
                          className="rounded border border-emerald-400/60 bg-emerald-500/15 px-3 py-1 text-[11px] text-emerald-100 transition hover:bg-emerald-500/25"
                          onClick={onRetrySourcing}
                        >
                          重试搜同款
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                  暂无供应商候选
                </div>
              )
            ) : (
              <div className="flex h-full items-stretch gap-2 overflow-x-auto pb-1">
                {candidates.map((candidate, index) => (
                  <SupplierCard
                    key={candidate.id}
                    candidate={candidate}
                    selected={index === selectedSupplierIndex}
                    onSelect={() => onSelectSupplier(index)}
                    onBindSupplier={() => onBindSupplier(index)}
                    onOpenDetail={() => onOpenSupplierDetail(candidate.url)}
                    isBinding={isBinding}
                    isRunning={isRunning}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function SupplierCard({
  candidate,
  selected,
  onSelect,
  onBindSupplier,
  onOpenDetail,
  isBinding,
  isRunning
}: {
  candidate: SourcingSupplierCandidate
  selected: boolean
  onSelect: () => void
  onBindSupplier: () => void
  onOpenDetail: () => void
  isBinding: boolean
  isRunning: boolean
}): React.JSX.Element {
  const isHighMargin = (candidate.netProfitRate ?? 0) > 30
  const netProfitClass = isHighMargin ? 'text-emerald-300' : 'text-orange-300'
  const purchaseText = formatMoney(candidate.purchasePrice)
  const freightText = formatMoney(candidate.freightPrice)
  const productImageUrl = normalizeExternalImageUrl(candidate.imageUrl)
  const moqText = candidate.moq ? String(candidate.moq).trim() : '--'
  const profitRateText =
    candidate.netProfitRate == null || !Number.isFinite(candidate.netProfitRate)
      ? '--%'
      : `${candidate.netProfitRate.toFixed(1)}%`
  const handleCardClick = (): void => onSelect()
  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect()
  }
  const handleOpenDetail = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    onOpenDetail()
  }
  const handleBindClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    onBindSupplier()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        'flex h-full min-w-[276px] cursor-pointer flex-col rounded-md border bg-zinc-950/90 p-2.5 text-left transition hover:bg-gray-800',
        selected
          ? 'border-emerald-500/90 shadow-[0_0_0_1px_rgba(16,185,129,0.75)]'
          : 'border-zinc-800 hover:border-zinc-600'
      )}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs font-semibold text-zinc-100">{candidate.name}</div>
        <button
          type="button"
          className="shrink-0 rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45"
          onClick={handleOpenDetail}
          disabled={!candidate.url}
          title={candidate.url ? '打开1688详情页' : '暂无详情链接'}
        >
          打开
        </button>
      </div>
      <div className="mt-1 text-[11px] text-zinc-400">48h揽收: {candidate.serviceRateLabel}</div>

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-2 gap-2">
        <div className="h-full rounded border border-zinc-800 bg-zinc-900/80 p-2">
          <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">进货价</div>
          <div className="mt-1 text-2xl font-black leading-none text-amber-300">{purchaseText}</div>
          <div className={cn('mt-2 text-sm font-bold leading-none', netProfitClass)}>
            毛利 {formatMoney(candidate.netProfit)}
          </div>
          <div className={cn('mt-1 text-xs font-semibold', netProfitClass)}>{profitRateText}</div>
        </div>
        <div className="h-full overflow-hidden rounded border border-zinc-800 bg-zinc-900/80">
          {productImageUrl ? (
            <img
              src={productImageUrl}
              alt={candidate.name}
              className="h-full w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">
              暂无主图
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
        <span>起批: {moqText}</span>
        <span>运费: {freightText}</span>
      </div>
      <button
        type="button"
        className="mt-2 w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-bold text-zinc-950 shadow-[0_0_22px_rgba(16,185,129,0.3)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-55"
        disabled={isRunning || isBinding}
        onClick={handleBindClick}
      >
        {isBinding ? '保存中...' : '绑定供应商'}
      </button>
    </div>
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
        imageUrl: null as string | null,
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
    imageUrl: normalizeExternalImageUrl(item.imgUrl),
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

function normalizeExternalImageUrl(value: string | null | undefined): string | null {
  const normalized = normalizeTextValue(value)
  if (!normalized) return null
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (/^\/\//.test(normalized)) return `https:${normalized}`
  return null
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

function formatImageFetchErrorLabel(reason: string): string {
  const text = String(reason ?? '').toLowerCase()
  if (!text) return '抓取失败'
  if (text.includes('anti_spider') || text.includes('反爬')) return '反爬限制'
  if (text.includes('timeout') || text.includes('超时')) return '请求超时'
  if (text.includes('未解析到有效商品主图') || text.includes('主图')) return '未解析主图'
  return '抓取失败'
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
