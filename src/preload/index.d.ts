import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type WatermarkBox = { x: number; y: number; width: number; height: number }

  type CmsAccountRecord = {
    id: string
    name: string
    partitionKey: string
    lastLoginTime: number | null
  }

  type PublisherResult = { success: boolean; time?: string; error?: string }

  type CmsProductRecord = {
    id: string
    name: string
    price: string
    cover: string
    accountId: string
  }

  type CmsPublishTaskStatus = 'pending' | 'processing' | 'failed' | 'publish_failed' | 'scheduled' | 'published'

  type CmsPublishTask = {
    id: string
    accountId: string
    status: CmsPublishTaskStatus
    mediaType: 'image' | 'video'
    videoPath?: string
    videoPreviewPath?: string
    images: string[]
    title: string
    content: string
    tags?: string[]
    productId?: string
    productName?: string
    publishMode: 'immediate'
    isRaw?: boolean
    scheduledAt?: number
    publishedAt: string | null
    errorMsg: string
    errorMessage?: string
    createdAt: number
  }

  type PrepareVideoPreviewResult = {
    originalPath: string
    previewPath: string | null
    isCompatible: boolean
    codecName?: string
    error?: string
  }

  type MediaSelectionItem = {
    originalPath: string
    previewPath: string | null
    mediaType: 'image' | 'video'
    isCompatible?: boolean
    codecName?: string
    error?: string
  }

  interface SuperCmsApi {
    cms: {
      system: {
        onLog: (listener: (payload: { type?: string; message?: string; timestamp?: number } | string) => void) => () => void
        openExternal: (url: string) => Promise<boolean>
      }
      image: {
        saveBase64: (payload: { dataUrl: string; filename: string }) => Promise<string>
      }
      queue: {
        start: (
          payload: string | { accountId: string; taskIds?: string[] }
        ) => Promise<{ processed: number; succeeded: number; failed: number }>
      }
      account: {
        list: () => Promise<CmsAccountRecord[]>
        create: (name: string) => Promise<CmsAccountRecord>
        login: (accountId: string) => Promise<{ windowId: number }>
        checkStatus: (accountId: string) => Promise<boolean>
        rename: (accountId: string, name: string) => Promise<CmsAccountRecord>
        delete: (accountId: string) => Promise<{ success: boolean }>
      }
      product: {
        list: (payload?: { accountId?: string }) => Promise<CmsProductRecord[]>
        save: (products: Array<Omit<CmsProductRecord, 'accountId'> & { accountId?: string }>) => Promise<CmsProductRecord[]>
        sync: (accountId: string) => Promise<CmsProductRecord[]>
      }
      publisher: {
        publish: (
          accountId: string,
          taskData: {
            title?: string
            content?: string
            mediaType?: 'image' | 'video'
            videoPath?: string
            images?: string[]
            imagePath?: string
            productId?: string
            productName?: string
            dryRun?: boolean
            mode?: 'immediate'
          }
        ) => Promise<PublisherResult>
        onAutomationLog: (listener: (message: string) => void) => () => void
        onPublishProgress: (
          listener: (payload: { accountId?: string; message?: string; progress?: number }) => void
        ) => () => void
      }
      scout: {
        keyword: {
          list: () => Promise<Array<{
            id: string; keyword: string; sortMode: string; isActive: boolean
            productCount: number; lastSyncedAt: number | null; createdAt: number
          }>>
          add: (keyword: string, sortMode?: string) => Promise<{
            id: string; keyword: string; sortMode: string; isActive: boolean
            productCount: number; lastSyncedAt: number | null; createdAt: number
          }>
          remove: (id: string) => Promise<void>
          toggle: (id: string, isActive: boolean) => Promise<void>
        }
        product: {
          list: (payload: {
            keywordId: string; sortBy?: string; sortOrder?: string
            limit?: number; offset?: number
          }) => Promise<Array<{
            id: string; keywordId: string; productName: string; productUrl: string
            price: number | null; addCart24h: string | null; addCart24hValue: number
            totalSales: string | null; threeMonthBuyers: string | null
            addCartTag: string | null; positiveReviewTag: string | null; collectionTag: string | null
            reviewCount: number; productRating: number | null
            shopName: string | null; shopUrl: string | null; shopFans: string | null
            shopSales: string | null; shopRating: number | null
            sortMode: string | null; rankPosition: number | null
            firstSeenAt: number; lastUpdatedAt: number
          }>>
        }
        sync: {
          importFile: () => Promise<{ keywordsUpdated: number; productsUpserted: number } | null>
          importData: (data: unknown) => Promise<{ keywordsUpdated: number; productsUpserted: number }>
          history: () => Promise<Array<{
            id: string; syncedAt: number; sessionId: string | null
            keywordsCount: number; productsCount: number; status: string
          }>>
        }
        export: {
          excel: (payload: { keywordId?: string }) => Promise<string | null>
        }
        dashboard: {
          importExcelFile: () => Promise<{
            snapshotDates: string[]
            rowsUpserted: number
            productsMapped: number
            keywordsCount: number
            sourceFile: string
          } | null>
          deleteSnapshot: (payload: {
            snapshotDate: string
          }) => Promise<{
            snapshotDate: string
            deletedSnapshotRows: number
            deletedWatchlistRows: number
            deletedProductMapRows: number
            deletedCoverCacheRows: number
          }>
          deleteKeywordSnapshot: (payload: {
            snapshotDate: string
            keyword: string
          }) => Promise<{
            snapshotDate: string
            keyword: string
            deletedSnapshotRows: number
            deletedWatchlistRows: number
            deletedProductMapRows: number
            deletedCoverCacheRows: number
          }>
          coverDebugState: () => Promise<{
            visual: boolean
            keepWindowOpen: boolean
            openDevTools: boolean
            logPath: string
          }>
          setCoverDebugState: (payload: {
            visual?: boolean
            keepWindowOpen?: boolean
            openDevTools?: boolean
          }) => Promise<{
            visual: boolean
            keepWindowOpen: boolean
            openDevTools: boolean
            logPath: string
          }>
          coverDebugLog: (payload?: { limit?: number }) => Promise<{ logPath: string; lines: string[] }>
          meta: () => Promise<{
            latestDate: string | null
            availableDates: string[]
            totalKeywords: number
            totalProducts: number
            lastImportAt: number | null
          }>
          keywordHeat: (payload?: {
            snapshotDate?: string
            keyword?: string
            onlyAlerts?: boolean
            limit?: number
          }) => Promise<Array<{
            keyword: string
            todayHeat: number
            prevHeat: number | null
            deltaHeat: number | null
            growthRate: number | null
            productCount: number
            isAlert: boolean
            isRising2d: boolean
          }>>
          potentialProducts: (payload?: {
            snapshotDate?: string
            keyword?: string
            onlyNew?: boolean
            limit?: number
            sortBy?: 'potentialScore' | 'addCart24hValue' | 'deltaAddCart24h' | 'shopFans' | 'lastUpdatedAt'
            sortOrder?: 'ASC' | 'DESC'
          }) => Promise<Array<{
            productKey: string
            keyword: string
            productName: string
            productUrl: string | null
            cachedImageUrl: string | null
            price: number | null
            addCart24hValue: number
            prevAddCart24hValue: number | null
            deltaAddCart24h: number | null
            isNew: boolean
            firstSeenAt: number
            lastUpdatedAt: number
            positiveReviewTag: string | null
            shopName: string | null
            shopFans: string | null
            potentialScore: number
            suggestedAction: '优先种草' | '继续观察' | '暂缓'
          }>>
          trends: (payload?: {
            snapshotDate?: string
            keyword?: string
            days?: number
            limit?: number
          }) => Promise<{
            dates: string[]
            series: Array<{ keyword: string; values: number[]; max: number; min: number; volatility: number }>
          }>
          productDetail: (payload: {
            snapshotDate: string
            productKey: string
          }) => Promise<{
            snapshotDate: string
            productKey: string
            keyword: string
            primaryKeyword: string
            sourceFile: string | null
            importedAt: number
            rawPayload: Record<string, unknown>
          } | null>
          markPotential: (payload: {
            snapshotDate: string
            products: Array<{
              productKey: string
              keyword: string
              productName: string
              productUrl?: string | null
              salePrice?: number | null
            }>
          }) => Promise<{ upserted: number; skipped: number }>
          markedProducts: (payload?: {
            snapshotDate?: string
            keyword?: string
          }) => Promise<Array<{
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
          }>>
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
          }) => Promise<{
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
          } | null>
          fetchXhsImage: (payload: { productId: string; xiaohongshuUrl: string }) => void
          onXhsImageUpdated: (
            listener: (payload: { productId: string; imageUrl: string }) => void
          ) => () => void
          onXhsImageFetchFailed: (
            listener: (payload: { productId: string; reason: string; retryable: boolean }) => void
          ) => () => void
          search1688ByImage: (payload: {
            imageUrl: string
            targetPrice: number
            productId: string
            keyword?: string
          }) => Promise<
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
          >
          onSourcingCaptchaNeeded: (listener: () => void) => () => void
          onSourcingLoginNeeded: (listener: () => void) => () => void
          open1688Login: () => Promise<boolean>
          check1688Login: () => Promise<boolean>
          exportExcel: (payload?: {
            snapshotDate?: string
            keyword?: string
            onlyAlerts?: boolean
            onlyNew?: boolean
          }) => Promise<string | null>
        }
      }
      task: {
        createBatch: (
          tasks: Array<{
            accountId: string
            images?: string[]
            title: string
            content: string
            tags?: string[]
            productId?: string
            productName?: string
            publishMode?: 'immediate'
            mediaType?: 'image' | 'video'
            videoPath?: string
            videoPreviewPath?: string
          }>,
          options?: { requestId?: string }
        ) => Promise<CmsPublishTask[]>
        list: (accountId: string) => Promise<CmsPublishTask[]>
        updateBatch(
          ids: string[],
          updates: {
            title?: string
            content?: string
            images?: string[]
            productId?: string
            productName?: string
            publishMode?: 'immediate'
            status?: CmsPublishTaskStatus
            scheduledAt?: number | null
            publishedAt?: string | null
            errorMsg?: string
            errorMessage?: string
            isRaw?: boolean
          }
        ): Promise<CmsPublishTask[]>
        updateBatch(
          patches: Array<{
            id: string
            updates: {
              title?: string
              content?: string
              images?: string[]
              productId?: string
              productName?: string
              status?: CmsPublishTaskStatus
              scheduledAt?: number | null
              publishedAt?: string | null
              errorMsg?: string
              errorMessage?: string
              publishMode?: 'immediate'
              isRaw?: boolean
            }
          }>
        ): Promise<CmsPublishTask[]>
        importImages: (filePaths: string[]) => Promise<string[]>
        cancelSchedule: (taskIds: string[]) => Promise<CmsPublishTask[]>
        deleteBatch: (ids: string[]) => Promise<{ deleted: number; deletedIds: string[] }>
        delete: (taskId: string) => Promise<{ success: boolean }>
        updateStatus: (taskId: string, status: CmsPublishTaskStatus) => Promise<CmsPublishTask | null>
        onUpdated: (listener: (task: CmsPublishTask) => void) => () => void
        onCreateBatchProgress: (
          listener: (payload: {
            phase?: 'start' | 'progress' | 'done'
            processed?: number
            total?: number
            created?: number
            message?: string
            requestId?: string
          }) => void
        ) => () => void
      }
    }
  }

  interface SuperCmsElectronAPI {
    openMediaFiles: (payload?: {
      multiSelections?: boolean
      accept?: 'image' | 'video' | 'all'
    }) => Promise<MediaSelectionItem | MediaSelectionItem[] | null>
    prepareVideoPreview: (filePath: string) => Promise<PrepareVideoPreviewResult>
    openDirectory: () => Promise<string | null>
    showMessageBox: (payload: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
    }) => Promise<{ response: number; checkboxChecked?: boolean }>
    scanDirectory: (folderPath: string) => Promise<string[]>
    getPathForFile: (file: File) => string
    getWorkspacePath: () => Promise<{ path: string; status: 'initialized' | 'uninitialized' }>
    pickWorkspacePath: () => Promise<string | null>
    setWorkspacePath: (path: string) => Promise<{ path: string }>
    relaunch: () => Promise<{ success: true }>
    getConfig: () => Promise<{
      importStrategy: 'copy' | 'move'
      realEsrganPath: string
      pythonPath: string
      watermarkScriptPath: string
      scoutDashboardAutoImportDir: string
      watermarkBox: WatermarkBox
      defaultStartTime: string
      defaultInterval: number
    }>
    saveConfig: (patch: {
      importStrategy?: 'copy' | 'move'
      realEsrganPath?: string
      pythonPath?: string
      watermarkScriptPath?: string
      scoutDashboardAutoImportDir?: string
      watermarkBox?: WatermarkBox
      defaultStartTime?: string
      defaultInterval?: number
    }) => Promise<{ success: true }>
    getFeishuConfig: () => Promise<{ appId: string; appSecret: string; baseToken: string; tableId: string } | null>
    uploadImage: (filePath: string, appId: string, appSecret: string, baseToken: string) => Promise<string>
    createRecord: (
      fields: Record<string, unknown>,
      appId: string,
      appSecret: string,
      baseToken: string,
      tableId: string
    ) => Promise<string>
    testFeishuConnection: {
      (
        appId: string,
        appSecret: string,
        baseToken: string,
        tableId: string
      ): Promise<{ success: true }>
      (config: {
        appId: string
        appSecret: string
        baseToken: string
        tableId: string
      }): Promise<{ success: true }>
    }
    processGridSplit: (payload: { sourceFiles: string[]; rows: number; cols: number }) => Promise<string[]>
    processHdUpscale: (payload: { files: string[]; exePath: string }) => Promise<string[]>
    processWatermark: (payload: {
      files: string[]
      pythonPath: string
      scriptPath: string
      watermarkBox: WatermarkBox
    }) => Promise<string[]>
    onProcessLog: (
      listener: (payload: { level: 'stdout' | 'stderr' | 'info' | 'error'; message: string; timestamp: number }) => void
    ) => () => void
    deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
    shellShowItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
    exportFiles: (
      filePaths: string[]
    ) => Promise<{ success: true; copied: number; destinationDir: string } | { success: false; error: string } | null>
  }

  interface Window {
    electron: ElectronAPI
    api: SuperCmsApi
    electronAPI: SuperCmsElectronAPI
  }
}
