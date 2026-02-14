import * as React from 'react'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { cn } from '@renderer/lib/utils'

export interface SortableImageProps {
  id: string
  src: string
  index: number
  onRemove: () => void
  onClick?: () => void
}

function SortableImage({ id, src, index, onRemove, onClick }: SortableImageProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : undefined
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative h-20 w-20 touch-none select-none overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40',
        'cursor-grab active:cursor-grabbing',
        isDragging ? 'ring-2 ring-zinc-500' : null
      )}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      {index === 0 ? (
        <div className="absolute left-0 top-0 z-10 rounded-br bg-red-500 px-1.5 py-0.5 text-xs text-white">
          封面
        </div>
      ) : null}

      <button
        type="button"
        aria-label="移除图片"
        className={cn(
          'absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded bg-zinc-900/70 text-[11px] text-zinc-200',
          'opacity-0 transition-opacity group-hover:opacity-100',
          'hover:bg-red-500 hover:text-white'
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        X
      </button>

      <img src={src} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
    </div>
  )
}

export { SortableImage }
