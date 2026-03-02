import * as React from 'react'

import { cn } from '@renderer/lib/utils'

export type TabsItem = {
  value: string
  label: string
}

type TabsProps = {
  value: string
  onValueChange: (next: string) => void
  items: TabsItem[]
  className?: string
}

function Tabs({ value, onValueChange, items, className }: TabsProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center rounded-lg border border-zinc-800 bg-zinc-900/70 p-1',
        className
      )}
      role="tablist"
      aria-orientation="horizontal"
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition',
              active
                ? 'bg-zinc-100 text-zinc-900'
                : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-zinc-100'
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export { Tabs }
