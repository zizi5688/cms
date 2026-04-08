import { create } from 'zustand'
import {
  createEmptyAiRuntimeDefaults,
  type AiProviderProfile,
  type AiRuntimeDefaults
} from '../../../shared/ai/aiProviderTypes'
import type { LocalGatewayConfig } from '../../../shared/localGatewayTypes'
import { DEFAULT_ACTIVE_MODULE } from '../components/layout/navigationDefaults'

export type TaskStatus = 'idle' | 'uploading' | 'success' | 'error'
export type ActiveModuleKey =
  | 'aiStudio'
  | 'workshop'
  | 'upload'
  | 'material'
  | 'autopublish'
  | 'raceboard'
  | 'heatboard'
  | 'settings'
export type ModuleId = ActiveModuleKey

export type WorkshopImport = {
  type: 'image' | 'video' | null
  path: string | null
  paths?: string[]
  coverPath?: string
  source: 'imagelab' | 'ai-studio' | 'ai-studio-note' | null
}

export type MaterialImport = {
  paths: string[]
  source: 'aiStudio' | null
  target: 'image' | 'video' | null
}

export interface CmsLinkedProductRecord {
  id: string
  name: string
  cover: string
  productUrl: string
}

export interface Task {
  id: string
  title: string
  body: string
  assignedImages: string[]
  accountId?: string
  productId?: string
  productName?: string
  linkedProducts?: CmsLinkedProductRecord[]
  mediaType?: 'image' | 'video'
  videoPath?: string
  videoPreviewPath?: string
  videoCoverMode?: 'auto' | 'manual'
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

export type DynamicWatermarkTrajectory = 'smoothSine' | 'figureEight' | 'diagonalWrap' | 'largeEllipse' | 'pseudoRandom'

export type { AiCapability, AiCapabilityProfile, AiModelProfile, AiProviderProfile } from '../../../shared/ai/aiProviderTypes'

export interface CmsConfig {
  appId: string
  appSecret: string
  baseToken: string
  tableId: string
  aiProvider: string
  aiBaseUrl: string
  aiApiKey: string
  aiDefaultImageModel: string
  aiEndpointPath: string
  aiProviderProfiles: AiProviderProfile[]
  aiRuntimeDefaults: AiRuntimeDefaults
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
  dynamicWatermarkTrajectory: DynamicWatermarkTrajectory
  storageMaintenanceEnabled: boolean
  storageMaintenanceStartTime: string
  storageMaintenanceRetainDays: number
  storageArchivePath: string
  scoutDashboardAutoImportDir: string
  watermarkBox: WatermarkBox
  localGateway: LocalGatewayConfig
}

export interface CmsState {
  logs: string[]
  tasks: Task[]
  uploadTasks: UploadTask[]
  csvContent: string
  dataWorkshopFolderPath: string
  workshopImport: WorkshopImport
  materialImport: MaterialImport
  uploadFiles: string[]
  workspacePath: string
  activeModule: ActiveModuleKey
  preferredAccountId: string | null
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
    paths?: string[] | null,
    source?: WorkshopImport['source']
  ) => void
  setMaterialImport: (
    paths: string[] | null,
    source?: MaterialImport['source'],
    target?: MaterialImport['target']
  ) => void
  clearMaterialImport: () => void
  addFiles: (paths: string[]) => void
  addFilesToUpload: (paths: string[]) => void
  setWorkspacePath: (path: string) => void
  setActiveModule: (next: ActiveModuleKey) => void
  setPreferredAccountId: (id: string | null) => void
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
  aiProvider: 'grsai',
  aiBaseUrl: '',
  aiApiKey: '',
  aiDefaultImageModel: '',
  aiEndpointPath: '',
  aiProviderProfiles: [],
  aiRuntimeDefaults: createEmptyAiRuntimeDefaults(),
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
  dynamicWatermarkTrajectory: 'pseudoRandom',
  storageMaintenanceEnabled: false,
  storageMaintenanceStartTime: '02:30',
  storageMaintenanceRetainDays: 7,
  storageArchivePath: '',
  scoutDashboardAutoImportDir: '',
  watermarkBox: { x: 0.905, y: 0.927, width: 0.055, height: 0.05 },
  localGateway: {
    enabled: false,
    bundlePath: '/Users/z/Ai 工具/Local AI Gateway',
    autoStartOnAppLaunch: true,
    startAdminUi: true,
    startCdpProxy: true,
    allowDedicatedChrome: false,
    chromeProfileDirectory: '',
    prewarmImageOnLaunch: false
  }
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
  materialImport: { paths: [], source: null, target: null },
  uploadFiles: [],
  workspacePath: '',
  activeModule: DEFAULT_ACTIVE_MODULE,
  preferredAccountId: null,
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
  setWorkshopImport: (type, path, coverPath, paths, source = 'imagelab') =>
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

      const finalPath = normalizedPath || normalizedPaths[0] || null
      if (!finalPath) return { workshopImport: { type: null, path: null, source: null } }

      const shouldAttachPaths = type === 'video' || normalizedPaths.length > 0
      const finalPaths =
        shouldAttachPaths
          ? normalizedPaths.length > 0
            ? normalizedPaths
            : [finalPath]
          : []
      return {
        workshopImport: {
          type,
          path: finalPath,
          source: source ?? 'imagelab',
          ...(finalPaths.length > 0 ? { paths: finalPaths } : {}),
          ...(type === 'video' && normalizedCoverPath ? { coverPath: normalizedCoverPath } : {})
        }
      }
    }),
  setMaterialImport: (paths, source = 'aiStudio', target = 'image') =>
    set(() => {
      const normalizedPaths = Array.from(
        new Set(
          (Array.isArray(paths) ? paths : [])
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
        )
      )
      if (normalizedPaths.length === 0 || !source || !target) {
        return { materialImport: { paths: [], source: null, target: null } }
      }
      return { materialImport: { paths: normalizedPaths, source, target } }
    }),
  clearMaterialImport: () => set(() => ({ materialImport: { paths: [], source: null, target: null } })),
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
  setPreferredAccountId: (id) =>
    set(() => ({
      preferredAccountId: id == null ? null : String(id).trim() || null
    })),
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
      materialImport: { paths: [], source: null, target: null },
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
