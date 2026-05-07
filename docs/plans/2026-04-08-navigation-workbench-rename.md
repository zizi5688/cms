# Navigation Workbench Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI Studio the default landing module, hide `素材处理` and `数据工坊` from the sidebar, and rename visible sidebar labels to `素材工作台` and `发布工作台`.

**Architecture:** Keep the existing module ids and underlying modules intact. Limit changes to renderer-shell navigation composition and the store's initial `activeModule`, so internal jumps to `material` and `workshop` continue to work without API or route changes.

**Tech Stack:** React, TypeScript, Zustand, electron-vite renderer shell.

---

### Task 1: Confirm Active Sidebar Surface

**Files:**
- Inspect: `src/renderer/src/components/layout/Sidebar.tsx`
- Inspect: `src/renderer/src/components/layout/MainLayout.tsx`
- Inspect: `src/renderer/src/components/Sidebar.tsx`

**Step 1: Identify the live sidebar component**

- Verify whether `MainLayout` renders `components/layout/Sidebar.tsx`.
- Check whether `components/Sidebar.tsx` is dead/legacy or still used somewhere.

**Step 2: Note scope**

- If only `components/layout/Sidebar.tsx` is live, keep changes there.
- If both are used, update both or document why only one is safe.

### Task 2: Change Sidebar Navigation Copy And Visibility

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx`
- Possibly modify: `src/renderer/src/components/Sidebar.tsx` if still used

**Step 1: Write the failing test or snapshot substitute**

- If the repo has no sidebar test surface, use a narrow helper or render-based assertion only if quick to add.
- Otherwise use code inspection plus typecheck as the practical guard.

**Step 2: Update menu items**

- Remove sidebar entries for:
  - `material`
  - `workshop`
- Rename:
  - `aiStudio` label to `素材工作台`
  - `autopublish` label to `发布工作台`

**Step 3: Keep module ids unchanged**

- Do not rename enum keys or module route ids.
- Only change visible labels and menu composition.

### Task 3: Switch Default Landing Module

**Files:**
- Modify: `src/renderer/src/store/useCmsStore.ts`

**Step 1: Write the minimal change**

- Change the initial `activeModule` from `material` to `aiStudio`.

**Step 2: Check for assumptions**

- Search for logic that depends on startup being `material`.
- Only patch those sites if the new default exposes an obvious issue.

### Task 4: Regression Verification

**Files:**
- Modified shell/store files

**Step 1: Run focused checks**

Run:
- `npm run typecheck:web`

Expected: PASS.

**Step 2: Smoke launch**

Run:
- `npm run dev`

Expected:
- app opens on AI Studio by default
- sidebar shows `素材工作台`
- sidebar shows `发布工作台`
- sidebar does not show `素材处理`
- sidebar does not show `数据工坊`

### Task 5: Commit Checkpoint

**Files:**
- Stage only navigation/store changes and the two plan docs if desired for traceability

**Step 1: Summarize checkpoint**

- shell now defaults to AI Studio
- sidebar hides legacy direct entries
- visible workbench naming matches current product framing

**Step 2: Verify status**

Run:
- `git status --short`

**Step 3: Commit after user confirmation**

Suggested commit:

```bash
git commit -m "refactor: 调整工作台导航与默认入口 / update workbench navigation and default entry"
```
