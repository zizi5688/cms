import * as React from 'react'

import { ChartColumnBig, Database, Image, Rocket, Search, Settings, UploadCloud } from 'lucide-react'

import { cn } from '@renderer/lib/utils'

export type SidebarItemKey = 'workshop' | 'upload' | 'material' | 'autopublish' | 'raceboard' | 'heatboard' | 'settings'

export interface SidebarProps {
  active: SidebarItemKey
  onChange: (next: SidebarItemKey) => void
}

const iconMap = {
  ChartColumnBig,
  Database,
  Image,
  Rocket,
  Search,
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
  { id: 'workshop', icon: 'Database', label: '数据工坊' },
  // { id: 'upload', icon: 'UploadCloud', label: '上传管理' },
  { id: 'autopublish', icon: 'Rocket', label: '媒体矩阵' },
  { id: 'raceboard', icon: 'Search', label: '数据赛马场' },
  { id: 'heatboard', icon: 'ChartColumnBig', label: '热度看板' }
]

const bottomItems: MenuItem[] = [{ id: 'settings', icon: 'Settings', label: '设置' }]

function Sidebar({ active, onChange }: SidebarProps): React.JSX.Element {
  const [isCollapsed, setIsCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem('cms.sidebarCollapsed') === '1'
    } catch {
      return false
    }
  })
  const [releaseMeta, setReleaseMeta] = React.useState<AppReleaseMeta | null>(null)

  const displayVersion = React.useMemo(() => {
    if (!releaseMeta) return 'V1.0.0'
    const major = Number.isFinite(Number(releaseMeta.majorVersion))
      ? Math.max(0, Math.floor(Number(releaseMeta.majorVersion)))
      : 1
    return `V${major}.0.0`
  }, [releaseMeta])

  const displayUpdatedAt = React.useMemo(() => {
    const raw = releaseMeta?.updatedAt?.trim() ?? ''
    if (!raw) return '--'
    const isoLike = raw.includes('T') ? raw : raw.replace(' ', 'T')
    const parsed = new Date(isoLike)
    if (!Number.isFinite(parsed.getTime())) return raw
    const year = parsed.getFullYear()
    const month = String(parsed.getMonth() + 1).padStart(2, '0')
    const day = String(parsed.getDate()).padStart(2, '0')
    const hour = String(parsed.getHours()).padStart(2, '0')
    const minute = String(parsed.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }, [releaseMeta])

  React.useEffect(() => {
    try {
      localStorage.setItem('cms.sidebarCollapsed', isCollapsed ? '1' : '0')
    } catch {
      return
    }
  }, [isCollapsed])

  React.useEffect(() => {
    let cancelled = false
    if (typeof window.electronAPI.getReleaseMeta !== 'function') return
    void window.electronAPI
      .getReleaseMeta()
      .then((meta) => {
        if (cancelled) return
        setReleaseMeta(meta)
      })
      .catch(() => void 0)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-zinc-800 bg-zinc-950',
        isCollapsed ? 'w-16 p-2' : 'w-64 p-4'
      )}
    >
      {!isCollapsed && (
        <div className="px-2 text-sm font-semibold tracking-wide text-zinc-200">Super CMS 控制台</div>
      )}
      <nav className="mt-4 flex flex-1 flex-col gap-1">
        {menuItems.map((item) => {
          const isActive = item.id === active
          const Icon = iconMap[item.icon]
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              title={isCollapsed ? item.label : undefined}
              aria-label={isCollapsed ? item.label : undefined}
              className={cn(
                'flex items-center rounded-md py-2 text-left text-sm transition-colors',
                isCollapsed ? 'justify-center px-0' : 'px-3',
                isActive ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900/60'
              )}
            >
              <Icon className={cn('h-4 w-4', !isCollapsed && 'mr-2')} />
              {!isCollapsed && item.label}
            </button>
          )
        })}

        <div className="mt-auto flex flex-col gap-1">
          {bottomItems.map((item) => {
            const isActive = item.id === active
            const Icon = iconMap[item.icon]
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChange(item.id)}
                title={isCollapsed ? item.label : undefined}
                aria-label={isCollapsed ? item.label : undefined}
                className={cn(
                  'flex items-center rounded-md py-2 text-left text-sm transition-colors',
                  isCollapsed ? 'justify-center px-0' : 'px-3',
                  isActive ? 'bg-zinc-900 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900/60'
                )}
              >
                <Icon className={cn('h-4 w-4', !isCollapsed && 'mr-2')} />
                {!isCollapsed && item.label}
              </button>
            )
          })}

          {!isCollapsed && (
            <div className="px-0 text-[11px] leading-5 text-zinc-400">
              <div className="text-zinc-300">{displayVersion}</div>
              <div>更新日期：{displayUpdatedAt}</div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed((v) => !v)}
            title={isCollapsed ? '展开' : '折叠'}
            aria-label={isCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className={cn(
              'flex items-center rounded-md py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-900/60',
              isCollapsed ? 'justify-center px-0' : 'px-3'
            )}
          >
            {isCollapsed ? '>>' : '<<'}
            {!isCollapsed && <span className="ml-2">收起</span>}
          </button>
        </div>
      </nav>
    </aside>
  )
}

export { Sidebar }
