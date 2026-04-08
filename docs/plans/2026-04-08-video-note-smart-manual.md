# Video Note Smart And Manual Entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add smart/manual entry parity to video-note creation so smart mode generates `标题,正文` CSV in parallel with video rendering, then merges both results into the existing video-note preview flow.

**Architecture:** Keep manual video-note generation behavior unchanged. In smart mode, introduce a renderer-side orchestration layer that launches AI CSV generation and video rendering together, stores whichever side finishes first, and only builds preview tasks after both CSV and rendered video assets are available.

**Tech Stack:** Electron, React, TypeScript, existing AI Studio chat runtime, existing video composer controller, Node `.mjs` unit tests.

---

### Task 1: Extract Video Note Orchestration Helper

**Files:**
- Create: `src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.ts`
- Create: `src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`

**Step 1: Write the failing tests**

- Add a test for `mergeVideoNoteGenerationState()` where CSV finishes first and the result remains in a waiting-video state.
- Add a test for `mergeVideoNoteGenerationState()` where video assets finish first and the result remains in a waiting-copy state.
- Add a test for both branches succeeding and returning a ready-preview payload.
- Add a test for copy failure preserving successful video assets.
- Add a test for render failure preserving successful CSV.

**Step 2: Run test to verify it fails**

Run: `node --test src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`

Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

- Define orchestration state types for:
  - copy branch status
  - render branch status
  - cached CSV
  - cached preview assets
  - merge status
- Export pure helper functions that:
  - accept branch updates
  - preserve partial success
  - return whether preview can be built

**Step 4: Run test to verify it passes**

Run: `node --test src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`

Expected: PASS.

### Task 2: Separate Smart CSV Input For Video Notes

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`

**Step 1: Write the failing tests**

- Add a test that a video-note smart chat input can be built from prompt text and group count without reference images.
- Add a test that blank smart prompt text still throws a user-facing validation error.
- Keep current CSV extraction tests green.

**Step 2: Run test to verify it fails**

Run: `node --test src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`

Expected: FAIL because video-note smart input helpers are not implemented yet.

**Step 3: Write minimal implementation**

- Either:
  - add a video-note-specific helper such as `buildVideoSmartNoteChatInput()`
  - or generalize the existing helper into a shared text-only CSV builder with image-note/video-note wrappers
- Keep the output contract `标题,正文` and text-only `imagePaths: []`.

**Step 4: Run test to verify it passes**

Run: `node --test src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`

Expected: PASS.

### Task 3: Add Video Note Smart/Manual Editor Modes

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/NoteSidebar.tsx`

**Step 1: Write the failing test**

- Add or extend a helper-oriented test around the editor props/state mapping if there is an extracted helper.
- Cover:
  - video-note mode can toggle between `smart` and `manual`
  - smart mode changes textarea copy from CSV entry to prompt entry
  - smart mode exposes split status copy such as waiting for CSV or waiting for videos

**Step 2: Run test to verify it fails**

Run the relevant targeted test file you add or extend.

Expected: FAIL because video-note editor has no smart/manual split yet.

**Step 3: Write minimal implementation**

- Add a `VideoNoteEntryMode` state parallel to the current image-note entry toggle.
- Update `VideoNoteEditor` props so it can receive:
  - entry mode
  - CSV draft
  - smart prompt draft
  - branch progress/status text
- Keep the existing video composer source/template controls unchanged.

**Step 4: Run test to verify it passes**

- Run the new targeted test file.
- Run existing `noteSidebarHelpers` or `NoteSidebar` tests if touched.

Expected: PASS.

### Task 4: Implement Smart Video Note Orchestration In AI Studio

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`
- Reuse: `src/renderer/src/components/modules/AiStudio/videoNotePreviewHelpers.ts`
- Reuse: `src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.ts`

**Step 1: Write the failing tests**

- Add helper-level orchestration tests if additional extraction is needed from `AiStudio.tsx`.
- Cover:
  - smart video mode starts AI CSV generation and video rendering together
  - CSV-first completion updates draft and waits for video
  - video-first completion caches assets and waits for CSV
  - both ready triggers `buildGeneratedVideoNotePreviewTasks`
  - manual mode still uses the existing direct CSV path

**Step 2: Run test to verify it fails**

Run the new orchestration-focused test file.

Expected: FAIL because `AiStudio.tsx` does not yet coordinate both branches.

**Step 3: Write minimal implementation**

- Add video-note local state for:
  - entry mode
  - smart prompt draft
  - cached CSV result
  - cached rendered video preview assets
  - split branch status and error strings
- Add a smart-mode generate handler that:
  - validates prompt text
  - starts chat request and `videoComposer.startGenerate()` in parallel
  - stores each result independently
  - merges the results when both are ready
- Keep manual-mode generate handler behavior unchanged.
- Ensure successful smart CSV is written back into `noteCsvDraft` for visibility and retry support.

**Step 4: Run test to verify it passes**

- Run the new orchestration tests.
- Run existing `videoNotePreviewHelpers` tests if touched.

Expected: PASS.

### Task 5: Regression Verification

**Files:**
- Existing files touched in Tasks 1-4

**Step 1: Run focused tests**

Run:
- `node --test src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`
- `node --test src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`
- any new `NoteSidebar` or orchestration-targeted renderer test file
- `node --test src/renderer/src/components/modules/AiStudio/videoNotePreviewHelpers.test.mjs`

Expected: PASS.

**Step 2: Run type checking**

Run: `npm run typecheck:web`

Expected: PASS.

**Step 3: Smoke the app**

Run: `npm run dev`

Expected:
- manual video-note mode still renders preview from CSV
- smart video-note mode shows split waiting states
- CSV-first and video-first paths both end in preview once both sides finish

### Task 6: Commit Checkpoint

**Files:**
- Stage only the smart/manual video-note entry files and tests

**Step 1: Summarize checkpoint**

- video-note creation now supports smart/manual entry parity
- smart mode preserves partial success across async branch ordering
- manual mode remains unchanged

**Step 2: Verify status**

Run: `git status --short`

**Step 3: Commit after user confirmation**

Suggested commit:

```bash
git commit -m "feat: 补齐视频笔记智能与手动录入 / add smart and manual video-note entry"
```
