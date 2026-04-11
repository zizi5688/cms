import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI as toolkitElectronAPI } from '@electron-toolkit/preload'
import type { AiCapability, AiProviderProfile, AiRuntimeDefaults } from '../shared/ai/aiProviderTypes.ts'
import type {
  CmsChromeLoginVerificationResult,
  CmsChromeProfileRecord,
  CmsPublishMode,
  CmsPublishSafetyCheck
} from '../shared/cmsChromeProfileTypes'
import type {
  LocalGatewayChromeProfile,
  LocalGatewayConfig,
  LocalGatewayInitializationResult,
  LocalGatewayState
} from '../shared/localGatewayTypes.ts'

type PublisherResult = { success: boolean; time?: string; error?: string; safetyCheck?: CmsPublishSafetyCheck }

type CmsPublishTaskStatus =
  | 'pending'
  | 'processing'
  | 'failed'
  | 'publish_failed'
  | 'scheduled'
  | 'published'

type CmsPublishTask = {
  id: string
  accountId: string
  status: CmsPublishTaskStatus
  mediaType: 'image' | 'video'
  videoPath?: string
  videoPreviewPath?: string
  videoCoverMode?: 'auto' | 'manual'
  images: string[]
  title: string
  content: string
  tags?: string[]
  productId?: string
  productName?: string
  linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
  publishMode: 'immediate'
  transformPolicy?: 'none' | 'remix_v1'
  remixSessionId?: string
  remixSourceTaskIds?: string[]
  remixSeed?: string
  isRaw?: boolean
  scheduledAt?: number
  publishedAt: string | null
  safetyCheck?: CmsPublishSafetyCheck
  errorMsg: string
  errorMessage?: string
  createdAt: number
}

type CmsCreateBatchProgress = {
  phase?: 'start' | 'progress' | 'done'
  processed?: number
  total?: number
  created?: number
  message?: string
  requestId?: string
}

type CmsPublishSessionStepState = 'pending' | 'active' | 'done' | 'error'

type CmsPublishSessionStepKey = 'prepare' | 'upload' | 'cover' | 'content' | 'publish'

type CmsPublishSessionStep = {
  key: CmsPublishSessionStepKey
  label: string
  state: CmsPublishSessionStepState
}

type CmsPublishSessionSnapshot = {
  sessionId: string
  queueTaskId?: string
  accountId: string
  accountName: string
  taskTitle: string
  mediaType: 'image' | 'video'
  status: 'running' | 'succeeded' | 'failed'
  steps: CmsPublishSessionStep[]
  message: string
  error?: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
}

type SyncDouyinHotMusicResult = {
  success: boolean
  outputDir: string
  manifestPath: string
  total: number
  downloaded: number
  skipped: number
  failed: number
  downloadedFiles: string[]
  errors: string[]
  updatedAt: string
  error?: string
}

type ListDouyinHotMusicResult = {
  success: boolean
  outputDir: string
  files: string[]
  error?: string
}

type ComposeVideoProgressPayload = {
  percent?: number
  batchIndex?: number
  batchTotal?: number
  message?: string
}

type ComposeVideoBatchFromImagesResult = {
  success: boolean
  successCount: number
  failedCount: number
  sourceImageCount: number
  sourceVideoCount: number
  sourceMediaCount: number
  outputs: string[]
  failures: Array<{ index: number; error: string; details?: string }>
  debugLogPath?: string
}

type AppReleaseMeta = {
  majorVersion: number
  updatedAt: string
}

type AppUpdatePhase =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

type AppUpdateState = {
  enabled: boolean
  phase: AppUpdatePhase
  message: string
  platform: NodeJS.Platform
  currentVersion: string
  latestVersion: string | null
  checkedAt: number | null
  downloadedAt: number | null
  percent: number | null
}

type InstallUpdateResult = {
  accepted: boolean
  reason?: string
  state: AppUpdateState
}

type StorageMaintenanceState = {
  enabled: boolean
  running: boolean
  locked: boolean
  lockReason: string | null
  nextRunAt: number | null
  lastRunAt: number | null
  lastRunId: string | null
}

type StorageMaintenanceSummary = {
  runId: string
  mode: 'scheduled' | 'manual'
  startedAt: number
  finishedAt: number
  durationMs: number
  results: {
    orphanAssetsDeleted: number
    orphanAssetsDeletedBytes: number
    orphanPartitionsDeleted: number
    orphanPartitionsDeletedBytes: number
    tempFilesDeleted: number
    tempFilesDeletedBytes: number
    migratedVideos: number
    migratedVideoBytes: number
    skippedMigrations: number
  }
  notes: string[]
  manifestPath: string
}

type NoteRaceSignalTone = 'positive' | 'negative' | 'neutral'
type NoteRaceTag = '起飞' | '维稳' | '掉速' | '长尾复活' | '风险'

type NoteRaceSignal = {
  label: string
  tone: NoteRaceSignalTone
}

type NoteRaceContentCoverage = 'matched' | 'out_of_scope' | 'missing' | 'no_content_snapshot'

type NoteRaceImportResult = {
  snapshotDate: string
  sourceFile: string
  importedRows: number
  matchedRows?: number
  totalRows?: number
  kind?: 'commerce' | 'content'
  detectedBy?: 'header' | 'filename'
}

type NoteRaceAutoImportBatchResult = {
  selectedFiles: number
  importedFiles: number
  importedCommerceFiles: number
  importedContentFiles: number
  failedFiles: number
  importedItems: Array<
    NoteRaceImportResult & {
      filePath: string
      fileName: string
      kind: 'commerce' | 'content'
      detectedBy: 'header' | 'filename'
    }
  >
  failures: Array<{ filePath: string; fileName: string; message: string }>
}

type NoteRaceScanFolderResult = {
  dirPath: string
  scannedFiles: number
  importedFiles: number
  importedCommerceFiles: number
  importedContentFiles: number
  skippedOldFiles: number
  skippedUnsupportedFiles: number
  failedFiles: number
  latestMtimeMs: number
  importedItems: Array<{ fileName: string; kind: 'commerce' | 'content' }>
  failures: Array<{ fileName: string; message: string }>
}

type NoteRaceMeta = {
  latestDate: string | null
  availableDates: string[]
  totalNotes: number
  matchedNotes: number
  matchRate: number
  scopeDescription: string
  trendReadyDates: string[]
}

type NoteRaceDeleteSnapshotResult = {
  snapshotDate: string
  deletedCommerceRows: number
  deletedContentRows: number
  deletedMatchRows: number
  deletedRankRows: number
  recomputedSnapshots: number
}

type NoteRaceSnapshotStat = {
  snapshotDate: string
  commerceRows: number
  contentRows: number
  rankRows: number
  matchedRows: number
  scopedRows: number
  scopedMatchedRows: number
  latestImportedAt: number | null
}

type NoteRaceSnapshotBatchStat = {
  snapshotDate: string
  importedAt: number
  commerceRows: number
  contentRows: number
  sourceFiles: string[]
  status: 'active' | 'deleted'
  deletedAt: number | null
  restorableUntil: number | null
  restorable: boolean
}

type NoteRaceDeleteBatchResult = {
  snapshotDate: string
  importedAt: number
  deletedCommerceRows: number
  deletedContentRows: number
  recomputedSnapshots: number
}

