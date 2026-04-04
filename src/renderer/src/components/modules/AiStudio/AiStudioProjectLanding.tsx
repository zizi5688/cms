import * as React from 'react'

import { ChevronLeft, ChevronRight, FolderOpen, Plus } from 'lucide-react'

import { resolveLocalImage } from '@renderer/lib/resolveLocalImage'
import { cn } from '@renderer/lib/utils'

import type { AiStudioProjectCardSummary } from './projectViewHelpers'

type AiStudioProjectLandingProps = {
  mode: 'recent' | 'all'
  projectCards: AiStudioProjectCardSummary[]
  newProjectName: string
  isCreatingProject: boolean
  isNamingNewProject: boolean
  workspacePath?: string
  onNewProjectNameChange: (value: string) => void
  onStartCreateProject: () => void
  onCancelCreateProject: () => void
  onCreateProject: () => void
  onOpenProject: (taskId: string) => void
  onRenameProject: (taskId: string, nextTitle: string) => void
  onToggleMode: (mode: 'recent' | 'all') => void
}

function ThumbnailTile({
  path,
  workspacePath,
  title
}: {
  path: string | null
  workspacePath?: string
  title: string
}): React.JSX.Element {
  const src = path ? resolveLocalImage(path, workspacePath) : ''

  if (!src) {
    return (
      <div className="relative overflow-hidden rounded-[12px] bg-[linear-gradient(180deg,rgba(244,244,245,0.92),rgba(238,238,240,0.8))]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.72),transparent_58%)]" />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[12px] bg-zinc-100">
      <img src={src} alt={title} className="h-full w-full object-cover" draggable={false} />
    </div>
  )
}

function ProjectPreview({
  title,
  thumbnailPaths,
  workspacePath
}: {
  title: string
  thumbnailPaths: string[]
  workspacePath?: string
}): React.JSX.Element {
  const slots = Array.from({ length: 4 }, (_, index) => thumbnailPaths[index] ?? null)

  return (
    <div className="grid aspect-[16/10] grid-cols-2 gap-2 rounded-[12px] bg-white/80 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
      {slots.map((path, index) => (
        <ThumbnailTile
          key={`${title}:${index}:${path ?? 'empty'}`}
          path={path}
          workspacePath={workspacePath}
          title={title}
        />
      ))}
    </div>
  )
}

function NewProjectCard({
  value,
  isCreatingProject,
  isNamingNewProject,
  onChange,
  onStartCreate,
  onCancelCreate,
  onCreate
}: {
  value: string
  isCreatingProject: boolean
  isNamingNewProject: boolean
  onChange: (value: string) => void
  onStartCreate: () => void
  onCancelCreate: () => void
  onCreate: () => void
}): React.JSX.Element {
  return (
    <div className="group relative overflow-hidden rounded-[12px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(250,250,249,0.9))] p-4 shadow-[0_16px_42px_rgba(24,24,27,0.07)]">
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-90" />
      <div className="flex h-full flex-col gap-5">
        <button
          type="button"
          onClick={onStartCreate}
          disabled={isCreatingProject}
          className="flex min-h-[190px] flex-1 flex-col items-center justify-center rounded-[10px] bg-[linear-gradient(180deg,rgba(243,243,243,0.96),rgba(237,237,238,0.88))] text-zinc-900 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_28px_rgba(24,24,27,0.08)] disabled:cursor-wait"
        >
          <Plus className="h-11 w-11 stroke-[1.6]" />
          <div className="mt-5 text-[16px] font-semibold tracking-[0.04em]">新建项目</div>
        </button>

        {isNamingNewProject ? (
          <div className="flex flex-col gap-3">
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onCreate()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelCreate()
                }
              }}
              placeholder="填写项目名"
              className="h-11 rounded-[12px] border border-zinc-200/80 bg-white/92 px-4 text-[15px] text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
              autoFocus
            />
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCancelCreate}
                disabled={isCreatingProject}
                className="inline-flex h-10 items-center justify-center rounded-[12px] border border-zinc-200 bg-white px-4 text-[14px] font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onCreate}
                disabled={isCreatingProject}
                className="inline-flex h-10 items-center justify-center rounded-[12px] bg-zinc-950 px-5 text-[14px] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
              >
                {isCreatingProject ? '创建中' : '创建'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ProjectCard({
  card,
  workspacePath,
  onOpen,
  onRename
}: {
  card: AiStudioProjectCardSummary
  workspacePath?: string
  onOpen: (taskId: string) => void
  onRename: (taskId: string, nextTitle: string) => void
}): React.JSX.Element {
  const [isEditingName, setIsEditingName] = React.useState(false)
  const [draftTitle, setDraftTitle] = React.useState(card.title)

  React.useEffect(() => {
    if (!isEditingName) {
      setDraftTitle(card.title)
    }
  }, [card.title, isEditingName])

  const commitRename = (): void => {
    const normalized = draftTitle.trim() || card.title
    setDraftTitle(normalized)
    setIsEditingName(false)
    if (normalized !== card.title) {
      onRename(card.taskId, normalized)
    }
  }

  return (
    <div className="group overflow-hidden rounded-[12px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(250,250,249,0.9))] p-4 text-left shadow-[0_16px_42px_rgba(24,24,27,0.07)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(24,24,27,0.1)]">
      <button type="button" onClick={() => onOpen(card.taskId)} className="block w-full text-left">
        <ProjectPreview
          title={card.title}
          thumbnailPaths={card.thumbnailPaths}
          workspacePath={workspacePath}
        />
      </button>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {isEditingName ? (
            <input
              value={draftTitle}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
                if (event.key === 'Escape') {
                  setDraftTitle(card.title)
                  setIsEditingName(false)
                }
              }}
              className="h-8 w-full rounded-[8px] border border-zinc-200/80 bg-white px-3 text-[15px] font-semibold tracking-[0.02em] text-zinc-900 outline-none focus:border-zinc-300"
            />
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setIsEditingName(true)
              }}
              className="block max-w-full truncate rounded-[6px] px-1 text-[15px] font-semibold tracking-[0.02em] text-zinc-900 transition hover:bg-zinc-100/80"
              title="点击改名"
            >
              {card.title}
            </button>
          )}
          <div className="mt-1.5 text-[12px] text-zinc-500">更新于 {card.updatedLabel}</div>
        </div>
        <button
          type="button"
          onClick={() => onOpen(card.taskId)}
          className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-100/90 px-2.5 py-1 text-[11px] text-zinc-500 transition hover:bg-zinc-200/80"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          {card.outputCount}
        </button>
      </div>
    </div>
  )
}

