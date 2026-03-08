# AI Studio Two-Stage Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a two-stage AI Studio workflow that generates multiple AI master images, automatically removes watermarks, lets the user choose a clean current AI master, and then serially generates child images from Variant lines.

**Architecture:** Reuse the existing single-task `AI Studio` storage model and extend `task.metadata`, `asset.role`, and run payload metadata instead of introducing a new workflow table. Keep the current renderer shell (`ControlPanel` + `ResultPanel`), add stage-aware UI, and orchestrate master generation, watermark cleaning, and child generation as a serial queue in the existing AI Studio flow.

**Tech Stack:** Electron, React, TypeScript, Zustand, preload IPC bridge, `better-sqlite3`, existing `AI Studio` service, existing `process-watermark` IPC.

---

### Task 1: Document the workflow metadata contract

**Files:**
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Reference: `docs/plans/2026-03-07-ai-studio-two-stage-workflow-design.md`

**Step 1: Define workflow metadata keys**

Add a shared metadata shape in comments or helper constants for:

```ts
workflow.activeStage
workflow.currentAiMasterAssetId
masterStage.requestedCount
childStage.variantLines
```

Keep the shape minimal and compatible with existing persisted tasks.

**Step 2: Define asset role constants**

Add constant strings for:

```ts
source-primary
source-reference
master-raw
master-clean
child-output
```

Do not introduce a new DB column for stage.

**Step 3: Normalize metadata reads**

Create or update helper functions so missing metadata falls back safely for old tasks.

**Step 4: Validate type safety**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit after user confirmation**

```bash
git add src/main/services/aiStudioService.ts src/renderer/src/components/modules/AiStudio/useAiStudioState.ts docs/plans/2026-03-07-ai-studio-two-stage-workflow-design.md docs/plans/2026-03-07-ai-studio-two-stage-workflow.md
git commit -m "feat(ai-studio): 规范两阶段工作流元数据 / define two-stage workflow metadata"
```

### Task 2: Add master-stage configuration and stage state to the renderer

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1: Add master-stage state fields**

Expose state for:

- `masterOutputCount` defaulting to `3`
- `childOutputCount`
- `variantLines`
- `currentAiMasterAssetId`
- `activeStage`

Keep old single-stage fields working until the new UI fully replaces them.

**Step 2: Split prompt editing intent**

Preserve the existing custom template workflow, but expose separate editing surfaces for:

- master prompt template
- child prompt template

Do not introduce built-in system templates.

**Step 3: Disable child controls before master selection**

Gate child-stage inputs and submit button behind `currentAiMasterAssetId`.

**Step 4: Validate renderer types**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit after user confirmation**

```bash
git add src/renderer/src/components/modules/AiStudio/useAiStudioState.ts src/renderer/src/components/modules/AiStudio/ControlPanel.tsx
git commit -m "feat(ai-studio): 新增母图与子图阶段配置 / add master and child stage controls"
```

### Task 3: Implement master image serial generation and automatic watermark cleanup

**Files:**
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Step 1: Identify the submit orchestration entrypoint**

Before editing any service method, run GitNexus impact analysis on the target symbol(s) you will modify, then report direct callers and risk.

**Step 2: Add a master queue orchestration method**

Implement a service-level flow that:

- loops from `1..masterOutputCount`
- submits one master generation request each time
- records the output as `master-raw`
- records stage metadata in run payloads

**Step 3: Reuse existing watermark processing**

After each successful master generation, invoke the existing `process-watermark` path and create a paired `master-clean` asset on success.

**Step 4: Mark failed cleanups explicitly**

When watermark cleanup fails:

- preserve the `master-raw` asset
- mark its related clean status as failed in metadata
- continue the master queue

**Step 5: Expose minimal stage-aware IPC hooks**

Add or adapt IPC so the renderer can:

- start the master stage
- retry master cleanup for one asset
- set current AI master asset

**Step 6: Validate service and preload types**

Run: `npm run typecheck`
Expected: PASS

**Step 7: Commit after user confirmation**

```bash
git add src/main/services/aiStudioService.ts src/main/index.ts src/preload/index.ts src/preload/index.d.ts
git commit -m "feat(ai-studio): 接入母图队列与自动去印 / add master queue and automatic cleanup"
```

### Task 4: Build master candidate presentation and current AI master selection

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Add stage sections to the result panel**

Render separate visual sections for:

- master candidates
- current AI master
- child outputs
- failure records

Do not mix master and child assets in the same gallery.

**Step 2: Add master status badges**

Render badge states for:

- generating
- cleaning
- clean-ready
- clean-failed
- current AI master

**Step 3: Rename the selection action**

Use the exact button copy:

```text
设为当前AI母图
```

Only show it for clean-ready master assets.

**Step 4: Add master-specific actions**

