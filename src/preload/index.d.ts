import { ElectronAPI } from '@electron-toolkit/preload'
import type { AiCapability, AiProviderProfile, AiRuntimeDefaults } from '../shared/ai/aiProviderTypes'

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
    productUrl: string
    accountId: string
  }

  type CmsLinkedProductRecord = {
    id: string
    name: string
    cover: string
    productUrl: string
  }

  type CmsPublishTaskStatus =
    | 'pending'
    | 'processing'
    | 'failed'
    | 'publish_failed'
    | 'scheduled'
    | 'published'
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
    linkedProducts?: CmsLinkedProductRecord[]
    publishMode: 'immediate'
    transformPolicy?: 'none' | 'remix_v1'
    remixSessionId?: string
    remixSourceTaskIds?: string[]
    remixSeed?: string
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

  type VideoTemplateTransition = 'none' | 'fade' | 'slideleft'

  type VideoStyleTemplate = {
    name?: string
    totalDurationSec: number
    imageCountMin: number
    imageCountMax: number
    width: number
    height: number
    fps: number
    transitionType: VideoTemplateTransition
    transitionDurationSec: number
    bgmVolume: number
  }

  type ComposeVideoFromImagesResult = {
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

  type AiStudioImportedFolder = {
    folderPath: string
    productName: string
    imageFilePaths: string[]
  }

  type AiStudioTemplateRecord = {
    id: string
    provider: string
    capability: 'image' | 'video'
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
        onLog: (
          listener: (
            payload: { type?: string; message?: string; timestamp?: number } | string
          ) => void
        ) => () => void
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
        save: (
          products: Array<Omit<CmsProductRecord, 'accountId'> & { accountId?: string }>
        ) => Promise<CmsProductRecord[]>
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
            videoCoverMode?: 'auto' | 'manual'
            images?: string[]
            imagePath?: string
            productId?: string
            productName?: string
            linkedProducts?: CmsLinkedProductRecord[]
            dryRun?: boolean
            mode?: 'immediate'
          }
        ) => Promise<PublisherResult>
        onAutomationLog: (listener: (message: string) => void) => () => void
        onPublishProgress: (
          listener: (payload: { accountId?: string; message?: string; progress?: number }) => void
        ) => () => void
        onSession: (listener: (payload: CmsPublishSessionSnapshot) => void) => () => void
      }
      scout: {
        keyword: {
          list: () => Promise<
            Array<{
              id: string
              keyword: string
              sortMode: string
              isActive: boolean
              productCount: number
              lastSyncedAt: number | null
              createdAt: number
            }>
          >
          add: (
            keyword: string,
            sortMode?: string
          ) => Promise<{
            id: string
            keyword: string
            sortMode: string
            isActive: boolean
            productCount: number
            lastSyncedAt: number | null
            createdAt: number
          }>
          remove: (id: string) => Promise<void>
          toggle: (id: string, isActive: boolean) => Promise<void>
        }
        product: {
          list: (payload: {
            keywordId: string
            sortBy?: string
            sortOrder?: string
            limit?: number
            offset?: number
          }) => Promise<
            Array<{
              id: string
              keywordId: string
              productName: string
              productUrl: string
              price: number | null
              addCart24h: string | null
              addCart24hValue: number
              totalSales: string | null
              threeMonthBuyers: string | null
              addCartTag: string | null
              positiveReviewTag: string | null
              collectionTag: string | null
              reviewCount: number
              productRating: number | null
              shopName: string | null
              shopUrl: string | null
              shopFans: string | null
              shopSales: string | null
              shopRating: number | null
              sortMode: string | null
              rankPosition: number | null
              firstSeenAt: number
              lastUpdatedAt: number
            }>
          >
        }
        sync: {
          importFile: () => Promise<{ keywordsUpdated: number; productsUpserted: number } | null>
          importData: (
            data: unknown
          ) => Promise<{ keywordsUpdated: number; productsUpserted: number }>
          history: () => Promise<
            Array<{
              id: string
              syncedAt: number
              sessionId: string | null
              keywordsCount: number
              productsCount: number
              status: string
            }>
          >
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
          autoImportScanNow: () => Promise<{
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
          } | null>
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
          ) => () => void
          deleteSnapshot: (payload: { snapshotDate: string }) => Promise<{
            snapshotDate: string
            deletedSnapshotRows: number
            deletedWatchlistRows: number
            deletedProductMapRows: number
            deletedCoverCacheRows: number
          }>
          deleteKeywordSnapshot: (payload: { snapshotDate: string; keyword: string }) => Promise<{
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
          coverDebugLog: (payload?: {
            limit?: number
          }) => Promise<{ logPath: string; lines: string[] }>
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
          }) => Promise<
            Array<{
              keyword: string
              todayHeat: number
              prevHeat: number | null
              deltaHeat: number | null
              growthRate: number | null
              productCount: number
              isAlert: boolean
              isRising2d: boolean
            }>
          >
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
          }) => Promise<
            Array<{
              productKey: string
              keyword: string
              productName: string
              productUrl: string | null
              shopUrl: string | null
              cachedImageUrl: string | null
              price: number | null
              addCart24hValue: number
              prevAddCart24hValue: number | null
              prev_cart_value: number | null
              deltaAddCart24h: number | null
              totalSales: string | null
              recent_3m_sales: string | null
              cart_tag: string | null
              fav_tag: string | null
              imported_at: string | null
              shopSales: string | null
              productRating: number | null
              shopRating: number | null
              isNew: boolean
              firstSeenAt: number
              lastUpdatedAt: number
              positiveReviewTag: string | null
              shopName: string | null
              shopFans: string | null
              scout_strategy_tag: 'flawed_hot' | 'exploding_new' | null
              shop_dna_tag: 'viral_product' | null
              lifecycle_status: 'exploding' | 'mature' | 'declining' | 'new'
              potentialScore: number
              suggestedAction: '优先种草' | '继续观察' | '暂缓'
            }>
          >
          trends: (payload?: {
            snapshotDate?: string
            keyword?: string
            days?: number
            limit?: number
          }) => Promise<{
            dates: string[]
            series: Array<{
              keyword: string
              values: number[]
              max: number
              min: number
              volatility: number
            }>
          }>
          productDetail: (payload: { snapshotDate: string; productKey: string }) => Promise<{
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
          markedProducts: (payload?: { snapshotDate?: string; keyword?: string }) => Promise<
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
          >
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
      ai: {
        route: {
          resolve: (payload: { capability: AiCapability }) => Promise<{
            providerId: string
            providerName: string
            capability: AiCapability
            baseUrl: string
            apiKey: string
            modelId: string
            modelName: string
            endpointPath: string
            protocol: 'openai' | 'google-genai' | 'vendor-custom'
          }>
        }
        task: {
          run: (payload: {
            capability: AiCapability
            input: unknown
            context?: Record<string, unknown>
          }) => Promise<{
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
          }>
        }
      }
      aiStudio: {
        provider: {
          testConnection: (payload?: {
            provider?: string
            baseUrl?: string
            apiKey?: string
            defaultImageModel?: string
            endpointPath?: string
          }) => Promise<{
            success: boolean
            provider: string
            baseUrl: string
            model: string
            endpointPath: string
            checkedAt: number
            statusCode: number | null
            message: string
          }>
        }
        template: {
          list: (payload?: { capability?: 'image' | 'video' }) => Promise<AiStudioTemplateRecord[]>
          upsert: (payload: {
            id?: string
            provider?: string
            capability?: 'image' | 'video'
            name: string
            promptText?: string
            config?: Record<string, unknown>
          }) => Promise<AiStudioTemplateRecord>
          delete: (payload: { templateId: string }) => Promise<{ success: boolean }>
        }
        task: {
          importFolders: (payload?: { folderPaths?: string[] }) => Promise<AiStudioImportedFolder[]>
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
          }) => Promise<AiStudioTaskRecord>
          list: (payload?: {
            status?: string
            ids?: string[]
            limit?: number
          }) => Promise<AiStudioTaskRecord[]>
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
          }) => Promise<AiStudioTaskRecord>
          delete: (payload: { taskId: string } | string) => Promise<{ success: boolean }>
          ensureRunDirectory: (payload: { taskId: string; runIndex?: number }) => Promise<{
            taskId: string
            runIndex: number
            dirPath: string
          }>
          ensureProjectDirectory: (payload: {
            projectId: string
            projectName?: string
            preferredPath?: string
          }) => Promise<{
            projectId: string
            dirPath: string
          }>
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
          }) => Promise<AiStudioRunRecord>
          updateBilledState: (payload: {
            taskId: string
            billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
            priceMinSnapshot?: number | null
            priceMaxSnapshot?: number | null
            runId?: string | null
            remoteTaskId?: string | null
          }) => Promise<AiStudioTaskRecord>
          startRun: (payload: { taskId: string }) => Promise<{
            task: AiStudioTaskRecord
            run: AiStudioRunRecord
            outputs: AiStudioAssetRecord[]
            completed: boolean
            status: string
            remoteTaskId: string | null
            billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
            priceMinSnapshot: number | null
            priceMaxSnapshot: number | null
          }>
          pollRun: (payload: { taskId: string; runId?: string | null }) => Promise<{
            task: AiStudioTaskRecord
            run: AiStudioRunRecord
            outputs: AiStudioAssetRecord[]
            completed: boolean
            status: string
            remoteTaskId: string | null
            billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
            priceMinSnapshot: number | null
            priceMaxSnapshot: number | null
          }>
          retryRun: (payload: { taskId: string }) => Promise<{
            task: AiStudioTaskRecord
            run: AiStudioRunRecord
            outputs: AiStudioAssetRecord[]
            completed: boolean
            status: string
            remoteTaskId: string | null
            billedState: 'unbilled' | 'billable' | 'not_billable' | 'settled'
            priceMinSnapshot: number | null
            priceMaxSnapshot: number | null
          }>
        }
        run: {
          get: (payload: { runId: string }) => Promise<AiStudioRunRecord | null>
        }
        asset: {
          list: (payload?: {
            taskId?: string
            runId?: string
            kind?: 'input' | 'output'
            ids?: string[]
          }) => Promise<AiStudioAssetRecord[]>
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
          ) => Promise<AiStudioAssetRecord[]>
          markSelected: (payload: {
            taskId: string
            assetIds: string[]
            selected?: boolean
            clearOthers?: boolean
          }) => Promise<AiStudioAssetRecord[]>
        }
      }
      noteRace: {
        importAutoFile: (payload?: { filePath?: string }) => Promise<NoteRaceImportResult | null>
        importAutoFiles: (payload?: {
          filePath?: string
          filePaths?: string[]
        }) => Promise<NoteRaceAutoImportBatchResult | null>
        importCommerceFile: (payload?: {
          filePath?: string
        }) => Promise<NoteRaceImportResult | null>
        importContentFile: (payload?: { filePath?: string }) => Promise<NoteRaceImportResult | null>
        scanFolderImports: (payload: {
          dirPath: string
          sinceMs?: number
        }) => Promise<NoteRaceScanFolderResult>
        meta: () => Promise<NoteRaceMeta>
        snapshotStats: () => Promise<NoteRaceSnapshotStat[]>
        snapshotBatchStats: (payload?: {
          snapshotDate?: string
          includeDeleted?: boolean
        }) => Promise<NoteRaceSnapshotBatchStat[]>
        deleteSnapshot: (payload: { snapshotDate: string }) => Promise<NoteRaceDeleteSnapshotResult>
        deleteSnapshotBatch: (payload: {
          snapshotDate: string
          importedAt: number
          reason?: string
        }) => Promise<NoteRaceDeleteBatchResult>
        restoreSnapshotBatch: (payload: {
          snapshotDate: string
          importedAt: number
        }) => Promise<NoteRaceRestoreBatchResult>
        resetAll: () => Promise<NoteRaceResetResult>
        list: (payload?: {
          snapshotDate?: string
          account?: string
          noteType?: '全部' | '图文' | '视频'
          limit?: number
        }) => Promise<NoteRaceListRow[]>
        detail: (payload: {
          snapshotDate?: string
          noteKey?: string
        }) => Promise<NoteRaceDetail | null>
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
            linkedProducts?: CmsLinkedProductRecord[]
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
        ) => Promise<CmsPublishTask[]>
        list: (accountId: string) => Promise<CmsPublishTask[]>
        updateBatch(
          ids: string[],
          updates: {
            title?: string
            content?: string
            images?: string[]
            videoCoverMode?: 'auto' | 'manual'
            productId?: string
            productName?: string
            linkedProducts?: CmsLinkedProductRecord[]
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
              videoCoverMode?: 'auto' | 'manual'
              productId?: string
              productName?: string
              linkedProducts?: CmsLinkedProductRecord[]
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
        deleteByRemixSession: (
          sessionId: string,
          accountId?: string
        ) => Promise<{ deleted: number; deletedIds: string[] }>
        deleteBatch: (ids: string[]) => Promise<{ deleted: number; deletedIds: string[] }>
        delete: (taskId: string) => Promise<{ success: boolean }>
        updateStatus: (
          taskId: string,
          status: CmsPublishTaskStatus
        ) => Promise<CmsPublishTask | null>
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
    openMediaFilePaths: (payload?: {
      multiSelections?: boolean
      accept?: 'image' | 'video' | 'all'
    }) => Promise<string[] | string | null>
    openAudioFile: () => Promise<string | null>
    prepareVideoPreview: (filePath: string) => Promise<PrepareVideoPreviewResult>
    captureVideoFrame: (filePath: string, timeSec?: number) => Promise<string>
    composeVideoFromImages: (payload: {
      sourceImages: string[]
      template: VideoStyleTemplate
      bgmPath?: string
      outputPath?: string
      seed?: number
      batchIndex?: number
      batchTotal?: number
    }) => Promise<ComposeVideoFromImagesResult>
    composeVideoBatchFromImages: (payload: {
      sourceRootPath?: string
      sourceImages?: string[]
      sourceVideos?: string[]
      template: VideoStyleTemplate
      batchCount: number
      bgmMode?: 'none' | 'fixed' | 'random'
      bgmPath?: string
      bgmOptions?: string[]
      seedBase?: number
      lowLoadMode?: boolean
      renderMode?: 'low' | 'hd'
      outputAspect?: '9:16' | '3:4'
    }) => Promise<ComposeVideoBatchFromImagesResult>
    onComposeVideoProgress: (listener: (payload: ComposeVideoProgressPayload) => void) => () => void
    syncDouyinHotMusic: (payload?: {
      outputDir?: string
      limit?: number
    }) => Promise<SyncDouyinHotMusicResult>
    listDouyinHotMusicTracks: (payload?: {
      outputDir?: string
    }) => Promise<ListDouyinHotMusicResult>
    getReleaseMeta: () => Promise<AppReleaseMeta>
    getAppUpdateState: () => Promise<AppUpdateState>
    checkAppUpdate: () => Promise<AppUpdateState>
    installAppUpdateNow: () => Promise<InstallUpdateResult>
    onAppUpdateStatus: (listener: (state: AppUpdateState) => void) => () => void
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
    scanDirectoryRecursive: (folderPath: string) => Promise<string[]>
    scanMediaDirectoryRecursive: (folderPath: string) => Promise<string[]>
    getPathForFile: (file: File) => string
    getWorkspacePath: () => Promise<{ path: string; status: 'initialized' | 'uninitialized' }>
    pickWorkspacePath: () => Promise<string | null>
    setWorkspacePath: (path: string) => Promise<{ path: string }>
    relaunch: () => Promise<{ success: true }>
    getConfig: () => Promise<{
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
      watermarkBox: WatermarkBox
      defaultStartTime: string
      defaultInterval: number
    }>
    saveConfig: (patch: {
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
      watermarkBox?: WatermarkBox
      defaultStartTime?: string
      defaultInterval?: number
    }) => Promise<{ success: true }>
    getStorageMaintenanceState: () => Promise<StorageMaintenanceState>
    runStorageMaintenanceNow: (payload?: {
      reason?: string
      dryRun?: boolean
    }) => Promise<StorageMaintenanceSummary>
    rollbackStorageMaintenance: (
      runId: string
    ) => Promise<{ success: boolean; restored: number; errors: string[] }>
    getFeishuConfig: () => Promise<{
      appId: string
      appSecret: string
      baseToken: string
      tableId: string
    } | null>
    uploadImage: (
      filePath: string,
      appId: string,
      appSecret: string,
      baseToken: string
    ) => Promise<string>
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
    processGridSplit: (payload: {
      sourceFiles: string[]
      rows: number
      cols: number
    }) => Promise<string[]>
    processHdUpscale: (payload: { files: string[]; exePath: string }) => Promise<string[]>
    processWatermark: (payload: {
      files: string[]
      pythonPath: string
      scriptPath: string
      watermarkBox: WatermarkBox
    }) => Promise<string[]>
    onProcessLog: (
      listener: (payload: {
        level: 'stdout' | 'stderr' | 'info' | 'error'
        message: string
        timestamp: number
      }) => void
    ) => () => void
    deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
    shellShowItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
    shellOpenPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
    exportFiles: (
      filePaths: string[]
    ) => Promise<
      | { success: true; copied: number; destinationDir: string }
      | { success: false; error: string }
      | null
    >
  }

  interface Window {
    electron: ElectronAPI
    api: SuperCmsApi
    electronAPI: SuperCmsElectronAPI
  }
}
