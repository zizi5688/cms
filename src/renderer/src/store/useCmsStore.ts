import { create } from 'zustand'

export type TaskStatus = 'idle' | 'uploading' | 'success' | 'error'
export type ActiveModuleKey =
  | 'workshop'
  | 'upload'
  | 'material'
  | 'autopublish'
  | 'scout'
  | 'heatboard'
  | 'settings'
export type ModuleId = ActiveModuleKey

export type WorkshopImport = {
  type: 'image' | 'video' | null
  path: string | null
  paths?: string[]
  coverPath?: string
  source: 'imagelab' | null
}

export interface Task {
  id: string
  title: string
  body: string
  assignedImages: string[]
  mediaType?: 'image' | 'video'
  videoPath?: string
  videoPreviewPath?: string
  status: TaskStatus
  log: string
}

export interface UploadTask {
  title: string
  body: string
  images: string[]
}

export interface WatermarkBox {
  x: number
  y: number
  width: number
  height: number
}

export interface CmsPreferences {
  defaultStartTime: string
  defaultInterval: number
}

export interface CmsConfig {
  appId: string
  appSecret: string
  baseToken: string
  tableId: string
  titleField: string
  bodyField: string
  imageField: string
  importStrategy: 'copy' | 'move'
  realEsrganPath: string
  pythonPath: string
  watermarkScriptPath: string
  dynamicWatermarkEnabled: boolean
  dynamicWatermarkOpacity: number
  dynamicWatermarkSize: number
  scoutDashboardAutoImportDir: string
  watermarkBox: WatermarkBox
}

export interface CmsState {
  logs: string[]
  tasks: Task[]
  uploadTasks: UploadTask[]
  csvContent: string
  dataWorkshopFolderPath: string
  workshopImport: WorkshopImport
  uploadFiles: string[]
  workspacePath: string
  activeModule: ActiveModuleKey
  config: CmsConfig
  preferences: CmsPreferences
  selectedKeywordId: string | null
  selectedProductId: string | null
  selectedPublishTaskIds: string[]
  selectedPendingTaskIds: string[]
  addLog: (msg: string) => void
  clearLogs: () => void
  setTasks: (tasks: Task[]) => void
  setUploadTasks: (tasks: UploadTask[]) => void
  setCsvContent: (content: string) => void
  setDataWorkshopFolderPath: (path: string) => void
  setWorkshopImport: (
    type: WorkshopImport['type'],
    path: string | null,
    coverPath?: string | null,
    paths?: string[] | null
  ) => void
  addFiles: (paths: string[]) => void
  addFilesToUpload: (paths: string[]) => void
  setWorkspacePath: (path: string) => void
  setActiveModule: (next: ActiveModuleKey) => void
  setSelectedKeywordId: (id: string | null) => void
  setSelectedProductId: (id: string | null) => void
  setSelectedPublishTaskIds: (ids: string[]) => void
  clearSelectedPublishTaskIds: () => void
  setSelectedPendingTaskIds: (ids: string[]) => void
  clearSelectedPendingTaskIds: () => void
  deleteTasks: (ids: string[]) => Promise<string[]>
  updateTaskStatus: (id: string, status: TaskStatus) => void
  updateTask: (taskId: string, payload: Partial<Task>) => void
  resetTaskStatus: () => void
  resetAll: () => void
  updateConfig: (newConfig: Partial<CmsConfig>) => void
  updatePreferences: (patch: Partial<CmsPreferences>) => void
  batchScheduleTasks: (
    updates: Array<{ id: string; scheduledAt: number; status?: CmsPublishTaskStatus }>
  ) => Promise<CmsPublishTask[]>
}

const initialConfig: CmsConfig = {
  appId: '',
  appSecret: '',
  baseToken: '',
  tableId: '',
  titleField: '标题',
  bodyField: '正文',
  imageField: '图片',
  importStrategy: 'copy',
  realEsrganPath: '',
  pythonPath: '',
  watermarkScriptPath: '',
  dynamicWatermarkEnabled: false,
  dynamicWatermarkOpacity: 15,
  dynamicWatermarkSize: 5,
  scoutDashboardAutoImportDir: '',
  watermarkBox: { x: 0.905, y: 0.927, width: 0.055, height: 0.05 }
}

const initialPreferences: CmsPreferences = {
  defaultStartTime: '10:00',
  defaultInterval: 30
}

