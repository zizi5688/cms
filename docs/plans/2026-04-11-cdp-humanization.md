# CDP Humanization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade CDP publishing with more human-like mouse motion, validated silent window strategies, Gaussian-like step delays, and repeatable dryRun verification.

**Architecture:** Extend the shared CDP input and launcher modules first, then wire those capabilities into the publisher and validation scripts, and finally run structured dryRun comparisons for minimized and offscreen modes. Validation output should prove both behavior realism and operational stability without performing real publishes.

**Tech Stack:** TypeScript, Puppeteer CDP, Electron main-process publisher integration, Node.js script validators

---

### Task 1: Baseline Discovery

**Files:**
- Modify: `docs/plans/2026-04-11-cdp-humanization.md`
- Inspect: `src/cdp/human-input.ts`
- Inspect: `src/cdp/chrome-launcher.ts`
- Inspect: `src/cdp/xhs-publisher.ts`
- Inspect: `scripts/publish-test.ts`

**Step 1: Record the current motion/window behavior assumptions**

Document the current state:

1. `humanMove` uses uniform Bezier sampling
2. silent mode is effectively "move offscreen or minimize on fallback"
3. publisher waits are mostly uniform jitter
4. validation is single-run dryRun only

**Step 2: Confirm no legacy Electron flow needs modification**

Check that the work will stay inside:

1. `src/cdp/`
2. `scripts/`
3. plan docs only

**Step 3: Commit checkpoint decision**

Do not commit yet. This is only baseline confirmation.

### Task 2: Human Motion Core

**Files:**
- Modify: `src/cdp/human-input.ts`
- Test: `scripts/publish-test-helpers.test.mjs`

**Step 1: Add motion utility helpers**

Add minimal helpers for:

1. easing function for slow-fast-slow progress
2. Gaussian-like random number helper or Box-Muller-based sampler
3. optional overshoot point selection
4. path metadata collection

**Step 2: Refactor path builder**

Update `buildMousePath` so it:

1. keeps Bezier curvature
2. uses eased progress rather than uniform `t`
3. adds bounded jitter on intermediate points
4. optionally inserts overshoot and correction subpath

**Step 3: Refactor time sampling**

Update `humanMove` so it:

1. emits at least 15 moves for clickable paths when distance is non-trivial
2. uses shorter waits near start/end
3. uses longer waits in the middle
4. preserves exact final target coordinates

**Step 4: Export metadata hooks**

Expose a small structure or callback path so validation code can inspect:

1. generated points
2. wait durations
3. overshoot usage

**Step 5: Run targeted validation**

Run: `npm run typecheck:node`

Expected: PASS

### Task 3: Silent Window Modes

**Files:**
- Modify: `src/cdp/chrome-launcher.ts`
- Modify: `src/cdp/xhs-publisher.ts`
- Modify: `scripts/cms-profile-runtime.ts`

**Step 1: Introduce explicit window mode type**

Add a typed window mode:

1. `visible`
2. `minimized`
3. `offscreen`

**Step 2: Replace the implicit helper**

Refactor the current window movement helper so callers can request a specific mode and get a structured result back.

**Step 3: Wire the publisher path**

Update the CDP publisher flow so dryRun/debug can stay visible, while silent runs can explicitly choose `minimized` or `offscreen`.

**Step 4: Wire script-side runtime**

Keep the script helpers aligned with the production launcher so validation scripts test the same behavior.

**Step 5: Run targeted validation**

Run: `npm run typecheck:node`

Expected: PASS

### Task 4: Humanized Publish Delays

**Files:**
- Modify: `src/cdp/xhs-publisher.ts`

**Step 1: Add Gaussian-like delay helper**

Implement a helper that:

1. accepts `min`, `mean`, `max`
2. clamps output into range
3. returns natural-looking wait durations

**Step 2: Apply observation waits**

Insert waits after:

1. video upload success
2. title fill
3. content fill
4. topic/tag completion
5. pre-publish action

**Step 3: Preserve existing safety checks**

Do not remove:

1. dryRun highlight behavior
2. final form validation
3. stealth setup

**Step 4: Run targeted validation**

Run: `npm run typecheck:node`

Expected: PASS

### Task 5: Event Log Export and Motion Assertions

**Files:**
- Modify: `scripts/publish-test.ts`
- Modify: `scripts/publish-test-helpers.ts`
- Create: `scripts/window-mode-compare.ts`

**Step 1: Extend event logging**

Capture:

1. event type
2. timestamp
3. coordinates
4. trusted flag
5. click grouping markers where possible

**Step 2: Add motion quality checks**

Implement assertions for:

1. `mousemove >= 15` before each click
2. non-collinear path shape
3. varied inter-event timing
4. trusted `mousedown`/`click`

**Step 3: Export JSON report**

Write a per-run JSON file with:

1. screenshots
2. window mode
3. final detection snapshot
4. event metrics
5. run success

**Step 4: Run targeted validation**

Run one dryRun publish flow and inspect the JSON output.

### Task 6: Window Mode Comparison

**Files:**
- Create: `scripts/window-mode-compare.ts`
- Modify: `scripts/publish-test.ts`

**Step 1: Add mode parameter plumbing**

Allow the publish validator to accept:

1. `--window-mode minimized`
2. `--window-mode offscreen`
3. `--window-mode visible`

**Step 2: Build comparison runner**

Create a script that runs the same dryRun flow twice:

1. once minimized
2. once offscreen

**Step 3: Summarize stability**

Print and save:

1. pass/fail per mode
2. total duration
3. stealth snapshot
4. event quality result
5. screenshot paths

**Step 4: Run targeted validation**

Run: `node --experimental-strip-types scripts/window-mode-compare.ts --profile cms-profile-2`

Expected: Both modes complete, or the less stable mode fails with a useful error.

### Task 7: Five-Run Stability Loop

**Files:**
- Create: `scripts/publish-dryrun-batch.ts`
- Modify: `scripts/publish-test.ts`

**Step 1: Add repeatable runner input**

Support passing a chosen default window mode and a run index into the publish validator.

**Step 2: Implement batch runner**

Run the dryRun chain five times in sequence and record for each run:

1. start/end time
2. success/failure
3. Chrome close status
4. singleton lock cleanup status

**Step 3: Produce batch summary**

Write a summary JSON plus terminal table.

**Step 4: Run targeted validation**

Run: `node --experimental-strip-types scripts/publish-dryrun-batch.ts --profile cms-profile-2 --count 5`

Expected: 5 successful dryRun runs and no lingering Chrome lock conflict.

### Task 8: Final Verification and Documentation

**Files:**
- Modify: `docs/plans/2026-04-11-cdp-humanization.md`

**Step 1: Run node typecheck**

Run: `npm run typecheck:node`

Expected: PASS

**Step 2: Run window comparison**

Run: `node --experimental-strip-types scripts/window-mode-compare.ts --profile cms-profile-2`

Expected: Report generated

**Step 3: Run five-run batch**

Run: `node --experimental-strip-types scripts/publish-dryrun-batch.ts --profile cms-profile-2 --count 5`

Expected: 5/5 success

**Step 4: Update plan notes with chosen default**

Record which mode won:

1. `offscreen`
2. `minimized`

plus any caveats discovered during validation.

**Step 5: Commit checkpoint**

At the end of implementation, summarize the verified scope and ask:

`是否现在提交这个节点？`
