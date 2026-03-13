type PoolDispatchAction = 'workshop' | 'remix'
type PoolDispatchCapability = 'image' | 'video'

type PoolDispatchAsset = {
  filePath?: string | null
  role?: string | null
}

export type PoolDispatchPlan = {
  target: 'workshop' | 'material-video'
  mediaType: 'image' | 'video'
  clearSelection: boolean
  paths: string[]
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )
  )
}

function isVideoAsset(asset: PoolDispatchAsset): boolean {
  if (String(asset.role ?? '').trim() === 'video-output') return true
  return /\.(mp4|mov|webm|m4v)(?:$|[?#])/i.test(String(asset.filePath ?? '').trim())
}

function resolveEmptyPoolMessage(capability: PoolDispatchCapability): string {
  return capability === 'video'
    ? '请先添加至少一个视频到素材池。'
    : '请先添加至少一张图片到素材池。'
}

export function canStartPoolRemix(assets: PoolDispatchAsset[]): boolean {
  if (assets.length === 0) return false
  return assets.every((asset) => !isVideoAsset(asset) && String(asset.filePath ?? '').trim().length > 0)
}

export function resolvePoolSendButtonText(): string {
  return '发送素材池'
}

export function buildPoolDispatchPlan(input: {
  action: PoolDispatchAction
  studioCapability: PoolDispatchCapability
  assets: PoolDispatchAsset[]
}): PoolDispatchPlan {
  const paths = uniqueStrings(input.assets.map((asset) => asset.filePath))
  if (paths.length === 0) {
    throw new Error(resolveEmptyPoolMessage(input.studioCapability))
  }

  const containsVideo = input.assets.some((asset) => isVideoAsset(asset))
  if (input.action === 'remix') {
    if (containsVideo) {
      throw new Error('开始混剪仅支持图片素材池。')
    }

    return {
      target: 'material-video',
      mediaType: 'image',
      clearSelection: false,
      paths
    }
  }

  return {
    target: 'workshop',
    mediaType: containsVideo ? 'video' : 'image',
    clearSelection: true,
    paths
  }
}
