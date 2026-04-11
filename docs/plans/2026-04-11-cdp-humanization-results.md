# CDP Humanization Validation Results

## Scope Covered

This validation round covered:

1. Humanized mouse trajectory generation
2. Structured event logging and motion quality checks
3. Silent window mode validation for:
   - minimized
   - offscreen
   - edge-visible

This round did not complete the final "5 consecutive dryRun successes" goal because silent window stability was not yet sufficient to justify batch execution.

## Implemented Changes

### Mouse Motion

Updated `src/cdp/human-input.ts` to provide:

1. slow-fast-slow movement easing
2. non-uniform wait intervals
3. bounded micro-jitter
4. 10% overshoot correction path
5. plan metadata and dispatch callbacks
6. minimum 15 move points for positive-distance click paths

### Publish Validation Output

Updated `scripts/publish-test.ts` and `scripts/publish-test-helpers.ts` to provide:

1. event log JSON export
2. click-level path quality analysis
3. final stealth snapshot in structured reports
4. configurable window mode and hold timing
5. step-level debug logs
6. failure-step reports with screenshots and viewport snapshots

### Silent Window Modes

Added explicit window modes:

1. `visible`
2. `minimized`
3. `offscreen`
4. `edge-visible`

and propagated them into both:

1. `src/cdp/chrome-launcher.ts`
2. `scripts/cms-profile-runtime.ts`

## Observed Results

### Baseline Visible Run

Latest control run result: failed at the same cover-open step as the silent modes.

Observed failure:

1. video upload succeeds
2. cover entry is found
3. click coordinate is computed and dispatched
4. click completes
5. cover modal still does not appear after 3 retries

Interpretation:

The current blocker is not exclusive to silent window handling. It is narrowed to the cover-entry targeting/click chain itself.

### Mode A: Minimized

Result: failed

Observed failure:

1. `TargetCloseError: Protocol error (Input.dispatchMouseEvent): Target closed`

Interpretation:

On this macOS host, minimizing the Chrome window to Dock is not stable enough for full CDP interaction during the publish chain.

Conclusion:

`minimized` should not be used as the default silent strategy.

### Mode B: Offscreen

Result: failed

Observed failure patterns across runs:

1. one run stalled in `cover` before even reaching the modal-wait substep and timed out after 60s
2. effective viewport collapsed to `945x386`
3. failure screenshot showed the page still sitting on the cover section with no modal
4. transient execution-context or frame-detach style errors were also seen in earlier rounds

Mitigations attempted:

1. keep offscreen window active with `page.bringToFront()`
2. make wait helpers resilient to recoverable execution-context resets
3. align test cover flow with the production `selectCover()` implementation
4. add step-level debug logs and timeout classification

Interpretation:

`offscreen` still behaves worse than the visible-style modes because it can shrink into a bad effective viewport and even hang before the modal-wait substep.

Conclusion:

`offscreen` should not be the default silent strategy.

### Mode C: Edge-Visible

Result: failed, but behavior is cleaner than `offscreen`

Observed failure:

1. window is kept visible and moved to the bottom-right
2. effective viewport remains usable (`1100x693` in the latest run)
3. cover entry is found and clicked 3 times
4. every attempt reaches `waitForCoverModal()`
5. modal never appears

Interpretation:

`edge-visible` avoids the offscreen hang pattern, but it does not solve the underlying cover-open bug.

Conclusion:

`edge-visible` is the best silent-mode candidate so far, but it should not become the default until the cover-open selector/click issue is fixed.

## Motion Quality

The mouse-humanization work itself is behaving as designed:

1. trusted events remain true
2. timing intervals vary
3. paths are curved
4. metadata is exported for inspection

One visible-mode validation run initially failed the `15+ mousemove per click` rule on a short-distance click segment. The generator was then tightened so any positive-distance click path now uses at least 15 move points.

## Recommendation

Current recommendation:

1. do not switch production default to `minimized`
2. do not yet switch production default to `offscreen`
3. do not yet switch production default to `edge-visible`
4. treat the current blocker as a cover-open targeting bug, not a window-mode-only bug
5. once cover-open is fixed, re-test `edge-visible` first as the preferred silent candidate

## Next Suggested Work

1. align cover-open target selection with the proven Electron selector chain from `xhs-automation.ts`
2. capture the chosen cover-entry DOM snapshot and bounding box before each click attempt
3. keep `edge-visible` as the first re-test target after the selector fix
4. only after single-run `edge-visible` succeeds should the 5-run batch test be attempted
