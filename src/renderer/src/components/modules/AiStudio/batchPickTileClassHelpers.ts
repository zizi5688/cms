type BatchPickTileState = {
  isSelected: boolean
  isUsed: boolean
}

function joinClassNames(values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export const BATCH_PICK_TILE_MEDIA_CLASS =
  'pointer-events-none block aspect-[4/5] w-full bg-zinc-100 object-cover'

export const BATCH_PICK_TILE_EMPTY_STATE_CLASS = 'pointer-events-none aspect-[4/5] w-full bg-zinc-100'

export function resolveBatchPickTileOverlayClass({
  isSelected,
  isUsed
}: BatchPickTileState): string {
  return joinClassNames([
    'pointer-events-none absolute inset-0 rounded-[8px] bg-gradient-to-t from-black/44 via-transparent to-transparent transition',
    isSelected
      ? 'bg-gradient-to-t from-sky-500/14 via-transparent to-transparent ring-[2.5px] ring-inset ring-sky-400/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.82)]'
      : isUsed
        ? 'bg-gradient-to-t from-black/54 via-black/6 to-transparent'
        : 'bg-gradient-to-t from-black/32 via-transparent to-transparent'
  ])
}

export function resolveBatchPickTileSelectionIndicatorClass(isSelected: boolean): string {
  return joinClassNames([
    'pointer-events-none absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-[rgba(255,255,255,0.06)] shadow-[0_6px_18px_rgba(15,23,42,0.10)] backdrop-blur-[8px] transition',
    isSelected ? 'text-white' : 'text-transparent group-hover:text-white/80'
  ])
}

export const BATCH_PICK_TILE_USED_BADGE_CLASS =
  'pointer-events-none absolute bottom-2 left-2 inline-flex items-center rounded-full border border-white bg-[rgba(15,23,42,0.18)] px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-white shadow-[0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[10px]'