type NoteRaceRestoreBatchResult = {
  snapshotDate: string
  importedAt: number
  restoredCommerceRows: number
  restoredContentRows: number
  recomputedSnapshots: number
}

type NoteRaceResetResult = {
  deletedCommerceRows: number
  deletedContentRows: number
  deletedDeletedCommerceRows: number
  deletedDeletedContentRows: number
  deletedMatchRows: number
  deletedRankRows: number
}

type NoteRaceListRow = {
  id: string
  rank: number
  tag: NoteRaceTag
  account: string
  title: string
  ageDays: number
  score: number
  totalRead: number
  dRead: number
  dClick: number
  dOrder: number
  contentScore: number
  commerceScore: number
  trendScore: number
  refundPenalty: number
  trendDelta: number
  trendHint: string[]
  contentSignals: NoteRaceSignal[]
  commerceSignals: NoteRaceSignal[]
  stageLabel: string
  stageIndex: 1 | 2 | 3 | 4 | 5
  noteType: '图文' | '视频'
  productName: string
  contentCoverage: NoteRaceContentCoverage
}

type NoteRaceDetail = {
  row: NoteRaceListRow
  noteId: string | null
  productId: string | null
  createdAt: number | null
  matchConfidence: number
  matchRule: string
  contentFunnel: Array<{
    label: string
    value: number
    conversionLabel?: string
    conversionValue?: number
  }>
  commerceFunnel: Array<{
    label: string
    value: number
    conversionLabel?: string
    conversionValue?: number
  }>
  sparkline: number[]
  deltas: {
    read: number
    click: number
    order: number
    acceleration: number
    stability: '高' | '中' | '低'
  }
  cumulative: {
    startDate: string
    endDate: string
    spanDays: number
    activeDays: number
    coverageRate: number
    totalRead: number
    totalClick: number
    totalOrders: number
    totalAmount: number
    clickRate: number
    payRate: number
  }
}

type AiStudioImportedFolder = {
  folderPath: string
  productName: string
  imageFilePaths: string[]
}

