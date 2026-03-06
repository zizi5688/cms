# AI Material Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `AI素材工作台` for GRSAI-powered image generation, with Settings-based API credential management, workspace-backed task persistence, cost tracking, candidate multi-select, and handoff into the existing Super CMS media pipeline.

**Architecture:** Add a new renderer module for `AI素材工作台`, a new main-process `aiStudioService` for persistence and GRSAI orchestration, and extend the existing config store so API credentials live in `Settings > AI服务`. Persist templates, tasks, assets, and runs in SQLite; save outputs under the workspace so future `AI生视频` can reuse the same shell.

**Tech Stack:** Electron, React, TypeScript, Zustand, better-sqlite3, Electron IPC, workspace filesystem, existing `electron-store` config plumbing.

---

## Execution Status (2026-03-06)

- Task 1 完成，提交：`6fd975f`
- Task 2 完成，提交：`df3b869`
- Task 3 完成，提交：`bb14d0c`
- Task 4 完成，提交：`e0848cc`
- Task 5 完成，提交：`631abc9`
- Task 6 完成，提交：`044dcb6`
- Task 7 为当前文档同步节点，内容已按实现状态回填。

---

> Note: This repo currently has no automated test suite under `tests/` or `src/**/*.test.*`. Do not introduce a new test framework in this feature. Use typecheck, targeted linting if needed, `git diff --check`, and explicit manual verification steps instead.

### Task 1: Extend global config for AI service credentials

**Files:**
- Modify: `src/renderer/src/store/useCmsStore.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Step 1: Add AI service fields to config state**

Add the following `CmsConfig` fields and initialize them in `initialConfig`:

- `aiProvider: 'grsai'`
- `aiBaseUrl: string`
- `aiApiKey: string`
- `aiDefaultImageModel: string`

Make sure `App.tsx` hydrates these values from `window.electronAPI.getConfig()` just like existing local tool config.

**Step 2: Extend preload typings and save/get config payloads**

Update `src/preload/index.ts` and `src/preload/index.d.ts` so `getConfig()` returns the new AI fields and `saveConfig()` accepts patches for them.

**Step 3: Persist AI config in main process**

In `src/main/index.ts`, extend the `get-config` and `save-config` handlers so they normalize and persist:

- `aiProvider`
- `aiBaseUrl`
- `aiApiKey`
- `aiDefaultImageModel`

Keep defaults stable. Do not break existing config fields.

**Step 4: Add `AI服务` section to Settings**

In `src/renderer/src/components/modules/Settings.tsx`, add a new card near the existing config cards with:

- Provider display (`GRSAI`)
- Base URL input
- API Key input with masked display
- Default model input/select
- `测试连接` button placeholder wired to future IPC

Keep this section visually consistent with existing Settings cards.

**Step 5: Validate config wiring**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer/src/store/useCmsStore.ts src/renderer/src/App.tsx src/preload/index.ts src/preload/index.d.ts src/main/index.ts src/renderer/src/components/modules/Settings.tsx
git commit -m "feat(ai-studio): 新增 AI 服务配置入口 / add AI service config entry"
```

### Task 2: Register the new AI studio module in the shell

**Files:**
- Modify: `src/renderer/src/store/useCmsStore.ts`
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`
- Modify: `src/renderer/src/components/layout/MainLayout.tsx`
- Create: `src/renderer/src/modules/AiStudio/index.tsx`
- Create: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`

**Step 1: Add a new module key**

Extend `ActiveModuleKey` and related sidebar key types to include a new module id, recommended as `aiStudio`.

**Step 2: Register sidebar navigation**

Add a new sidebar item label for `AI素材工作台`. Place it near `素材处理` because it is the upstream source-generation stage.

**Step 3: Render the new module**

Wire `MainLayout` so `renderModule()` returns the new `AiStudio` component for `aiStudio`, and keep the visited-module mounting strategy unchanged.

**Step 4: Create a shell-only module first**

Create `src/renderer/src/components/modules/AiStudio/AiStudio.tsx` with the approved shell layout:

- left `片场`
- middle `控制台`
- right dominant `结果区`

Keep all previews portrait `3:4` and put `开始生成` inside the control panel, not in the top bar.

