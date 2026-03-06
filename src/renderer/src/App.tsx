import type * as React from 'react'
import { useEffect } from 'react'

import { MainLayout } from '@renderer/components/layout/MainLayout'
import { useCmsStore } from '@renderer/store/useCmsStore'

function isValidWatermarkBox(
  value: unknown
): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.x === 'number' &&
    typeof record.y === 'number' &&
    typeof record.width === 'number' &&
    typeof record.height === 'number'
  )
}

function normalizeDynamicWatermarkTrajectory(value: unknown): 'smoothSine' | 'figureEight' | 'diagonalWrap' | 'largeEllipse' | 'pseudoRandom' {
  const normalized = String(value ?? '').trim()
  const available = ['smoothSine', 'figureEight', 'diagonalWrap', 'largeEllipse', 'pseudoRandom']
  return (available.includes(normalized) ? normalized : 'pseudoRandom') as
    | 'smoothSine'
    | 'figureEight'
    | 'diagonalWrap'
    | 'largeEllipse'
    | 'pseudoRandom'
}

function App(): React.JSX.Element {
  const updateConfig = useCmsStore((s) => s.updateConfig)
  const updatePreferences = useCmsStore((s) => s.updatePreferences)
  const addLog = useCmsStore((s) => s.addLog)
  const setWorkspacePath = useCmsStore((s) => s.setWorkspacePath)
  const selectedPublishTaskIds = useCmsStore((s) => s.selectedPublishTaskIds)
  const deleteTasks = useCmsStore((s) => s.deleteTasks)
  const clearSelectedPublishTaskIds = useCmsStore((s) => s.clearSelectedPublishTaskIds)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const workspace = await window.electronAPI.getWorkspacePath()
        if (!cancelled && workspace && typeof workspace.path === 'string') {
          setWorkspacePath(workspace.path)
        }
      } catch {
        if (!cancelled) addLog('[工作区] 读取路径失败。')
      }

      try {
        const saved = await window.electronAPI.getConfig()
        if (!cancelled && saved) {
          const patch: Parameters<typeof updateConfig>[0] = {
            aiProvider: saved.aiProvider === 'grsai' ? saved.aiProvider : 'grsai',
            aiBaseUrl: saved.aiBaseUrl ?? '',
            aiApiKey: saved.aiApiKey ?? '',
            aiDefaultImageModel: saved.aiDefaultImageModel ?? '',
            importStrategy: saved.importStrategy === 'move' ? 'move' : 'copy',
            realEsrganPath: saved.realEsrganPath ?? '',
            pythonPath: saved.pythonPath ?? '',
            watermarkScriptPath: saved.watermarkScriptPath ?? '',
            dynamicWatermarkEnabled: saved.dynamicWatermarkEnabled === true,
            dynamicWatermarkOpacity:
              typeof saved.dynamicWatermarkOpacity === 'number'
                ? Math.max(0, Math.min(100, Math.round(saved.dynamicWatermarkOpacity)))
                : 15,
            dynamicWatermarkSize:
              typeof saved.dynamicWatermarkSize === 'number'
                ? Math.max(2, Math.min(10, Math.round(saved.dynamicWatermarkSize)))
                : 5,
            dynamicWatermarkTrajectory: normalizeDynamicWatermarkTrajectory(saved.dynamicWatermarkTrajectory),
            storageMaintenanceEnabled: saved.storageMaintenanceEnabled === true,
            storageMaintenanceStartTime:
              typeof saved.storageMaintenanceStartTime === 'string' &&
              /^([01]\d|2[0-3]):[0-5]\d$/.test(saved.storageMaintenanceStartTime)
                ? saved.storageMaintenanceStartTime
                : '02:30',
            storageMaintenanceRetainDays:
              typeof saved.storageMaintenanceRetainDays === 'number'
                ? Math.max(1, Math.min(120, Math.floor(saved.storageMaintenanceRetainDays)))
                : 7,
            storageArchivePath: saved.storageArchivePath ?? ''
          }
          if (isValidWatermarkBox(saved.watermarkBox)) {
            patch.watermarkBox = saved.watermarkBox
          }
          updateConfig({
            ...patch
          })
          updatePreferences({
            defaultStartTime: saved.defaultStartTime ?? '10:00',
            defaultInterval: Number(saved.defaultInterval) || 30
          })
        }
      } catch {
        if (!cancelled) addLog('[设置] 读取本地工具配置失败。')
      }

      try {
        const savedFeishu = await window.electronAPI.getFeishuConfig()
        if (cancelled || !savedFeishu) return
        updateConfig({
          appId: savedFeishu.appId ?? '',
          appSecret: savedFeishu.appSecret ?? '',
          baseToken: savedFeishu.baseToken ?? '',
          tableId: savedFeishu.tableId ?? ''
        })
      } catch {
        if (!cancelled) addLog('[Feishu] 读取本地配置失败，请前往「设置」重新测试连接以保存。')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [addLog, setWorkspacePath, updateConfig, updatePreferences])

  useEffect(() => {
    return window.api.cms.publisher.onAutomationLog((message) => {
      const normalized = String(message ?? '').trim()
      if (normalized) addLog(normalized)
    })
  }, [addLog])

  useEffect(() => {
    return window.api.cms.system.onLog((payload) => {
      if (typeof payload === 'string') {
        const normalized = payload.trim()
        if (normalized) addLog(`[System] ${normalized}`)
        return
      }
      const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
      if (message) addLog(`[System] ${message}`)
    })
  }, [addLog])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (selectedPublishTaskIds.length === 0) return

      const active = document.activeElement as HTMLElement | null
      const tag = active?.tagName?.toLowerCase()
      const isEditable =
        Boolean(active && (active as HTMLElement).isContentEditable) ||
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select'

      if (isEditable) return

      event.preventDefault()
      event.stopPropagation()

      void (async () => {
        const count = selectedPublishTaskIds.length
        const message = `确定要删除这 ${count} 个任务吗？`
        let confirmed = false

        try {
          const result = await window.electronAPI.showMessageBox({
            type: 'warning',
            title: '确认删除',
            message,
            detail: '删除后无法恢复。',
            buttons: ['删除', '取消'],
            defaultId: 1,
            cancelId: 1
          })
          confirmed = result.response === 0
        } catch {
          confirmed = window.confirm(message)
        }

        if (!confirmed) return
        try {
          await deleteTasks(selectedPublishTaskIds)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          window.alert(`删除失败：${msg}`)
        } finally {
          clearSelectedPublishTaskIds()
        }
      })()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [clearSelectedPublishTaskIds, deleteTasks, selectedPublishTaskIds])

  return <MainLayout />
}

export default App
