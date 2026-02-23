import * as React from 'react'

import { BarChart3, Copy, Search, Store, Users, Zap } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type OperationalProduct = {
  title: string
  productUrl?: string | null
  price: number
  velocity24h: number
  prevCartValue?: number | null
  productSales?: string | null
  recent3mSales?: string | null
  cartTag?: string | null
  favTag?: string | null
  shopSales?: string | null
  productRating?: number | null
  shopName: string
  shopUrl?: string | null
  shopRating?: number | null
  isNewArrival: boolean
  positiveReviewTag?: string | null
  shopFans?: string | null
  scout_strategy_tag?: 'flawed_hot' | 'exploding_new' | null
  lifecycle_status?: 'exploding' | 'mature' | 'declining' | 'new'
  shop_dna_tag?: 'viral_product' | null
  importedAt?: number | null
  importedAtLabel?: string | null
  imageUrl: string
}

type OperationalProductCardProps = {
  product: OperationalProduct
  onOpenProduct?: () => void
  onOpenShop?: () => void
  onCopyLink?: () => void
  onSameStyle?: () => void
  onCompetitorAnalysis?: () => void
}

export function OperationalProductCard({
  product,
  onOpenProduct,
  onOpenShop,
  onCopyLink,
  onSameStyle,
  onCompetitorAnalysis
}: OperationalProductCardProps): React.JSX.Element {
  const showLowPriceTag = product.price < 20
  const showLowScoreWarning =
    typeof product.shopRating === 'number' &&
    Number.isFinite(product.shopRating) &&
    product.shopRating < 4.6

  const velocityText = formatCompactStat(product.velocity24h)
  const productSalesText = formatRawMetric(product.productSales) ?? '--'
  const shopSalesText = formatRawMetric(product.shopSales) ?? '--'
  const productRatingText = formatRatingMetric(product.productRating) ?? '--'
  const hoverPrevCartText = formatHoverCount(product.prevCartValue)
  const hoverTodayCartText = formatHoverCount(product.velocity24h)
  const hoverRecent3mSalesText = formatRawMetric(product.recent3mSales) ?? '无'
  const hoverTotalSalesText = formatRawMetric(product.productSales) ?? '无'
  const hoverCartTagText = formatTaggedMetric(product.cartTag, '好评', '无好评标')
  const hoverFavTagText = formatTaggedMetric(product.favTag, '收藏', '无收藏标')
  const hoverImportedDate = resolveImportedDateLabel(product.importedAtLabel, product.importedAt)
  const shopFansText = formatRawMetric(product.shopFans)
  const shopRatingText = formatRatingMetric(product.shopRating)
  const hasShopMeta = Boolean(shopRatingText || shopFansText)
  const lifecycleTag = resolveLifecycleTag(product.lifecycle_status)
  const strategyBadge =
    product.scout_strategy_tag === 'flawed_hot'
      ? { label: '低分热销', className: 'bg-red-700 text-white' }
      : product.scout_strategy_tag === 'exploding_new'
        ? { label: '飙升新品', className: 'bg-blue-700 text-white' }
        : null

  return (
    <article className="group relative overflow-hidden rounded-[12px] border border-zinc-200 bg-[#f3f4f6] p-2 text-zinc-900 shadow-sm transition-shadow hover:shadow-md">
      <header className="relative overflow-hidden rounded-[10px] border border-zinc-200 bg-white">
        <img
          src={product.imageUrl}
          alt={product.title}
          className="aspect-square w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        {strategyBadge && (
          <div className="absolute right-2 top-2 z-10">
            <span
              className={cn(
                'inline-flex items-center rounded-sm px-2 py-1 text-[11px] font-semibold leading-none shadow-md',
                strategyBadge.className
              )}
            >
              {strategyBadge.label}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-center space-y-2 bg-black/75 px-3 py-2 text-[11px] text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="leading-4">
            <span className="text-white/75">【动能趋势】</span>
            上期加购 <span className="font-semibold text-yellow-300">{hoverPrevCartText}</span> ➔ 今日{' '}
            <span className="font-semibold text-yellow-300">{hoverTodayCartText}</span>
          </div>
          <div className="leading-4">
            <span className="text-white/75">【近期活跃】</span>
            近3月成交：<span className="font-semibold text-yellow-300">{hoverRecent3mSalesText}</span>单 (对比总销{' '}
            <span className="font-semibold text-yellow-300">{hoverTotalSalesText}</span>)
          </div>
          <div className="leading-4">
            <span className="text-white/75">【平台认证】</span>
            官方标签：<span className="font-semibold text-yellow-300">{hoverCartTagText}</span> |{' '}
            <span className="font-semibold text-yellow-300">{hoverFavTagText}</span>
          </div>
          <div className="leading-4">
            <span className="text-white/75">【雷达追踪】</span>
            发现日期：<span className="font-semibold text-yellow-300">{hoverImportedDate}</span>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-30 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="pointer-events-auto grid grid-cols-3 gap-1.5">
            <ActionButton icon={Copy} label="复制链接" onClick={onCopyLink} variant="overlay" />
            <ActionButton icon={Search} label="找同款" onClick={onSameStyle} variant="overlay" />
            <ActionButton icon={BarChart3} label="竞对分析" onClick={onCompetitorAnalysis} variant="overlay" />
          </div>
        </div>
      </header>

      <div className="space-y-2.5 px-0.5 pb-0 pt-2">
        <div className="flex min-w-0 items-center">
          {lifecycleTag && (
            <span
              className={cn(
                'px-1.5 py-0.5 text-[10px] rounded-sm mr-1 font-medium whitespace-nowrap inline-block align-middle',
                lifecycleTag.className
              )}
              title={lifecycleTag.label}
              aria-label={lifecycleTag.label}
            >
              {lifecycleTag.label}
            </span>
          )}
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-zinc-800" title={product.title}>
            {onOpenProduct ? (
              <button
                type="button"
                className="block w-full truncate text-left align-middle transition-colors hover:text-cyan-700"
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenProduct()
                }}
                title={product.title}
              >
                {product.title}
              </button>
            ) : (
              product.title
            )}
          </h3>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[34px] font-black leading-none text-red-500">¥{product.price.toFixed(1)}</span>
          {showLowPriceTag && (
            <span className="ml-1 text-xs font-bold text-green-500">
              15%↓
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
          <MatrixCell icon={Store} label="商品销量" value={productSalesText} valueClassName="text-zinc-700" />
          <MatrixCell icon={Users} label="店铺销量" value={shopSalesText} valueClassName="text-zinc-700" />
          <MatrixCell icon={BarChart3} label="商品评价" value={productRatingText} valueClassName="text-zinc-700" />
        </section>

        <footer className="space-y-1.5">
          <div className="flex min-w-0 items-center gap-1 text-[13px] text-zinc-700">
            <Store className="h-3.5 w-3.5 text-zinc-500" />
            <div className="min-w-0 flex items-center gap-1">
              {onOpenShop ? (
                <button
                  type="button"
                  className="min-w-0 truncate text-left font-medium transition-colors hover:text-cyan-700"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenShop()
                  }}
                  title={product.shopName}
                >
                  {product.shopName}
                </button>
              ) : (
                <p className="truncate font-medium" title={product.shopName}>
                  {product.shopName}
                </p>
              )}
              {product.shop_dna_tag === 'viral_product' && (
                <span className="shrink-0 rounded-sm bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">
                  🔥纯自然流
                </span>
              )}
            </div>
            {hasShopMeta && (
              <span className="shrink-0 text-zinc-500">
                （
                {shopRatingText && (
                  <span className={cn(showLowScoreWarning ? 'font-semibold text-red-500' : 'text-zinc-500')}>
                    {shopRatingText} 分
                  </span>
                )}
                {shopRatingText && shopFansText ? '，' : ''}
                {shopFansText && <span className="text-zinc-500">{shopFansText} 粉丝</span>}
                ）
              </span>
            )}
          </div>
        </footer>
      </div>
    </article>
  )
}