**Step 5: Validate shell registration**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/renderer/src/store/useCmsStore.ts src/renderer/src/components/layout/Sidebar.tsx src/renderer/src/components/layout/MainLayout.tsx src/renderer/src/modules/AiStudio/index.tsx src/renderer/src/components/modules/AiStudio/AiStudio.tsx
git commit -m "feat(ai-studio): 新增工作台壳层与导航 / add studio shell and navigation"
```

### Task 3: Add SQLite schema and workspace storage primitives

**Files:**
- Modify: `src/main/services/sqliteService.ts`
- Create: `src/main/services/aiStudioService.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Step 1: Add schema migrations**

Extend `src/main/services/sqliteService.ts` to create these tables when initializing the workspace database:

- `ai_studio_templates`
- `ai_studio_tasks`
- `ai_studio_assets`
- `ai_studio_runs`

Use generic names and include timestamps. Add indexes on task status, task updated time, and run task_id.

**Step 2: Create `aiStudioService`**

Add `src/main/services/aiStudioService.ts` with methods for:

- upserting templates
- creating tasks
- listing tasks and assets
- recording run attempts
- updating billed state
- marking selected outputs
- ensuring task run directories under `workspace/ai-studio/tasks/<taskId>/run-XXX/`

Reuse `WorkspaceService` / SQLite initialization patterns already present in the app.

**Step 3: Expose minimal IPC surface**

Add initial IPC methods in `src/main/index.ts` and preload for:

- `window.api.cms.aiStudio.template.*`
- `window.api.cms.aiStudio.task.*`
- `window.api.cms.aiStudio.asset.*`

Start with CRUD needed by the renderer shell; add only the smallest surface required.

**Step 4: Validate persistence layer**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/services/sqliteService.ts src/main/services/aiStudioService.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(ai-studio): 新增任务与素材持久化 / add task and asset persistence"
```

### Task 4: Implement folder import and task editing flow

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`
- Create: `src/renderer/src/components/modules/AiStudio/TaskQueue.tsx`
- Create: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Create: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Add folder import IPC**

Implement an IPC handler that lets the renderer choose one or more product folders and scan image files inside each folder.

Return enough metadata for the renderer to create draft tasks:

- folder path
- inferred product name from folder name
- image file paths

Do not auto-decide primary vs reference images yet.

**Step 2: Build queue state**

Create a local module state hook to manage:

- active task id
- selected task ids
- draft prompt extra
- assigned primary image
- assigned reference images
- output count
- cost summary per task and batch

**Step 3: Build left queue UI**

In `TaskQueue.tsx`, render:

- status filters
- compact task cards
- cost badge per task
- import and exception actions grouped together

**Step 4: Build control panel UI**

In `ControlPanel.tsx`, render:

- template selector
- aspect ratio selector defaulting to `3:4`
- output count input defaulting to `1`
- model selector
- primary image portrait preview
- reference image portrait grid
- custom requirement editor
- grouped `开始生成` button

Keep text sparse; do not reintroduce explanatory copy blocks.

**Step 5: Validate editor flow**

Run: `npm run typecheck`
Expected: PASS

Manual check:
- switch into the new module
- import folders
- assign one primary image and multiple references
- confirm output count defaults to `1`

**Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/modules/AiStudio/AiStudio.tsx src/renderer/src/components/modules/AiStudio/TaskQueue.tsx src/renderer/src/components/modules/AiStudio/ControlPanel.tsx src/renderer/src/components/modules/AiStudio/useAiStudioState.ts
git commit -m "feat(ai-studio): 新增导入与控制台编辑流 / add import and control-panel editing flow"
```

### Task 5: Implement GRSAI submission, polling, and price snapshots

**Files:**
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/components/modules/Settings.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1: Add provider request helpers**

In `aiStudioService`, add provider helpers for:

- `testConnection()`
- `submitImageRun()`
- `pollRunResult()`
- `downloadOutputs()`

Use the configured `aiBaseUrl` and `aiApiKey`. Do not log the raw API key.

**Step 2: Record price snapshots at submit time**

When submitting a run, persist:

- `price_min_snapshot`
- `price_max_snapshot`
- `billed_state`

Treat successful submit as billable for UI purposes, even if later polling fails.

**Step 3: Expose run IPCs**

Add IPC methods for:

- start run
- poll / refresh run state
- retry run
- test AI provider connection

**Step 4: Wire Settings connection test**

Make the `测试连接` button call the provider ping IPC and show pass/fail feedback without revealing secrets.

**Step 5: Validate provider integration shape**

Run: `npm run typecheck`
Expected: PASS

Manual check:
- missing key disables generate
- connection test shows success/failure
- successful submit records billed state and remote task id

**Step 6: Commit**

```bash
git add src/main/services/aiStudioService.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/modules/Settings.tsx src/renderer/src/components/modules/AiStudio/ControlPanel.tsx
git commit -m "feat(ai-studio): 接入 GRSAI 提交与轮询 / integrate GRSAI submission and polling"
```

### Task 6: Build dominant result view, multi-select screening, and ImageLab handoff

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`
- Create: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/components/modules/ImageLab.tsx`
- Modify: `src/renderer/src/store/useCmsStore.ts`

**Step 1: Add result selection state**

Track selected output asset ids per task. Clicking a candidate tile should toggle its selected state. Multi-select must work with no extra mode switch.

**Step 2: Build the dominant result panel**

`ResultPanel.tsx` should render:

- large portrait hero preview
- thumbnail strip/grid for candidates
- current task cost summary
- grouped actions: `保留`, `送入链路`, `重生成`, `丢弃`

Keep the result panel visually dominant relative to the control panel.

**Step 3: Add persistent selection flags**

When the user toggles selection, persist `selected` state through the IPC layer so the state survives module switches and app reloads.

**Step 4: Add ImageLab handoff path**

Create a new store bridge for material prefill (for example `materialImport`) so selected AI outputs can open `ImageLab` with those generated paths already loaded.

Update `ImageLab` to consume that prefill exactly once, then clear it after import.

**Step 5: Validate selection and handoff**

Run: `npm run typecheck`
Expected: PASS

Manual check:
- generate multiple candidates
- click to select multiple images
- send selected images into `ImageLab`
- verify `ImageLab` opens with those generated outputs loaded

**Step 6: Commit**

```bash
git add src/renderer/src/components/modules/AiStudio/AiStudio.tsx src/renderer/src/components/modules/AiStudio/ResultPanel.tsx src/renderer/src/components/modules/AiStudio/useAiStudioState.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts src/renderer/src/components/modules/ImageLab.tsx src/renderer/src/store/useCmsStore.ts
git commit -m "feat(ai-studio): 新增多选筛图与 ImageLab 回流 / add multi-select screening and ImageLab handoff"
```

### Task 7: Final polish, safety checks, and docs sync

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/user-manual.md`
- Modify: `docs/plans/2026-03-06-ai-material-studio-design.md`
- Modify: `docs/plans/2026-03-06-ai-material-studio.md`

**Step 1: Sync architecture docs**

Update `docs/architecture.md` so the system context and module map mention `AI素材工作台`, its new IPC surface, and the new persistence tables.

**Step 2: Sync user manual**

Add operator guidance to `docs/user-manual.md` for:

- configuring AI service credentials
- importing product folders
- setting output count
- selecting outputs and sending them into `ImageLab`

**Step 3: Run final verification**

Run:

```bash
npm run typecheck
git diff --check
```

Expected:
- `npm run typecheck` PASS
- `git diff --check` PASS

**Step 4: Manual smoke checklist**

Verify end-to-end:

- `Settings > AI服务` saves and reloads config
- `AI素材工作台` appears in the sidebar
- top bar shows batch cost only
- control panel owns template/model/output count/start generate
- result area remains larger than the input area
- all previews stay portrait `3:4`
- missing API key blocks generation
- selected outputs can be handed off to `ImageLab`
- docs/architecture.md 与 docs/user-manual.md 已同步到第一阶段落地状态

**Step 5: Commit**

```bash
git add docs/architecture.md docs/user-manual.md docs/plans/2026-03-06-ai-material-studio-design.md docs/plans/2026-03-06-ai-material-studio.md
git commit -m "docs(ai-studio): 同步设计与实施计划 / sync design and implementation plan"
```
