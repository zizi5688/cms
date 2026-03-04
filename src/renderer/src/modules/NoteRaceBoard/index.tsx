import * as React from 'react'

import { ChevronDown, ChevronRight, Copy, Download, RefreshCcw, Settings2, Trash2 } from 'lucide-react'

import { Drawer } from '@renderer/components/ui/drawer'
import { Tabs, type TabsItem } from '@renderer/components/ui/tabs'
import { cn } from '@renderer/lib/utils'

type NoteType = '全部' | '图文' | '视频'
type NoteTag = '起飞' | '维稳' | '掉速' | '长尾复活' | '风险'
type SignalTone = 'positive' | 'negative' | 'neutral'

type Signal = {
  label: string
  tone: SignalTone
}

type FunnelMetric = {
  label: string
  value: number
  conversionLabel?: string
  conversionValue?: number
}

type RaceMeta = {
  latestDate: string | null
  availableDates: string[]
  totalNotes: number
  matchedNotes: number
  matchRate: number
  trendReadyDates: string[]
}

type RaceDeleteSnapshotResult = {
  snapshotDate: string
  deletedCommerceRows: number
  deletedContentRows: number
  deletedMatchRows: number
  deletedRankRows: number
  recomputedSnapshots: number
}

type RaceSnapshotStat = {
  snapshotDate: string
  commerceRows: number
  contentRows: number
  rankRows: number
  matchedRows: number
  latestImportedAt: number | null
}

type RaceSnapshotBatchStat = {
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

type RaceDeleteBatchResult = {
  snapshotDate: string
  importedAt: number
  deletedCommerceRows: number
  deletedContentRows: number
  recomputedSnapshots: number
}

type RaceRestoreBatchResult = {
  snapshotDate: string
  importedAt: number
  restoredCommerceRows: number
  restoredContentRows: number
  recomputedSnapshots: number
}

type RaceFolderScanResult = {
  dirPath: string
  scannedFiles: number
  importedFiles: number
  importedCommerceFiles: number
  importedContentFiles: number
  skippedOldFiles: number
  skippedUnsupportedFiles: number
  failedFiles: number
  latestMtimeMs: number
  importedItems: Array<{ fileName: string; kind: 'commerce' | 'content' }>
  failures: Array<{ fileName: string; message: string }>
}

type RaceListRow = {
  id: string
  rank: number
  tag: NoteTag
  account: string
  title: string
  ageDays: number
  score: number
  trendDelta: number
  trendHint: string[]
  contentSignals: Signal[]
  commerceSignals: Signal[]
  stageLabel: string
  stageIndex: 1 | 2 | 3 | 4 | 5
  noteType: '图文' | '视频'
  productName: string
  sparkline?: number[]
}

type RaceDetail = {
  row: RaceListRow
  noteId: string | null
  productId: string | null
  createdAt: number | null
  matchConfidence: number
  matchRule: string
  contentFunnel: FunnelMetric[]
  commerceFunnel: FunnelMetric[]
  sparkline: number[]
  deltas: {
    read: number
    click: number
    acceleration: number
    stability: '高' | '中' | '低'
  }
}

type ActionPriority = 'P0' | 'P1' | 'P2'
type DataPhase = 'EMPTY' | 'LOW_CONFIDENCE' | 'DAY2_PLUS'
type MainView = 'action-console' | 'monitor-hall'
type ViewMode = 'flat' | 'grouped'
type PriorityFilter = 'all' | ActionPriority
type SignalFilter = 'all' | 'opportunity' | 'alert' | 'rising' | 'mine-clear'
type StageFilter = 'all' | 's1' | 's2' | 's3' | 's4' | 'new' | 'revival'
type NoticeLevel = 'danger' | 'warning' | 'info'

type SystemNotice = {
  id: string
  level: NoticeLevel
  message: string
}

type RaceActionItem = {
  id: string
  rank: number
  title: string
  account: string
  tag: NoteTag
  priority: ActionPriority
  reason: string
  action: string
}

type LoadRowsOptions = {
  preserveScroll?: boolean
}

type ProductGroup = {
  key: string
  productName: string
  noteCount: number
  maxScore: number
  maxPriority: ActionPriority
  hasRising: boolean
  hasRisk: boolean
  hasRevival: boolean
  hasDrop: boolean
  totalExposure: number | null
  totalRead: number | null
  rows: RaceListRow[]
}

type ScoreBreakdownPart = {
  id: 'content' | 'commerce' | 'trend'
  label: string
  value: number | null
  widthPercent: number
  sharePercent: number
  barClassName: string
}

type ScoreBreakdownData = {
  totalScore: number
  parts: ScoreBreakdownPart[]
  penaltyTriggered: boolean
  penaltyText: string | null
  allPartsMissing: boolean
}

const NOTE_TYPES: NoteType[] = ['全部', '图文', '视频']
const MONITOR_DIR_STORAGE_KEY = 'note-race:monitor-dir:v1'
const MONITOR_ENABLE_STORAGE_KEY = 'note-race:monitor-enable:v1'
const MONITOR_CURSOR_STORAGE_KEY = 'note-race:monitor-cursor:v1'
const MONITOR_TABLE_COLUMNS =
  '48px 96px 138px minmax(220px,1.8fr) 92px 120px 108px 160px 160px 96px'
const MAIN_VIEW_TABS: TabsItem[] = [
  { value: 'action-console', label: '🎯 行动指挥台' },
  { value: 'monitor-hall', label: '📊 全盘监控大厅' }
]

function signalClasses(tone: SignalTone): string {
  if (tone === 'positive') {
    return 'border-[rgba(16,185,129,0.2)] bg-transparent text-[#10B981]'
  }
  if (tone === 'negative') {
    return 'border-[rgba(239,68,68,0.2)] bg-transparent text-[#ef4444]'
  }
  return 'border-zinc-700/70 bg-transparent text-zinc-400'
}

function tagDotClasses(tag: NoteTag): string {
  if (tag === '风险') return 'bg-rose-400'
  if (tag === '起飞') return 'bg-emerald-400'
  if (tag === '掉速') return 'bg-amber-400'
  if (tag === '长尾复活') return 'bg-yellow-400'
  return 'bg-zinc-500'
}

function tagTextClasses(tag: NoteTag): string {
  if (tag === '风险') return 'text-rose-200'
  if (tag === '起飞') return 'text-emerald-200'
  if (tag === '掉速') return 'text-amber-200'
  if (tag === '长尾复活') return 'text-yellow-200'
  return 'text-zinc-300'
}

function stageGhostClass(stageIndex: number): string {
  if (stageIndex >= 4) return 'border-zinc-500/40 text-zinc-300'
  if (stageIndex === 3) return 'border-cyan-500/30 text-cyan-200'
  if (stageIndex === 2) return 'border-amber-500/30 text-amber-200'
  return 'border-zinc-600 text-zinc-400'
}

function scoreBarClasses(score: number): string {
  if (score >= 80) return 'bg-cyan-400'
  if (score >= 50) return 'bg-zinc-500'
  return 'bg-amber-400'
}

function ageDotClass(ageDays: number): string {
  if (ageDays <= 7) return 'bg-emerald-400'
  if (ageDays <= 30) return 'bg-cyan-400'
  return 'bg-zinc-500'
}

function formatTrendDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(1)
  if (delta > 0) return `↑ +${abs}`
  if (delta < 0) return `↓ -${abs}`
  return '→ 0.0'
}

function trendDeltaClass(delta: number): string {
  if (delta > 0) return 'text-emerald-300'
  if (delta < 0) return 'text-rose-300'
  return 'text-zinc-400'
}

function priorityClass(priority: ActionPriority): string {
  if (priority === 'P0') return 'border-rose-500/50 bg-rose-500/10 text-rose-200'
  if (priority === 'P1') return 'border-amber-500/50 bg-amber-500/10 text-amber-200'
  return 'border-zinc-600 bg-zinc-800 text-zinc-300'
}

function priorityOrder(priority: ActionPriority): number {
  if (priority === 'P0') return 0
  if (priority === 'P1') return 1
  return 2
}

function noticePriority(level: NoticeLevel): number {
  if (level === 'danger') return 3
  if (level === 'warning') return 2
  return 1
}

function noticeClasses(level: NoticeLevel): string {
  if (level === 'danger') {
    return 'border-[rgba(255,67,67,0.3)] bg-[rgba(255,67,67,0.08)] text-[#ff4d4f]'
  }
  if (level === 'warning') {
    return 'border-[rgba(250,173,20,0.25)] bg-[rgba(250,173,20,0.06)] text-[#ffd666]'
  }
  return 'border-zinc-700/80 bg-transparent text-zinc-300'
}

function firstSignalLabel(signals: Signal[]): string {
  const first = signals.find((item) => item.label.trim())
  return first ? first.label : '无明显波动'
}

function buildActionItem(row: RaceListRow): RaceActionItem {
  if (row.tag === '起飞') {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P0',
      reason: `趋势 ${formatTrendDelta(row.trendDelta)}；内容信号 ${firstSignalLabel(row.contentSignals)}`,
      action: '优先跟进：复刻同题材2条，评论区加引导，明天重点看点击与评论是否延续'
    }
  }
  if (row.tag === '长尾复活') {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P0',
      reason: `老笔记复活；趋势 ${formatTrendDelta(row.trendDelta)}`,
      action: '放大复活：围绕同卖点补1条新笔记，并把该笔记加入未来7天重点观察'
    }
  }
  if (row.tag === '风险') {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P0',
      reason: `风险标签；商品信号 ${firstSignalLabel(row.commerceSignals)}`,
      action: '先止损：暂停加量，排查商品页与评论反馈，确认无异常后再恢复测试'
    }
  }
  if (row.tag === '掉速') {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P1',
      reason: `趋势 ${formatTrendDelta(row.trendDelta)}；内容信号 ${firstSignalLabel(row.contentSignals)}`,
      action: '回拉动作：改封面标题和首屏卖点，必要时重剪前3秒，观察次日回升'
    }
  }
  if (row.stageIndex <= 2 && row.trendDelta > 0) {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P1',
      reason: `早期阶段 ${row.stageLabel}；趋势 ${formatTrendDelta(row.trendDelta)}`,
      action: '推进转化：评论区加场景问答，优化商品卖点表达，争取推进到 S3'
    }
  }
  return {
    id: row.id,
    rank: row.rank,
    title: row.title,
    account: row.account,
    tag: row.tag,
    priority: 'P2',
    reason: `阶段 ${row.stageLabel}；趋势 ${formatTrendDelta(row.trendDelta)}`,
    action: '常规观察：保持投放节奏，不做大动作，继续累计对比样本'
  }
}

