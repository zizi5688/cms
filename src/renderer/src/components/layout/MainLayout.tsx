import type * as React from 'react'

import { ConsolePanel } from '@renderer/components/layout/ConsolePanel'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { ImageLab } from '@renderer/components/modules/ImageLab'
import { Settings } from '@renderer/components/modules/Settings'
import { UploadManager } from '@renderer/components/modules/UploadManager'
import { DataWorkshop } from '@renderer/modules/DataWorkshop'
import { HeatDashboard } from '@renderer/modules/HeatDashboard'
import { MediaMatrix } from '@renderer/modules/MediaMatrix'
import { ProductScout } from '@renderer/modules/ProductScout'
import { useCmsStore } from '@renderer/store/useCmsStore'
import { cn } from '@renderer/lib/utils'

function MainLayout(): React.JSX.Element {
  const active = useCmsStore((s) => s.activeModule)
  const setActive = useCmsStore((s) => s.setActiveModule)
  const isHeatboard = active === 'heatboard'

  let content: React.JSX.Element
  switch (active) {
    case 'workshop':
      content = <DataWorkshop />
      break
    case 'upload':
      content = <UploadManager />
      break
    case 'material':
      content = <ImageLab />
      break
    case 'autopublish':
      content = <MediaMatrix />
      break
    case 'scout':
      content = <ProductScout />
      break
    case 'heatboard':
      content = <HeatDashboard />
      break
    case 'settings':
      content = <Settings />
      break
    default:
      content = (
        <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/10 p-6 text-sm text-zinc-400">
          配置中心模块将在下一阶段实现。
        </div>
      )
  }

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
          {content}
        </main>
      </div>
      {import.meta.env.DEV && <ConsolePanel />}
    </div>
  )
}

export { MainLayout }
