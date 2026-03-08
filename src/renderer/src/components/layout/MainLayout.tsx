import { useEffect, useState } from 'react'
import type * as React from 'react'

import { ConsolePanel } from '@renderer/components/layout/ConsolePanel'
import { Sidebar, type SidebarItemKey } from '@renderer/components/layout/Sidebar'
import { AiStudio } from '@renderer/modules/AiStudio'
import { ImageLab } from '@renderer/components/modules/ImageLab'
import { Settings } from '@renderer/components/modules/Settings'
import { UploadManager } from '@renderer/components/modules/UploadManager'
import { DataWorkshop } from '@renderer/modules/DataWorkshop'
import { HeatDashboard } from '@renderer/modules/HeatDashboard'
import { MediaMatrix } from '@renderer/modules/MediaMatrix'
import { NoteRaceBoard } from '@renderer/modules/NoteRaceBoard'
import { useCmsStore } from '@renderer/store/useCmsStore'
import { cn } from '@renderer/lib/utils'

const MODULE_ORDER: SidebarItemKey[] = ['aiStudio', 'material', 'workshop', 'upload', 'autopublish', 'raceboard', 'heatboard', 'settings']

function renderModule(moduleId: SidebarItemKey): React.JSX.Element {
  switch (moduleId) {
    case 'aiStudio':
      return <AiStudio />
    case 'workshop':
      return <DataWorkshop />
    case 'upload':
      return <UploadManager />
    case 'material':
      return <ImageLab />
    case 'autopublish':
      return <MediaMatrix />
    case 'raceboard':
      return <NoteRaceBoard />
    case 'heatboard':
      return <HeatDashboard />
    case 'settings':
      return <Settings />
    default:
      return (
        <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/10 p-6 text-sm text-zinc-400">
          配置中心模块将在下一阶段实现。
        </div>
      )
  }
}

function MainLayout(): React.JSX.Element {
  const active = useCmsStore((s) => s.activeModule)
  const setActive = useCmsStore((s) => s.setActiveModule)
  const isHeatboard = active === 'heatboard'
  const [mountedModules, setMountedModules] = useState<Set<SidebarItemKey>>(() => new Set([active]))

  // Keep visited modules mounted so in-flight local task state survives module switching.
  useEffect(() => {
    setMountedModules((prev) => {
      if (prev.has(active)) return prev
      const next = new Set(prev)
      next.add(active)
      return next
    })
  }, [active])

  return (
    <div className="flex h-full min-h-screen flex-col bg-zinc-950 text-zinc-50">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar active={active} onChange={setActive} />
        <main
          className={cn(
            'min-h-0 flex-1',
            isHeatboard ? 'overflow-hidden p-0' : 'overflow-auto p-6'
          )}
        >
          {MODULE_ORDER.map((moduleId) => {
            if (!mountedModules.has(moduleId)) return null
            const isActiveModule = moduleId === active
            return (
              <section
                key={moduleId}
                className={cn('h-full', isActiveModule ? 'block' : 'hidden')}
                aria-hidden={!isActiveModule}
              >
                {renderModule(moduleId)}
              </section>
            )
          })}
        </main>
      </div>
      {import.meta.env.DEV && <ConsolePanel />}
    </div>
  )
}

export { MainLayout }
