# AI Single-Task Input Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the AI Studio folder-import queue workflow with a single-task image input workflow built around one required primary image and up to four optional reference images.

**Architecture:** Keep the existing AI Studio persistence and GRSAI request pipeline, but hide queue-first UX behind a single-task renderer workflow. Add renderer-side helpers to create/update one active draft task, attach selected images as input assets, and guard destructive input replacement when outputs already exist.

**Tech Stack:** React, TypeScript, electron-vite, Zustand-backed renderer state, existing Electron preload APIs.

---

### Task 1: Add single-task input state helpers

**Files:**

- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Write the failing test**

- No dedicated UI test harness exists; use `npm run typecheck` plus manual interaction as the minimal safety net.

**Step 2: Run test to verify it fails**

- N/A before implementation.

**Step 3: Write minimal implementation**

- Add helpers to ensure one active draft task exists.
- Add methods to set/replace the primary image.
- Add methods to append/remove reference images with a max of 4 and duplicate filtering.
- Add a confirmation guard before replacing inputs on tasks that already have outputs or run history.
- Keep legacy multi-task APIs intact, but stop requiring folder import for normal use.

**Step 4: Run test to verify it passes**

- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**

- Ask user before committing.

### Task 2: Replace queue panel with input panel

**Files:**

- Create or repurpose: `src/renderer/src/components/modules/AiStudio/TaskQueue.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`

**Step 1: Write the failing test**

- No harness; rely on typecheck and manual verification.

**Step 2: Run test to verify it fails**

- N/A before implementation.

**Step 3: Write minimal implementation**

- Replace the left-column queue controls with:
  - one clickable + droppable primary-image preview box;
  - one clickable + droppable reference-image area supporting 0~4 images;
  - thumbnail removal actions and lightweight helper copy.
- Reuse existing image file picking APIs instead of folder import.

**Step 4: Run test to verify it passes**

- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**

- Ask user before committing.

### Task 3: Rewire control and result empty states

**Files:**

- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`

**Step 1: Write the failing test**

- No harness; rely on typecheck and manual verification.

**Step 2: Run test to verify it fails**

- N/A before implementation.

**Step 3: Write minimal implementation**

- Update control-panel empty/guard states to depend on primary-image presence rather than folder import.
- Update result-panel empty copy to reference single-task image input.
- Preserve generation, retry, keep/discard, and handoff actions.

**Step 4: Run test to verify it passes**

- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**

- Ask user before committing.

### Task 4: Manual verification pass

**Files:**

- No code changes required unless issues are found.

**Step 1: Verify primary image picking**

- Click-select a primary image and confirm preview updates.

**Step 2: Verify drag-and-drop**

- Drag a new primary image to replace, then drag up to four reference images to append.

**Step 3: Verify guards**

- Try adding a fifth reference image and confirm it is blocked.
- Try changing inputs after outputs exist and confirm reset warning appears.

**Step 4: Verify generation path**

- Start one run and confirm existing GRSAI flow still receives one primary plus optional references.

**Step 5: Commit**

- Ask user before committing.
