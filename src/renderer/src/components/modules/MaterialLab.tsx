import type * as React from 'react'

import { Beaker } from 'lucide-react'

function MaterialLab(): React.JSX.Element {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-400">
          <Beaker className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="mt-5 text-xl font-semibold text-zinc-100">素材处理实验室</div>
        <div className="mt-2 text-sm text-zinc-500">高级图片处理功能开发中...</div>
      </div>
    </div>
  )
}

export { MaterialLab }