function buildActionItemDay1(row: RaceListRow): RaceActionItem {
  if (row.score >= 80) {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P1',
      reason: `低置信高分 ${row.score.toFixed(1)}（样本不足或口径不可比）`,
      action: '先小步放大：围绕同题材补 1 条，并在下一可比快照重点看点击与评论增量'
    }
  }
  if (row.stageIndex <= 2 && row.score >= 60) {
    return {
      id: row.id,
      rank: row.rank,
      title: row.title,
      account: row.account,
      tag: row.tag,
      priority: 'P1',
      reason: `低置信阶段 ${row.stageLabel}，具备继续观察价值`,
      action: '推进转化表达：优化封面标题和首屏卖点，等待下一可比快照确认'
    }
  }
  return {
    id: row.id,
    rank: row.rank,
    title: row.title,
    account: row.account,
    tag: row.tag,
    priority: 'P2',
    reason: `样本不足或口径不可比，暂不做趋势结论`,
    action: '常规观察：先保留样本，不做大动作，等待下一可比快照'
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error ?? '未知错误')
}

function readStoredString(key: string, fallback = ''): string {
  try {
    if (typeof window === 'undefined') return fallback
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function readStoredBool(key: string, fallback = false): boolean {
  const raw = readStoredString(key, fallback ? '1' : '0')
  return raw === '1'
}

function readStoredNumber(key: string, fallback = 0): number {
  const raw = readStoredString(key, String(fallback))
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function formatDateTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(timestamp)
  }
}

function normalizeStageIndex(stageIndex: number | null | undefined): number {
  const parsed = Number(stageIndex)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(5, Math.max(1, Math.round(parsed)))
}

function buildNoteExternalUrl(noteKey: string | null | undefined): string | null {
  const normalized = String(noteKey ?? '').trim()
  if (!normalized) return null
  if (/^https?:\/\//i.test(normalized)) return normalized
  return `https://www.xiaohongshu.com/explore/${encodeURIComponent(normalized)}`
}

function readFirstNumeric(sources: unknown[], keys: string[]): number | null {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    const record = source as Record<string, unknown>
    for (const key of keys) {
      if (!(key in record)) continue
      const value = Number(record[key])
      if (Number.isFinite(value)) return value
    }
  }
  return null
}

function readFirstBoolean(sources: unknown[], keys: string[]): boolean | null {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    const record = source as Record<string, unknown>
    for (const key of keys) {
      if (!(key in record)) continue
      const raw = record[key]
      if (typeof raw === 'boolean') return raw
      if (typeof raw === 'number') return raw !== 0
      if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase()
        if (['1', 'true', 'yes', 'y'].includes(normalized)) return true
        if (['0', 'false', 'no', 'n'].includes(normalized)) return false
      }
    }
  }
  return null
}

function findFunnelMetricValue(
  metrics: FunnelMetric[] | null | undefined,
  keywords: string[]
): number | null {
  if (!Array.isArray(metrics)) return null
  for (const metric of metrics) {
    const label = String(metric.label ?? '').trim()
    if (!label) continue
    if (!keywords.some((keyword) => label.includes(keyword))) continue
    const value = Number(metric.value)
    if (Number.isFinite(value)) return Math.max(0, value)
  }
  return null
}

function formatBreakdownValue(value: number | null): string {
  if (value == null) return '-'
  const abs = Math.abs(value)
  if (abs >= 100) return value.toFixed(0)
  return value.toFixed(1).replace(/\.0$/, '')
}

function resolveScoreBreakdown(row: RaceListRow, detail: RaceDetail | null): ScoreBreakdownData {
  const sources: unknown[] = [detail, detail?.row, row]
  const totalScore = Number.isFinite(row.score) ? row.score : 0

  const contentScore = readFirstNumeric(sources, [
    'content_score',
    'contentScore',
    'content_raw',
    'contentRaw'
  ])
  const commerceScore = readFirstNumeric(sources, [
    'commerce_score',
    'commerceScore',
    'commerce_raw',
    'commerceRaw'
  ])
  const trendScore = readFirstNumeric(sources, [
    'trend_score',
    'trendScore',
    'trend_raw',
    'trendRaw'
  ])

  const numericValues = [contentScore, commerceScore, trendScore]
    .filter((item): item is number => item != null && Number.isFinite(item))
    .map((item) => Math.max(0, item))
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 0
  const sumValue = numericValues.reduce((sum, item) => sum + item, 0)

  const buildPart = (
    id: ScoreBreakdownPart['id'],
    label: string,
    value: number | null,
    barClassName: string
  ): ScoreBreakdownPart => {
    const safeValue = value != null && Number.isFinite(value) ? Math.max(0, value) : null
    const widthPercent = safeValue == null || maxValue <= 0 ? 0 : (safeValue / maxValue) * 100
    const sharePercent = safeValue == null || sumValue <= 0 ? 0 : (safeValue / sumValue) * 100
    return {
      id,
      label,
      value: safeValue,
      widthPercent: Math.min(100, Math.max(0, widthPercent)),
      sharePercent: Math.min(100, Math.max(0, sharePercent)),
      barClassName
    }
  }

  const parts: ScoreBreakdownPart[] = [
    buildPart('content', '内容表现', contentScore, 'bg-cyan-400'),
    buildPart('commerce', '商品转化', commerceScore, 'bg-emerald-400'),
    buildPart('trend', '爆发趋势', trendScore, 'bg-amber-400')
  ]

  const refundPenalty = readFirstNumeric(sources, [
    'refund_penalty',
    'refundPenalty',
    'refund_deduct_score',
    'refundDeductScore',
    'penalty_refund',
    'refund_score_penalty',
    'refundScorePenalty'
  ])
  const refundRate = readFirstNumeric(sources, [
    'refund_rate_pay_time',
    'refundRatePayTime',
    'refund_rate',
    'refundRate'
  ])
  const hasRefundPenaltyFlag = readFirstBoolean(sources, [
    'has_refund_penalty',
    'hasRefundPenalty',
    'refund_penalty_triggered',
    'refundPenaltyTriggered',
    'is_refund_risk',
    'isRefundRisk'
  ])

  const refundCount = findFunnelMetricValue(detail?.commerceFunnel, ['退款'])
  const payCount = findFunnelMetricValue(detail?.commerceFunnel, ['支付'])
  const derivedRefundRate =
    payCount != null && payCount > 0 && refundCount != null ? refundCount / payCount : null
  const effectiveRefundRate =
    refundRate != null && Number.isFinite(refundRate)
      ? Math.max(0, refundRate)
      : derivedRefundRate != null
        ? Math.max(0, derivedRefundRate)
        : null
  const derivedPenalty =
    refundPenalty != null
      ? Math.max(0, refundPenalty)
      : effectiveRefundRate != null
        ? Math.min(20, effectiveRefundRate * 20)
        : null
  const penaltyTriggered =
    hasRefundPenaltyFlag === true ||
    (derivedPenalty != null && derivedPenalty > 0.01) ||
    (effectiveRefundRate != null && effectiveRefundRate >= 0.3)
  const penaltyText =
    derivedPenalty != null && derivedPenalty > 0.01
      ? `⚠️ 退款惩罚：-${derivedPenalty.toFixed(1)}分`
      : penaltyTriggered
        ? '🚨 转化链路高危'
        : null

  return {
    totalScore,
    parts,
    penaltyTriggered,
    penaltyText,
    allPartsMissing: parts.every((item) => item.value == null)
  }
}

