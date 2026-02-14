import { app, dialog } from 'electron'
import { constants } from 'fs'
import { access, mkdir } from 'fs/promises'
import { resolve, join } from 'path'
import { is } from '@electron-toolkit/utils'

export type WorkspaceStatus = 'initialized' | 'uninitialized'

export class WorkspaceService {
  private store: { get: (key: string) => unknown; set: (key: string, value: unknown) => void; delete: (key: string) => void }
  private currentPathValue: string | null = null
  private statusValue: WorkspaceStatus = 'uninitialized'

  private createNoWritePermissionError(targetPath: string, cause?: unknown): Error {
    const error = new Error(`No Write Permission: ${targetPath}`)
    ;(error as unknown as { code?: string }).code = 'NO_WRITE_PERMISSION'
    ;(error as unknown as { cause?: unknown }).cause = cause
    return error
  }

  constructor(store: { get: (key: string) => unknown; set: (key: string, value: unknown) => void; delete: (key: string) => void }) {
    this.store = store
  }

  get currentPath(): string {
    return this.currentPathValue ?? ''
  }

  get status(): WorkspaceStatus {
    return this.statusValue
  }

  async init(): Promise<{ path: string; status: WorkspaceStatus }> {
    const stored = this.store.get('workspacePath')
    const normalizedStored = typeof stored === 'string' ? stored.trim() : ''
    const defaultPath = join(app.getPath('documents'), is.dev ? 'SuperCMS_Data_Dev' : 'SuperCMS_Data')

    if (normalizedStored) {
      await this.applyPath(normalizedStored, false)
      // 如果 stored path 失败了，fallback 到默认路径
      if (this.statusValue !== 'initialized') {
        console.warn(`[Workspace] Stored path failed (${normalizedStored}), falling back to default: ${defaultPath}`)
        await this.applyPath(defaultPath, true)
      }
      return { path: this.currentPath, status: this.statusValue }
    }

    await this.applyPath(defaultPath, true)
    return { path: this.currentPath, status: this.statusValue }
  }

  async setPath(newPath: string): Promise<{ path: string }> {
    const normalized = String(newPath ?? '').trim()
    if (!normalized) throw new Error('[Workspace] newPath is required.')

    const resolvedPath = resolve(normalized)
    try {
      await mkdir(resolvedPath, { recursive: true })
      try {
        await access(resolvedPath, constants.W_OK)
      } catch (error) {
        throw this.createNoWritePermissionError(resolvedPath, error)
      }
      this.currentPathValue = resolvedPath
      this.statusValue = 'initialized'
      this.store.set('workspacePath', resolvedPath)
      return { path: resolvedPath }
    } catch (error) {
      const err = error as { code?: unknown; message?: unknown; stack?: unknown }
      const code = typeof err?.code === 'string' ? err.code : err?.code != null ? String(err.code) : ''
      const message = typeof err?.message === 'string' ? err.message : String(err?.message ?? '')
      const stack = typeof err?.stack === 'string' ? err.stack : String(err?.stack ?? '')
      dialog.showErrorBox(
        '工作区初始化失败 (Debug)',
        `路径: ${resolvedPath}\n错误代码: ${code}\n错误信息: ${message}\n堆栈: ${stack}`
      )
      throw error
    }
  }

  private async applyPath(rawPath: string, persist: boolean): Promise<void> {
    const normalized = String(rawPath ?? '').trim()
    if (!normalized) {
      this.currentPathValue = ''
      this.statusValue = 'uninitialized'
      if (persist) this.store.delete('workspacePath')
      return
    }

    const resolvedPath = resolve(normalized)
    try {
      await mkdir(resolvedPath, { recursive: true })
      try {
        await access(resolvedPath, constants.W_OK)
      } catch (error) {
        throw this.createNoWritePermissionError(resolvedPath, error)
      }
      this.currentPathValue = resolvedPath
      this.statusValue = 'initialized'
      if (persist) this.store.set('workspacePath', resolvedPath)
    } catch (error) {
      const err = error as { code?: unknown; message?: unknown; stack?: unknown }
      const code = typeof err?.code === 'string' ? err.code : err?.code != null ? String(err.code) : ''
      const message = typeof err?.message === 'string' ? err.message : String(err?.message ?? '')
      const stack = typeof err?.stack === 'string' ? err.stack : String(err?.stack ?? '')
      dialog.showErrorBox(
        '工作区初始化失败 (Debug)',
        `路径: ${resolvedPath}\n错误代码: ${code}\n错误信息: ${message}\n堆栈: ${stack}`
      )
      this.currentPathValue = resolvedPath
      this.statusValue = 'uninitialized'
      if (persist) this.store.set('workspacePath', resolvedPath)
    }
  }
}
