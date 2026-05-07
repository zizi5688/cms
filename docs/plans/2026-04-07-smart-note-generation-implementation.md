# Smart Note Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI-powered smart generation flow for image-note creation that sends a default prompt, user extra prompt, group count, and the first pooled image to the local gateway chat model, then reuses the existing CSV-to-preview pipeline.

**Architecture:** Keep manual CSV entry untouched. In smart mode, build a single multimodal chat request from the default system prompt template plus user extra instructions and the current group count, parse the returned CSV code block, write it back into `noteCsvDraft`, and then call the existing note preview generation logic so group count, image count, and reuse behavior stay centralized.

**Tech Stack:** Electron, React, TypeScript, existing AI Studio IPC chat runtime, Node fetch executors, `.mjs` unit tests.

---

### Task 1: Smart Prompt And CSV Parsing Helpers

**Files:**
- Create: `src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.ts`
- Create: `src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`

**Step 1: Write the failing tests**

- Add a test for building the final smart prompt text from:
  - the hardcoded default prompt template
  - the user extra prompt replacing `{{USER_INPUT_PLACEHOLDER}}`
  - the appended line `商品请参考图片。请生成 N 组。`
- Add a test that extracts CSV from a fenced ````csv` code block.
- Add a test that rejects chat output without a valid CSV fence.

**Step 2: Run the tests to verify they fail**

Run: `node --test src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`

Expected: FAIL because the helper file does not exist yet.

**Step 3: Write the minimal implementation**

- Export:
  - `SMART_NOTE_DEFAULT_PROMPT_TEMPLATE`
  - `buildSmartNotePrompt`
  - `extractCsvFromSmartNoteResponse`
- Keep validation minimal and explicit.

**Step 4: Run the tests to verify they pass**

Run: `node --test src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`

Expected: PASS.

### Task 2: Multimodal Chat Payload Support

**Files:**
- Modify: `src/main/services/chatExecutor.ts`
- Modify: `src/main/services/chatExecutor.test.mjs`
- Reuse: `src/main/services/aiStudioGeminiInlineImageHelpers.ts`

**Step 1: Write the failing tests**

- Add an OpenAI-compatible chat payload test for `messages[0].content` containing:
  - one text part
  - one `image_url`
- Add a Gemini generateContent payload test for one text part plus one inline image.

**Step 2: Run the tests to verify they fail**

Run: `node --test src/main/services/chatExecutor.test.mjs`

Expected: FAIL because chat payload creation currently supports text-only messages.

**Step 3: Write the minimal implementation**

- Extend chat executor input normalization so chat requests can include `imageUrls`.
- For OpenAI-compatible routes, emit message content arrays with text and `image_url`.
- For Gemini-compatible routes, emit `parts` with `inlineData` plus text.
- Reuse existing data URL parsing assumptions already present in AI Studio services.

**Step 4: Run the tests to verify they pass**

Run: `node --test src/main/services/chatExecutor.test.mjs`

Expected: PASS.

### Task 3: Smart Generation Orchestration In AI Studio

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/NoteSidebar.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/preload/index.ts` only if IPC typing or exposure needs adjustment

**Step 1: Write the failing tests**

- Add helper-level tests around any extracted orchestration logic instead of trying to mount the whole UI.
- Cover:
  - smart mode requires at least one pooled image
  - smart mode sends the first pooled image
  - smart mode writes returned CSV back into state input
  - smart mode reuses the existing preview generation path
  - invalid AI response surfaces an error instead of silently continuing

**Step 2: Run the tests to verify they fail**

Run the targeted helper test file you add for orchestration.

Expected: FAIL because smart mode orchestration does not exist yet.

**Step 3: Write the minimal implementation**

- Add a smart/manual branch to image-note generate behavior.
- In smart mode:
  - validate first pooled image exists
  - build the final prompt with group count
  - send chat request through the existing AI Studio chat runtime with one image
  - extract CSV from the response
  - set `noteCsvDraft`
  - reuse current image-note preview generation logic
- Keep manual mode behavior unchanged.

**Step 4: Run the tests to verify they pass**

- Run the new orchestration test file.
- Run relevant existing note sidebar tests if touched.

### Task 4: Regression Verification

**Files:**
- Existing files touched in Tasks 1-3

**Step 1: Run focused tests**

Run:
- `node --test src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.test.mjs`
- `node --test src/main/services/chatExecutor.test.mjs`
- any new orchestration test file

**Step 2: Run type checking**

Run: `npm run typecheck:web`

Expected: PASS.

**Step 3: Smoke the app**

Run: `npm run dev`

Expected: image-note smart mode can request CSV and then show generated preview cards.

### Task 5: Commit Checkpoint

**Files:**
- Stage only the smart generation feature files and tests

**Step 1: Summarize checkpoint**

- Smart mode uses local gateway chat with the first pooled image.
- Manual mode remains the original CSV path.
- Invalid chat output fails loudly.

**Step 2: Verify status**

Run: `git status --short`

**Step 3: Commit after user confirmation**

Suggested commit:

```bash
git commit -m "feat: 接入图文智能生成会话流程 / add smart image-note chat flow"
```
