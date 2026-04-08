# Video Note Smart And Manual Entry Design

**Background**

AI Studio already supports two entry paths for image-note creation:
- manual CSV entry, then preview generation
- smart generation, where AI returns `标题,正文` CSV and the UI reuses the existing preview pipeline

Video-note creation currently only supports manual CSV entry. The goal of this change is to bring the same smart/manual entry experience to video notes without adding reference-image input for now.

**Goal**

Unify image-note and video-note entry behavior so video notes also support:
- `手动录入`: user provides CSV directly
- `智能生成`: user provides prompt text, AI returns `标题,正文` CSV

In smart mode, the system must tolerate two asynchronous completion orders:
- videos finish first, while CSV is still pending
- CSV returns first, while videos are still pending

The UI should preserve whichever side has completed and only enter final preview after both sides are ready.

**Chosen Approach**

Use a two-branch video-note entry mode with parallel orchestration in smart mode.

- Manual mode keeps the current flow:
  - user edits CSV
  - user starts generation
  - video composer renders outputs
  - preview tasks are built from rendered videos plus CSV
- Smart mode introduces a new orchestration layer:
  - user edits prompt text instead of CSV
  - clicking generate starts AI CSV generation and video rendering in parallel
  - each side writes its result into temporary state as soon as it finishes
  - preview is built only after both CSV and rendered video assets are ready

This keeps the existing CSV-to-preview and video-render-to-preview logic reusable while adding a small state machine around the video-note workflow.

**Why This Approach**

This is the smallest change that fully covers the required async behavior.

- It avoids blocking video generation on AI latency.
- It avoids rerunning AI when only video rendering needs a retry.
- It avoids rerendering videos when only CSV generation fails.
- It preserves the existing manual flow with minimal regression risk.

Alternative approaches considered:
- serial smart flow: simpler, but cannot handle "video first, CSV later"
- two separate user-triggered buttons: flexible, but adds UI and mental overhead

**UX Changes**

In the video-note editor:
- add a `智能生成 / 手动录入` toggle matching the image-note pattern
- in manual mode, show the current CSV textarea
- in smart mode, replace the textarea meaning with prompt input copy
- keep the existing video source, template, and render controls unchanged

Generation feedback should show split progress:
- `文案生成中`
- `视频生成中`
- `视频已完成，等待文案`
- `文案已完成，等待视频`
- `可预览`

The primary action stays single-entry:
- manual mode: `开始生成`
- smart mode: still one click, but it launches both branches

**State Design**

Video-note generation needs explicit intermediate state separate from final preview state.

Recommended renderer state additions:
- `videoNoteEntryMode`: `'smart' | 'manual'`
- `videoSmartPromptDraft`: smart-mode input text
- `videoSmartCsvDraft`: latest CSV returned by AI for smart mode
- `videoPendingPreviewAssets`: rendered video assets waiting to be paired
- `videoGenerationStatus`: `'idle' | 'running-both' | 'waiting-copy' | 'waiting-video' | 'ready-preview' | 'partial-failed'`
- `videoCopyStatus`: `'idle' | 'running' | 'success' | 'error'`
- `videoRenderStatus`: `'idle' | 'running' | 'success' | 'error'`
- `videoCopyError` and `videoRenderError`

These fields can live in `AiStudio.tsx` local state if we want to keep this orchestration scoped to the note sidebar workflow.

**Data Flow**

Manual mode:
1. User stays in `手动录入`.
2. User edits CSV.
3. User clicks generate.
4. Existing `videoComposer.startGenerate()` runs.
5. On render completion, build preview tasks using current CSV.

Smart mode:
1. User switches to `智能生成`.
2. User enters prompt text.
3. User clicks generate.
4. UI starts two async operations at the same time:
   - smart CSV request via existing AI Studio chat runtime
   - video rendering via existing video composer
5. If CSV returns first:
   - cache CSV in state
   - update visible draft so user can inspect or reuse it
   - wait for rendered videos
6. If videos return first:
   - cache preview assets in state
   - wait for CSV
7. When both are ready:
   - call existing `buildGeneratedVideoNotePreviewTasks(csv, assets)`
   - enter preview phase

**Prompt Strategy**

The first version should reuse the same output contract as image-note smart generation:
- AI returns one fenced `csv` block
- header remains `标题,正文`

No reference images should be passed in this phase.

We can either:
- reuse `buildSmartNoteChatInput()` with video-specific logging and copy
- or extract a shared `buildSmartCsvChatInput()` helper with image/video wrappers

The important constraint is that smart video mode must stay text-only for now.

**Result Merging Rules**

Merge behavior should be deterministic:

- CSV success + video success:
  - build preview immediately
- CSV success + video pending:
  - keep CSV, show waiting-video state
- video success + CSV pending:
  - keep video assets, show waiting-copy state
- CSV failure + video success:
  - keep video assets and expose the returned assets as reusable pending output
  - allow retrying only the copy branch or switching to manual CSV input
- video failure + CSV success:
  - keep CSV and allow rerunning only video rendering
- both fail:
  - remain in editing state with both errors visible

**Error Handling**

Validation rules:
- smart mode requires non-empty prompt text
- manual mode requires non-empty CSV
- final preview assembly still requires parsable CSV
- render output count still follows existing composer constraints

User-visible behavior:
- never discard successful partial results automatically
- log branch-level outcomes separately
- only show final preview alerts when merge or preview assembly fails

**Testing Strategy**

Testing should focus on extracted orchestration helpers instead of mounting the entire UI.

Needed coverage:
- smart mode starts both async branches
- CSV-first path waits for videos and later merges
- video-first path waits for CSV and later merges
- CSV failure preserves video assets
- video failure preserves CSV
- manual mode behavior remains unchanged
- returned smart CSV is written back into draft state

Relevant areas:
- `smartNoteGenerationHelpers.test.mjs`
- a new orchestration helper test file under `AiStudio`
- existing `NoteSidebar` or helper tests only if the entry toggle extraction changes shared logic

**Implementation Boundaries**

Files likely involved:
- `src/renderer/src/components/modules/AiStudio/NoteSidebar.tsx`
- `src/renderer/src/components/modules/AiStudio/AiStudio.tsx`
- `src/renderer/src/components/modules/AiStudio/smartNoteGenerationHelpers.ts`
- a new helper test file for the parallel merge state machine

Out of scope for this phase:
- reference-image input for smart video notes
- changing video composer rendering internals
- changing preview task schema beyond what is needed to cache pending assets
- backend or storage persistence for unfinished smart video runs

**Open Assumptions**

- Smart video notes use the same CSV schema as smart image notes.
- Smart mode launches video rendering immediately instead of waiting for CSV.
- Partial success should be preserved only for the current UI session and does not need persistence.
- Existing branch-local untracked files remain untouched.
