import { createHash } from 'crypto'
import { basename } from 'path'

import { SqliteService } from './sqliteService'

type DbConnection = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown
    get: (...args: unknown[]) => Record<string, unknown> | undefined
    all: (...args: unknown[]) => Array<Record<string, unknown>>
  }
  transaction: <T extends (...args: unknown[]) => unknown>(fn: T) => T
}

type RawCommerceRow = {
  snapshotDate: string
  noteKey: string
  noteId: string | null
  title: string
  accountName: string | null
  accountXhsId: string | null
  noteCreatedAt: number | null
  noteType: '图文' | '视频' | null
  productId: string | null
  productName: string | null
  readCount: number
  likeCount: number
  collectCount: number
  commentCount: number
  shareCount: number
  followCount: number
  danmuCount: number
  avgWatchSeconds: number
  finishRatePv: number
  clickCount: number
  clickPeople: number
  clickRatePv: number
  payOrders: number
  payUsers: number
  payAmount: number
  payRatePv: number
  payRateUv: number
  addCartCount: number
  refundAmountPayTime: number
  refundRatePayTime: number
}

type RawContentRow = {
  snapshotDate: string
  rowId: string
  title: string
  firstPublishedAt: number | null
  noteType: '图文' | '视频' | null
  exposure: number
  viewCount: number
  coverClickRate: number
  likeCount: number
  commentCount: number
  collectCount: number
  followGainCount: number
  shareCount: number
  avgWatchSeconds: number
  danmuCount: number
}

type MatchRecord = {
  noteKey: string
  contentRowId: string | null
  confidence: number
  rule: 'title_time_exact' | 'title_unique' | 'title_time_nearest' | 'unmatched'
}

type IntermediateRank = {
  noteKey: string
  accountName: string
  title: string
  ageDays: number
  noteType: '图文' | '视频'
  productName: string
  stageLabel: string
  stageIndex: 1 | 2 | 3 | 4 | 5
  trendDelta: number
  trendHint: string[]
  contentSignals: NoteRaceSignal[]
  commerceSignals: NoteRaceSignal[]
  dRead: number
  dClick: number
  dOrder: number
  acceleration: number
  stability: '高' | '中' | '低'
  refundRatePayTime: number
  trendRaw: number
  contentRaw: number
  commerceRaw: number
}

export type NoteRaceSignalTone = 'positive' | 'negative' | 'neutral'
export type NoteRaceTag = '起飞' | '维稳' | '掉速' | '长尾复活' | '风险'

export type NoteRaceSignal = {
  label: string
  tone: NoteRaceSignalTone
}

export type NoteRaceImportResult = {
  snapshotDate: string
  sourceFile: string
  importedRows: number
  matchedRows?: number
  totalRows?: number
}

export type NoteRaceImportKind = 'commerce' | 'content'
export type NoteRaceImportDetectedBy = 'header' | 'filename'
export type NoteRaceAutoImportResult = NoteRaceImportResult & {
  kind: NoteRaceImportKind
  detectedBy: NoteRaceImportDetectedBy
}

export type NoteRaceMeta = {
  latestDate: string | null
  availableDates: string[]
  totalNotes: number
  matchedNotes: number
  matchRate: number
  trendReadyDates: string[]
}

export type NoteRaceDeleteSnapshotResult = {
  snapshotDate: string
  deletedCommerceRows: number
  deletedContentRows: number
  deletedMatchRows: number
  deletedRankRows: number
  recomputedSnapshots: number
}

export type NoteRaceSnapshotStat = {
  snapshotDate: string
  commerceRows: number
  contentRows: number
  rankRows: number
  matchedRows: number
  latestImportedAt: number | null
}

export type NoteRaceSnapshotBatchStat = {
  snapshotDate: string
  importedAt: number
  commerceRows: number
  contentRows: number
  sourceFiles: string[]
  status: 'active' | 'deleted'
  deletedAt: number | null
  restorableUntil: number | null
  restorable: boolean
}

export type NoteRaceDeleteBatchResult = {
  snapshotDate: string
  importedAt: number
  deletedCommerceRows: number
  deletedContentRows: number
  recomputedSnapshots: number
}

export type NoteRaceRestoreBatchResult = {
  snapshotDate: string
  importedAt: number
  restoredCommerceRows: number
  restoredContentRows: number
  recomputedSnapshots: number
}

export type NoteRaceListQuery = {
  snapshotDate?: string
  account?: string
  noteType?: '全部' | '图文' | '视频'
  limit?: number
}

export type NoteRaceListRow = {
  id: string
  rank: number
  tag: NoteRaceTag
  account: string
  title: string
  ageDays: number
  score: number
  trendDelta: number
  trendHint: string[]
  contentSignals: NoteRaceSignal[]
  commerceSignals: NoteRaceSignal[]
  stageLabel: string
  stageIndex: 1 | 2 | 3 | 4 | 5
  noteType: '图文' | '视频'
  productName: string
}

export type NoteRaceDetail = {
  row: NoteRaceListRow
  noteId: string | null
  productId: string | null
  createdAt: number | null
  matchConfidence: number
  matchRule: string
  contentFunnel: Array<{
    label: string
    value: number
    conversionLabel?: string
    conversionValue?: number
  }>
  commerceFunnel: Array<{
    label: string
    value: number
    conversionLabel?: string
    conversionValue?: number
  }>
  sparkline: number[]
  deltas: {
    read: number
    click: number
    acceleration: number
    stability: '高' | '中' | '低'
  }
  cumulative: {
    startDate: string
    endDate: string
    spanDays: number
    activeDays: number
    coverageRate: number
    totalRead: number
    totalClick: number
    totalOrders: number
    totalAmount: number
    clickRate: number
    payRate: number
  }
}

