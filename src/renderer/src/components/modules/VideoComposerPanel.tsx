import { useEffect, useState } from 'react'
import type * as React from 'react'

import { Download, FolderOpen, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { useCmsStore } from '@renderer/store/useCmsStore'
import {
  VIDEO_COMPOSER_RANDOM_BGM_VALUE,
  fileNameFromPath,
  fileUrlFromPath,
  useVideoComposerController
} from './useVideoComposerController'

function VideoComposerPanel(): React.JSX.Element {
  const addLog = useCmsStore((s) => s.addLog)
  const setWorkshopImport = useCmsStore((s) => s.setWorkshopImport)
  const setActiveModule = useCmsStore((s) => s.setActiveModule)
  const {
    sourceImages,
    sourceVideos,
    sourceRootPath,
    sourceMediaCount,
    template,
    templateSavedAt,
    batchCount,
    outputAspect,
    generateProgressPercent,
    generateProgressText,
    isGenerating,
    isScanningRoot,
    isSyncingHotMusic,
    isLoadingBgmList,
    bgmOptions,
    hotMusicOutputDir,
    hotMusicSummary,
    error,
    canGenerate,
    normalizedMin,
    normalizedMax,
    outputSizeLabel,
    selectedBgmValue,
    setTemplate,
    setBatchCount,
    setOutputAspect,
    setBgmSelectionValue,
    updateTemplateNumber,
    handleSaveTemplate,
    handleLoadTemplate,
    handleResetTemplate,
    handleSyncHotMusic,
    loadHotMusicBgmOptions,
    handlePickMediaFolder,
    handlePickMediaFiles,
    clearSources,
    resetComposer,
    startGenerate
  } = useVideoComposerController({
    logPrefix: '[视频处理]',
    listenMaterialImport: true
  })

  const [generatedVideos, setGeneratedVideos] = useState<string[]>([])
  const [selectedGeneratedVideos, setSelectedGeneratedVideos] = useState<Set<string>>(() => new Set())
  const [videoAspectRatioMap, setVideoAspectRatioMap] = useState<Record<string, number>>({})
  const isRandomBgmMode = selectedBgmValue === VIDEO_COMPOSER_RANDOM_BGM_VALUE
  const selectedGeneratedCount = selectedGeneratedVideos.size
  const hasSelectedGenerated = selectedGeneratedCount > 0
  const isAllGeneratedSelected = generatedVideos.length > 0 && selectedGeneratedVideos.size === generatedVideos.length

  const resetVideoComposerToInitial = (): void => {
    resetComposer()
    setGeneratedVideos([])
    setSelectedGeneratedVideos(new Set())
    setVideoAspectRatioMap({})
  }

  const revealInFolder = async (filePath: string): Promise<void> => {
    const normalized = String(filePath ?? '').trim()
    if (!normalized) return
    const result = await window.electronAPI.shellShowItemInFolder(normalized)
    if (!result?.success) {
      addLog(`[视频处理] 打开文件夹失败：${result?.error ?? '未知错误'}`)
    }
  }

  const handleSendSelectedToWorkshop = (): void => {
    const selectedPaths = generatedVideos.filter((item) => selectedGeneratedVideos.has(item))
    if (selectedPaths.length === 0) return
    const firstPath = selectedPaths[0]
    setWorkshopImport('video', firstPath, null, selectedPaths)
    setActiveModule('workshop')
    addLog(`[视频处理] 已将 ${selectedPaths.length} 条视频导入数据工坊。`)
    resetVideoComposerToInitial()
  }

  const toggleSelectAllGenerated = (): void => {
    setSelectedGeneratedVideos((prev) => {
      if (generatedVideos.length === 0) return prev
      if (prev.size === generatedVideos.length) return new Set()
      return new Set(generatedVideos)
    })
  }

  const toggleSelectGenerated = (videoPath: string): void => {
    setSelectedGeneratedVideos((prev) => {
      const next = new Set(prev)
      if (next.has(videoPath)) {
        next.delete(videoPath)
      } else {
        next.add(videoPath)
      }
      return next
    })
  }

  useEffect(() => {
    setSelectedGeneratedVideos((prev) => {
      const next = new Set(generatedVideos.filter((item) => prev.has(item)))
      return next.size === prev.size ? prev : next
    })
  }, [generatedVideos])

  useEffect(() => {
    setVideoAspectRatioMap((prev) => {
      const next: Record<string, number> = {}
      let changed = false
      for (const path of generatedVideos) {
        const ratio = prev[path]
        if (Number.isFinite(ratio) && ratio > 0) {
          next[path] = ratio
          continue
        }
        changed = true
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev
      return next
    })
  }, [generatedVideos])

  const handleVideoMetadataLoaded = (videoPath: string, event: React.SyntheticEvent<HTMLVideoElement>): void => {
    const element = event.currentTarget
    const width = Number(element.videoWidth)
    const height = Number(element.videoHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const ratio = width / height
    setVideoAspectRatioMap((prev) => {
      const current = Number(prev[videoPath])
      if (Number.isFinite(current) && Math.abs(current - ratio) < 0.001) return prev
      return { ...prev, [videoPath]: ratio }
    })
  }

  const handleGenerate = async (): Promise<void> => {
    const result = await startGenerate()
    if (!result || result.outputs.length === 0) return
    setGeneratedVideos((prev) => [...result.outputs.slice().reverse(), ...prev].slice(0, 80))
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-6 overflow-hidden xl:flex-row"
      data-template-saved-at={templateSavedAt}
      data-hot-music-summary={hotMusicSummary}
      data-output-size-label={outputSizeLabel}
    >
      <div className="min-h-0 xl:basis-[45%] xl:min-w-[500px] xl:shrink-0">
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/15 px-3 py-3">
          <section className="border-b border-zinc-800 pb-3">
            <div className="mb-2 text-sm font-medium text-zinc-100">视频处理</div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={() => void handlePickMediaFolder()} disabled={isGenerating || isScanningRoot}>
                {isScanningRoot ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    扫描中
                  </span>
                ) : (
                  '选择文件夹'
                )}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void handlePickMediaFiles()} disabled={isGenerating || isScanningRoot}>
                选择文件
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearSources}
                disabled={isGenerating || isScanningRoot || sourceMediaCount === 0}
              >
                清空
              </Button>
              {sourceRootPath ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void revealInFolder(sourceRootPath)}
                  aria-label="打开图片目录"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
              <div className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                {sourceRootPath
                  ? `${sourceRootPath} · 图片 ${sourceImages.length} 张 / 视频 ${sourceVideos.length} 条`
                  : sourceMediaCount > 0
                    ? `已选择文件 · 图片 ${sourceImages.length} 张 / 视频 ${sourceVideos.length} 条`
                    : '未选择素材'}
              </div>
            </div>
            {error ? <div className="mt-2 text-sm text-rose-300">{error}</div> : null}
          </section>

          <section className="border-b border-zinc-800 pb-3">
            <div className="mb-2 text-sm font-medium text-zinc-100">模板参数</div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={handleSaveTemplate} disabled={isGenerating || isScanningRoot}>
                保存模板
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleLoadTemplate} disabled={isGenerating || isScanningRoot}>
                加载模板
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleResetTemplate} disabled={isGenerating || isScanningRoot}>
                恢复默认
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">模板名称</div>
                <Input
                  className="h-8 px-2 text-xs"
                  value={template.name ?? ''}
                  onChange={(e) => setTemplate((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">总时长（秒）</div>
                <Input
                  className="h-8 px-2 text-xs"
                  value={template.totalDurationSec}
                  onChange={(e) => updateTemplateNumber('totalDurationSec', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">图片最小数</div>
                <Input
                  className="h-8 px-2 text-xs"
                  value={template.imageCountMin}
                  onChange={(e) => updateTemplateNumber('imageCountMin', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs text-zinc-400">图片最大数</div>
                <Input
                  className="h-8 px-2 text-xs"
                  value={template.imageCountMax}
                  onChange={(e) => updateTemplateNumber('imageCountMax', e.target.value)}
                />
              </div>
            </div>

            <details className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
              <summary className="cursor-pointer text-xs font-medium text-zinc-200">⚙️ 高级渲染设置</summary>
              <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">宽度</div>
                  <Input className="h-8 px-2 text-xs" value={template.width} onChange={(e) => updateTemplateNumber('width', e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">高度</div>
                  <Input className="h-8 px-2 text-xs" value={template.height} onChange={(e) => updateTemplateNumber('height', e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">FPS</div>
                  <Input className="h-8 px-2 text-xs" value={template.fps} onChange={(e) => updateTemplateNumber('fps', e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">转场</div>
                  <select
                    value={template.transitionType}
                    onChange={(e) =>
                      setTemplate((prev) => ({
                        ...prev,
                        transitionType: e.target.value as VideoTemplateTransition
                      }))
                    }
                    className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                  >
                    <option value="none">none</option>
                    <option value="fade">fade</option>
                    <option value="slideleft">slideleft</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">转场时长（秒）</div>
                  <Input
                    className="h-8 px-2 text-xs"
                    value={template.transitionDurationSec}
                    onChange={(e) => updateTemplateNumber('transitionDurationSec', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">BGM 音量（0-2）</div>
                  <Input className="h-8 px-2 text-xs" value={template.bgmVolume} onChange={(e) => updateTemplateNumber('bgmVolume', e.target.value)} />
                </div>
              </div>

              <details className="mt-2 rounded-md border border-zinc-800 bg-black/40 p-2">
                <summary className="inline-flex cursor-pointer items-center rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-800">
                  查看模板 JSON
                </summary>
                <pre className="mt-2 overflow-auto rounded-md bg-black p-2 text-xs text-emerald-300">
                  {JSON.stringify(
                    {
                      ...template,
                      imageCountMin: normalizedMin,
                      imageCountMax: normalizedMax,
                      sourceRootPath,
                      sourceImageCount: sourceImages.length,
                      sourceVideoCount: sourceVideos.length,
                      sourceMediaCount
                    },
                    null,
                    2
                  )}
                </pre>
              </details>
            </details>
          </section>

          <section className="mt-auto flex flex-col gap-2">
            <div className="text-sm font-medium text-zinc-100">生成控制</div>
            <div className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <select
                value={selectedBgmValue}
                onChange={(event) => setBgmSelectionValue(event.target.value)}
                disabled={isGenerating || isSyncingHotMusic || isLoadingBgmList || bgmOptions.length === 0}
                className="h-8 min-w-[200px] flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
              >
                {bgmOptions.length === 0 ? (
                  <option value="">暂无可用音乐</option>
                ) : (
                  <option value={VIDEO_COMPOSER_RANDOM_BGM_VALUE}>随机一首背景音乐</option>
                )}
                {bgmOptions.map((filePath) => (
                  <option key={filePath} value={filePath}>
                    {fileNameFromPath(filePath)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={() => void handleSyncHotMusic()}
                disabled={isGenerating || isSyncingHotMusic}
              >
                {isSyncingHotMusic ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    刷新中
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Download className="h-3.5 w-3.5" />
                    一键刷新
                  </span>
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={() => void loadHotMusicBgmOptions(hotMusicOutputDir)}
                disabled={isGenerating || isSyncingHotMusic || isLoadingBgmList}
              >
                {isLoadingBgmList ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    刷新中
                  </span>
                ) : (
                  '本地列表'
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-xs"
                onClick={() => setBgmSelectionValue(VIDEO_COMPOSER_RANDOM_BGM_VALUE)}
                disabled={isGenerating || bgmOptions.length === 0 || isRandomBgmMode}
              >
                设为随机
              </Button>
              {selectedBgmValue && selectedBgmValue !== VIDEO_COMPOSER_RANDOM_BGM_VALUE ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void revealInFolder(selectedBgmValue)}
                  aria-label="打开 BGM 所在目录"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
              {hotMusicOutputDir ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void revealInFolder(hotMusicOutputDir)}
                  aria-label="打开音乐榜下载目录"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              ) : null}
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">本次生成数量</div>
                  <Input className="h-8 px-2 text-xs" value={batchCount} onChange={(e) => setBatchCount(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-400">输出尺寸比例</div>
                  <select
                    value={outputAspect}
                    onChange={(event) => setOutputAspect(event.target.value as '9:16' | '3:4')}
                    disabled={isGenerating}
                    className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                  >
                    <option value="9:16">9:16（1080x1920）</option>
                    <option value="3:4">3:4（1080x1440）</option>
                  </select>
                </div>
              </div>

              <div className="mt-auto rounded-xl border border-yellow-500/35 bg-gradient-to-b from-[#3a2f0b]/85 via-[#1d190f]/95 to-[#111111] p-5 shadow-[0_0_24px_rgba(250,204,21,0.18)]">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-yellow-500/75">PRIMARY ACTION</div>
                <Button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={!canGenerate}
                  aria-busy={isGenerating}
                  className="h-auto w-full rounded-sm bg-[#FACC15] py-3 text-black font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 disabled:opacity-100"
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      生成中...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      开始随机生成
                    </span>
                  )}
                </Button>
                <div className="mt-3 rounded-sm border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs leading-relaxed text-zinc-400">
                  抽样规则：图片单张时长随机，视频按整段参与；总时长严格对齐（输出：{outputSizeLabel}）。
                </div>
              </div>

              {isGenerating ? (
                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded bg-zinc-800">
                    <div
                      className="h-full bg-emerald-400 transition-all duration-150"
                      style={{ width: `${generateProgressPercent}%` }}
                    />
                  </div>
                  <div className="text-xs text-zinc-400">
                    {generateProgressText || `总进度：${generateProgressPercent}%`}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <div className="min-h-0 xl:min-w-0 xl:basis-[55%] xl:flex-1">
        <Card className="flex h-full min-h-0 flex-col">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>输出结果</CardTitle>
              <CardDescription>最新生成的视频会显示在这里，可直接定位文件。</CardDescription>
            </div>
            {generatedVideos.length > 0 ? (
              <div
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                  hasSelectedGenerated
                    ? 'border-amber-300/50 bg-amber-300/15 shadow-[0_10px_30px_rgba(245,158,11,0.22)]'
                    : 'border-zinc-700 bg-zinc-950/60'
                }`}
              >
                <label className={`flex items-center gap-2 text-xs ${hasSelectedGenerated ? 'text-amber-100' : 'text-zinc-300'}`}>
                  <input
                    type="checkbox"
                    checked={isAllGeneratedSelected}
                    onChange={toggleSelectAllGenerated}
                  />
                  全选（{selectedGeneratedCount}/{generatedVideos.length}）
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedGeneratedVideos(new Set())}
                  disabled={!hasSelectedGenerated}
                  className={hasSelectedGenerated ? 'border-amber-200/50 text-amber-50 hover:bg-amber-200/10' : ''}
                >
                  清空选择
                </Button>
                <Button
                  type="button"
                  onClick={handleSendSelectedToWorkshop}
                  disabled={!hasSelectedGenerated}
                  className={
                    hasSelectedGenerated
                      ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
                      : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-800'
                  }
                >
                  一键发送所选
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          {generatedVideos.length === 0 ? (
            <div className="text-sm text-zinc-400">暂无输出。</div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {generatedVideos.map((videoPath) => {
                  const resolvedAspect = videoAspectRatioMap[videoPath]
                  const fallbackAspect = outputAspect === '3:4' ? 3 / 4 : 9 / 16
                  const previewAspect = Number.isFinite(resolvedAspect) && resolvedAspect > 0 ? resolvedAspect : fallbackAspect
                  return (
                    <div key={videoPath} className="group w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
                      <div className="border-b border-zinc-800 bg-black" style={{ aspectRatio: `${previewAspect}` }}>
                        <video
                          className="h-full w-full object-contain"
                          src={fileUrlFromPath(videoPath)}
                          preload="metadata"
                          controls
                          muted
                          playsInline
                          onLoadedMetadata={(event) => handleVideoMetadataLoaded(videoPath, event)}
                        />
                      </div>
                      <div className="flex items-center gap-2 p-3">
                        <label className="flex shrink-0 items-center">
                          <input
                            type="checkbox"
                            checked={selectedGeneratedVideos.has(videoPath)}
                            onChange={() => toggleSelectGenerated(videoPath)}
                            className="h-4 w-4"
                          />
                          <span className="sr-only">选择视频</span>
                        </label>
                        <div className="min-w-0 flex-1 truncate text-center text-sm text-zinc-300">{fileNameFromPath(videoPath)}</div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 shrink-0 rounded-full border-zinc-700 bg-zinc-900/90"
                          onClick={() => void revealInFolder(videoPath)}
                          aria-label={`打开文件夹：${fileNameFromPath(videoPath)}`}
                        >
                          <FolderOpen className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}

export { VideoComposerPanel }
