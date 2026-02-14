import { readFile } from 'fs/promises'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import type { BrowserWindow } from 'electron'
import { SqliteService } from './sqliteService'

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type ScoutKeywordRecord = {
  id: string
  keyword: string
  sortMode: string
  isActive: boolean
  productCount: number
  lastSyncedAt: number | null
  createdAt: number
}

export type ScoutProductRecord = {
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

export type ScoutSyncLogRecord = {
  id: string
  syncedAt: number
  sessionId: string | null
  keywordsCount: number
  productsCount: number
  status: string
}

export type ScoutProductListOptions = {
  keywordId: string
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  limit?: number
  offset?: number
}

export type ScoutExcelImportResult = {
  snapshotDates: string[]
  rowsUpserted: number
  productsMapped: number
  keywordsCount: number
  sourceFile: string
}

export type ScoutDashboardMeta = {
  latestDate: string | null
  availableDates: string[]
  totalKeywords: number
  totalProducts: number
  lastImportAt: number | null
}

export type ScoutDashboardDeleteSnapshotResult = {
  snapshotDate: string
  deletedSnapshotRows: number
  deletedWatchlistRows: number
  deletedProductMapRows: number
  deletedCoverCacheRows: number
  deletedImportBatches: number
  affectedSnapshotDates: string[]
}

export type ScoutKeywordHeatRecord = {
  keyword: string
  todayHeat: number
  prevHeat: number | null
  deltaHeat: number | null
  growthRate: number | null
  productCount: number
  isAlert: boolean
  isRising2d: boolean
}

export type ScoutPotentialProductRecord = {
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

export type ScoutKeywordTrend = {
  keyword: string
  values: number[]
  max: number
  min: number
  volatility: number
}

export type ScoutKeywordTrendResult = {
  dates: string[]
  series: ScoutKeywordTrend[]
}

export type ScoutDashboardProductDetail = {
  snapshotDate: string
  productKey: string
  keyword: string
  primaryKeyword: string
  sourceFile: string | null
  importedAt: number
  rawPayload: Record<string, unknown>
}

export type ScoutDashboardHeatQuery = {
  snapshotDate?: string
  keyword?: string
  onlyAlerts?: boolean
  limit?: number
}

export type ScoutDashboardPotentialQuery = {
  snapshotDate?: string
  keyword?: string
  onlyNew?: boolean
  limit?: number
  sortBy?: 'potentialScore' | 'addCart24hValue' | 'deltaAddCart24h' | 'shopFans' | 'lastUpdatedAt'
  sortOrder?: 'ASC' | 'DESC'
}

export type ScoutDashboardTrendQuery = {
  snapshotDate?: string
  days?: number
  keyword?: string
  limit?: number
}

export type ScoutMarkedProductPayload = {
  snapshotDate: string
  productKey: string
  keyword: string
  productName: string
  productUrl?: string | null
  salePrice?: number | null
}

export type ScoutBindSupplierPayload = {
  snapshotDate: string
  productKey: string
  supplierName?: string | null
  companyName?: string | null
  supplierUrl?: string | null
  supplierPrice?: number | null
  supplierNetProfit?: number | null
  supplierMoq?: string | null
  supplierFreightPrice?: number | null
  supplierServiceRateLabel?: string | null
  sourceImage1?: string | null
}

export type ScoutMarkedProductRecord = {
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

export type Scout1688ImageSearchPayload = {
  localImagePath: string
  targetPrice: number
  productId: string
  keyword?: string
}

export type Scout1688SupplierResult = {
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

export type Scout1688DebugResult = {
  error: 'DEBUG_MODE_ACTIVE'
  url: string
}

export type Scout1688SearchResponse = Scout1688SupplierResult[] | Scout1688DebugResult

type SyncPayloadProduct = {
  id?: string
  product_name?: string
  product_url?: string
  price?: number | null
  add_cart_24h?: string | null
  add_cart_24h_value?: number
  total_sales?: string | null
  three_month_buyers?: string | null
  add_cart_tag?: string | null
  positive_review_tag?: string | null
  collection_tag?: string | null
  review_count?: number
  product_rating?: number | null
  shop_name?: string | null
  shop_url?: string | null
  shop_fans?: string | null
  shop_sales?: string | null
  shop_rating?: number | null
  sort_mode?: string | null
  rank_position?: number | null
  first_seen_at?: number
  last_updated_at?: number
}

type SyncPayloadKeyword = {
  keyword: string
  sort_mode?: string
  products: SyncPayloadProduct[]
}

type SyncPayload = {
  version?: number
  scrape_session_id?: string
  scraped_at?: number
  keywords: SyncPayloadKeyword[]
}

type Scout1688SearchErrorCode = 'TIMEOUT' | 'PARSE_ERROR' | 'UPLOAD_FAIL'

class Scout1688SearchError extends Error {
  code: Scout1688SearchErrorCode

  constructor(code: Scout1688SearchErrorCode, message: string) {
    super(message)
    this.name = 'Scout1688SearchError'
    this.code = code
  }
}

let scoutingSearchQueue: Promise<void> = Promise.resolve()

function enqueueScout1688Search<T>(task: () => Promise<T>): Promise<T> {
  const run = scoutingSearchQueue.then(task, task)
  scoutingSearchQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

// ----------------------------------------------------------------
// Service
// ----------------------------------------------------------------

export class ScoutService {
  private sqlite: SqliteService

  constructor(sqlite?: SqliteService) {
    this.sqlite = sqlite ?? SqliteService.getInstance()
  }

  // ==============================================================
  // Schema
  // ==============================================================

  ensureSchema(): void {
    const db = this.sqlite.tryGetConnection()
    if (!db) return

    db.exec(`
      CREATE TABLE IF NOT EXISTS scout_keywords (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL UNIQUE,
        sort_mode TEXT NOT NULL DEFAULT 'comprehensive',
        is_active INTEGER NOT NULL DEFAULT 1,
        product_count INTEGER NOT NULL DEFAULT 0,
        last_synced_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scout_products (
        id TEXT PRIMARY KEY,
        keyword_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_url TEXT NOT NULL,
        price REAL,
        add_cart_24h TEXT,
        add_cart_24h_value INTEGER DEFAULT 0,
        total_sales TEXT,
        three_month_buyers TEXT,
        add_cart_tag TEXT,
        positive_review_tag TEXT,
        collection_tag TEXT,
        review_count INTEGER DEFAULT 0,
        product_rating REAL,
        shop_name TEXT,
        shop_url TEXT,
        shop_fans TEXT,
        shop_sales TEXT,
        shop_rating REAL,
        sort_mode TEXT,
        rank_position INTEGER,
        first_seen_at INTEGER NOT NULL,
        last_updated_at INTEGER NOT NULL,
        FOREIGN KEY (keyword_id) REFERENCES scout_keywords(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scout_sync_log (
        id TEXT PRIMARY KEY,
        synced_at INTEGER NOT NULL,
        session_id TEXT,
        keywords_count INTEGER DEFAULT 0,
        products_count INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'success'
      );

      CREATE INDEX IF NOT EXISTS idx_scout_products_keyword_id ON scout_products(keyword_id);
      CREATE INDEX IF NOT EXISTS idx_scout_products_24h_value ON scout_products(add_cart_24h_value DESC);
      CREATE INDEX IF NOT EXISTS idx_scout_products_rank ON scout_products(keyword_id, rank_position);
      CREATE INDEX IF NOT EXISTS idx_scout_products_updated ON scout_products(last_updated_at DESC);

      CREATE TABLE IF NOT EXISTS scout_dashboard_product_map (
        product_key TEXT PRIMARY KEY,
        primary_keyword TEXT NOT NULL,
        product_name TEXT NOT NULL DEFAULT '',
        product_url TEXT,
        shop_name TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scout_dashboard_snapshot_rows (
        snapshot_date TEXT NOT NULL,
        product_key TEXT NOT NULL,
        keyword TEXT NOT NULL,
        primary_keyword TEXT NOT NULL,
        product_name TEXT NOT NULL DEFAULT '',
        product_url TEXT,
        price REAL,
        add_cart_24h_value INTEGER NOT NULL DEFAULT 0,
        total_sales TEXT,
        three_month_buyers TEXT,
        shop_name TEXT,
        shop_fans TEXT,
        product_rating REAL,
        shop_rating REAL,
        first_seen_at INTEGER NOT NULL,
        last_updated_at INTEGER NOT NULL,
        source_file TEXT,
        raw_payload TEXT,
        imported_at INTEGER NOT NULL,
        PRIMARY KEY (snapshot_date, product_key)
      );

      CREATE INDEX IF NOT EXISTS idx_scout_dash_snap_date ON scout_dashboard_snapshot_rows(snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_scout_dash_keyword_date ON scout_dashboard_snapshot_rows(primary_keyword, snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_scout_dash_product_date ON scout_dashboard_snapshot_rows(product_key, snapshot_date);

      CREATE TABLE IF NOT EXISTS scout_dashboard_watchlist (
        id TEXT PRIMARY KEY,
        snapshot_date TEXT NOT NULL,
        product_key TEXT NOT NULL,
        keyword TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_url TEXT,
        sale_price REAL,
        source_image_1 TEXT,
        source_image_2 TEXT,
        supplier1_name TEXT,
        supplier1_url TEXT,
        supplier1_price REAL,
        supplier2_name TEXT,
        supplier2_url TEXT,
        supplier2_price REAL,
        supplier3_name TEXT,
        supplier3_url TEXT,
        supplier3_price REAL,
        profit1 REAL,
        profit2 REAL,
        profit3 REAL,
        best_profit_amount REAL,
        sourcing_status TEXT NOT NULL DEFAULT 'idle',
        sourcing_message TEXT,
        sourcing_updated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (snapshot_date, product_key)
      );

      CREATE INDEX IF NOT EXISTS idx_scout_watchlist_snapshot ON scout_dashboard_watchlist(snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_scout_watchlist_keyword ON scout_dashboard_watchlist(keyword, snapshot_date);

      CREATE TABLE IF NOT EXISTS scout_dashboard_cover_cache (
        product_key TEXT PRIMARY KEY,
        product_url TEXT,
        image_url TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scout_cover_cache_updated ON scout_dashboard_cover_cache(updated_at);
    `)

    const snapshotColumns = db
      .prepare(`PRAGMA table_info(scout_dashboard_snapshot_rows)`)
      .all() as Array<{ name?: unknown }>
    const hasShopFans = snapshotColumns.some((col) => normalizeText(col.name) === 'shop_fans')
    const hasRawPayload = snapshotColumns.some((col) => normalizeText(col.name) === 'raw_payload')
    if (!hasShopFans) {
      db.exec(`ALTER TABLE scout_dashboard_snapshot_rows ADD COLUMN shop_fans TEXT`)
    }
    if (!hasRawPayload) {
      db.exec(`ALTER TABLE scout_dashboard_snapshot_rows ADD COLUMN raw_payload TEXT`)
    }
  }

  // ==============================================================
  // Keywords
  // ==============================================================

  listKeywords(): ScoutKeywordRecord[] {
    const db = this.sqlite.connection
    const rows = db
      .prepare(
        `SELECT id, keyword, sort_mode, is_active, product_count, last_synced_at, created_at
         FROM scout_keywords ORDER BY keyword`
      )
      .all() as Array<Record<string, unknown>>

    return rows.map((r) => ({
      id: String(r.id),
      keyword: String(r.keyword),
      sortMode: String(r.sort_mode),
      isActive: Boolean(r.is_active),
      productCount: Number(r.product_count) || 0,
      lastSyncedAt: typeof r.last_synced_at === 'number' ? r.last_synced_at : null,
      createdAt: Number(r.created_at)
    }))
  }

  addKeyword(keyword: string, sortMode: string = 'comprehensive'): ScoutKeywordRecord {
    const db = this.sqlite.connection
    const id = randomUUID().replace(/-/g, '').slice(0, 12)
    const now = Date.now()

    db.prepare(
      `INSERT INTO scout_keywords (id, keyword, sort_mode, created_at) VALUES (?, ?, ?, ?)`
    ).run(id, keyword.trim(), sortMode, now)

    return { id, keyword: keyword.trim(), sortMode, isActive: true, productCount: 0, lastSyncedAt: null, createdAt: now }
  }

  removeKeyword(id: string): void {
    const db = this.sqlite.connection
    db.prepare(`DELETE FROM scout_products WHERE keyword_id = ?`).run(id)
    db.prepare(`DELETE FROM scout_keywords WHERE id = ?`).run(id)
  }

  toggleKeyword(id: string, isActive: boolean): void {
    const db = this.sqlite.connection
    db.prepare(`UPDATE scout_keywords SET is_active = ? WHERE id = ?`).run(isActive ? 1 : 0, id)
  }

  // ==============================================================
  // Products
  // ==============================================================

  listProducts(opts: ScoutProductListOptions): ScoutProductRecord[] {
    const db = this.sqlite.connection

    const allowedSorts = new Set([
      'add_cart_24h_value', 'price', 'product_rating',
      'review_count', 'rank_position', 'last_updated_at', 'first_seen_at'
    ])
    const sortBy = allowedSorts.has(opts.sortBy ?? '') ? opts.sortBy! : 'add_cart_24h_value'
    const sortOrder = opts.sortOrder === 'ASC' ? 'ASC' : 'DESC'
    const limit = Math.min(opts.limit ?? 200, 5000)
    const offset = opts.offset ?? 0

    const rows = db
      .prepare(
        `SELECT * FROM scout_products
         WHERE keyword_id = ?
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(opts.keywordId, limit, offset) as Array<Record<string, unknown>>

    return rows.map(mapProductRow)
  }

  getProductCount(keywordId: string): number {
    const db = this.sqlite.connection
    const row = db
      .prepare(`SELECT COUNT(*) as cnt FROM scout_products WHERE keyword_id = ?`)
      .get(keywordId) as { cnt: number } | undefined
    return row?.cnt ?? 0
  }

  // ==============================================================
  // Sync / Import
  // ==============================================================

  importSyncData(payload: unknown): { keywordsUpdated: number; productsUpserted: number } {
    const data = payload as SyncPayload
    if (!data || !Array.isArray(data.keywords)) {
      return { keywordsUpdated: 0, productsUpserted: 0 }
    }

    const db = this.sqlite.connection
    const now = Date.now()
    let keywordsUpdated = 0
    let productsUpserted = 0

    const ensureKeyword = db.prepare(
      `INSERT INTO scout_keywords (id, keyword, sort_mode, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(keyword) DO UPDATE SET sort_mode = excluded.sort_mode`
    )
    const getKeywordId = db.prepare(`SELECT id FROM scout_keywords WHERE keyword = ?`)

    const upsertProduct = db.prepare(`
      INSERT INTO scout_products (
        id, keyword_id, product_name, product_url, price,
        add_cart_24h, add_cart_24h_value, total_sales, three_month_buyers,
        add_cart_tag, positive_review_tag, collection_tag,
        review_count, product_rating,
        shop_name, shop_url, shop_fans, shop_sales, shop_rating,
        sort_mode, rank_position,
        first_seen_at, last_updated_at
      ) VALUES (
        @id, @keywordId, @productName, @productUrl, @price,
        @addCart24h, @addCart24hValue, @totalSales, @threeMonthBuyers,
        @addCartTag, @positiveReviewTag, @collectionTag,
        @reviewCount, @productRating,
        @shopName, @shopUrl, @shopFans, @shopSales, @shopRating,
        @sortMode, @rankPosition,
        @firstSeenAt, @lastUpdatedAt
      ) ON CONFLICT(id) DO UPDATE SET
        product_name = excluded.product_name,
        product_url = excluded.product_url,
        price = excluded.price,
        add_cart_24h = excluded.add_cart_24h,
        add_cart_24h_value = excluded.add_cart_24h_value,
        total_sales = excluded.total_sales,
        three_month_buyers = excluded.three_month_buyers,
        add_cart_tag = excluded.add_cart_tag,
        positive_review_tag = excluded.positive_review_tag,
        collection_tag = excluded.collection_tag,
        review_count = excluded.review_count,
        product_rating = excluded.product_rating,
        shop_name = excluded.shop_name,
        shop_url = excluded.shop_url,
        shop_fans = excluded.shop_fans,
        shop_sales = excluded.shop_sales,
        shop_rating = excluded.shop_rating,
        sort_mode = excluded.sort_mode,
        rank_position = excluded.rank_position,
        last_updated_at = excluded.last_updated_at
    `)

    const updateKeywordStats = db.prepare(`
      UPDATE scout_keywords SET
        product_count = (SELECT COUNT(*) FROM scout_products WHERE keyword_id = ?),
        last_synced_at = ?
      WHERE id = ?
    `)

    const tx = db.transaction(() => {
      for (const kw of data.keywords) {
        const keyword = String(kw.keyword ?? '').trim()
        if (!keyword) continue

        const sortMode = String(kw.sort_mode ?? 'comprehensive')
        const kid = randomUUID().replace(/-/g, '').slice(0, 12)

        ensureKeyword.run(kid, keyword, sortMode, now)
        const row = getKeywordId.get(keyword) as { id: string } | undefined
        const keywordId = row?.id ?? kid
        keywordsUpdated++

        for (const p of kw.products ?? []) {
          const productUrl = String(p.product_url ?? '').trim()
          if (!productUrl) continue

          const pid = p.id ?? productUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-16)

          upsertProduct.run({
            id: pid,
            keywordId,
            productName: String(p.product_name ?? ''),
            productUrl,
            price: p.price ?? null,
            addCart24h: p.add_cart_24h ?? null,
            addCart24hValue: p.add_cart_24h_value ?? 0,
            totalSales: p.total_sales ?? null,
            threeMonthBuyers: p.three_month_buyers ?? null,
            addCartTag: p.add_cart_tag ?? null,
            positiveReviewTag: p.positive_review_tag ?? null,
            collectionTag: p.collection_tag ?? null,
            reviewCount: p.review_count ?? 0,
            productRating: p.product_rating ?? null,
            shopName: p.shop_name ?? null,
            shopUrl: p.shop_url ?? null,
            shopFans: p.shop_fans ?? null,
            shopSales: p.shop_sales ?? null,
            shopRating: p.shop_rating ?? null,
            sortMode: p.sort_mode ?? sortMode,
            rankPosition: p.rank_position ?? null,
            firstSeenAt: p.first_seen_at ?? now,
            lastUpdatedAt: p.last_updated_at ?? now
          })
          productsUpserted++
        }

        updateKeywordStats.run(keywordId, now, keywordId)
      }

      // Log the sync
      db.prepare(
        `INSERT INTO scout_sync_log (id, synced_at, session_id, keywords_count, products_count, status)
         VALUES (?, ?, ?, ?, ?, 'success')`
      ).run(
        randomUUID().replace(/-/g, '').slice(0, 12),
        now,
        data.scrape_session_id ?? null,
        keywordsUpdated,
        productsUpserted
      )
    })

    tx()
    return { keywordsUpdated, productsUpserted }
  }

  async importFromFile(filePath: string): Promise<{ keywordsUpdated: number; productsUpserted: number }> {
    const raw = await readFile(filePath, 'utf-8')
    const data = JSON.parse(raw) as unknown
    return this.importSyncData(data)
  }

  getSyncHistory(limit: number = 20): ScoutSyncLogRecord[] {
    const db = this.sqlite.connection
    const rows = db
      .prepare(`SELECT * FROM scout_sync_log ORDER BY synced_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>

    return rows.map((r) => ({
      id: String(r.id),
      syncedAt: Number(r.synced_at),
      sessionId: r.session_id ? String(r.session_id) : null,
      keywordsCount: Number(r.keywords_count) || 0,
      productsCount: Number(r.products_count) || 0,
      status: String(r.status)
    }))
  }

  async importExcelSnapshotFromFile(filePath: string): Promise<ScoutExcelImportResult> {
    const normalizedPath = String(filePath ?? '').trim()
    if (!normalizedPath) throw new Error('文件路径不能为空')

    const workbook = await createExcelWorkbook()
    await workbook.xlsx.readFile(normalizedPath)

    const db = this.sqlite.connection
    const now = Date.now()
    const sourceFile = basename(normalizedPath)
    const snapshotDates = new Set<string>()
    const keywords = new Set<string>()

    type CandidateRow = {
      snapshotDate: string
      productKey: string
      keyword: string
      primaryKeyword: string
      productName: string
      productUrl: string | null
      price: number | null
      addCart24hValue: number
      totalSales: string | null
      threeMonthBuyers: string | null
      shopName: string | null
      shopFans: string | null
      productRating: number | null
      shopRating: number | null
      firstSeenAt: number
      lastUpdatedAt: number
      rawPayload: string
    }

    type ProductMapInfo = {
      productKey: string
      primaryKeyword: string
      productName: string
      productUrl: string | null
      shopName: string | null
      firstSeenAt: number
      lastSeenAt: number
    }

    const candidateRows = new Map<string, CandidateRow>()
    const productMapBuffer = new Map<string, ProductMapInfo>()
    const primaryKeywordCache = new Map<string, string>()

    const selectPrimaryKeyword = db.prepare(
      `SELECT primary_keyword FROM scout_dashboard_product_map WHERE product_key = ?`
    )

    for (const worksheet of workbook.worksheets) {
      const keyword = String(worksheet.name ?? '').trim()
      if (!keyword) continue
      keywords.add(keyword)

      const headerIndex = buildHeaderIndex(worksheet.getRow(1).values as Array<unknown>)
      if (headerIndex.size === 0) continue

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        const getVal = (columnName: string): unknown => {
          const idx = headerIndex.get(columnName)
          if (!idx || idx <= 0) return null
          return row.getCell(idx).value
        }

        const productName = getCellString(getVal('商品名称'))
        const productUrl = normalizeNullable(getCellLinkOrText(getVal('商品链接')))
        const shopName = normalizeNullable(getCellString(getVal('店铺名称')))
        const lastUpdatedRaw = getVal('最后更新时间')
        const lastUpdatedAt = parseDateMs(lastUpdatedRaw)
        if (!lastUpdatedAt) continue

        const snapshotDate = formatDateYmd(lastUpdatedAt)
        const productKey = buildProductKey(productUrl, productName, shopName)
        if (!productKey) continue

        snapshotDates.add(snapshotDate)

        const cachedPrimaryKeyword = primaryKeywordCache.get(productKey)
        let primaryKeyword = cachedPrimaryKeyword ?? ''
        if (!primaryKeyword) {
          const mapped = selectPrimaryKeyword.get(productKey) as { primary_keyword?: unknown } | undefined
          primaryKeyword = normalizeText(mapped?.primary_keyword) || keyword
          primaryKeywordCache.set(productKey, primaryKeyword)
        }

        const price = parseNumber(getVal('价格'))
        const addCart24hValue = toInt(getVal('24h加购'))
        const totalSales = normalizeNullable(getCellString(getVal('销量')))
        const threeMonthBuyers = normalizeNullable(getCellString(getVal('3个月购买人数')))
        const addCartTag = normalizeNullable(getCellString(getVal('加购标签')))
        const positiveReviewTag = normalizeNullable(getCellString(getVal('好评标签')))
        const collectionTag = normalizeNullable(getCellString(getVal('收藏标签')))
        const shopUrl = normalizeNullable(getCellLinkOrText(getVal('店铺链接')))
        const shopFans = normalizeNullable(getCellString(getVal('店铺粉丝')))
        const shopSales = normalizeNullable(getCellString(getVal('店铺销量')))
        const reviewCount = toInt(getVal('评价数'))
        const productRating = parseNumber(getVal('商品评分'))
        const shopRating = parseNumber(getVal('店铺评分'))
        const firstSeenRaw = getVal('首次发现时间')
        const firstSeenAt = parseDateMs(firstSeenRaw) ?? lastUpdatedAt
        const rawPayload = JSON.stringify({
          关键词: keyword,
          主关键词: primaryKeyword,
          快照日期: snapshotDate,
          商品名称: productName,
          商品链接: productUrl,
          价格: price,
          '24h加购': addCart24hValue,
          销量: totalSales,
          '3个月购买人数': threeMonthBuyers,
          加购标签: addCartTag,
          好评标签: positiveReviewTag,
          收藏标签: collectionTag,
          店铺名称: shopName,
          店铺链接: shopUrl,
          店铺粉丝: shopFans,
          店铺销量: shopSales,
          店铺评分: shopRating,
          评价数: reviewCount,
          商品评分: productRating,
          首次发现时间: formatDateTimeLocal(firstSeenAt),
          最后更新时间: formatDateTimeLocal(lastUpdatedAt)
        })

        const candidate: CandidateRow = {
          snapshotDate,
          productKey,
          keyword,
          primaryKeyword,
          productName,
          productUrl,
          price,
          addCart24hValue,
          totalSales,
          threeMonthBuyers,
          shopName,
          shopFans,
          productRating,
          shopRating,
          firstSeenAt,
          lastUpdatedAt,
          rawPayload
        }

        const dedupeKey = `${snapshotDate}::${productKey}`
        const existing = candidateRows.get(dedupeKey)
        if (!existing) {
          candidateRows.set(dedupeKey, candidate)
        } else if (existing.keyword !== existing.primaryKeyword && keyword === existing.primaryKeyword) {
          candidateRows.set(dedupeKey, candidate)
        } else if (candidate.addCart24hValue > existing.addCart24hValue) {
          candidateRows.set(dedupeKey, candidate)
        }

        const mapInfo = productMapBuffer.get(productKey)
        if (!mapInfo) {
          productMapBuffer.set(productKey, {
            productKey,
            primaryKeyword,
            productName,
            productUrl,
            shopName,
            firstSeenAt,
            lastSeenAt: lastUpdatedAt
          })
        } else {
          mapInfo.lastSeenAt = Math.max(mapInfo.lastSeenAt, lastUpdatedAt)
          if (!mapInfo.productName && productName) mapInfo.productName = productName
          if (!mapInfo.productUrl && productUrl) mapInfo.productUrl = productUrl
          if (!mapInfo.shopName && shopName) mapInfo.shopName = shopName
          mapInfo.firstSeenAt = Math.min(mapInfo.firstSeenAt, firstSeenAt)
        }
      }
    }

    const upsertMap = db.prepare(`
      INSERT INTO scout_dashboard_product_map (
        product_key, primary_keyword, product_name, product_url, shop_name, first_seen_at, last_seen_at
      ) VALUES (
        @productKey, @primaryKeyword, @productName, @productUrl, @shopName, @firstSeenAt, @lastSeenAt
      )
      ON CONFLICT(product_key) DO UPDATE SET
        product_name = CASE
          WHEN excluded.product_name IS NOT NULL AND excluded.product_name != '' THEN excluded.product_name
          ELSE scout_dashboard_product_map.product_name
        END,
        product_url = COALESCE(excluded.product_url, scout_dashboard_product_map.product_url),
        shop_name = COALESCE(excluded.shop_name, scout_dashboard_product_map.shop_name),
        first_seen_at = MIN(excluded.first_seen_at, scout_dashboard_product_map.first_seen_at),
        last_seen_at = MAX(excluded.last_seen_at, scout_dashboard_product_map.last_seen_at)
    `)

    const upsertSnapshot = db.prepare(`
      INSERT INTO scout_dashboard_snapshot_rows (
        snapshot_date, product_key, keyword, primary_keyword, product_name, product_url, price,
        add_cart_24h_value, total_sales, three_month_buyers, shop_name, shop_fans, product_rating, shop_rating,
        first_seen_at, last_updated_at, source_file, raw_payload, imported_at
      ) VALUES (
        @snapshotDate, @productKey, @keyword, @primaryKeyword, @productName, @productUrl, @price,
        @addCart24hValue, @totalSales, @threeMonthBuyers, @shopName, @shopFans, @productRating, @shopRating,
        @firstSeenAt, @lastUpdatedAt, @sourceFile, @rawPayload, @importedAt
      )
      ON CONFLICT(snapshot_date, product_key) DO UPDATE SET
        keyword = excluded.keyword,
        primary_keyword = excluded.primary_keyword,
        product_name = excluded.product_name,
        product_url = excluded.product_url,
        price = excluded.price,
        add_cart_24h_value = excluded.add_cart_24h_value,
        total_sales = excluded.total_sales,
        three_month_buyers = excluded.three_month_buyers,
        shop_name = excluded.shop_name,
        shop_fans = excluded.shop_fans,
        product_rating = excluded.product_rating,
        shop_rating = excluded.shop_rating,
        first_seen_at = MIN(excluded.first_seen_at, scout_dashboard_snapshot_rows.first_seen_at),
        last_updated_at = excluded.last_updated_at,
        source_file = excluded.source_file,
        raw_payload = excluded.raw_payload,
        imported_at = excluded.imported_at
    `)

    const tx = db.transaction(() => {
      const importedDates = Array.from(snapshotDates).sort()
      if (importedDates.length > 0) {
        const placeholders = importedDates.map(() => '?').join(',')
        db.prepare(
          `DELETE FROM scout_dashboard_snapshot_rows
           WHERE source_file = ? AND snapshot_date IN (${placeholders})`
        ).run(sourceFile, ...importedDates)
      }

      for (const item of productMapBuffer.values()) {
        upsertMap.run(item)
      }

      for (const row of candidateRows.values()) {
        upsertSnapshot.run({
          ...row,
          sourceFile,
          importedAt: now
        })
      }

      db.prepare(
        `INSERT INTO scout_sync_log (id, synced_at, session_id, keywords_count, products_count, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID().replace(/-/g, '').slice(0, 12),
        now,
        sourceFile,
        keywords.size,
        candidateRows.size,
        'excel_import'
      )
    })
    tx()

    return {
      snapshotDates: Array.from(snapshotDates).sort(),
      rowsUpserted: candidateRows.size,
      productsMapped: productMapBuffer.size,
      keywordsCount: keywords.size,
      sourceFile
    }
  }

  deleteDashboardSnapshot(snapshotDate: string): ScoutDashboardDeleteSnapshotResult {
    const db = this.sqlite.connection
    const date = normalizeText(snapshotDate)
    if (!date) {
      throw new Error('快照日期不能为空')
    }

    const chunked = <T>(rows: T[], size = 400): T[][] => {
      const list: T[][] = []
      for (let i = 0; i < rows.length; i += size) {
        list.push(rows.slice(i, i + size))
      }
      return list
    }

    const result = db.transaction(() => {
      const importBatchRows = db
        .prepare(
          `SELECT DISTINCT imported_at
           FROM scout_dashboard_snapshot_rows
           WHERE snapshot_date = ?`
        )
        .all(date) as Array<{ imported_at?: unknown }>
      const importBatches = Array.from(
        new Set(importBatchRows.map((row) => toInt(row.imported_at)).filter((value) => value > 0))
      )
      if (importBatches.length === 0) {
        return {
          snapshotDate: date,
          deletedSnapshotRows: 0,
          deletedWatchlistRows: 0,
          deletedProductMapRows: 0,
          deletedCoverCacheRows: 0,
          deletedImportBatches: 0,
          affectedSnapshotDates: []
        } satisfies ScoutDashboardDeleteSnapshotResult
      }

      const touchedProductRows: Array<{ product_key?: unknown; snapshot_date?: unknown }> = []
      for (const batchIds of chunked(importBatches)) {
        const placeholders = batchIds.map(() => '?').join(',')
        const rows = db
          .prepare(
            `SELECT product_key, snapshot_date
             FROM scout_dashboard_snapshot_rows
             WHERE imported_at IN (${placeholders})`
          )
          .all(...batchIds) as Array<{ product_key?: unknown; snapshot_date?: unknown }>
        touchedProductRows.push(...rows)
      }

      const productKeys = Array.from(
        new Set(touchedProductRows.map((row) => normalizeText(row.product_key)).filter(Boolean))
      )
      const affectedSnapshotDates = Array.from(
        new Set(touchedProductRows.map((row) => normalizeText(row.snapshot_date)).filter(Boolean))
      ).sort()

      let deletedSnapshotRows = 0
      for (const batchIds of chunked(importBatches)) {
        const placeholders = batchIds.map(() => '?').join(',')
        deletedSnapshotRows +=
          db
            .prepare(`DELETE FROM scout_dashboard_snapshot_rows WHERE imported_at IN (${placeholders})`)
            .run(...batchIds).changes ?? 0
      }

      const deletedWatchlistRows =
        db
          .prepare(
            `DELETE FROM scout_dashboard_watchlist
             WHERE NOT EXISTS (
               SELECT 1
               FROM scout_dashboard_snapshot_rows s
               WHERE s.snapshot_date = scout_dashboard_watchlist.snapshot_date
                 AND s.product_key = scout_dashboard_watchlist.product_key
             )`
          )
          .run().changes ?? 0

      let deletedProductMapRows = 0
      let deletedCoverCacheRows = 0

      if (productKeys.length > 0) {
        const remainedProductKeys = new Set<string>()
        for (const keys of chunked(productKeys)) {
          const placeholders = keys.map(() => '?').join(',')
          const rows = db
            .prepare(
              `SELECT DISTINCT product_key
               FROM scout_dashboard_snapshot_rows
               WHERE product_key IN (${placeholders})`
            )
            .all(...keys) as Array<{ product_key?: unknown }>
          for (const row of rows) {
            const key = normalizeText(row.product_key)
            if (key) remainedProductKeys.add(key)
          }
        }

        const staleProductKeys = productKeys.filter((key) => !remainedProductKeys.has(key))
        for (const keys of chunked(staleProductKeys)) {
          const placeholders = keys.map(() => '?').join(',')
          deletedProductMapRows +=
            db
              .prepare(`DELETE FROM scout_dashboard_product_map WHERE product_key IN (${placeholders})`)
              .run(...keys).changes ?? 0
          deletedCoverCacheRows +=
            db
              .prepare(`DELETE FROM scout_dashboard_cover_cache WHERE product_key IN (${placeholders})`)
              .run(...keys).changes ?? 0
        }
      }

      return {
        snapshotDate: date,
        deletedSnapshotRows,
        deletedWatchlistRows,
        deletedProductMapRows,
        deletedCoverCacheRows,
        deletedImportBatches: importBatches.length,
        affectedSnapshotDates
      } satisfies ScoutDashboardDeleteSnapshotResult
    })

    return result()
  }

  getDashboardMeta(): ScoutDashboardMeta {
    const db = this.sqlite.connection
    const dates = db
      .prepare(
        `SELECT DISTINCT snapshot_date FROM scout_dashboard_snapshot_rows ORDER BY snapshot_date DESC LIMIT 30`
      )
      .all() as Array<{ snapshot_date?: unknown }>
    const availableDates = dates.map((r) => normalizeText(r.snapshot_date)).filter(Boolean)
    const latestDate = availableDates[0] ?? null

    let totalKeywords = 0
    let totalProducts = 0
    if (latestDate) {
      const keyRow = db
        .prepare(
          `SELECT COUNT(DISTINCT primary_keyword) AS cnt FROM scout_dashboard_snapshot_rows WHERE snapshot_date = ?`
        )
        .get(latestDate) as { cnt?: unknown } | undefined
      const productRow = db
        .prepare(`SELECT COUNT(*) AS cnt FROM scout_dashboard_snapshot_rows WHERE snapshot_date = ?`)
        .get(latestDate) as { cnt?: unknown } | undefined
      totalKeywords = toInt(keyRow?.cnt)
      totalProducts = toInt(productRow?.cnt)
    }

    const lastImport = db
      .prepare(`SELECT MAX(imported_at) AS ts FROM scout_dashboard_snapshot_rows`)
      .get() as { ts?: unknown } | undefined

    return {
      latestDate,
      availableDates,
      totalKeywords,
      totalProducts,
      lastImportAt: toInt(lastImport?.ts) || null
    }
  }

  listDashboardKeywordHeat(query: ScoutDashboardHeatQuery = {}): ScoutKeywordHeatRecord[] {
    const db = this.sqlite.connection
    const base = this.resolveSnapshotWindow(query.snapshotDate)
    if (!base.currentDate) return []

    const keywordFilter = normalizeText(query.keyword)
    const whereCurrent = keywordFilter
      ? `WHERE snapshot_date = ? AND primary_keyword = ?`
      : `WHERE snapshot_date = ?`
    const currentRows = db
      .prepare(
        `SELECT primary_keyword AS keyword, SUM(add_cart_24h_value) AS heat, COUNT(*) AS product_count
         FROM scout_dashboard_snapshot_rows
         ${whereCurrent}
         GROUP BY primary_keyword`
      )
      .all(...(keywordFilter ? [base.currentDate, keywordFilter] : [base.currentDate])) as Array<Record<string, unknown>>

    const prevMap = this.getKeywordHeatMap(base.prevDate, keywordFilter)
    const prev2Map = this.getKeywordHeatMap(base.prev2Date, keywordFilter)

    const list: ScoutKeywordHeatRecord[] = currentRows.map((row) => {
      const keyword = normalizeText(row.keyword)
      const todayHeat = toInt(row.heat)
      const prevHeat = keyword ? prevMap.get(keyword) ?? null : null
      const prev2Heat = keyword ? prev2Map.get(keyword) ?? null : null
      const deltaHeat = prevHeat == null ? null : todayHeat - prevHeat
      const growthRate = prevHeat == null || prevHeat <= 0 ? null : deltaHeat! / prevHeat
      const hitRules = Number(deltaHeat != null && deltaHeat >= 600) +
        Number(growthRate != null && growthRate >= 0.2) +
        Number(todayHeat >= 2000)
      const isAlert = prevHeat != null && hitRules >= 1
      const isRising2d =
        prevHeat != null && prev2Heat != null && todayHeat > prevHeat && prevHeat > prev2Heat

      return {
        keyword,
        todayHeat,
        prevHeat,
        deltaHeat,
        growthRate,
        productCount: toInt(row.product_count),
        isAlert,
        isRising2d
      }
    })

    const filtered = query.onlyAlerts ? list.filter((item) => item.isAlert) : list
    filtered.sort((a, b) => {
      const ad = a.deltaHeat ?? Number.MIN_SAFE_INTEGER
      const bd = b.deltaHeat ?? Number.MIN_SAFE_INTEGER
      if (bd !== ad) return bd - ad
      return b.todayHeat - a.todayHeat
    })

    const limit = clamp(query.limit ?? 20, 1, 200)
    return filtered.slice(0, limit)
  }

  listDashboardPotentialProducts(query: ScoutDashboardPotentialQuery = {}): ScoutPotentialProductRecord[] {
    const db = this.sqlite.connection
    const base = this.resolveSnapshotWindow(query.snapshotDate)
    if (!base.currentDate) return []

    const keywordFilter = normalizeText(query.keyword)
    const whereCurrent = keywordFilter
      ? `WHERE snapshot_date = ? AND primary_keyword = ?`
      : `WHERE snapshot_date = ?`
    const currentRows = db
      .prepare(
        `SELECT
          product_key, primary_keyword, product_name, product_url, price, add_cart_24h_value,
          first_seen_at, last_updated_at, shop_name, shop_fans
         FROM scout_dashboard_snapshot_rows
         ${whereCurrent}`
      )
      .all(...(keywordFilter ? [base.currentDate, keywordFilter] : [base.currentDate])) as Array<Record<string, unknown>>
    if (currentRows.length === 0) return []

    const cacheMap = new Map<string, string | null>()
    const productKeys = Array.from(
      new Set(currentRows.map((row) => normalizeText(row.product_key)).filter(Boolean))
    )
    if (productKeys.length > 0) {
      const placeholders = productKeys.map(() => '?').join(',')
      const cacheRows = db
        .prepare(
          `SELECT product_key, image_url
           FROM scout_dashboard_cover_cache
           WHERE product_key IN (${placeholders})`
        )
        .all(...productKeys) as Array<Record<string, unknown>>
      for (const row of cacheRows) {
        const productKey = normalizeText(row.product_key)
        if (!productKey) continue
        cacheMap.set(productKey, normalizeNullable(row.image_url))
      }
    }

    const prevMap = this.getProductHeatMap(base.prevDate)
    const currentDateStart = parseDateMs(`${base.currentDate} 00:00:00`) ?? Date.now()

    const mapped: ScoutPotentialProductRecord[] = currentRows.map((row) => {
      const productKey = normalizeText(row.product_key)
      const addCart24hValue = toInt(row.add_cart_24h_value)
      const prevAddCart24hValue = productKey ? prevMap.get(productKey) ?? null : null
      const deltaAddCart24h =
        prevAddCart24hValue == null ? null : addCart24hValue - prevAddCart24hValue
      const firstSeenAt = toInt(row.first_seen_at)
      const dayMs = 24 * 60 * 60 * 1000
      const isNew =
        firstSeenAt > 0 &&
        firstSeenAt <= currentDateStart + dayMs &&
        currentDateStart - firstSeenAt <= 7 * dayMs
      return {
        productKey,
        keyword: normalizeText(row.primary_keyword),
        productName: normalizeText(row.product_name),
        productUrl: normalizeNullable(row.product_url),
        cachedImageUrl: cacheMap.get(productKey) ?? null,
        price: parseNumber(row.price),
        addCart24hValue,
        prevAddCart24hValue,
        deltaAddCart24h,
        isNew,
        firstSeenAt,
        lastUpdatedAt: toInt(row.last_updated_at),
        shopName: normalizeNullable(row.shop_name),
        shopFans: normalizeNullable(row.shop_fans),
        potentialScore: 0,
        suggestedAction: '暂缓'
      }
    })

    const filteredByNew = query.onlyNew ? mapped.filter((item) => item.isNew) : mapped
    if (filteredByNew.length === 0) return []

    let maxHeat = 0
    let maxDelta = 0
    for (const item of filteredByNew) {
      if (item.addCart24hValue > maxHeat) maxHeat = item.addCart24hValue
      const delta = Math.max(item.deltaAddCart24h ?? 0, 0)
      if (delta > maxDelta) maxDelta = delta
    }
    maxHeat = maxHeat || 1
    maxDelta = maxDelta || 1

    for (const item of filteredByNew) {
      const normHeat = item.addCart24hValue / maxHeat
      const normDelta = Math.max(item.deltaAddCart24h ?? 0, 0) / maxDelta
      const novelty = item.isNew ? 1 : 0
      item.potentialScore = Number(((0.6 * normHeat + 0.3 * normDelta + 0.1 * novelty) * 100).toFixed(2))
      item.suggestedAction = resolveSuggestedAction(item)
    }

    const sortBy = query.sortBy ?? 'potentialScore'
    const sortOrder = query.sortOrder === 'ASC' ? 'ASC' : 'DESC'
    filteredByNew.sort((a, b) => {
      const av = getPotentialSortValue(a, sortBy)
      const bv = getPotentialSortValue(b, sortBy)
      if (av !== bv) {
        return sortOrder === 'ASC' ? av - bv : bv - av
      }
      if (b.potentialScore !== a.potentialScore) return b.potentialScore - a.potentialScore
      if (b.addCart24hValue !== a.addCart24hValue) return b.addCart24hValue - a.addCart24hValue
      return (b.deltaAddCart24h ?? 0) - (a.deltaAddCart24h ?? 0)
    })

    const limit = clamp(query.limit ?? 20, 1, 500)
    return filteredByNew.slice(0, limit)
  }

  getDashboardKeywordTrends(query: ScoutDashboardTrendQuery = {}): ScoutKeywordTrendResult {
    const db = this.sqlite.connection
    const meta = this.getDashboardMeta()
    const latestDate = normalizeText(query.snapshotDate) || meta.latestDate
    if (!latestDate) return { dates: [], series: [] }

    const days = clamp(query.days ?? 7, 2, 14)
    const dateRows = db
      .prepare(
        `SELECT DISTINCT snapshot_date
         FROM scout_dashboard_snapshot_rows
         WHERE snapshot_date <= ?
         ORDER BY snapshot_date DESC
         LIMIT ?`
      )
      .all(latestDate, days) as Array<{ snapshot_date?: unknown }>
    const dates = dateRows
      .map((r) => normalizeText(r.snapshot_date))
      .filter(Boolean)
      .reverse()
    if (dates.length === 0) return { dates: [], series: [] }

    const keywordFilter = normalizeText(query.keyword)
    let keywords: string[] = []
    if (keywordFilter) {
      keywords = [keywordFilter]
    } else {
      const limit = clamp(query.limit ?? 20, 1, 50)
      const ranked = db
        .prepare(
          `SELECT primary_keyword AS keyword, SUM(add_cart_24h_value) AS heat
           FROM scout_dashboard_snapshot_rows
           WHERE snapshot_date = ?
           GROUP BY primary_keyword
           ORDER BY heat DESC
           LIMIT ?`
        )
        .all(latestDate, limit) as Array<{ keyword?: unknown }>
      keywords = ranked.map((r) => normalizeText(r.keyword)).filter(Boolean)
    }
    if (keywords.length === 0) return { dates, series: [] }

    const datePlaceholders = dates.map(() => '?').join(',')
    const keywordPlaceholders = keywords.map(() => '?').join(',')
    const trendRows = db
      .prepare(
        `SELECT snapshot_date, primary_keyword, SUM(add_cart_24h_value) AS heat
         FROM scout_dashboard_snapshot_rows
         WHERE snapshot_date IN (${datePlaceholders}) AND primary_keyword IN (${keywordPlaceholders})
         GROUP BY snapshot_date, primary_keyword`
      )
      .all(...dates, ...keywords) as Array<Record<string, unknown>>

    const heatMap = new Map<string, number>()
    for (const row of trendRows) {
      const d = normalizeText(row.snapshot_date)
      const k = normalizeText(row.primary_keyword)
      if (!d || !k) continue
      heatMap.set(`${d}::${k}`, toInt(row.heat))
    }

    const series: ScoutKeywordTrend[] = keywords.map((keyword) => {
      const values = dates.map((d) => heatMap.get(`${d}::${keyword}`) ?? 0)
      const max = values.length > 0 ? Math.max(...values) : 0
      const min = values.length > 0 ? Math.min(...values) : 0
      return {
        keyword,
        values,
        max,
        min,
        volatility: max - min
      }
    })

    return { dates, series }
  }

  async exportDashboardExcel(
    savePath: string,
    query: {
      snapshotDate?: string
      keyword?: string
      onlyAlerts?: boolean
      onlyNew?: boolean
      limit?: number
    } = {}
  ): Promise<string> {
    const workbook = await createExcelWorkbook()

    const heatRows = this.listDashboardKeywordHeat({
      snapshotDate: query.snapshotDate,
      keyword: query.keyword,
      onlyAlerts: query.onlyAlerts,
      limit: 500
    })
    const potentialRows = this.listDashboardPotentialProducts({
      snapshotDate: query.snapshotDate,
      keyword: query.keyword,
      onlyNew: query.onlyNew,
      limit: 1000
    })
    const trends = this.getDashboardKeywordTrends({
      snapshotDate: query.snapshotDate,
      keyword: query.keyword,
      days: 7,
      limit: 20
    })

    const heatSheet = workbook.addWorksheet('突增关键词')
    heatSheet.columns = [
      { header: '关键词', key: 'keyword', width: 16 },
      { header: '今日热度', key: 'todayHeat', width: 12 },
      { header: '昨日热度', key: 'prevHeat', width: 12 },
      { header: '日增量', key: 'deltaHeat', width: 12 },
      { header: '增速', key: 'growthRate', width: 10 },
      { header: '商品数', key: 'productCount', width: 10 },
      { header: '是否预警', key: 'isAlert', width: 10 },
      { header: '连续2日上升', key: 'isRising2d', width: 12 }
    ]
    for (const row of heatRows) {
      heatSheet.addRow({
        ...row,
        growthRate: row.growthRate == null ? '' : `${(row.growthRate * 100).toFixed(1)}%`,
        isAlert: row.isAlert ? '是' : '否',
        isRising2d: row.isRising2d ? '是' : '否'
      })
    }

    const potentialSheet = workbook.addWorksheet('潜力商品')
    potentialSheet.columns = [
      { header: '主关键词', key: 'keyword', width: 14 },
      { header: '商品名称', key: 'productName', width: 42 },
      { header: '商品链接', key: 'productUrl', width: 38 },
      { header: '今日24h加购', key: 'addCart24hValue', width: 12 },
      { header: '昨日24h加购', key: 'prevAddCart24hValue', width: 12 },
      { header: '日增加购', key: 'deltaAddCart24h', width: 12 },
      { header: '新品', key: 'isNew', width: 8 },
      { header: '潜力分', key: 'potentialScore', width: 10 },
      { header: '建议动作', key: 'suggestedAction', width: 12 },
      { header: '店铺', key: 'shopName', width: 18 },
      { header: '店铺粉丝', key: 'shopFans', width: 12 },
      { header: '首次发现', key: 'firstSeenAt', width: 18 },
      { header: '最后更新', key: 'lastUpdatedAt', width: 18 }
    ]
    for (const row of potentialRows) {
      potentialSheet.addRow({
        ...row,
        isNew: row.isNew ? '是' : '否',
        firstSeenAt: formatDateTimeLocal(row.firstSeenAt),
        lastUpdatedAt: formatDateTimeLocal(row.lastUpdatedAt)
      })
    }

    const trendSheet = workbook.addWorksheet('关键词趋势')
    trendSheet.addRow(['关键词', ...trends.dates])
    for (const item of trends.series) {
      trendSheet.addRow([item.keyword, ...item.values])
    }

    await workbook.xlsx.writeFile(savePath)
    return savePath
  }

  getDashboardProductDetail(
    snapshotDate: string,
    productKey: string
  ): ScoutDashboardProductDetail | null {
    const db = this.sqlite.connection
    const date = normalizeText(snapshotDate)
    const key = normalizeText(productKey)
    if (!date || !key) return null

    const row = db
      .prepare(
        `SELECT *
         FROM scout_dashboard_snapshot_rows
         WHERE snapshot_date = ? AND product_key = ?
         LIMIT 1`
      )
      .get(date, key) as Record<string, unknown> | undefined
    if (!row) return null

    const rawText = normalizeText(row.raw_payload)
    let rawPayload: Record<string, unknown> = {}
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as unknown
        if (parsed && typeof parsed === 'object') {
          rawPayload = parsed as Record<string, unknown>
        }
      } catch {
        rawPayload = {}
      }
    }
    if (Object.keys(rawPayload).length === 0) {
      rawPayload = {
        关键词: normalizeText(row.keyword),
        主关键词: normalizeText(row.primary_keyword),
        快照日期: normalizeText(row.snapshot_date),
        商品名称: normalizeText(row.product_name),
        商品链接: normalizeNullable(row.product_url),
        价格: parseNumber(row.price),
        '24h加购': toInt(row.add_cart_24h_value),
        销量: normalizeNullable(row.total_sales),
        '3个月购买人数': normalizeNullable(row.three_month_buyers),
        店铺名称: normalizeNullable(row.shop_name),
        店铺粉丝: normalizeNullable(row.shop_fans),
        店铺评分: parseNumber(row.shop_rating),
        商品评分: parseNumber(row.product_rating),
        首次发现时间: formatDateTimeLocal(toInt(row.first_seen_at)),
        最后更新时间: formatDateTimeLocal(toInt(row.last_updated_at))
      }
    }

    return {
      snapshotDate: normalizeText(row.snapshot_date),
      productKey: normalizeText(row.product_key),
      keyword: normalizeText(row.keyword),
      primaryKeyword: normalizeText(row.primary_keyword),
      sourceFile: normalizeNullable(row.source_file),
      importedAt: toInt(row.imported_at),
      rawPayload
    }
  }

  markDashboardPotentialProducts(payload: {
    snapshotDate: string
    products: ScoutMarkedProductPayload[]
  }): { upserted: number; skipped: number } {
    const db = this.sqlite.connection
    const snapshotDate = normalizeText(payload.snapshotDate)
    const products = Array.isArray(payload.products) ? payload.products : []
    if (!snapshotDate || products.length === 0) {
      return { upserted: 0, skipped: products.length }
    }

    const now = Date.now()
    const upsert = db.prepare(
      `INSERT INTO scout_dashboard_watchlist (
         id, snapshot_date, product_key, keyword, product_name, product_url, sale_price,
         sourcing_status, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)
       ON CONFLICT(snapshot_date, product_key) DO UPDATE SET
         keyword = excluded.keyword,
         product_name = excluded.product_name,
         product_url = COALESCE(excluded.product_url, scout_dashboard_watchlist.product_url),
         sale_price = COALESCE(excluded.sale_price, scout_dashboard_watchlist.sale_price),
         updated_at = excluded.updated_at`
    )

    let upserted = 0
    let skipped = 0

    const txn = db.transaction((rows: ScoutMarkedProductPayload[]) => {
      for (const item of rows) {
        const productKey = normalizeText(item.productKey)
        const keyword = normalizeText(item.keyword)
        const productName = normalizeText(item.productName)
        if (!productKey || !keyword || !productName) {
          skipped += 1
          continue
        }
        upsert.run(
          randomUUID(),
          snapshotDate,
          productKey,
          keyword,
          productName,
          normalizeNullable(item.productUrl),
          parseNumber(item.salePrice),
          now,
          now
        )
        upserted += 1
      }
    })

    txn(products)
    return { upserted, skipped }
  }

  bindDashboardSupplier(payload: ScoutBindSupplierPayload): ScoutMarkedProductRecord | null {
    const db = this.sqlite.connection
    const snapshotDate = normalizeText(payload.snapshotDate)
    const productKey = normalizeText(payload.productKey)
    if (!snapshotDate || !productKey) return null

    const now = Date.now()
    const companyName = normalizeNullable(payload.companyName)
    const supplierName = normalizeNullable(payload.supplierName) || companyName
    const supplierUrl = normalizeNullable(payload.supplierUrl)
    const supplierPrice = parseNumber(payload.supplierPrice)
    const supplierNetProfit = parseNumber(payload.supplierNetProfit)
    const supplierMoq = normalizeText(payload.supplierMoq)
    const serviceRate = normalizeText(payload.supplierServiceRateLabel)
    const freightPrice = parseNumber(payload.supplierFreightPrice)
    const sourceImage1 = normalizeNullable(payload.sourceImage1)

    const messageParts = [`绑定店铺：${supplierName || '未命名店铺'}`]
    if (serviceRate) messageParts.push(`48h揽收: ${serviceRate}`)
    if (supplierMoq) messageParts.push(`起批: ${supplierMoq}`)
    if (freightPrice != null && Number.isFinite(freightPrice) && freightPrice >= 0) {
      messageParts.push(`运费: ¥${freightPrice}`)
    }
    const sourcingMessage = messageParts.join('；')

    const updated = db
      .prepare(
        `UPDATE scout_dashboard_watchlist
         SET source_image_1 = COALESCE(NULLIF(source_image_1, ''), ?, source_image_1),
             supplier1_name = ?,
             supplier1_url = ?,
             supplier1_price = ?,
             profit1 = ?,
             best_profit_amount = CASE
               WHEN ? IS NOT NULL THEN ?
               ELSE best_profit_amount
             END,
             sourcing_status = 'success',
             sourcing_message = ?,
             sourcing_updated_at = ?,
             updated_at = ?
         WHERE snapshot_date = ? AND product_key = ?`
      )
      .run(
        sourceImage1,
        supplierName,
        supplierUrl,
        supplierPrice,
        supplierNetProfit,
        supplierNetProfit,
        supplierNetProfit,
        sourcingMessage,
        now,
        now,
        snapshotDate,
        productKey
      )

    if ((updated.changes ?? 0) <= 0) return null
    const row = db
      .prepare(`SELECT * FROM scout_dashboard_watchlist WHERE snapshot_date = ? AND product_key = ? LIMIT 1`)
      .get(snapshotDate, productKey) as Record<string, unknown> | undefined
    if (!row) return null
    return mapMarkedProductRow(row)
  }

  listDashboardMarkedProducts(query: {
    snapshotDate?: string
    keyword?: string
  } = {}): ScoutMarkedProductRecord[] {
    const db = this.sqlite.connection
    const latestDate = this.getDashboardMeta().latestDate
    const snapshotDate = normalizeText(query.snapshotDate) || latestDate
    if (!snapshotDate) return []
    const keyword = normalizeText(query.keyword)
    const where = keyword
      ? `WHERE snapshot_date = ? AND keyword = ?`
      : `WHERE snapshot_date = ?`
    const rows = db
      .prepare(
        `SELECT *
         FROM scout_dashboard_watchlist
         ${where}
         ORDER BY created_at DESC`
      )
      .all(...(keyword ? [snapshotDate, keyword] : [snapshotDate])) as Array<Record<string, unknown>>
    return rows.map(mapMarkedProductRow)
  }

  saveDashboardProductCover(productId: string, productUrl: string | null, imageUrl: string): string | null {
    const db = this.sqlite.connection
    const productKey = normalizeText(productId)
    const normalizedUrl = normalizeNullable(productUrl)
    const normalizedImage = normalizeNullable(imageUrl)
    if (!productKey || !normalizedImage) return null

    const now = Date.now()
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO scout_dashboard_cover_cache (product_key, product_url, image_url, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_key) DO UPDATE SET
           product_url = COALESCE(excluded.product_url, scout_dashboard_cover_cache.product_url),
           image_url = excluded.image_url,
           updated_at = excluded.updated_at`
      ).run(productKey, normalizedUrl, normalizedImage, now)

      db.prepare(
        `UPDATE scout_dashboard_watchlist
         SET source_image_1 = COALESCE(NULLIF(source_image_1, ''), ?),
             updated_at = ?
         WHERE product_key = ?`
      ).run(normalizedImage, now, productKey)
    })

    tx()
    return normalizedImage
  }

  async getXhsCoverImage(
    url: string,
    opts: { preferredPartitionKey?: string } = {}
  ): Promise<string | null> {
    const normalizedUrl = normalizeText(url)
    if (!normalizedUrl) return null
    return fetchXhsCoverImageByHiddenWindow(normalizedUrl, {
      preferredPartitionKey: normalizeNullable(opts.preferredPartitionKey) ?? undefined
    })
  }

  async search1688ByImage(
    payload: Scout1688ImageSearchPayload,
    opts: { onCaptchaNeeded?: () => void; onLoginNeeded?: () => void } = {}
  ): Promise<Scout1688SearchResponse> {
    return enqueueScout1688Search(async () => {
      return this.search1688ByImageInternal(payload, opts)
    })
  }

  private async search1688ByImageInternal(
    payload: Scout1688ImageSearchPayload,
    opts: { onCaptchaNeeded?: () => void; onLoginNeeded?: () => void }
  ): Promise<Scout1688SearchResponse> {
    const localImagePath = normalizeText(payload.localImagePath)
    const productId = normalizeText(payload.productId)
    const keyword = normalizeText(payload.keyword)
    const targetPrice = parseNumber(payload.targetPrice)

    if (!productId || targetPrice == null || !Number.isFinite(targetPrice)) {
      throw new Scout1688SearchError('PARSE_ERROR', '自动搜索失败，请尝试手动介入')
    }
    if (!localImagePath && !keyword) {
      throw new Scout1688SearchError('PARSE_ERROR', '自动搜索失败，请尝试手动介入')
    }

    const { BrowserWindow } = await import('electron')
    const FORENSIC_DEBUG_MODE = shouldEnableSourcingVisualMode()
    const win = new BrowserWindow({
      show: FORENSIC_DEBUG_MODE,
      width: 1360,
      height: 920,
      webPreferences: {
        partition: 'persist:scout-sourcing',
        sandbox: false,
        backgroundThrottling: false
      }
    })
    setupSourcingWindowOpenBridge(win)
    let keepWindowOpen = false

    try {
      await win.loadURL('https://www.1688.com/')
      await ensure1688LoginReady(win, { onLoginNeeded: opts.onLoginNeeded })
      const uploadState = localImagePath
        ? await uploadImageByDomInjection(win, localImagePath, { onCaptchaNeeded: opts.onCaptchaNeeded })
        : { ok: false, requiresManualIntervention: false, url: normalizeText(win.webContents.getURL()) }
      const imageUploadOk = uploadState.ok
      let imageResults: Scout1688SupplierResult[] = []
      let imageSearchFailedByUpload = false

      if (uploadState.requiresManualIntervention) {
        const stuckUrl = normalizeText(uploadState.url || win.webContents.getURL())
        if (FORENSIC_DEBUG_MODE) {
          keepWindowOpen = true
          if (!win.isDestroyed()) {
            win.show()
            win.focus()
            maybeOpenSourcingDevTools(win)
          }
          console.log('Stuck at URL:', stuckUrl)
          return { error: 'DEBUG_MODE_ACTIVE', url: stuckUrl || 'about:blank' }
        }
        imageSearchFailedByUpload = true
      }

      if (imageUploadOk) {
        try {
          imageResults = await waitForImageSearchAndParse(win, {
            targetPrice,
            onCaptchaNeeded: opts.onCaptchaNeeded
          })
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          if (
            (error instanceof Scout1688SearchError && error.code === 'UPLOAD_FAIL') ||
            /UPLOAD_FAILED/i.test(text)
          ) {
            imageSearchFailedByUpload = true
            imageResults = []
          } else {
            throw error
          }
        }
        if (imageResults.length > 0) {
          return imageResults.map((item) => ({ ...item, isFallback: false }))
        }
      }

      if (!FORENSIC_DEBUG_MODE && (imageUploadOk === false || imageSearchFailedByUpload || imageResults.length === 0) && keyword) {
        console.info('[ScoutSourcing] Image search failed/empty, falling back to keyword search', {
          productId,
          keyword
        })
        const fallback = await search1688ByKeywordInWindow(win, {
          keyword,
          targetPrice,
          onCaptchaNeeded: opts.onCaptchaNeeded
        })
        if (fallback.length > 0) {
          return fallback.map((item) => ({ ...item, isFallback: true }))
        }
      }

      if (!imageUploadOk || imageSearchFailedByUpload) {
        throw new Scout1688SearchError('UPLOAD_FAIL', '自动搜索失败，请尝试手动介入')
      }
      throw new Scout1688SearchError('PARSE_ERROR', '自动搜索失败，请尝试手动介入')
    } catch (error) {
      const currentUrl = normalizeText(win.webContents.getURL())
      console.log('Stuck at URL:', currentUrl)
      keepWindowOpen = FORENSIC_DEBUG_MODE
      if (FORENSIC_DEBUG_MODE && !win.isDestroyed()) {
        win.show()
        win.focus()
        maybeOpenSourcingDevTools(win)
      }
      if (FORENSIC_DEBUG_MODE) {
        return { error: 'DEBUG_MODE_ACTIVE', url: currentUrl || 'about:blank' }
      }
      if (error instanceof Scout1688SearchError) throw error
      const text = error instanceof Error ? error.message : String(error)
      if (/timeout|超时/i.test(text)) {
        throw new Scout1688SearchError('TIMEOUT', '自动搜索失败，请尝试手动介入')
      }
      throw new Scout1688SearchError('PARSE_ERROR', '自动搜索失败，请尝试手动介入')
    } finally {
      const shouldCloseWindow = !keepWindowOpen && !shouldKeepSourcingWindowOpenAfterRun()
      if (shouldCloseWindow && !win.isDestroyed()) win.destroy()
    }
  }

  private resolveSnapshotWindow(snapshotDate?: string): {
    currentDate: string | null
    prevDate: string | null
    prev2Date: string | null
  } {
    const db = this.sqlite.connection
    const requested = normalizeText(snapshotDate)
    const latest = db
      .prepare(`SELECT MAX(snapshot_date) AS d FROM scout_dashboard_snapshot_rows`)
      .get() as { d?: unknown } | undefined
    const currentDate = requested || normalizeText(latest?.d) || null
    if (!currentDate) return { currentDate: null, prevDate: null, prev2Date: null }

    const prev = db
      .prepare(`SELECT MAX(snapshot_date) AS d FROM scout_dashboard_snapshot_rows WHERE snapshot_date < ?`)
      .get(currentDate) as { d?: unknown } | undefined
    const prevDate = normalizeText(prev?.d) || null
    if (!prevDate) return { currentDate, prevDate: null, prev2Date: null }

    const prev2 = db
      .prepare(`SELECT MAX(snapshot_date) AS d FROM scout_dashboard_snapshot_rows WHERE snapshot_date < ?`)
      .get(prevDate) as { d?: unknown } | undefined
    const prev2Date = normalizeText(prev2?.d) || null
    return { currentDate, prevDate, prev2Date }
  }

  private getKeywordHeatMap(date: string | null, keyword?: string): Map<string, number> {
    const db = this.sqlite.connection
    if (!date) return new Map<string, number>()
    const normalizedKeyword = normalizeText(keyword)
    const where = normalizedKeyword
      ? `WHERE snapshot_date = ? AND primary_keyword = ?`
      : `WHERE snapshot_date = ?`
    const rows = db
      .prepare(
        `SELECT primary_keyword AS keyword, SUM(add_cart_24h_value) AS heat
         FROM scout_dashboard_snapshot_rows
         ${where}
         GROUP BY primary_keyword`
      )
      .all(...(normalizedKeyword ? [date, normalizedKeyword] : [date])) as Array<Record<string, unknown>>
    const map = new Map<string, number>()
    for (const row of rows) {
      const key = normalizeText(row.keyword)
      if (!key) continue
      map.set(key, toInt(row.heat))
    }
    return map
  }

  private getProductHeatMap(date: string | null): Map<string, number> {
    const db = this.sqlite.connection
    if (!date) return new Map<string, number>()
    const rows = db
      .prepare(
        `SELECT product_key, add_cart_24h_value
         FROM scout_dashboard_snapshot_rows
         WHERE snapshot_date = ?`
      )
      .all(date) as Array<Record<string, unknown>>
    const map = new Map<string, number>()
    for (const row of rows) {
      const key = normalizeText(row.product_key)
      if (!key) continue
      map.set(key, toInt(row.add_cart_24h_value))
    }
    return map
  }

}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function mapProductRow(r: Record<string, unknown>): ScoutProductRecord {
  return {
    id: String(r.id),
    keywordId: String(r.keyword_id),
    productName: String(r.product_name),
    productUrl: String(r.product_url),
    price: typeof r.price === 'number' ? r.price : null,
    addCart24h: r.add_cart_24h ? String(r.add_cart_24h) : null,
    addCart24hValue: Number(r.add_cart_24h_value) || 0,
    totalSales: r.total_sales ? String(r.total_sales) : null,
    threeMonthBuyers: r.three_month_buyers ? String(r.three_month_buyers) : null,
    addCartTag: r.add_cart_tag ? String(r.add_cart_tag) : null,
    positiveReviewTag: r.positive_review_tag ? String(r.positive_review_tag) : null,
    collectionTag: r.collection_tag ? String(r.collection_tag) : null,
    reviewCount: Number(r.review_count) || 0,
    productRating: typeof r.product_rating === 'number' ? r.product_rating : null,
    shopName: r.shop_name ? String(r.shop_name) : null,
    shopUrl: r.shop_url ? String(r.shop_url) : null,
    shopFans: r.shop_fans ? String(r.shop_fans) : null,
    shopSales: r.shop_sales ? String(r.shop_sales) : null,
    shopRating: typeof r.shop_rating === 'number' ? r.shop_rating : null,
    sortMode: r.sort_mode ? String(r.sort_mode) : null,
    rankPosition: typeof r.rank_position === 'number' ? r.rank_position : null,
    firstSeenAt: Number(r.first_seen_at),
    lastUpdatedAt: Number(r.last_updated_at)
  }
}

function mapMarkedProductRow(r: Record<string, unknown>): ScoutMarkedProductRecord {
  const status = normalizeText(r.sourcing_status)
  const safeStatus: 'idle' | 'running' | 'success' | 'failed' =
    status === 'running' || status === 'success' || status === 'failed' ? status : 'idle'

  return {
    id: normalizeText(r.id),
    snapshotDate: normalizeText(r.snapshot_date),
    productKey: normalizeText(r.product_key),
    keyword: normalizeText(r.keyword),
    productName: normalizeText(r.product_name),
    productUrl: normalizeNullable(r.product_url),
    salePrice: parseNumber(r.sale_price),
    sourceImage1: normalizeNullable(r.source_image_1),
    sourceImage2: normalizeNullable(r.source_image_2),
    supplier1Name: normalizeNullable(r.supplier1_name),
    supplier1Url: normalizeNullable(r.supplier1_url),
    supplier1Price: parseNumber(r.supplier1_price),
    supplier2Name: normalizeNullable(r.supplier2_name),
    supplier2Url: normalizeNullable(r.supplier2_url),
    supplier2Price: parseNumber(r.supplier2_price),
    supplier3Name: normalizeNullable(r.supplier3_name),
    supplier3Url: normalizeNullable(r.supplier3_url),
    supplier3Price: parseNumber(r.supplier3_price),
    profit1: parseNumber(r.profit1),
    profit2: parseNumber(r.profit2),
    profit3: parseNumber(r.profit3),
    bestProfitAmount: parseNumber(r.best_profit_amount),
    sourcingStatus: safeStatus,
    sourcingMessage: normalizeNullable(r.sourcing_message),
    sourcingUpdatedAt: toNullableInt(r.sourcing_updated_at),
    createdAt: toInt(r.created_at),
    updatedAt: toInt(r.updated_at)
  }
}

function buildHeaderIndex(values: Array<unknown>): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 1; i < values.length; i += 1) {
    const key = normalizeText(values[i])
    if (!key) continue
    map.set(key, i)
  }
  return map
}

function buildProductKey(productUrl: string | null, productName: string, shopName: string | null): string {
  const normalizedUrl = normalizeText(productUrl)
  if (normalizedUrl) return `url:${normalizedUrl}`

  const name = normalizeText(productName)
  const shop = normalizeText(shopName)
  if (!name && !shop) return ''
  return `name_shop:${name}|${shop}`
}

function getCellString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return formatDateTimeLocal(value.getTime())
  if (typeof value === 'object') {
    const maybe = value as {
      text?: unknown
      result?: unknown
      richText?: Array<{ text?: unknown }>
      hyperlink?: unknown
    }
    if (typeof maybe.hyperlink === 'string' && maybe.hyperlink.trim()) return maybe.hyperlink.trim()
    if (typeof maybe.text === 'string') return maybe.text.trim()
    if (maybe.text && typeof maybe.text === 'object') return getCellString(maybe.text)
    if (typeof maybe.result === 'string') return maybe.result.trim()
    if (Array.isArray(maybe.richText)) {
      return maybe.richText
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .join('')
        .trim()
    }
  }
  return String(value).trim()
}

function getCellLinkOrText(value: unknown): string {
  if (!value || typeof value !== 'object') return getCellString(value)
  const maybe = value as { hyperlink?: unknown; text?: unknown }
  if (typeof maybe.hyperlink === 'string' && maybe.hyperlink.trim()) {
    return maybe.hyperlink.trim()
  }
  if (maybe.text != null) {
    const text = getCellString(maybe.text)
    if (text) return text
  }
  return getCellString(value)
}

function parseDateMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    const ts = value > 10_000_000_000 ? value : excelSerialToMs(value)
    return Number.isFinite(ts) && ts > 0 ? ts : null
  }
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isFinite(ts) && ts > 0 ? ts : null
  }
  const text = getCellString(value)
  if (!text) return null
  const direct = new Date(text).getTime()
  if (Number.isFinite(direct) && direct > 0) return direct
  const normalized = text.replace(/\./g, '-').replace(/\//g, '-')
  const fallback = new Date(normalized).getTime()
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null
}

function excelSerialToMs(serial: number): number {
  const epoch = Date.UTC(1899, 11, 30)
  return Math.round(epoch + serial * 24 * 60 * 60 * 1000)
}

function formatDateYmd(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDateTimeLocal(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`
}

function normalizeText(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function normalizeNullable(value: unknown): string | null {
  const text = normalizeText(value)
  return text ? text : null
}

function safeDecodeURIComponent(value: string): string {
  if (!value) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extract1688OfferId(text: string): string | null {
  const normalized = normalizeText(text)
  if (!normalized) return null
  const matchers = [
    /detail\.1688\.com\/offer\/(\d{6,})/i,
    /\/offer\/(\d{6,})(?:\.html)?/i,
    /(?:\?|&)(?:offerid|offerId|itemId|id)=([0-9]{6,})(?:&|$)/i
  ]
  for (const matcher of matchers) {
    const matched = normalized.match(matcher)
    if (matched && matched[1]) return matched[1]
  }
  return null
}

function normalize1688OfferUrl(value: unknown): string | null {
  const raw = normalizeText(value)
  if (!raw) return null

  const queue = [raw]
  const visited = new Set<string>()
  while (queue.length > 0 && visited.size < 16) {
    const current = normalizeText(queue.shift())
    if (!current || visited.has(current)) continue
    visited.add(current)

    const directId = extract1688OfferId(current)
    if (directId) {
      return `https://detail.1688.com/offer/${directId}.html`
    }

    const decoded = safeDecodeURIComponent(current)
    if (decoded && decoded !== current && !visited.has(decoded)) {
      queue.push(decoded)
    }

    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      continue
    }

    for (const [, paramValue] of parsed.searchParams.entries()) {
      const normalizedParam = normalizeText(paramValue)
      if (!normalizedParam) continue
      if (!visited.has(normalizedParam)) queue.push(normalizedParam)
      const paramDecoded = safeDecodeURIComponent(normalizedParam)
      if (paramDecoded && paramDecoded !== normalizedParam && !visited.has(paramDecoded)) {
        queue.push(paramDecoded)
      }
    }
  }
  return null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = getCellString(value)
  if (!text) return null
  const cleaned = text.replace(/[,\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  const text = normalizeText(value)
  if (!text) return 0
  const cleaned = text.replace(/[,\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

function toNullableInt(value: unknown): number | null {
  if (value == null) return null
  const parsed = toInt(value)
  return parsed > 0 ? parsed : null
}


type Scout1688ParsedRow = {
  supplierName?: unknown
  supplierTitle?: unknown
  companyName?: unknown
  price?: unknown
  freightPrice?: unknown
  moq?: unknown
  repurchaseRate?: unknown
  serviceRate48h?: unknown
  imgUrl?: unknown
  detailUrl?: unknown
}

const XHS_COVER_PARTITION = 'persist:scout-xhs-cover'
const XHS_COVER_PARTITION_RELAXED = 'persist:scout-xhs-cover-relaxed'
const XHS_COVER_STEALTH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const XHS_ANTI_SPIDER_ERROR = 'ANTI_SPIDER_DETECTED'
const XHS_COVER_PARSE_ERROR = 'COVER_IMAGE_NOT_FOUND'

async function uploadImageByDomInjection(
  win: BrowserWindow,
  localImagePath: string,
  opts: { onCaptchaNeeded?: () => void }
): Promise<{ ok: boolean; requiresManualIntervention: boolean; url: string }> {
  const normalizedPath = normalizeText(localImagePath)
  if (!normalizedPath) return { ok: false, requiresManualIntervention: false, url: normalizeText(win.webContents.getURL()) }

  let fileBuffer: Buffer
  try {
    fileBuffer = readFileSync(normalizedPath)
  } catch {
    return { ok: false, requiresManualIntervention: false, url: normalizeText(win.webContents.getURL()) }
  }
  if (!fileBuffer || fileBuffer.length === 0) {
    return { ok: false, requiresManualIntervention: false, url: normalizeText(win.webContents.getURL()) }
  }

  const mime = inferImageMimeType(normalizedPath)
  const ext = basename(normalizedPath).split('.').pop() || 'jpg'
  const dataUrl = `data:${mime};base64,${fileBuffer.toString('base64')}`
  const payload = JSON.stringify(dataUrl)
  const filename = JSON.stringify(`search-image.${ext}`)
  const injected = (await win.webContents.executeJavaScript(
    `(() => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      const OVERLAY_ID = '__cms_scout_sourcing_overlay__'
      const OVERLAY_STAGE_ID = '__cms_scout_sourcing_overlay_stage__'
      const OVERLAY_LEGEND_ID = '__cms_scout_sourcing_overlay_legend__'
      const ensureOverlayRoot = () => {
        let root = document.getElementById(OVERLAY_ID)
        if (root && root instanceof HTMLElement) return root
        root = document.createElement('div')
        root.id = OVERLAY_ID
        root.style.position = 'fixed'
        root.style.left = '0'
        root.style.top = '0'
        root.style.width = '100vw'
        root.style.height = '100vh'
        root.style.pointerEvents = 'none'
        root.style.zIndex = '2147483646'
        document.documentElement.appendChild(root)
        return root
      }
      const ensureBadge = () => {
        let badge = document.getElementById(OVERLAY_STAGE_ID)
        if (badge && badge instanceof HTMLElement) return badge
        badge = document.createElement('div')
        badge.id = OVERLAY_STAGE_ID
        badge.style.position = 'fixed'
        badge.style.left = '12px'
        badge.style.top = '10px'
        badge.style.padding = '6px 10px'
        badge.style.border = '1px solid rgba(248,250,252,0.35)'
        badge.style.background = 'rgba(2,6,23,0.84)'
        badge.style.color = '#e2e8f0'
        badge.style.fontSize = '12px'
        badge.style.fontWeight = '600'
        badge.style.borderRadius = '8px'
        badge.style.letterSpacing = '0.2px'
        badge.style.pointerEvents = 'none'
        badge.style.zIndex = '2147483647'
        document.documentElement.appendChild(badge)
        return badge
      }
      const ensureLegend = () => {
        let legend = document.getElementById(OVERLAY_LEGEND_ID)
        if (legend && legend instanceof HTMLElement) return legend
        legend = document.createElement('div')
        legend.id = OVERLAY_LEGEND_ID
        legend.style.position = 'fixed'
        legend.style.right = '12px'
        legend.style.top = '10px'
        legend.style.padding = '8px 10px'
        legend.style.border = '1px solid rgba(248,250,252,0.3)'
        legend.style.background = 'rgba(2,6,23,0.84)'
        legend.style.color = '#e2e8f0'
        legend.style.fontSize = '11px'
        legend.style.lineHeight = '1.45'
        legend.style.borderRadius = '8px'
        legend.style.pointerEvents = 'none'
        legend.style.zIndex = '2147483647'
        document.documentElement.appendChild(legend)
        return legend
      }
      const renderLegend = () => {
        const legend = ensureLegend()
        legend.innerHTML =
          '<div><span style="color:#ef4444;">■</span> 入口候选</div>' +
          '<div><span style="color:#f59e0b;">■</span> 上传输入框</div>' +
          '<div><span style="color:#06b6d4;">■</span> 搜索按钮候选</div>' +
          '<div><span style="color:#22c55e;">■</span> 实际点击</div>'
      }
      const clearOverlay = (stage) => {
        const root = ensureOverlayRoot()
        root.innerHTML = ''
        const badge = ensureBadge()
        badge.textContent = stage || '1688 自动化可视化'
        renderLegend()
      }
      const pickRect = (node) => {
        if (!(node instanceof HTMLElement)) return null
        const rect = node.getBoundingClientRect()
        if (!rect) return null
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null
        if (rect.width < 4 || rect.height < 4) return null
        return rect
      }
      const drawBox = (node, options) => {
        const rect = pickRect(node)
        if (!rect) return false
        const root = ensureOverlayRoot()
        const box = document.createElement('div')
        box.style.position = 'fixed'
        box.style.left = rect.left + 'px'
        box.style.top = rect.top + 'px'
        box.style.width = rect.width + 'px'
        box.style.height = rect.height + 'px'
        box.style.border = '2px ' + (options?.style === 'dashed' ? 'dashed ' : 'solid ') + (options?.color || '#ef4444')
        box.style.borderRadius = '6px'
        box.style.boxSizing = 'border-box'
        box.style.background = (options?.fill || 'transparent')
        box.style.pointerEvents = 'none'
        root.appendChild(box)
        if (options?.label) {
          const tag = document.createElement('div')
          tag.textContent = String(options.label)
          tag.style.position = 'fixed'
          tag.style.left = Math.max(0, rect.left) + 'px'
          tag.style.top = Math.max(0, rect.top - 18) + 'px'
          tag.style.padding = '1px 5px'
          tag.style.borderRadius = '4px'
          tag.style.background = options?.color || '#ef4444'
          tag.style.color = '#020617'
          tag.style.fontWeight = '700'
          tag.style.fontSize = '10px'
          tag.style.pointerEvents = 'none'
          root.appendChild(tag)
        }
        return true
      }
      const clickImageSearchEntrances = () => {
        clearOverlay('步骤1/3：定位图搜入口')
        const selectors = [
          '.search-bar [class*="image"]',
          '.search-bar [class*="camera"]',
          '.search-by-image',
          '.search-by-photo',
          '[class*="by-image"]',
          '[class*="image-search"]',
          '[class*="camera-search"]'
        ]
        const isLikelyNativeFileDialogTrigger = (node) => {
          if (!(node instanceof HTMLElement)) return false
          const text = String(node.innerText || '').replace(/\\s+/g, '').toLowerCase()
          const cls = String(node.className || '').toLowerCase()
          const id = String(node.id || '').toLowerCase()
          const aria = String(node.getAttribute('aria-label') || '').toLowerCase()
          const title = String(node.getAttribute('title') || '').toLowerCase()
          const full = [text, cls, id, aria, title].join(' ')
          if (/上传|本地图片|选择图片|添加图片|选择文件|upload|filepicker|file-picker/.test(full)) return true
          if (node.matches && node.matches('[for]')) {
            const targetId = String(node.getAttribute('for') || '')
            if (targetId) {
              const input = document.getElementById(targetId)
              if (input instanceof HTMLInputElement && input.type === 'file') return true
            }
          }
          if (node.querySelector && node.querySelector('input[type="file"]')) return true
          return false
        }
        const clicked = []
        let drawnCount = 0
        for (const selector of selectors) {
          const nodes = Array.from(document.querySelectorAll(selector))
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue
            if (isLikelyNativeFileDialogTrigger(node)) continue
            if (drawnCount < 8) {
              if (drawBox(node, { color: '#ef4444', label: '入口候选', style: 'dashed' })) drawnCount += 1
            }
            try {
              node.click()
              clicked.push(selector)
              drawBox(node, { color: '#22c55e', label: '已点击入口' })
              break
            } catch {
              // ignore click error
            }
          }
        }
        const textNodes = Array.from(document.querySelectorAll('button,a,span,div'))
        for (const node of textNodes) {
          if (!(node instanceof HTMLElement)) continue
          const text = String(node.innerText || '').trim()
          if (!text) continue
          if (!/(搜同款|以图搜|找同款|图搜)/i.test(text)) continue
          if (isLikelyNativeFileDialogTrigger(node)) continue
          if (drawnCount < 10) {
            if (drawBox(node, { color: '#ef4444', label: '文案入口', style: 'dashed' })) drawnCount += 1
          }
          try {
            node.click()
            clicked.push('text:' + text)
            drawBox(node, { color: '#22c55e', label: '已点击文案入口' })
            break
          } catch {
            // ignore click error
          }
        }
        return clicked
      }
      const clickSearchSubmitButton = (scopeRoot, inputNode) => {
        const isVisible = (node) => {
          if (!(node instanceof HTMLElement)) return false
          const style = window.getComputedStyle(node)
          if (!style) return true
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
            return false
          }
          return true
        }
        const isLikelySubmitText = (value) => {
          const text = String(value || '').replace(/\\s+/g, '')
          if (!text) return false
          if (text.length > 16) return false
          const deny = ['以图搜款', '以图搜', '拍立淘', '上传图片', '搜图']
          if (deny.some((item) => text === item || text.includes(item))) return false
          const allow = ['搜索图片', '开始搜索', '搜索同款', '立即搜索', '确认搜索', '找同款', '搜同款']
          return allow.some((item) => text === item || text.includes(item))
        }
        const isLikelyClickableControl = (node) => {
          if (!(node instanceof HTMLElement)) return false
          const tag = String(node.tagName || '').toLowerCase()
          if (tag === 'button' || tag === 'a') return true
          const role = String(node.getAttribute('role') || '').toLowerCase()
          if (role === 'button') return true
          if (typeof node.onclick === 'function') return true
          const className = String(node.className || '').toLowerCase()
          return /btn|button|submit|search/.test(className)
        }
        const isReasonableSize = (node) => {
          if (!(node instanceof HTMLElement)) return false
          const rect = node.getBoundingClientRect()
          if (!rect) return false
          if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false
          if (rect.width < 36 || rect.width > 320) return false
          if (rect.height < 20 || rect.height > 120) return false
          return true
        }
        const clickNode = (node) => {
          if (!(node instanceof HTMLElement)) return { text: '', point: null }
          try {
            node.click()
          } catch {
            // ignore
          }
          drawBox(node, { color: '#22c55e', label: '已点击搜索按钮' })
          const rect = node.getBoundingClientRect()
          const point =
            rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)
              ? {
                  x: Math.round(rect.left + rect.width / 2),
                  y: Math.round(rect.top + rect.height / 2)
                }
              : null
          const text = String(node.innerText || '').replace(/\\s+/g, '')
          return { text, point }
        }
        const tryClick = (root) => {
          if (!root || !root.querySelectorAll) return ''
          const directSelectors = [
            'button',
            'a',
            '[role="button"]',
            '.search-btn',
            '.img-search-btn',
            '[class*="img-search"] [class*="btn"]',
            '[class*="same"] [class*="btn"]',
            '[class*="search"] [class*="btn"]',
            '[class*="submit"]'
          ]
          const directNodes = Array.from(root.querySelectorAll(directSelectors.join(',')))
          const nodes = directNodes.length > 0 ? directNodes : Array.from(root.querySelectorAll('button,a,[role="button"],div,span'))
          let candidateDrawn = 0
          for (const rawNode of nodes) {
            if (!(rawNode instanceof HTMLElement)) continue
            if (!isVisible(rawNode)) continue
            const text = String(rawNode.innerText || '').replace(/\\s+/g, '')
            if (!text) continue
            if (!isLikelyClickableControl(rawNode)) continue
            if (!isReasonableSize(rawNode)) continue
            if (!isLikelySubmitText(text)) continue
            if (candidateDrawn >= 8) break
            if (drawBox(rawNode, { color: '#06b6d4', label: '搜索候选', style: 'dashed' })) {
              candidateDrawn += 1
            }
          }
          for (const node of nodes) {
            if (!(node instanceof HTMLElement)) continue
            if (!isVisible(node)) continue
            const text = String(node.innerText || '').replace(/\\s+/g, '')
            if (!text) continue
            if (!isLikelySubmitText(text)) continue
            if (!isLikelyClickableControl(node)) continue
            if (!isReasonableSize(node)) continue
            const clicked = clickNode(node)
            return JSON.stringify(clicked)
          }
          return ''
        }
        const scoped = tryClick(scopeRoot)
        if (scoped) return scoped
        return tryClick(document)
      }
      const findFileInputInRoot = (root) => {
        if (!root || !root.querySelectorAll) return null
        const nodes = Array.from(root.querySelectorAll('input[type="file"]'))
        for (const node of nodes) {
          if (node instanceof HTMLInputElement && !node.disabled) {
            return node
          }
        }
        return null
      }
      const pickInput = () => {
        const direct = findFileInputInRoot(document)
        if (direct) return direct
        const tree = Array.from(document.querySelectorAll('*'))
        for (const node of tree) {
          const host = node
          if (!(host instanceof HTMLElement)) continue
          const shadow = host.shadowRoot
          if (!shadow) continue
          const fromShadow = findFileInputInRoot(shadow)
          if (fromShadow) return fromShadow
        }
        const selectors = [
          '.search-upload-input input[type="file"]',
          '.search-upload input[type="file"]',
          '.search-bar input[type="file"]',
          '[class*="upload"] input[type="file"]',
          'input[type="file"]'
        ]
        for (const selector of selectors) {
          const node = document.querySelector(selector)
          if (node && node instanceof HTMLInputElement) return node
        }
        return null
      }
      return (async () => {
        const start = Date.now()
        let lastEntranceClicks = []
        let input = pickInput()
        while (!input && Date.now() - start < 12000) {
          lastEntranceClicks = clickImageSearchEntrances()
          await sleep(350)
          input = pickInput()
        }
        if (!input) {
          clearOverlay('步骤2/3：未找到上传输入框')
          return {
            ok: false,
            reason: 'file_input_not_found',
            debug: {
              fileInputCount: document.querySelectorAll('input[type="file"]').length,
              clicked: lastEntranceClicks
            }
          }
        }
        console.log('Found file input:', input)
        clearOverlay('步骤2/3：定位上传输入框')
        drawBox(input, { color: '#f59e0b', label: '上传输入框' })
        try {
          const response = await fetch(${payload})
          const blob = await response.blob()
          const file = new File([blob], ${filename}, { type: blob.type || 'image/jpeg' })
          const transfer = new DataTransfer()
          transfer.items.add(file)
          input.files = transfer.files
          input.dispatchEvent(new Event('change', { bubbles: true }))
          input.dispatchEvent(new Event('input', { bubbles: true }))
          clearOverlay('步骤3/3：上传完成，定位搜索按钮')
          drawBox(input, { color: '#f59e0b', label: '上传输入框' })
          const scope = input.closest('[id*="img-search"], [class*="img-search"], [class*="same"], [class*="reader"]')
          const submitPayload = clickSearchSubmitButton(scope, input)
          let submitData = null
          try {
            submitData = submitPayload ? JSON.parse(submitPayload) : null
          } catch {
            submitData = null
          }
          return {
            ok: true,
            reason: submitData?.text ? 'ok_clicked_submit' : 'ok_no_submit',
            debug: {
              submitText: submitData?.text || '',
              submitPoint: submitData?.point || null,
              submitVia: submitData?.via || '',
              inputId: input.id || '',
              inputClass: input.className || ''
            }
          }
        } catch (error) {
          return {
            ok: false,
            reason: 'inject_failed',
            debug: { message: String((error && error.message) || error || '') }
          }
        }
      })()
    })()`,
    true
  )) as { ok?: unknown; reason?: unknown; debug?: unknown } | null

  if (injected?.ok !== true) {
    console.warn('[ScoutSourcing] upload injection failed', {
      reason: normalizeText(injected?.reason),
      debug: injected?.debug ?? null
    })
    return { ok: false, requiresManualIntervention: false, url: normalizeText(win.webContents.getURL()) }
  }
  console.info('[ScoutSourcing] upload injection success', {
    reason: normalizeText(injected?.reason),
    debug: injected?.debug ?? null
  })
  const nav = await waitForImageSearchNavigationAfterUpload(win, 18_000, { onCaptchaNeeded: opts.onCaptchaNeeded })
  return {
    ok: true,
    requiresManualIntervention: nav.requiresManualIntervention,
    url: nav.url
  }
}

async function waitForImageSearchAndParse(
  win: BrowserWindow,
  opts: { targetPrice: number; onCaptchaNeeded?: () => void }
): Promise<Scout1688SupplierResult[]> {
  await waitFor1688SearchResultPage(win, {
    onCaptchaNeeded: opts.onCaptchaNeeded,
    captchaTimeoutMs: 120_000,
    nonCaptchaTimeoutMs: 40_000
  })
  let parsedRows: Scout1688ParsedRow[] = []
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    parsedRows = await parse1688RowsFromCurrentPage(win)
    if (parsedRows.length > 0) {
      const first = parsedRows[0]
      console.info('[ScoutSourcing] parsed suppliers', {
        attempt,
        count: parsedRows.length,
        first: first
          ? {
              supplierName: normalizeText(first.supplierName),
              companyName: normalizeText(first.companyName),
              price: parseNumber(first.price),
              detailUrl: normalizeText(first.detailUrl)
            }
          : null
      })
      return normalize1688SupplierResults(parsedRows, opts.targetPrice, 5)
    }
    const currentUrl = normalizeText(win.webContents.getURL())
    console.warn('[ScoutSourcing] parsed suppliers empty, retrying', { attempt, url: currentUrl })
    if (attempt < 4) {
      await win.webContents
        .executeJavaScript(
          `(() => {
            try {
              window.scrollBy(0, 220)
              window.scrollBy(0, -60)
            } catch {
              // ignore
            }
            return true
          })()`,
          true
        )
        .catch(() => false)
      await sleep(900)
    }
  }
  return normalize1688SupplierResults(parsedRows, opts.targetPrice, 5)
}

async function search1688ByKeywordInWindow(
  win: BrowserWindow,
  opts: { keyword: string; targetPrice: number; onCaptchaNeeded?: () => void }
): Promise<Scout1688SupplierResult[]> {
  const keyword = normalizeText(opts.keyword)
  if (!keyword) return []
  const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`
  await win.loadURL(url)
  await waitFor1688SearchResultPage(win, {
    onCaptchaNeeded: opts.onCaptchaNeeded,
    captchaTimeoutMs: 120_000,
    nonCaptchaTimeoutMs: 40_000
  })
  const parsedRows = await parse1688RowsFromCurrentPage(win)
  return normalize1688SupplierResults(parsedRows, opts.targetPrice, 5)
}

async function waitFor1688SearchResultPage(
  win: BrowserWindow,
  opts: { onCaptchaNeeded?: () => void; captchaTimeoutMs: number; nonCaptchaTimeoutMs: number }
): Promise<void> {
  const startedAt = Date.now()
  let captchaStartedAt: number | null = null
  let captchaNotified = false

  while (true) {
    if (win.isDestroyed()) {
      throw new Scout1688SearchError('PARSE_ERROR', '自动搜索失败，请尝试手动介入')
    }

    const currentUrl = normalizeText(win.webContents.getURL())
    const lower = currentUrl.toLowerCase()
    const hasResultDom = await has1688ResultListDom(win)
    if (is1688SearchResultUrl(lower) || hasResultDom) {
      try {
        await waitFor1688ResultListDom(win, 9000)
      } catch {
        // keep parsing fallback
      }
      console.info('[ScoutSourcing] result page ready', {
        url: currentUrl,
        hasResultDom
      })
      if (captchaStartedAt != null && !win.isDestroyed()) {
        win.hide()
      }
      return
    }

    if (captchaStartedAt != null && Date.now() - captchaStartedAt > opts.captchaTimeoutMs) {
      throw new Scout1688SearchError('TIMEOUT', '自动搜索失败，请尝试手动介入')
    }

    const hasCaptcha = is1688CaptchaUrl(lower) || (await hasCaptchaDom(win))
    if (hasCaptcha) {
      if (captchaStartedAt == null) {
        captchaStartedAt = Date.now()
        if (!captchaNotified) {
          captchaNotified = true
          opts.onCaptchaNeeded?.()
        }
        if (!win.isDestroyed()) {
          win.show()
          win.focus()
        }
      }
    } else if (captchaStartedAt == null && Date.now() - startedAt > opts.nonCaptchaTimeoutMs) {
      throw new Scout1688SearchError('UPLOAD_FAIL', '自动搜索失败，请尝试手动介入')
    }

    await sleep(480)
  }
}

async function has1688ResultListDom(win: BrowserWindow): Promise<boolean> {
  const signals = await evaluate1688ImageSearchResultSignals(win)
  return signals.ready
}

async function waitFor1688ResultListDom(win: BrowserWindow, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const signals = await evaluate1688ImageSearchResultSignals(win)
    if (signals.ready) return
    await sleep(260)
  }
}

async function evaluate1688ImageSearchResultSignals(win: BrowserWindow): Promise<{
  ready: boolean
  strictOfferCount: number
  metricCount: number
  priceCount: number
  hasResultKeyword: boolean
  hasSortTabs: boolean
  hasUploadPanel: boolean
}> {
  const payload = (await win.webContents.executeJavaScript(
    `(() => {
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false
        const style = window.getComputedStyle(node)
        if (!style) return true
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false
        const rect = node.getBoundingClientRect()
        if (!rect || rect.width < 10 || rect.height < 10) return false
        if (!(rect.bottom > 0 && rect.top < window.innerHeight * 2.2)) return false
        return true
      }
      const abs = (value) => {
        if (!value || typeof value !== 'string') return ''
        try { return new URL(value, location.href).toString() } catch { return '' }
      }
      const clean = (text) => String(text || '').replace(/\\s+/g, '')
      const extractOfferId = (raw) => {
        const value = String(raw || '')
        if (!value) return ''
        const direct = value.match(/detail\\.1688\\.com\\/offer\\/(\\d{6,})/i)
        if (direct && direct[1]) return direct[1]
        const relative = value.match(/\\/offer\\/(\\d{6,})(?:\\.html)?/i)
        if (relative && relative[1]) return relative[1]
        const fromQuery = value.match(/(?:offerid|offerId|itemId|offer_id|offer-id)[=:"']([0-9]{6,})/i)
        if (fromQuery && fromQuery[1]) return fromQuery[1]
        return ''
      }
      const offerIds = new Set()
      const anchors = Array.from(document.querySelectorAll('a[href]'))
      for (const node of anchors) {
        if (!(node instanceof HTMLAnchorElement)) continue
        if (!isVisible(node)) continue
        const href = abs(node.getAttribute('href') || '')
        const id = extractOfferId(href)
        if (!id) continue
        offerIds.add(id)
      }
      const attrNodes = Array.from(
        document.querySelectorAll(
          '[data-offerid],[data-offer-id],[data-detail-url],[data-href],[data-url],[data-link],[data-jump-url],[data-target-url],[onclick]'
        )
      ).slice(0, 1200)
      for (const node of attrNodes) {
        if (!(node instanceof Element)) continue
        const attrs = ['data-offerid', 'data-offer-id', 'data-detail-url', 'data-href', 'data-url', 'data-link', 'data-jump-url', 'data-target-url', 'onclick']
        for (const key of attrs) {
          const raw = String(node.getAttribute(key) || '')
          if (!raw) continue
          const id = extractOfferId(raw)
          if (id) offerIds.add(id)
        }
      }
      const strictOfferCount = offerIds.size
      const text = String((document.body && document.body.innerText) || '')
      const compactText = clean(text)
      const hasResultKeyword = /(为您找到以下货源|为你找到以下货源|搜索结果|同款货源|按图|相似商品)/i.test(text)
      const hasSortTabs = /(综合销量价格)/i.test(compactText)
      const hasUploadPanel = /上传图片[（(]\\d+\\s*\\/\\s*\\d+[)）]/i.test(text) || /上传图片\\s*\\(\\d+\\s*\\/\\s*\\d+\\)/i.test(text)

      const metricNodes = Array.from(document.querySelectorAll('span,div,p'))
      let metricCount = 0
      for (const node of metricNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (!isVisible(node)) continue
        const t = clean(node.innerText || node.textContent || '')
        if (!t) continue
        if (/48[hH]揽收\\d+(?:\\.\\d+)?%|24[hH]揽收\\d+(?:\\.\\d+)?%/.test(t)) {
          metricCount += 1
          if (metricCount >= 8) break
        }
      }

      const priceNodes = Array.from(document.querySelectorAll('span,div,p,strong,em'))
      let priceCount = 0
      for (const node of priceNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (!isVisible(node)) continue
        const t = clean(node.innerText || node.textContent || '')
        if (!t) continue
        if (/^(?:¥|￥)\\d+(?:\\.\\d+)?/.test(t) || /(?:¥|￥)\\d+(?:\\.\\d+)?运费\\d+(?:\\.\\d+)?元起/.test(t)) {
          priceCount += 1
          if (priceCount >= 12) break
        }
      }

      const readyByOffer = strictOfferCount >= 2
      const readyByLayout = hasUploadPanel && hasSortTabs && priceCount >= 5
      const readyByKeyword = hasResultKeyword && priceCount >= 5 && (metricCount >= 1 || hasSortTabs)
      const ready = readyByOffer || readyByLayout || readyByKeyword
      return { ready, strictOfferCount, metricCount, priceCount, hasResultKeyword, hasSortTabs, hasUploadPanel }
    })()`,
    true
  ).catch(() => null)) as
    | {
        ready?: unknown
        strictOfferCount?: unknown
        metricCount?: unknown
        priceCount?: unknown
        hasResultKeyword?: unknown
        hasSortTabs?: unknown
        hasUploadPanel?: unknown
      }
    | null

  return {
    ready: payload?.ready === true,
    strictOfferCount: typeof payload?.strictOfferCount === 'number' ? payload.strictOfferCount : 0,
    metricCount: typeof payload?.metricCount === 'number' ? payload.metricCount : 0,
    priceCount: typeof payload?.priceCount === 'number' ? payload.priceCount : 0,
    hasResultKeyword: payload?.hasResultKeyword === true,
    hasSortTabs: payload?.hasSortTabs === true,
    hasUploadPanel: payload?.hasUploadPanel === true
  }
}

async function hasCaptchaDom(win: BrowserWindow): Promise<boolean> {
  const detected = (await win.webContents.executeJavaScript(
    `(() => {
      const text = String((document.body && document.body.innerText) || '')
      if (/(滑块|验证码|安全验证|请完成验证|拖动滑块|请拖动)/i.test(text)) return true
      if (document.querySelector('[id*="nc_"], [class*="nc_"], [class*="captcha"], [class*="verify"]')) return true
      return false
    })()`,
    true
  ).catch(() => false)) as boolean
  return detected === true
}

async function ensure1688LoginReady(
  win: BrowserWindow,
  opts: { onLoginNeeded?: () => void }
): Promise<void> {
  const alreadyLoggedIn = await detect1688Login(win)
  if (alreadyLoggedIn) return

  if (!win.isDestroyed()) {
    win.show()
    win.focus()
  }
  opts.onLoginNeeded?.()

  while (true) {
    if (win.isDestroyed()) {
      throw new Scout1688SearchError('PARSE_ERROR', '自动搜索失败，请尝试手动介入')
    }
    const loggedIn = await detect1688Login(win)
    if (loggedIn) {
      if (!win.isDestroyed()) win.hide()
      return
    }
    await sleep(700)
  }
}

async function detect1688Login(win: BrowserWindow): Promise<boolean> {
  const detected = (await win.webContents.executeJavaScript(
    `(() => {
      const isVisible = (node) => {
        if (!(node instanceof Element)) return false
        const style = window.getComputedStyle(node)
        if (!style) return true
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
          return false
        }
        return true
      }
      const hasAnyVisible = (selectors) => {
        for (const selector of selectors) {
          const node = document.querySelector(selector)
          if (isVisible(node)) return true
        }
        return false
      }
      const hasProfile = Boolean(
        hasAnyVisible([
          '.personal-info',
          '.member-avatar',
          '[class*="user-info"]',
          '[class*="member-info"]',
          'a[href*="member.1688.com/member"]',
          '[class*="avatar"]'
        ])
      )
      const hasLoginEntry = Boolean(
        hasAnyVisible([
          '.login-entry',
          '.quick-login',
          '.quick-login-wrap',
          '.header-login-entry',
          'a[href*="login.1688.com"]'
        ])
      )
      return hasProfile || !hasLoginEntry
    })()`,
    true
  ).catch(() => false)) as boolean
  return detected === true
}

async function waitForImageSearchNavigationAfterUpload(
  win: BrowserWindow,
  timeoutMs: number,
  opts: { onCaptchaNeeded?: () => void }
): Promise<{ url: string; requiresManualIntervention: boolean }> {
  const startedAt = Date.now()
  const startUrl = normalizeText(win.webContents.getURL()).toLowerCase()
  let lastNudgeAt = 0
  let lastSignals = {
    ready: false,
    strictOfferCount: 0,
    metricCount: 0,
    priceCount: 0,
    hasResultKeyword: false,
    hasSortTabs: false,
    hasUploadPanel: false
  }
  while (Date.now() - startedAt <= timeoutMs) {
    if (win.isDestroyed()) {
      throw new Error('UPLOAD_FAILED')
    }
    const currentUrl = normalizeText(win.webContents.getURL()).toLowerCase()
    if (is1688ManualInterventionUrl(currentUrl)) {
      opts.onCaptchaNeeded?.()
      return { url: currentUrl, requiresManualIntervention: true }
    }
    lastSignals = await evaluate1688ImageSearchResultSignals(win)
    if (lastSignals.ready) {
      console.log('[ScoutSourcing] Upload resolved by strict result DOM')
      return { url: currentUrl, requiresManualIntervention: false }
    }
    if (has1688PostUploadNavigation(startUrl, currentUrl)) {
      console.log('[ScoutSourcing] Upload redirected to URL:', currentUrl)
      return { url: currentUrl, requiresManualIntervention: false }
    }
    const now = Date.now()
    if (now - lastNudgeAt >= 1200) {
      lastNudgeAt = now
      await nudge1688ImageSearchSubmit(win).catch(() => void 0)
    }
    await sleep(280)
  }
  console.warn('[ScoutSourcing] upload navigation timeout', {
    url: normalizeText(win.webContents.getURL()),
    signals: lastSignals
  })
  if (lastSignals.priceCount >= 5 && (lastSignals.hasUploadPanel || lastSignals.hasSortTabs)) {
    const currentUrl = normalizeText(win.webContents.getURL()).toLowerCase()
    console.warn('[ScoutSourcing] force continue after timeout by layout signal', {
      url: currentUrl,
      signals: lastSignals
    })
    return { url: currentUrl, requiresManualIntervention: false }
  }
  throw new Error('UPLOAD_FAILED')
}

async function nudge1688ImageSearchSubmit(win: BrowserWindow): Promise<void> {
  const point = (await win.webContents.executeJavaScript(
    `(() => {
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false
        const style = window.getComputedStyle(node)
        if (!style) return true
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
          return false
        }
        return true
      }
      const isLikelySubmitText = (value) => {
        const text = String(value || '').replace(/\\s+/g, '')
        if (!text) return false
        if (text.length > 16) return false
        const deny = ['以图搜款', '以图搜', '拍立淘', '上传图片', '搜图']
        if (deny.some((item) => text === item || text.includes(item))) return false
        const allow = ['搜索图片', '开始搜索', '搜索同款', '立即搜索', '确认搜索', '找同款', '搜同款']
        return allow.some((item) => text === item || text.includes(item))
      }
      const isLikelyClickableControl = (node) => {
        if (!(node instanceof HTMLElement)) return false
        const tag = String(node.tagName || '').toLowerCase()
        if (tag === 'button' || tag === 'a') return true
        const role = String(node.getAttribute('role') || '').toLowerCase()
        if (role === 'button') return true
        if (typeof node.onclick === 'function') return true
        const className = String(node.className || '').toLowerCase()
        return /btn|button|submit|search/.test(className)
      }
      const isReasonableSize = (node) => {
        if (!(node instanceof HTMLElement)) return false
        const rect = node.getBoundingClientRect()
        if (!rect) return false
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false
        if (rect.width < 36 || rect.width > 320) return false
        if (rect.height < 20 || rect.height > 120) return false
        return true
      }
      const nodes = Array.from(
        document.querySelectorAll(
          'button,a,[role="button"],.search-btn,.img-search-btn,[class*="img-search"] [class*="btn"],[class*="same"] [class*="btn"],[class*="search"] [class*="btn"]'
        )
      )
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue
        if (!isVisible(node)) continue
        const text = String(node.innerText || '').replace(/\\s+/g, '')
        if (!text) continue
        if (!isLikelySubmitText(text)) continue
        if (!isLikelyClickableControl(node)) continue
        if (!isReasonableSize(node)) continue
        try {
          node.click()
          const rect = node.getBoundingClientRect()
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            text
          }
        } catch {
          // ignore
        }
      }
      return null
    })()`,
    true
  ).catch(() => null)) as { x?: unknown; y?: unknown; text?: unknown } | null
  const x = typeof point?.x === 'number' ? point.x : NaN
  const y = typeof point?.y === 'number' ? point.y : NaN
  if (Number.isFinite(x) && Number.isFinite(y)) {
    await triggerUserGestureClick(win, x, y)
  }
}

function setupSourcingWindowOpenBridge(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.setWindowOpenHandler((details) => {
    const targetUrl = normalizeText(details?.url)
    if (!targetUrl) {
      return { action: 'deny' }
    }
    if (is1688InternalUrl(targetUrl)) {
      setTimeout(() => {
        if (win.isDestroyed()) return
        void win.loadURL(targetUrl).catch(() => void 0)
      }, 0)
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })
}

function is1688InternalUrl(url: string): boolean {
  const normalized = normalizeText(url).toLowerCase()
  if (!normalized) return false
  return /https?:\/\/(?:[^/]+\.)?(?:1688|alibaba|taobao)\.com\//i.test(normalized)
}

function shouldEnableSourcingVisualMode(): boolean {
  const raw = normalizeText(process.env.CMS_SCOUT_SOURCING_VISUAL).toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function shouldOpenSourcingDevTools(): boolean {
  const raw = normalizeText(process.env.CMS_SCOUT_OPEN_DEVTOOLS).toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function maybeOpenSourcingDevTools(win: BrowserWindow): void {
  if (!shouldOpenSourcingDevTools()) return
  if (win.isDestroyed()) return
  if (!win.webContents.isDevToolsOpened()) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

function shouldKeepSourcingWindowOpenAfterRun(): boolean {
  const raw = normalizeText(process.env.CMS_SCOUT_KEEP_WINDOW_OPEN).toLowerCase()
  if (!raw) return false
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function shouldEnableCoverVisualMode(): boolean {
  const raw = normalizeText(process.env.CMS_SCOUT_COVER_VISUAL).toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function shouldOpenCoverDevTools(): boolean {
  const raw = normalizeText(process.env.CMS_SCOUT_COVER_OPEN_DEVTOOLS).toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function shouldKeepCoverWindowOpenAfterRun(): boolean {
  const raw = normalizeText(process.env.CMS_SCOUT_COVER_KEEP_OPEN).toLowerCase()
  if (!raw) return false
  return raw === '1' || raw === 'true' || raw === 'yes'
}

function maybeOpenCoverDevTools(win: BrowserWindow): void {
  if (!shouldOpenCoverDevTools()) return
  if (win.isDestroyed()) return
  if (!win.webContents.isDevToolsOpened()) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

async function triggerUserGestureClick(win: BrowserWindow, x: number, y: number): Promise<void> {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  await sleep(30)
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
}

function has1688PostUploadNavigation(startUrl: string, currentUrl: string): boolean {
  if (!currentUrl) return false
  if (currentUrl === startUrl) return false
  if (is1688HomeUrl(currentUrl)) return false
  return true
}

function is1688HomeUrl(url: string): boolean {
  if (!url) return false
  return /^https?:\/\/(?:www\.)?1688\.com\/?(?:[#?].*)?$/i.test(url)
}

function is1688ManualInterventionUrl(url: string): boolean {
  if (!url) return false
  return /aq\.taobao\.com|sec\.1688\.com|login\.1688\.com/i.test(url)
}

function is1688SearchResultUrl(url: string): boolean {
  if (!url) return false
  if (!/https?:\/\/s\.1688\.com\//i.test(url)) return false
  return /(youyuan|youxuan|selloffer|offer_search|imagesearch)/i.test(url) || /s\.1688\.com\//i.test(url)
}

function is1688CaptchaUrl(url: string): boolean {
  if (!url) return false
  if (/aq\.taobao\.com/i.test(url)) return true
  if (/nocaptcha|captcha|verify/i.test(url)) return true
  return /(?:\?|&|\/)check(?:=|\/|&|$)/i.test(url)
}

async function parse1688RowsFromCurrentPage(win: BrowserWindow): Promise<Scout1688ParsedRow[]> {
  const raw = await win.webContents.executeJavaScript(
    `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
      const OVERLAY_ID = '__cms_scout_sourcing_overlay__'
      const OVERLAY_STAGE_ID = '__cms_scout_sourcing_overlay_stage__'
      const OVERLAY_LEGEND_ID = '__cms_scout_sourcing_overlay_legend__'
      const ensureOverlayRoot = () => {
        let root = document.getElementById(OVERLAY_ID)
        if (root && root instanceof HTMLElement) return root
        root = document.createElement('div')
        root.id = OVERLAY_ID
        root.style.position = 'fixed'
        root.style.left = '0'
        root.style.top = '0'
        root.style.width = '100vw'
        root.style.height = '100vh'
        root.style.pointerEvents = 'none'
        root.style.zIndex = '2147483646'
        document.documentElement.appendChild(root)
        return root
      }
      const ensureBadge = () => {
        let badge = document.getElementById(OVERLAY_STAGE_ID)
        if (badge && badge instanceof HTMLElement) return badge
        badge = document.createElement('div')
        badge.id = OVERLAY_STAGE_ID
        badge.style.position = 'fixed'
        badge.style.left = '12px'
        badge.style.top = '10px'
        badge.style.padding = '6px 10px'
        badge.style.border = '1px solid rgba(248,250,252,0.35)'
        badge.style.background = 'rgba(2,6,23,0.84)'
        badge.style.color = '#e2e8f0'
        badge.style.fontSize = '12px'
        badge.style.fontWeight = '600'
        badge.style.borderRadius = '8px'
        badge.style.letterSpacing = '0.2px'
        badge.style.pointerEvents = 'none'
        badge.style.zIndex = '2147483647'
        document.documentElement.appendChild(badge)
        return badge
      }
      const ensureLegend = () => {
        let legend = document.getElementById(OVERLAY_LEGEND_ID)
        if (legend && legend instanceof HTMLElement) return legend
        legend = document.createElement('div')
        legend.id = OVERLAY_LEGEND_ID
        legend.style.position = 'fixed'
        legend.style.right = '12px'
        legend.style.top = '10px'
        legend.style.padding = '8px 10px'
        legend.style.border = '1px solid rgba(248,250,252,0.3)'
        legend.style.background = 'rgba(2,6,23,0.84)'
        legend.style.color = '#e2e8f0'
        legend.style.fontSize = '11px'
        legend.style.lineHeight = '1.45'
        legend.style.borderRadius = '8px'
        legend.style.pointerEvents = 'none'
        legend.style.zIndex = '2147483647'
        document.documentElement.appendChild(legend)
        return legend
      }
      const renderLegend = () => {
        const legend = ensureLegend()
        legend.innerHTML =
          '<div><span style="color:#3b82f6;">■</span> supplier[i] 候选卡</div>' +
          '<div><span style="color:#a855f7;">■</span> 店铺名(companyName)</div>' +
          '<div><span style="color:#22c55e;">■</span> price → purchasePrice</div>' +
          '<div><span style="color:#f59e0b;">■</span> moq</div>' +
          '<div><span style="color:#06b6d4;">■</span> serviceRate48h/repurchaseRate</div>' +
          '<div><span style="color:#eab308;">■</span> detailUrl</div>'
      }
      const clearOverlay = (stage) => {
        const root = ensureOverlayRoot()
        root.innerHTML = ''
        const badge = ensureBadge()
        badge.textContent = stage || '1688 自动化可视化'
        renderLegend()
      }
      const drawBox = (node, options) => {
        if (!(node instanceof HTMLElement)) return false
        const rect = node.getBoundingClientRect()
        if (!rect) return false
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return false
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return false
        if (rect.width < 4 || rect.height < 4) return false
        const root = ensureOverlayRoot()
        const box = document.createElement('div')
        box.style.position = 'fixed'
        box.style.left = rect.left + 'px'
        box.style.top = rect.top + 'px'
        box.style.width = rect.width + 'px'
        box.style.height = rect.height + 'px'
        box.style.border = '2px ' + (options?.style === 'dashed' ? 'dashed ' : 'solid ') + (options?.color || '#3b82f6')
        box.style.borderRadius = '6px'
        box.style.boxSizing = 'border-box'
        box.style.background = options?.fill || 'transparent'
        box.style.pointerEvents = 'none'
        root.appendChild(box)
        if (options?.label) {
          const tag = document.createElement('div')
          tag.textContent = String(options.label)
          tag.style.position = 'fixed'
          tag.style.left = Math.max(0, rect.left) + 'px'
          tag.style.top = Math.max(0, rect.top - 18) + 'px'
          tag.style.padding = '1px 5px'
          tag.style.borderRadius = '4px'
          tag.style.background = options?.color || '#3b82f6'
          tag.style.color = '#020617'
          tag.style.fontWeight = '700'
          tag.style.fontSize = '10px'
          tag.style.pointerEvents = 'none'
          root.appendChild(tag)
        }
        return true
      }
      clearOverlay('结果页：定位前五个抓取卡片与字段')
      const abs = (value) => {
        if (!value || typeof value !== 'string') return ''
        try { return new URL(value, location.href).toString() } catch { return '' }
      }
      const extractOfferId = (raw) => {
        const value = String(raw || '')
        if (!value) return ''
        const direct = value.match(/detail\\.1688\\.com\\/offer\\/(\\d{6,})/i)
        if (direct && direct[1]) return direct[1]
        const relative = value.match(/\\/offer\\/(\\d{6,})(?:\\.html)?/i)
        if (relative && relative[1]) return relative[1]
        const fromQuery = value.match(/(?:offerid|offerId|itemId|offer_id|offer-id)[=:"']([0-9]{6,})/i)
        if (fromQuery && fromQuery[1]) return fromQuery[1]
        return ''
      }
      const toDetailOfferUrl = (raw) => {
        const direct = abs(raw)
        const directId = extractOfferId(direct || raw)
        if (directId) return 'https://detail.1688.com/offer/' + directId + '.html'
        return ''
      }
      const isOfferLink = (href) => {
        if (!href) return false
        return Boolean(toDetailOfferUrl(href))
      }
      const parsePriceNumbers = (text) => {
        const t = clean(text)
        if (!t) return []
        const candidates = new Set()
        const range = t.match(/(?:¥|￥)?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*[~\\-]\\s*(?:¥|￥)?\\s*([0-9]+(?:\\.[0-9]+)?)/)
        if (range) {
          const minValue = Number(range[1])
          if (Number.isFinite(minValue) && minValue > 0) candidates.add(minValue)
        }
        const direct = /(?:¥|￥|RMB|rmb)?\\s*([0-9]+(?:\\.[0-9]+)?)/g
        let match
        while ((match = direct.exec(t)) !== null) {
          const value = Number(match[1])
          if (Number.isFinite(value) && value > 0) candidates.add(value)
        }
        return Array.from(candidates)
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0 && value < 100000)
      }
      const parseColorScore = (colorText) => {
        const text = clean(colorText).toLowerCase()
        if (!text) return 0
        if (/red|orange/.test(text)) return 4
        const rgb = text.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/)
        if (!rgb) return 0
        const r = Number(rgb[1])
        const g = Number(rgb[2])
        const b = Number(rgb[3])
        if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return 0
        if (r >= 170 && r > g + 20 && r > b + 20) return 4
        if (r >= 170 && g >= 60 && g <= 180 && b <= 120) return 3
        return 0
      }
      const calcPriceNodeScore = (node) => {
        if (!(node instanceof Element)) return 0
        let score = 0
        const style = window.getComputedStyle(node)
        const fontSize = Number.parseFloat(style.fontSize || '0')
        if (Number.isFinite(fontSize)) {
          if (fontSize >= 24) score += 8
          else if (fontSize >= 20) score += 6
          else if (fontSize >= 17) score += 4
          else if (fontSize >= 14) score += 2
        }
        const fontWeight = Number.parseInt(style.fontWeight || '400', 10)
        if (Number.isFinite(fontWeight) && fontWeight >= 600) score += 2
        score += parseColorScore(style.color || '')
        const nodeText = clean(node.textContent || '')
        const classText = clean(node.className || '')
        const fullText = clean((nodeText || '') + ' ' + (classText || ''))
        if (/price|amount|money|rmb|￥|¥/i.test(fullText)) score += 2
        if (/freight|postage|shipping|yunfei|运费|邮费|快递|物流|配送/i.test(fullText)) score -= 10
        if (/起批|成交|销量|件已售|月销/i.test(fullText)) score -= 3
        return score
      }
      const pushPriceCandidates = (target, text, score, source) => {
        const values = parsePriceNumbers(text)
        for (const value of values) {
          target.push({ value, score, source })
        }
      }
      const pickBestPrice = (candidates) => {
        if (!Array.isArray(candidates) || candidates.length === 0) return null
        let normalized = candidates
          .map((item) => {
            const value = Number(item.value)
            const score = Number(item.score)
            return {
              value,
              score: Number.isFinite(score) ? score : 0
            }
          })
          .filter((item) => Number.isFinite(item.value) && item.value > 0)
        if (normalized.length === 0) return null

        const hasLargeCandidate = normalized.some((item) => item.value >= 5)
        if (hasLargeCandidate) {
          normalized = normalized.filter((item) => item.value >= 5)
        }
        if (normalized.length === 0) return null

        normalized.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          return b.value - a.value
        })
        const first = normalized[0]
        if (!first) return null
        return first.value
      }
      const parseMoq = (text) => {
        const t = clean(text)
        const match = t.match(/([0-9]+(?:\\.[0-9]+)?\\s*(?:件|个|套|箱|包|双|只|台|米|公斤|kg|KG)\\s*起批)/i)
        return match ? clean(match[1]) : ''
      }
      const parseFreightPrice = (text) => {
        const t = clean(text)
        if (!t) return null
        const direct = t.match(/(?:运费|邮费|快递|物流(?:费)?|配送费)\\s*[:：]?\\s*([0-9]+(?:\\.[0-9]+)?)/i)
        if (direct) {
          const value = Number(direct[1])
          if (Number.isFinite(value) && value >= 0) return value
        }
        if (/运费|邮费|快递|物流|配送/i.test(t)) {
          const fallback = t.match(/([0-9]+(?:\\.[0-9]+)?)\\s*元/i)
          if (fallback) {
            const value = Number(fallback[1])
            if (Number.isFinite(value) && value >= 0) return value
          }
        }
        return null
      }
      const parseRepurchaseRate = (text) => {
        const t = clean(text)
        const match = t.match(/([1-9]\\d?(?:\\.\\d+)?%)\\s*回头率/i)
        return match ? clean(match[1] + ' 回头率') : ''
      }
      const parseServiceRate48h = (text) => {
        const t = clean(text)
        if (!t) return ''
        const match = t.match(/48\\s*[Hh](?:小时)?\\s*揽收(?:率)?\\s*[:：]?\\s*([0-9]+(?:\\.[0-9]+)?%)/i)
        return match ? clean(match[1]) : ''
      }
      const parseShopNameFromSettlementText = (text) => {
        const t = clean(text)
        if (!t) return ''
        const inline = t.match(/入驻\\s*\\d+\\s*年\\s*([\\u4e00-\\u9fa5A-Za-z0-9·()（）\\-]{2,40})/)
        if (inline && inline[1]) return clean(inline[1])
        const tail = t.match(/([\\u4e00-\\u9fa5A-Za-z0-9·()（）\\-]{2,40})\\s*$/)
        return tail && tail[1] ? clean(tail[1]) : ''
      }
      const pickText = (container, selectors) => {
        for (const selector of selectors) {
          const node = container.querySelector(selector)
          if (!node) continue
          const text = clean(node.textContent || '')
          if (text) return text
        }
        return ''
      }
      const pickNode = (container, selectors) => {
        for (const selector of selectors) {
          const node = container.querySelector(selector)
          if (!(node instanceof HTMLElement)) continue
          const text = clean(node.textContent || '')
          if (!text) continue
          return node
        }
        return null
      }
      const pickShopNodeBySettlementText = (container) => {
        const nodes = Array.from(container.querySelectorAll('a,span,div,p')).slice(0, 180)
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue
          const text = clean(node.innerText || node.textContent || '')
          if (!text) continue
          if (!/入驻\\s*\\d+\\s*年/.test(text)) continue
          const shop = parseShopNameFromSettlementText(text)
          if (!shop) continue
          return { node, shopName: shop }
        }
        return null
      }
      const pickAttribute = (container, selectors, attr) => {
        for (const selector of selectors) {
          const node = container.querySelector(selector)
          if (!(node instanceof Element)) continue
          const value = clean(node.getAttribute(attr) || '')
          if (value) return value
        }
        return ''
      }
      const pickOfferAnchor = (container) => {
        const anchors = Array.from(container.querySelectorAll('a[href]'))
        for (const anchor of anchors) {
          const href = toDetailOfferUrl(anchor.getAttribute('href') || '')
          if (!isOfferLink(href)) continue
          return { href, anchor }
        }
        return null
      }
      const pickOfferFromAttributes = (container) => {
        const attrs = ['href', 'data-href', 'data-url', 'data-detail-url', 'data-link', 'data-jump-url', 'data-target-url', 'onclick']
        const nodes = [container, ...Array.from(container.querySelectorAll('[href],[data-href],[data-url],[data-detail-url],[data-link],[data-jump-url],[data-target-url],[onclick]')).slice(0, 90)]
        for (const node of nodes) {
          if (!(node instanceof Element)) continue
          for (const key of attrs) {
            const raw = node.getAttribute(key) || ''
            if (!raw) continue
            const href = toDetailOfferUrl(raw)
            if (!href) continue
            return { href, anchor: node instanceof HTMLAnchorElement ? node : null }
          }
        }
        return null
      }

      const rows = []
      const seen = new Set()
      const findCardContainerForAnchor = (anchor) => {
        if (!(anchor instanceof Element)) return null
        let current = anchor
        let fallback = anchor.closest('li,article,section,div')
        for (let depth = 0; depth < 10 && current; depth += 1) {
          if (!(current instanceof Element)) break
          const rect = current.getBoundingClientRect()
          const text = clean(current.textContent || '')
          const hasImage = Boolean(current.querySelector('img'))
          if (
            rect &&
            Number.isFinite(rect.width) &&
            Number.isFinite(rect.height) &&
            rect.width >= 180 &&
            rect.height >= 180 &&
            rect.bottom > 0 &&
            text.length >= 16 &&
            hasImage
          ) {
            return current
          }
          if (
            !fallback &&
            rect &&
            Number.isFinite(rect.width) &&
            Number.isFinite(rect.height) &&
            rect.width >= 120 &&
            rect.height >= 120
          ) {
            fallback = current
          }
          current = current.parentElement
        }
        return fallback instanceof Element ? fallback : anchor
      }
      const collect = (container, anchorInfoSeed) => {
        if (!container || !container.querySelector) return
        const anchorInfo = anchorInfoSeed || pickOfferAnchor(container) || pickOfferFromAttributes(container)
        if (!anchorInfo) return
        if (seen.has(anchorInfo.href)) return
        const candidateIndex = rows.length + 1
        drawBox(container, {
          color: '#3b82f6',
          label: 'supplier[' + String(candidateIndex - 1) + '] 候选卡',
          style: 'solid'
        })
        if (anchorInfo.anchor instanceof HTMLElement) {
          drawBox(anchorInfo.anchor, { color: '#eab308', label: 'detailUrl', style: 'dashed' })
        }
        const text = clean(container.textContent || '')
        const anchorNode = anchorInfo.anchor instanceof Element ? anchorInfo.anchor : null
        const supplierTitle =
          pickText(container, [
            '[class*="offer-title"]',
            '[class*="title"] a[title]',
            '[class*="title"] a',
            '[class*="title"]'
          ]) ||
          clean((anchorNode && (anchorNode.getAttribute('title') || anchorNode.textContent)) || '')
        let companyName =
          pickAttribute(
            container,
            [
              'a[href*="company.1688.com"][title]',
              'div.company-name[title]',
              'a.offer-company[title]',
              '[class*="company-name"][title]',
              '[class*="shop-name"][title]'
            ],
            'title'
          ) ||
          pickText(container, [
            'a.offer-company',
            '[class*="company-name"]',
            '[class*="shop-name"]',
            '[class*="company"] [class*="name"]',
            '[class*="seller"] [class*="name"]',
            '[class*="shop"] [class*="name"]',
            'a[href*="company.1688.com"]'
          ])
        const settlementShop = pickShopNodeBySettlementText(container)
        if (!companyName && settlementShop?.shopName) {
          companyName = settlementShop.shopName
        }
        const companyNode =
          settlementShop?.node ||
          pickNode(container, [
            'a.offer-company',
            '[class*="company-name"]',
            '[class*="shop-name"]',
            '[class*="company"] [class*="name"]',
            '[class*="seller"] [class*="name"]',
            '[class*="shop"] [class*="name"]',
            'a[href*="company.1688.com"]'
          ])
        if (companyNode) {
          drawBox(companyNode, { color: '#a855f7', label: '店铺名(companyName)', style: 'dashed' })
        }
        const supplierName = companyName || supplierTitle
        const moqText = pickText(container, ['[class*="moq"]', '[class*="batch"]', '[class*="start"]']) || parseMoq(text)
        const moqNode = pickNode(container, ['[class*="moq"]', '[class*="batch"]', '[class*="start"]'])
        if (moqNode) {
          drawBox(moqNode, { color: '#f59e0b', label: 'moq', style: 'dashed' })
        }
        const serviceRate48h = parseServiceRate48h(text)
        const serviceNode = pickNode(container, [
          '[class*="service"]',
          '[class*="48"]',
          '[class*="repurchase"]',
          '[class*="headpurchase"]',
          '[class*="回头率"]'
        ])
        if (serviceNode) {
          drawBox(serviceNode, { color: '#06b6d4', label: 'serviceRate48h/repurchaseRate', style: 'dashed' })
        }
        const repurchase =
          pickText(container, ['[class*="repurchase"]', '[class*="headpurchase"]', '[class*="回头率"]']) ||
          parseRepurchaseRate(text)
        const freightText =
          pickText(container, ['[class*="freight"]', '[class*="postage"]', '[class*="ship"]', '[class*="express"]']) ||
          ''
        const freightPrice = parseFreightPrice(freightText) ?? parseFreightPrice(text)
        const imgNode = container.querySelector('img')
        const imgUrl = imgNode ? abs(imgNode.currentSrc || imgNode.getAttribute('src') || imgNode.getAttribute('data-src') || '') : ''
        const priceCandidates = []
        const attrNodes = Array.from(
          container.querySelectorAll('[data-price], [data-offer-price], [price], meta[itemprop="price"], meta[property="product:price:amount"]')
        )
        for (const node of attrNodes) {
          if (!(node instanceof Element)) continue
          const valueText =
            node.getAttribute('data-price') ||
            node.getAttribute('data-offer-price') ||
            node.getAttribute('price') ||
            node.getAttribute('content') ||
            ''
          if (!valueText) continue
          pushPriceCandidates(priceCandidates, valueText, 16, 'attr')
        }
        const priceNodes = Array.from(
          container.querySelectorAll('[class*="price"], [class*="Price"], .price, .amount, [data-price], [data-offer-price]')
        ).slice(0, 40)
        const firstPriceNode = priceNodes.find((node) => node instanceof HTMLElement)
        if (firstPriceNode && firstPriceNode instanceof HTMLElement) {
          drawBox(firstPriceNode, { color: '#22c55e', label: 'price -> purchasePrice', style: 'dashed' })
        }
        for (const node of priceNodes) {
          if (!(node instanceof Element)) continue
          const textValue = clean(node.textContent || '')
          if (!textValue) continue
          const score = 6 + calcPriceNodeScore(node)
          pushPriceCandidates(priceCandidates, textValue, score, 'node')
        }
        pushPriceCandidates(priceCandidates, text, 1, 'full-text')
        const price = pickBestPrice(priceCandidates)
        rows.push({
          supplierName,
          supplierTitle,
          companyName,
          price,
          freightPrice,
          moq: moqText,
          repurchaseRate: repurchase || null,
          serviceRate48h: serviceRate48h || null,
          imgUrl,
          detailUrl: anchorInfo.href
        })
        seen.add(anchorInfo.href)
      }

      const anchorCandidates = []
      const allAnchors = Array.from(document.querySelectorAll('a[href]'))
      for (const node of allAnchors) {
        if (!(node instanceof HTMLAnchorElement)) continue
        const href = toDetailOfferUrl(node.getAttribute('href') || '')
        if (!isOfferLink(href)) continue
        const card = findCardContainerForAnchor(node)
        if (!(card instanceof Element)) continue
        const rect = card.getBoundingClientRect()
        if (
          !rect ||
          !Number.isFinite(rect.top) ||
          !Number.isFinite(rect.left) ||
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height) ||
          rect.width < 120 ||
          rect.height < 120 ||
          rect.bottom <= 0
        ) {
          continue
        }
        anchorCandidates.push({
          anchor: node,
          href,
          card,
          top: rect.top,
          left: rect.left
        })
      }

      anchorCandidates.sort((a, b) => {
        if (Math.abs(a.top - b.top) > 8) return a.top - b.top
        return a.left - b.left
      })

      const firstRowAnchors = (() => {
        if (anchorCandidates.length === 0) return []
        const minTop = Math.min(...anchorCandidates.map((item) => item.top))
        const rowThreshold = minTop + 180
        const picked = []
        const seenHref = new Set()
        for (const item of anchorCandidates) {
          if (item.top > rowThreshold) continue
          if (seenHref.has(item.href)) continue
          picked.push(item)
          seenHref.add(item.href)
          if (picked.length >= 12) break
        }
        return picked
      })()

      for (const item of firstRowAnchors) {
        collect(item.card, { href: item.href, anchor: item.anchor })
        if (rows.length >= 5) break
      }

      if (rows.length === 0) {
        const fallbackContainers = Array.from(
          document.querySelectorAll(
            '.sm-offer-item, li[class*="offer"], article[class*="offer"], [class*="offer-card"], [class*="img-search-result"], div[data-offerid]'
          )
        ).filter((item) => item instanceof Element)
        const measuredFallback = fallbackContainers
          .map((container) => ({
            container,
            rect: container.getBoundingClientRect()
          }))
          .filter(
            (item) =>
              item.rect &&
              Number.isFinite(item.rect.top) &&
              Number.isFinite(item.rect.left) &&
              Number.isFinite(item.rect.width) &&
              Number.isFinite(item.rect.height) &&
              item.rect.width >= 120 &&
              item.rect.height >= 120 &&
              item.rect.bottom > 0
          )
          .sort((a, b) => {
            if (Math.abs(a.rect.top - b.rect.top) > 8) return a.rect.top - b.rect.top
            return a.rect.left - b.rect.left
          })
          .map((item) => item.container)
        for (const container of measuredFallback) {
          collect(container, null)
          if (rows.length >= 5) break
        }
      }

      if (rows.length === 0) {
        const imageCards = Array.from(document.querySelectorAll('img'))
          .map((img) => img.closest('li,article,section,div'))
          .filter((node) => node instanceof Element)
        const measuredByImage = imageCards
          .map((container) => ({
            container,
            rect: container.getBoundingClientRect()
          }))
          .filter(
            (item) =>
              item.rect &&
              Number.isFinite(item.rect.top) &&
              Number.isFinite(item.rect.left) &&
              Number.isFinite(item.rect.width) &&
              Number.isFinite(item.rect.height) &&
              item.rect.width >= 150 &&
              item.rect.height >= 180 &&
              item.rect.bottom > 0
          )
          .sort((a, b) => {
            if (Math.abs(a.rect.top - b.rect.top) > 10) return a.rect.top - b.rect.top
            return a.rect.left - b.rect.left
          })
          .map((item) => item.container)
        for (const container of measuredByImage) {
          collect(container, null)
          if (rows.length >= 5) break
        }
      }

      return rows
    })()`,
    true
  ).catch(() => [])

  const rows = Array.isArray(raw) ? (raw as Scout1688ParsedRow[]) : []
  console.info('[ScoutSourcing] parse1688RowsFromCurrentPage', { count: rows.length })
  return rows
}

function normalize1688SupplierResults(
  rows: Scout1688ParsedRow[],
  targetPrice: number,
  limit: number
): Scout1688SupplierResult[] {
  const normalized: Scout1688SupplierResult[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const detailUrl = normalize1688OfferUrl(row.detailUrl)
    if (!detailUrl || seen.has(detailUrl)) continue
    const price = parseNumber(row.price)
    if (price == null || !Number.isFinite(price) || price <= 0) continue
    const companyName = normalizeText(row.companyName) || null
    const supplierTitle = normalizeText(row.supplierTitle) || null
    const supplierName = normalizeText(row.supplierName) || companyName || '1688供应商'
    const freightParsed = parseNumber(row.freightPrice)
    const freightPrice = freightParsed != null && Number.isFinite(freightParsed) && freightParsed >= 0 ? freightParsed : null
    const moq = normalizeText(row.moq) || '-'
    const repurchaseRaw = normalizeText(row.repurchaseRate)
    const repurchaseRate = repurchaseRaw ? repurchaseRaw : null
    const serviceRate48hRaw = normalizeText(row.serviceRate48h)
    const serviceRate48h = serviceRate48hRaw || null
    const imgUrl = normalizeText(row.imgUrl)
    normalized.push({
      supplierName,
      supplierTitle,
      companyName,
      price,
      freightPrice,
      moq,
      repurchaseRate,
      serviceRate48h,
      imgUrl,
      detailUrl,
      netProfit: Number((targetPrice - price - 6).toFixed(2)),
      isFallback: false
    })
    seen.add(detailUrl)
    if (normalized.length >= limit) break
  }
  return normalized
}

function inferImageMimeType(filePath: string): string {
  const lower = normalizeText(filePath).toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  return 'image/jpeg'
}

async function fetchXhsCoverImageByHiddenWindow(
  url: string,
  opts: { relaxed?: boolean; preferredPartitionKey?: string } = {}
): Promise<string | null> {
  const normalizedUrl = normalizeText(url)
  if (!normalizedUrl || !/^https?:\/\//i.test(normalizedUrl)) return null
  const relaxed = opts.relaxed === true
  const preferredPartitionKey = normalizeText(opts.preferredPartitionKey)
  const hasPreferredPartition = Boolean(preferredPartitionKey)
  const debugVisible = shouldEnableCoverVisualMode()
  const debugKeepWindowOpen = shouldKeepCoverWindowOpenAfterRun()
  const debugOpenDevTools = shouldOpenCoverDevTools()
  const shouldShowWindow = debugVisible || debugKeepWindowOpen || debugOpenDevTools
  const partitionKey = hasPreferredPartition
    ? preferredPartitionKey
    : relaxed
      ? XHS_COVER_PARTITION_RELAXED
      : XHS_COVER_PARTITION

  const { BrowserWindow, session } = await import('electron')
  const workerSession = session.fromPartition(partitionKey)
  const requestFilter = { urls: ['*://*/*'] }
  const shouldInstallRequestBlocker = !relaxed && !hasPreferredPartition
  if (shouldInstallRequestBlocker) {
    workerSession.webRequest.onBeforeRequest(requestFilter, (details, callback) => {
      const type = normalizeText((details as { resourceType?: unknown }).resourceType).toLowerCase()
      const shouldBlock = type === 'image' || type === 'stylesheet' || type === 'font'
      callback({ cancel: shouldBlock })
    })
  }

  const win = new BrowserWindow({
    show: shouldShowWindow,
    width: 1400,
    height: 900,
    webPreferences: {
      partition: partitionKey,
      sandbox: false,
      offscreen: !relaxed && !shouldShowWindow,
      backgroundThrottling: false
    }
  })

  const cleanupRequestHook = (): void => {
    if (shouldInstallRequestBlocker) {
      workerSession.webRequest.onBeforeRequest(requestFilter, (_details, callback) => {
        callback({ cancel: false })
      })
    }
  }

  const consoleHints: string[] = []
  const onConsoleMessage = (_event: unknown, _level: number, message: string): void => {
    const text = normalizeText(message)
    if (!text) return
    if (!/chrome-extension:\/\/|inject\.bundle|content-scripts|net::ERR_FAILED/i.test(text)) return
    if (consoleHints.length >= 5) return
    consoleHints.push(text.slice(0, 220))
  }

  try {
    win.webContents.on('console-message', onConsoleMessage)

    const domReadyPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        detach()
        reject(new Error('dom-ready timeout'))
      }, relaxed ? 18_000 : 12_000)
      const onDomReady = (): void => {
        detach()
        resolve()
      }
      const onFailed = (_event: unknown, code: number, desc: string): void => {
        detach()
        reject(new Error(`did-fail-load:${code}:${desc}`))
      }
      const detach = (): void => {
        clearTimeout(timer)
        win.webContents.removeListener('dom-ready', onDomReady)
        win.webContents.removeListener('did-fail-load', onFailed)
      }
      win.webContents.on('dom-ready', onDomReady)
      win.webContents.on('did-fail-load', onFailed)
    })

    await win.loadURL(normalizedUrl, {
      userAgent: XHS_COVER_STEALTH_UA
    })
    await domReadyPromise
    if (shouldShowWindow && !win.isDestroyed()) {
      win.show()
      maybeOpenCoverDevTools(win)
    }

    // Warm-up: mimic human reading session to avoid "instant bounce".
    try {
      await win.webContents.executeJavaScript(
        `(() => new Promise((resolve) => {
          const delay = ${relaxed ? '3200 + Math.floor(Math.random() * 2201)' : '2000 + Math.floor(Math.random() * 2501)'}
          try { window.scrollBy({ top: 480, behavior: 'smooth' }) } catch { try { window.scrollBy(0, 480) } catch {} }
          setTimeout(resolve, delay)
        }))()`,
        true
      )
    } catch {
      // noop
    }

    const picked = (await win.webContents.executeJavaScript(
      `(() => new Promise(async (resolve) => {
        try {
          const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
          const antiMarkers = [
            '异常流量',
            '访问受限',
            '安全验证',
            '请完成验证',
            '验证码',
            'anti-spider',
            'risk control'
          ];
          const isLikelyImageUrl = (value) => {
            const text = String(value || '').trim();
            if (!text) return false;
            const lower = text.toLowerCase();
            if (lower.startsWith('data:') || lower.startsWith('blob:')) return false;
            if (!/^https?:\\/\\//i.test(text) && !/^\\/\\//.test(text) && !text.startsWith('/')) return false;
            if (/(logo|avatar|sprite|placeholder|default)/i.test(lower)) return false;
            return /(\\.(jpe?g|png|webp|avif)(\\?|$)|imageView2|xhs|xhscdn|sns-webpic)/i.test(lower);
          };
          const toAbs = (value) => {
            const text = String(value || '').trim();
            if (!text) return '';
            if (/^\\/\\//.test(text)) return 'https:' + text;
            if (/^https?:\\/\\//i.test(text)) return text;
            if (/^\\//.test(text)) {
              try { return new URL(text, location.href).toString(); } catch { return text; }
            }
            return text;
          };
          const findAntiMarker = () => {
            const bodyText = String(document.body?.innerText || '').slice(0, 3000).toLowerCase();
            const title = String(document.title || '').toLowerCase();
            return antiMarkers.find((item) => bodyText.includes(item.toLowerCase()) || title.includes(item.toLowerCase())) || '';
          };
          const scorePath = (path) => {
            const text = String(path || '').toLowerCase();
            let score = 0;
            if (/image|img|cover|main|first|default|url/.test(text)) score += 6;
            if (/imagelist|swiper|carousel|top/.test(text)) score += 4;
            if (/detail|desc|description|rich/.test(text)) score -= 3;
            return score;
          };
          const pickFromObject = (root) => {
            if (!root || (typeof root !== 'object' && !Array.isArray(root))) return '';
            const queue = [{ value: root, path: '$', depth: 0 }];
            const seen = new Set();
            let best = { url: '', score: -Infinity };
            let stateReady = false;
            while (queue.length > 0 && seen.size < 7000) {
              const node = queue.shift();
              if (!node) continue;
              const { value, path, depth } = node;
              if (value == null) continue;
              if (typeof value === 'object') {
                if (seen.has(value)) continue;
                seen.add(value);
              }
              if (depth > 8) continue;
              if (typeof value === 'string') {
                if (!isLikelyImageUrl(value)) continue;
                const abs = toAbs(value);
                if (!isLikelyImageUrl(abs)) continue;
                const pathScore = scorePath(path);
                const hostScore = /(xhs|xhscdn|sns-webpic)/i.test(abs) ? 3 : 0;
                const total = pathScore + hostScore;
                if (total > best.score) best = { url: abs, score: total };
                continue;
              }
              if (Array.isArray(value)) {
                for (let i = 0; i < Math.min(value.length, 16); i += 1) {
                  queue.push({ value: value[i], path: path + '[' + i + ']', depth: depth + 1 });
                }
                continue;
              }
              if (value && typeof value === 'object') {
                stateReady = true;
                const entries = Object.entries(value);
                for (let i = 0; i < Math.min(entries.length, 80); i += 1) {
                  const [key, next] = entries[i];
                  queue.push({ value: next, path: path + '.' + key, depth: depth + 1 });
                }
              }
            }
            return { image: best.url, stateReady };
          };
          const pickFromStates = () => {
            const candidates = [
              window.__INITIAL_STATE__,
              window.__INITIAL_SSR_STATE__,
              window.__PRELOADED_STATE__,
              window.__NEXT_DATA__,
              window.__NUXT__
            ];
            let stateReady = false;
            for (const state of candidates) {
              const result = pickFromObject(state);
              if (result && typeof result === 'object' && result.stateReady) stateReady = true;
              const image = result && typeof result === 'object' ? result.image : '';
              if (isLikelyImageUrl(image)) return { image, stateReady };
            }
            return { image: '', stateReady };
          };
          const pickFromMeta = () => {
            const selectors = [
              'meta[property="og:image"]',
              'meta[name="og:image"]',
              'meta[name="twitter:image"]'
            ];
            for (const selector of selectors) {
              const content = document.querySelector(selector)?.getAttribute('content') || '';
              const image = toAbs(content);
              if (isLikelyImageUrl(image)) return image;
            }
            return '';
          };
          const pickFromDom = () => {
            const viewportH = Math.max(window.innerHeight || 0, 1);
            const viewportW = Math.max(window.innerWidth || 0, 1);
            const images = Array.from(document.querySelectorAll('img[src]'));
            let best = { url: '', score: -Infinity };
            for (const img of images) {
              const src = toAbs(img.getAttribute('src') || img.currentSrc || '');
              if (!isLikelyImageUrl(src)) continue;
              const rect = img.getBoundingClientRect();
              const width = Math.max(rect.width || img.naturalWidth || 0, 0);
              const height = Math.max(rect.height || img.naturalHeight || 0, 0);
              if (width < 180 || height < 180) continue;
              if (rect.top > viewportH * 1.4 || rect.bottom < -40) continue;
              const centerX = rect.left + rect.width / 2;
              const centerPenalty = Math.abs(centerX - viewportW / 2) / 32;
              const areaScore = Math.min(width * height, 1200000) / 3600;
              const topScore = Math.max(0, 260 - Math.max(rect.top, 0));
              const score = areaScore + topScore - centerPenalty;
              if (score > best.score) best = { url: src, score };
            }
            return best.url;
          };

          const maxRounds = ${relaxed ? '10' : '7'};
          for (let round = 0; round < maxRounds; round += 1) {
            const antiMarker = findAntiMarker();
            const fromState = pickFromStates();
            const fromMeta = pickFromMeta();
            const fromDom = pickFromDom();
            const image = fromState.image || fromMeta || fromDom || '';
            if (isLikelyImageUrl(image)) {
              resolve({
                image,
                antiMarker,
                stateReady: Boolean(fromState.stateReady),
                title: String(document.title || '').slice(0, 120),
                href: String(location.href || ''),
                method: fromState.image ? 'state' : fromMeta ? 'meta' : 'dom'
              });
              return;
            }
            if (antiMarker) {
              resolve({
                image: '',
                antiMarker,
                stateReady: Boolean(fromState.stateReady),
                title: String(document.title || '').slice(0, 120),
                href: String(location.href || ''),
                method: ''
              });
              return;
            }
            await sleep(900 + Math.floor(Math.random() * 500));
          }
          resolve({
            image: '',
            antiMarker: '',
            stateReady: true,
            title: String(document.title || '').slice(0, 120),
            href: String(location.href || ''),
            method: ''
          });
        } catch (e) {
          resolve({
            image: '',
            antiMarker: '',
            stateReady: false,
            title: '',
            href: '',
            method: ''
          });
        }
      }))()`,
      true
    )) as
      | {
          image?: unknown
          antiMarker?: unknown
          stateReady?: unknown
          title?: unknown
          href?: unknown
          method?: unknown
        }
      | string
      | null

    const rawPicked = normalizeText(typeof picked === 'string' ? picked : picked?.image)
    if (!rawPicked) {
      const antiMarker = normalizeText(typeof picked === 'string' ? '' : picked?.antiMarker)
      const title = normalizeText(typeof picked === 'string' ? '' : picked?.title)
      const href = normalizeText(typeof picked === 'string' ? '' : picked?.href)
      const debugHint = consoleHints.length > 0 ? `|console:${consoleHints.join(' || ')}` : ''
      const meta = [antiMarker, title, href].filter(Boolean).join('|')
      if (antiMarker) {
        throw new Error(meta ? `${XHS_ANTI_SPIDER_ERROR}:${meta}${debugHint}` : XHS_ANTI_SPIDER_ERROR)
      }
      throw new Error(
        `${XHS_COVER_PARSE_ERROR}:${[title, href].filter(Boolean).join('|') || 'no-image'}${debugHint}`
      )
    }
    const lower = rawPicked.toLowerCase()
    if (lower.includes('logo') || lower.includes('assets/img') || lower.includes('spacer')) {
      throw new Error(`${XHS_COVER_PARSE_ERROR}:placeholder-image`)
    }
    try {
      return new URL(rawPicked, normalizedUrl).toString()
    } catch {
      return rawPicked
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(XHS_ANTI_SPIDER_ERROR)) {
      if (!relaxed) {
        return fetchXhsCoverImageByHiddenWindow(normalizedUrl, { relaxed: true, preferredPartitionKey })
      }
      throw new Error(message || XHS_ANTI_SPIDER_ERROR)
    }
    if (message.includes(XHS_COVER_PARSE_ERROR)) {
      throw new Error(message)
    }
    return null
  } finally {
    win.webContents.removeListener('console-message', onConsoleMessage)
    cleanupRequestHook()
    if (shouldShowWindow && debugKeepWindowOpen && !win.isDestroyed()) {
      try {
        win.setTitle(`XHS封面调试窗口${relaxed ? '（relaxed）' : ''}`)
      } catch {
        // noop
      }
    } else if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}



function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseFansToNumber(value: string | null): number {
  if (!value) return 0
  const text = normalizeText(value)
  if (!text) return 0
  const cleaned = text.replace(/[,\s]/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resolveSuggestedAction(item: {
  potentialScore: number
  addCart24hValue: number
  deltaAddCart24h: number | null
  isNew: boolean
}): '优先种草' | '继续观察' | '暂缓' {
  const delta = item.deltaAddCart24h ?? 0
  if (
    item.potentialScore >= 72 ||
    (item.potentialScore >= 60 && delta >= 300) ||
    (item.isNew && item.addCart24hValue >= 2000 && delta >= 150)
  ) {
    return '优先种草'
  }
  if (item.potentialScore >= 42 || (item.addCart24hValue >= 800 && delta >= 80)) {
    return '继续观察'
  }
  return '暂缓'
}

function getPotentialSortValue(
  item: ScoutPotentialProductRecord,
  sortBy: 'potentialScore' | 'addCart24hValue' | 'deltaAddCart24h' | 'shopFans' | 'lastUpdatedAt'
): number {
  switch (sortBy) {
    case 'addCart24hValue':
      return item.addCart24hValue
    case 'deltaAddCart24h':
      return item.deltaAddCart24h ?? Number.MIN_SAFE_INTEGER
    case 'shopFans':
      return parseFansToNumber(item.shopFans)
    case 'lastUpdatedAt':
      return item.lastUpdatedAt
    case 'potentialScore':
    default:
      return item.potentialScore
  }
}

async function createExcelWorkbook(): Promise<{
  worksheets: Array<{
    name: string
    rowCount: number
    getRow: (index: number) => { values: unknown[]; getCell: (col: number) => { value: unknown } }
  }>
  xlsx: { readFile: (filePath: string) => Promise<void>; writeFile: (filePath: string) => Promise<void> }
  addWorksheet: (name: string) => {
    columns: Array<{ header: string; key: string; width?: number }>
    addRow: (row: Record<string, unknown> | Array<unknown>) => void
  }
}> {
  const mod = await import('exceljs')
  const workbookCtor =
    (mod as { Workbook?: new () => unknown }).Workbook ??
    (mod as { default?: { Workbook?: new () => unknown } }).default?.Workbook
  if (!workbookCtor) {
    throw new Error('ExcelJS.Workbook 构造器不可用')
  }
  return new workbookCtor() as {
    worksheets: Array<{
      name: string
      rowCount: number
      getRow: (index: number) => { values: unknown[]; getCell: (col: number) => { value: unknown } }
    }>
    xlsx: { readFile: (filePath: string) => Promise<void>; writeFile: (filePath: string) => Promise<void> }
    addWorksheet: (name: string) => {
      columns: Array<{ header: string; key: string; width?: number }>
      addRow: (row: Record<string, unknown> | Array<unknown>) => void
    }
  }
}