type ExcelWorkbook = {
  worksheets: Array<{
    name: string
    rowCount: number
    getRow: (index: number) => { values: unknown[]; getCell: (col: number) => { value: unknown } }
  }>
  xlsx: {
    readFile: (filePath: string) => Promise<void>
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTitle(value: unknown): string {
  return normalizeText(value)
}

function normalizeCellValue(value: unknown): unknown {
  if (value == null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    const row = value as Record<string, unknown>
    if (typeof row.text === 'string') return row.text
    if (typeof row.result === 'string' || typeof row.result === 'number') return row.result
    if (typeof row.richText === 'object' && Array.isArray(row.richText)) {
      const merged = (row.richText as Array<{ text?: unknown }>)
        .map((item) => String(item?.text ?? ''))
        .join('')
      return merged
    }
  }
  return String(value)
}

function toText(value: unknown): string {
  const normalized = normalizeCellValue(value)
  return normalizeText(normalized)
}

function toNumber(value: unknown): number {
  const normalized = normalizeCellValue(value)
  if (normalized == null) return 0
  if (typeof normalized === 'number') return Number.isFinite(normalized) ? normalized : 0
  if (normalized instanceof Date) return normalized.getTime()
  const raw = String(normalized).trim()
  if (!raw) return 0
  const withoutComma = raw.replace(/,/g, '').replace(/%/g, '')
  const parsed = Number(withoutComma)
  if (!Number.isFinite(parsed)) return 0
  if (raw.includes('%')) return parsed / 100
  return parsed
}

function toRate(value: unknown): number {
  const numeric = toNumber(value)
  if (!Number.isFinite(numeric)) return 0
  if (numeric > 1) return numeric / 100
  return numeric
}

function parseDateValue(value: unknown): number | null {
  const normalized = normalizeCellValue(value)
  if (normalized == null) return null
  if (normalized instanceof Date) {
    const ts = normalized.getTime()
    return Number.isFinite(ts) ? ts : null
  }
  if (typeof normalized === 'number') {
    if (!Number.isFinite(normalized)) return null
    if (normalized > 1e11) return Math.floor(normalized)
    return null
  }
  const text = String(normalized).trim()
  if (!text) return null
  let parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) {
    const compact = text
      .replace(/年|\/|\\./g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, ' ')
    const normalizedTime = compact.replace(/时/g, ':').replace(/分/g, ':').replace(/秒/g, '')
    parsed = Date.parse(normalizedTime)
  }
  if (!Number.isFinite(parsed)) return null
  return Math.floor(parsed)
}

function formatDateYmd(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseSnapshotDateFromName(filePath: string): string | null {
  const fileName = basename(filePath)
  const fullDate = fileName.match(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/)
  if (fullDate) {
    const year = Number(fullDate[1])
    const month = Number(fullDate[2])
    const day = Number(fullDate[3])
    return normalizeDateParts(year, month, day)
  }
  const shortDate = fileName.match(/(^|[^0-9])(\d{1,2})[.月-](\d{1,2})([^0-9]|$)/)
  if (shortDate) {
    const now = new Date()
    return normalizeDateParts(now.getFullYear(), Number(shortDate[2]), Number(shortDate[3]))
  }
  return null
}

function normalizeDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function createNoteKey(noteId: string | null, title: string, createdAt: number | null): string {
  if (noteId) return noteId
  const source = `${normalizeTitle(title)}|${createdAt ?? ''}`
  return `hash_${createHash('md5').update(source).digest('hex')}`
}

function createContentRowId(title: string, firstPublishedAt: number | null): string {
  const source = `${normalizeTitle(title)}|${firstPublishedAt ?? ''}`
  return `content_${createHash('md5').update(source).digest('hex')}`
}

function createTitleTimeKey(title: string, timestamp: number | null): string {
  if (!timestamp) return `${normalizeTitle(title)}|`
  const iso = new Date(timestamp).toISOString().slice(0, 19)
  return `${normalizeTitle(title)}|${iso}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toSignal(prefix: string, value: number, unit: '' | 'pp' = ''): NoteRaceSignal {
  const rounded = unit === 'pp' ? Number(value.toFixed(1)) : Math.round(value)
  const sign = rounded > 0 ? '+' : ''
  const tone: NoteRaceSignalTone = rounded > 0 ? 'positive' : rounded < 0 ? 'negative' : 'neutral'
  const suffix = unit ? unit : ''
  return {
    label: `${prefix} ${sign}${rounded}${suffix}`,
    tone
  }
}

function toStableLabel(values: number[]): '高' | '中' | '低' {
  if (values.length <= 1) return '中'
  const mean = values.reduce((sum, item) => sum + item, 0) / values.length
  if (mean <= 0) return '低'
  const variance =
    values.reduce((sum, item) => sum + (item - mean) * (item - mean), 0) / values.length
  const cv = Math.sqrt(variance) / mean
  if (cv <= 0.25) return '高'
  if (cv <= 0.6) return '中'
  return '低'
}

function normalizeMinMax(values: number[]): (value: number) => number {
  const valid = values.filter((item) => Number.isFinite(item))
  if (valid.length === 0) {
    return () => 50
  }
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  if (max - min <= 1e-9) {
    return () => 50
  }
  return (value: number) => clamp(((value - min) / (max - min)) * 100, 0, 100)
}

function inferTag(entry: IntermediateRank, score: number): NoteRaceTag {
  if (entry.ageDays > 30 && entry.dRead >= 20) return '长尾复活'
  if (entry.refundRatePayTime >= 0.3) return '风险'
  if (entry.trendDelta >= 3) return '起飞'
  if (entry.trendDelta <= -2.5) {
    if (score <= 45 || entry.dOrder < 0) return '风险'
    return '掉速'
  }
  return '维稳'
}

function inferStage(row: RawCommerceRow): { stageLabel: string; stageIndex: 1 | 2 | 3 | 4 | 5 } {
  if (row.payOrders >= 2 || row.payAmount >= 100) {
    return { stageLabel: 'S4 成交', stageIndex: 4 }
  }
  if (row.clickCount >= 10 || row.payOrders >= 1) {
    return { stageLabel: 'S3 成交', stageIndex: 3 }
  }
  if (row.readCount >= 200 || row.clickCount >= 3) {
    return { stageLabel: 'S2 导流', stageIndex: 2 }
  }
  return { stageLabel: 'S1 起量', stageIndex: 1 }
}

async function createExcelWorkbook(): Promise<ExcelWorkbook> {
  const mod = await import('exceljs')
  const workbookCtor =
    (mod as { Workbook?: new () => unknown }).Workbook ??
    (mod as { default?: { Workbook?: new () => unknown } }).default?.Workbook
  if (!workbookCtor) throw new Error('ExcelJS.Workbook 构造器不可用')
  return new workbookCtor() as ExcelWorkbook
}

function buildHeaderIndex(values: unknown[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 1; i < values.length; i += 1) {
    const key = normalizeText(normalizeCellValue(values[i]))
    if (!key) continue
    map.set(key, i)
  }
  return map
}

function pickColumn(map: Map<string, number>, aliases: string[]): number {
  for (const alias of aliases) {
    const idx = map.get(alias)
    if (typeof idx === 'number' && idx > 0) return idx
  }
  return -1
}

function cell(row: { getCell: (index: number) => { value: unknown } }, index: number): unknown {
  if (index <= 0) return null
  return row.getCell(index).value
}

function detectImportKindFromFileName(filePath: string): NoteRaceImportKind | null {
  const sourceFile = basename(filePath)
  if (sourceFile.includes('商品笔记数据')) return 'commerce'
  if (sourceFile.includes('笔记列表明细') || sourceFile.includes('笔记列表')) return 'content'
  return null
}

function countHeaderMatches(map: Map<string, number>, headers: string[]): number {
  let matches = 0
  for (const header of headers) {
    if (map.has(header)) {
      matches += 1
    }
  }
  return matches
}

type SnapshotScope = 'daily' | 'range' | 'unknown'
type TrendComparabilityReason =
  | 'ok'
  | 'missing_previous_snapshot'
  | 'snapshot_gap'
  | 'missing_commerce_source'
  | 'non_daily_scope'

type SnapshotImportProfile = {
  snapshotDate: string
  commerceCount: number
  contentCount: number
  commerceScope: SnapshotScope
  contentScope: SnapshotScope
  mergedScope: SnapshotScope
}

type TrendComparability = {
  comparable: boolean
  previousSnapshotDate: string | null
  reason: TrendComparabilityReason
}

const NOTE_RACE_BATCH_RESTORE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

function inferSnapshotScopeFromSourceFile(sourceFile: string): SnapshotScope {
  const normalized = normalizeText(sourceFile)
  if (!normalized) return 'unknown'
  if (/(近\s*1\s*日|前\s*1\s*日|昨日|昨天|t-?1)/i.test(normalized)) return 'daily'
  if (/(近\s*(?:[2-9]|[1-9]\d)\s*日|区间|范围|自定义)/i.test(normalized)) return 'range'

  const fullDates = Array.from(normalized.matchAll(/(20\d{2})[-_.年](\d{1,2})[-_.月](\d{1,2})/g))
    .map((item) => normalizeDateParts(Number(item[1]), Number(item[2]), Number(item[3])))
    .filter((item): item is string => Boolean(item))
  if (fullDates.length >= 2) {
    const distinct = new Set(fullDates)
    return distinct.size === 1 ? 'daily' : 'range'
  }
  if (fullDates.length === 1 && /(~|～|至|到|_to_|-to-)/i.test(normalized)) return 'range'
  if (fullDates.length === 1) return 'daily'

  if (/(~|～|至|到|_to_|-to-)/i.test(normalized)) {
    const shortRange = normalized.match(/(^|[^0-9])(\d{1,2})\s*[-~～]\s*(\d{1,2})([^0-9]|$)/)
    if (shortRange?.[2] && shortRange[3] && shortRange[2] === shortRange[3]) return 'daily'
    return 'range'
  }

  return 'unknown'
}

function mergeSnapshotScopes(scopes: SnapshotScope[]): SnapshotScope {
  if (scopes.length === 0) return 'unknown'
  if (scopes.includes('range')) return 'range'
  if (scopes.every((scope) => scope === 'daily')) return 'daily'
  return 'unknown'
}

function parseYmdToUtcMs(value: string): number | null {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched?.[1] || !matched[2] || !matched[3]) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return Date.UTC(year, month - 1, day)
}

function isNextSnapshotDay(previousDate: string, currentDate: string): boolean {
  const previousMs = parseYmdToUtcMs(previousDate)
  const currentMs = parseYmdToUtcMs(currentDate)
  if (previousMs == null || currentMs == null) return false
  return currentMs - previousMs === 24 * 60 * 60 * 1000
}

function describeTrendComparabilityReason(
  reason: TrendComparabilityReason,
  previousSnapshotDate: string | null
): string {
  if (reason === 'missing_previous_snapshot') return '缺少上一日可比快照，已禁用增量趋势计算。'
  if (reason === 'snapshot_gap') {
    return `与上一快照不连续（上一快照：${previousSnapshotDate ?? '-'}），已禁用增量趋势计算。`
  }
  if (reason === 'missing_commerce_source') {
    return '当前或上一快照缺少商品侧导入，已禁用增量趋势计算。'
  }
  if (reason === 'non_daily_scope') {
    return '当前或上一快照商品侧不是“近1日”同口径，已禁用增量趋势计算。'
  }
  return '快照口径不可比，已禁用增量趋势计算。'
}

export class NoteRaceService {
  private sqlite: SqliteService

  constructor(sqlite?: SqliteService) {
    this.sqlite = sqlite ?? SqliteService.getInstance()
  }

  ensureSchema(): void {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    if (!db) return
    db.exec(`
      CREATE TABLE IF NOT EXISTS note_race_raw_commerce (
        snapshot_date TEXT NOT NULL,
        note_key TEXT NOT NULL,
        note_id TEXT,
        title TEXT NOT NULL,
        account_name TEXT,
        account_xhs_id TEXT,
        note_created_at INTEGER,
        note_type TEXT,
        product_id TEXT,
        product_name TEXT,
        read_count REAL NOT NULL DEFAULT 0,
        like_count REAL NOT NULL DEFAULT 0,
        collect_count REAL NOT NULL DEFAULT 0,
        comment_count REAL NOT NULL DEFAULT 0,
        share_count REAL NOT NULL DEFAULT 0,
        follow_count REAL NOT NULL DEFAULT 0,
        danmu_count REAL NOT NULL DEFAULT 0,
        avg_watch_seconds REAL NOT NULL DEFAULT 0,
        finish_rate_pv REAL NOT NULL DEFAULT 0,
        click_count REAL NOT NULL DEFAULT 0,
        click_people REAL NOT NULL DEFAULT 0,
        click_rate_pv REAL NOT NULL DEFAULT 0,
        pay_orders REAL NOT NULL DEFAULT 0,
        pay_users REAL NOT NULL DEFAULT 0,
        pay_amount REAL NOT NULL DEFAULT 0,
        pay_rate_pv REAL NOT NULL DEFAULT 0,
        pay_rate_uv REAL NOT NULL DEFAULT 0,
        add_cart_count REAL NOT NULL DEFAULT 0,
        refund_amount_pay_time REAL NOT NULL DEFAULT 0,
        refund_rate_pay_time REAL NOT NULL DEFAULT 0,
        source_file TEXT,
        imported_at INTEGER NOT NULL,
        raw_json TEXT,
        PRIMARY KEY (snapshot_date, note_key)
      );
      CREATE INDEX IF NOT EXISTS idx_note_race_commerce_snapshot ON note_race_raw_commerce (snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_note_race_commerce_title ON note_race_raw_commerce (title);
      CREATE INDEX IF NOT EXISTS idx_note_race_commerce_account ON note_race_raw_commerce (account_name);

      CREATE TABLE IF NOT EXISTS note_race_raw_content (
        snapshot_date TEXT NOT NULL,
        row_id TEXT NOT NULL,
        title TEXT NOT NULL,
        first_published_at INTEGER,
        note_type TEXT,
        exposure REAL NOT NULL DEFAULT 0,
        view_count REAL NOT NULL DEFAULT 0,
        cover_click_rate REAL NOT NULL DEFAULT 0,
        like_count REAL NOT NULL DEFAULT 0,
        comment_count REAL NOT NULL DEFAULT 0,
        collect_count REAL NOT NULL DEFAULT 0,
        follow_gain_count REAL NOT NULL DEFAULT 0,
        share_count REAL NOT NULL DEFAULT 0,
        avg_watch_seconds REAL NOT NULL DEFAULT 0,
        danmu_count REAL NOT NULL DEFAULT 0,
        source_file TEXT,
        imported_at INTEGER NOT NULL,
        raw_json TEXT,
        PRIMARY KEY (snapshot_date, row_id)
      );
      CREATE INDEX IF NOT EXISTS idx_note_race_content_snapshot ON note_race_raw_content (snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_note_race_content_title ON note_race_raw_content (title);

      CREATE TABLE IF NOT EXISTS note_race_deleted_commerce (
        snapshot_date TEXT NOT NULL,
        note_key TEXT NOT NULL,
        note_id TEXT,
        title TEXT NOT NULL,
        account_name TEXT,
        account_xhs_id TEXT,
        note_created_at INTEGER,
        note_type TEXT,
        product_id TEXT,
        product_name TEXT,
        read_count REAL NOT NULL DEFAULT 0,
        like_count REAL NOT NULL DEFAULT 0,
        collect_count REAL NOT NULL DEFAULT 0,
        comment_count REAL NOT NULL DEFAULT 0,
        share_count REAL NOT NULL DEFAULT 0,
        follow_count REAL NOT NULL DEFAULT 0,
        danmu_count REAL NOT NULL DEFAULT 0,
        avg_watch_seconds REAL NOT NULL DEFAULT 0,
        finish_rate_pv REAL NOT NULL DEFAULT 0,
        click_count REAL NOT NULL DEFAULT 0,
        click_people REAL NOT NULL DEFAULT 0,
        click_rate_pv REAL NOT NULL DEFAULT 0,
        pay_orders REAL NOT NULL DEFAULT 0,
        pay_users REAL NOT NULL DEFAULT 0,
        pay_amount REAL NOT NULL DEFAULT 0,
        pay_rate_pv REAL NOT NULL DEFAULT 0,
        pay_rate_uv REAL NOT NULL DEFAULT 0,
        add_cart_count REAL NOT NULL DEFAULT 0,
        refund_amount_pay_time REAL NOT NULL DEFAULT 0,
        refund_rate_pay_time REAL NOT NULL DEFAULT 0,
        source_file TEXT,
        imported_at INTEGER NOT NULL,
        raw_json TEXT,
        deleted_at INTEGER NOT NULL,
        delete_reason TEXT NOT NULL DEFAULT 'manual',
        PRIMARY KEY (snapshot_date, note_key, imported_at)
      );
      CREATE INDEX IF NOT EXISTS idx_note_race_deleted_commerce_snapshot ON note_race_deleted_commerce (snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_note_race_deleted_commerce_batch ON note_race_deleted_commerce (snapshot_date, imported_at);
      CREATE INDEX IF NOT EXISTS idx_note_race_deleted_commerce_deleted_at ON note_race_deleted_commerce (deleted_at);

      CREATE TABLE IF NOT EXISTS note_race_deleted_content (
        snapshot_date TEXT NOT NULL,
        row_id TEXT NOT NULL,
        title TEXT NOT NULL,
        first_published_at INTEGER,
        note_type TEXT,
        exposure REAL NOT NULL DEFAULT 0,
        view_count REAL NOT NULL DEFAULT 0,
        cover_click_rate REAL NOT NULL DEFAULT 0,
        like_count REAL NOT NULL DEFAULT 0,
        comment_count REAL NOT NULL DEFAULT 0,
        collect_count REAL NOT NULL DEFAULT 0,
        follow_gain_count REAL NOT NULL DEFAULT 0,
        share_count REAL NOT NULL DEFAULT 0,
        avg_watch_seconds REAL NOT NULL DEFAULT 0,
        danmu_count REAL NOT NULL DEFAULT 0,
        source_file TEXT,
        imported_at INTEGER NOT NULL,
        raw_json TEXT,
        deleted_at INTEGER NOT NULL,
        delete_reason TEXT NOT NULL DEFAULT 'manual',
        PRIMARY KEY (snapshot_date, row_id, imported_at)
      );
      CREATE INDEX IF NOT EXISTS idx_note_race_deleted_content_snapshot ON note_race_deleted_content (snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_note_race_deleted_content_batch ON note_race_deleted_content (snapshot_date, imported_at);
      CREATE INDEX IF NOT EXISTS idx_note_race_deleted_content_deleted_at ON note_race_deleted_content (deleted_at);

      CREATE TABLE IF NOT EXISTS note_race_match_map (
        snapshot_date TEXT NOT NULL,
        note_key TEXT NOT NULL,
        content_row_id TEXT,
        confidence REAL NOT NULL DEFAULT 0,
        match_rule TEXT NOT NULL DEFAULT 'unmatched',
        matched_at INTEGER NOT NULL,
        PRIMARY KEY (snapshot_date, note_key)
      );
      CREATE INDEX IF NOT EXISTS idx_note_race_match_snapshot ON note_race_match_map (snapshot_date);

      CREATE TABLE IF NOT EXISTS note_race_daily_rank (
        snapshot_date TEXT NOT NULL,
        note_key TEXT NOT NULL,
        rank_position INTEGER NOT NULL,
        tag TEXT NOT NULL,
        stage_label TEXT NOT NULL,
        stage_index INTEGER NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        trend_delta REAL NOT NULL DEFAULT 0,
        trend_hint_json TEXT NOT NULL DEFAULT '[]',
        content_signals_json TEXT NOT NULL DEFAULT '[]',
        commerce_signals_json TEXT NOT NULL DEFAULT '[]',
        account_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        note_type TEXT NOT NULL DEFAULT '',
        age_days INTEGER NOT NULL DEFAULT 0,
        product_name TEXT NOT NULL DEFAULT '',
        d_read REAL NOT NULL DEFAULT 0,
        d_click REAL NOT NULL DEFAULT 0,
        d_order REAL NOT NULL DEFAULT 0,
        acceleration REAL NOT NULL DEFAULT 1,
        stability_label TEXT NOT NULL DEFAULT '中',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (snapshot_date, note_key)
      );
      CREATE INDEX IF NOT EXISTS idx_note_race_rank_snapshot ON note_race_daily_rank (snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_note_race_rank_snapshot_rank ON note_race_daily_rank (snapshot_date, rank_position);
      CREATE INDEX IF NOT EXISTS idx_note_race_rank_snapshot_score ON note_race_daily_rank (snapshot_date, score DESC);
    `)
  }

  private getSnapshotImportProfile(db: DbConnection, snapshotDate: string): SnapshotImportProfile {
    const commerceCount = Number(
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM note_race_raw_commerce WHERE snapshot_date = ?`)
        .get(snapshotDate)?.cnt ?? 0
    )
    const contentCount = Number(
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM note_race_raw_content WHERE snapshot_date = ?`)
        .get(snapshotDate)?.cnt ?? 0
    )

    const commerceFiles = db
      .prepare(
        `
        SELECT DISTINCT source_file AS sourceFile
        FROM note_race_raw_commerce
        WHERE snapshot_date = ? AND source_file IS NOT NULL AND TRIM(source_file) <> ''
        `
      )
      .all(snapshotDate)
      .map((row) => normalizeText(row.sourceFile))
      .filter(Boolean)
    const contentFiles = db
      .prepare(
        `
        SELECT DISTINCT source_file AS sourceFile
        FROM note_race_raw_content
        WHERE snapshot_date = ? AND source_file IS NOT NULL AND TRIM(source_file) <> ''
        `
      )
      .all(snapshotDate)
      .map((row) => normalizeText(row.sourceFile))
      .filter(Boolean)

    const commerceScope = mergeSnapshotScopes(commerceFiles.map(inferSnapshotScopeFromSourceFile))
    let contentScope = mergeSnapshotScopes(contentFiles.map(inferSnapshotScopeFromSourceFile))
    const contentTimeRange = db
      .prepare(
        `
        SELECT
          MIN(first_published_at) AS minTs,
          MAX(first_published_at) AS maxTs
        FROM note_race_raw_content
        WHERE snapshot_date = ?
        `
      )
      .get(snapshotDate)
    const minContentTs = Number(contentTimeRange?.minTs ?? 0)
    const maxContentTs = Number(contentTimeRange?.maxTs ?? 0)
    if (
      contentCount > 0 &&
      Number.isFinite(minContentTs) &&
      Number.isFinite(maxContentTs) &&
      minContentTs > 0 &&
      maxContentTs >= minContentTs
    ) {
      const spanDays = (maxContentTs - minContentTs) / (24 * 60 * 60 * 1000)
      if (spanDays > 2) {
        contentScope = 'range'
      } else if (contentScope === 'unknown') {
        contentScope = 'daily'
      }
    }
    const mergedScope = mergeSnapshotScopes([commerceScope, contentScope])

    return {
      snapshotDate,
      commerceCount,
      contentCount,
      commerceScope,
      contentScope,
      mergedScope
    }
  }

  private getPreviousSnapshotDate(db: DbConnection, snapshotDate: string): string | null {
    const value = normalizeText(
      db
        .prepare(
          `SELECT MAX(snapshot_date) AS snapshotDate FROM note_race_raw_commerce WHERE snapshot_date < ?`
        )
        .get(snapshotDate)?.snapshotDate
    )
    return value || null
  }

  private evaluateTrendComparability(db: DbConnection, snapshotDate: string): TrendComparability {
    const previousSnapshotDate = this.getPreviousSnapshotDate(db, snapshotDate)
    if (!previousSnapshotDate) {
      return {
        comparable: false,
        previousSnapshotDate: null,
        reason: 'missing_previous_snapshot'
      }
    }
    if (!isNextSnapshotDay(previousSnapshotDate, snapshotDate)) {
      return {
        comparable: false,
        previousSnapshotDate,
        reason: 'snapshot_gap'
      }
    }

    const currentProfile = this.getSnapshotImportProfile(db, snapshotDate)
    const previousProfile = this.getSnapshotImportProfile(db, previousSnapshotDate)
    const hasCommerceSource = currentProfile.commerceCount > 0 && previousProfile.commerceCount > 0
    if (!hasCommerceSource) {
      return {
        comparable: false,
        previousSnapshotDate,
        reason: 'missing_commerce_source'
      }
    }

    if (currentProfile.commerceScope !== 'daily' || previousProfile.commerceScope !== 'daily') {
      return {
        comparable: false,
        previousSnapshotDate,
        reason: 'non_daily_scope'
      }
    }

    return {
      comparable: true,
      previousSnapshotDate,
      reason: 'ok'
    }
  }

  private async detectExcelImportKind(
    filePath: string
  ): Promise<{ kind: NoteRaceImportKind | null; detectedBy: NoteRaceImportDetectedBy | null }> {
    const workbook = await createExcelWorkbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) {
      const byName = detectImportKindFromFileName(filePath)
      return { kind: byName, detectedBy: byName ? 'filename' : null }
    }

    const commerceHeaders = [
      '笔记ID',
      '作者昵称',
      '作者xhs_ID',
      '关联商品名称',
      '笔记支付金额',
      '笔记支付订单数',
      '笔记商品点击次数',
      '笔记阅读数'
    ]
    const contentHeaders = [
      '首次发布时间',
      '体裁',
      '曝光',
      '观看量',
      '封面点击率',
      '涨粉',
      '人均观看时长'
    ]

    const firstRowMap = buildHeaderIndex(sheet.getRow(1).values as unknown[])
    const secondRowMap = buildHeaderIndex(sheet.getRow(2).values as unknown[])

    const commerceScore = Math.max(
      countHeaderMatches(firstRowMap, commerceHeaders),
      countHeaderMatches(secondRowMap, commerceHeaders)
    )
    const contentScore = Math.max(
      countHeaderMatches(firstRowMap, contentHeaders),
      countHeaderMatches(secondRowMap, contentHeaders)
    )

    if (commerceScore >= 2 || contentScore >= 2) {
      if (commerceScore > contentScore) return { kind: 'commerce', detectedBy: 'header' }
      if (contentScore > commerceScore) return { kind: 'content', detectedBy: 'header' }
      const byName = detectImportKindFromFileName(filePath)
      if (byName) return { kind: byName, detectedBy: 'filename' }
      return { kind: 'commerce', detectedBy: 'header' }
    }

    const byName = detectImportKindFromFileName(filePath)
    if (byName) return { kind: byName, detectedBy: 'filename' }
    return { kind: null, detectedBy: null }
  }

  async importAutoExcel(filePath: string): Promise<NoteRaceAutoImportResult> {
    const detected = await this.detectExcelImportKind(filePath)
    if (!detected.kind) {
      throw new Error(
        '无法识别 Excel 类型。请导入“商品笔记数据”或“笔记列表明细表”，并确保表头完整。'
      )
    }
    const imported =
      detected.kind === 'commerce'
        ? await this.importCommerceExcel(filePath)
        : await this.importContentExcel(filePath)
    return {
      ...imported,
      kind: detected.kind,
      detectedBy: detected.detectedBy ?? 'filename'
    }
  }

  async importCommerceExcel(filePath: string): Promise<NoteRaceImportResult> {
    const db = this.sqlite.connection as DbConnection
    this.ensureSchema()
    const workbook = await createExcelWorkbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('未找到可导入工作表')

    const snapshotDate = parseSnapshotDateFromName(filePath) ?? formatDateYmd(Date.now())
    const sourceFile = basename(filePath)
    const now = Date.now()
    const headerMap = buildHeaderIndex(sheet.getRow(1).values as unknown[])

    const cols = {
      title: pickColumn(headerMap, ['笔记标题']),
      noteId: pickColumn(headerMap, ['笔记ID']),
      accountName: pickColumn(headerMap, ['作者昵称']),
      accountXhsId: pickColumn(headerMap, ['作者xhs_ID']),
      createdAt: pickColumn(headerMap, ['笔记创建时间']),
      noteType: pickColumn(headerMap, ['笔记类型']),
      productName: pickColumn(headerMap, ['关联商品名称']),
      productId: pickColumn(headerMap, ['关联商品ID']),
      payAmount: pickColumn(headerMap, ['笔记支付金额']),
      payOrders: pickColumn(headerMap, ['笔记支付订单数']),
      clickCount: pickColumn(headerMap, ['笔记商品点击次数']),
      clickPeople: pickColumn(headerMap, ['笔记商品点击人数']),
      clickRatePv: pickColumn(headerMap, ['笔记商品点击率（PV）']),
      payUsers: pickColumn(headerMap, ['笔记支付人数']),
      payRatePv: pickColumn(headerMap, ['笔记支付转化率（PV）']),
      payRateUv: pickColumn(headerMap, ['笔记支付转化率（UV）']),
      addCartCount: pickColumn(headerMap, ['笔记加购件数']),
      readCount: pickColumn(headerMap, ['笔记阅读数']),
      likeCount: pickColumn(headerMap, ['点赞次数']),
      collectCount: pickColumn(headerMap, ['收藏次数']),
      commentCount: pickColumn(headerMap, ['评论次数']),
      shareCount: pickColumn(headerMap, ['分享次数']),
      followCount: pickColumn(headerMap, ['笔记点击关注次数']),
      danmuCount: pickColumn(headerMap, ['弹幕次数']),
      avgWatchSeconds: pickColumn(headerMap, ['平均阅读时长（观播时长）']),
      finishRatePv: pickColumn(headerMap, ['完播率（PV）']),
      refundAmountPayTime: pickColumn(headerMap, ['笔记退款金额（支付时间）']),
      refundRatePayTime: pickColumn(headerMap, ['笔记退款率（支付时间）'])
    }

    const upsert = db.prepare(`
      INSERT INTO note_race_raw_commerce (
        snapshot_date, note_key, note_id, title, account_name, account_xhs_id, note_created_at, note_type, product_id, product_name,
        read_count, like_count, collect_count, comment_count, share_count, follow_count, danmu_count, avg_watch_seconds, finish_rate_pv,
        click_count, click_people, click_rate_pv, pay_orders, pay_users, pay_amount, pay_rate_pv, pay_rate_uv, add_cart_count,
        refund_amount_pay_time, refund_rate_pay_time, source_file, imported_at, raw_json
      ) VALUES (
        @snapshotDate, @noteKey, @noteId, @title, @accountName, @accountXhsId, @noteCreatedAt, @noteType, @productId, @productName,
        @readCount, @likeCount, @collectCount, @commentCount, @shareCount, @followCount, @danmuCount, @avgWatchSeconds, @finishRatePv,
        @clickCount, @clickPeople, @clickRatePv, @payOrders, @payUsers, @payAmount, @payRatePv, @payRateUv, @addCartCount,
        @refundAmountPayTime, @refundRatePayTime, @sourceFile, @importedAt, @rawJson
      )
      ON CONFLICT(snapshot_date, note_key) DO UPDATE SET
        note_id = excluded.note_id,
        title = excluded.title,
        account_name = excluded.account_name,
        account_xhs_id = excluded.account_xhs_id,
        note_created_at = excluded.note_created_at,
        note_type = excluded.note_type,
        product_id = excluded.product_id,
        product_name = excluded.product_name,
        read_count = excluded.read_count,
        like_count = excluded.like_count,
        collect_count = excluded.collect_count,
        comment_count = excluded.comment_count,
        share_count = excluded.share_count,
        follow_count = excluded.follow_count,
        danmu_count = excluded.danmu_count,
        avg_watch_seconds = excluded.avg_watch_seconds,
        finish_rate_pv = excluded.finish_rate_pv,
        click_count = excluded.click_count,
        click_people = excluded.click_people,
        click_rate_pv = excluded.click_rate_pv,
        pay_orders = excluded.pay_orders,
        pay_users = excluded.pay_users,
        pay_amount = excluded.pay_amount,
        pay_rate_pv = excluded.pay_rate_pv,
        pay_rate_uv = excluded.pay_rate_uv,
        add_cart_count = excluded.add_cart_count,
        refund_amount_pay_time = excluded.refund_amount_pay_time,
        refund_rate_pay_time = excluded.refund_rate_pay_time,
        source_file = excluded.source_file,
        imported_at = excluded.imported_at,
        raw_json = excluded.raw_json
    `)

    const tx = db.transaction(() => {
      let importedRows = 0
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const title = toText(cell(row, cols.title))
        const noteId = toText(cell(row, cols.noteId)) || null
        if (!title && !noteId) continue

        const noteCreatedAt = parseDateValue(cell(row, cols.createdAt))
        const noteKey = createNoteKey(noteId, title || noteId || '', noteCreatedAt)
        const noteTypeRaw = toText(cell(row, cols.noteType))
        const noteType = noteTypeRaw === '视频' || noteTypeRaw === '图文' ? noteTypeRaw : null

        const record: RawCommerceRow = {
          snapshotDate,
          noteKey,
          noteId,
          title: title || noteId || '',
          accountName: toText(cell(row, cols.accountName)) || null,
          accountXhsId: toText(cell(row, cols.accountXhsId)) || null,
          noteCreatedAt,
          noteType,
          productId: toText(cell(row, cols.productId)) || null,
          productName: toText(cell(row, cols.productName)) || null,
          readCount: toNumber(cell(row, cols.readCount)),
          likeCount: toNumber(cell(row, cols.likeCount)),
          collectCount: toNumber(cell(row, cols.collectCount)),
          commentCount: toNumber(cell(row, cols.commentCount)),
          shareCount: toNumber(cell(row, cols.shareCount)),
          followCount: toNumber(cell(row, cols.followCount)),
          danmuCount: toNumber(cell(row, cols.danmuCount)),
          avgWatchSeconds: toNumber(cell(row, cols.avgWatchSeconds)),
          finishRatePv: toRate(cell(row, cols.finishRatePv)),
          clickCount: toNumber(cell(row, cols.clickCount)),
          clickPeople: toNumber(cell(row, cols.clickPeople)),
          clickRatePv: toRate(cell(row, cols.clickRatePv)),
          payOrders: toNumber(cell(row, cols.payOrders)),
          payUsers: toNumber(cell(row, cols.payUsers)),
          payAmount: toNumber(cell(row, cols.payAmount)),
          payRatePv: toRate(cell(row, cols.payRatePv)),
          payRateUv: toRate(cell(row, cols.payRateUv)),
          addCartCount: toNumber(cell(row, cols.addCartCount)),
          refundAmountPayTime: toNumber(cell(row, cols.refundAmountPayTime)),
          refundRatePayTime: toRate(cell(row, cols.refundRatePayTime))
        }

        upsert.run({
          ...record,
          sourceFile,
          importedAt: now,
          rawJson: JSON.stringify({ rowNumber, sourceFile })
        })
        importedRows += 1
      }
      return importedRows
    })

    const importedRows = tx() as number
    const { matchedRows, totalRows } = this.rebuildSnapshot(snapshotDate)
    return {
      snapshotDate,
      sourceFile,
      importedRows,
      matchedRows,
      totalRows
    }
  }

  async importContentExcel(filePath: string): Promise<NoteRaceImportResult> {
    const db = this.sqlite.connection as DbConnection
    this.ensureSchema()
    const workbook = await createExcelWorkbook()
    await workbook.xlsx.readFile(filePath)
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('未找到可导入工作表')

    const snapshotDate = parseSnapshotDateFromName(filePath) ?? formatDateYmd(Date.now())
    const sourceFile = basename(filePath)
    const now = Date.now()
    const firstRowMap = buildHeaderIndex(sheet.getRow(1).values as unknown[])
    const headerRowIndex = firstRowMap.has('笔记标题') ? 1 : 2
    const headerMap = buildHeaderIndex(sheet.getRow(headerRowIndex).values as unknown[])

    const cols = {
      title: pickColumn(headerMap, ['笔记标题']),
      firstPublishedAt: pickColumn(headerMap, ['首次发布时间']),
      noteType: pickColumn(headerMap, ['体裁']),
      exposure: pickColumn(headerMap, ['曝光']),
      viewCount: pickColumn(headerMap, ['观看量']),
      coverClickRate: pickColumn(headerMap, ['封面点击率']),
      likeCount: pickColumn(headerMap, ['点赞']),
      commentCount: pickColumn(headerMap, ['评论']),
      collectCount: pickColumn(headerMap, ['收藏']),
      followGainCount: pickColumn(headerMap, ['涨粉']),
      shareCount: pickColumn(headerMap, ['分享']),
      avgWatchSeconds: pickColumn(headerMap, ['人均观看时长']),
      danmuCount: pickColumn(headerMap, ['弹幕'])
    }

    const upsert = db.prepare(`
      INSERT INTO note_race_raw_content (
        snapshot_date, row_id, title, first_published_at, note_type, exposure, view_count, cover_click_rate,
        like_count, comment_count, collect_count, follow_gain_count, share_count, avg_watch_seconds, danmu_count,
        source_file, imported_at, raw_json
      ) VALUES (
        @snapshotDate, @rowId, @title, @firstPublishedAt, @noteType, @exposure, @viewCount, @coverClickRate,
        @likeCount, @commentCount, @collectCount, @followGainCount, @shareCount, @avgWatchSeconds, @danmuCount,
        @sourceFile, @importedAt, @rawJson
      )
      ON CONFLICT(snapshot_date, row_id) DO UPDATE SET
        title = excluded.title,
        first_published_at = excluded.first_published_at,
        note_type = excluded.note_type,
        exposure = excluded.exposure,
        view_count = excluded.view_count,
        cover_click_rate = excluded.cover_click_rate,
        like_count = excluded.like_count,
        comment_count = excluded.comment_count,
        collect_count = excluded.collect_count,
        follow_gain_count = excluded.follow_gain_count,
        share_count = excluded.share_count,
        avg_watch_seconds = excluded.avg_watch_seconds,
        danmu_count = excluded.danmu_count,
        source_file = excluded.source_file,
        imported_at = excluded.imported_at,
        raw_json = excluded.raw_json
    `)

    const tx = db.transaction(() => {
      let importedRows = 0
      for (let rowNumber = headerRowIndex + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const title = toText(cell(row, cols.title))
        if (!title) continue

        const firstPublishedAt = parseDateValue(cell(row, cols.firstPublishedAt))
        const rowId = createContentRowId(title, firstPublishedAt)
        const noteTypeRaw = toText(cell(row, cols.noteType))
        const noteType = noteTypeRaw === '视频' || noteTypeRaw === '图文' ? noteTypeRaw : null

        const record: RawContentRow = {
          snapshotDate,
          rowId,
          title,
          firstPublishedAt,
          noteType,
          exposure: toNumber(cell(row, cols.exposure)),
          viewCount: toNumber(cell(row, cols.viewCount)),
          coverClickRate: toRate(cell(row, cols.coverClickRate)),
          likeCount: toNumber(cell(row, cols.likeCount)),
          commentCount: toNumber(cell(row, cols.commentCount)),
          collectCount: toNumber(cell(row, cols.collectCount)),
          followGainCount: toNumber(cell(row, cols.followGainCount)),
          shareCount: toNumber(cell(row, cols.shareCount)),
          avgWatchSeconds: toNumber(cell(row, cols.avgWatchSeconds)),
          danmuCount: toNumber(cell(row, cols.danmuCount))
        }

        upsert.run({
          ...record,
          sourceFile,
          importedAt: now,
          rawJson: JSON.stringify({ rowNumber, sourceFile })
        })
        importedRows += 1
      }
      return importedRows
    })

    const importedRows = tx() as number
    const { matchedRows, totalRows } = this.rebuildSnapshot(snapshotDate)
    return {
      snapshotDate,
      sourceFile,
      importedRows,
      matchedRows,
      totalRows
    }
  }

  private extractChanges(result: unknown): number {
    const value = (result as { changes?: unknown } | null)?.changes
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.floor(parsed))
  }

  private recomputeSnapshotsFrom(snapshotDate: string): number {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    const date = normalizeText(snapshotDate)
    if (!db || !date) return 0

    const futureDates = db
      .prepare(
        `
        SELECT DISTINCT snapshot_date AS snapshotDate
        FROM note_race_raw_commerce
        WHERE snapshot_date >= ?
        ORDER BY snapshot_date ASC
        `
      )
      .all(date)
      .map((row) => normalizeText(row.snapshotDate))
      .filter(Boolean)

    const queue = [date, ...futureDates]
    const uniqueDates = Array.from(new Set(queue))
    let recomputed = 0
    for (const currentDate of uniqueDates) {
      try {
        this.rebuildSnapshot(currentDate)
        recomputed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[NoteRace] rebuild snapshot failed: ${currentDate} ${message}`)
      }
    }
    return recomputed
  }

  private refreshTrendReadySnapshots(db: DbConnection, dates: string[]): void {
    const countBlockedStmt = db.prepare(
      `
      SELECT COUNT(*) AS cnt
      FROM note_race_daily_rank
      WHERE snapshot_date = ? AND trend_hint_json LIKE '%样本不足或口径不可比%'
      `
    )
    for (const snapshotDate of dates) {
      const comparability = this.evaluateTrendComparability(db, snapshotDate)
      if (!comparability.comparable) continue
      const blockedCount = Number(countBlockedStmt.get(snapshotDate)?.cnt ?? 0)
      if (!Number.isFinite(blockedCount) || blockedCount <= 0) continue
      try {
        this.rebuildSnapshot(snapshotDate)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[NoteRace] refresh trend-ready snapshot failed: ${snapshotDate} ${message}`)
      }
    }
  }

  getMeta(): NoteRaceMeta {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    if (!db) {
      return {
        latestDate: null,
        availableDates: [],
        totalNotes: 0,
        matchedNotes: 0,
        matchRate: 0,
        trendReadyDates: []
      }
    }
    const dates = db
      .prepare(
        `SELECT DISTINCT snapshot_date AS snapshotDate FROM note_race_daily_rank ORDER BY snapshot_date DESC`
      )
      .all()
      .map((row) => String(row.snapshotDate ?? '').trim())
      .filter(Boolean)
    const latestDate = dates[0] ?? null
    if (!latestDate) {
      return {
        latestDate: null,
        availableDates: [],
        totalNotes: 0,
        matchedNotes: 0,
        matchRate: 0,
        trendReadyDates: []
      }
    }
    this.refreshTrendReadySnapshots(db, [...dates].reverse())
    const total = Number(
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM note_race_daily_rank WHERE snapshot_date = ?`)
        .get(latestDate)?.cnt ?? 0
    )
    const matched = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM note_race_match_map WHERE snapshot_date = ? AND confidence > 0`
        )
        .get(latestDate)?.cnt ?? 0
    )
    const trendReadyDates = dates.filter(
      (date) => this.evaluateTrendComparability(db, date).comparable
    )
    return {
      latestDate,
      availableDates: dates,
      totalNotes: total,
      matchedNotes: matched,
      matchRate: total > 0 ? matched / total : 0,
      trendReadyDates
    }
  }

  deleteSnapshotDate(snapshotDate: string): NoteRaceDeleteSnapshotResult {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    const date = normalizeText(snapshotDate)
    if (!date) {
      throw new Error('快照日期不能为空')
    }
    if (!db) {
      return {
        snapshotDate: date,
        deletedCommerceRows: 0,
        deletedContentRows: 0,
        deletedMatchRows: 0,
        deletedRankRows: 0,
        recomputedSnapshots: 0
      }
    }

    const tx = db.transaction(() => {
      const deletedMatchRows = this.extractChanges(
        db.prepare(`DELETE FROM note_race_match_map WHERE snapshot_date = ?`).run(date)
      )
      const deletedRankRows = this.extractChanges(
        db.prepare(`DELETE FROM note_race_daily_rank WHERE snapshot_date = ?`).run(date)
      )
      const deletedCommerceRows = this.extractChanges(
        db.prepare(`DELETE FROM note_race_raw_commerce WHERE snapshot_date = ?`).run(date)
      )
      const deletedContentRows = this.extractChanges(
        db.prepare(`DELETE FROM note_race_raw_content WHERE snapshot_date = ?`).run(date)
      )

      // 日期级删除属于最终删除，回收区同日期数据一并清理，避免误恢复。
      db.prepare(`DELETE FROM note_race_deleted_commerce WHERE snapshot_date = ?`).run(date)
      db.prepare(`DELETE FROM note_race_deleted_content WHERE snapshot_date = ?`).run(date)

      return {
        snapshotDate: date,
        deletedCommerceRows,
        deletedContentRows,
        deletedMatchRows,
        deletedRankRows
      }
    })

    const result = tx() as {
      snapshotDate: string
      deletedCommerceRows: number
      deletedContentRows: number
      deletedMatchRows: number
      deletedRankRows: number
    }

    const recomputedSnapshots = this.recomputeSnapshotsFrom(date)

    return {
      snapshotDate: result.snapshotDate,
      deletedCommerceRows: result.deletedCommerceRows,
      deletedContentRows: result.deletedContentRows,
      deletedMatchRows: result.deletedMatchRows,
      deletedRankRows: result.deletedRankRows,
      recomputedSnapshots
    }
  }

  getSnapshotStats(): NoteRaceSnapshotStat[] {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    if (!db) return []

    const rows = db
      .prepare(
        `
        WITH dates AS (
          SELECT DISTINCT snapshot_date FROM note_race_raw_commerce
          UNION
          SELECT DISTINCT snapshot_date FROM note_race_raw_content
          UNION
          SELECT DISTINCT snapshot_date FROM note_race_daily_rank
          UNION
          SELECT DISTINCT snapshot_date FROM note_race_deleted_commerce
          UNION
          SELECT DISTINCT snapshot_date FROM note_race_deleted_content
        ),
        commerce AS (
          SELECT snapshot_date, COUNT(*) AS commerce_rows, MAX(imported_at) AS latest_commerce_imported_at
          FROM note_race_raw_commerce
          GROUP BY snapshot_date
        ),
        content AS (
          SELECT snapshot_date, COUNT(*) AS content_rows, MAX(imported_at) AS latest_content_imported_at
          FROM note_race_raw_content
          GROUP BY snapshot_date
        ),
        ranked AS (
          SELECT snapshot_date, COUNT(*) AS rank_rows
          FROM note_race_daily_rank
          GROUP BY snapshot_date
        ),
        matched AS (
          SELECT snapshot_date, COUNT(*) AS matched_rows
          FROM note_race_match_map
          WHERE confidence > 0
          GROUP BY snapshot_date
        )
        SELECT
          d.snapshot_date AS snapshotDate,
          COALESCE(c.commerce_rows, 0) AS commerceRows,
          COALESCE(t.content_rows, 0) AS contentRows,
          COALESCE(r.rank_rows, 0) AS rankRows,
          COALESCE(m.matched_rows, 0) AS matchedRows,
          CASE
            WHEN COALESCE(c.latest_commerce_imported_at, 0) >= COALESCE(t.latest_content_imported_at, 0)
              THEN NULLIF(COALESCE(c.latest_commerce_imported_at, 0), 0)
            ELSE NULLIF(COALESCE(t.latest_content_imported_at, 0), 0)
          END AS latestImportedAt
        FROM dates d
        LEFT JOIN commerce c ON c.snapshot_date = d.snapshot_date
        LEFT JOIN content t ON t.snapshot_date = d.snapshot_date
        LEFT JOIN ranked r ON r.snapshot_date = d.snapshot_date
        LEFT JOIN matched m ON m.snapshot_date = d.snapshot_date
        ORDER BY d.snapshot_date DESC
        `
      )
      .all()

    return rows.map((row) => ({
      snapshotDate: normalizeText(row.snapshotDate),
      commerceRows: Math.max(0, Number(row.commerceRows ?? 0)),
      contentRows: Math.max(0, Number(row.contentRows ?? 0)),
      rankRows: Math.max(0, Number(row.rankRows ?? 0)),
      matchedRows: Math.max(0, Number(row.matchedRows ?? 0)),
      latestImportedAt:
        row.latestImportedAt == null || !Number.isFinite(Number(row.latestImportedAt))
          ? null
          : Number(row.latestImportedAt)
    }))
  }

  getSnapshotBatchStats(payload: {
    snapshotDate?: string
    includeDeleted?: boolean
  } = {}): NoteRaceSnapshotBatchStat[] {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    if (!db) return []

    const snapshotDate = normalizeText(payload.snapshotDate)
    const includeDeleted = payload.includeDeleted !== false
    const now = Date.now()
    const params: unknown[] = []
    const where = snapshotDate ? 'WHERE b.snapshot_date = ?' : ''
    if (snapshotDate) params.push(snapshotDate)

    const activeRows = db
      .prepare(
        `
        WITH batches AS (
          SELECT snapshot_date, imported_at FROM note_race_raw_commerce
          UNION
          SELECT snapshot_date, imported_at FROM note_race_raw_content
        ),
        commerce AS (
          SELECT
            snapshot_date,
            imported_at,
            COUNT(*) AS commerce_rows,
            GROUP_CONCAT(DISTINCT source_file) AS source_files
          FROM note_race_raw_commerce
          GROUP BY snapshot_date, imported_at
        ),
        content AS (
          SELECT
            snapshot_date,
            imported_at,
            COUNT(*) AS content_rows,
            GROUP_CONCAT(DISTINCT source_file) AS source_files
          FROM note_race_raw_content
          GROUP BY snapshot_date, imported_at
        )
        SELECT
          b.snapshot_date AS snapshotDate,
          b.imported_at AS importedAt,
          COALESCE(c.commerce_rows, 0) AS commerceRows,
          COALESCE(t.content_rows, 0) AS contentRows,
          COALESCE(c.source_files, '') AS commerceSourceFiles,
          COALESCE(t.source_files, '') AS contentSourceFiles
        FROM batches b
        LEFT JOIN commerce c ON c.snapshot_date = b.snapshot_date AND c.imported_at = b.imported_at
        LEFT JOIN content t ON t.snapshot_date = b.snapshot_date AND t.imported_at = b.imported_at
        ${where}
        ORDER BY b.snapshot_date DESC, b.imported_at DESC
        `
      )
      .all(...params)

    const activeStats: NoteRaceSnapshotBatchStat[] = activeRows.map((row) => {
      const sourceFiles = Array.from(
        new Set(
          `${normalizeText(row.commerceSourceFiles)},${normalizeText(row.contentSourceFiles)}`
            .split(',')
            .map((item) => normalizeText(item))
            .filter(Boolean)
        )
      )
      const importedAt = Math.max(0, Number(row.importedAt ?? 0))
      return {
        snapshotDate: normalizeText(row.snapshotDate),
        importedAt,
        commerceRows: Math.max(0, Number(row.commerceRows ?? 0)),
        contentRows: Math.max(0, Number(row.contentRows ?? 0)),
        sourceFiles,
        status: 'active',
        deletedAt: null,
        restorableUntil: null,
        restorable: false
      }
    })

    const deletedStats: NoteRaceSnapshotBatchStat[] = []
    if (includeDeleted) {
      const deletedRows = db
        .prepare(
          `
          WITH batches AS (
            SELECT snapshot_date, imported_at FROM note_race_deleted_commerce
            UNION
            SELECT snapshot_date, imported_at FROM note_race_deleted_content
          ),
          commerce AS (
            SELECT
              snapshot_date,
              imported_at,
              COUNT(*) AS commerce_rows,
              GROUP_CONCAT(DISTINCT source_file) AS source_files,
              MAX(deleted_at) AS deleted_at
            FROM note_race_deleted_commerce
            GROUP BY snapshot_date, imported_at
          ),
          content AS (
            SELECT
              snapshot_date,
              imported_at,
              COUNT(*) AS content_rows,
              GROUP_CONCAT(DISTINCT source_file) AS source_files,
              MAX(deleted_at) AS deleted_at
            FROM note_race_deleted_content
            GROUP BY snapshot_date, imported_at
          )
          SELECT
            b.snapshot_date AS snapshotDate,
            b.imported_at AS importedAt,
            COALESCE(c.commerce_rows, 0) AS commerceRows,
            COALESCE(t.content_rows, 0) AS contentRows,
            COALESCE(c.source_files, '') AS commerceSourceFiles,
            COALESCE(t.source_files, '') AS contentSourceFiles,
            CASE
              WHEN COALESCE(c.deleted_at, 0) >= COALESCE(t.deleted_at, 0)
                THEN NULLIF(COALESCE(c.deleted_at, 0), 0)
              ELSE NULLIF(COALESCE(t.deleted_at, 0), 0)
            END AS deletedAt
          FROM batches b
          LEFT JOIN commerce c ON c.snapshot_date = b.snapshot_date AND c.imported_at = b.imported_at
          LEFT JOIN content t ON t.snapshot_date = b.snapshot_date AND t.imported_at = b.imported_at
          ${where}
          ORDER BY b.snapshot_date DESC, b.imported_at DESC
          `
        )
        .all(...params)

      for (const row of deletedRows) {
        const sourceFiles = Array.from(
          new Set(
            `${normalizeText(row.commerceSourceFiles)},${normalizeText(row.contentSourceFiles)}`
              .split(',')
              .map((item) => normalizeText(item))
              .filter(Boolean)
          )
        )
        const importedAt = Math.max(0, Number(row.importedAt ?? 0))
        const deletedAt =
          row.deletedAt == null || !Number.isFinite(Number(row.deletedAt))
            ? null
            : Math.max(0, Number(row.deletedAt))
        const restorableUntil =
          deletedAt == null ? null : deletedAt + NOTE_RACE_BATCH_RESTORE_RETENTION_MS
        deletedStats.push({
          snapshotDate: normalizeText(row.snapshotDate),
          importedAt,
          commerceRows: Math.max(0, Number(row.commerceRows ?? 0)),
          contentRows: Math.max(0, Number(row.contentRows ?? 0)),
          sourceFiles,
          status: 'deleted',
          deletedAt,
          restorableUntil,
          restorable: restorableUntil != null && now <= restorableUntil
        })
      }
    }

    return [...activeStats, ...deletedStats].sort((a, b) => {
      if (a.snapshotDate !== b.snapshotDate) return b.snapshotDate.localeCompare(a.snapshotDate)
      if (a.importedAt !== b.importedAt) return b.importedAt - a.importedAt
      if (a.status === b.status) return 0
      return a.status === 'active' ? -1 : 1
    })
  }

  deleteSnapshotBatch(payload: {
    snapshotDate?: string
    importedAt?: number
    reason?: string
  }): NoteRaceDeleteBatchResult {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    const snapshotDate = normalizeText(payload.snapshotDate)
    const importedAt = Number(payload.importedAt)
    const reason = normalizeText(payload.reason) || 'manual'
    if (!snapshotDate) throw new Error('快照日期不能为空')
    if (!Number.isFinite(importedAt) || importedAt <= 0) throw new Error('批次 importedAt 非法')
    if (!db) {
      return {
        snapshotDate,
        importedAt: Math.floor(importedAt),
        deletedCommerceRows: 0,
        deletedContentRows: 0,
        recomputedSnapshots: 0
      }
    }

    const batchImportedAt = Math.floor(importedAt)
    const now = Date.now()
    const tx = db.transaction(() => {
      this.extractChanges(
        db
          .prepare(
            `
            INSERT OR REPLACE INTO note_race_deleted_commerce (
              snapshot_date, note_key, note_id, title, account_name, account_xhs_id, note_created_at, note_type,
              product_id, product_name, read_count, like_count, collect_count, comment_count, share_count,
              follow_count, danmu_count, avg_watch_seconds, finish_rate_pv, click_count, click_people, click_rate_pv,
              pay_orders, pay_users, pay_amount, pay_rate_pv, pay_rate_uv, add_cart_count, refund_amount_pay_time,
              refund_rate_pay_time, source_file, imported_at, raw_json, deleted_at, delete_reason
            )
            SELECT
              snapshot_date, note_key, note_id, title, account_name, account_xhs_id, note_created_at, note_type,
              product_id, product_name, read_count, like_count, collect_count, comment_count, share_count,
              follow_count, danmu_count, avg_watch_seconds, finish_rate_pv, click_count, click_people, click_rate_pv,
              pay_orders, pay_users, pay_amount, pay_rate_pv, pay_rate_uv, add_cart_count, refund_amount_pay_time,
              refund_rate_pay_time, source_file, imported_at, raw_json, ?, ?
            FROM note_race_raw_commerce
            WHERE snapshot_date = ? AND imported_at = ?
            `
          )
          .run(now, reason, snapshotDate, batchImportedAt)
      )
      this.extractChanges(
        db
          .prepare(
            `
            INSERT OR REPLACE INTO note_race_deleted_content (
              snapshot_date, row_id, title, first_published_at, note_type, exposure, view_count, cover_click_rate,
              like_count, comment_count, collect_count, follow_gain_count, share_count, avg_watch_seconds,
              danmu_count, source_file, imported_at, raw_json, deleted_at, delete_reason
            )
            SELECT
              snapshot_date, row_id, title, first_published_at, note_type, exposure, view_count, cover_click_rate,
              like_count, comment_count, collect_count, follow_gain_count, share_count, avg_watch_seconds,
              danmu_count, source_file, imported_at, raw_json, ?, ?
            FROM note_race_raw_content
            WHERE snapshot_date = ? AND imported_at = ?
            `
          )
          .run(now, reason, snapshotDate, batchImportedAt)
      )

      const deletedCommerceRows = this.extractChanges(
        db
          .prepare(
            `DELETE FROM note_race_raw_commerce WHERE snapshot_date = ? AND imported_at = ?`
          )
          .run(snapshotDate, batchImportedAt)
      )
      const deletedContentRows = this.extractChanges(
        db
          .prepare(
            `DELETE FROM note_race_raw_content WHERE snapshot_date = ? AND imported_at = ?`
          )
          .run(snapshotDate, batchImportedAt)
      )
      return { deletedCommerceRows, deletedContentRows }
    })

    const result = tx() as { deletedCommerceRows: number; deletedContentRows: number }
    const recomputedSnapshots = this.recomputeSnapshotsFrom(snapshotDate)
    return {
      snapshotDate,
      importedAt: batchImportedAt,
      deletedCommerceRows: result.deletedCommerceRows,
      deletedContentRows: result.deletedContentRows,
      recomputedSnapshots
    }
  }

  restoreSnapshotBatch(payload: {
    snapshotDate?: string
    importedAt?: number
  }): NoteRaceRestoreBatchResult {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    const snapshotDate = normalizeText(payload.snapshotDate)
    const importedAt = Number(payload.importedAt)
    if (!snapshotDate) throw new Error('快照日期不能为空')
    if (!Number.isFinite(importedAt) || importedAt <= 0) throw new Error('批次 importedAt 非法')
    if (!db) {
      return {
        snapshotDate,
        importedAt: Math.floor(importedAt),
        restoredCommerceRows: 0,
        restoredContentRows: 0,
        recomputedSnapshots: 0
      }
    }

    const batchImportedAt = Math.floor(importedAt)
    const commerceMeta = db
      .prepare(
        `
        SELECT COUNT(*) AS cnt, MAX(deleted_at) AS deletedAt
        FROM note_race_deleted_commerce
        WHERE snapshot_date = ? AND imported_at = ?
        `
      )
      .get(snapshotDate, batchImportedAt)
    const contentMeta = db
      .prepare(
        `
        SELECT COUNT(*) AS cnt, MAX(deleted_at) AS deletedAt
        FROM note_race_deleted_content
        WHERE snapshot_date = ? AND imported_at = ?
        `
      )
      .get(snapshotDate, batchImportedAt)
    const commerceCount = Math.max(0, Number(commerceMeta?.cnt ?? 0))
    const contentCount = Math.max(0, Number(contentMeta?.cnt ?? 0))
    if (commerceCount + contentCount <= 0) {
      throw new Error(`未找到可恢复批次：${snapshotDate} / ${batchImportedAt}`)
    }

    const deletedAt = Math.max(
      Number(commerceMeta?.deletedAt ?? 0),
      Number(contentMeta?.deletedAt ?? 0)
    )
    if (!Number.isFinite(deletedAt) || deletedAt <= 0) {
      throw new Error('批次恢复失败：缺少删除时间，无法校验恢复窗口')
    }
    const now = Date.now()
    if (now - deletedAt > NOTE_RACE_BATCH_RESTORE_RETENTION_MS) {
      throw new Error('该批次已超过 7 天恢复窗口，无法恢复')
    }

    const tx = db.transaction(() => {
      const restoredCommerceRows = this.extractChanges(
        db
          .prepare(
            `
            INSERT OR REPLACE INTO note_race_raw_commerce (
              snapshot_date, note_key, note_id, title, account_name, account_xhs_id, note_created_at, note_type,
              product_id, product_name, read_count, like_count, collect_count, comment_count, share_count,
              follow_count, danmu_count, avg_watch_seconds, finish_rate_pv, click_count, click_people, click_rate_pv,
              pay_orders, pay_users, pay_amount, pay_rate_pv, pay_rate_uv, add_cart_count, refund_amount_pay_time,
              refund_rate_pay_time, source_file, imported_at, raw_json
            )
            SELECT
              snapshot_date, note_key, note_id, title, account_name, account_xhs_id, note_created_at, note_type,
              product_id, product_name, read_count, like_count, collect_count, comment_count, share_count,
              follow_count, danmu_count, avg_watch_seconds, finish_rate_pv, click_count, click_people, click_rate_pv,
              pay_orders, pay_users, pay_amount, pay_rate_pv, pay_rate_uv, add_cart_count, refund_amount_pay_time,
              refund_rate_pay_time, source_file, imported_at, raw_json
            FROM note_race_deleted_commerce
            WHERE snapshot_date = ? AND imported_at = ?
            `
          )
          .run(snapshotDate, batchImportedAt)
      )
      const restoredContentRows = this.extractChanges(
        db
          .prepare(
            `
            INSERT OR REPLACE INTO note_race_raw_content (
              snapshot_date, row_id, title, first_published_at, note_type, exposure, view_count, cover_click_rate,
              like_count, comment_count, collect_count, follow_gain_count, share_count, avg_watch_seconds,
              danmu_count, source_file, imported_at, raw_json
            )
            SELECT
              snapshot_date, row_id, title, first_published_at, note_type, exposure, view_count, cover_click_rate,
              like_count, comment_count, collect_count, follow_gain_count, share_count, avg_watch_seconds,
              danmu_count, source_file, imported_at, raw_json
            FROM note_race_deleted_content
            WHERE snapshot_date = ? AND imported_at = ?
            `
          )
          .run(snapshotDate, batchImportedAt)
      )

      db.prepare(`DELETE FROM note_race_deleted_commerce WHERE snapshot_date = ? AND imported_at = ?`).run(
        snapshotDate,
        batchImportedAt
      )
      db.prepare(`DELETE FROM note_race_deleted_content WHERE snapshot_date = ? AND imported_at = ?`).run(
        snapshotDate,
        batchImportedAt
      )

      return { restoredCommerceRows, restoredContentRows }
    })

    const result = tx() as { restoredCommerceRows: number; restoredContentRows: number }
    const recomputedSnapshots = this.recomputeSnapshotsFrom(snapshotDate)
    return {
      snapshotDate,
      importedAt: batchImportedAt,
      restoredCommerceRows: result.restoredCommerceRows,
      restoredContentRows: result.restoredContentRows,
      recomputedSnapshots
    }
  }

  listRaceRows(query: NoteRaceListQuery = {}): NoteRaceListRow[] {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    if (!db) return []
    const meta = this.getMeta()
    const snapshotDate = normalizeText(query.snapshotDate) || meta.latestDate || ''
    if (!snapshotDate) return []
    const params: unknown[] = [snapshotDate]
    const where: string[] = ['snapshot_date = ?']
    if (normalizeText(query.account) && normalizeText(query.account) !== '全部账号') {
      where.push('account_name = ?')
      params.push(normalizeText(query.account))
    }
    if (query.noteType && query.noteType !== '全部') {
      where.push('note_type = ?')
      params.push(query.noteType)
    }
    const limit = clamp(Number(query.limit ?? 12) || 12, 1, 100)
    params.push(limit)
    const rows = db
      .prepare(
        `
        SELECT
          note_key AS id,
          rank_position AS rank,
          tag,
          account_name AS account,
          title,
          age_days AS ageDays,
          score,
          trend_delta AS trendDelta,
          trend_hint_json AS trendHintJson,
          content_signals_json AS contentSignalsJson,
          commerce_signals_json AS commerceSignalsJson,
          stage_label AS stageLabel,
          stage_index AS stageIndex,
          note_type AS noteType,
          product_name AS productName
        FROM note_race_daily_rank
        WHERE ${where.join(' AND ')}
        ORDER BY rank_position ASC
        LIMIT ?
        `
      )
      .all(...params)
    return rows.map((row) => ({
      id: String(row.id ?? ''),
      rank: Number(row.rank ?? 0),
      tag: toTag(row.tag),
      account: String(row.account ?? ''),
      title: String(row.title ?? ''),
      ageDays: Number(row.ageDays ?? 0),
      score: Number(row.score ?? 0),
      trendDelta: Number(row.trendDelta ?? 0),
      trendHint: parseStringArray(row.trendHintJson),
      contentSignals: parseSignalArray(row.contentSignalsJson),
      commerceSignals: parseSignalArray(row.commerceSignalsJson),
      stageLabel: String(row.stageLabel ?? 'S1 起量'),
      stageIndex: toStageIndex(row.stageIndex),
      noteType: toNoteType(row.noteType),
      productName: String(row.productName ?? '')
    }))
  }

  getRaceDetail(payload: { snapshotDate?: string; noteKey?: string }): NoteRaceDetail | null {
    const db = this.sqlite.tryGetConnection() as DbConnection | null
    if (!db) return null
    const snapshotDate = normalizeText(payload.snapshotDate) || this.getMeta().latestDate || ''
    const noteKey = normalizeText(payload.noteKey)
    if (!snapshotDate || !noteKey) return null

    const rank = db
      .prepare(
        `
        SELECT
          note_key AS id,
          rank_position AS rank,
          tag,
          account_name AS account,
          title,
          age_days AS ageDays,
          score,
          trend_delta AS trendDelta,
          trend_hint_json AS trendHintJson,
          content_signals_json AS contentSignalsJson,
          commerce_signals_json AS commerceSignalsJson,
          stage_label AS stageLabel,
          stage_index AS stageIndex,
          note_type AS noteType,
          product_name AS productName,
          d_read AS dRead,
          d_click AS dClick,
          d_order AS dOrder,
          acceleration,
          stability_label AS stabilityLabel
        FROM note_race_daily_rank
        WHERE snapshot_date = ? AND note_key = ?
        LIMIT 1
        `
      )
      .get(snapshotDate, noteKey)
    if (!rank) return null

    const commerce = db
      .prepare(
        `
        SELECT *
        FROM note_race_raw_commerce
        WHERE snapshot_date = ? AND note_key = ?
        LIMIT 1
        `
      )
      .get(snapshotDate, noteKey)
    if (!commerce) return null

    const match = db
      .prepare(
        `
        SELECT content_row_id AS contentRowId, confidence, match_rule AS matchRule
        FROM note_race_match_map
        WHERE snapshot_date = ? AND note_key = ?
        LIMIT 1
        `
      )
      .get(snapshotDate, noteKey)

    const content =
      match && normalizeText(match.contentRowId)
        ? db
            .prepare(
              `
              SELECT *
              FROM note_race_raw_content
              WHERE snapshot_date = ? AND row_id = ?
              LIMIT 1
              `
            )
            .get(snapshotDate, normalizeText(match.contentRowId))
        : null

    const sparklineRows = db
      .prepare(
        `
        SELECT snapshot_date AS snapshotDate, read_count AS readCount
        FROM note_race_raw_commerce
        WHERE note_key = ? AND snapshot_date <= ?
        ORDER BY snapshot_date DESC
        LIMIT 7
        `
      )
      .all(noteKey, snapshotDate)
      .reverse()
    const sparkline = sparklineRows.map((row) => Number(row.readCount ?? 0))

    const cumulativeRows = db
      .prepare(
        `
        SELECT
          snapshot_date AS snapshotDate,
          read_count AS readCount,
          click_count AS clickCount,
          pay_orders AS payOrders,
          pay_amount AS payAmount
        FROM note_race_raw_commerce
        WHERE note_key = ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC
        `
      )
      .all(noteKey, snapshotDate)
    const startDate = normalizeText(cumulativeRows[0]?.snapshotDate) || snapshotDate
    const startMs = parseYmdToUtcMs(startDate)
    const endMs = parseYmdToUtcMs(snapshotDate)
    const spanDays =
      startMs != null && endMs != null && endMs >= startMs
        ? Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1
        : Math.max(1, cumulativeRows.length)
    const activeDays = cumulativeRows.length
    const totalRead = cumulativeRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.readCount ?? 0)),
      0
    )
    const totalClick = cumulativeRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.clickCount ?? 0)),
      0
    )
    const totalOrders = cumulativeRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.payOrders ?? 0)),
      0
    )
    const totalAmount = cumulativeRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.payAmount ?? 0)),
      0
    )
    const coverageRate = spanDays > 0 ? clamp(activeDays / spanDays, 0, 1) : 0
    const clickRate = totalRead > 0 ? totalClick / totalRead : 0
    const payRate = totalClick > 0 ? totalOrders / totalClick : 0

    const read = Number(commerce.read_count ?? 0)
    const like = Number(commerce.like_count ?? 0)
    const collect = Number(commerce.collect_count ?? 0)
    const comment = Number(commerce.comment_count ?? 0)
    const share = Number(commerce.share_count ?? 0)
    const interaction = Math.max(0, like + collect + comment + share)
    const click = Number(commerce.click_count ?? 0)
    const addCart = Number(commerce.add_cart_count ?? 0)
    const payOrders = Number(commerce.pay_orders ?? 0)
    const refundRate = Number(commerce.refund_rate_pay_time ?? 0)
    const refundCount = Math.max(0, Math.round(payOrders * refundRate))

    const exposure = Math.max(0, Number(content?.exposure ?? 0)) || Math.round(read * 3)
    const view = Math.max(0, Number(content?.view_count ?? 0)) || read

    const contentFunnel = buildFunnel([
      { label: '曝光', value: exposure, conversionLabel: '阅读率' },
      { label: '观看/阅读', value: view, conversionLabel: '互动率' },
      { label: '互动', value: interaction, conversionLabel: '商品点击率' },
      { label: '商品点击', value: click }
    ])

    const commerceFunnel = buildFunnel([
      { label: '商品点击', value: click, conversionLabel: '加购率' },
      { label: '加购', value: addCart, conversionLabel: '支付率' },
      { label: '支付', value: payOrders, conversionLabel: '退款率' },
      { label: '退款', value: refundCount }
    ])

    return {
      row: {
        id: String(rank.id ?? ''),
        rank: Number(rank.rank ?? 0),
        tag: toTag(rank.tag),
        account: String(rank.account ?? ''),
        title: String(rank.title ?? ''),
        ageDays: Number(rank.ageDays ?? 0),
        score: Number(rank.score ?? 0),
        trendDelta: Number(rank.trendDelta ?? 0),
        trendHint: parseStringArray(rank.trendHintJson),
        contentSignals: parseSignalArray(rank.contentSignalsJson),
        commerceSignals: parseSignalArray(rank.commerceSignalsJson),
        stageLabel: String(rank.stageLabel ?? 'S1 起量'),
        stageIndex: toStageIndex(rank.stageIndex),
        noteType: toNoteType(rank.noteType),
        productName: String(rank.productName ?? '')
      },
      noteId: normalizeText(commerce.note_id) || null,
      productId: normalizeText(commerce.product_id) || null,
      createdAt:
        typeof commerce.note_created_at === 'number' ? Number(commerce.note_created_at) : null,
      matchConfidence: Number(match?.confidence ?? 0),
      matchRule: String(match?.matchRule ?? 'unmatched'),
      contentFunnel,
      commerceFunnel,
      sparkline,
      deltas: {
        read: Number(rank.dRead ?? 0),
        click: Number(rank.dClick ?? 0),
        acceleration: Number(rank.acceleration ?? 1),
        stability: toStability(rank.stabilityLabel)
      },
      cumulative: {
        startDate,
        endDate: snapshotDate,
        spanDays,
        activeDays,
        coverageRate,
        totalRead,
        totalClick,
        totalOrders,
        totalAmount,
        clickRate,
        payRate
      }
    }
  }

  private rebuildSnapshot(snapshotDate: string): { matchedRows: number; totalRows: number } {
    const db = this.sqlite.connection as DbConnection
    const commerceRows = db
      .prepare(`SELECT * FROM note_race_raw_commerce WHERE snapshot_date = ?`)
      .all(snapshotDate)
      .map(mapCommerceRow)
    const contentRows = db
      .prepare(`SELECT * FROM note_race_raw_content WHERE snapshot_date = ?`)
      .all(snapshotDate)
      .map(mapContentRow)

    const matchByExact = new Map<string, RawContentRow[]>()
    const matchByTitle = new Map<string, RawContentRow[]>()
    for (const row of contentRows) {
      const exactKey = createTitleTimeKey(row.title, row.firstPublishedAt)
      const titleKey = normalizeTitle(row.title)
      if (!matchByExact.has(exactKey)) matchByExact.set(exactKey, [])
      matchByExact.get(exactKey)?.push(row)
      if (!matchByTitle.has(titleKey)) matchByTitle.set(titleKey, [])
      matchByTitle.get(titleKey)?.push(row)
    }

    const usedContentIds = new Set<string>()
    const matches: MatchRecord[] = []

    for (const row of commerceRows) {
      const exactKey = createTitleTimeKey(row.title, row.noteCreatedAt)
      const exactCandidates = (matchByExact.get(exactKey) ?? []).filter(
        (item) => !usedContentIds.has(item.rowId)
      )
      if (exactCandidates.length === 1) {
        usedContentIds.add(exactCandidates[0].rowId)
        matches.push({
          noteKey: row.noteKey,
          contentRowId: exactCandidates[0].rowId,
          confidence: 1,
          rule: 'title_time_exact'
        })
        continue
      }
      if (exactCandidates.length > 1) {
        const chosen = exactCandidates.sort(
          (a, b) =>
            Math.abs((a.firstPublishedAt ?? 0) - (row.noteCreatedAt ?? 0)) -
            Math.abs((b.firstPublishedAt ?? 0) - (row.noteCreatedAt ?? 0))
        )[0]
        usedContentIds.add(chosen.rowId)
        matches.push({
          noteKey: row.noteKey,
          contentRowId: chosen.rowId,
          confidence: 0.85,
          rule: 'title_time_nearest'
        })
        continue
      }

      const titleCandidates = (matchByTitle.get(normalizeTitle(row.title)) ?? []).filter(
        (item) => !usedContentIds.has(item.rowId)
      )
      if (titleCandidates.length === 1) {
        usedContentIds.add(titleCandidates[0].rowId)
        matches.push({
          noteKey: row.noteKey,
          contentRowId: titleCandidates[0].rowId,
          confidence: 0.75,
          rule: 'title_unique'
        })
        continue
      }

      matches.push({
        noteKey: row.noteKey,
        contentRowId: null,
        confidence: 0,
        rule: 'unmatched'
      })
    }

    const matchMap = new Map<string, MatchRecord>()
    for (const match of matches) matchMap.set(match.noteKey, match)
    const contentById = new Map<string, RawContentRow>()
    for (const row of contentRows) contentById.set(row.rowId, row)

    const prevRowStmt = db.prepare(
      `
      SELECT *
      FROM note_race_raw_commerce
      WHERE note_key = ? AND snapshot_date < ?
      ORDER BY snapshot_date DESC
      LIMIT 2
      `
    )
    const prevSeriesStmt = db.prepare(
      `
      SELECT read_count AS readCount
      FROM note_race_raw_commerce
      WHERE note_key = ? AND snapshot_date <= ?
      ORDER BY snapshot_date DESC
      LIMIT 7
      `
    )
    const prevContentStmt = db.prepare(
      `
      SELECT *
      FROM note_race_raw_content
      WHERE row_id = ? AND snapshot_date < ?
      ORDER BY snapshot_date DESC
      LIMIT 1
      `
    )

    const intermediate: IntermediateRank[] = []
    const snapshotTs = Date.parse(`${snapshotDate}T00:00:00+08:00`)
    const trendComparability = this.evaluateTrendComparability(db, snapshotDate)
    const trendComparable = trendComparability.comparable
    const trendBlockedReason = trendComparable
      ? null
      : describeTrendComparabilityReason(
          trendComparability.reason,
          trendComparability.previousSnapshotDate
        )

    for (const row of commerceRows) {
      const match = matchMap.get(row.noteKey)
      const content = match?.contentRowId ? (contentById.get(match.contentRowId) ?? null) : null
      const prevRows = prevRowStmt.all(row.noteKey, snapshotDate)
      const prev = prevRows.length > 0 ? mapCommerceRow(prevRows[0]) : null
      const prev2 = prevRows.length > 1 ? mapCommerceRow(prevRows[1]) : null

      const prevContent = content
        ? mapContentRow(prevContentStmt.get(content.rowId, snapshotDate) ?? null)
        : null

      const rawDRead = row.readCount - (prev?.readCount ?? 0)
      const rawDClick = row.clickCount - (prev?.clickCount ?? 0)
      const rawDOrder = row.payOrders - (prev?.payOrders ?? 0)
      const dRead = trendComparable ? rawDRead : 0
      const dClick = trendComparable ? rawDClick : 0
      const dOrder = trendComparable ? rawDOrder : 0

      const rawPrevDRead = prev ? prev.readCount - (prev2?.readCount ?? 0) : 0
      const acceleration = trendComparable
        ? rawPrevDRead === 0
          ? dRead === 0
            ? 1
            : 1.2
          : Number((dRead / rawPrevDRead).toFixed(2))
        : 1

      const stableSeries = prevSeriesStmt
        .all(row.noteKey, snapshotDate)
        .map((item) => Number(item.readCount ?? 0))
        .reverse()
      const stability = toStableLabel(stableSeries)

      const stage = inferStage(row)
      const ageDays =
        row.noteCreatedAt && Number.isFinite(snapshotTs)
          ? Math.max(0, Math.ceil((snapshotTs - row.noteCreatedAt) / (1000 * 60 * 60 * 24)))
          : 0

      const trendDeltaRaw = trendComparable
        ? dRead * 0.02 + dClick * 0.3 + dOrder * 2 + (acceleration - 1) * 2
        : 0
      const trendDelta = Number(clamp(trendDeltaRaw, -9.9, 9.9).toFixed(1))

      const trendHint = trendComparable
        ? (() => {
            const readBaseline = computeBaseline(
              prevRows.map((item) => Number(item.read_count ?? 0)),
              row.readCount
            )
            const clickBaseline = computeBaseline(
              prevRows.map((item) => Number(item.click_count ?? 0)),
              row.clickCount
            )
            const ctrBaseline = computeBaseline(
              prevRows.map((item) => Number(item.click_rate_pv ?? 0)),
              row.clickRatePv
            )
            return [
              '昨对比前3日均值',
              `阅读 ${formatDelta(dRead)} (${formatPercent(dRead, readBaseline)})`,
              `点击 ${formatDelta(dClick)} (${formatPercent(dClick, clickBaseline)})`,
              `CTR ${formatDeltaRate(row.clickRatePv - ctrBaseline)}`
            ]
          })()
        : ['样本不足或口径不可比', trendBlockedReason ?? '快照口径不可比，已禁用增量趋势计算。']

      const rawDComment = row.commentCount - (prev?.commentCount ?? 0)
      const rawDCollect = row.collectCount - (prev?.collectCount ?? 0)
      const rawDLike = row.likeCount - (prev?.likeCount ?? 0)
      const rawDCover = content ? content.coverClickRate - (prevContent?.coverClickRate ?? 0) : 0
      const dComment = trendComparable ? rawDComment : 0
      const dCollect = trendComparable ? rawDCollect : 0
      const dLike = trendComparable ? rawDLike : 0
      const dCover = trendComparable ? rawDCover : 0

      const contentSignals: NoteRaceSignal[] = []
      if (dComment !== 0) contentSignals.push(toSignal('评', dComment))
      if (contentSignals.length < 2 && content && dCover !== 0)
        contentSignals.push(toSignal('封点', dCover * 100, 'pp'))
      if (contentSignals.length < 2 && dCollect !== 0) contentSignals.push(toSignal('藏', dCollect))
      if (contentSignals.length < 2 && dLike !== 0) contentSignals.push(toSignal('赞', dLike))
      if (contentSignals.length === 0) contentSignals.push(toSignal('评', 0))

      const commerceSignals: NoteRaceSignal[] = [toSignal('点', dClick), toSignal('单', dOrder)]

      const contentRaw = Math.max(
        0,
        (content?.coverClickRate ?? row.clickRatePv) * 220 +
          dComment * 8 +
          dCollect * 3 +
          dLike +
          (content?.viewCount ?? row.readCount) * 0.02
      )
      const commerceRaw = Math.max(
        0,
        row.clickCount * 3 + dClick * 4 + row.payOrders * 40 + dOrder * 80 + row.payAmount * 0.2
      )
      const trendRaw = trendComparable
        ? dRead + dClick * 8 + dOrder * 80 + (acceleration - 1) * 30
        : 0

      intermediate.push({
        noteKey: row.noteKey,
        accountName: row.accountName ?? '',
        title: row.title,
        ageDays,
        noteType: row.noteType ?? '图文',
        productName: row.productName ?? '',
        stageLabel: stage.stageLabel,
        stageIndex: stage.stageIndex,
        trendDelta,
        trendHint,
        contentSignals,
        commerceSignals,
        dRead,
        dClick,
        dOrder,
        acceleration,
        stability,
        refundRatePayTime: row.refundRatePayTime,
        trendRaw,
        contentRaw,
        commerceRaw
      })
    }

    const trendNorm = normalizeMinMax(intermediate.map((item) => item.trendRaw))
    const contentNorm = normalizeMinMax(intermediate.map((item) => item.contentRaw))
    const commerceNorm = normalizeMinMax(intermediate.map((item) => item.commerceRaw))

    const ranked = intermediate
      .map((item) => {
        const trendScore = trendNorm(item.trendRaw)
        const contentScore = contentNorm(item.contentRaw)
        const commerceScore = commerceNorm(item.commerceRaw)
        const refundPenalty = clamp(item.refundRatePayTime * 20, 0, 20)
        const score = clamp(
          0.55 * trendScore + 0.3 * contentScore + 0.15 * commerceScore - refundPenalty,
          0,
          100
        )
        return {
          ...item,
          score: Number(score.toFixed(1))
        }
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.trendDelta !== a.trendDelta) return b.trendDelta - a.trendDelta
        return a.title.localeCompare(b.title)
      })
      .map((item, index) => ({ ...item, rank: index + 1, tag: inferTag(item, item.score) }))

    const clearTx = db.transaction(() => {
      db.prepare(`DELETE FROM note_race_match_map WHERE snapshot_date = ?`).run(snapshotDate)
      db.prepare(`DELETE FROM note_race_daily_rank WHERE snapshot_date = ?`).run(snapshotDate)
    })
    clearTx()

    const insertMatch = db.prepare(`
      INSERT INTO note_race_match_map (
        snapshot_date, note_key, content_row_id, confidence, match_rule, matched_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insertRank = db.prepare(`
      INSERT INTO note_race_daily_rank (
        snapshot_date, note_key, rank_position, tag, stage_label, stage_index, score, trend_delta, trend_hint_json,
        content_signals_json, commerce_signals_json, account_name, title, note_type, age_days, product_name,
        d_read, d_click, d_order, acceleration, stability_label, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const now = Date.now()
    const saveTx = db.transaction(() => {
      for (const match of matches) {
        insertMatch.run(
          snapshotDate,
          match.noteKey,
          match.contentRowId,
          match.confidence,
          match.rule,
          now
        )
      }
      for (const row of ranked) {
        insertRank.run(
          snapshotDate,
          row.noteKey,
          row.rank,
          row.tag,
          row.stageLabel,
          row.stageIndex,
          row.score,
          row.trendDelta,
          JSON.stringify(row.trendHint),
          JSON.stringify(row.contentSignals),
          JSON.stringify(row.commerceSignals),
          row.accountName,
          row.title,
          row.noteType,
          row.ageDays,
          row.productName,
          row.dRead,
          row.dClick,
          row.dOrder,
          row.acceleration,
          row.stability,
          now
        )
      }
    })
    saveTx()
    return {
      matchedRows: matches.filter((item) => item.confidence > 0).length,
      totalRows: matches.length
    }
  }
}

function mapCommerceRow(row: Record<string, unknown> | null): RawCommerceRow {
  return {
    snapshotDate: normalizeText(row?.snapshot_date),
    noteKey: normalizeText(row?.note_key),
    noteId: normalizeText(row?.note_id) || null,
    title: normalizeText(row?.title),
    accountName: normalizeText(row?.account_name) || null,
    accountXhsId: normalizeText(row?.account_xhs_id) || null,
    noteCreatedAt: toNullableNumber(row?.note_created_at),
    noteType: toNoteType(row?.note_type),
    productId: normalizeText(row?.product_id) || null,
    productName: normalizeText(row?.product_name) || null,
    readCount: Number(row?.read_count ?? 0),
    likeCount: Number(row?.like_count ?? 0),
    collectCount: Number(row?.collect_count ?? 0),
    commentCount: Number(row?.comment_count ?? 0),
    shareCount: Number(row?.share_count ?? 0),
    followCount: Number(row?.follow_count ?? 0),
    danmuCount: Number(row?.danmu_count ?? 0),
    avgWatchSeconds: Number(row?.avg_watch_seconds ?? 0),
    finishRatePv: Number(row?.finish_rate_pv ?? 0),
    clickCount: Number(row?.click_count ?? 0),
    clickPeople: Number(row?.click_people ?? 0),
    clickRatePv: Number(row?.click_rate_pv ?? 0),
    payOrders: Number(row?.pay_orders ?? 0),
    payUsers: Number(row?.pay_users ?? 0),
    payAmount: Number(row?.pay_amount ?? 0),
    payRatePv: Number(row?.pay_rate_pv ?? 0),
    payRateUv: Number(row?.pay_rate_uv ?? 0),
    addCartCount: Number(row?.add_cart_count ?? 0),
    refundAmountPayTime: Number(row?.refund_amount_pay_time ?? 0),
    refundRatePayTime: Number(row?.refund_rate_pay_time ?? 0)
  }
}

function mapContentRow(row: Record<string, unknown> | null): RawContentRow {
  return {
    snapshotDate: normalizeText(row?.snapshot_date),
    rowId: normalizeText(row?.row_id),
    title: normalizeText(row?.title),
    firstPublishedAt: toNullableNumber(row?.first_published_at),
    noteType: toNoteType(row?.note_type),
    exposure: Number(row?.exposure ?? 0),
    viewCount: Number(row?.view_count ?? 0),
    coverClickRate: Number(row?.cover_click_rate ?? 0),
    likeCount: Number(row?.like_count ?? 0),
    commentCount: Number(row?.comment_count ?? 0),
    collectCount: Number(row?.collect_count ?? 0),
    followGainCount: Number(row?.follow_gain_count ?? 0),
    shareCount: Number(row?.share_count ?? 0),
    avgWatchSeconds: Number(row?.avg_watch_seconds ?? 0),
    danmuCount: Number(row?.danmu_count ?? 0)
  }
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function toTag(value: unknown): NoteRaceTag {
  const normalized = normalizeText(value)
  if (
    normalized === '起飞' ||
    normalized === '维稳' ||
    normalized === '掉速' ||
    normalized === '长尾复活' ||
    normalized === '风险'
  ) {
    return normalized
  }
  return '维稳'
}

function toStageIndex(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const numeric = Number(value)
  if (numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 || numeric === 5)
    return numeric
  return 1
}

function toNoteType(value: unknown): '图文' | '视频' {
  const normalized = normalizeText(value)
  if (normalized === '视频') return '视频'
  return '图文'
}

function toStability(value: unknown): '高' | '中' | '低' {
  const normalized = normalizeText(value)
  if (normalized === '高' || normalized === '中' || normalized === '低') return normalized
  return '中'
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => normalizeText(item)).filter(Boolean)
  const text = normalizeText(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeText(item)).filter(Boolean)
  } catch {
    return []
  }
}

function parseSignalArray(value: unknown): NoteRaceSignal[] {
  const text = normalizeText(value)
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        const row = (item ?? {}) as Record<string, unknown>
        const label = normalizeText(row.label)
        const tone = normalizeText(row.tone)
        if (!label) return null
        const mappedTone: NoteRaceSignalTone =
          tone === 'positive' || tone === 'negative' || tone === 'neutral' ? tone : 'neutral'
        return { label, tone: mappedTone }
      })
      .filter((item): item is NoteRaceSignal => item != null)
  } catch {
    return []
  }
}

function computeBaseline(previous: number[], fallback: number): number {
  const valid = previous.filter((item) => Number.isFinite(item))
  if (valid.length === 0) return fallback
  return valid.reduce((sum, item) => sum + item, 0) / valid.length
}

function formatDelta(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return `+${rounded}`
  return String(rounded)
}

function formatPercent(delta: number, baseline: number): string {
  if (!Number.isFinite(baseline) || baseline === 0) {
    return delta === 0 ? '0%' : 'n/a'
  }
  const rate = (delta / baseline) * 100
  const rounded = Number(rate.toFixed(1))
  if (rounded > 0) return `+${rounded}%`
  return `${rounded}%`
}

function formatDeltaRate(delta: number): string {
  const pp = Number((delta * 100).toFixed(1))
  if (pp > 0) return `+${pp}pp`
  if (pp < 0) return `${pp}pp`
  return '持平'
}

function buildFunnel(
  steps: Array<{ label: string; value: number; conversionLabel?: string }>
): Array<{ label: string; value: number; conversionLabel?: string; conversionValue?: number }> {
  return steps.map((step, index) => {
    if (index === 0 || !step.conversionLabel) return { label: step.label, value: step.value }
    const prev = steps[index - 1]?.value ?? 0
    const conversionValue = prev > 0 ? Number(((step.value / prev) * 100).toFixed(1)) : 0
    return {
      label: step.label,
      value: step.value,
      conversionLabel: step.conversionLabel,
      conversionValue
    }
  })
}