Expose buttons for:

- view large image
- open containing folder
- view raw master image
- retry cleanup on failure

**Step 5: Validate renderer types**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit after user confirmation**

```bash
git add src/renderer/src/components/modules/AiStudio/ResultPanel.tsx src/renderer/src/components/modules/AiStudio/useAiStudioState.ts
git commit -m "feat(ai-studio): 新增母图候选与当前AI母图视图 / add master candidate and current AI master views"
```

### Task 5: Implement child-stage Variant queue execution

**Files:**
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1: Add child-stage request builder inputs**

For each child request, build inputs from:

- selected clean current AI master asset as the first image
- original reference images as optional secondary references
- child prompt template
- one Variant line

**Step 2: Execute the child queue serially**

Loop through `variantLines` in order and submit one request per line.

**Step 3: Skip failures and continue**

When one child request fails:

- record a failed run
- increment failed count
- continue to the next Variant line

Do not abort the queue.

**Step 4: Record child outputs**

Persist successful results as `child-output` assets with:

```ts
metadata.derivedFromAssetId = currentAiMasterAssetId
metadata.sequenceIndex = variantIndex
```

**Step 5: Validate service and renderer types**

Run: `npm run typecheck`
Expected: PASS

**Step 6: Commit after user confirmation**

```bash
git add src/main/services/aiStudioService.ts src/renderer/src/components/modules/AiStudio/useAiStudioState.ts src/renderer/src/components/modules/AiStudio/ControlPanel.tsx
git commit -m "feat(ai-studio): 新增子图 Variant 串行生成 / add serial child variant generation"
```

### Task 6: Add stage progress and failure summaries

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Add a stage header summary**

Render the current stage and current item summary, for example:

- `母图生成中 2/3`
- `母图去水印中 2/3`
- `子图生成中 4/9`

**Step 2: Add total progress accounting**

Compute and display total progress across master generation, cleanup, and child generation.

**Step 3: Add failure summary list**

Render a simple failure list showing:

- which master generation failed
- which cleanup failed
- which child generation failed

Keep it informational only for this MVP.

**Step 4: Validate renderer types**

Run: `npm run typecheck`
Expected: PASS

**Step 5: Commit after user confirmation**

```bash
git add src/renderer/src/components/modules/AiStudio/ControlPanel.tsx src/renderer/src/components/modules/AiStudio/ResultPanel.tsx src/renderer/src/components/modules/AiStudio/useAiStudioState.ts
git commit -m "feat(ai-studio): 新增阶段进度与失败汇总 / add stage progress and failure summaries"
```

### Task 7: Run manual end-to-end verification

**Files:**
- No code changes required unless a defect is found

**Step 1: Run type checks**

Run: `npm run typecheck`
Expected: PASS

**Step 2: Launch the dev app**

Run: `npm run dev`
Expected: Renderer and Electron launch successfully

**Step 3: Verify the master flow manually**

Manual scenario:

1. Load one primary image and optional references
2. Set master count to `3`
3. Start master generation
4. Confirm at least one master reaches clean-ready state
5. Confirm clean-failed masters cannot be set as current AI master

**Step 4: Verify the child flow manually**

Manual scenario:

1. Click `设为当前AI母图`
2. Enter `4` Variant lines
3. Start child generation
4. Confirm outputs land in the child section only
5. Confirm a failed child item does not stop later items

**Step 5: Fix defects found during verification**

If defects appear, create a follow-up task list before broad refactors. Keep fixes scoped to the two-stage workflow.

**Step 6: Commit after user confirmation**

```bash
git add <only-files-touched-during-verification>
git commit -m "fix(ai-studio): 修正两阶段工作流问题 / fix two-stage workflow issues"
```

### Task 8: Final delivery checks

**Files:**
- Modify if needed: `docs/plans/2026-03-07-ai-studio-two-stage-workflow-design.md`
- Modify if needed: `docs/plans/2026-03-07-ai-studio-two-stage-workflow.md`

**Step 1: Run GitNexus change detection before any final commit**

Run the repository-required change scope check to confirm only expected symbols and flows changed.

**Step 2: Verify no unrelated AI Studio behaviors regressed**

Check these existing capabilities still work:

- custom provider/model/endpoint settings
- prompt template save
- result preview
- open original image
- open containing folder

**Step 3: Update docs if implementation drifted**

If the code differs from the approved design, update the design or plan doc before closing the task.

**Step 4: Prepare the final commit set after user confirmation**

```bash
git add docs/plans/2026-03-07-ai-studio-two-stage-workflow-design.md docs/plans/2026-03-07-ai-studio-two-stage-workflow.md <implementation files>
git commit -m "feat(ai-studio): 新增两阶段母图子图工作流 / add two-stage master-child workflow"
```
