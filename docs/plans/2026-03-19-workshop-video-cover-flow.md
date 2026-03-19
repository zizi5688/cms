# Data Workshop Video Cover Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the mode-based video cover flow in Data Workshop with a default first-frame preview flow that supports later single-item overrides and ordered batch cover-folder overrides.

**Architecture:** Keep publish-time behavior unchanged and move the flow simplification into Data Workshop. Generate first-frame covers for all video preview tasks by default, then let pure helpers apply single-item and batch overrides directly onto preview task `assignedImages` so dispatch/publish always uses current task state.

**Tech Stack:** React, TypeScript, Electron IPC, Node test runner

---

### Task 1: Add failing tests for deterministic batch cover behavior

**Files:**
- Create: `src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs`
- Modify: `src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs`

**Step 1: Write the failing tests**

Cover:
- natural filename sorting;
- fewer covers than preview tasks;
- equal covers and preview tasks;
- more covers than preview tasks;
- clearing or replacing an override preserves first-frame fallback behavior.

**Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs`

Expected: fail because the new batch cover helper and/or new sync behavior does not exist yet.

**Step 3: Commit**

Do not commit yet. Wait until implementation and verification are complete.

### Task 2: Implement pure helpers for sorting and cover application

**Files:**
- Create: `src/renderer/src/components/modules/videoBatchCoverHelpers.ts`
- Modify: `src/renderer/src/components/modules/videoTaskCoverSyncHelpers.ts`

**Step 1: Write minimal implementation**

Implement helpers that:
- filter supported image filenames;
- natural-sort them by basename;
- map sorted covers onto current preview tasks in display order;
- preserve first-frame fallback for unmatched tasks;
- update only video tasks.

**Step 2: Run targeted tests**

Run: `node --experimental-strip-types --test src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs`

Expected: pass.

### Task 3: Expose batch cover folder contents through IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Step 1: Add a small IPC handler**

Implement an IPC method that:
- accepts a directory path;
- lists direct child files;
- returns supported image paths only.

**Step 2: Keep behavior narrow**

Do not recurse. Do not mutate files. Only read folder entries and return absolute paths.

**Step 3: Verify type surface**

Run: `npm run typecheck:web`

Expected: pass.

### Task 4: Refactor Data Workshop video cover UI and flow

**Files:**
- Modify: `src/renderer/src/components/modules/DataBuilder.tsx`

**Step 1: Remove the mode switch**

Delete the `自动首帧 / 手动封面` choice and related mode state.

**Step 2: Make preview generation always use first frames**

On `生成预览`, always batch-capture first-frame covers for video tasks and set them into `assignedImages`.

**Step 3: Convert the top panel into cover management**

Keep the preview list visible after generation and add:
- current cover status per video;
- single-item `设置/修改`;
- a new `批量设置封面` button.

**Step 4: Wire batch folder override**

Use the new folder picker + image listing IPC + pure helper to map sorted folder images onto the current preview tasks in order.

**Step 5: Preserve single-item editing**

Ensure single-item edits still update current preview tasks immediately, and clearing an override falls back to first-frame cover instead of blanking the task.

### Task 5: Verify and prepare checkpoint

**Files:**
- Review modified files only

**Step 1: Run targeted tests**

Run: `node --experimental-strip-types --test src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs`

Expected: pass.

**Step 2: Run typecheck**

Run: `npm run typecheck:web`

Expected: pass.

**Step 3: Review diff**

Run: `git diff -- src/renderer/src/components/modules/DataBuilder.tsx src/renderer/src/components/modules/videoBatchCoverHelpers.ts src/renderer/src/components/modules/videoBatchCoverHelpers.test.mjs src/renderer/src/components/modules/videoTaskCoverSyncHelpers.ts src/renderer/src/components/modules/videoTaskCoverSyncHelpers.test.mjs src/main/index.ts src/preload/index.ts src/preload/index.d.ts`

**Step 4: Prepare checkpoint summary**

Summarize:
- user-visible flow changes;
- validation results;
- residual risk around first-frame capture failures and batch-folder ordering.
