# AI Model Dropdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace free-form GRSAI model text inputs with dropdown-driven selectors in Settings and AI Studio while preserving a custom-model escape hatch.

**Architecture:** Add a shared renderer-side model catalog module, then wire both UI surfaces to a select-plus-custom-input pattern. Keep main-process request behavior unchanged so submitted payloads continue sending the chosen `model` string exactly as before.

**Tech Stack:** React, TypeScript, electron-vite, existing design system inputs/buttons.

---

### Task 1: Add shared GRSAI model catalog

**Files:**

- Create: `src/renderer/src/lib/grsaiModels.ts`

**Step 1: Write the failing test**

- No project test harness exists; use a targeted typecheck as the lightest safety net for this UI-only change.

**Step 2: Run test to verify it fails**

- N/A before implementation.

**Step 3: Write minimal implementation**

- Export ordered GRSAI model options, default model constant, and a helper that detects whether a string matches a known model.

**Step 4: Run test to verify it passes**

- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**

- Ask user before committing.

### Task 2: Convert AI Studio task model input

**Files:**

- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1: Write the failing test**

- No harness; rely on typecheck and manual UI verification.

**Step 2: Run test to verify it fails**

- N/A before implementation.

**Step 3: Write minimal implementation**

- Replace free text input with a select listing known models plus a `自定义模型` option.
- If current task model is unknown, auto-select custom mode and preserve the typed value.

**Step 4: Run test to verify it passes**

- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**

- Ask user before committing.

### Task 3: Convert Settings default model input and clarify Base URL

**Files:**

- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Step 1: Write the failing test**

- No harness; rely on typecheck and manual UI verification.

**Step 2: Run test to verify it fails**

- N/A before implementation.

**Step 3: Write minimal implementation**

- Replace default model input with the same select-plus-custom-input pattern.
- Update Base URL label/placeholder/help text to say only the Host should be entered.

**Step 4: Run test to verify it passes**

- Run: `npm run typecheck`
- Expected: PASS

**Step 5: Commit**

- Ask user before committing.
