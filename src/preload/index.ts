import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 渲染进程自定义 API（后续通过 IPC 扩展）
const api = {}

// 仅在启用上下文隔离时通过 contextBridge 暴露；否则挂载到全局 window
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
