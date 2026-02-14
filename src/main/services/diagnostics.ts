/**
 * diagnostics.ts — 失败诊断服务
 *
 * 利用 Electron 内置 webContents.debugger API (CDP) 获取：
 * - 失败时截图
 * - 网络请求日志
 *
 * 仅在自动化失败时保存诊断数据，成功时不保留。
 */

import { WebContents } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type NetworkEntry = {
  url: string
  method: string
  status: number
  type: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// DiagnosticsService
// ---------------------------------------------------------------------------

export class DiagnosticsService {
  private webContents: WebContents | null = null
  private attached = false
  private networkLog: NetworkEntry[] = []
  private requestMap = new Map<string, { url: string; method: string; type: string; timestamp: number }>()

  attach(webContents: WebContents): void {
    this.webContents = webContents
    this.networkLog = []
    this.requestMap.clear()

    try {
      webContents.debugger.attach('1.3')
      this.attached = true
    } catch (error) {
      console.log('[Diagnostics] CDP attach failed:', error instanceof Error ? error.message : String(error))
      this.attached = false
      return
    }

    try {
      webContents.debugger.sendCommand('Network.enable')
    } catch {
      // 静默
    }

    webContents.debugger.on('message', (_event, method, params) => {
      try {
        if (method === 'Network.requestWillBeSent') {
          const requestId = params.requestId as string
          this.requestMap.set(requestId, {
            url: String(params.request?.url ?? ''),
            method: String(params.request?.method ?? 'GET'),
            type: String(params.type ?? ''),
            timestamp: Date.now()
          })
        }

        if (method === 'Network.responseReceived') {
          const requestId = params.requestId as string
          const req = this.requestMap.get(requestId)
          if (req) {
            this.networkLog.push({
              ...req,
              status: Number(params.response?.status ?? 0)
            })
            this.requestMap.delete(requestId)
            // 限制日志大小
            if (this.networkLog.length > 500) {
              this.networkLog = this.networkLog.slice(-300)
            }
          }
        }
      } catch {
        // 静默
      }
    })
  }

  async captureScreenshot(): Promise<Buffer | null> {
    if (!this.attached || !this.webContents) return null
    try {
      const result = await this.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        quality: 80
      })
      if (result && typeof result.data === 'string') {
        return Buffer.from(result.data, 'base64')
      }
    } catch (error) {
      console.log('[Diagnostics] Screenshot failed:', error instanceof Error ? error.message : String(error))
    }
    return null
  }

  getNetworkLog(): NetworkEntry[] {
    return [...this.networkLog]
  }

  detach(): void {
    if (this.attached && this.webContents) {
      try {
        this.webContents.debugger.detach()
      } catch {
        // 静默
      }
    }
    this.attached = false
    this.webContents = null
    this.networkLog = []
    this.requestMap.clear()
  }

  /**
   * 保存诊断数据到磁盘（仅在失败时调用）
   */
  async saveDiagnostics(options: {
    taskId: string
    workspacePath: string
    errorMessage?: string
  }): Promise<string | null> {
    const { taskId, workspacePath, errorMessage } = options
    const dirPath = path.join(workspacePath, 'diagnostics')

    try {
      await fs.promises.mkdir(dirPath, { recursive: true })
    } catch {
      return null
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const baseName = `${timestamp}_${taskId.slice(0, 8)}`

    // 保存截图
    const screenshot = await this.captureScreenshot()
    if (screenshot) {
      const screenshotPath = path.join(dirPath, `${baseName}.png`)
      try {
        await fs.promises.writeFile(screenshotPath, screenshot)
      } catch {
        // 静默
      }
    }

    // 保存网络日志 + 错误信息
    const logData = {
      taskId,
      timestamp: new Date().toISOString(),
      error: errorMessage || '',
      networkLog: this.getNetworkLog()
    }
    const logPath = path.join(dirPath, `${baseName}.json`)
    try {
      await fs.promises.writeFile(logPath, JSON.stringify(logData, null, 2))
    } catch {
      // 静默
    }

    // 清理旧诊断文件（保留最近 50 个）
    try {
      const files = await fs.promises.readdir(dirPath)
      const pngFiles = files.filter((f) => f.endsWith('.png')).sort()
      if (pngFiles.length > 50) {
        const toDelete = pngFiles.slice(0, pngFiles.length - 50)
        for (const file of toDelete) {
          try {
            await fs.promises.unlink(path.join(dirPath, file))
            // 同时删除对应 JSON
            const jsonFile = file.replace('.png', '.json')
            await fs.promises.unlink(path.join(dirPath, jsonFile)).catch(() => {})
          } catch {
            // 静默
          }
        }
      }
    } catch {
      // 静默
    }

    return logPath
  }
}
