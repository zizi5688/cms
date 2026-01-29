import { Button } from '@renderer/components/ui/button'

function App(): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="text-lg font-semibold">启动成功</div>
        <div className="mt-1 text-sm text-zinc-400">
          已完成 Electron + React + Tailwind + shadcn/ui 的项目骨架。
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button type="button">进入配置中心</Button>
          <Button type="button" variant="outline">
            查看上传管理
          </Button>
        </div>
      </div>
    </div>
  )
}

export default App
