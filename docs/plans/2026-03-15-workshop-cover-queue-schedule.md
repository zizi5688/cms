# Workshop Cover Queue Schedule Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add manual cover thumbnail fallback in Data Workshop, make the dispatch board smaller/collapsible, and support drag-to-reorder for scheduled tasks.

**Architecture:** Keep the existing task data model unchanged. Implement the cover and dispatch-board changes in the renderer, and add a small pure helper for scheduled-task reorder so we can test the time reassignment behavior before wiring it into the calendar drag-and-drop UI.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, react-dnd, node:test

---

### Task 1: Add tested helpers for cover preview and scheduled reorder

**Files:**
- Create: `src/renderer/src/components/modules/videoCoverPreviewHelpers.ts`
- Create: `src/renderer/src/components/modules/videoCoverPreviewHelpers.test.mjs`
- Create: `src/renderer/src/modules/MediaMatrix/scheduledTaskReorderHelpers.ts`
- Create: `src/renderer/src/modules/MediaMatrix/scheduledTaskReorderHelpers.test.mjs`

**Step 1: Write the failing tests**

Cover preview tests should verify:
- manual cover path wins when present;
- first-frame fallback is used when no manual cover exists;
- empty input yields no preview.

Scheduled reorder tests should verify:
- moving a task before another task reuses the column’s existing time slots in the new order;
- moving a task after another task pushes later tasks back;
- invalid reorder inputs return no patches.

**Step 2: Run the tests to verify they fail**

Run:
`node --test src/renderer/src/components/modules/videoCoverPreviewHelpers.test.mjs src/renderer/src/modules/MediaMatrix/scheduledTaskReorderHelpers.test.mjs`

**Step 3: Write the minimal helper implementations**

Implement pure helpers that:
- resolve the effective cover preview path and label source;
- compute reorder patches from scheduled tasks without changing storage shape.

**Step 4: Run the tests to verify they pass**

Run:
`node --test src/renderer/src/components/modules/videoCoverPreviewHelpers.test.mjs src/renderer/src/modules/MediaMatrix/scheduledTaskReorderHelpers.test.mjs`

### Task 2: Wire the Data Workshop cover preview and compact dispatch board

**Files:**
- Modify: `src/renderer/src/components/modules/DataBuilder.tsx`
- Modify: `src/renderer/src/components/ui/CmsProductMultiSelectPanel.tsx`

**Step 1: Add renderer state for fallback first-frame preview**

Use the tested cover helper plus existing capture/cache logic so the manual cover editor shows:
- current manual/imported cover thumbnail when available;
- first-frame thumbnail otherwise.

**Step 2: Make the dispatch board smaller and collapsible**

Add a collapse toggle and a compact collapsed summary bar.
Reduce the expanded footprint with tighter spacing and the compact product-panel variant.

**Step 3: Manually verify the busy/disabled states still hold**

Ensure collapse/expand does not break:
- account selection;
- product selection;
- dispatch button progress state.

### Task 3: Enable drag reorder for scheduled tasks

**Files:**
- Modify: `src/renderer/src/modules/MediaMatrix/CalendarView.tsx`
- Modify: `src/renderer/src/modules/MediaMatrix/CalendarTaskCard.tsx`
- Modify: `src/renderer/src/modules/MediaMatrix/KanbanWeekView.tsx`

**Step 1: Use the reorder helper before changing UI behavior**

Keep existing day-column drag behavior.
Add card-level drop handling for scheduled tasks in the same day column.

**Step 2: Batch-save the reordered times**

When a user drops one scheduled task around another, rebuild that column’s ordered slot list and persist the new `scheduledAt` values with the existing batch update API.

**Step 3: Run focused verification**

Run:
- `node --test src/renderer/src/components/modules/videoCoverPreviewHelpers.test.mjs src/renderer/src/modules/MediaMatrix/scheduledTaskReorderHelpers.test.mjs`
- `npm run typecheck:web`

Confirm the calendar keeps existing cross-day drag behavior and the new reorder path compiles cleanly.
