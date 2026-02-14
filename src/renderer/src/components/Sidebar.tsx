import type * as React from 'react'

import { Database, Image, Rocket, Settings, UploadCloud } from 'lucide-react'

import { cn } from '@renderer/lib/utils'

export type SidebarItemKey = 'workshop' | 'upload' | 'material' | 'autopublish' | 'settings'

export interface SidebarProps {
  active: SidebarItemKey
  onChange: (next: SidebarItemKey) => void
}

const iconMap = {
  Database,
  Image,
  Rocket,
  Settings,
  UploadCloud
} as const

type IconName = keyof typeof iconMap

type MenuItem = {
  id: SidebarItemKey
  icon: IconName
  label: string
}

const menuItems: MenuItem[] = [
  { id: 'material', icon: 'Image', label: '素材处理' },
  { id: 'autopublish', icon: 'Rocket', label: '媒体矩阵' },
  { id: 'upload', icon: 'UploadCloud', label: '同步飞书' },
  { id: 'workshop', icon: 'Database', label: '数据工坊' }
]

const bottomItems: MenuItem[] = [{ id: 'settings', icon: 'Settings', label: '设置' }]

function Sidebar({ active, onChange }: SidebarProps): React.JSX.Element {
  return (
    <aside className="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
      <div className="px-2 text-sm font-semibold tracking-wide text-zinc-200">Super CMS 控制台</div>
      <nav className="mt-4 flex flex-1 flex-col gap-1">
        {menuItems.map((item) => {
          const isActive = item.id === active
          const Icon = iconMap[item.icon]
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                'flex items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
                isActive ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900/60'
              )}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </button>
          )
        })}

        {bottomItems.map((item) => {
          const isActive = item.id === active
          const Icon = iconMap[item.icon]
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={cn(
                'mt-auto flex items-center rounded-md px-3 py-2 text-left text-sm transition-colors',
                isActive ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900/60'
              )}
            >
              <Icon className="mr-2 h-4 w-4" />
              {item.label}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

export { Sidebar }
