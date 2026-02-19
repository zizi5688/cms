import { useEffect, useMemo, useRef, useState } from 'react'
import type * as React from 'react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { useCmsStore } from '@renderer/store/useCmsStore'

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function Settings(): React.JSX.Element {
  const config = useCmsStore((s) => s.config)
  const addLog = useCmsStore((s) => s.addLog)
  const updateConfig = useCmsStore((s) => s.updateConfig)
  const preferences = useCmsStore((s) => s.preferences)
  const updatePreferences = useCmsStore((s) => s.updatePreferences)

  const [isTesting, setIsTesting] = useState(false)
  const [workspacePath, setWorkspacePath] = useState('')
  const [workspaceStatus, setWorkspaceStatus] = useState<'initialized' | 'uninitialized'>('uninitialized')
  const exePickerRef = useRef<HTMLInputElement | null>(null)
  const pythonPickerRef = useRef<HTMLInputElement | null>(null)
  const scriptPickerRef = useRef<HTMLInputElement | null>(null)
  const skipFirstSaveRef = useRef(true)

  const isFeishuConfigReady = useMemo(() => {
    return isNonEmpty(config.appId) && isNonEmpty(config.appSecret) && isNonEmpty(config.baseToken) && isNonEmpty(config.tableId)
  }, [config])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const savedTools = await window.electronAPI.getConfig()
        if (!cancelled && savedTools) {
          updateConfig({
            importStrategy: savedTools.importStrategy === 'move' ? 'move' : 'copy',
            realEsrganPath: savedTools.realEsrganPath ?? '',
            pythonPath: savedTools.pythonPath ?? '',
            watermarkScriptPath: savedTools.watermarkScriptPath ?? '',
            scoutDashboardAutoImportDir: savedTools.scoutDashboardAutoImportDir ?? ''
          })
          updatePreferences({
            defaultStartTime: savedTools.defaultStartTime ?? '10:00',
            defaultInterval: Number(savedTools.defaultInterval) || 30
          })
        }
      } catch {
        if (!cancelled) addLog('[设置] 读取本地工具配置失败。')
      }

      try {
        const saved = await window.electronAPI.getFeishuConfig()
        if (cancelled || !saved) return

        updateConfig({
          appId: saved.appId ?? '',
          appSecret: saved.appSecret ?? '',
          baseToken: saved.baseToken ?? '',
          tableId: saved.tableId ?? ''
        })
        addLog('[Feishu] 已从本地加载配置。')
      } catch {
        if (cancelled) return
        addLog('[Feishu] 读取本地配置失败，请重新测试连接以保存。')
      }

      try {
        const workspace = await window.electronAPI.getWorkspacePath()
        if (cancelled || !workspace) return
        setWorkspacePath(workspace.path ?? '')
        setWorkspaceStatus(workspace.status ?? 'uninitialized')
      } catch {
        if (cancelled) return
        addLog('[工作区] 读取工作区路径失败。')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [addLog, updateConfig])

  const changeWorkspace = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.pickWorkspacePath()
      if (!selected) return
      const result = await window.electronAPI.setWorkspacePath(selected)
      setWorkspacePath(result.path ?? '')
      setWorkspaceStatus('initialized')
      addLog(`[工作区] 已切换至：${result.path}`)
      window.alert('工作区已切换，应用将重启。')
      await window.electronAPI.relaunch()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[工作区] 切换失败：${message}`)
      window.alert(message)
    }
  }

  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false
      return
    }

    const handle = window.setTimeout(() => {
      void window.electronAPI
        .saveConfig({
          importStrategy: config.importStrategy,
          realEsrganPath: config.realEsrganPath,
          pythonPath: config.pythonPath,
          watermarkScriptPath: config.watermarkScriptPath,
          scoutDashboardAutoImportDir: config.scoutDashboardAutoImportDir,
          defaultStartTime: preferences.defaultStartTime,
          defaultInterval: preferences.defaultInterval
        })
        .catch(() => {
          addLog('[设置] 保存工具路径失败。')
        })
    }, 200)

    return () => {
      window.clearTimeout(handle)
    }
  }, [
    addLog,
    config.importStrategy,
    config.pythonPath,
    config.realEsrganPath,
    config.scoutDashboardAutoImportDir,
    config.watermarkScriptPath,
    preferences.defaultInterval,
    preferences.defaultStartTime
  ])

  const chooseScoutDashboardAutoImportDir = async (): Promise<void> => {
    try {
      const selected = await window.electronAPI.openDirectory()
      if (!selected) return
      updateConfig({ scoutDashboardAutoImportDir: selected })
      addLog(`[热度看板] 自动导入目录已设置：${selected}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[热度看板] 设置自动导入目录失败：${message}`)
      window.alert(message)
    }
  }

  const clearScoutDashboardAutoImportDir = (): void => {
    if (!config.scoutDashboardAutoImportDir.trim()) return
    updateConfig({ scoutDashboardAutoImportDir: '' })
    addLog('[热度看板] 自动导入目录已清空。')
  }

  const testConnection = async (): Promise<void> => {
    if (isTesting) return
    if (!isFeishuConfigReady) {
      addLog('[Feishu] 配置不完整：请先填写 appId/appSecret/baseToken/tableId。')
      return
    }

    setIsTesting(true)
    try {
      addLog('[Feishu] 测试连接中...')
      await window.electronAPI.testFeishuConnection(config.appId, config.appSecret, config.baseToken, config.tableId)
      addLog('[Feishu] 连接成功并已保存配置。')
      window.alert('连接成功并已保存配置')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addLog(`[Feishu] 连接失败：${message}`)
      window.alert(message)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>设置</CardTitle>
          <CardDescription>管理飞书连接信息；配置会保存到本地并在下次启动时自动加载。</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>工作区管理</CardTitle>
          <CardDescription>切换本地工作区后，数据将写入该目录下的 SQLite 数据库；切换后应用会重启。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">当前工作区路径</div>
            <Input value={workspacePath || '(未设置，使用默认路径)'} readOnly className={workspacePath ? '' : 'text-zinc-500 italic'} />
            {workspaceStatus !== 'initialized' ? (
              <div className="text-xs text-amber-400">工作区状态异常：请点击「切换工作区」重新选择一个可写目录。</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={changeWorkspace}>切换工作区</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>热度看板自动导入</CardTitle>
          <CardDescription>设置爆款表文件夹后，系统会递归监听该目录，仅导入“配置生效后新增”的模板文件。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">爆款表文件夹</div>
            <Input
              value={config.scoutDashboardAutoImportDir || '(未设置)'}
              readOnly
              className={config.scoutDashboardAutoImportDir ? '' : 'text-zinc-500 italic'}
            />
            <div className="text-xs text-zinc-400">
              支持多层子目录（如按年份/日期分层）；历史文件不会补导，仅监听配置后的新增文件。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={chooseScoutDashboardAutoImportDir}>
              选择文件夹
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={clearScoutDashboardAutoImportDir}
              disabled={!config.scoutDashboardAutoImportDir.trim()}
            >
              清空
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>导入策略</CardTitle>
          <CardDescription>控制派发任务时图片导入到工作区的方式。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={config.importStrategy === 'move'}
              onChange={(e) => updateConfig({ importStrategy: e.target.checked ? 'move' : 'copy' })}
            />
            <div className="text-sm text-zinc-200">导入后删除源文件 (Move instead of Copy)</div>
          </label>
          <div className="text-xs text-amber-400">
            开启后，源文件将被移动到工作区，原位置文件不再保留。请谨慎开启。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>飞书配置</CardTitle>
          <CardDescription>所有飞书 API 调用在主进程执行；此处仅配置参数并通过 IPC 调用。</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">应用 ID</div>
            <Input value={config.appId} onChange={(e) => updateConfig({ appId: e.target.value })} placeholder="cli_xxx" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">应用密钥</div>
            <Input
              type="password"
              value={config.appSecret}
              onChange={(e) => updateConfig({ appSecret: e.target.value })}
              placeholder="xxxx"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">Base Token（app_token）</div>
            <Input value={config.baseToken} onChange={(e) => updateConfig({ baseToken: e.target.value })} placeholder="bascn..." />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">数据表 ID</div>
            <Input value={config.tableId} onChange={(e) => updateConfig({ tableId: e.target.value })} placeholder="tbl..." />
          </div>

          <div className="flex items-end md:col-span-2">
            <Button onClick={testConnection} disabled={!isFeishuConfigReady || isTesting}>
              测试连接
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">标题字段 Key</div>
            <Input value={config.titleField} onChange={(e) => updateConfig({ titleField: e.target.value })} placeholder="标题" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">正文字段 Key</div>
            <Input value={config.bodyField} onChange={(e) => updateConfig({ bodyField: e.target.value })} placeholder="正文" />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <div className="text-xs text-zinc-400">图片字段 Key（可选）</div>
            <Input value={config.imageField} onChange={(e) => updateConfig({ imageField: e.target.value })} placeholder="图片" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>工具配置</CardTitle>
          <CardDescription>配置本地工具路径（用于图片处理流水线）。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            ref={exePickerRef}
            type="file"
            accept="*/*"
            className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
            onChange={(e) => {
              const file = (e.target.files ?? [])[0]
              e.currentTarget.value = ''
              if (!file) return
              const filePath = window.electronAPI.getPathForFile(file).trim()
              if (!filePath) {
                addLog('[设置] 未能获取 Real-ESRGAN 可执行文件路径。')
                return
              }
              updateConfig({ realEsrganPath: filePath })
              addLog(`[设置] Real-ESRGAN 已设置：${filePath}`)
            }}
          />

          <input
            ref={pythonPickerRef}
            type="file"
            accept="*/*"
            className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
            onChange={(e) => {
              const file = (e.target.files ?? [])[0]
              e.currentTarget.value = ''
              if (!file) return
              const filePath = window.electronAPI.getPathForFile(file).trim()
              if (!filePath) {
                addLog('[设置] 未能获取 Python 解释器路径。')
                return
              }
              updateConfig({ pythonPath: filePath })
              addLog(`[设置] Python 已设置：${filePath}`)
            }}
          />

          <input
            ref={scriptPickerRef}
            type="file"
            accept="*/*"
            className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
            onChange={(e) => {
              const file = (e.target.files ?? [])[0]
              e.currentTarget.value = ''
              if (!file) return
              const filePath = window.electronAPI.getPathForFile(file).trim()
              if (!filePath) {
                addLog('[设置] 未能获取去印脚本路径。')
                return
              }
              updateConfig({ watermarkScriptPath: filePath })
              addLog(`[设置] 去印脚本已设置：${filePath}`)
            }}
          />

          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">Real-ESRGAN 可执行文件路径</div>
            <div className="flex gap-2">
              <Input
                value={config.realEsrganPath}
                onChange={(e) => updateConfig({ realEsrganPath: e.target.value })}
                placeholder="/path/to/realesrgan-ncnn-vulkan"
              />
              <Button type="button" variant="outline" onClick={() => exePickerRef.current?.click()}>
                浏览
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">Python 解释器路径</div>
            <div className="flex gap-2">
              <Input
                value={config.pythonPath}
                onChange={(e) => updateConfig({ pythonPath: e.target.value })}
                placeholder="/usr/local/bin/python3.10"
              />
              <Button type="button" variant="outline" onClick={() => pythonPickerRef.current?.click()}>
                浏览
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs text-zinc-400">去印脚本路径</div>
            <div className="flex gap-2">
              <Input
                value={config.watermarkScriptPath}
                onChange={(e) => updateConfig({ watermarkScriptPath: e.target.value })}
                placeholder="/Users/z/AI_Tools/watermark_cli.py"
              />
              <Button type="button" variant="outline" onClick={() => scriptPickerRef.current?.click()}>
                浏览
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export { Settings }