type AiStudioTemplateRecord = {
  id: string
  provider: string
  capability: 'image' | 'video' | 'chat'
  name: string
  promptText: string
  config: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type AiStudioTaskRecord = {
  id: string
  templateId: string | null
  provider: string
  sourceFolderPath: string | null
  productName: string
  status: 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'archived'
  aspectRatio: string
  outputCount: number
  model: string
  promptExtra: string
  primaryImagePath: string | null
  referenceImagePaths: string[]
  inputImagePaths: string[]
  remoteTaskId: string | null
  latestRunId: string | null
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
  billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type AiStudioAssetRecord = {
  id: string
  taskId: string
  runId: string | null
  kind: 'input' | 'output'
  role: string
  filePath: string
  previewPath: string | null
  originPath: string | null
  selected: boolean
  sortOrder: number
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

type AiStudioRunRecord = {
  id: string
  taskId: string
  runIndex: number
  provider: string
  status: string
  remoteTaskId: string | null
  billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
  priceMinSnapshot: number | null
  priceMaxSnapshot: number | null
  runDir: string | null
  requestPayload: Record<string, unknown>
  responsePayload: Record<string, unknown>
  errorMessage: string | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

// 渲染进程自定义 API（后续通过 IPC 扩展）
const api = {
  cms: {
    system: {
      onLog: (
        listener: (
          payload: { type?: string; message?: string; timestamp?: number } | string
        ) => void
      ): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
          if (typeof payload === 'string') {
            listener(payload)
            return
          }
          if (payload && typeof payload === 'object') {
            const record = payload as Record<string, unknown>
            const type = typeof record.type === 'string' ? record.type : undefined
            const message = typeof record.message === 'string' ? record.message : undefined
            const timestamp = typeof record.timestamp === 'number' ? record.timestamp : undefined
            listener({ type, message, timestamp })
          }
        }
        ipcRenderer.on('system-log', handler)
        return () => {
          ipcRenderer.off('system-log', handler)
        }
      },
      openExternal: (url: string): Promise<boolean> =>
        ipcRenderer.invoke('cms.system.openExternal', { url })
    },
    image: {
      saveBase64: (payload: { dataUrl: string; filename: string }): Promise<string> =>
        ipcRenderer.invoke('cms.image.saveBase64', payload)
    },
    queue: {
      start: (
        payload: string | { accountId: string; taskIds?: string[] }
      ): Promise<{ processed: number; succeeded: number; failed: number }> =>
        ipcRenderer.invoke('cms.queue.start', payload)
    },
    account: {
      list: (): Promise<
        Array<{
          id: string
          name: string
          partitionKey: string
          status: 'logged_in' | 'expired' | 'offline'
          lastLoginTime: number | null
          cmsProfileId: string | null
        }>
      > => ipcRenderer.invoke('GET /accounts'),
      create: (
        name: string
      ): Promise<{
        id: string
        name: string
        partitionKey: string
        status: 'logged_in' | 'expired' | 'offline'
        lastLoginTime: number | null
        cmsProfileId: string | null
      }> => ipcRenderer.invoke('POST /accounts', { name }),
      login: (accountId: string): Promise<{ windowId: number }> =>
        ipcRenderer.invoke('POST /login-window', { accountId }),
      listCmsProfiles: (): Promise<CmsChromeProfileRecord[]> =>
        ipcRenderer.invoke('cms.account.listCmsProfiles'),
      bindCmsProfile: (
        accountId: string,
        cmsProfileId: string | null
      ): Promise<{
        id: string
        name: string
        partitionKey: string
        status: 'logged_in' | 'expired' | 'offline'
        lastLoginTime: number | null
        cmsProfileId: string | null
      }> => ipcRenderer.invoke('cms.account.bindCmsProfile', { accountId, cmsProfileId }),
      openCmsProfileLogin: (
        accountId: string,
        profileId?: string
      ): Promise<{ profileId: string }> =>
        ipcRenderer.invoke('cms.account.openCmsProfileLogin', { accountId, profileId }),
      verifyCmsProfileLogin: (
        accountId: string,
        profileId?: string
      ): Promise<CmsChromeLoginVerificationResult> =>
        ipcRenderer.invoke('cms.account.verifyCmsProfileLogin', { accountId, profileId }),
      checkStatus: (accountId: string): Promise<boolean> =>
        ipcRenderer.invoke('cms.account.checkStatus', { accountId }),
      rename: (
        accountId: string,
        name: string
      ): Promise<{
        id: string
        name: string
        partitionKey: string
        status: 'logged_in' | 'expired' | 'offline'
        lastLoginTime: number | null
        cmsProfileId: string | null
      }> => ipcRenderer.invoke('cms.account.rename', { accountId, name }),
      delete: (accountId: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('cms.account.delete', { accountId })
    },
    product: {
      list: (payload?: {
        accountId?: string
      }): Promise<
        Array<{
          id: string
          name: string
          price: string
          cover: string
          productUrl: string
          accountId: string
        }>
      > => ipcRenderer.invoke('cms.product.list', payload),
      save: (
        products: Array<{
          id: string
          name: string
          price: string
          cover: string
          productUrl: string
          accountId?: string
        }>
      ): Promise<
        Array<{
          id: string
          name: string
          price: string
          cover: string
          productUrl: string
          accountId: string
        }>
      > => ipcRenderer.invoke('cms.product.save', products),
      sync: (
        accountId: string
      ): Promise<
        Array<{
          id: string
          name: string
          price: string
          cover: string
          productUrl: string
          accountId: string
        }>
      > => ipcRenderer.invoke('cms.product.sync', { accountId })
    },
    publisher: {
      publish: (
        accountId: string,
        taskData: {
          title?: string
          content?: string
          mediaType?: 'image' | 'video'
          videoPath?: string
          videoCoverMode?: 'auto' | 'manual'
          images?: string[]
          imagePath?: string
          productId?: string
          productName?: string
          linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
          dryRun?: boolean
          mode?: 'immediate'
        }
      ): Promise<PublisherResult> =>
        ipcRenderer.invoke('publisher.publish', { accountId, taskData }),
      onAutomationLog: (listener: (message: string) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
          if (typeof payload === 'string') {
            listener(payload)
            return
          }
          if (payload && typeof payload === 'object') {
            const record = payload as Record<string, unknown>
            const message = typeof record.message === 'string' ? record.message : ''
            if (message) listener(message)
          }
        }
        ipcRenderer.on('automation-log', handler)
        return () => {
          ipcRenderer.off('automation-log', handler)
        }
      },
      onPublishProgress: (
        listener: (payload: { accountId?: string; message?: string; progress?: number }) => void
      ): (() => void) => {
        const handler = (
          _event: Electron.IpcRendererEvent,
          payload: { accountId?: string; message?: string; progress?: number }
        ): void => {
          listener(payload)
        }
        ipcRenderer.on('publisher:progress', handler)
        return () => {
          ipcRenderer.off('publisher:progress', handler)
        }
      },
      onSession: (listener: (payload: CmsPublishSessionSnapshot) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
          if (!payload || typeof payload !== 'object') return
          listener(payload as CmsPublishSessionSnapshot)
        }
        ipcRenderer.on('publisher:session', handler)
        return () => {
          ipcRenderer.off('publisher:session', handler)
        }
      }
    },
    task: {
      createBatch: (
        tasks: Array<{
          accountId: string
          images?: string[]
          imagePath?: string
          title: string
          content: string
          tags?: string[]
          productId?: string
          productName?: string
          linkedProducts?: Array<{ id: string; name: string; cover: string; productUrl: string }>
          publishMode?: 'immediate'
          mediaType?: 'image' | 'video'
          videoPath?: string
          videoPreviewPath?: string
          videoCoverMode?: 'auto' | 'manual'
          isRemix?: boolean
          videoClips?: string[]
          durationReferenceClips?: string[]
          targetDurationSec?: number
          bgmPath?: string
          remixTitleSourceTaskId?: string
          remixContentSourceTaskId?: string
          transformPolicy?: 'none' | 'remix_v1'
          remixSessionId?: string
          remixSourceTaskIds?: string[]
          remixSeed?: string
        }>,
        options?: { requestId?: string }
      ): Promise<CmsPublishTask[]> =>
        ipcRenderer.invoke(
          'cms.task.createBatch',
          options?.requestId ? { tasks, requestId: options.requestId } : tasks
        ),
      list: (accountId: string): Promise<CmsPublishTask[]> =>
        ipcRenderer.invoke('cms.task.list', accountId),
      updateBatch: (
        idsOrPatches: string[] | Array<{ id: string; updates: unknown }>,
        updates?: { publishMode?: 'immediate'; status?: unknown; scheduledAt?: unknown }
      ): Promise<CmsPublishTask[]> => {
        if (
          Array.isArray(idsOrPatches) &&
          idsOrPatches.length > 0 &&
          typeof idsOrPatches[0] === 'object' &&
          updates === undefined
        ) {
          return ipcRenderer.invoke('cms.task.updateBatch', { updates: idsOrPatches })
        }
        const ids = Array.isArray(idsOrPatches) ? (idsOrPatches as string[]) : []
        return ipcRenderer.invoke('cms.task.updateBatch', { ids, updates: updates ?? {} })
      },
      cancelSchedule: (taskIds: string[]): Promise<CmsPublishTask[]> =>
        ipcRenderer.invoke('cms.task.cancelSchedule', taskIds),
      deleteByRemixSession: (
        sessionId: string,
        accountId?: string
      ): Promise<{ deleted: number; deletedIds: string[] }> =>
        ipcRenderer.invoke('cms.task.deleteByRemixSession', { sessionId, accountId }),
      deleteBatch: (ids: string[]): Promise<{ deleted: number; deletedIds: string[] }> =>
        ipcRenderer.invoke('cms.task.deleteBatch', ids),
      delete: (taskId: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('cms.task.delete', taskId),
      importImages: (filePaths: string[]): Promise<string[]> =>
        ipcRenderer.invoke('cms.task.importImages', { filePaths }),
      updateStatus: (
        taskId: string,
        status: CmsPublishTaskStatus
      ): Promise<CmsPublishTask | null> =>
        ipcRenderer.invoke('cms.task.updateStatus', { taskId, status }),
      onUpdated: (listener: (task: CmsPublishTask) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, task: unknown): void => {
          if (!task || typeof task !== 'object') return
          listener(task as CmsPublishTask)
        }
        ipcRenderer.on('cms.task.updated', handler)
        return () => {
          ipcRenderer.off('cms.task.updated', handler)
        }
      },
      onCreateBatchProgress: (
        listener: (payload: CmsCreateBatchProgress) => void
      ): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
          if (!payload || typeof payload !== 'object') return
          listener(payload as CmsCreateBatchProgress)
        }
        ipcRenderer.on('cms.task.createBatch.progress', handler)
        return () => {
          ipcRenderer.off('cms.task.createBatch.progress', handler)
        }
      }
    },
    scout: {
      keyword: {
        list: (): Promise<unknown[]> => ipcRenderer.invoke('cms.scout.keyword.list'),
        add: (keyword: string, sortMode?: string): Promise<unknown> =>
          ipcRenderer.invoke('cms.scout.keyword.add', { keyword, sortMode }),
        remove: (id: string): Promise<void> =>
          ipcRenderer.invoke('cms.scout.keyword.remove', { id }),
        toggle: (id: string, isActive: boolean): Promise<void> =>
          ipcRenderer.invoke('cms.scout.keyword.toggle', { id, isActive })
      },
      product: {
        list: (payload: {
          keywordId: string
          sortBy?: string
          sortOrder?: string
          limit?: number
          offset?: number
        }): Promise<unknown[]> => ipcRenderer.invoke('cms.scout.product.list', payload)
      },
      sync: {
        importFile: (): Promise<{ keywordsUpdated: number; productsUpserted: number } | null> =>
          ipcRenderer.invoke('cms.scout.sync.importFile'),
        importData: (
          data: unknown
        ): Promise<{ keywordsUpdated: number; productsUpserted: number }> =>
          ipcRenderer.invoke('cms.scout.sync.importData', data),
        history: (): Promise<unknown[]> => ipcRenderer.invoke('cms.scout.sync.history')
      },
      export: {
        excel: (payload: { keywordId?: string }): Promise<string | null> =>
          ipcRenderer.invoke('cms.scout.export.excel', payload)
      },
      dashboard: {
        importExcelFile: (): Promise<{
          snapshotDates: string[]
          rowsUpserted: number
          productsMapped: number
          keywordsCount: number
          sourceFile: string
        } | null> => ipcRenderer.invoke('cms.scout.dashboard.importExcelFile'),
        autoImportScanNow: (): Promise<{
          mode: 'auto' | 'manual'
          watchDir: string
          scannedFiles: number
          processedFiles: number
          importedFiles: number
          failedFiles: number
          skippedBaselineFiles: number
          skippedProcessedFiles: number
          skippedRetryFiles: number
          busy: boolean
          failures: Array<{ sourceFile: string; message: string }>
        } | null> => ipcRenderer.invoke('cms.scout.dashboard.autoImportScanNow'),
        onAutoImportScanProgress: (
          listener: (payload: {
            mode: 'auto' | 'manual'
            phase: 'start' | 'progress' | 'done' | 'error'
            watchDir: string
            scannedFiles: number
            processedFiles: number
            importedFiles: number
            failedFiles: number
            skippedBaselineFiles: number
            skippedProcessedFiles: number
            skippedRetryFiles: number
            currentFile: string | null
            message?: string
          }) => void
        ): (() => void) => {
          const handler = (_event: unknown, payload: unknown): void => {
            listener(
              (payload ?? {
                mode: 'manual',
                phase: 'start',
                watchDir: '',
                scannedFiles: 0,
                processedFiles: 0,
                importedFiles: 0,
                failedFiles: 0,
                skippedBaselineFiles: 0,
                skippedProcessedFiles: 0,
                skippedRetryFiles: 0,
                currentFile: null
              }) as {
                mode: 'auto' | 'manual'
                phase: 'start' | 'progress' | 'done' | 'error'
                watchDir: string
                scannedFiles: number
                processedFiles: number
                importedFiles: number
                failedFiles: number
                skippedBaselineFiles: number
                skippedProcessedFiles: number
                skippedRetryFiles: number
                currentFile: string | null
                message?: string
              }
            )
          }
          ipcRenderer.on('cms.scout.dashboard.autoImportScanProgress', handler)
          return () => {
            ipcRenderer.off('cms.scout.dashboard.autoImportScanProgress', handler)
          }
        },
        deleteSnapshot: (payload: {
          snapshotDate: string
        }): Promise<{
          snapshotDate: string
          deletedSnapshotRows: number
          deletedWatchlistRows: number
          deletedProductMapRows: number
          deletedCoverCacheRows: number
        }> => ipcRenderer.invoke('cms.scout.dashboard.deleteSnapshot', payload),
        deleteKeywordSnapshot: (payload: {
          snapshotDate: string
          keyword: string
        }): Promise<{
          snapshotDate: string
          keyword: string
          deletedSnapshotRows: number
          deletedWatchlistRows: number
          deletedProductMapRows: number
          deletedCoverCacheRows: number
        }> => ipcRenderer.invoke('cms.scout.dashboard.deleteKeywordSnapshot', payload),
        coverDebugState: (): Promise<{
          visual: boolean
          keepWindowOpen: boolean
          openDevTools: boolean
          logPath: string
        }> => ipcRenderer.invoke('cms.scout.dashboard.coverDebugState'),
        setCoverDebugState: (payload: {
          visual?: boolean
          keepWindowOpen?: boolean
          openDevTools?: boolean
        }): Promise<{
          visual: boolean
          keepWindowOpen: boolean
          openDevTools: boolean
          logPath: string
        }> => ipcRenderer.invoke('cms.scout.dashboard.setCoverDebugState', payload),
        coverDebugLog: (payload?: {
          limit?: number
        }): Promise<{ logPath: string; lines: string[] }> =>
          ipcRenderer.invoke('cms.scout.dashboard.coverDebugLog', payload),
        meta: (): Promise<{
          latestDate: string | null
          availableDates: string[]
          totalKeywords: number
          totalProducts: number
          lastImportAt: number | null
        }> => ipcRenderer.invoke('cms.scout.dashboard.meta'),
        keywordHeat: (payload?: {
          snapshotDate?: string
          keyword?: string
          onlyAlerts?: boolean
          limit?: number
        }): Promise<unknown[]> => ipcRenderer.invoke('cms.scout.dashboard.keywordHeat', payload),
        potentialProducts: (payload?: {
          snapshotDate?: string
          keyword?: string
          onlyNew?: boolean
          limit?: number
          sortBy?:
            | 'potentialScore'
            | 'addCart24hValue'
            | 'deltaAddCart24h'
            | 'shopFans'
            | 'lastUpdatedAt'
          sortOrder?: 'ASC' | 'DESC'
        }): Promise<unknown[]> =>
          ipcRenderer.invoke('cms.scout.dashboard.potentialProducts', payload),
        trends: (payload?: {
          snapshotDate?: string
          keyword?: string
          days?: number
          limit?: number
        }): Promise<{
          dates: string[]
          series: Array<{
            keyword: string
            values: number[]
            max: number
            min: number
            volatility: number
          }>
        }> => ipcRenderer.invoke('cms.scout.dashboard.trends', payload),
        productDetail: (payload: {
          snapshotDate: string
          productKey: string
        }): Promise<{
          snapshotDate: string
          productKey: string
          keyword: string
          primaryKeyword: string
          sourceFile: string | null
          importedAt: number
          rawPayload: Record<string, unknown>
        } | null> => ipcRenderer.invoke('cms.scout.dashboard.productDetail', payload),
        markPotential: (payload: {
          snapshotDate: string
          products: Array<{
            productKey: string
            keyword: string
            productName: string
            productUrl?: string | null
            salePrice?: number | null
          }>
        }): Promise<{ upserted: number; skipped: number }> =>
          ipcRenderer.invoke('cms.scout.dashboard.markPotential', payload),
        markedProducts: (payload?: {
          snapshotDate?: string
          keyword?: string
        }): Promise<
          Array<{
            id: string
            snapshotDate: string
            productKey: string
            keyword: string
            productName: string
            productUrl: string | null
            salePrice: number | null
            sourceImage1: string | null
            sourceImage2: string | null
            supplier1Name: string | null
            supplier1Url: string | null
            supplier1Price: number | null
            supplier2Name: string | null
            supplier2Url: string | null
            supplier2Price: number | null
            supplier3Name: string | null
            supplier3Url: string | null
            supplier3Price: number | null
            profit1: number | null
            profit2: number | null
            profit3: number | null
            bestProfitAmount: number | null
            sourcingStatus: 'idle' | 'running' | 'success' | 'failed'
            sourcingMessage: string | null
            sourcingUpdatedAt: number | null
            createdAt: number
            updatedAt: number
          }>
        > => ipcRenderer.invoke('cms.scout.dashboard.markedProducts', payload),
        bindSupplier: (payload: {
          snapshotDate: string
          productKey: string
          supplierName?: string | null
          companyName?: string | null
          supplierUrl?: string | null
          supplierPrice?: number | null
          supplierNetProfit?: number | null
          supplierMoq?: string | null
          supplierFreightPrice?: number | null
          supplierServiceRateLabel?: string | null
          sourceImage1?: string | null
        }): Promise<{
          id: string
          snapshotDate: string
          productKey: string
          keyword: string
          productName: string
          productUrl: string | null
          salePrice: number | null
          sourceImage1: string | null
          sourceImage2: string | null
          supplier1Name: string | null
          supplier1Url: string | null
          supplier1Price: number | null
          supplier2Name: string | null
          supplier2Url: string | null
          supplier2Price: number | null
          supplier3Name: string | null
          supplier3Url: string | null
          supplier3Price: number | null
          profit1: number | null
          profit2: number | null
          profit3: number | null
          bestProfitAmount: number | null
          sourcingStatus: 'idle' | 'running' | 'success' | 'failed'
          sourcingMessage: string | null
          sourcingUpdatedAt: number | null
          createdAt: number
          updatedAt: number
        } | null> => ipcRenderer.invoke('cms.scout.dashboard.bindSupplier', payload),
        fetchXhsImage: (payload: { productId: string; xiaohongshuUrl: string }): void => {
          ipcRenderer.send('IPC_FETCH_XHS_IMAGE', payload)
        },
        onXhsImageUpdated: (
          listener: (payload: { productId: string; imageUrl: string }) => void
        ): (() => void) => {
          const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
            if (!payload || typeof payload !== 'object') return
            const row = payload as Record<string, unknown>
            const productId = typeof row.productId === 'string' ? row.productId : ''
            const imageUrl = typeof row.imageUrl === 'string' ? row.imageUrl : ''
            if (!productId || !imageUrl) return
            listener({ productId, imageUrl })
          }
          ipcRenderer.on('IPC_IMAGE_UPDATED', handler)
          return () => {
            ipcRenderer.off('IPC_IMAGE_UPDATED', handler)
          }
        },
        onXhsImageFetchFailed: (
          listener: (payload: { productId: string; reason: string; retryable: boolean }) => void
        ): (() => void) => {
          const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
            if (!payload || typeof payload !== 'object') return
            const row = payload as Record<string, unknown>
            const productId = typeof row.productId === 'string' ? row.productId : ''
            const reason = typeof row.reason === 'string' ? row.reason : ''
            const retryable = row.retryable === true
            if (!productId || !reason) return
            listener({ productId, reason, retryable })
          }
          ipcRenderer.on('IPC_IMAGE_FETCH_FAILED', handler)
          return () => {
            ipcRenderer.off('IPC_IMAGE_FETCH_FAILED', handler)
          }
        },
        search1688ByImage: (payload: {
          imageUrl: string
          targetPrice: number
          productId: string
          keyword?: string
        }): Promise<
          | Array<{
              supplierName: string
              supplierTitle: string | null
              companyName: string | null
              price: number
              freightPrice: number | null
              moq: string
              repurchaseRate: string | null
              serviceRate48h: string | null
              imgUrl: string
              detailUrl: string
              netProfit: number
              isFallback: boolean
            }>
          | {
              error: 'DEBUG_MODE_ACTIVE'
              url: string
            }
        > => ipcRenderer.invoke('IPC_SEARCH_1688_BY_IMAGE', payload),
        onSourcingCaptchaNeeded: (listener: () => void): (() => void) => {
          const handler = (): void => listener()
          ipcRenderer.on('IPC_SOURCING_CAPTCHA_NEEDED', handler)
          return () => {
            ipcRenderer.off('IPC_SOURCING_CAPTCHA_NEEDED', handler)
          }
        },
        onSourcingLoginNeeded: (listener: () => void): (() => void) => {
          const handler = (): void => listener()
          ipcRenderer.on('IPC_SOURCING_LOGIN_NEEDED', handler)
          return () => {
            ipcRenderer.off('IPC_SOURCING_LOGIN_NEEDED', handler)
          }
        },
        open1688Login: (): Promise<boolean> =>
          ipcRenderer.invoke('cms.scout.dashboard.open1688Login'),
        check1688Login: (): Promise<boolean> =>
          ipcRenderer.invoke('cms.scout.dashboard.check1688Login'),
        exportExcel: (payload?: {
          snapshotDate?: string
          keyword?: string
          onlyAlerts?: boolean
          onlyNew?: boolean
        }): Promise<string | null> => ipcRenderer.invoke('cms.scout.dashboard.exportExcel', payload)
      }
    },
    ai: {
      route: {
        resolve: (payload: { capability: AiCapability }): Promise<{
          providerId: string
          providerName: string
          capability: AiCapability
          baseUrl: string
          apiKey: string
          modelId: string
          modelName: string
          endpointPath: string
          protocol: 'openai' | 'google-genai' | 'vendor-custom'
        }> => ipcRenderer.invoke('cms.ai.route.resolve', payload)
      },
      task: {
        run: (payload: {
          capability: AiCapability
          input: unknown
          context?: Record<string, unknown>
        }): Promise<{
          mode: 'direct'
          capability: AiCapability
          route: {
            providerId: string
            providerName: string
            capability: AiCapability
            baseUrl: string
            apiKey: string
            modelId: string
            modelName: string
            endpointPath: string
            protocol: 'openai' | 'google-genai' | 'vendor-custom'
          }
          input: unknown
          context: Record<string, unknown>
        }> => ipcRenderer.invoke('cms.ai.task.run', payload)
      }
    },
    aiStudio: {
      provider: {
        testConnection: (payload?: {
          provider?: string
          baseUrl?: string
          apiKey?: string
          defaultImageModel?: string
          endpointPath?: string
        }): Promise<{
          success: boolean
          provider: string
          baseUrl: string
          model: string
          endpointPath: string
          checkedAt: number
          statusCode: number | null
          message: string
        }> => ipcRenderer.invoke('cms.aiStudio.provider.testConnection', payload)
      },
      template: {
        list: (payload?: { capability?: 'image' | 'video' | 'chat' }): Promise<AiStudioTemplateRecord[]> =>
          ipcRenderer.invoke('cms.aiStudio.template.list', payload),
        upsert: (payload: {
          id?: string
          provider?: string
          capability?: 'image' | 'video' | 'chat'
          name: string
          promptText?: string
          config?: Record<string, unknown>
        }): Promise<AiStudioTemplateRecord> =>
          ipcRenderer.invoke('cms.aiStudio.template.upsert', payload),
        delete: (payload: { templateId: string }): Promise<{ success: boolean }> =>
          ipcRenderer.invoke('cms.aiStudio.template.delete', payload)
      },
      task: {
        importFolders: (payload?: { folderPaths?: string[] }): Promise<AiStudioImportedFolder[]> =>
          ipcRenderer.invoke('cms.aiStudio.task.importFolders', payload),
        create: (payload: {
          id?: string
          templateId?: string | null
          provider?: string
          sourceFolderPath?: string | null
          productName?: string
          status?: 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'archived'
          aspectRatio?: string
          outputCount?: number
          model?: string
          promptExtra?: string
          primaryImagePath?: string | null
          referenceImagePaths?: string[]
          inputImagePaths?: string[]
          remoteTaskId?: string | null
          latestRunId?: string | null
          priceMinSnapshot?: number | null
          priceMaxSnapshot?: number | null
          billedState?: 'unbilled' | 'billable' | 'not_billable' | 'settled'
          metadata?: Record<string, unknown>
          assets?: Array<{
            id?: string
            taskId: string
            runId?: string | null
            kind?: 'input' | 'output'
            role?: string
            filePath: string
            previewPath?: string | null
            originPath?: string | null
            selected?: boolean
            sortOrder?: number
            metadata?: Record<string, unknown>
          }>
        }): Promise<AiStudioTaskRecord> => ipcRenderer.invoke('cms.aiStudio.task.create', payload),
        list: (payload?: {
          status?: string
          ids?: string[]
          limit?: number
        }): Promise<AiStudioTaskRecord[]> => ipcRenderer.invoke('cms.aiStudio.task.list', payload),
        update: (payload: {
          taskId: string
          patch?: {
            templateId?: string | null
            provider?: string
            sourceFolderPath?: string | null
            productName?: string
            status?: 'draft' | 'ready' | 'running' | 'completed' | 'failed' | 'archived'
            aspectRatio?: string
            outputCount?: number
            model?: string
            promptExtra?: string
            primaryImagePath?: string | null
            referenceImagePaths?: string[]
            inputImagePaths?: string[]
            remoteTaskId?: string | null
            latestRunId?: string | null
            priceMinSnapshot?: number | null
            priceMaxSnapshot?: number | null
            billedState?: 'unbilled' | 'billable' | 'not_billable' | 'settled'
            metadata?: Record<string, unknown>
          }
        }): Promise<AiStudioTaskRecord> => ipcRenderer.invoke('cms.aiStudio.task.update', payload),
        delete: (payload: { taskId: string } | string): Promise<{ success: boolean }> =>
          ipcRenderer.invoke('cms.aiStudio.task.delete', payload),
        deleteProject: (payload: { taskId: string } | string): Promise<{
          success: boolean
          projectId: string
          projectName: string
          projectPath: string | null
          deletedTaskIds: string[]
        }> => ipcRenderer.invoke('cms.aiStudio.task.deleteProject', payload),
        ensureRunDirectory: (payload: {
          taskId: string
          runIndex?: number
        }): Promise<{
          taskId: string
          runIndex: number
          dirPath: string
        }> => ipcRenderer.invoke('cms.aiStudio.task.ensureRunDirectory', payload),
        ensureProjectDirectory: (payload: {
          projectId: string
          projectName?: string
          preferredPath?: string
        }): Promise<{
          projectId: string
          dirPath: string
        }> => ipcRenderer.invoke('cms.aiStudio.task.ensureProjectDirectory', payload),
        recordRunAttempt: (payload: {
          runId?: string
          taskId: string
          provider?: string
          status?: string
          remoteTaskId?: string | null
          billedState?: 'unbilled' | 'billable' | 'not_billable' | 'settled'
          priceMinSnapshot?: number | null
          priceMaxSnapshot?: number | null
          requestPayload?: Record<string, unknown>
          responsePayload?: Record<string, unknown>
          errorMessage?: string | null
          startedAt?: number | null
          finishedAt?: number | null
        }): Promise<AiStudioRunRecord> =>
          ipcRenderer.invoke('cms.aiStudio.task.recordRunAttempt', payload),
        updateBilledState: (payload: {
          taskId: string
          billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
          priceMinSnapshot?: number | null
          priceMaxSnapshot?: number | null
          runId?: string | null
          remoteTaskId?: string | null
        }): Promise<AiStudioTaskRecord> =>
          ipcRenderer.invoke('cms.aiStudio.task.updateBilledState', payload),
        startRun: (payload: {
          taskId: string
        }): Promise<{
          task: AiStudioTaskRecord
          run: AiStudioRunRecord
          outputs: AiStudioAssetRecord[]
          completed: boolean
          status: string
          remoteTaskId: string | null
          billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
          priceMinSnapshot: number | null
          priceMaxSnapshot: number | null
        }> => ipcRenderer.invoke('cms.aiStudio.task.startRun', payload),
        pollRun: (payload: {
          taskId: string
          runId?: string | null
        }): Promise<{
          task: AiStudioTaskRecord
          run: AiStudioRunRecord
          outputs: AiStudioAssetRecord[]
          completed: boolean
          status: string
          remoteTaskId: string | null
          billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
          priceMinSnapshot: number | null
          priceMaxSnapshot: number | null
        }> => ipcRenderer.invoke('cms.aiStudio.task.pollRun', payload),
        retryRun: (payload: {
          taskId: string
        }): Promise<{
          task: AiStudioTaskRecord
          run: AiStudioRunRecord
          outputs: AiStudioAssetRecord[]
          completed: boolean
          status: string
          remoteTaskId: string | null
          billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
          priceMinSnapshot: number | null
          priceMaxSnapshot: number | null
        }> => ipcRenderer.invoke('cms.aiStudio.task.retryRun', payload)
      },
      run: {
        get: (payload: { runId: string }): Promise<AiStudioRunRecord | null> =>
          ipcRenderer.invoke('cms.aiStudio.run.get', payload)
      },
      asset: {
        list: (payload?: {
          taskId?: string
          runId?: string
          kind?: 'input' | 'output'
          ids?: string[]
        }): Promise<AiStudioAssetRecord[]> =>
          ipcRenderer.invoke('cms.aiStudio.asset.list', payload),
        upsert: (
          payload: Array<{
            id?: string
            taskId: string
            runId?: string | null
            kind?: 'input' | 'output'
            role?: string
            filePath: string
            previewPath?: string | null
            originPath?: string | null
            selected?: boolean
            sortOrder?: number
            metadata?: Record<string, unknown>
          }>
        ): Promise<AiStudioAssetRecord[]> =>
          ipcRenderer.invoke('cms.aiStudio.asset.upsert', payload),
        markSelected: (payload: {
          taskId: string
          assetIds: string[]
          selected?: boolean
          clearOthers?: boolean
        }): Promise<AiStudioAssetRecord[]> =>
          ipcRenderer.invoke('cms.aiStudio.asset.markSelected', payload)
      }
    },
    noteRace: {
      importAutoFile: (payload?: { filePath?: string }): Promise<NoteRaceImportResult | null> =>
        ipcRenderer.invoke('cms.noteRace.importAutoFile', payload),
      importAutoFiles: (payload?: {
        filePath?: string
        filePaths?: string[]
      }): Promise<NoteRaceAutoImportBatchResult | null> =>
        ipcRenderer.invoke('cms.noteRace.importAutoFiles', payload),
      importCommerceFile: (payload?: { filePath?: string }): Promise<NoteRaceImportResult | null> =>
        ipcRenderer.invoke('cms.noteRace.importCommerceFile', payload),
      importContentFile: (payload?: { filePath?: string }): Promise<NoteRaceImportResult | null> =>
        ipcRenderer.invoke('cms.noteRace.importContentFile', payload),
      scanFolderImports: (payload: {
        dirPath: string
        sinceMs?: number
      }): Promise<NoteRaceScanFolderResult> =>
        ipcRenderer.invoke('cms.noteRace.scanFolderImports', payload),
      meta: (): Promise<NoteRaceMeta> => ipcRenderer.invoke('cms.noteRace.meta'),
      snapshotStats: (): Promise<NoteRaceSnapshotStat[]> =>
        ipcRenderer.invoke('cms.noteRace.snapshotStats'),
      snapshotBatchStats: (payload?: {
        snapshotDate?: string
        includeDeleted?: boolean
      }): Promise<NoteRaceSnapshotBatchStat[]> =>
        ipcRenderer.invoke('cms.noteRace.snapshotBatchStats', payload),
      deleteSnapshot: (payload: { snapshotDate: string }): Promise<NoteRaceDeleteSnapshotResult> =>
        ipcRenderer.invoke('cms.noteRace.deleteSnapshot', payload),
      deleteSnapshotBatch: (payload: {
        snapshotDate: string
        importedAt: number
        reason?: string
      }): Promise<NoteRaceDeleteBatchResult> =>
        ipcRenderer.invoke('cms.noteRace.deleteSnapshotBatch', payload),
      restoreSnapshotBatch: (payload: {
        snapshotDate: string
        importedAt: number
      }): Promise<NoteRaceRestoreBatchResult> =>
        ipcRenderer.invoke('cms.noteRace.restoreSnapshotBatch', payload),
      resetAll: (): Promise<NoteRaceResetResult> => ipcRenderer.invoke('cms.noteRace.resetAll'),
      list: (payload?: {
        snapshotDate?: string
        account?: string
        noteType?: '全部' | '图文' | '视频'
        limit?: number
      }): Promise<NoteRaceListRow[]> => ipcRenderer.invoke('cms.noteRace.list', payload),
      detail: (payload: {
        snapshotDate?: string
        noteKey?: string
      }): Promise<NoteRaceDetail | null> => ipcRenderer.invoke('cms.noteRace.detail', payload)
    }
  }
}

