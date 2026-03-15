import type * as React from 'react'

import { Check, Images, PackageSearch, RotateCcw, X } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'

type ProductCardLike = {
  id: string
  name: string
  cover?: string
  price?: string
}

type SelectedProductLike = {
  id: string
  name: string
}

type CmsProductMultiSelectPanelProps = {
  title: string
  subtitle: string
  products: ProductCardLike[]
  selectedProductIds: string[]
  selectedProducts: SelectedProductLike[]
  workspacePath?: string
  emptyStateMessage: string
  onToggleProduct?: (productId: string) => void
  onClearSelected?: () => void
  interactive?: boolean
  showSelectedChips?: boolean
  variant?: 'default' | 'compact'
  className?: string
  scrollClassName?: string
}

function CmsProductMultiSelectPanel({
  title,
  subtitle,
  products,
  selectedProductIds,
  selectedProducts,
  workspacePath,
  emptyStateMessage,
  onToggleProduct,
  onClearSelected,
  interactive = true,
  showSelectedChips = true,
  variant = 'default',
  className,
  scrollClassName
}: CmsProductMultiSelectPanelProps): React.JSX.Element {
  const isCompact = variant === 'compact'

  return (
    <div className={cn('rounded-2xl border border-zinc-800/90 bg-black/30', className)}>
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-b border-zinc-800/80',
          isCompact ? 'px-3 py-2.5' : 'px-4 py-3'
        )}
      >
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{title}</div>
          <div className={cn('mt-1 truncate text-zinc-200', isCompact ? 'text-xs' : 'text-sm')}>
            {subtitle}
          </div>
        </div>
        {interactive && selectedProducts.length > 0 && onClearSelected ? (
          <button
            type="button"
            onClick={onClearSelected}
            className={cn(
              'inline-flex items-center gap-1 rounded-xl text-xs text-zinc-400 transition hover:bg-zinc-900/70 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
              isCompact ? 'min-h-9 px-2' : 'min-h-11 px-2.5'
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            清空
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          'overflow-auto',
          isCompact ? 'max-h-[250px] p-2.5' : 'max-h-[360px] p-3',
          scrollClassName
        )}
      >
        {products.length === 0 ? (
          <div className="flex min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/60 px-4 text-center text-sm text-zinc-400">
            <div className="flex max-w-[280px] flex-col items-center gap-2">
              <PackageSearch className="h-5 w-5 text-zinc-500" />
              <span>{emptyStateMessage}</span>
            </div>
          </div>
        ) : (
          <div className={cn('grid', isCompact ? 'gap-2.5' : 'gap-3')}>
            {products.map((product) => {
              const isSelected = selectedProductIds.includes(product.id)
              const coverSrc = product.cover ? resolveLocalImage(product.cover, workspacePath) : ''
              const itemClasses = cn(
                'flex w-full items-center text-left transition',
                isCompact ? 'gap-3 rounded-xl px-3 py-2.5' : 'gap-4 rounded-2xl px-4 py-3',
                interactive
                  ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60'
                  : 'cursor-default',
                isSelected
                  ? 'border-amber-400/55 bg-amber-400/10 shadow-[inset_0_0_0_1px_rgba(212,175,55,0.18)]'
                  : interactive
                    ? 'border-zinc-800 bg-zinc-950/55 hover:border-zinc-700 hover:bg-zinc-900/70'
                    : 'border-zinc-800 bg-zinc-950/55'
              )
              const thumbClasses = isCompact ? 'h-[72px] w-[72px]' : 'h-[88px] w-[88px]'

              const content = (
                <>
                  <div className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900', thumbClasses)}>
                    {coverSrc ? (
                      <img
                        src={coverSrc}
                        alt={product.name || product.id}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Images className="h-5 w-5 text-zinc-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'line-clamp-2 font-medium text-zinc-100',
                        isCompact ? 'text-sm leading-5' : 'text-[15px] leading-6'
                      )}
                    >
                      {product.name || product.id}
                    </div>
                    <div className={cn('mt-2 font-medium text-zinc-300', isCompact ? 'text-xs' : 'text-sm')}>
                      {product.price ? product.price : `ID: ${product.id}`}
                    </div>
                  </div>
                  <div
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition',
                      isSelected
                        ? 'border-amber-300 bg-amber-300 text-stone-950'
                        : 'border-zinc-700 bg-zinc-950 text-transparent'
                    )}
                  >
                    <Check className="h-4 w-4" />
                  </div>
                </>
              )

              if (!interactive || !onToggleProduct) {
                return (
                  <div key={product.id} className={itemClasses}>
                    {content}
                  </div>
                )
              }

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onToggleProduct(product.id)}
                  aria-pressed={isSelected}
                  className={itemClasses}
                >
                  {content}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {showSelectedChips && selectedProducts.length > 0 ? (
        <div className={cn('border-t border-zinc-800 bg-black/20', isCompact ? 'px-2.5 py-2.5' : 'px-3 py-3')}>
          <div className="flex flex-wrap gap-2">
            {selectedProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onToggleProduct?.(product.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/85 text-zinc-200 transition',
                  isCompact ? 'min-h-8 px-2.5 text-xs' : 'min-h-9 px-3 text-sm',
                  interactive
                    ? 'cursor-pointer hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60'
                    : 'cursor-default'
                )}
              >
                <span className="max-w-[280px] truncate">{product.name || product.id}</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export { CmsProductMultiSelectPanel }
