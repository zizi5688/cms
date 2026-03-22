# Video Cover Mode Publish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep local first-frame cover previews for video tasks while skipping Xiaohongshu manual cover upload whenever the task is still in default-first-frame mode.

**Architecture:** Introduce an explicit `videoCoverMode` field and carry it from renderer task editing through persistence and publish normalization. Leave UI preview images in `assignedImages`, but gate `setVideoCover()` on mode so only manual-cover tasks upload a cover.

**Tech Stack:** React, TypeScript, Electron, better-sqlite3, Node test runner

---

### Task 1: Add failing tests for cover-mode normalization and helper behavior

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/cmsTaskCreateBatchPayload.test.mjs`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/publishSessionHelpers.test.mjs`

**Step 1: Write the failing tests**

Cover:
- missing `videoCoverMode` defaults to `manual` in normalized task payloads;
- restoring default first frame switches a video task to `auto`;
- single-item and batch overrides switch a video task to `manual`;
- publish live-message parsing recognizes the new “skip manual cover” message as the `cover` step.

**Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/main/cmsTaskCreateBatchPayload.test.mjs src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/main/publishSessionHelpers.test.mjs`

Expected: FAIL because `videoCoverMode` is not implemented end-to-end yet.

**Step 3: Commit**

Do not commit yet. Wait until implementation and verification are complete.

### Task 2: Add `videoCoverMode` to renderer task state and editing helpers

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/store/useCmsStore.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/DataBuilder.tsx`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/videoTaskCoverSyncHelpers.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/videoBatchCoverHelpers.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/TaskDetailModal.tsx`

**Step 1: Write minimal implementation**

Implement `videoCoverMode` on renderer-side tasks and keep these rules:
- generated default first-frame preview => `auto`;
- ImageLab-imported manual cover => `manual`;
- manual single-item cover replacement/capture => `manual`;
- batch cover-folder override => `manual`;
- `恢复默认首帧` => `auto`.

**Step 2: Keep local preview behavior unchanged**

Do not remove local first-frame capture or task-card preview images.

**Step 3: Run focused tests**

Run: `node --experimental-strip-types --test src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs`

Expected: PASS.

### Task 3: Persist and normalize `videoCoverMode` through main process

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/cmsTaskCreateBatchPayload.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/taskManager.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/services/sqliteService.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/services/queueService.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/publisher.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/index.ts`

**Step 1: Add storage support**

Add a nullable or defaulted DB column and read/write plumbing for `videoCoverMode`.

**Step 2: Preserve compatibility**

Treat missing values from old tasks as `manual`.

**Step 3: Run focused tests**

Run: `node --experimental-strip-types --test src/main/cmsTaskCreateBatchPayload.test.mjs`

Expected: PASS.

### Task 4: Update XHS publish flow to skip cover upload for `auto`

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/preload/xhs-automation.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/publishSessionHelpers.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/publishSessionHelpers.test.mjs`

**Step 1: Normalize cover mode in automation input**

Default missing mode to `manual`.

**Step 2: Gate the cover step**

If `videoCoverMode === 'auto'`:
- do not call `setVideoCover()`;
- log a clear skip message indicating platform default first frame is used;
- keep the cover step visible/completed in publish progress.

If `videoCoverMode === 'manual'`, preserve current behavior.

**Step 3: Run focused tests**

Run: `node --experimental-strip-types --test src/main/publishSessionHelpers.test.mjs`

Expected: PASS.

### Task 5: Verify and prepare checkpoint

**Files:**
- Review modified files only

**Step 1: Run targeted tests**

Run: `node --experimental-strip-types --test src/main/cmsTaskCreateBatchPayload.test.mjs src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/main/publishSessionHelpers.test.mjs`

Expected: PASS.

**Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

**Step 3: Review diff**

Run: `git diff -- docs/plans/2026-03-22-video-cover-mode-publish-design.md docs/plans/2026-03-22-video-cover-mode-publish.md src/renderer/src/store/useCmsStore.ts src/renderer/src/components/modules/DataBuilder.tsx src/renderer/src/components/modules/videoTaskCoverSyncHelpers.ts src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs src/renderer/src/components/modules/videoBatchCoverHelpers.ts src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/renderer/src/components/TaskDetailModal.tsx src/main/cmsTaskCreateBatchPayload.ts src/main/cmsTaskCreateBatchPayload.test.mjs src/main/taskManager.ts src/main/services/sqliteService.ts src/main/services/queueService.ts src/main/publisher.ts src/main/preload/xhs-automation.ts src/main/publishSessionHelpers.ts src/main/publishSessionHelpers.test.mjs`

**Step 4: Prepare checkpoint summary**

Summarize:
- user-visible behavior split between `auto` and `manual`;
- compatibility behavior for old tasks;
- validation results;
- residual risk around existing manual-cover automation path.