function AiStudioProjectLanding({
  mode,
  projectCards,
  newProjectName,
  isCreatingProject,
  isNamingNewProject,
  workspacePath,
  onNewProjectNameChange,
  onStartCreateProject,
  onCancelCreateProject,
  onCreateProject,
  onOpenProject,
  onRenameProject,
  onToggleMode
}: AiStudioProjectLandingProps): React.JSX.Element {
  const title = mode === 'all' ? '全部项目' : '最近项目'
  const gridProjects = mode === 'all' ? projectCards : projectCards.slice(0, 4)
  const hasProjects = gridProjects.length > 0

  return (
    <section className="relative min-h-[calc(100vh-3rem)] overflow-hidden rounded-[18px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,248,247,0.9))] px-6 py-6 text-zinc-950 shadow-[0_24px_90px_rgba(15,23,42,0.10)] sm:px-8 lg:px-10 lg:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),transparent_28%),radial-gradient(circle_at_85%_22%,rgba(239,239,236,0.8),transparent_32%)]" />
      <div className="pointer-events-none absolute -left-16 top-16 h-56 w-56 rounded-full bg-[rgba(255,255,255,0.45)] blur-3xl" />

      <div className="relative">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="text-[34px] font-semibold tracking-[-0.04em] text-zinc-950 sm:text-[38px]">
            {title}
          </div>

          {projectCards.length > 0 ? (
            <button
              type="button"
              onClick={() => onToggleMode(mode === 'all' ? 'recent' : 'all')}
              className="inline-flex items-center gap-2 self-start rounded-full bg-white/84 px-4 py-2 text-[15px] text-zinc-500 shadow-[0_8px_24px_rgba(24,24,27,0.05)] transition hover:text-zinc-900 lg:self-auto"
            >
              {mode === 'all' ? (
                <>
                  <ChevronLeft className="h-4 w-4" />
                  返回最近
                </>
              ) : (
                <>
                  查看全部
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          ) : null}
        </div>

        <div
          className={cn(
            'mt-10 grid gap-4',
            hasProjects ? 'sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5' : 'max-w-[320px]'
          )}
        >
          <NewProjectCard
            value={newProjectName}
            isCreatingProject={isCreatingProject}
            isNamingNewProject={isNamingNewProject}
            onChange={onNewProjectNameChange}
            onStartCreate={onStartCreateProject}
            onCancelCreate={onCancelCreateProject}
            onCreate={onCreateProject}
          />

          {hasProjects
            ? gridProjects.map((card) => (
                <ProjectCard
                  key={card.taskId}
                  card={card}
                  workspacePath={workspacePath}
                  onOpen={onOpenProject}
                  onRename={onRenameProject}
                />
              ))
            : null}
        </div>
      </div>
    </section>
  )
}

export { AiStudioProjectLanding }