function resolveLifecycleTag(
  lifecycleStatus: OperationalProduct['lifecycle_status']
): { label: string; className: string } | null {
  switch (lifecycleStatus) {
    case 'exploding':
      return {
        label: '爆发期',
        className: 'bg-red-100 text-red-600'
      }
    case 'declining':
      return {
        label: '衰退期',
        className: 'bg-gray-100 text-gray-500'
      }
    case 'mature':
      return {
        label: '成熟期',
        className: 'bg-orange-100 text-orange-600'
      }
    case 'new':
      return {
        label: '测款期',
        className: 'bg-blue-100 text-blue-600'
      }
    default:
      return null
  }
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

function formatRatingMetric(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return Number(value).toFixed(1)
}

function formatHoverCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '无'
  return `${Math.max(0, Math.round(value))}`
}

function normalizeDisplayText(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  return raw ? raw : null
}

function formatTaggedMetric(
  value: string | null | undefined,
  suffix: string,
  emptyText: string
): string {
  const normalized = normalizeDisplayText(value)
  if (!normalized) return emptyText
  if (normalized.includes(suffix)) return normalized
  if (normalized.startsWith('无')) return normalized
  return `${normalized}${suffix}`
}

function formatDateYMD(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const numeric = Number(value)
  const timestamp = numeric > 0 && numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '--'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function resolveImportedDateLabel(
  importedAtLabel: string | null | undefined,
  importedAt: number | null | undefined
): string {
  const normalized = normalizeDisplayText(importedAtLabel)
  if (normalized) return normalized
  return formatDateYMD(importedAt)
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
