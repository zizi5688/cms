import * as React from 'react'

import { ChevronDown, Copy, Download, RefreshCcw, Settings2 } from 'lucide-react'

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
}

type RaceImportResult = {
  snapshotDate: string
  sourceFile: string
  importedRows: number
  matchedRows?: number
  totalRows?: number
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
type DataPhase = 'EMPTY' | 'DAY1' | 'DAY2_PLUS'
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

const NOTE_TYPES: NoteType[] = ['全部', '图文', '视频']
const MONITOR_DIR_STORAGE_KEY = 'note-race:monitor-dir:v1'
const MONITOR_ENABLE_STORAGE_KEY = 'note-race:monitor-enable:v1'
const MONITOR_CURSOR_STORAGE_KEY = 'note-race:monitor-cursor:v1'

function tagClasses(tag: NoteTag): string {
  if (tag === '起飞') return 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
  if (tag === '掉速' || tag === '长尾复活')
    return 'border border-amber-500/40 bg-amber-500/15 text-amber-300'
  if (tag === '风险') return 'border border-rose-500/40 bg-rose-500/15 text-rose-300'
  return 'border border-cyan-500/35 bg-cyan-500/15 text-cyan-300'
}

function signalClasses(tone: SignalTone): string {
  if (tone === 'positive') return 'border-emerald-500/70 text-emerald-300'
  if (tone === 'negative') return 'border-rose-500/70 text-rose-300'
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
  if (level === 'danger') return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
  if (level === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  return 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200'
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
      reason: `首日高分 ${row.score.toFixed(1)}，当前仅 1 日样本`,
      action: '先小步放大：围绕同题材补 1 条，并在明日重点看点击与评论增量'
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
      reason: `首日阶段 ${row.stageLabel}，具备继续观察价值`,
      action: '推进转化表达：优化封面标题和首屏卖点，等待次日增量确认'
    }
  }
  return {
    id: row.id,
    rank: row.rank,
    title: row.title,
    account: row.account,
    tag: row.tag,
    priority: 'P2',
    reason: `首日样本不足，暂不做趋势结论`,
    action: '常规观察：先保留样本，不做大动作，等待第 2 日数据'
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

function FunnelBlock({
  title,
  metrics,
  fillClassName
}: {
  title: string
  metrics: FunnelMetric[]
  fillClassName: string
}): React.JSX.Element {
  if (!metrics.length) {
    return (
      <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
        <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
        <div className="mt-2 text-xs text-zinc-500">暂无漏斗数据</div>
      </section>
    )
  }

  const base = metrics[0]?.value || 1
  return (
    <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
      <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
      <div className="mt-3 space-y-2.5">
        {metrics.map((metric, index) => {
          const width = Math.max(0, Math.min(100, (metric.value / base) * 100))
          return (
            <div key={`${metric.label}-${index}`}>
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <span>{metric.label}</span>
                <span>{metric.value.toLocaleString()}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-zinc-800">
                <div
                  className={cn('h-full rounded', fillClassName)}
                  style={{ width: `${width}%` }}
                />
              </div>
              {metric.conversionLabel && typeof metric.conversionValue === 'number' ? (
                <div className="mt-1 pl-2 text-[10px] text-zinc-400">
                  ↳ 转化率 {metric.conversionValue.toFixed(1)}%（{metric.conversionLabel}）
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
  const isRising = values[values.length - 1] >= values[0]
  const stroke = isRising ? '#10B981' : '#EF4444'
  const fill = isRising ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)'
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return { x, y }
  })
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none">
      <path d={area} fill={fill} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NoteRaceBoard(): React.JSX.Element {
  const [snapshotDates, setSnapshotDates] = React.useState<string[]>([])
  const [snapshotDate, setSnapshotDate] = React.useState<string>('')
  const [account, setAccount] = React.useState<string>('全部账号')
  const [noteType, setNoteType] = React.useState<NoteType>('全部')
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
    matchRate: 0
  })
  const [loading, setLoading] = React.useState<boolean>(false)
  const [detailLoading, setDetailLoading] = React.useState<boolean>(false)
  const [importingKind, setImportingKind] = React.useState<'commerce' | 'content' | null>(null)
  const [scanLoading, setScanLoading] = React.useState<boolean>(false)
  const [error, setError] = React.useState<string>('')
  const [lastImportMessage, setLastImportMessage] = React.useState<string>('')
  const [importMenuOpen, setImportMenuOpen] = React.useState<boolean>(false)
  const [monitorMenuOpen, setMonitorMenuOpen] = React.useState<boolean>(false)
  const [noticeCursor, setNoticeCursor] = React.useState<number>(0)
  const scanInFlightRef = React.useRef<boolean>(false)
  const importMenuRef = React.useRef<HTMLDivElement | null>(null)
  const monitorMenuRef = React.useRef<HTMLDivElement | null>(null)
  const dataPhase: DataPhase = React.useMemo(() => {
    if (snapshotDates.length === 0) return 'EMPTY'
    if (snapshotDates.length === 1) return 'DAY1'
    return 'DAY2_PLUS'
  }, [snapshotDates.length])

  const loadMeta = React.useCallback(async (): Promise<string> => {
    const next = (await window.api.cms.noteRace.meta()) as RaceMeta
    const availableDates = Array.isArray(next.availableDates) ? next.availableDates : []
    const chosenDate =
      snapshotDate && availableDates.includes(snapshotDate) ? snapshotDate : (next.latestDate ?? '')

    setMeta(next)
    setSnapshotDates(availableDates)
    setSnapshotDate(chosenDate)
    return chosenDate
  }, [snapshotDate])

  const loadRows = React.useCallback(async (targetDate: string): Promise<void> => {
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
      setError('')
    } catch (err) {
      setAllRows([])
      setError(`加载列表失败：${normalizeError(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const refresh = React.useCallback(async (): Promise<void> => {
    const date = await loadMeta()
    if (date) {
      await loadRows(date)
      return
    }
    setAllRows([])
  }, [loadMeta, loadRows])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

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
    if (dataPhase === 'DAY1') {
      items.push({
        id: 'day1',
        level: 'warning',
        message: '当前仅有 1 日数据：趋势与增量信号仅供试探性参考。'
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
      if (importMenuRef.current && !importMenuRef.current.contains(target)) {
        setImportMenuOpen(false)
      }
      if (monitorMenuRef.current && !monitorMenuRef.current.contains(target)) {
        setMonitorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [])

  const handleCopy = React.useCallback(async (value: string): Promise<void> => {
    const normalized = String(value ?? '').trim()
    if (!normalized) return
    try {
      await navigator.clipboard.writeText(normalized)
    } catch {
      return
    }
  }, [])

  const handleCopyActionList = React.useCallback(async (): Promise<void> => {
    const prefix = dataPhase === 'DAY1' ? '（低置信：当前仅 1 日样本）\n' : ''
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
  }, [])

  const handleImport = React.useCallback(
    async (kind: 'commerce' | 'content'): Promise<void> => {
      setImportingKind(kind)
      setError('')
      try {
        const result = (
          kind === 'commerce'
            ? await window.api.cms.noteRace.importCommerceFile()
            : await window.api.cms.noteRace.importContentFile()
        ) as RaceImportResult | null

        if (result) {
          const matchedText =
            typeof result.matchedRows === 'number'
              ? `，匹配 ${result.matchedRows}/${result.totalRows ?? '-'} 条`
              : ''
          setLastImportMessage(
            `已导入 ${result.sourceFile}：${result.importedRows} 行${matchedText}`
          )
        }

        await refresh()
      } catch (err) {
        setError(`导入失败：${normalizeError(err)}`)
      } finally {
        setImportingKind(null)
      }
    },
    [refresh]
  )

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
          await refresh()
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
    [monitorDir, refresh, scanCursorMs]
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
      void loadRows(nextDate)
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
            <div ref={importMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setImportMenuOpen((prev) => !prev)
                  setMonitorMenuOpen(false)
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-500/15 px-3 text-cyan-100 transition hover:bg-cyan-500/20"
                title="导入赛马数据"
              >
                <Download className="h-3.5 w-3.5" />
                导入数据
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {importMenuOpen ? (
                <div className="absolute right-0 top-9 z-40 w-44 rounded-md border border-zinc-700 bg-zinc-900/95 p-1 shadow-xl backdrop-blur">
                  <button
                    type="button"
                    onClick={() => {
                      setImportMenuOpen(false)
                      void handleImport('commerce')
                    }}
                    disabled={importingKind != null}
                    className="flex h-8 w-full items-center rounded px-2 text-left text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {importingKind === 'commerce' ? '导入商品中...' : '导入商品笔记表'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportMenuOpen(false)
                      void handleImport('content')
                    }}
                    disabled={importingKind != null}
                    className="flex h-8 w-full items-center rounded px-2 text-left text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {importingKind === 'content' ? '导入内容中...' : '导入笔记列表表'}
                  </button>
                </div>
              ) : null}
            </div>

            <div ref={monitorMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setMonitorMenuOpen((prev) => !prev)
                  setImportMenuOpen(false)
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
                      onClick={handleToggleAutoMonitor}
                      className={cn(
                        'flex h-8 w-full items-center rounded border px-2 text-left transition',
                        autoMonitorEnabled
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-cyan-500 hover:text-cyan-200'
                      )}
                    >
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
            'mb-2 flex h-8 items-center justify-between rounded border px-3 text-xs',
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

        <section className="mb-2 rounded border border-zinc-700 bg-zinc-900/70 px-3 py-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-200">今日必做清单（Top 10）</h3>
            <button
              type="button"
              onClick={() => void handleCopyActionList()}
              disabled={actionList.length === 0}
              className="inline-flex h-7 items-center rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-300 transition hover:border-cyan-500 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              title="复制清单"
            >
              复制清单
            </button>
          </div>
          {dataPhase === 'DAY1' ? (
            <div className="mt-1 text-[10px] text-amber-300">
              低置信：当前仅 1 日样本，动作仅供试探性执行
            </div>
          ) : null}
          {actionList.length === 0 ? (
            <div className="mt-2 text-xs text-zinc-500">
              {dataPhase === 'EMPTY' ? '暂无可执行清单（等待首日数据）' : '暂无可执行清单'}
            </div>
          ) : (
            <div className="mt-2 max-h-44 space-y-1.5 overflow-auto pr-1">
              {actionList.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handlePickActionItem(item)}
                  className="w-full rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-left text-[11px] transition hover:border-cyan-500"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 text-zinc-500">{index + 1}</span>
                    <span
                      className={cn(
                        'inline-flex rounded border px-1.5 py-0.5 text-[10px]',
                        priorityClass(item.priority)
                      )}
                    >
                      {item.priority}
                    </span>
                    <span
                      className={cn(
                        'inline-flex rounded px-1.5 py-0.5 text-[10px]',
                        tagClasses(item.tag)
                      )}
                    >
                      {item.tag}
                    </span>
                    <span className="truncate text-zinc-200">{item.title}</span>
                    <span className="text-zinc-500">#{item.rank}</span>
                  </div>
                  <div className="mt-1 pl-6 text-zinc-400">原因：{item.reason}</div>
                  <div className="mt-0.5 pl-6 text-zinc-300">动作：{item.action}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mb-3 flex h-10 items-center justify-between rounded border border-zinc-800 bg-zinc-900/55 px-2">
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
            <span>评估 {summary.assessedCount}</span>
            <span>
              匹配率 {dataPhase === 'EMPTY' ? '-' : `${Math.round(summary.matchRate * 100)}%`}
            </span>
            <span>P0 {p0Count}</span>
            <span>P1 {p1Count}</span>
            <span>P2 {p2Count}</span>
            <span>机会 {opportunityCount}</span>
            <span>风险 {riskSignalCount}</span>
          </div>
        </section>
      </div>

      <div
        className="grid min-h-0 flex-1 gap-4 px-4 pb-4"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(360px, 1fr)' }}
      >
        <section className="min-h-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/45">
          <div className="border-b border-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100">
            重点监控清单（Top 12）
          </div>
          <div className="min-h-0 overflow-auto">
            <div
              className="sticky top-0 z-10 grid h-11 items-center border-b border-zinc-800 bg-zinc-900/90 px-2 text-[11px] font-medium text-zinc-400 backdrop-blur"
              style={{
                gridTemplateColumns:
                  '48px 96px 138px minmax(220px,1.8fr) 92px 120px 108px 160px 160px 96px'
              }}
            >
              <span className="text-center">排名</span>
              <span>标签</span>
              <span>账号</span>
              <span>笔记标题</span>
              <span>笔记年龄</span>
              <span className="text-center">赛马分</span>
              <span className="text-center">趋势</span>
              <span className="text-center">内容信号</span>
              <span className="text-center">商品信号</span>
              <span>阶段</span>
            </div>

            {loading ? <div className="px-3 py-6 text-sm text-zinc-500">加载中...</div> : null}

            {!loading && rows.length === 0 ? (
              <div className="px-3 py-6 text-sm text-zinc-500">
                {dataPhase === 'EMPTY' ? '暂无数据，请先导入首日表格' : '当前筛选条件下暂无数据'}
              </div>
            ) : null}

            {rows.map((row) => {
              const rowAction =
                actionMap.get(row.id) ??
                (dataPhase === 'DAY2_PLUS' ? buildActionItem(row) : buildActionItemDay1(row))
              const trendLabel =
                dataPhase === 'DAY2_PLUS' ? formatTrendDelta(row.trendDelta) : '样本不足'
              const trendClass =
                dataPhase === 'DAY2_PLUS' ? trendDeltaClass(row.trendDelta) : 'text-zinc-500'
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={cn(
                    'grid h-[46px] w-full items-center border-b border-zinc-800/80 px-2 text-left text-[12px] transition hover:bg-zinc-800/50',
                    rowAction.priority === 'P0' && 'bg-rose-500/5',
                    rowAction.priority === 'P1' && 'bg-amber-500/5',
                    selected?.id === row.id && 'bg-zinc-800/70'
                  )}
                  style={{
                    gridTemplateColumns:
                      '48px 96px 138px minmax(220px,1.8fr) 92px 120px 108px 160px 160px 96px'
                  }}
                  title={row.trendHint.join('\n')}
                >
                  <span
                    className={cn(
                      'text-center text-zinc-400',
                      row.rank <= 3 && 'font-semibold text-zinc-200'
                    )}
                  >
                    {row.rank}
                  </span>
                  <span>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] leading-none',
                        tagClasses(row.tag)
                      )}
                    >
                      {row.tag}
                    </span>
                  </span>
                  <span className="truncate text-zinc-400">{row.account || '-'}</span>
                  <span className="truncate text-zinc-100">{row.title}</span>
                  <span className="inline-flex items-center gap-1 text-zinc-300">
                    <span className={cn('h-1.5 w-1.5 rounded-full', ageDotClass(row.ageDays))} />第
                    {row.ageDays}天
                  </span>
                  <span className="px-2">
                    <div className="text-center text-zinc-200">{row.score.toFixed(1)}</div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded bg-zinc-800">
                      <div
                        className={cn('h-full rounded', scoreBarClasses(row.score))}
                        style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
                      />
                    </div>
                  </span>
                  <span className={cn('text-center font-medium', trendClass)}>{trendLabel}</span>
                  <SignalColumn signals={row.contentSignals} />
                  <SignalColumn signals={row.commerceSignals} />
                  <span className="truncate text-zinc-300">{row.stageLabel}</span>
                </button>
              )
            })}
          </div>
        </section>

        <aside className="min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">笔记详情</h3>
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-[11px]',
                    tagClasses(selected.tag)
                  )}
                >
                  {selected.tag}
                </span>
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
                  <KeyValue label="阶段" value={selected.stageLabel} />
                </div>
              </section>

              {detailLoading ? (
                <div className="rounded border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
                  详情加载中...
                </div>
              ) : null}

              <FunnelBlock
                title="内容漏斗"
                metrics={detail?.contentFunnel ?? []}
                fillClassName="bg-cyan-400"
              />
              <FunnelBlock
                title="商品漏斗"
                metrics={detail?.commerceFunnel ?? []}
                fillClassName="bg-violet-400"
              />

              <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                <h4 className="text-sm font-semibold text-zinc-100">趋势信号</h4>
                {dataPhase !== 'DAY2_PLUS' ? (
                  <div className="mt-2 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                    样本不足：至少需要连续 2 日数据才显示增量趋势
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
                    const active = stage <= selected.stageIndex
                    const current = stage === selected.stageIndex
                    return (
                      <React.Fragment key={stage}>
                        <span
                          className={cn(
                            'inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5',
                            current
                              ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                              : active
                                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                                : 'border-zinc-700 bg-zinc-900 text-zinc-500'
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
        </aside>
      </div>
    </div>
  )
}

function SignalColumn({ signals }: { signals: Signal[] }): React.JSX.Element {
  const display = signals.slice(0, 2)
  return (
    <span className="flex items-center justify-center gap-1 overflow-hidden">
      {display.map((signal) => (
        <span
          key={signal.label}
          className={cn(
            'inline-flex max-w-[72px] truncate rounded-full border px-1.5 py-0.5 text-[10px]',
            signalClasses(signal.tone)
          )}
        >
          {signal.label}
        </span>
      ))}
    </span>
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
