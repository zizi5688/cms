export type PreviewSurfaceKind = 'image' | 'video'
export type PreviewSurfaceState = 'ready' | 'loading' | 'failed' | 'idle'

type PreviewTileSurfaceClassNames = {
  shellClassName: string
  loadingInnerClassName: string
  readyBodyClassName: string
  failedBodyClassName: string
  idleBodyClassName: string
}

export function resolvePreviewTileSurfaceClassNames(
  kind: PreviewSurfaceKind,
  _state: PreviewSurfaceState
): PreviewTileSurfaceClassNames {
  const shellClassName =
    'relative overflow-hidden rounded-[28px] border border-zinc-200 bg-transparent transition'

  return {
    shellClassName,
    loadingInnerClassName: 'h-full w-full rounded-[27px] bg-transparent',
    readyBodyClassName:
      kind === 'image'
        ? 'aspect-[3/4] overflow-hidden bg-transparent'
        : 'relative aspect-[9/16] overflow-hidden bg-black',
    failedBodyClassName:
      kind === 'image'
        ? 'relative aspect-[3/4] bg-transparent'
        : 'relative aspect-[9/16] bg-transparent',
    idleBodyClassName:
      kind === 'image'
        ? 'aspect-[3/4] bg-transparent'
        : 'relative aspect-[9/16] bg-transparent'
  }
}