const electronAPI = {
  openMediaFiles: (payload?: { multiSelections?: boolean; accept?: 'image' | 'video' | 'all' }) =>
    ipcRenderer.invoke('dialog:openMediaFiles', payload),
  openMediaFilePaths: (payload?: {
    multiSelections?: boolean
    accept?: 'image' | 'video' | 'all'
  }) => ipcRenderer.invoke('dialog:openMediaFilePaths', payload),
  openAudioFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openAudioFile'),
  prepareVideoPreview: (filePath: string) =>
    ipcRenderer.invoke('media:prepareVideoPreview', { filePath }),
  captureVideoFrame: (filePath: string, timeSec?: number): Promise<string> =>
    ipcRenderer.invoke('media:captureVideoFrame', { filePath, timeSec }),
  composeVideoFromImages: (payload: {
    sourceImages: string[]
    template: {
      name?: string
      totalDurationSec: number
      imageCountMin: number
      imageCountMax: number
      width: number
      height: number
      fps: number
      transitionType: 'none' | 'fade' | 'slideleft'
      transitionDurationSec: number
      bgmVolume: number
    }
    bgmPath?: string
    outputPath?: string
    seed?: number
    batchIndex?: number
    batchTotal?: number
  }): Promise<{
    success: boolean
    outputPath?: string
    usedImages?: string[]
    seed?: number
    error?: string
    debug?: {
      errorName: string
      errorMessage: string
      stackTop?: string
      runtime: {
        platform: string
        arch: string
        isPackaged: boolean
      }
      ffmpeg: { rawPath: string; normalizedPath: string; exists: boolean }
      ffprobe: { rawPath: string; normalizedPath: string; exists: boolean }
    }
  }> => ipcRenderer.invoke('media:composeVideoFromImages', payload),
  composeVideoBatchFromImages: (payload: {
    sourceRootPath?: string
    sourceImages?: string[]
    sourceVideos?: string[]
    template: {
      name?: string
      totalDurationSec: number
      imageCountMin: number
      imageCountMax: number
      width: number
      height: number
      fps: number
      transitionType: 'none' | 'fade' | 'slideleft'
      transitionDurationSec: number
      bgmVolume: number
    }
    batchCount: number
    bgmMode?: 'none' | 'fixed' | 'random'
    bgmPath?: string
    bgmOptions?: string[]
    seedBase?: number
    lowLoadMode?: boolean
    renderMode?: 'low' | 'hd'
    outputAspect?: '9:16' | '3:4'
  }): Promise<ComposeVideoBatchFromImagesResult> =>
    ipcRenderer.invoke('media:composeVideoBatchFromImages', payload),
  onComposeVideoProgress: (
    listener: (payload: ComposeVideoProgressPayload) => void
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      const record = payload as Record<string, unknown>
      const percent = Number(record.percent)
      const batchIndex = Number(record.batchIndex)
      const batchTotal = Number(record.batchTotal)
      const message = typeof record.message === 'string' ? record.message : undefined
      listener({
        percent: Number.isFinite(percent) ? percent : undefined,
        batchIndex: Number.isFinite(batchIndex) ? Math.floor(batchIndex) : undefined,
        batchTotal: Number.isFinite(batchTotal) ? Math.floor(batchTotal) : undefined,
        message
      })
    }
    ipcRenderer.on('media:composeVideoFromImagesProgress', handler)
    return () => {
      ipcRenderer.off('media:composeVideoFromImagesProgress', handler)
    }
  },
  syncDouyinHotMusic: (payload?: {
    outputDir?: string
    limit?: number
  }): Promise<SyncDouyinHotMusicResult> => ipcRenderer.invoke('media:syncDouyinHotMusic', payload),
  listDouyinHotMusicTracks: (payload?: { outputDir?: string }): Promise<ListDouyinHotMusicResult> =>
    ipcRenderer.invoke('media:listDouyinHotMusicTracks', payload),
  getReleaseMeta: (): Promise<AppReleaseMeta> => ipcRenderer.invoke('app:getReleaseMeta'),
  getAppUpdateState: (): Promise<AppUpdateState> => ipcRenderer.invoke('app:update.getState'),
  checkAppUpdate: (): Promise<AppUpdateState> => ipcRenderer.invoke('app:update.check'),
  installAppUpdateNow: (): Promise<InstallUpdateResult> => ipcRenderer.invoke('app:update.install'),
  onAppUpdateStatus: (listener: (state: AppUpdateState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return
      listener(payload as AppUpdateState)
    }
    ipcRenderer.on('app:update.status', handler)
    return () => {
      ipcRenderer.off('app:update.status', handler)
    }
  },
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  showMessageBox: (payload: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }): Promise<{ response: number; checkboxChecked?: boolean }> =>
    ipcRenderer.invoke('dialog:showMessageBox', payload),
  scanDirectory: (folderPath: string): Promise<string[]> =>
    ipcRenderer.invoke('scan-directory', folderPath),
  scanDirectoryRecursive: (folderPath: string): Promise<string[]> =>
    ipcRenderer.invoke('scan-directory-recursive', folderPath),
  scanMediaDirectoryRecursive: (folderPath: string): Promise<string[]> =>
    ipcRenderer.invoke('scan-media-directory-recursive', folderPath),
  getPathForFile: (file: unknown): string => webUtils.getPathForFile(file as unknown as File),
  getWorkspacePath: (): Promise<{ path: string; status: 'initialized' | 'uninitialized' }> =>
    ipcRenderer.invoke('workspace.getPath'),
  pickWorkspacePath: (): Promise<string | null> => ipcRenderer.invoke('workspace.pickPath'),
  setWorkspacePath: (path: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('workspace.setPath', path),
  relaunch: (): Promise<{ success: true }> => ipcRenderer.invoke('workspace.relaunch'),
  getConfig: (): Promise<{
    publishMode: CmsPublishMode
    chromeExecutablePath: string
    cmsChromeDataDir: string
    aiProvider: string
    aiBaseUrl: string
    aiApiKey: string
    aiDefaultImageModel: string
    aiEndpointPath: string
    aiProviderProfiles: AiProviderProfile[]
    aiRuntimeDefaults: AiRuntimeDefaults
    importStrategy: 'copy' | 'move'
    realEsrganPath: string
    pythonPath: string
    watermarkScriptPath: string
    dynamicWatermarkEnabled: boolean
    dynamicWatermarkOpacity: number
    dynamicWatermarkSize: number
    dynamicWatermarkTrajectory:
      | 'smoothSine'
      | 'figureEight'
      | 'diagonalWrap'
      | 'largeEllipse'
      | 'pseudoRandom'
    storageMaintenanceEnabled: boolean
    storageMaintenanceStartTime: string
    storageMaintenanceRetainDays: number
    storageArchivePath: string
    scoutDashboardAutoImportDir: string
    watermarkBox: { x: number; y: number; width: number; height: number }
    defaultStartTime: string
    defaultInterval: number
    localGateway: LocalGatewayConfig
  }> => ipcRenderer.invoke('get-config'),
  saveConfig: (patch: {
    publishMode?: CmsPublishMode
    chromeExecutablePath?: string
    cmsChromeDataDir?: string
    aiProvider?: string
    aiBaseUrl?: string
    aiApiKey?: string
    aiDefaultImageModel?: string
    aiEndpointPath?: string
    aiProviderProfiles?: AiProviderProfile[]
    aiRuntimeDefaults?: AiRuntimeDefaults
    importStrategy?: 'copy' | 'move'
    realEsrganPath?: string
    pythonPath?: string
    watermarkScriptPath?: string
    dynamicWatermarkEnabled?: boolean
    dynamicWatermarkOpacity?: number
    dynamicWatermarkSize?: number
    dynamicWatermarkTrajectory?:
      | 'smoothSine'
      | 'figureEight'
      | 'diagonalWrap'
      | 'largeEllipse'
      | 'pseudoRandom'
    storageMaintenanceEnabled?: boolean
    storageMaintenanceStartTime?: string
    storageMaintenanceRetainDays?: number
    storageArchivePath?: string
    scoutDashboardAutoImportDir?: string
    watermarkBox?: { x: number; y: number; width: number; height: number }
    defaultStartTime?: string
    defaultInterval?: number
    localGateway?: Partial<LocalGatewayConfig>
  }): Promise<{ success: true }> => ipcRenderer.invoke('save-config', patch),
  getLocalGatewayState: (): Promise<LocalGatewayState> => ipcRenderer.invoke('local-gateway:get-state'),
  retryStartLocalGateway: (): Promise<LocalGatewayState> => ipcRenderer.invoke('local-gateway:retry-start'),
  listLocalGatewayChromeProfiles: (): Promise<LocalGatewayChromeProfile[]> =>
    ipcRenderer.invoke('local-gateway:list-chrome-profiles'),
  ensureLocalGatewayProfile: (): Promise<LocalGatewayChromeProfile> =>
    ipcRenderer.invoke('local-gateway:ensure-gateway-profile'),
  openLocalGatewayProfileLogin: (): Promise<{ success: true; profileId: string }> =>
    ipcRenderer.invoke('local-gateway:open-gateway-login'),
  initializeLocalGateway: (payload?: {
    smokeImage?: boolean
  }): Promise<LocalGatewayInitializationResult> =>
    ipcRenderer.invoke('local-gateway:initialize', payload),
  getStorageMaintenanceState: (): Promise<StorageMaintenanceState> =>
    ipcRenderer.invoke('cms.storage.maintenance.state'),
  runStorageMaintenanceNow: (payload?: {
    reason?: string
    dryRun?: boolean
  }): Promise<StorageMaintenanceSummary> =>
    ipcRenderer.invoke('cms.storage.maintenance.runNow', payload),
  rollbackStorageMaintenance: (
    runId: string
  ): Promise<{ success: boolean; restored: number; errors: string[] }> =>
    ipcRenderer.invoke('cms.storage.maintenance.rollback', { runId }),
  getFeishuConfig: (): Promise<{
    appId: string
    appSecret: string
    baseToken: string
    tableId: string
  } | null> => ipcRenderer.invoke('get-feishu-config'),
  uploadImage: (
    filePath: string,
    appId: string,
    appSecret: string,
    baseToken: string
  ): Promise<string> =>
    ipcRenderer.invoke('feishu-upload-image', filePath, appId, appSecret, baseToken),
  createRecord: (
    fields: Record<string, unknown>,
    appId: string,
    appSecret: string,
    baseToken: string,
    tableId: string
  ): Promise<string> =>
    ipcRenderer.invoke('feishu-create-record', fields, appId, appSecret, baseToken, tableId),
  testFeishuConnection: (
    appId:
      | string
      | {
          appId: string
          appSecret: string
          baseToken: string
          tableId: string
        },
    appSecret?: string,
    baseToken?: string,
    tableId?: string
  ): Promise<{ success: true }> =>
    typeof appId === 'object' && appId !== null
      ? ipcRenderer.invoke(
          'feishu-test-connection',
          appId.appId,
          appId.appSecret,
          appId.baseToken,
          appId.tableId
        )
      : ipcRenderer.invoke(
          'feishu-test-connection',
          appId,
          appSecret ?? '',
          baseToken ?? '',
          tableId ?? ''
        ),
  processGridSplit: (payload: {
    sourceFiles: string[]
    rows: number
    cols: number
  }): Promise<string[]> => ipcRenderer.invoke('process-grid-split', payload),
  processHdUpscale: (payload: { files: string[]; exePath: string }): Promise<string[]> =>
    ipcRenderer.invoke('process-hd-upscale', payload),
  processWatermark: (payload: {
    files: string[]
    pythonPath: string
    scriptPath: string
    watermarkBox: { x: number; y: number; width: number; height: number }
  }): Promise<string[]> => ipcRenderer.invoke('process-watermark', payload),
  onProcessLog: (
    listener: (payload: {
      level: 'stdout' | 'stderr' | 'info' | 'error'
      message: string
      timestamp: number
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { level: 'stdout' | 'stderr' | 'info' | 'error'; message: string; timestamp: number }
    ): void => {
      listener(payload)
    }
    ipcRenderer.on('process-log', handler)
    return () => {
      ipcRenderer.off('process-log', handler)
    }
  },
  deleteFile: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('delete-file', filePath),
  shellShowItemInFolder: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('shell-showItemInFolder', filePath),
  shellOpenPath: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('shell-openPath', filePath),
  exportFiles: (
    filePaths: string[]
  ): Promise<
    | { success: true; copied: number; destinationDir: string }
    | { success: false; error: string }
    | null
  > => ipcRenderer.invoke('export-files', filePaths)
}

// 仅在启用上下文隔离时通过 contextBridge 暴露；否则挂载到全局 window
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', toolkitElectronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = toolkitElectronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.electronAPI = electronAPI
}
