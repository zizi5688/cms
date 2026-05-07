# Video Smart Copy Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make AI Studio video smart generation resilient to chat-provider failures by automatically falling back once for the copy branch, preserving rendered video assets, and allowing copy-only retry when videos already succeeded.

**Architecture:** Keep video rendering behavior unchanged. Extend the renderer-side video-note orchestration to resolve an ordered chat-provider candidate list, attempt primary then fallback copy generation, persist branch-level failure history, and support a recovery path that retries copy generation without rerunning `videoComposer.startGenerate()`.

**Tech Stack:** Electron, React, TypeScript, renderer orchestration helpers, AI provider profile helpers, Node `node:test` `.mjs` unit tests.

---

### Task 1: Extend Video Note Orchestration State For Copy Fallback

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`

**Step 1: Write the failing tests**

- Add a test where copy branch fails once, fallback succeeds, and the final state is still preview-ready.
- Add a test where copy branch fails twice, render succeeds, and the final state preserves `previewAssets` while enabling `canRetryCopyOnly`.
- Add a test that copy failure history records provider names and messages in attempt order.
- Keep existing waiting-copy, waiting-video, and ready-preview tests green.

**Step 2: Run test to verify it fails**

Run: `node --test src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`

Expected: FAIL because the current state model has no fallback-attempt fields or recovery flag.

**Step 3: Write minimal implementation**

- Add orchestration fields for:
  - `copyAttemptProviderName`
  - `copyFallbackProviderName`
  - `copyAttemptCount`
  - `copyFailureHistory`
  - `canRetryCopyOnly`
  - `rawCopyText`
- Add state updates for:
  - copy attempt start
  - copy fallback handoff
  - copy success after fallback
  - copy failure with rendered assets preserved
- Keep merge-status derivation pure and centralized.

**Step 4: Run test to verify it passes**

Run: `node --test src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`

Expected: PASS.

### Task 2: Add Chat Candidate Resolution Helpers

**Files:**
- Modify: `src/renderer/src/lib/aiProviderProfiles.ts`
- Modify: `src/renderer/src/lib/aiProviderProfiles.test.mjs`

**Step 1: Write the failing tests**

- Add a test that returns the configured default chat provider as the first candidate.
- Add a test that returns one eligible fallback candidate after the primary when another enabled chat provider exists.
- Add a test that excludes deleted, disabled, or missing-API-key providers from fallback.
- Add a test that never returns the same provider twice.

**Step 2: Run test to verify it fails**

Run: `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`

Expected: FAIL because no ordered chat-candidate helper exists yet.

**Step 3: Write minimal implementation**

- Add a helper that resolves ordered chat-provider candidates from:
  - `chatProviderId`
  - provider profile list
  - provider enablement
  - chat capability availability
  - API key presence
- Limit the result to primary plus one fallback.
- Reuse existing provider-normalization helpers instead of re-implementing filtering logic.

**Step 4: Run test to verify it passes**

Run: `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`

Expected: PASS.

### Task 3: Teach AI Studio State To Run Copy Generation Against A Specific Chat Provider

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.test.mjs`

**Step 1: Write the failing tests**

- Add a test that resolves primary and fallback chat candidates from current AI config.
- Add a test that `startChatRun()` can accept an explicit provider/model route override and still validate API key, model, and endpoint requirements.
- Add a test that default behavior remains unchanged when no explicit override is supplied.

**Step 2: Run test to verify it fails**

Run: `node --test src/renderer/src/components/modules/AiStudio/useAiStudioState.test.mjs`

Expected: FAIL because `startChatRun()` only uses the default chat selection today.

**Step 3: Write minimal implementation**

- Extend `startChatRun()` so it can accept an optional explicit provider/model/endpoint selection.
- Add a helper that exposes ordered chat candidates for the video smart-generation flow.
- Keep existing plain chat behavior unchanged when no override is passed.

**Step 4: Run test to verify it passes**

Run: `node --test src/renderer/src/components/modules/AiStudio/useAiStudioState.test.mjs`

Expected: PASS.