function FunnelChart({
  title,
  metrics
}: {
  title: string
  metrics: FunnelMetric[]
}): React.JSX.Element {
  if (!metrics.length) {
    return (
      <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
        <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
        <div className="mt-2 text-xs text-zinc-500">暂无漏斗数据</div>
      </section>
    )
  }

  const safeValues = metrics.map((metric) =>
    Number.isFinite(metric.value) ? Math.max(0, metric.value) : 0
  )
  const base = Math.max(1, safeValues[0] ?? 1)
  const rawWidths = safeValues.map((value) => Math.max(26, Math.min(96, (value / base) * 96)))
  const visualWidths = rawWidths.reduce<number[]>((acc, width, index) => {
    if (index === 0) {
      acc.push(width)
      return acc
    }
    const prev = acc[index - 1] ?? width
    acc.push(Math.max(22, Math.min(width, prev - 4)))
    return acc
  }, [])

  return (
    <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
      <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
      <div className="mx-auto mt-3 w-full max-w-[420px]">
        {metrics.map((metric, index) => {
          const value = safeValues[index] ?? 0
          const nextValue = safeValues[index + 1] ?? 0
          const width = visualWidths[index] ?? 26
          const nextMetric = metrics[index + 1]
          const explicitConversion =
            nextMetric && Number.isFinite(nextMetric.conversionValue)
              ? Number(nextMetric.conversionValue)
              : null
          const derivedConversion =
            nextMetric && value > 0 ? (nextValue / value) * 100 : nextMetric ? 0 : null
          const rawConversion = explicitConversion ?? derivedConversion
          const conversionRate = rawConversion == null ? null : Math.max(0, rawConversion)
          const barOpacity = Math.max(0.12, 0.3 - index * 0.04)
          return (
            <div key={`${metric.label}-${index}`} className="w-full">
              <div className="flex justify-center">
                <div
                  className="relative h-6 rounded-[4px] border"
                  style={{
                    width: `${width}%`,
                    borderColor: 'rgba(125,211,252,0.35)',
                    backgroundColor: `rgba(56,189,248,${barOpacity})`
                  }}
                >
                  <div
                    className={cn(
                      'absolute inset-0 flex items-center justify-between',
                      width < 40 ? 'px-1.5' : 'px-2'
                    )}
                  >
                    <span className="truncate text-[12px] text-zinc-100">{metric.label}</span>
                    <span className="ml-2 shrink-0 text-[12px] font-medium tabular-nums text-zinc-100">
                      {value.toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
              {nextMetric ? (
                <div className="flex h-[28px] flex-col items-center justify-center leading-none">
                  <span className="text-[12px] text-zinc-500">↓</span>
                  <span className="mt-1 text-[12px] tabular-nums text-zinc-400">
                    ↳ {conversionRate == null ? '-%' : `${conversionRate.toFixed(1)}%`}
                  </span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TrendSparkline({ values }: { values: number[] }): React.JSX.Element {
  if (!Array.isArray(values) || values.length < 2) {
    return <div className="text-[11px] text-zinc-500">暂无趋势数据</div>
  }
  const width = 200
  const height = 46
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stroke = '#FBBF24'
  const fill = 'rgba(251,191,36,0.10)'
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return { x, y }
  })
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`

  const end = points[points.length - 1]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none">
      <path d={area} fill={fill} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={end.x}
        cy={end.y}
        r="2.4"
        fill={stroke}
        stroke="rgba(24,24,27,0.95)"
        strokeWidth="1"
      />
    </svg>
  )
}

function MiniSparkline({ values }: { values: number[] }): React.JSX.Element | null {
  if (!Array.isArray(values) || values.length < 2) return null
  const width = 72
  const height = 18
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return { x, y }
  })
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
  const end = points[points.length - 1]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[16px] w-[72px]"
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="#FBBF24"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={end.x} cy={end.y} r="1.8" fill="#FBBF24" stroke="rgba(24,24,27,0.95)" />
    </svg>
  )
}

type MonitorTableRowProps = {
  row: RaceListRow
  priority: ActionPriority
  isSelected: boolean
  trendLabel: string
  trendClass: string
  onSelect: (id: string) => void
  onOpenLink: (id: string) => void
  indented?: boolean
  className?: string
}

const MonitorTableRow = React.memo(function MonitorTableRow({
  row,
  priority,
  isSelected,
  trendLabel,
  trendClass,
  onSelect,
  onOpenLink,
  indented = false,
  className
}: MonitorTableRowProps): React.JSX.Element {
  const stageIndex = normalizeStageIndex(row.stageIndex)
  const stageLabel = row.stageLabel?.trim() || '-'
  const hasSparkline = Array.isArray(row.sparkline) && row.sparkline.length >= 2

  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={cn(
        'grid h-[56px] w-full items-center border-b border-zinc-800/35 px-2 text-left text-[12px] transition hover:bg-zinc-800/50',
        priority === 'P0' && 'bg-rose-500/5',
        priority === 'P1' && 'bg-amber-500/5',
        isSelected && 'bg-zinc-800/70',
        className
      )}
      style={{ gridTemplateColumns: MONITOR_TABLE_COLUMNS }}
      title={row.trendHint.join('\n')}
    >
      <span
        className={cn(
          'pr-2 text-right tabular-nums text-zinc-400',
          row.rank <= 3 && 'font-semibold text-zinc-200'
        )}
      >
        {row.rank}
      </span>
      <TagStatus tag={row.tag} />
      <span className="truncate text-zinc-400">{row.account || '-'}</span>
      <span className={cn('flex min-w-0 items-center gap-1', indented && 'pl-4')}>
        <span className="truncate text-zinc-100" title={row.title}>
          {row.title}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation()
            onOpenLink(row.id)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onOpenLink(row.id)
            }
          }}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:text-cyan-300 focus:outline-none"
          title="复制笔记链接"
          aria-label="复制笔记链接"
        >
          <Copy className="h-3 w-3" />
        </span>
      </span>
      <span className="inline-flex items-center justify-end gap-1 text-right tabular-nums text-zinc-300">
        <span className={cn('h-1.5 w-1.5 rounded-full', ageDotClass(row.ageDays))} />
        <span>第{row.ageDays}天</span>
      </span>
      <span className="px-2 tabular-nums">
        <div className="text-right text-zinc-100">{row.score.toFixed(1)}</div>
        <div className="mt-0.5 h-1 overflow-hidden rounded bg-zinc-800">
          <div
            className={cn('h-full rounded', scoreBarClasses(row.score))}
            style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
          />
        </div>
      </span>
      <span className="flex flex-col items-end justify-center">
        {hasSparkline ? (
          <MiniSparkline values={row.sparkline ?? []} />
        ) : (
          <span className="text-[10px] text-zinc-600">-</span>
        )}
        <span className={cn('text-right font-medium tabular-nums', trendClass)}>{trendLabel}</span>
      </span>
      <SignalColumn signals={row.contentSignals} />
      <SignalColumn signals={row.commerceSignals} />
      <span>
        <span
          className={cn(
            'inline-flex rounded border px-1.5 py-0.5 text-[10px]',
            stageGhostClass(stageIndex)
          )}
        >
          {stageLabel}
        </span>
      </span>
    </button>
  )
}, areMonitorRowsEqual)

function areMonitorRowsEqual(prev: MonitorTableRowProps, next: MonitorTableRowProps): boolean {
  return (
    prev.row === next.row &&
    prev.priority === next.priority &&
    prev.isSelected === next.isSelected &&
    prev.trendLabel === next.trendLabel &&
    prev.trendClass === next.trendClass &&
    prev.onSelect === next.onSelect &&
    prev.onOpenLink === next.onOpenLink &&
    prev.indented === next.indented &&
    prev.className === next.className
  )
}

function NoteRaceBoard(): React.JSX.Element {
  const [snapshotDates, setSnapshotDates] = React.useState<string[]>([])
  const [snapshotDate, setSnapshotDate] = React.useState<string>('')
  const [account, setAccount] = React.useState<string>('全部账号')
  const [noteType, setNoteType] = React.useState<NoteType>('全部')
  const [mainView, setMainView] = React.useState<MainView>('action-console')
  const [viewMode, setViewMode] = React.useState<ViewMode>('flat')
  const [priorityFilter, setPriorityFilter] = React.useState<PriorityFilter>('all')
  const [signalFilter, setSignalFilter] = React.useState<SignalFilter>('all')
  const [stageFilter, setStageFilter] = React.useState<StageFilter>('all')
  const [monitorDir, setMonitorDir] = React.useState<string>(() =>
    readStoredString(MONITOR_DIR_STORAGE_KEY, '')
  )
  const [autoMonitorEnabled, setAutoMonitorEnabled] = React.useState<boolean>(() =>
    readStoredBool(MONITOR_ENABLE_STORAGE_KEY, false)
  )
  const [scanCursorMs, setScanCursorMs] = React.useState<number>(() =>
    readStoredNumber(MONITOR_CURSOR_STORAGE_KEY, 0)
  )
  const [allRows, setAllRows] = React.useState<RaceListRow[]>([])
  const [selectedId, setSelectedId] = React.useState<string>('')
  const [selectedDetail, setSelectedDetail] = React.useState<RaceDetail | null>(null)
  const [meta, setMeta] = React.useState<RaceMeta>({
    latestDate: null,
    availableDates: [],
    totalNotes: 0,
    matchedNotes: 0,
    matchRate: 0,
    trendReadyDates: []
  })
  const [snapshotStats, setSnapshotStats] = React.useState<RaceSnapshotStat[]>([])
  const [managerSnapshotDate, setManagerSnapshotDate] = React.useState<string>('')
  const [snapshotBatches, setSnapshotBatches] = React.useState<RaceSnapshotBatchStat[]>([])
  const [loading, setLoading] = React.useState<boolean>(false)
  const [detailLoading, setDetailLoading] = React.useState<boolean>(false)
  const [importing, setImporting] = React.useState<boolean>(false)
  const [scanLoading, setScanLoading] = React.useState<boolean>(false)
  const [snapshotStatsLoading, setSnapshotStatsLoading] = React.useState<boolean>(false)
  const [snapshotBatchesLoading, setSnapshotBatchesLoading] = React.useState<boolean>(false)
  const [deletingSnapshot, setDeletingSnapshot] = React.useState<boolean>(false)
  const [batchOperatingKey, setBatchOperatingKey] = React.useState<string>('')
  const [error, setError] = React.useState<string>('')
  const [lastImportMessage, setLastImportMessage] = React.useState<string>('')
  const [copyToastMessage, setCopyToastMessage] = React.useState<string>('')
  const [detailDrawerOpen, setDetailDrawerOpen] = React.useState<boolean>(false)
  const [dataManagerOpen, setDataManagerOpen] = React.useState<boolean>(false)
  const [monitorMenuOpen, setMonitorMenuOpen] = React.useState<boolean>(false)
  const [noticeCursor, setNoticeCursor] = React.useState<number>(0)
  const [expandedGroups, setExpandedGroups] = React.useState<Record<string, boolean>>({})
  const scanInFlightRef = React.useRef<boolean>(false)
  const monitorMenuRef = React.useRef<HTMLDivElement | null>(null)
  const tableScrollRef = React.useRef<HTMLDivElement | null>(null)
  const isTrendReady = React.useMemo(() => {
    if (!snapshotDate) return false
    return Array.isArray(meta.trendReadyDates) && meta.trendReadyDates.includes(snapshotDate)
  }, [meta.trendReadyDates, snapshotDate])

  const dataPhase: DataPhase = React.useMemo(() => {
    if (snapshotDates.length === 0) return 'EMPTY'
    return isTrendReady ? 'DAY2_PLUS' : 'LOW_CONFIDENCE'
  }, [isTrendReady, snapshotDates.length])

  const managerDateOptions = React.useMemo(() => {
    const fromStats = snapshotStats.map((item) => String(item.snapshotDate ?? '').trim()).filter(Boolean)
    if (fromStats.length > 0) return Array.from(new Set(fromStats))
    return snapshotDates
  }, [snapshotDates, snapshotStats])

  const loadMeta = React.useCallback(async (): Promise<string> => {
    const nextRaw = (await window.api.cms.noteRace.meta()) as RaceMeta
    const trendReadyDates = Array.isArray(nextRaw?.trendReadyDates)
      ? nextRaw.trendReadyDates.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    const next: RaceMeta = {
      latestDate: nextRaw?.latestDate ?? null,
      availableDates: Array.isArray(nextRaw?.availableDates)
        ? nextRaw.availableDates.map((item) => String(item ?? '').trim()).filter(Boolean)
        : [],
      totalNotes: Number(nextRaw?.totalNotes ?? 0),
      matchedNotes: Number(nextRaw?.matchedNotes ?? 0),
      matchRate: Number(nextRaw?.matchRate ?? 0),
      trendReadyDates
    }
    const availableDates = Array.isArray(next.availableDates) ? next.availableDates : []
    const chosenDate =
      snapshotDate && availableDates.includes(snapshotDate) ? snapshotDate : (next.latestDate ?? '')

    setMeta(next)
    setSnapshotDates(availableDates)
    setSnapshotDate(chosenDate)
    return chosenDate
  }, [snapshotDate])

  const loadRows = React.useCallback(
    async (targetDate: string, options: LoadRowsOptions = {}): Promise<void> => {
      const shouldPreserveScroll = options.preserveScroll === true
      const preservedScrollTop = shouldPreserveScroll ? (tableScrollRef.current?.scrollTop ?? 0) : 0

      if (!targetDate) {
        setAllRows([])
        return
      }
      setLoading(true)
      try {
        const nextRows = (await window.api.cms.noteRace.list({
          snapshotDate: targetDate,
          limit: 100
        })) as RaceListRow[]
        setAllRows(Array.isArray(nextRows) ? nextRows : [])
        if (shouldPreserveScroll) {
          window.requestAnimationFrame(() => {
            if (tableScrollRef.current) {
              tableScrollRef.current.scrollTop = preservedScrollTop
            }
          })
        }
        setError('')
      } catch (err) {
        setAllRows([])
        setError(`加载列表失败：${normalizeError(err)}`)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const loadSnapshotStats = React.useCallback(async (): Promise<void> => {
    setSnapshotStatsLoading(true)
    try {
      const stats = (await window.api.cms.noteRace.snapshotStats()) as RaceSnapshotStat[]
      setSnapshotStats(Array.isArray(stats) ? stats : [])
    } catch (err) {
      setSnapshotStats([])
      setError(`加载日期统计失败：${normalizeError(err)}`)
    } finally {
      setSnapshotStatsLoading(false)
    }
  }, [])

  const loadSnapshotBatches = React.useCallback(async (targetSnapshotDate: string): Promise<void> => {
    const normalizedDate = String(targetSnapshotDate ?? '').trim()
    if (!normalizedDate) {
      setSnapshotBatches([])
      return
    }
    setSnapshotBatchesLoading(true)
    try {
      const rows = (await window.api.cms.noteRace.snapshotBatchStats({
        snapshotDate: normalizedDate,
        includeDeleted: true
      })) as RaceSnapshotBatchStat[]
      setSnapshotBatches(Array.isArray(rows) ? rows : [])
      setError('')
    } catch (err) {
      setSnapshotBatches([])
      setError(`加载批次统计失败：${normalizeError(err)}`)
    } finally {
      setSnapshotBatchesLoading(false)
    }
  }, [])

  const refresh = React.useCallback(
    async (options: LoadRowsOptions = {}): Promise<void> => {
      const date = await loadMeta()
      await loadSnapshotStats()
      if (dataManagerOpen) {
        const managerDate = managerSnapshotDate || date
        if (managerDate) {
          await loadSnapshotBatches(managerDate)
        }
      }
      if (date) {
        await loadRows(date, options)
        return
      }
      setAllRows([])
    },
    [dataManagerOpen, loadMeta, loadRows, loadSnapshotBatches, loadSnapshotStats, managerSnapshotDate]
  )

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (!dataManagerOpen) return
    const managerDateValid =
      managerSnapshotDate && Array.isArray(managerDateOptions) && managerDateOptions.includes(managerSnapshotDate)
    const fallbackDate = managerDateValid
      ? managerSnapshotDate
      : snapshotDate || managerDateOptions[0] || ''
    if (!fallbackDate) {
      setSnapshotBatches([])
      return
    }
    if (managerSnapshotDate !== fallbackDate) {
      setManagerSnapshotDate(fallbackDate)
      return
    }
    void loadSnapshotBatches(fallbackDate)
  }, [dataManagerOpen, loadSnapshotBatches, managerDateOptions, managerSnapshotDate, snapshotDate])

  const scopedRows = React.useMemo(() => {
    return allRows.filter((row) => {
      if (account !== '全部账号' && row.account !== account) return false
      if (noteType !== '全部' && row.noteType !== noteType) return false
      return true
    })
  }, [allRows, account, noteType])

  const accountOptions = React.useMemo(() => {
    const unique = Array.from(new Set(allRows.map((row) => row.account).filter(Boolean)))
    if (account !== '全部账号' && !unique.includes(account)) {
      unique.unshift(account)
    }
    return ['全部账号', ...unique]
  }, [allRows, account])

  const summary = React.useMemo(() => {
    const byTag = scopedRows.reduce<Record<NoteTag, number>>(
      (acc, row) => {
        acc[row.tag] += 1
        return acc
      },
      { 起飞: 0, 维稳: 0, 掉速: 0, 长尾复活: 0, 风险: 0 }
    )

    return {
      assessedCount: scopedRows.length,
      matchRate: meta.matchRate,
      risingCount: byTag['起飞'],
      revivalCount: byTag['长尾复活'],
      dropCount: byTag['掉速'],
      riskCount: byTag['风险']
    }
  }, [scopedRows, meta.matchRate])

  const qualityLevel =
    summary.matchRate < 0.5 ? 'danger' : summary.matchRate < 0.7 ? 'warning' : 'ok'

  const actionMap = React.useMemo(() => {
    const builder = dataPhase === 'DAY2_PLUS' ? buildActionItem : buildActionItemDay1
    return new Map(scopedRows.map((row) => [row.id, builder(row)]))
  }, [dataPhase, scopedRows])

  const actionList = React.useMemo(() => {
    return Array.from(actionMap.values())
      .sort((a, b) => {
        const byPriority = priorityOrder(a.priority) - priorityOrder(b.priority)
        if (byPriority !== 0) return byPriority
        return a.rank - b.rank
      })
      .slice(0, 10)
  }, [actionMap])

  const rows = React.useMemo(() => {
    return scopedRows
      .filter((row) => {
        const actionItem = actionMap.get(row.id)
        if (priorityFilter !== 'all' && actionItem?.priority !== priorityFilter) return false

        if (signalFilter === 'opportunity') {
          const isOpportunity = row.tag === '起飞' || row.tag === '长尾复活' || row.trendDelta >= 3
          if (!isOpportunity) return false
        }
        if (signalFilter === 'alert') {
          const isAlert = row.tag === '风险' || row.tag === '掉速' || row.trendDelta <= -2.5
          if (!isAlert) return false
        }
        if (signalFilter === 'rising' && row.tag !== '起飞') return false
        if (signalFilter === 'mine-clear' && !(row.tag === '风险' || row.tag === '掉速'))
          return false

        if (stageFilter === 's1' && row.stageIndex !== 1) return false
        if (stageFilter === 's2' && row.stageIndex !== 2) return false
        if (stageFilter === 's3' && row.stageIndex !== 3) return false
        if (stageFilter === 's4' && row.stageIndex !== 4) return false
        if (stageFilter === 'new' && row.ageDays > 1) return false
        if (stageFilter === 'revival' && row.tag !== '长尾复活') return false
        return true
      })
      .slice(0, 12)
  }, [actionMap, priorityFilter, scopedRows, signalFilter, stageFilter])

  const groupedRows = React.useMemo<ProductGroup[]>(() => {
    const groupMap = new Map<string, ProductGroup>()

    for (const row of rows) {
      const productName = row.productName?.trim() || '未关联商品'
      const key = productName
      const rowPriority = actionMap.get(row.id)?.priority ?? 'P2'
      const current = groupMap.get(key)

      if (!current) {
        groupMap.set(key, {
          key,
          productName,
          noteCount: 1,
          maxScore: row.score,
          maxPriority: rowPriority,
          hasRising: row.tag === '起飞',
          hasRisk: row.tag === '风险',
          hasRevival: row.tag === '长尾复活',
          hasDrop: row.tag === '掉速',
          totalExposure: null,
          totalRead: null,
          rows: [row]
        })
        continue
      }

      current.noteCount += 1
      current.maxScore = Math.max(current.maxScore, row.score)
      if (priorityOrder(rowPriority) < priorityOrder(current.maxPriority)) {
        current.maxPriority = rowPriority
      }
      current.hasRising = current.hasRising || row.tag === '起飞'
      current.hasRisk = current.hasRisk || row.tag === '风险'
      current.hasRevival = current.hasRevival || row.tag === '长尾复活'
      current.hasDrop = current.hasDrop || row.tag === '掉速'
      current.rows.push(row)
    }

    return Array.from(groupMap.values()).sort((a, b) => {
      if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore
      if (b.noteCount !== a.noteCount) return b.noteCount - a.noteCount
      return a.productName.localeCompare(b.productName, 'zh-CN')
    })
  }, [actionMap, rows])

  React.useEffect(() => {
    setExpandedGroups((prev) => {
      const next: Record<string, boolean> = {}
      for (const group of groupedRows) {
        if (prev[group.key]) next[group.key] = true
      }
      return next
    })
  }, [groupedRows])

  React.useEffect(() => {
    if (!rows.length) {
      setSelectedId('')
      setSelectedDetail(null)
      return
    }
    setSelectedId((prev) => (rows.some((row) => row.id === prev) ? prev : rows[0].id))
  }, [rows])

  React.useEffect(() => {
    if (!snapshotDate || !selectedId) {
      setSelectedDetail(null)
      return
    }

    let cancelled = false
    setDetailLoading(true)
    ;(async () => {
      try {
        const detail = (await window.api.cms.noteRace.detail({
          snapshotDate,
          noteKey: selectedId
        })) as RaceDetail | null
        if (!cancelled) {
          setSelectedDetail(detail)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setSelectedDetail(null)
          setError(`加载详情失败：${normalizeError(err)}`)
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [snapshotDate, selectedId])

  const selected = rows.find((row) => row.id === selectedId) ?? null
  const detail =
    selectedDetail && selected && selectedDetail.row.id === selected.id ? selectedDetail : null
  const selectedStageIndex = normalizeStageIndex(selected?.stageIndex)

  React.useEffect(() => {
    if (mainView !== 'monitor-hall' && detailDrawerOpen) {
      setDetailDrawerOpen(false)
    }
  }, [detailDrawerOpen, mainView])

  React.useEffect(() => {
    if (!selected) {
      setDetailDrawerOpen(false)
    }
  }, [selected])

  const opportunityCount = React.useMemo(
    () =>
      scopedRows.filter(
        (row) => row.tag === '起飞' || row.tag === '长尾复活' || row.trendDelta >= 3
      ).length,
    [scopedRows]
  )

  const riskSignalCount = React.useMemo(
    () =>
      scopedRows.filter((row) => row.tag === '风险' || row.tag === '掉速' || row.trendDelta <= -2.5)
        .length,
    [scopedRows]
  )

  const p0Count = React.useMemo(
    () => Array.from(actionMap.values()).filter((item) => item.priority === 'P0').length,
    [actionMap]
  )
  const p1Count = React.useMemo(
    () => Array.from(actionMap.values()).filter((item) => item.priority === 'P1').length,
    [actionMap]
  )
  const p2Count = React.useMemo(
    () => Array.from(actionMap.values()).filter((item) => item.priority === 'P2').length,
    [actionMap]
  )

  const notices = React.useMemo<SystemNotice[]>(() => {
    const items: SystemNotice[] = []
    if (error) {
      items.push({ id: 'error', level: 'danger', message: error })
    }
    if (qualityLevel === 'danger') {
      items.push({
        id: 'quality-danger',
        level: 'danger',
        message: '数据匹配率严重偏低，建议先修复数据后再解读排名。'
      })
    } else if (qualityLevel === 'warning') {
      items.push({
        id: 'quality-warning',
        level: 'warning',
        message: '数据匹配率偏低，请核对标题/发布时间格式。'
      })
    }
    if (dataPhase === 'LOW_CONFIDENCE') {
      items.push({
        id: 'low-confidence',
        level: 'warning',
        message: '当前样本不足或口径不可比：趋势与增量信号仅供试探性参考。'
      })
    } else if (dataPhase === 'EMPTY') {
      items.push({
        id: 'empty',
        level: 'info',
        message: '未检测到可分析数据，请先导入“商品笔记表 + 笔记列表表”。'
      })
    }
    if (lastImportMessage.trim()) {
      items.push({ id: 'import', level: 'info', message: lastImportMessage.trim() })
    }
    items.push({
      id: 'monitor',
      level: 'info',
      message: monitorDir
        ? `监控目录已配置，自动监控${autoMonitorEnabled ? '开启' : '关闭'}，游标 ${scanCursorMs > 0 ? formatDateTime(scanCursorMs) : '-'}`
        : '监控目录未设置，可在“监控配置”中完成目录绑定。'
    })
    return items
  }, [
    autoMonitorEnabled,
    dataPhase,
    error,
    lastImportMessage,
    monitorDir,
    qualityLevel,
    scanCursorMs
  ])

  const topPriorityNotices = React.useMemo(() => {
    if (!notices.length) return []
    const maxPriority = Math.max(...notices.map((item) => noticePriority(item.level)))
    return notices.filter((item) => noticePriority(item.level) === maxPriority)
  }, [notices])

  const noticeGroupKey = React.useMemo(
    () => topPriorityNotices.map((item) => `${item.id}:${item.message}`).join('|'),
    [topPriorityNotices]
  )

  React.useEffect(() => {
    setNoticeCursor(0)
  }, [noticeGroupKey])

  React.useEffect(() => {
    if (topPriorityNotices.length <= 1) return
    const timer = window.setInterval(() => {
      setNoticeCursor((prev) => (prev + 1) % topPriorityNotices.length)
    }, 4500)
    return () => {
      window.clearInterval(timer)
    }
  }, [noticeGroupKey, topPriorityNotices.length])

  React.useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (monitorMenuRef.current && !monitorMenuRef.current.contains(target)) {
        setMonitorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [])

  React.useEffect(() => {
    if (!copyToastMessage) return
    const timer = window.setTimeout(() => {
      setCopyToastMessage('')
    }, 1800)
    return () => {
      window.clearTimeout(timer)
    }
  }, [copyToastMessage])

  const handleCopy = React.useCallback(async (value: string): Promise<boolean> => {
    const normalized = String(value ?? '').trim()
    if (!normalized) return false
    try {
      await navigator.clipboard.writeText(normalized)
      return true
    } catch {
      return false
    }
  }, [])

  const handleCopyActionList = React.useCallback(async (): Promise<void> => {
    const prefix =
      dataPhase === 'DAY2_PLUS' ? '' : '（低置信：当前样本不足或口径不可比，趋势仅供参考）\n'
    const lines = actionList.map(
      (item, index) =>
        `${index + 1}. [${item.priority}] ${item.title}（${item.account} / #${item.rank}）` +
        `\n   原因：${item.reason}` +
        `\n   动作：${item.action}`
    )
    const text = lines.length > 0 ? `${prefix}${lines.join('\n')}` : '暂无可执行清单'
    await handleCopy(text)
    setLastImportMessage('今日必做清单已复制')
  }, [actionList, dataPhase, handleCopy])

  const handlePickActionItem = React.useCallback((item: RaceActionItem): void => {
    setSelectedId(item.id)
    setMainView('monitor-hall')
    setDetailDrawerOpen(true)
  }, [])

  const handleSelectRow = React.useCallback((rowId: string): void => {
    setSelectedId(rowId)
    setDetailDrawerOpen(true)
  }, [])

  const handleOpenNoteLink = React.useCallback(
    async (noteKey: string): Promise<void> => {
      const targetUrl = buildNoteExternalUrl(noteKey)
      if (!targetUrl) {
        setError('当前笔记缺少可复制链接')
        return
      }
      const copied = await handleCopy(targetUrl)
      if (copied) {
        setCopyToastMessage('链接复制成功')
        setError('')
        return
      }
      setError('复制链接失败，请检查系统剪贴板权限')
    },
    [handleCopy]
  )

  const handleToggleGroup = React.useCallback((groupKey: string): void => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }))
  }, [])

  const handleImport = React.useCallback(async (): Promise<void> => {
    setImporting(true)
    setError('')
    try {
      const result = await window.api.cms.noteRace.importAutoFiles()

      if (result) {
        const totalImportedRows = result.importedItems.reduce(
          (sum, item) => sum + Number(item.importedRows || 0),
          0
        )
        setLastImportMessage(
          `已导入 ${result.importedFiles}/${result.selectedFiles} 个文件（商品 ${result.importedCommerceFiles}，内容 ${result.importedContentFiles}），共 ${totalImportedRows} 行`
        )
        if (result.failedFiles > 0) {
          const firstFailure = result.failures[0]
          setError(
            `自动识别导入失败 ${result.failedFiles} 个，首个：${firstFailure?.fileName ?? '-'} ${firstFailure?.message ?? ''}`.trim()
          )
        } else {
          setError('')
        }
      }

      await refresh()
    } catch (err) {
      setError(`导入失败：${normalizeError(err)}`)
    } finally {
      setImporting(false)
    }
  }, [refresh])

  const executeDeleteSnapshot = React.useCallback(
    async (rawSnapshotDate: string): Promise<void> => {
      const targetDate = String(rawSnapshotDate ?? '').trim()
      if (!targetDate) {
        setError('请先选择要删除的快照日期')
        return
      }

      const stat = snapshotStats.find((item) => item.snapshotDate === targetDate) ?? null
      const detailText = stat
        ? `商品 ${stat.commerceRows} 行，内容 ${stat.contentRows} 行，榜单 ${stat.rankRows} 行`
        : '当日全部导入数据'
      const accepted = window.confirm(
        `确认删除 ${targetDate} 的导入数据吗？\n\n` +
          `预计影响：${detailText}。\n` +
          '该操作不可恢复。'
      )
      if (!accepted) return

      setDeletingSnapshot(true)
      setError('')
      try {
        const result = (await window.api.cms.noteRace.deleteSnapshot({
          snapshotDate: targetDate
        })) as RaceDeleteSnapshotResult
        const summaryText =
          `已删除 ${result.snapshotDate}：商品 ${result.deletedCommerceRows} 行，` +
          `内容 ${result.deletedContentRows} 行，匹配 ${result.deletedMatchRows} 行，榜单 ${result.deletedRankRows} 行。`
        const recomputeText =
          result.recomputedSnapshots > 0 ? `已重算后续 ${result.recomputedSnapshots} 个日期。` : ''
        setLastImportMessage(`${summaryText}${recomputeText ? ` ${recomputeText}` : ''}`)
        await refresh()
      } catch (err) {
        setError(`删除失败：${normalizeError(err)}`)
      } finally {
        setDeletingSnapshot(false)
      }
    },
    [refresh, snapshotStats]
  )

  const executeDeleteBatch = React.useCallback(
    async (targetDate: string, importedAt: number): Promise<void> => {
      const normalizedDate = String(targetDate ?? '').trim()
      if (!normalizedDate) return
      if (!Number.isFinite(importedAt) || importedAt <= 0) return

      const batch = snapshotBatches.find(
        (item) =>
          item.status === 'active' &&
          item.snapshotDate === normalizedDate &&
          item.importedAt === importedAt
      )
      const detailText = batch
        ? `商品 ${batch.commerceRows} 行，内容 ${batch.contentRows} 行`
        : `批次 ${formatDateTime(importedAt)}`
      const accepted = window.confirm(
        `确认删除批次 ${formatDateTime(importedAt)} 吗？\n\n预计影响：${detailText}。\n该操作可在 7 天内恢复。`
      )
      if (!accepted) return

      const opKey = `${normalizedDate}:${importedAt}:delete`
      setBatchOperatingKey(opKey)
      setError('')
      try {
        const result = (await window.api.cms.noteRace.deleteSnapshotBatch({
          snapshotDate: normalizedDate,
          importedAt,
          reason: 'manual-ui'
        })) as RaceDeleteBatchResult
        setLastImportMessage(
          `已删除批次 ${formatDateTime(result.importedAt)}：商品 ${result.deletedCommerceRows} 行，` +
            `内容 ${result.deletedContentRows} 行。` +
            (result.recomputedSnapshots > 0 ? ` 已重算后续 ${result.recomputedSnapshots} 个日期。` : '')
        )
        await refresh()
        await loadSnapshotBatches(normalizedDate)
      } catch (err) {
        setError(`批次删除失败：${normalizeError(err)}`)
      } finally {
        setBatchOperatingKey('')
      }
    },
    [loadSnapshotBatches, refresh, snapshotBatches]
  )

  const executeRestoreBatch = React.useCallback(
    async (targetDate: string, importedAt: number): Promise<void> => {
      const normalizedDate = String(targetDate ?? '').trim()
      if (!normalizedDate) return
      if (!Number.isFinite(importedAt) || importedAt <= 0) return

      const accepted = window.confirm(
        `确认恢复批次 ${formatDateTime(importedAt)} 吗？\n\n系统将把该批次数据恢复到 ${normalizedDate} 并重算后续日期。`
      )
      if (!accepted) return

      const opKey = `${normalizedDate}:${importedAt}:restore`
      setBatchOperatingKey(opKey)
      setError('')
      try {
        const result = (await window.api.cms.noteRace.restoreSnapshotBatch({
          snapshotDate: normalizedDate,
          importedAt
        })) as RaceRestoreBatchResult
        setLastImportMessage(
          `已恢复批次 ${formatDateTime(result.importedAt)}：商品 ${result.restoredCommerceRows} 行，` +
            `内容 ${result.restoredContentRows} 行。` +
            (result.recomputedSnapshots > 0 ? ` 已重算后续 ${result.recomputedSnapshots} 个日期。` : '')
        )
        await refresh()
        await loadSnapshotBatches(normalizedDate)
      } catch (err) {
        setError(`批次恢复失败：${normalizeError(err)}`)
      } finally {
        setBatchOperatingKey('')
      }
    },
    [loadSnapshotBatches, refresh]
  )

  const handleDeleteSnapshot = React.useCallback(async (): Promise<void> => {
    await executeDeleteSnapshot(snapshotDate)
  }, [executeDeleteSnapshot, snapshotDate])

  const handleOpenDataManager = React.useCallback((): void => {
    setMonitorMenuOpen(false)
    const preferredDate = snapshotDate || managerDateOptions[0] || ''
    setManagerSnapshotDate(preferredDate)
    setDataManagerOpen(true)
    if (preferredDate) {
      void loadSnapshotBatches(preferredDate)
    }
  }, [loadSnapshotBatches, managerDateOptions, snapshotDate])

  const handlePickMonitorDir = React.useCallback(async (): Promise<void> => {
    try {
      const picked = await window.electronAPI.openDirectory()
      if (!picked) return
      setMonitorDir(picked)
      window.localStorage.setItem(MONITOR_DIR_STORAGE_KEY, picked)
      setLastImportMessage(`监控目录已设置：${picked}`)
      setError('')
    } catch (err) {
      setError(`选择目录失败：${normalizeError(err)}`)
    }
  }, [])

  const runFolderScan = React.useCallback(
    async (mode: 'manual' | 'auto'): Promise<void> => {
      if (mode === 'auto' && (monitorMenuOpen || detailDrawerOpen)) return
      if (mode === 'auto' && typeof document !== 'undefined') {
        const activeElement = document.activeElement as HTMLElement | null
        if (activeElement && ['SELECT', 'INPUT', 'TEXTAREA'].includes(activeElement.tagName)) {
          return
        }
      }
      if (!monitorDir) {
        if (mode === 'manual') {
          setError('请先选择监控目录')
        }
        return
      }
      if (scanInFlightRef.current) return

      scanInFlightRef.current = true
      if (mode === 'manual') {
        setScanLoading(true)
      }
      try {
        const result = (await window.api.cms.noteRace.scanFolderImports({
          dirPath: monitorDir,
          sinceMs: scanCursorMs
        })) as RaceFolderScanResult

        const nextCursor = Math.max(scanCursorMs, Number(result.latestMtimeMs) || 0)
        setScanCursorMs(nextCursor)
        window.localStorage.setItem(MONITOR_CURSOR_STORAGE_KEY, String(nextCursor))

        if (result.importedFiles > 0) {
          setLastImportMessage(
            `目录新增 ${result.importedFiles} 个文件（商品 ${result.importedCommerceFiles}，内容 ${result.importedContentFiles}），已自动导入`
          )
          await refresh({ preserveScroll: mode === 'auto' })
        } else if (mode === 'manual') {
          setLastImportMessage(
            `扫描完成：扫描 ${result.scannedFiles}，历史跳过 ${result.skippedOldFiles}，未发现新可导入文件`
          )
        }

        if (result.failedFiles > 0) {
          const first = result.failures[0]
          setError(
            `目录导入失败 ${result.failedFiles} 个，首个：${first?.fileName ?? '-'} ${first?.message ?? ''}`.trim()
          )
          return
        }

        setError('')
      } catch (err) {
        setError(`目录扫描失败：${normalizeError(err)}`)
      } finally {
        scanInFlightRef.current = false
        if (mode === 'manual') {
          setScanLoading(false)
        }
      }
    },
    [detailDrawerOpen, monitorDir, monitorMenuOpen, refresh, scanCursorMs]
  )

  const handleToggleAutoMonitor = React.useCallback((): void => {
    setAutoMonitorEnabled((prev) => {
      const next = !prev
      window.localStorage.setItem(MONITOR_ENABLE_STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  React.useEffect(() => {
    if (!autoMonitorEnabled || !monitorDir) return
    void runFolderScan('auto')
    const timer = window.setInterval(() => {
      void runFolderScan('auto')
    }, 15000)
    return () => {
      window.clearInterval(timer)
    }
  }, [autoMonitorEnabled, monitorDir, runFolderScan])

  const handleSnapshotDateChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextDate = event.target.value
      setSnapshotDate(nextDate)
      void loadRows(nextDate, { preserveScroll: true })
    },
    [loadRows]
  )

  const activeNotice = topPriorityNotices.length
    ? topPriorityNotices[noticeCursor % topPriorityNotices.length]
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-zinc-100">笔记赛马监控</h1>
            <p className="text-xs text-zinc-400">重点监控清单（趋势优先）</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              title="选择 Excel（支持多选，自动识别导入）"
            >
              <Download className="h-3.5 w-3.5" />
              {importing ? '识别导入中...' : '导入数据'}
            </button>

            <div ref={monitorMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setMonitorMenuOpen((prev) => !prev)
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-3 text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200"
                title="监控配置"
              >
                <Settings2 className="h-3.5 w-3.5" />
                监控配置
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {monitorMenuOpen ? (
                <div className="absolute right-0 top-9 z-40 w-72 rounded-md border border-zinc-700 bg-zinc-900/95 p-2 shadow-xl backdrop-blur">
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMonitorMenuOpen(false)
                        void handlePickMonitorDir()
                      }}
                      className="flex h-8 w-full items-center rounded border border-zinc-700 bg-zinc-900 px-2 text-left text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200"
                    >
                      {monitorDir ? '更换业务目录' : '选择业务目录'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMonitorMenuOpen(false)
                        void runFolderScan('manual')
                      }}
                      disabled={scanLoading || !monitorDir}
                      className="flex h-8 w-full items-center rounded border border-zinc-700 bg-zinc-900 px-2 text-left text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {scanLoading ? '扫描中...' : '扫描目录'}
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenDataManager}
                      className="flex h-8 w-full items-center rounded border border-zinc-700 bg-zinc-900 px-2 text-left text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200"
                    >
                      导入日期管理
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleAutoMonitor}
                      className={cn(
                        'flex h-8 w-full items-center rounded border px-2 text-left transition',
                        autoMonitorEnabled
                          ? 'border-emerald-500/45 bg-emerald-500/5 text-emerald-200'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-cyan-500 hover:text-cyan-200'
                      )}
                    >
                      <span
                        className={cn(
                          'mr-1.5 inline-flex h-1.5 w-1.5 rounded-full',
                          autoMonitorEnabled ? 'bg-emerald-400' : 'bg-zinc-500'
                        )}
                      />
                      自动监控：{autoMonitorEnabled ? '开' : '关'}
                    </button>
                  </div>
                  <div className="mt-2 rounded border border-zinc-700 bg-zinc-950/80 px-2 py-1.5 text-[10px] text-zinc-400">
                    <div className="truncate">目录：{monitorDir || '未设置'}</div>
                    <div className="mt-1">
                      游标：{scanCursorMs > 0 ? formatDateTime(scanCursorMs) : '-'}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              title="刷新"
            >
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 pt-2">
        <div
          className={cn(
            'mb-2 flex h-8 items-center justify-between rounded border px-3 text-[12px]',
            noticeClasses(activeNotice?.level ?? 'info')
          )}
        >
          <div className="truncate">{activeNotice?.message ?? '系统状态正常'}</div>
          {topPriorityNotices.length > 1 ? (
            <button
              type="button"
              onClick={() => setNoticeCursor((prev) => (prev + 1) % topPriorityNotices.length)}
              className="ml-2 shrink-0 rounded px-1.5 text-[10px] text-zinc-300 transition hover:bg-zinc-800"
              title="下一条状态"
            >
              {noticeCursor + 1}/{topPriorityNotices.length} ▸
            </button>
          ) : null}
        </div>

        <section className="mb-2 flex h-10 items-center justify-between rounded border border-zinc-800 bg-zinc-900/55 px-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2 text-[11px]">
            <select
              value={snapshotDate}
              onChange={handleSnapshotDateChange}
              disabled={snapshotDates.length === 0}
              className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
              title="快照日期"
            >
              {snapshotDates.length === 0 ? (
                <option value="">暂无快照</option>
              ) : (
                snapshotDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))
              )}
            </select>

            <button
              type="button"
              onClick={() => void handleDeleteSnapshot()}
              disabled={!snapshotDate || deletingSnapshot}
              className="inline-flex h-7 items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 text-rose-200 transition hover:border-rose-400 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              title="删除当前日期导入数据（不可恢复）"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deletingSnapshot ? '删除中...' : '删除当日'}
            </button>

            <select
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
              title="账号筛选"
            >
              {accountOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              value={noteType}
              onChange={(event) => setNoteType(event.target.value as NoteType)}
              className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
              title="体裁筛选"
            >
              {NOTE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden shrink-0 items-center gap-2 text-[11px] text-zinc-400 lg:flex">
            <span>评估 {summary.assessedCount}</span>
            <span>
              匹配率 {dataPhase === 'EMPTY' ? '-' : `${Math.round(summary.matchRate * 100)}%`}
            </span>
            <span>P0 {p0Count}</span>
            <span>P1 {p1Count}</span>
            <span>P2 {p2Count}</span>
          </div>
        </section>

        <div className="mb-3">
          <Tabs
            value={mainView}
            onValueChange={(next) => setMainView(next as MainView)}
            items={MAIN_VIEW_TABS}
          />
        </div>
      </div>

      {mainView === 'action-console' ? (
        <div className="min-h-0 flex-1 px-4 pb-4">
          <section className="flex h-full min-h-0 flex-col rounded-xl border border-zinc-800 bg-zinc-900/45">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">行动指挥台（Top 10）</h3>
                <p className="text-xs text-zinc-400">按优先级排序，聚焦当日执行动作</p>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyActionList()}
                disabled={actionList.length === 0}
                className="inline-flex h-8 items-center rounded border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-300 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
                title="复制清单"
              >
                复制清单
              </button>
            </div>
            {dataPhase === 'LOW_CONFIDENCE' ? (
              <div className="mx-3 mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                低置信：当前样本不足或口径不可比，动作建议用于试探性执行。
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {actionList.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-sm text-zinc-500">
                  {dataPhase === 'EMPTY' ? '暂无可执行清单（等待首日数据）' : '暂无可执行清单'}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {actionList.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handlePickActionItem(item)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900/75 p-3 text-left transition hover:border-cyan-500"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">#{index + 1}</span>
                        <span
                          className={cn(
                            'inline-flex rounded border px-1.5 py-0.5 text-[10px]',
                            priorityClass(item.priority)
                          )}
                        >
                          {item.priority}
                        </span>
                        <TagStatus tag={item.tag} compact />
                        <span className="ml-auto text-[11px] text-zinc-500">榜单 #{item.rank}</span>
                      </div>
                      <div
                        className="mt-2 truncate text-[15px] font-semibold text-zinc-50"
                        title={item.title}
                      >
                        {item.title}
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">{item.account || '-'}</div>
                      <div className="mt-4 space-y-3">
                        <div className="space-y-1">
                          <div className="text-[12px] text-zinc-500/50">原因</div>
                          <div className="text-[14px] leading-6 text-zinc-100">{item.reason}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-[12px] text-zinc-500/50">动作建议</div>
                          <div className="text-[14px] leading-6 text-zinc-100">{item.action}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-4 pb-4">
          <div className="flex h-full min-h-0 flex-col">
            <section className="mb-2 flex h-10 items-center justify-between rounded border border-zinc-800 bg-zinc-900/55 px-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-2 text-[11px]">
                <div
                  className="inline-flex h-7 items-center rounded border border-zinc-700 bg-zinc-950 p-0.5"
                  role="radiogroup"
                  aria-label="监控视图切换"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={viewMode === 'flat'}
                    onClick={() => setViewMode('flat')}
                    className={cn(
                      'inline-flex h-6 items-center rounded px-2 text-[11px] transition',
                      viewMode === 'flat'
                        ? 'bg-zinc-100 text-zinc-900'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                    )}
                  >
                    ≡ 笔记平铺
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={viewMode === 'grouped'}
                    onClick={() => setViewMode('grouped')}
                    className={cn(
                      'inline-flex h-6 items-center rounded px-2 text-[11px] transition',
                      viewMode === 'grouped'
                        ? 'bg-zinc-100 text-zinc-900'
                        : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                    )}
                  >
                    ⊞ 商品聚合
                  </button>
                </div>

                <select
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
                  className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
                  title="优先级筛选"
                >
                  <option value="all">全部优先级</option>
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                </select>

                <select
                  value={signalFilter}
                  onChange={(event) => setSignalFilter(event.target.value as SignalFilter)}
                  className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
                  title="信号筛选"
                >
                  <option value="all">所有信号</option>
                  <option value="opportunity">机会信号</option>
                  <option value="alert">风险信号</option>
                  <option value="rising">起飞</option>
                  <option value="mine-clear">排雷（风险/掉速）</option>
                </select>

                <select
                  value={stageFilter}
                  onChange={(event) => setStageFilter(event.target.value as StageFilter)}
                  className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
                  title="阶段筛选"
                >
                  <option value="all">所有阶段</option>
                  <option value="new">存活首日</option>
                  <option value="revival">长尾复活</option>
                  <option value="s1">S1 起量</option>
                  <option value="s2">S2 导流</option>
                  <option value="s3">S3 成交</option>
                  <option value="s4">S4 成交放大</option>
                </select>
              </div>
              <div className="hidden shrink-0 items-center gap-2 text-[11px] text-zinc-400 lg:flex">
                <span>机会 {opportunityCount}</span>
                <span>风险 {riskSignalCount}</span>
                <span>起飞 {summary.risingCount}</span>
                <span>长尾复活 {summary.revivalCount}</span>
                <span>掉速 {summary.dropCount}</span>
                <span>风险标签 {summary.riskCount}</span>
              </div>
            </section>

            <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/45">
              <div className="border-b border-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100">
                重点监控清单（Top 12）
              </div>
              <div ref={tableScrollRef} className="min-h-0 h-full overflow-auto">
                <div
                  className="sticky top-0 z-10 grid h-11 items-center border-b border-zinc-800 bg-zinc-900/90 px-2 text-[11px] font-medium text-zinc-400 backdrop-blur"
                  style={{ gridTemplateColumns: MONITOR_TABLE_COLUMNS }}
                >
                  {viewMode === 'flat' ? (
                    <>
                      <span className="pr-2 text-right">排名</span>
                      <span>标签</span>
                      <span>账号</span>
                      <span>笔记标题</span>
                      <span className="text-right">笔记年龄</span>
                      <span className="text-right">赛马分</span>
                      <span className="text-right">趋势</span>
                      <span className="text-right">内容信号</span>
                      <span className="text-right">商品信号</span>
                      <span>阶段</span>
                    </>
                  ) : (
                    <>
                      <span className="pr-2 text-right">展开</span>
                      <span>优先级</span>
                      <span>聚合类型</span>
                      <span>商品名称</span>
                      <span className="text-right">笔记数</span>
                      <span className="text-right">最高赛马分</span>
                      <span className="text-right">曝光/阅读</span>
                      <span className="text-right">核心状态</span>
                      <span className="text-right">商品侧信号</span>
                      <span>阶段</span>
                    </>
                  )}
                </div>

                {loading ? <div className="px-3 py-6 text-sm text-zinc-500">加载中...</div> : null}

                {!loading && rows.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-zinc-500">
                    {dataPhase === 'EMPTY'
                      ? '暂无数据，请先导入首日表格'
                      : '当前筛选条件下暂无数据'}
                  </div>
                ) : null}

                {viewMode === 'flat'
                  ? rows.map((row) => {
                      const rowAction =
                        actionMap.get(row.id) ??
                        (dataPhase === 'DAY2_PLUS'
                          ? buildActionItem(row)
                          : buildActionItemDay1(row))
                      const trendLabel =
                        dataPhase === 'DAY2_PLUS' ? formatTrendDelta(row.trendDelta) : '样本不足'
                      const trendClass =
                        dataPhase === 'DAY2_PLUS'
                          ? trendDeltaClass(row.trendDelta)
                          : 'text-zinc-500'
                      return (
                        <MonitorTableRow
                          key={row.id}
                          row={row}
                          priority={rowAction.priority}
                          isSelected={selected?.id === row.id}
                          trendLabel={trendLabel}
                          trendClass={trendClass}
                          onSelect={handleSelectRow}
                          onOpenLink={handleOpenNoteLink}
                        />
                      )
                    })
                  : groupedRows.map((group) => {
                      const expanded = expandedGroups[group.key] ?? false
                      const stateLabels: string[] = []
                      if (group.hasRisk) stateLabels.push('风险')
                      if (group.hasRising) stateLabels.push('起飞')
                      if (group.hasRevival) stateLabels.push('复活')
                      if (group.hasDrop) stateLabels.push('掉速')
                      const stateSummary = stateLabels.length > 0 ? stateLabels.join(' / ') : '稳定'
                      const funnelSummary =
                        group.totalExposure == null || group.totalRead == null
                          ? '- / -'
                          : `${group.totalExposure} / ${group.totalRead}`

                      return (
                        <React.Fragment key={group.key}>
                          <button
                            type="button"
                            onClick={() => handleToggleGroup(group.key)}
                            className={cn(
                              'grid h-[56px] w-full items-center border-b border-zinc-800/45 px-2 text-left text-[12px] transition hover:bg-zinc-800/35',
                              expanded && 'bg-zinc-900/50'
                            )}
                            style={{ gridTemplateColumns: MONITOR_TABLE_COLUMNS }}
                            title={group.productName}
                          >
                            <span className="inline-flex items-center justify-end pr-2 text-zinc-400">
                              <ChevronRight
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform',
                                  expanded && 'rotate-90 text-zinc-200'
                                )}
                              />
                            </span>
                            <span
                              className={cn(
                                'inline-flex max-w-[74px] rounded border px-1.5 py-0.5 text-[10px]',
                                priorityClass(group.maxPriority)
                              )}
                            >
                              {group.maxPriority}
                            </span>
                            <span className="truncate text-zinc-400">商品聚合</span>
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-semibold text-zinc-100">
                                {group.productName}
                              </span>
                              <span className="inline-flex shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300">
                                共 {group.noteCount} 篇
                              </span>
                            </span>
                            <span className="text-right tabular-nums text-zinc-300">
                              {group.noteCount}
                            </span>
                            <span className="text-right tabular-nums text-zinc-100">
                              {group.maxScore.toFixed(1)}
                            </span>
                            <span className="text-right tabular-nums text-zinc-400">
                              {funnelSummary}
                            </span>
                            <span className="truncate text-right text-zinc-300">
                              {stateSummary}
                            </span>
                            <span className="text-right text-zinc-500">-</span>
                            <span className="text-zinc-500">聚合</span>
                          </button>

                          {expanded
                            ? group.rows.map((row) => {
                                const rowAction =
                                  actionMap.get(row.id) ??
                                  (dataPhase === 'DAY2_PLUS'
                                    ? buildActionItem(row)
                                    : buildActionItemDay1(row))
                                const trendLabel =
                                  dataPhase === 'DAY2_PLUS'
                                    ? formatTrendDelta(row.trendDelta)
                                    : '样本不足'
                                const trendClass =
                                  dataPhase === 'DAY2_PLUS'
                                    ? trendDeltaClass(row.trendDelta)
                                    : 'text-zinc-500'

                                return (
                                  <MonitorTableRow
                                    key={`${group.key}:${row.id}`}
                                    row={row}
                                    priority={rowAction.priority}
                                    isSelected={selected?.id === row.id}
                                    trendLabel={trendLabel}
                                    trendClass={trendClass}
                                    onSelect={handleSelectRow}
                                    onOpenLink={handleOpenNoteLink}
                                    indented
                                    className="bg-zinc-900/25"
                                  />
                                )
                              })
                            : null}
                        </React.Fragment>
                      )
                    })}
              </div>
            </section>
          </div>
        </div>
      )}

      {copyToastMessage ? (
        <div className="pointer-events-none fixed left-1/2 top-8 z-50 -translate-x-1/2 rounded-md border border-emerald-400/60 bg-emerald-500/12 px-3 py-1.5 text-xs text-emerald-100 shadow-lg">
          {copyToastMessage}
        </div>
      ) : null}

      <Drawer
        open={dataManagerOpen}
        onOpenChange={setDataManagerOpen}
        title="导入日期管理"
        description="按日期查看导入规模并执行删除"
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300">
            批次删除支持 7 天内恢复；日期删除属于最终删除（不可恢复）。
          </div>

          <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-400">批次日期</span>
              <select
                value={managerSnapshotDate}
                onChange={(event) => {
                  const nextDate = event.target.value
                  setManagerSnapshotDate(nextDate)
                  void loadSnapshotBatches(nextDate)
                }}
                className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
              >
                {managerDateOptions.length === 0 ? (
                  <option value="">暂无快照</option>
                ) : (
                  managerDateOptions.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={() => void loadSnapshotBatches(managerSnapshotDate || snapshotDate)}
                disabled={snapshotBatchesLoading || !(managerSnapshotDate || snapshotDate)}
                className="inline-flex h-7 items-center rounded border border-zinc-700 bg-zinc-900 px-2 text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                刷新批次
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/60">
            <div className="border-b border-zinc-700 bg-zinc-900/80 px-3 py-2 text-[11px] text-zinc-400">
              批次管理（单批次可删除/恢复）
            </div>

            {snapshotBatchesLoading ? (
              <div className="px-3 py-2 text-xs text-zinc-500">批次统计加载中...</div>
            ) : null}

            {!snapshotBatchesLoading && snapshotBatches.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-500">当前日期暂无批次数据</div>
            ) : null}

            {!snapshotBatchesLoading && snapshotBatches.length > 0 ? (
              <div className="max-h-[44vh] overflow-auto">
                <div className="grid grid-cols-[132px_72px_150px_1fr_88px] border-b border-zinc-700 px-3 py-2 text-[11px] text-zinc-400">
                  <span>批次时间</span>
                  <span>状态</span>
                  <span>导入规模</span>
                  <span>来源文件</span>
                  <span className="text-right">操作</span>
                </div>
                {snapshotBatches.map((item) => {
                  const sourceSummary =
                    item.sourceFiles.length <= 0
                      ? '-'
                      : item.sourceFiles.length <= 2
                        ? item.sourceFiles.join(' / ')
                        : `${item.sourceFiles.slice(0, 2).join(' / ')} 等${item.sourceFiles.length}个`
                  const opDeleteKey = `${item.snapshotDate}:${item.importedAt}:delete`
                  const opRestoreKey = `${item.snapshotDate}:${item.importedAt}:restore`
                  const isOperating =
                    batchOperatingKey === opDeleteKey || batchOperatingKey === opRestoreKey
                  return (
                    <div
                      key={`${item.snapshotDate}:${item.importedAt}:${item.status}`}
                      className="grid grid-cols-[132px_72px_150px_1fr_88px] items-center border-b border-zinc-800/70 px-3 py-2 text-[12px] text-zinc-200"
                    >
                      <span className="tabular-nums text-zinc-300">{formatDateTime(item.importedAt)}</span>
                      <span>
                        <span
                          className={cn(
                            'inline-flex rounded border px-1.5 py-0.5 text-[10px]',
                            item.status === 'active'
                              ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-200'
                              : 'border-amber-500/45 bg-amber-500/10 text-amber-200'
                          )}
                        >
                          {item.status === 'active' ? '生效中' : '已删除'}
                        </span>
                      </span>
                      <span className="truncate text-zinc-300">
                        商品 {item.commerceRows} · 内容 {item.contentRows}
                      </span>
                      <span className="truncate text-zinc-400" title={item.sourceFiles.join('\n')}>
                        {sourceSummary}
                      </span>
                      <div className="text-right">
                        {item.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => void executeDeleteBatch(item.snapshotDate, item.importedAt)}
                            disabled={deletingSnapshot || isOperating}
                            className="inline-flex h-6 items-center rounded border border-rose-500/40 bg-rose-500/10 px-2 text-[11px] text-rose-200 transition hover:border-rose-400 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            title="删除该批次（7天内可恢复）"
                          >
                            {isOperating ? '处理中...' : '删除'}
                          </button>
                        ) : item.restorable ? (
                          <button
                            type="button"
                            onClick={() => void executeRestoreBatch(item.snapshotDate, item.importedAt)}
                            disabled={deletingSnapshot || isOperating}
                            className="inline-flex h-6 items-center rounded border border-cyan-500/40 bg-cyan-500/10 px-2 text-[11px] text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            title={`可恢复至：${item.restorableUntil ? formatDateTime(item.restorableUntil) : '-'}`}
                          >
                            {isOperating ? '处理中...' : '恢复'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-zinc-500">已过期</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>

          {snapshotStatsLoading ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
              日期统计加载中...
            </div>
          ) : null}

          {!snapshotStatsLoading && snapshotStats.length === 0 ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
              暂无可管理的导入日期
            </div>
          ) : null}

          {!snapshotStatsLoading && snapshotStats.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/60">
              <div className="grid grid-cols-[120px_1fr_90px_130px_70px] border-b border-zinc-700 bg-zinc-900/80 px-3 py-2 text-[11px] text-zinc-400">
                <span>快照日期</span>
                <span>导入规模</span>
                <span className="text-right">匹配率</span>
                <span className="text-right">最近导入</span>
                <span className="text-right">操作</span>
              </div>
              <div className="max-h-[56vh] overflow-auto">
                {snapshotStats.map((item) => {
                  const isCurrent = snapshotDate === item.snapshotDate
                  const matchRate =
                    item.rankRows > 0
                      ? Math.round((Math.max(0, item.matchedRows) / Math.max(1, item.rankRows)) * 100)
                      : 0
                  return (
                    <div
                      key={item.snapshotDate}
                      className={cn(
                        'grid grid-cols-[120px_1fr_90px_130px_70px] items-center border-b border-zinc-800/70 px-3 py-2 text-[12px] text-zinc-200',
                        isCurrent && 'bg-cyan-500/10'
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          'truncate text-left transition hover:text-cyan-300',
                          isCurrent && 'font-semibold text-cyan-200'
                        )}
                        onClick={() => {
                          setSnapshotDate(item.snapshotDate)
                          void loadRows(item.snapshotDate, { preserveScroll: true })
                        }}
                        title="定位到该日期"
                      >
                        {item.snapshotDate}
                      </button>
                      <span className="truncate text-zinc-300">
                        商品 {item.commerceRows} · 内容 {item.contentRows} · 榜单 {item.rankRows}
                      </span>
                      <span className="text-right tabular-nums text-zinc-300">{matchRate}%</span>
                      <span className="text-right tabular-nums text-zinc-400">
                        {item.latestImportedAt ? formatDateTime(item.latestImportedAt) : '-'}
                      </span>
                      <div className="text-right">
                        <button
                          type="button"
                          onClick={() => void executeDeleteSnapshot(item.snapshotDate)}
                          disabled={deletingSnapshot}
                          className="inline-flex h-6 items-center rounded border border-rose-500/40 bg-rose-500/10 px-2 text-[11px] text-rose-200 transition hover:border-rose-400 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                          title="删除该日期"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Drawer
        open={detailDrawerOpen}
        onOpenChange={setDetailDrawerOpen}
        title="笔记详情"
        description={
          selected ? `${selected.account || '未命名账号'} · ${selected.title}` : '未选中笔记'
        }
      >
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100">详情总览</h3>
              <TagStatus tag={selected.tag} />
            </div>

            <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
              <h4 className="text-xs font-semibold text-zinc-200">基础信息</h4>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <KeyValue
                  label="笔记ID"
                  value={detail?.noteId || selected.id}
                  action={
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded border border-zinc-700 text-zinc-300 hover:border-cyan-500 hover:text-cyan-200"
                      onClick={() => void handleCopy(detail?.noteId || selected.id)}
                      title="复制笔记ID"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  }
                />
                <KeyValue label="账号" value={selected.account || '-'} />
                <KeyValue
                  label="发布时间"
                  value={
                    detail?.createdAt
                      ? formatDateTime(detail.createdAt)
                      : `${snapshotDate || '-'}（D+1监控）`
                  }
                />
                <KeyValue label="体裁" value={selected.noteType} />
                <KeyValue label="关联商品" value={selected.productName || '-'} />
                <KeyValue label="阶段" value={selected.stageLabel || '-'} />
              </div>
            </section>

            {detailLoading ? (
              <div className="rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
                详情加载中...
              </div>
            ) : null}

            <ScoreBreakdownCard row={selected} detail={detail} />

            <FunnelChart title="内容漏斗" metrics={detail?.contentFunnel ?? []} />
            <FunnelChart title="商品漏斗" metrics={detail?.commerceFunnel ?? []} />

            <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
              <h4 className="text-sm font-semibold text-zinc-100">趋势信号</h4>
              {dataPhase !== 'DAY2_PLUS' ? (
                <div className="mt-2 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                  样本不足或口径不可比：仅当连续两天均为“近1日”同口径快照时才显示增量趋势
                </div>
              ) : null}
              <div className="mt-2">
                <TrendSparkline values={detail?.sparkline ?? []} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                <DeltaCard
                  label="d阅读"
                  value={dataPhase === 'DAY2_PLUS' ? (detail?.deltas.read ?? 0) : null}
                />
                <DeltaCard
                  label="d点击"
                  value={dataPhase === 'DAY2_PLUS' ? (detail?.deltas.click ?? 0) : null}
                />
                <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
                  <div className="text-[10px] text-zinc-400">加速度</div>
                  <div className="text-zinc-200">
                    {dataPhase === 'DAY2_PLUS'
                      ? `${(detail?.deltas.acceleration ?? 1).toFixed(2)}x`
                      : '--'}
                  </div>
                </div>
                <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
                  <div className="text-[10px] text-zinc-400">7日稳定性</div>
                  <div className="text-zinc-200">
                    {dataPhase === 'DAY2_PLUS' ? (detail?.deltas.stability ?? '中') : '--'}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
              <h4 className="text-sm font-semibold text-zinc-100">阶段进度</h4>
              <div className="mt-2 flex items-center gap-1 text-[11px]">
                {[1, 2, 3, 4, 5].map((stage) => {
                  const active = stage <= selectedStageIndex
                  const current = stage === selectedStageIndex
                  return (
                    <React.Fragment key={stage}>
                      <span
                        className={cn(
                          'inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5',
                          current
                            ? 'border-cyan-400/70 bg-transparent text-cyan-200'
                            : active
                              ? 'border-zinc-500/50 bg-transparent text-zinc-300'
                              : 'border-zinc-700 bg-transparent text-zinc-500'
                        )}
                      >
                        S{stage}
                      </span>
                      {stage < 5 ? <span className="text-zinc-600">──</span> : null}
                    </React.Fragment>
                  )
                })}
              </div>
            </section>
          </div>
        ) : (
          <div className="text-sm text-zinc-400">暂无笔记详情</div>
        )}
      </Drawer>
    </div>
  )
}

function TagStatus({
  tag,
  compact = false
}: {
  tag: NoteTag
  compact?: boolean
}): React.JSX.Element {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', compact ? 'text-[10px]' : 'text-[11px]')}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tagDotClasses(tag))} />
      <span className={tagTextClasses(tag)}>{tag}</span>
    </span>
  )
}

function SignalColumn({ signals }: { signals: Signal[] }): React.JSX.Element {
  const display = signals.slice(0, 2)
  return (
    <span className="flex items-center justify-end gap-1 overflow-hidden tabular-nums">
      {display.map((signal) => (
        <span
          key={signal.label}
          className={cn(
            'inline-flex max-w-[82px] justify-end truncate rounded-[4px] border px-[4px] py-[1px] text-[10px]',
            signalClasses(signal.tone)
          )}
        >
          {signal.label}
        </span>
      ))}
    </span>
  )
}

function ScoreBreakdownCard({
  row,
  detail
}: {
  row: RaceListRow
  detail: RaceDetail | null
}): React.JSX.Element {
  const data = resolveScoreBreakdown(row, detail)
  return (
    <section className="rounded-lg border border-zinc-700/70 bg-[rgba(255,255,255,0.03)] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-zinc-100">赛马分归因</h4>
        {data.penaltyTriggered ? (
          <span className="inline-flex rounded border border-[rgba(255,67,67,0.4)] bg-[rgba(255,67,67,0.1)] px-2 py-0.5 text-[10px] text-[#ff4d4f]">
            {data.penaltyText ?? '🚨 转化链路高危'}
          </span>
        ) : (
          <span className="inline-flex rounded border border-zinc-600/50 bg-transparent px-2 py-0.5 text-[10px] text-zinc-400">
            ✓ 链路健康
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-[132px_minmax(0,1fr)] gap-4">
        <div className="rounded border border-zinc-700/70 bg-zinc-900/55 px-2.5 py-2">
          <div className="text-[10px] text-zinc-500">综合赛马分</div>
          <div className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-zinc-50">
            {formatBreakdownValue(data.totalScore)}
          </div>
        </div>

        <div className="space-y-2">
          {data.parts.map((part) => {
            const valueText =
              part.value == null
                ? '-'
                : `${formatBreakdownValue(part.value)} · ${part.sharePercent.toFixed(1)}%`
            return (
              <div key={part.id}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-300">{part.label}</span>
                  <span className="tabular-nums text-zinc-400">{valueText}</span>
                </div>
                <div className="h-[6px] overflow-hidden rounded-[3px] bg-zinc-800/80">
                  <div
                    className={cn('h-full rounded-[3px]', part.barClassName)}
                    style={{ width: `${part.widthPercent}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {data.allPartsMissing ? (
        <div className="mt-2 text-[10px] text-zinc-500">
          子项得分未下发，已回退到总分与风险诊断展示。
        </div>
      ) : null}
    </section>
  )
}

function DeltaCard({ label, value }: { label: string; value: number | null }): React.JSX.Element {
  if (value == null) {
    return (
      <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
        <div className="text-[10px] text-zinc-400">{label}</div>
        <div className="text-zinc-500">--</div>
      </div>
    )
  }
  const className = value > 0 ? 'text-emerald-300' : value < 0 ? 'text-rose-300' : 'text-zinc-300'
  const prefix = value > 0 ? '+' : ''
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
      <div className="text-[10px] text-zinc-400">{label}</div>
      <div className={className}>
        {prefix}
        {value}
      </div>
    </div>
  )
}

function KeyValue({
  label,
  value,
  action
}: {
  label: string
  value: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
      <div className="text-[10px] text-zinc-400">{label}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-zinc-100">
        <span className="truncate">{value}</span>
        {action}
      </div>
    </div>
  )
}

export { NoteRaceBoard }
