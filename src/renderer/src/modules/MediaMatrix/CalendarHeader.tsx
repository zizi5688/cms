import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import { useCmsStore } from '@renderer/store/useCmsStore'

type CalendarHeaderProps = {
  viewSpan: 4 | 7
  onViewSpanChange: (next: 4 | 7) => void
  showPublished: boolean
  isSidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onShowPublishedChange: (next: boolean) => void
}

function CalendarHeader({
  viewSpan,
  onViewSpanChange,
  showPublished,
  isSidebarCollapsed,
  onToggleSidebar,
  onShowPublishedChange
}: CalendarHeaderProps): React.JSX.Element {
  const preferences = useCmsStore((s) => s.preferences)
  const updatePreferences = useCmsStore((s) => s.updatePreferences)
  const addLog = useCmsStore((s) => s.addLog)

  const [isPrefsOpen, setIsPrefsOpen] = useState(false)
  const [tempPreferences, setTempPreferences] = useState(() => preferences)
  const skipFirstSaveRef = useRef(true)

  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }

    const handle = window.setTimeout(() => {
      void window.electronAPI
        .saveConfig({
          defaultStartTime: preferences.defaultStartTime,
          defaultInterval: preferences.defaultInterval
        })
        .catch(() => {
          addLog('[日历] 保存排期偏好失败。')
        })
    }, 200)

    return () => window.clearTimeout(handle)
  }, [addLog, preferences.defaultInterval, preferences.defaultStartTime])

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-900/10 px-3 py-2">
      <div className="flex items-center gap-2">
        {typeof onToggleSidebar === 'function' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            aria-label={isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            className="h-8 w-8"
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        ) : null}
        <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-900/60">
          <button
            type="button"
            onClick={() => onViewSpanChange(4)}
            className={cn(
              'px-3 py-1.5 text-xs transition',
              viewSpan === 4
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            )}
          >
            4日
          </button>
          <button
            type="button"
            onClick={() => onViewSpanChange(7)}
            className={cn(
              'px-3 py-1.5 text-xs transition',
              viewSpan === 7
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
            )}
          >
            7日
          </button>
        </div>
      </div>

      <div className="min-w-0 flex-1 px-2 text-center text-sm font-semibold text-zinc-100">
        {showPublished ? '滚动日程（显示已发布）' : '滚动日程（隐藏已发布）'}
      </div>

      <div className="flex items-center gap-2">
        <label
          className={cn(
            'flex h-9 cursor-pointer select-none items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 text-sm',
            showPublished ? 'text-zinc-200' : 'text-zinc-500'
          )}
        >
          <input
            type="checkbox"
            checked={showPublished}
            onChange={(e) => onShowPublishedChange(e.target.checked)}
            className="h-4 w-4 accent-zinc-200"
          />
          <span className="text-sm">已发布</span>
        </label>

        <div className="relative">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => {
              setIsPrefsOpen((v) => {
                const next = !v
                if (next) setTempPreferences(preferences)
                return next
              })
            }}
            aria-label="排期偏好"
          >
            ⚙️
          </Button>
          {isPrefsOpen ? (
            <div className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-zinc-800 bg-zinc-950 p-3 shadow-xl">
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">默认起始时间</div>
                  <Input
                    type="time"
                    value={tempPreferences.defaultStartTime}
                    onChange={(e) =>
                      setTempPreferences((prev) => ({
                        ...prev,
                        defaultStartTime: e.target.value
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">默认间隔（分钟）</div>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={tempPreferences.defaultInterval}
                    onChange={(e) =>
                      setTempPreferences((prev) => ({
                        ...prev,
                        defaultInterval: Math.max(0, Number(e.target.value) || 0)
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setIsPrefsOpen(false)}>
                    取消
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      updatePreferences(tempPreferences)
                      setIsPrefsOpen(false)
                    }}
                  >
                    确认
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { CalendarHeader }
