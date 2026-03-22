import { extname } from 'path'

import {
  normalizeLinkedProducts,
  type LinkedTaskProduct
} from './taskLinkedProductsHelpers.ts'

export type NormalizedCreateBatchTaskPayload = {
  accountId: string
  images: string[]
  imagePath: string
  title: string
  content: string
  tags?: string[]
  productId?: string
  productName?: string
  linkedProducts?: LinkedTaskProduct[]
  publishMode: 'immediate'
  transformPolicy: 'none' | 'remix_v1'
  remixSessionId?: string
  remixSourceTaskIds?: string[]
  remixSeed?: string
  mediaType: 'image' | 'video'
  videoPath?: string
  videoPreviewPath?: string
  videoCoverMode?: 'auto' | 'manual'
  isRemix: boolean
  videoClips?: string[]
  durationReferenceClips?: string[]
  targetDurationSec?: number
  bgmPath?: string
  remixTitleSourceTaskId?: string
  remixContentSourceTaskId?: string
}

function uniqueTrimmedStringList(value: unknown): string[] | undefined {
  const list = Array.isArray(value) ? value : []
  const normalized = Array.from(
    new Set(
      list
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
  return normalized.length > 0 ? normalized : undefined
}

function normalizeVideoCoverMode(value: unknown): 'auto' | 'manual' {
  return value === 'auto' ? 'auto' : 'manual'
}

export function normalizeCreateBatchTaskPayload(task: unknown): NormalizedCreateBatchTaskPayload {
  const record = (task ?? {}) as Record<string, unknown>
  let images =
    Array.isArray(record.images) && record.images.length > 0
      ? record.images.filter((path): path is string => typeof path === 'string')
      : []
  const tags =
    Array.isArray(record.tags) && record.tags.length > 0
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined
  const explicitVideoPath = typeof record.videoPath === 'string' ? record.videoPath : ''
  let inferredVideoPath = ''
  if (!explicitVideoPath) {
    const index = images.findIndex((path) => {
      const ext = extname(String(path ?? '')).toLowerCase()
      return ext === '.mp4' || ext === '.mov'
    })
    if (index >= 0) {
      inferredVideoPath = images[index] ?? ''
      images = images.filter((_path, imageIndex) => imageIndex !== index)
    }
  }
  const videoPath = (explicitVideoPath || inferredVideoPath).trim()
  const isRemix = record.isRemix === true
  const videoClips = uniqueTrimmedStringList(record.videoClips)
  const durationReferenceClips = uniqueTrimmedStringList(record.durationReferenceClips)
  const targetDurationSecRaw = Number(record.targetDurationSec)
  const targetDurationSec =
    Number.isFinite(targetDurationSecRaw) && targetDurationSecRaw > 0
      ? targetDurationSecRaw
      : undefined
  const bgmPath = typeof record.bgmPath === 'string' ? record.bgmPath.trim() : ''
  const remixTitleSourceTaskId =
    typeof record.remixTitleSourceTaskId === 'string' ? record.remixTitleSourceTaskId.trim() : ''
  const remixContentSourceTaskId =
    typeof record.remixContentSourceTaskId === 'string'
      ? record.remixContentSourceTaskId.trim()
      : ''
  const mediaType =
    record.mediaType === 'video' || Boolean(videoPath) || Boolean(videoClips && videoClips.length > 0)
      ? 'video'
      : 'image'
  const transformPolicy = record.transformPolicy === 'remix_v1' ? 'remix_v1' : 'none'
  const remixSessionId = typeof record.remixSessionId === 'string' ? record.remixSessionId.trim() : ''
  const remixSourceTaskIds = uniqueTrimmedStringList(record.remixSourceTaskIds)
  const remixSeed =
    typeof record.remixSeed === 'string'
      ? record.remixSeed.trim()
      : Number.isFinite(record.remixSeed)
        ? String(Math.floor(record.remixSeed as number))
        : ''
  const linkedProducts = normalizeLinkedProducts(record.linkedProducts)

  return {
    accountId: typeof record.accountId === 'string' ? record.accountId : '',
    images,
    imagePath: typeof record.imagePath === 'string' ? record.imagePath : '',
    title: typeof record.title === 'string' ? record.title : '',
    content: typeof record.content === 'string' ? record.content : '',
    tags,
    productId: typeof record.productId === 'string' ? record.productId : undefined,
    productName: typeof record.productName === 'string' ? record.productName : undefined,
    linkedProducts: linkedProducts.length > 0 ? linkedProducts : undefined,
    publishMode: 'immediate',
    transformPolicy,
    remixSessionId: remixSessionId || undefined,
    remixSourceTaskIds,
    remixSeed: remixSeed || undefined,
    mediaType,
    videoPath: videoPath || undefined,
    videoPreviewPath: typeof record.videoPreviewPath === 'string' ? record.videoPreviewPath : undefined,
    videoCoverMode: mediaType === 'video' ? normalizeVideoCoverMode(record.videoCoverMode) : undefined,
    isRemix,
    videoClips,
    durationReferenceClips,
    targetDurationSec,
    bgmPath: bgmPath || undefined,
    remixTitleSourceTaskId: remixTitleSourceTaskId || undefined,
    remixContentSourceTaskId: remixContentSourceTaskId || undefined
  }
}