const useCmsStore = create<CmsState>((set) => ({
  logs: ['> Super CMS 系统就绪...'],
  tasks: [],
  uploadTasks: [],
  csvContent: '',
  dataWorkshopFolderPath: '',
  workshopImport: { type: null, path: null, source: null },
  uploadFiles: [],
  workspacePath: '',
  activeModule: 'material',
  config: initialConfig,
  preferences: initialPreferences,
  selectedKeywordId: null,
  selectedProductId: null,
  selectedPublishTaskIds: [],
  selectedPendingTaskIds: [],
  addLog: (msg) => set((state) => ({ logs: [...state.logs, msg] })),
  clearLogs: () => set(() => ({ logs: [] })),
  setTasks: (tasks) => set(() => ({ tasks })),
  setUploadTasks: (tasks) => set(() => ({ uploadTasks: tasks })),
  setCsvContent: (content) => set(() => ({ csvContent: content })),
  setDataWorkshopFolderPath: (path) => set(() => ({ dataWorkshopFolderPath: path })),
  setWorkshopImport: (type, path, coverPath, paths) =>
    set(() => {
      const normalizedPath = typeof path === 'string' ? path.trim() : null
      const normalizedCoverPath = typeof coverPath === 'string' ? coverPath.trim() : ''
      const normalizedPaths = Array.from(
        new Set(
          (Array.isArray(paths) ? paths : [])
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
        )
      )
      if (!type) return { workshopImport: { type: null, path: null, source: null } }
      if (!normalizedPath) return { workshopImport: { type: null, path: null, source: null } }

      const finalPaths =
        type === 'video'
          ? normalizedPaths.length > 0
            ? normalizedPaths
            : [normalizedPath]
          : []
      return {
        workshopImport: {
          type,
          path: normalizedPath,
          source: 'imagelab',
          ...(finalPaths.length > 0 ? { paths: finalPaths } : {}),
          ...(normalizedCoverPath ? { coverPath: normalizedCoverPath } : {})
        }
      }
    }),
  addFiles: (paths) =>
    set((state) => {
      const normalized = (paths ?? []).map((p) => String(p ?? '').trim()).filter(Boolean)
      if (normalized.length === 0) return {}
      const setFiles = new Set(state.uploadFiles)
      for (const p of normalized) setFiles.add(p)
      return { uploadFiles: Array.from(setFiles) }
    }),
  addFilesToUpload: (paths) =>
    set((state) => {
      const normalized = (paths ?? []).map((p) => String(p ?? '').trim()).filter(Boolean)
      if (normalized.length === 0) return {}
      const setFiles = new Set(state.uploadFiles)
      for (const p of normalized) setFiles.add(p)
      return { uploadFiles: Array.from(setFiles) }
    }),
  setWorkspacePath: (path) => set(() => ({ workspacePath: String(path ?? '').trim() })),
  setActiveModule: (next) => set(() => ({ activeModule: next })),
  setSelectedKeywordId: (id) =>
    set(() => ({
      selectedKeywordId: id == null ? null : String(id).trim() || null
    })),
  setSelectedProductId: (id) =>
    set(() => ({
      selectedProductId: id == null ? null : String(id).trim() || null
    })),
  setSelectedPublishTaskIds: (ids) =>
    set(() => ({
      selectedPublishTaskIds: Array.from(
        new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))
      )
    })),
  clearSelectedPublishTaskIds: () => set(() => ({ selectedPublishTaskIds: [] })),
  setSelectedPendingTaskIds: (ids) =>
    set(() => ({
      selectedPendingTaskIds: Array.from(
        new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))
      )
    })),
  clearSelectedPendingTaskIds: () => set(() => ({ selectedPendingTaskIds: [] })),
  deleteTasks: async (ids) => {
    const normalized = Array.from(
      new Set((ids ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))
    )
    if (normalized.length === 0) return []
    const result = await window.api.cms.task.deleteBatch(normalized)
    const deletedIds = Array.isArray(result?.deletedIds) ? result.deletedIds : []
    window.dispatchEvent(new CustomEvent('cms.publishTasks.deleted', { detail: { deletedIds } }))
    set(() => ({ selectedPublishTaskIds: [], selectedPendingTaskIds: [] }))
    return deletedIds
  },
  updateTaskStatus: (id, status) =>
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, status } : task))
    })),
  updateTask: (taskId, payload) =>
    set((state) => {
      const index = state.tasks.findIndex((task) => task.id === taskId)
      if (index < 0) return {}

      const { id: ignoredId, ...patch } = payload as Partial<Task>
      void ignoredId
      const nextTasks = state.tasks.slice()
      nextTasks[index] = { ...nextTasks[index], ...patch }

      const shouldSyncUploadTasks =
        Object.prototype.hasOwnProperty.call(patch, 'title') ||
        Object.prototype.hasOwnProperty.call(patch, 'body') ||
        Object.prototype.hasOwnProperty.call(patch, 'assignedImages')

      if (!shouldSyncUploadTasks) return { tasks: nextTasks }

      if (!state.uploadTasks[index]) return { tasks: nextTasks }

      const nextUploadTasks = state.uploadTasks.slice()
      nextUploadTasks[index] = {
        ...nextUploadTasks[index],
        title: nextTasks[index].title,
        body: nextTasks[index].body,
        images: nextTasks[index].assignedImages
      }

      return { tasks: nextTasks, uploadTasks: nextUploadTasks }
    }),
  resetTaskStatus: () =>
    set((state) => ({
      tasks: state.tasks.map((task) => ({ ...task, status: 'idle', log: '' }))
    })),
  resetAll: () =>
    set(() => ({
      logs: [],
      tasks: [],
      uploadTasks: [],
      csvContent: '',
      dataWorkshopFolderPath: '',
      workshopImport: { type: null, path: null, source: null },
      uploadFiles: [],
      selectedKeywordId: null,
      selectedProductId: null,
      selectedPublishTaskIds: [],
      selectedPendingTaskIds: []
    })),
  updateConfig: (newConfig) =>
    set((state) => ({
      config: { ...state.config, ...newConfig }
    })),
  updatePreferences: (patch) =>
    set((state) => ({
      preferences: { ...state.preferences, ...patch }
    })),
  batchScheduleTasks: async (updates) => {
    const patches = (updates ?? []).map(({ id, ...rest }) => ({
      id,
      updates: rest
    }))
    if (patches.length === 0) return []
    return window.api.cms.task.updateBatch(patches)
  }
}))

export { useCmsStore }