### Task 4: Add Recovery Messaging For Video Smart Generation

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/videoNoteEditorHelpers.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/videoNoteEditorHelpers.test.mjs`

**Step 1: Write the failing tests**

- Add a test for the state `renderStatus = success`, `copyStatus = error`, `canRetryCopyOnly = true`.
- Expect the status copy to say that videos are preserved and copy generation can be retried.
- Add a test for fallback-in-progress messaging if that state is surfaced.

**Step 2: Run test to verify it fails**

Run: `node --test src/renderer/src/components/modules/AiStudio/videoNoteEditorHelpers.test.mjs`

Expected: FAIL because the current helper only distinguishes generic copy failure vs video failure.

**Step 3: Write minimal implementation**

- Update the view-model helper to produce recovery-focused status copy.
- Keep manual-mode labels unchanged.

**Step 4: Run test to verify it passes**

Run: `node --test src/renderer/src/components/modules/AiStudio/videoNoteEditorHelpers.test.mjs`

Expected: PASS.

### Task 5: Implement Primary-Then-Fallback Copy Generation In AI Studio

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`
- Reuse: `src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.ts`
- Reuse: `src/renderer/src/components/modules/AiStudio/videoNotePreviewHelpers.ts`

**Step 1: Write the failing tests**

- Extract a small helper if needed so the copy-attempt sequence can be tested without rendering the full component tree.
- Add tests covering:
  - primary provider success
  - primary failure then fallback success
  - primary failure then fallback failure with video preserved
  - copy-only retry using existing rendered assets
  - copy-only retry does not call `videoComposer.startGenerate()`

**Step 2: Run test to verify it fails**

Run the new targeted orchestration test file you add for this task.

Expected: FAIL because `AiStudio.tsx` currently fires one chat request only and has no retry-copy-only path.

**Step 3: Write minimal implementation**

- Replace the single copy request in smart video generation with:
  - resolve primary/fallback candidates
  - run primary copy attempt
  - if primary fails, record failure and try fallback once
  - if fallback succeeds, continue normal success flow
  - if both fail and videos exist, enter recovery state
- Add a copy-only retry handler that:
  - reuses `videoNoteGenerationState.previewAssets`
  - reruns chat generation only
  - opens preview directly on success
- Add log lines for:
  - primary provider chosen
  - fallback triggered
  - fallback success
  - both providers failed
  - copy-only retry started/succeeded/failed

**Step 4: Run test to verify it passes**

Run the new targeted orchestration test file.

Expected: PASS.

### Task 6: Regression Verification For Existing Video-Note Smart Flow

**Files:**
- Existing files touched in Tasks 1-5

**Step 1: Run focused tests**

Run:
- `node --test src/renderer/src/components/modules/AiStudio/videoNoteGenerationOrchestrator.test.mjs`
- `node --test src/renderer/src/lib/aiProviderProfiles.test.mjs`
- `node --test src/renderer/src/components/modules/AiStudio/useAiStudioState.test.mjs`
- `node --test src/renderer/src/components/modules/AiStudio/videoNoteEditorHelpers.test.mjs`
- `node --test src/renderer/src/components/modules/AiStudio/videoNotePreviewHelpers.test.mjs`

Expected: PASS.

**Step 2: Run type checking**

Run: `npm run typecheck:web`

Expected: PASS.

**Step 3: Manual smoke verification**

Run: `npm run dev`

Verify:
- smart video generation still works when primary copy provider succeeds
- if the primary copy provider is intentionally broken, fallback provider can still complete the copy branch
- if both copy providers fail, rendered video assets remain available and the UI offers copy-only retry
- copy-only retry succeeds without re-running video generation

### Task 7: Commit Checkpoint

**Files:**
- Stage only the video smart copy-fallback files and tests

**Step 1: Summarize checkpoint**

- Report changed renderer/helper/test files.
- Report focused test results and typecheck status.
- Report whether manual smoke reached:
  - primary success
  - fallback success
  - recovery state

**Step 2: Ask for commit approval**

Question: `是否现在提交这个节点？`
