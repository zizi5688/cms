import * as React from 'react'

import { Copy, RefreshCcw } from 'lucide-react'

import { cn } from '@renderer/lib/utils'

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

type RaceRow = {
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

const MOCK_ROWS: RaceRow[] = [
  {
    id: '69a12cf80000000028023c3e',
    rank: 1,
    tag: '起飞',
    account: '福子Fuzzi Studio',
    title: '回南天包包发霉？这网格小包透气赢麻了',
    ageDays: 2,
    score: 86.2,
    trendDelta: 7.6,
    trendHint: ['昨对比前3日均值', '阅读 +120 (+18%)', '点击 +34 (+28%)', 'CTR +1.4pp'],
    contentSignals: [
      { label: '评 +21', tone: 'positive' },
      { label: '封点 +2.1pp', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +34', tone: 'positive' },
      { label: '单 +2', tone: 'positive' }
    ],
    stageLabel: 'S4 成交',
    stageIndex: 4,
    noteType: '视频',
    productName: '网格手机包',
    contentFunnel: [
      { label: '曝光', value: 12500, conversionLabel: '阅读率', conversionValue: 12.0 },
      { label: '观看/阅读', value: 1500, conversionLabel: '互动率', conversionValue: 8.4 },
      { label: '互动', value: 126, conversionLabel: '商品点击率', conversionValue: 17.5 },
      { label: '商品点击', value: 22 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 22, conversionLabel: '加购率', conversionValue: 45.5 },
      { label: '加购', value: 10, conversionLabel: '支付率', conversionValue: 40.0 },
      { label: '支付', value: 4, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [10, 12, 14, 18, 23, 33, 46],
    deltas: { read: 120, click: 34, acceleration: 1.22, stability: '高' }
  },
  {
    id: '68aea1d3000000001c0334f9',
    rank: 2,
    tag: '长尾复活',
    account: '阿栗Lizzy',
    title: '早八人的神仙包！能装下我整个宇宙',
    ageDays: 47,
    score: 81.4,
    trendDelta: 5.2,
    trendHint: ['昨对比前3日均值', '阅读 +64 (+15%)', '点击 +18 (+22%)', 'CTR +1.1pp'],
    contentSignals: [
      { label: '评 +9', tone: 'positive' },
      { label: '藏 +6', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +18', tone: 'positive' },
      { label: '单 +1', tone: 'positive' }
    ],
    stageLabel: 'S3 成交',
    stageIndex: 3,
    noteType: '图文',
    productName: '通勤托特包',
    contentFunnel: [
      { label: '曝光', value: 9800, conversionLabel: '阅读率', conversionValue: 10.2 },
      { label: '观看/阅读', value: 1000, conversionLabel: '互动率', conversionValue: 9.8 },
      { label: '互动', value: 98, conversionLabel: '商品点击率', conversionValue: 13.3 },
      { label: '商品点击', value: 13 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 13, conversionLabel: '加购率', conversionValue: 30.8 },
      { label: '加购', value: 4, conversionLabel: '支付率', conversionValue: 50.0 },
      { label: '支付', value: 2, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [3, 3, 4, 6, 8, 12, 16],
    deltas: { read: 64, click: 18, acceleration: 1.09, stability: '中' }
  },
  {
    id: '69a05e8a000000000e00edde',
    rank: 3,
    tag: '掉速',
    account: '桃枝Jessie',
    title: '春游拍照怎么拿包更轻松',
    ageDays: 5,
    score: 59.1,
    trendDelta: -3.2,
    trendHint: ['昨对比前3日均值', '阅读 -48 (-12%)', '点击 -15 (-21%)', 'CTR -0.8pp'],
    contentSignals: [
      { label: '评 -4', tone: 'negative' },
      { label: '封点 -0.8pp', tone: 'negative' }
    ],
    commerceSignals: [
      { label: '点 -15', tone: 'negative' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S2 导流',
    stageIndex: 2,
    noteType: '视频',
    productName: '旅行手提袋',
    contentFunnel: [
      { label: '曝光', value: 7600, conversionLabel: '阅读率', conversionValue: 8.5 },
      { label: '观看/阅读', value: 646, conversionLabel: '互动率', conversionValue: 6.0 },
      { label: '互动', value: 39, conversionLabel: '商品点击率', conversionValue: 7.7 },
      { label: '商品点击', value: 3 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 3, conversionLabel: '加购率', conversionValue: 33.3 },
      { label: '加购', value: 1, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [18, 21, 19, 17, 15, 12, 9],
    deltas: { read: -48, click: -15, acceleration: 0.76, stability: '中' }
  },
  {
    id: '69a18711000000001a02b58a',
    rank: 4,
    tag: '维稳',
    account: '福子Fuzzi Studio',
    title: '倒春寒保命包，里面居然塞得下开衫',
    ageDays: 8,
    score: 74.8,
    trendDelta: 1.5,
    trendHint: ['昨对比前3日均值', '阅读 +20 (+4%)', '点击 +4 (+6%)', 'CTR +0.2pp'],
    contentSignals: [
      { label: '评 +3', tone: 'positive' },
      { label: '藏 +2', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +4', tone: 'positive' },
      { label: '单 +1', tone: 'positive' }
    ],
    stageLabel: 'S3 成交',
    stageIndex: 3,
    noteType: '图文',
    productName: '网格手机包',
    contentFunnel: [
      { label: '曝光', value: 8400, conversionLabel: '阅读率', conversionValue: 9.1 },
      { label: '观看/阅读', value: 764, conversionLabel: '互动率', conversionValue: 8.1 },
      { label: '互动', value: 62, conversionLabel: '商品点击率', conversionValue: 9.7 },
      { label: '商品点击', value: 6 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 6, conversionLabel: '加购率', conversionValue: 33.3 },
      { label: '加购', value: 2, conversionLabel: '支付率', conversionValue: 50.0 },
      { label: '支付', value: 1, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [7, 8, 9, 10, 10, 11, 12],
    deltas: { read: 20, click: 4, acceleration: 1.03, stability: '高' }
  },
  {
    id: '699ed664000000001a0363b9',
    rank: 5,
    tag: '起飞',
    account: '阿栗Lizzy',
    title: '公司不发礼物？几十块给自己买个包',
    ageDays: 1,
    score: 68.5,
    trendDelta: 4.8,
    trendHint: ['昨对比前3日均值', '阅读 +89 (+19%)', '点击 +11 (+24%)', 'CTR +0.9pp'],
    contentSignals: [
      { label: '评 +13', tone: 'positive' },
      { label: '封点 +1.5pp', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +11', tone: 'positive' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S2 导流',
    stageIndex: 2,
    noteType: '视频',
    productName: '网格手机包',
    contentFunnel: [
      { label: '曝光', value: 6200, conversionLabel: '阅读率', conversionValue: 12.3 },
      { label: '观看/阅读', value: 764, conversionLabel: '互动率', conversionValue: 6.9 },
      { label: '互动', value: 53, conversionLabel: '商品点击率', conversionValue: 20.8 },
      { label: '商品点击', value: 11 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 11, conversionLabel: '加购率', conversionValue: 36.4 },
      { label: '加购', value: 4, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [4, 4, 5, 7, 9, 12, 17],
    deltas: { read: 89, click: 11, acceleration: 1.31, stability: '中' }
  },
  {
    id: '69a112d50000000028020cf6',
    rank: 6,
    tag: '风险',
    account: '桃枝Jessie',
    title: '救命！早春返工被这只托特治愈了',
    ageDays: 3,
    score: 45.6,
    trendDelta: -4.1,
    trendHint: ['昨对比前3日均值', '阅读 -70 (-23%)', '点击 -10 (-29%)', 'CTR -1.2pp'],
    contentSignals: [
      { label: '评 -8', tone: 'negative' },
      { label: '封点 -1.2pp', tone: 'negative' }
    ],
    commerceSignals: [
      { label: '点 -10', tone: 'negative' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S1 起量',
    stageIndex: 1,
    noteType: '图文',
    productName: '通勤托特包',
    contentFunnel: [
      { label: '曝光', value: 4300, conversionLabel: '阅读率', conversionValue: 6.0 },
      { label: '观看/阅读', value: 258, conversionLabel: '互动率', conversionValue: 4.7 },
      { label: '互动', value: 12, conversionLabel: '商品点击率', conversionValue: 8.3 },
      { label: '商品点击', value: 1 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 1, conversionLabel: '加购率', conversionValue: 0.0 },
      { label: '加购', value: 0, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [16, 15, 13, 10, 8, 6, 3],
    deltas: { read: -70, click: -10, acceleration: 0.58, stability: '低' }
  },
  {
    id: '69a0fbce000000001a031d4f',
    rank: 7,
    tag: '维稳',
    account: '福子Fuzzi Studio',
    title: '逛超市解放双手，太香了',
    ageDays: 6,
    score: 63.4,
    trendDelta: 0.7,
    trendHint: ['昨对比前3日均值', '阅读 +11 (+3%)', '点击 +2 (+4%)', 'CTR +0.1pp'],
    contentSignals: [
      { label: '评 +2', tone: 'positive' },
      { label: '藏 +1', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +2', tone: 'positive' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S2 导流',
    stageIndex: 2,
    noteType: '视频',
    productName: '网格手机包',
    contentFunnel: [
      { label: '曝光', value: 5100, conversionLabel: '阅读率', conversionValue: 8.8 },
      { label: '观看/阅读', value: 449, conversionLabel: '互动率', conversionValue: 5.6 },
      { label: '互动', value: 25, conversionLabel: '商品点击率', conversionValue: 8.0 },
      { label: '商品点击', value: 2 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 2, conversionLabel: '加购率', conversionValue: 50.0 },
      { label: '加购', value: 1, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [9, 9, 10, 10, 11, 11, 12],
    deltas: { read: 11, click: 2, acceleration: 1.01, stability: '高' }
  },
  {
    id: '69a0fc2e000000002800869e',
    rank: 8,
    tag: '长尾复活',
    account: '阿栗Lizzy',
    title: '小个子别买大托特了，中号才是本命',
    ageDays: 35,
    score: 61.2,
    trendDelta: 2.4,
    trendHint: ['昨对比前3日均值', '阅读 +38 (+11%)', '点击 +6 (+16%)', 'CTR +0.5pp'],
    contentSignals: [
      { label: '评 +5', tone: 'positive' },
      { label: '封点 +0.6pp', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +6', tone: 'positive' },
      { label: '单 +1', tone: 'positive' }
    ],
    stageLabel: 'S3 成交',
    stageIndex: 3,
    noteType: '图文',
    productName: '通勤托特包',
    contentFunnel: [
      { label: '曝光', value: 4700, conversionLabel: '阅读率', conversionValue: 7.3 },
      { label: '观看/阅读', value: 343, conversionLabel: '互动率', conversionValue: 7.0 },
      { label: '互动', value: 24, conversionLabel: '商品点击率', conversionValue: 25.0 },
      { label: '商品点击', value: 6 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 6, conversionLabel: '加购率', conversionValue: 33.3 },
      { label: '加购', value: 2, conversionLabel: '支付率', conversionValue: 50.0 },
      { label: '支付', value: 1, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [2, 3, 4, 6, 7, 9, 11],
    deltas: { read: 38, click: 6, acceleration: 1.12, stability: '中' }
  },
  {
    id: '68b63dcb000000001c0370c9',
    rank: 9,
    tag: '维稳',
    account: '福子Fuzzi Studio',
    title: '周末去看樱花，男友说这包可爱',
    ageDays: 12,
    score: 57.2,
    trendDelta: 0.1,
    trendHint: ['昨对比前3日均值', '阅读 +2 (+1%)', '点击 0 (+0%)', 'CTR 持平'],
    contentSignals: [
      { label: '评 +1', tone: 'positive' },
      { label: '藏 0', tone: 'neutral' }
    ],
    commerceSignals: [
      { label: '点 0', tone: 'neutral' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S2 导流',
    stageIndex: 2,
    noteType: '视频',
    productName: '网格手机包',
    contentFunnel: [
      { label: '曝光', value: 3980, conversionLabel: '阅读率', conversionValue: 8.0 },
      { label: '观看/阅读', value: 318, conversionLabel: '互动率', conversionValue: 4.4 },
      { label: '互动', value: 14, conversionLabel: '商品点击率', conversionValue: 7.1 },
      { label: '商品点击', value: 1 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 1, conversionLabel: '加购率', conversionValue: 0.0 },
      { label: '加购', value: 0, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [6, 6, 7, 7, 8, 8, 8],
    deltas: { read: 2, click: 0, acceleration: 1.0, stability: '高' }
  },
  {
    id: '68711c0b0000000010027b3b',
    rank: 10,
    tag: '掉速',
    account: '桃枝Jessie',
    title: '马上要看樱花了，拍照怎么拿大包',
    ageDays: 7,
    score: 52.9,
    trendDelta: -1.8,
    trendHint: ['昨对比前3日均值', '阅读 -25 (-9%)', '点击 -4 (-12%)', 'CTR -0.4pp'],
    contentSignals: [
      { label: '评 -2', tone: 'negative' },
      { label: '封点 -0.4pp', tone: 'negative' }
    ],
    commerceSignals: [
      { label: '点 -4', tone: 'negative' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S2 导流',
    stageIndex: 2,
    noteType: '图文',
    productName: '旅行手提袋',
    contentFunnel: [
      { label: '曝光', value: 3200, conversionLabel: '阅读率', conversionValue: 8.9 },
      { label: '观看/阅读', value: 285, conversionLabel: '互动率', conversionValue: 3.5 },
      { label: '互动', value: 10, conversionLabel: '商品点击率', conversionValue: 10.0 },
      { label: '商品点击', value: 1 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 1, conversionLabel: '加购率', conversionValue: 0.0 },
      { label: '加购', value: 0, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [12, 11, 11, 10, 9, 8, 7],
    deltas: { read: -25, click: -4, acceleration: 0.89, stability: '中' }
  },
  {
    id: '686c8da6000000000d018ac1',
    rank: 11,
    tag: '风险',
    account: '阿栗Lizzy',
    title: '假装毫不费力，日杂风被它玩明白了',
    ageDays: 4,
    score: 48.4,
    trendDelta: -2.7,
    trendHint: ['昨对比前3日均值', '阅读 -31 (-10%)', '点击 -6 (-18%)', 'CTR -0.7pp'],
    contentSignals: [
      { label: '评 -3', tone: 'negative' },
      { label: '封点 -0.7pp', tone: 'negative' }
    ],
    commerceSignals: [
      { label: '点 -6', tone: 'negative' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S1 起量',
    stageIndex: 1,
    noteType: '图文',
    productName: '通勤托特包',
    contentFunnel: [
      { label: '曝光', value: 3000, conversionLabel: '阅读率', conversionValue: 7.0 },
      { label: '观看/阅读', value: 210, conversionLabel: '互动率', conversionValue: 4.3 },
      { label: '互动', value: 9, conversionLabel: '商品点击率', conversionValue: 11.1 },
      { label: '商品点击', value: 1 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 1, conversionLabel: '加购率', conversionValue: 0.0 },
      { label: '加购', value: 0, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [8, 8, 7, 7, 6, 5, 4],
    deltas: { read: -31, click: -6, acceleration: 0.81, stability: '低' }
  },
  {
    id: '687eec11000000000d027f95',
    rank: 12,
    tag: '维稳',
    account: '福子Fuzzi Studio',
    title: '办公室带薪摸鱼神器，偷偷装手机没压力',
    ageDays: 10,
    score: 51.7,
    trendDelta: 0.5,
    trendHint: ['昨对比前3日均值', '阅读 +9 (+3%)', '点击 +1 (+4%)', 'CTR +0.1pp'],
    contentSignals: [
      { label: '评 +1', tone: 'positive' },
      { label: '封点 +0.1pp', tone: 'positive' }
    ],
    commerceSignals: [
      { label: '点 +1', tone: 'positive' },
      { label: '单 0', tone: 'neutral' }
    ],
    stageLabel: 'S2 导流',
    stageIndex: 2,
    noteType: '图文',
    productName: '网格手机包',
    contentFunnel: [
      { label: '曝光', value: 3550, conversionLabel: '阅读率', conversionValue: 8.6 },
      { label: '观看/阅读', value: 305, conversionLabel: '互动率', conversionValue: 4.6 },
      { label: '互动', value: 14, conversionLabel: '商品点击率', conversionValue: 7.1 },
      { label: '商品点击', value: 1 }
    ],
    commerceFunnel: [
      { label: '商品点击', value: 1, conversionLabel: '加购率', conversionValue: 0.0 },
      { label: '加购', value: 0, conversionLabel: '支付率', conversionValue: 0.0 },
      { label: '支付', value: 0, conversionLabel: '退款率', conversionValue: 0.0 },
      { label: '退款', value: 0 }
    ],
    sparkline: [7, 7, 8, 8, 8, 9, 9],
    deltas: { read: 9, click: 1, acceleration: 1.01, stability: '高' }
  }
]

const SNAPSHOT_DATES = ['2026-02-28', '2026-02-27', '2026-02-26']
const NOTE_TYPES = ['全部', '图文', '视频'] as const
const ACCOUNT_OPTIONS = ['全部账号', ...Array.from(new Set(MOCK_ROWS.map((row) => row.account)))]

function tagClasses(tag: NoteTag): string {
  if (tag === '起飞') return 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
  if (tag === '掉速' || tag === '长尾复活') return 'border border-amber-500/40 bg-amber-500/15 text-amber-300'
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

function FunnelBlock({ title, metrics, fillClassName }: { title: string; metrics: FunnelMetric[]; fillClassName: string }): React.JSX.Element {
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
                <div className={cn('h-full rounded', fillClassName)} style={{ width: `${width}%` }} />
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
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none">
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function NoteRaceBoard(): React.JSX.Element {
  const [snapshotDate, setSnapshotDate] = React.useState<string>(SNAPSHOT_DATES[0])
  const [account, setAccount] = React.useState<string>('全部账号')
  const [noteType, setNoteType] = React.useState<(typeof NOTE_TYPES)[number]>('全部')
  const [selectedId, setSelectedId] = React.useState<string>(MOCK_ROWS[0]?.id ?? '')

  const matchingRate = 0.86

  const rows = React.useMemo(() => {
    return MOCK_ROWS.filter((row) => {
      if (account !== '全部账号' && row.account !== account) return false
      if (noteType !== '全部' && row.noteType !== noteType) return false
      return true
    }).slice(0, 12)
  }, [account, noteType])

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null

  const summary = React.useMemo(() => {
    const byTag = rows.reduce<Record<NoteTag, number>>(
      (acc, row) => {
        acc[row.tag] += 1
        return acc
      },
      { 起飞: 0, 维稳: 0, 掉速: 0, 长尾复活: 0, 风险: 0 }
    )
    return {
      assessedCount: rows.length,
      matchRate: matchingRate,
      risingCount: byTag['起飞'],
      revivalCount: byTag['长尾复活'],
      dropCount: byTag['掉速'],
      riskCount: byTag['风险']
    }
  }, [rows])

  const qualityLevel = matchingRate < 0.5 ? 'danger' : matchingRate < 0.7 ? 'warning' : 'ok'

  const handleCopy = React.useCallback(async (value: string): Promise<void> => {
    const normalized = String(value ?? '').trim()
    if (!normalized) return
    try {
      await navigator.clipboard.writeText(normalized)
    } catch {
      return
    }
  }, [])

  return (
    <div className="h-full overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-zinc-100">笔记赛马监控</h1>
            <p className="text-xs text-zinc-400">重点监控清单（趋势优先）</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={snapshotDate}
              onChange={(event) => setSnapshotDate(event.target.value)}
              className="h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              {SNAPSHOT_DATES.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
            <select
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className="h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              {ACCOUNT_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              value={noteType}
              onChange={(event) => setNoteType(event.target.value as (typeof NOTE_TYPES)[number])}
              className="h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              {NOTE_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 text-zinc-200 transition hover:border-cyan-500 hover:text-cyan-200"
              title="刷新"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              刷新
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 pt-3">
        {qualityLevel !== 'ok' ? (
          <div
            className={cn(
              'mb-2 rounded border px-3 py-2 text-xs',
              qualityLevel === 'danger'
                ? 'border-rose-500/45 bg-rose-500/10 text-rose-200'
                : 'border-amber-500/45 bg-amber-500/10 text-amber-200'
            )}
          >
            {qualityLevel === 'danger'
              ? '数据匹配率严重偏低，建议先修复数据后再解读排名。'
              : '数据匹配率偏低，请核对标题/发布时间格式。'}
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap gap-2">
          <Chip label={`可评估笔记 ${summary.assessedCount}`} />
          <Chip label={`匹配成功率 ${Math.round(summary.matchRate * 100)}%`} />
          <Chip label={`起飞 ${summary.risingCount}`} />
          <Chip label={`长尾复活 ${summary.revivalCount}`} />
          <Chip label={`掉速 ${summary.dropCount}`} />
          <Chip label={`风险 ${summary.riskCount}`} />
        </div>
      </div>

      <div className="grid h-[calc(100%-146px)] gap-4 px-4 pb-4" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(360px, 1fr)' }}>
        <section className="min-h-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/45">
          <div className="border-b border-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100">重点监控清单（Top 12）</div>
          <div className="min-h-0 overflow-auto">
            <div
              className="sticky top-0 z-10 grid h-11 items-center border-b border-zinc-800 bg-zinc-900/90 px-2 text-[11px] font-medium text-zinc-400 backdrop-blur"
              style={{ gridTemplateColumns: '48px 96px 138px minmax(220px,1.8fr) 92px 120px 108px 160px 160px 96px' }}
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
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={cn(
                  'grid h-[46px] w-full items-center border-b border-zinc-800/80 px-2 text-left text-[12px] transition hover:bg-zinc-800/50',
                  selected?.id === row.id && 'bg-zinc-800/70'
                )}
                style={{ gridTemplateColumns: '48px 96px 138px minmax(220px,1.8fr) 92px 120px 108px 160px 160px 96px' }}
                title={row.trendHint.join('\n')}
              >
                <span className={cn('text-center text-zinc-400', row.rank <= 3 && 'font-semibold text-zinc-200')}>{row.rank}</span>
                <span>
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] leading-none', tagClasses(row.tag))}>
                    {row.tag}
                  </span>
                </span>
                <span className="truncate text-zinc-400">{row.account}</span>
                <span className="truncate text-zinc-100">{row.title}</span>
                <span className="inline-flex items-center gap-1 text-zinc-300">
                  <span className={cn('h-1.5 w-1.5 rounded-full', ageDotClass(row.ageDays))} />
                  第{row.ageDays}天
                </span>
                <span className="px-2">
                  <div className="text-center text-zinc-200">{row.score.toFixed(1)}</div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded bg-zinc-800">
                    <div className={cn('h-full rounded', scoreBarClasses(row.score))} style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }} />
                  </div>
                </span>
                <span className={cn('text-center font-medium', trendDeltaClass(row.trendDelta))}>{formatTrendDelta(row.trendDelta)}</span>
                <SignalColumn signals={row.contentSignals} />
                <SignalColumn signals={row.commerceSignals} />
                <span className="truncate text-zinc-300">{row.stageLabel}</span>
              </button>
            ))}
          </div>
        </section>

        <aside className="min-h-0 overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">笔记详情</h3>
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px]', tagClasses(selected.tag))}>{selected.tag}</span>
              </div>

              <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                <h4 className="text-xs font-semibold text-zinc-200">基础信息</h4>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  <KeyValue
                    label="笔记ID"
                    value={selected.id}
                    action={
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded border border-zinc-700 text-zinc-300 hover:border-cyan-500 hover:text-cyan-200"
                        onClick={() => void handleCopy(selected.id)}
                        title="复制笔记ID"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    }
                  />
                  <KeyValue label="账号" value={selected.account} />
                  <KeyValue label="发布时间" value={`${snapshotDate}（D+1监控）`} />
                  <KeyValue label="体裁" value={selected.noteType} />
                  <KeyValue label="关联商品" value={selected.productName} />
                  <KeyValue label="阶段" value={selected.stageLabel} />
                </div>
              </section>

              <FunnelBlock title="内容漏斗" metrics={selected.contentFunnel} fillClassName="bg-cyan-400" />
              <FunnelBlock title="商品漏斗" metrics={selected.commerceFunnel} fillClassName="bg-violet-400" />

              <section className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-3">
                <h4 className="text-sm font-semibold text-zinc-100">趋势信号</h4>
                <div className="mt-2">
                  <TrendSparkline values={selected.sparkline} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  <DeltaCard label="d阅读" value={selected.deltas.read} />
                  <DeltaCard label="d点击" value={selected.deltas.click} />
                  <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
                    <div className="text-[10px] text-zinc-400">加速度</div>
                    <div className="text-zinc-200">{selected.deltas.acceleration.toFixed(2)}x</div>
                  </div>
                  <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5">
                    <div className="text-[10px] text-zinc-400">7日稳定性</div>
                    <div className="text-zinc-200">{selected.deltas.stability}</div>
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

function Chip({ label }: { label: string }): React.JSX.Element {
  return <span className="inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300">{label}</span>
}

function SignalColumn({ signals }: { signals: Signal[] }): React.JSX.Element {
  const display = signals.slice(0, 2)
  return (
    <span className="flex items-center justify-center gap-1 overflow-hidden">
      {display.map((signal) => (
        <span
          key={signal.label}
          className={cn('inline-flex max-w-[72px] truncate rounded-full border px-1.5 py-0.5 text-[10px]', signalClasses(signal.tone))}
        >
          {signal.label}
        </span>
      ))}
    </span>
  )
}

function DeltaCard({ label, value }: { label: string; value: number }): React.JSX.Element {
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
