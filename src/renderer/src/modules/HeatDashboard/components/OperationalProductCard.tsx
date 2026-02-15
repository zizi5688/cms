import * as React from 'react'

import { AlertTriangle, BarChart3, Copy, Search, Store, Users, Zap } from 'lucide-react'

export type OperationalProduct = {
  title: string
  price: number
  velocity24h: number
  totalSales: number
  shopName: string
  shopScore: number
  isNewArrival: boolean
  positiveReviewTag?: string | null
  shopFans?: string | null
  imageUrl: string
}

type OperationalProductCardProps = {
  product: OperationalProduct
  onCopyLink?: () => void
  onSameStyle?: () => void
  onCompetitorAnalysis?: () => void
}

export function OperationalProductCard({
  product,
  onCopyLink,
  onSameStyle,
  onCompetitorAnalysis
}: OperationalProductCardProps): React.JSX.Element {
  const showSurging = product.velocity24h > 1000
  const showNewArrival = product.isNewArrival
  const showLowPriceTag = product.price < 20
  const showLowScoreWarning = product.shopScore < 4.6

  const monthlyAvgSales = Math.max(0, Math.round(product.totalSales / 3))
  const velocityText = formatCompactStat(product.velocity24h)
  const totalSalesText = formatCompactStat(product.totalSales)
  const monthlyText = formatCompactStat(monthlyAvgSales)
  const reviewTagText = formatRawMetric(product.positiveReviewTag)
  const shopFansText = formatRawMetric(product.shopFans) ?? '--'

  return (
    <article className="group overflow-hidden rounded-[12px] border border-zinc-200 bg-[#f3f4f6] p-2 text-zinc-900 shadow-sm transition-shadow hover:shadow-md">
      <header className="relative overflow-hidden rounded-[10px] border border-zinc-200 bg-white">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="aspect-square w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />

        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          {showSurging && (
            <span className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-semibold leading-none text-white">
              🔥 飙升
            </span>
          )}
          {showNewArrival && (
            <span className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-semibold leading-none text-white">
              🆕 新品
            </span>
          )}
          {reviewTagText && (
            <span className="rounded-md bg-pink-500 px-2 py-1 text-[11px] font-semibold leading-none text-white">
              好评 {reviewTagText}
            </span>
          )}
        </div>

        <div className="pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="absolute bottom-2 left-2 right-2 grid grid-cols-3 gap-1.5">
            <ActionButton icon={Copy} label="复制链接" onClick={onCopyLink} variant="overlay" />
            <ActionButton icon={Search} label="找同款" onClick={onSameStyle} variant="overlay" />
            <ActionButton
              icon={BarChart3}
              label="竞对分析"
              onClick={onCompetitorAnalysis}
              variant="overlay"
            />
          </div>
        </div>
      </header>

      <div className="space-y-2.5 px-0.5 pb-0 pt-2">
        <h3 className="truncate text-[15px] font-semibold leading-5 text-zinc-800" title={product.title}>
          {product.title}
        </h3>

        <div className="flex items-center gap-1.5">
          <span className="text-[34px] font-black leading-none text-red-500">¥{product.price.toFixed(1)}</span>
          {showLowPriceTag && (
            <span className="rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600">
              低于均价15% ↓
            </span>
          )}
        </div>

        <section className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#ECEEF2] p-1.5">
          <MatrixCell
            icon={Zap}
            label="24h加购"
            value={velocityText}
            valueClassName="font-bold text-red-500"
          />
          <MatrixCell icon={Store} label="总销量" value={totalSalesText} valueClassName="text-zinc-700" />
          <MatrixCell icon={Users} label="3个月购买" value={monthlyText} valueClassName="text-zinc-700" />
          <MatrixCell icon={BarChart3} label="店铺粉丝" value={shopFansText} valueClassName="text-zinc-700" />
        </section>

        <footer className="space-y-1.5">
          <div className="flex items-center gap-1 text-[13px] text-zinc-700">
            <Store className="h-3.5 w-3.5 text-zinc-500" />
            <p className="truncate font-medium" title={product.shopName}>
              {product.shopName}
            </p>
            <span className="shrink-0 text-zinc-500">({product.shopScore.toFixed(1)}分)</span>
          </div>

          {showLowScoreWarning && (
            <div className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[12px] font-semibold text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              评分低，有机会截流！
            </div>
          )}
        </footer>
      </div>
    </article>
  )
}

function MatrixCell({
  icon: Icon,
  label,
  value,
  valueClassName
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  value: string
  valueClassName: string
}): React.JSX.Element {
  const { labelSizeClass, valueSizeClass } = getAdaptiveCellSize(label, value)

  return (
    <div className="rounded-md bg-white px-2 py-1.5">
      <p className="flex items-center gap-1 text-zinc-500">
        <Icon className="h-3 w-3" />
        <span className={`whitespace-nowrap ${labelSizeClass}`}>{label}:</span>
        <span className={`ml-auto whitespace-nowrap ${valueSizeClass} ${valueClassName}`}>{value}</span>
      </p>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  variant = 'default'
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
  onClick?: () => void
  variant?: 'default' | 'overlay'
}): React.JSX.Element {
  const className =
    variant === 'overlay'
      ? 'pointer-events-auto inline-flex items-center justify-center gap-1 rounded-md border border-white/40 bg-black/35 px-2 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex items-center justify-center gap-1 rounded-md border border-zinc-300 bg-[#EFF1F5] px-2 py-1.5 text-[13px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      disabled={!onClick}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function formatCompactStat(value: number): string {
  if (!Number.isFinite(value)) return '--'
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w+`
  return `${Math.round(Math.max(0, value))}+`
}

function formatRawMetric(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const normalized = raw.replace(/,/g, '')
  const numeric = Number(normalized)
  if (Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(normalized)) {
    return numeric >= 10000 ? `${(numeric / 10000).toFixed(1)}w+` : `${Math.round(Math.max(0, numeric))}`
  }
  return raw
}

function getAdaptiveCellSize(label: string, value: string): {
  labelSizeClass: string
  valueSizeClass: string
} {
  const totalLength = String(label).length + String(value).length
  if (totalLength >= 15) {
    return { labelSizeClass: 'text-[10px]', valueSizeClass: 'text-[10px]' }
  }
  if (totalLength >= 12) {
    return { labelSizeClass: 'text-[11px]', valueSizeClass: 'text-[11px]' }
  }
  return { labelSizeClass: 'text-[12px]', valueSizeClass: 'text-[12px]' }
}
