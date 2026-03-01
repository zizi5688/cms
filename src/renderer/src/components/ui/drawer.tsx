import * as React from 'react'

import { X } from 'lucide-react'

import { cn } from '@renderer/lib/utils'

type DrawerProps = {
  open: boolean
  onOpenChange: (next: boolean) => void
  title?: string
  description?: string
  widthClassName?: string
  children: React.ReactNode
}

function Drawer({
  open,
  onOpenChange,
  title,
  description,
  widthClassName = 'w-[38vw] min-w-[440px] max-w-[820px]',
  children
}: DrawerProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return
    const onEsc = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('keydown', onEsc)
    }
  }, [onOpenChange, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="关闭详情抽屉"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
      />
      <aside
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col border-l border-zinc-800 bg-zinc-950/98 shadow-2xl',
          widthClassName
        )}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            {title ? <h3 className="text-sm font-semibold text-zinc-100">{title}</h3> : null}
            {description ? <p className="mt-1 text-xs text-zinc-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-700 text-zinc-300 transition hover:border-cyan-500 hover:text-cyan-200"
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </aside>
    </div>
  )
}

export { Drawer }
