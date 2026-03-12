# AI Studio 图片模型独立面板 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI Studio image tasks use task-scoped provider/model configuration, add an in-studio image model configurator like video, and remove the Settings AI panel.

**Architecture:** Keep `aiProviderProfiles` as the single saved provider/model registry, but move image task selection into the task record itself. Main-process provider resolution must use the current task for image flows just like video flows, while compatibility fields remain as fallback and “last active selection” state.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, Node test runner

---

### Task 1: Freeze the approved design

**Files:**
- Create: `docs/plans/2026-03-12-ai-studio-image-model-panel-design.md`
- Create: `docs/plans/2026-03-12-ai-studio-image-model-panel.md`

**Step 1: Save the approved design**

Write the design note with the confirmed `A` approach and the Settings-panel removal decision.

**Step 2: Save the implementation plan**

Document the exact code and verification steps in this plan file.

### Task 2: Write the failing provider-resolution tests

**Files:**
- Create: `src/renderer/src/lib/aiProviderProfiles.test.mjs`
- Create: `src/main/services/aiStudioProviderConfigHelpers.test.mjs`
- Modify: `src/renderer/src/lib/aiProviderProfiles.ts`
- Create: `src/main/services/aiStudioProviderConfigHelpers.ts`

**Step 1: Write the failing renderer helper test**

Cover:
- task-scoped image provider/model selection beats global fallback
- global fallback is used when task provider/model is missing

**Step 2: Run the renderer helper test to verify it fails**

Run: `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`

Expected: FAIL because the helper does not exist yet.

**Step 3: Write the failing main helper test**

Cover:
- image-task provider config resolves `baseUrl / apiKey / endpointPath` from task + profiles
- fallback still works for legacy tasks with no provider

**Step 4: Run the main helper test to verify it fails**

Run: `node --test src/main/services/aiStudioProviderConfigHelpers.test.mjs`

Expected: FAIL because the helper does not exist yet.

### Task 3: Implement shared provider-resolution helpers

**Files:**
- Modify: `src/renderer/src/lib/aiProviderProfiles.ts`
- Create: `src/main/services/aiStudioProviderConfigHelpers.ts`

**Step 1: Implement the renderer helper**

Add a pure resolver for task-scoped provider/model lookup against `aiProviderProfiles`.

**Step 2: Run the renderer helper test**

Run: `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`

Expected: PASS

**Step 3: Implement the main-process helper**

Export a pure function that turns global config + optional task into the effective provider config used by `AiStudioService`.

**Step 4: Run the main helper test**

Run: `node --test src/main/services/aiStudioProviderConfigHelpers.test.mjs`

Expected: PASS

### Task 4: Move image task creation and validation to task-scoped provider/model

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/main/services/aiStudioService.ts`

**Step 1: Write the failing behavior in existing tests or helper-backed tests**

Ensure current tests demonstrate image flows still depend on global `aiApiKey` / hardcoded provider before implementation.

**Step 2: Implement image task seeding**

Update image task creation/import/reset paths so image tasks store the resolved provider/model instead of hardcoding `grsai`.

**Step 3: Implement image workflow validation**

Replace global `aiConfig.aiApiKey` guards with task-scoped provider resolution for:
- start master workflow
- retry master generation
- start child workflow
- send child outputs if applicable

**Step 4: Switch main service image config lookup**

Make `AiStudioService` use the new helper so image tasks resolve provider config from task-scoped provider/model, not just global compatibility fields.

**Step 5: Run focused tests**

Run:
- `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`
- `node --test src/main/services/aiStudioProviderConfigHelpers.test.mjs`

Expected: PASS

### Task 5: Replace the image dropdown with an in-studio model configurator

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Add the failing UI-adjacent behavior through helper tests**

Use the resolver tests to pin the selection behavior before changing the UI.

**Step 2: Implement image model configurator**

Build a modal patterned after the video model configurator with:
- provider tabs
- provider editor
- model chips
- add/save/delete/test actions

**Step 3: Wire model choice into the current image task**

Selecting a model must update:
- current image task `provider`
- current image task `model`
- compatibility fields in config as the latest active fallback

**Step 4: Run type-aware verification**

Run: `npm run typecheck:web`

Expected: PASS

### Task 6: Remove the Settings AI panel

**Files:**
- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Step 1: Remove the AI service card and dead local state**

Delete the UI, helper functions, and local state that only supported the Settings AI panel.

**Step 2: Keep passive config persistence intact**

Do not delete the underlying config fields; only remove the Settings editing surface.

**Step 3: Run typecheck again**

Run: `npm run typecheck:web`

Expected: PASS

### Task 7: Final verification

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/renderer/src/components/modules/Settings.tsx`
- Create: `src/renderer/src/lib/aiProviderProfiles.test.mjs`
- Create: `src/main/services/aiStudioProviderConfigHelpers.test.mjs`

**Step 1: Run focused automated tests**

Run:
- `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`
- `node --test src/main/services/aiStudioProviderConfigHelpers.test.mjs`
- `node --test src/main/services/aiStudioRequestPayloadHelpers.test.mjs`

Expected: PASS

**Step 2: Run project typechecks**

Run:
- `npm run typecheck:node`
- `npm run typecheck:web`

Expected: PASS

**Step 3: Prepare commit checkpoint**

Summarize:
- image-task provider/model flow
- image model configurator
- Settings AI panel removal
- verification evidence
