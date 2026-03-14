# Storage Maintenance Manual Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the historical storage-maintenance feature as a manual-only operations tool in Settings, with `dry-run`, real execution, rollback, and run-time write protections, while explicitly leaving nightly auto-scheduling disabled.

**Architecture:** Port the proven storage-maintenance service and smoke harness from the historical branch, reconnect its config and IPC plumbing in the main/preload layers, then restore a manual-only Settings card that exposes archive path, retention days, status refresh, execution, and rollback. Keep the existing `storageMaintenance*` config fields for compatibility, but do not start the old scheduler timer in this phase. Preserve file-write locking around queue/publish/video-generation flows so manual maintenance cannot race with active writes.

**Tech Stack:** Electron, React, TypeScript, Zustand, Electron Store, better-sqlite3, shell smoke script

---

### Task 1: Restore the smoke harness and service source as the safety net

**Files:**
- Create: `scripts/run-storage-maintenance-smoke.sh`
- Create: `scripts/storage-maintenance-smoke.ts`
- Create: `src/main/services/storageMaintenanceService.ts`
- Modify: `package.json`

**Steps:**
1. Copy the historical smoke harness from `codex/cache-footprint-audit` into:
   - `scripts/run-storage-maintenance-smoke.sh`
   - `scripts/storage-maintenance-smoke.ts`
2. Add an npm script in `package.json`:
   - `smoke:storage-maintenance`: `bash scripts/run-storage-maintenance-smoke.sh`
3. Copy the historical `StorageMaintenanceService` into `src/main/services/storageMaintenanceService.ts` as the starting point.
4. Remove or neutralize any behavior inside the service that assumes the scheduler must always be active after startup.
5. Keep the following service capabilities intact:
   - orphan asset cleanup
   - temp file cleanup
   - managed partition cleanup
   - generated video migration
   - manifest writing
   - rollback by `runId`
   - cross-device/NAS-safe move fallback
6. Run the smoke harness once:

```bash
npm run smoke:storage-maintenance
```

7. If the smoke harness fails due to missing integration points, record the failure and continue with the next task instead of weakening the smoke assertions.

### Task 2: Reconnect main-process config, state, and manual IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Steps:**
1. Re-add the `storageMaintenance*` normalization helpers in `src/main/index.ts` so `get-config` returns:
   - `storageMaintenanceEnabled`
   - `storageMaintenanceStartTime`
   - `storageMaintenanceRetainDays`
   - `storageArchivePath`
2. Re-add `save-config` handling for:
   - `storageMaintenanceEnabled`
   - `storageMaintenanceStartTime`
   - `storageMaintenanceRetainDays`
   - `storageArchivePath`
3. Instantiate `StorageMaintenanceService` in `app.whenReady()` using the current main-process collaborators:
   - config store access
   - workspace path
   - userData path
   - active partition names
   - sqlite connection
   - renderer log bridge
4. Do **not** call the old auto-scheduling boot path during startup in this phase.
5. Re-add manual IPC handlers only:
   - `cms.storage.maintenance.state`
   - `cms.storage.maintenance.runNow`
   - `cms.storage.maintenance.rollback`
6. Re-expose the matching preload APIs:
   - `getStorageMaintenanceState`
   - `runStorageMaintenanceNow`
   - `rollbackStorageMaintenance`
7. Re-run node-side typecheck:

```bash
npm run typecheck:node
```

8. Do not move on until `typecheck:node` passes cleanly.

### Task 3: Restore write-lock protections for manual maintenance runs

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/publisher.ts`
- Modify: `src/main/services/queueService.ts`

**Steps:**
1. Restore `PublisherService.isQueueRunning()` in `src/main/publisher.ts`.
2. Restore `QueueService.hasProcessingTasks()` in `src/main/services/queueService.ts`.
3. Pass `isTaskPipelineBusy` into `StorageMaintenanceService` so a manual run is rejected while queue/publish work is active.
4. Restore `assertStorageWritable(...)` integration in `src/main/index.ts` for the existing high-risk write paths:
   - batch task creation
   - image import
   - manual publish
   - cover save
   - single video generation
   - batch video generation
   - Douyin hot-music sync
5. Restore queue-start guarding so `cms.queue.start` refuses to begin if storage maintenance is currently running.
6. Re-run:

```bash
npm run typecheck:node
```

7. Re-run:

```bash
npm run smoke:storage-maintenance
```

8. Only proceed when both commands pass.

### Task 4: Restore the manual-only Settings card

**Files:**
- Modify: `src/renderer/src/components/modules/Settings.tsx`
- Validate: `src/renderer/src/store/useCmsStore.ts`
- Validate: `src/renderer/src/App.tsx`

**Steps:**
1. Bring back the Settings card for storage maintenance from the historical implementation.
2. Keep the user-facing card manual-only in this phase:
   - show retention days
   - show archive path
   - show current state / last run info
   - show manual reason
   - show `dry-run`
   - show real run
   - show rollback by `runId`
3. If the historical UI contains automatic-maintenance controls, either:
   - remove them from this phase, or
   - render them as explanatory disabled text without enabling timer-based behavior
4. Keep the historical Chinese error normalization for NAS/permission issues so the user sees actionable mount guidance.
5. Ensure the card reads from the already-existing renderer config fields and saves only the supported manual-phase values.
6. Re-run web typecheck:

```bash
npm run typecheck:web
```

7. Do not move on until `typecheck:web` passes.

### Task 5: Verify end-to-end behavior in dev

**Files:**
- Validate: `src/main/index.ts`
- Validate: `src/preload/index.ts`
- Validate: `src/renderer/src/components/modules/Settings.tsx`
- Validate: `scripts/storage-maintenance-smoke.ts`

**Steps:**
1. Run the full typecheck:

```bash
npm run typecheck
```

2. Run the smoke harness again as the final automated verification:

```bash
npm run smoke:storage-maintenance
```

3. Restart the dev environment so main/preload changes are live:

```bash
npm run dev
```

4. Manually verify in Settings:
   - the storage-maintenance card is visible
   - archive path selection works
   - `刷新状态` returns without IPC errors
   - `立即 dry-run` completes and shows a summary
   - `立即实跑` prompts before destructive behavior when no archive path is set
   - rollback requires a `runId`
5. Manually verify runtime protection:
   - start a queue or publish flow, then confirm storage maintenance refuses to start
   - start storage maintenance, then confirm queue start or protected write actions are rejected
6. Capture any gaps discovered during manual verification as follow-up notes instead of expanding scope into auto-scheduling or AI Studio cleanup.

### Task 6: Prepare a clean documentation-only checkpoint

**Files:**
- Modify: `docs/plans/2026-03-14-storage-maintenance-manual-recovery-design.md`
- Modify: `docs/plans/2026-03-14-storage-maintenance-manual-recovery.md`

**Steps:**
1. Update the design doc if implementation discovered a necessary scope correction.
2. Keep the plan aligned with the actual implementation order if any task sequence changed.
3. Stage only the coherent storage-maintenance recovery work for the eventual commit.
4. Before committing, summarize:
   - restored files
   - verification commands and results
   - whether manual-only scope was preserved
5. Ask the user for explicit commit approval instead of auto-committing.
