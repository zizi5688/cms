# AI Template Prompt Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add editable template main prompts to AI Studio so users can create, save, and duplicate their own prompt templates directly inside the control panel.

**Architecture:** Reuse the existing `ai_studio_templates.prompt_text` field for template main prompts and keep `ai_studio_tasks.promptExtra` for task-only additions. Add renderer-side draft state plus save actions, remove the fallback built-in template behavior, and keep the backend GRSAI prompt assembly unchanged.

**Tech Stack:** React, TypeScript, electron-vite, Zustand renderer store, existing AI Studio IPC endpoints.

---

### Task 1: Remove fallback built-in template behavior

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Write the failing test**
- No dedicated UI test harness exists; use `npm run typecheck` plus manual verification.

**Step 2: Run test to verify it fails**
- N/A before implementation.

**Step 3: Write minimal implementation**
- Stop injecting `builtin-product-studio` as a fallback template.
- Ensure new draft tasks can be created with `templateId = null`.
- Keep template loading resilient when the template table is empty.

**Step 4: Run test to verify it passes**
- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**
- Ask user before committing.

### Task 2: Add template save actions to AI Studio state

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Write the failing test**
- No harness; rely on typecheck and manual verification.

**Step 2: Run test to verify it fails**
- N/A before implementation.

**Step 3: Write minimal implementation**
- Add renderer methods to:
  - create a new template;
  - update an existing template;
  - refresh local template list after save;
  - clear the current task’s template binding for “new template” mode.
- Return the new template methods from the hook.

**Step 4: Run test to verify it passes**
- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**
- Ask user before committing.

### Task 3: Add in-panel template editor UI

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1: Write the failing test**
- No harness; rely on typecheck and manual verification.

**Step 2: Run test to verify it fails**
- N/A before implementation.

**Step 3: Write minimal implementation**
- Add local draft inputs for `模板名称` and `主提示词`.
- Add `新建模板` / `保存` / `另存为` actions.
- Rename `要求` to `附加要求`.
- Make the template selector support an empty selection state.
- Disable start-run when main prompt is missing.

**Step 4: Run test to verify it passes**
- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**
- Ask user before committing.

### Task 4: Manual verification pass

**Files:**
- No code changes required unless issues are found.

**Step 1: Verify empty-template state**
- Reset the current AI Studio task and confirm the control panel can start from no template.

**Step 2: Verify save flow**
- Create a template with name + main prompt and confirm it appears in the dropdown.

**Step 3: Verify save-as flow**
- Edit an existing template, click `另存为`, and confirm a new template is created and selected.

**Step 4: Verify prompt assembly safeguards**
- Leave main prompt empty and confirm `开始生成` is disabled.
- Fill main prompt and keep `附加要求` empty; confirm generation is allowed.

**Step 5: Commit**
- Ask user before committing.
