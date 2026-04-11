# CDP Humanization Design

## Goal

Improve the CMS Chrome CDP publisher so mouse movement looks more human, silent window execution is verifiably stable on macOS, and key publishing steps include more natural observation delays without reducing the existing dryRun safety posture.

## Scope

This design covers three areas:

1. Humanized pointer movement in `src/cdp/human-input.ts`
2. Silent window strategy selection and validation for macOS in `src/cdp/chrome-launcher.ts`
3. Humanized step delays and verification tooling for the CDP publishing flow in `src/cdp/xhs-publisher.ts` and script-side validators

This design explicitly excludes:

1. Real publishing for validation
2. Automatic validation for the "window visible but covered by another app" scenario
3. Changes to the legacy Electron publishing path

## Constraints

1. Keep the existing CMS dedicated Chrome data dir model intact
2. Preserve the current stealth behavior (`webdriver=false`, `window.process` hidden on XHS publish pages)
3. Keep all DOM interaction on the CDP path using trusted low-level input
4. Default validation mode remains dryRun to avoid accidental publishing

## Architecture

### 1. Pointer Motion Model

`src/cdp/human-input.ts` will evolve from a simple cubic Bezier sampler into a motion model with four layers:

1. Curve shape:
   Generate a main Bezier path between start and end points, with randomized control points and optional overshoot near the target.
2. Velocity profile:
   Sample progress with a slow-in / fast-middle / slow-out easing function instead of uniform `t`.
3. Positional noise:
   Add small `+-1px` to `+-2px` jitter on intermediate points only, never on the first or final point.
4. Timing profile:
   Use shorter waits at launch and landing, with longer waits during the fast center segment so event timing is visibly non-uniform.

The module will also expose enough metadata for validation scripts to reason about path shape, event count, and timing variation.

### 2. Silent Window Strategy

`src/cdp/chrome-launcher.ts` will support explicit silent window modes:

1. `minimized`
   Use `Browser.setWindowBounds({ windowState: 'minimized' })`
2. `offscreen`
   Move the window to `left: 10000, top: 0`
3. `visible`
   No position change, used for debug and comparison

The launcher will keep today’s default behavior compatible, but the publisher and validation scripts will be able to request a specific mode. We will validate only `minimized` and `offscreen` this round and then choose the more stable one as the default silent strategy.

### 3. Humanized Step Delays

`src/cdp/xhs-publisher.ts` already contains jitter points, but they are mostly uniform. Those waits will be upgraded to Gaussian-like delays around behavior-specific means:

1. After video upload: 2-5 seconds
2. After title fill: 1-3 seconds
3. After content fill: 1-2 seconds
4. After topic/tag completion: 1-2 seconds
5. Before publish click: 2-4 seconds

This keeps the flow feeling like a user is visually checking the page before continuing.

### 4. Validation Layer

Validation will stay script-driven and dryRun-safe:

1. Extend `scripts/publish-test.ts` or add a sibling validator to:
   - select window mode
   - export the complete mouse event stream as JSON
   - summarize click-level path quality checks
2. Add a silent window comparison script that runs the same dryRun flow in:
   - mode A: minimized
   - mode B: offscreen
3. Add a repeat-run script or loop option to run five consecutive dryRun tasks and confirm:
   - each run succeeds
   - Chrome launches and closes every time
   - no lock conflicts remain after completion

## Data and Output

Validation outputs should be written to temporary or user-home JSON files so they are easy to inspect without polluting the repository. Each run should include:

1. run id
2. profile id
3. window mode
4. success/failure
5. screenshot paths
6. event log path
7. click path metrics
8. final stealth snapshot
9. Chrome close status

## Testing Strategy

### Functional

Run the existing dryRun chain end-to-end:

1. video upload
2. cover set
3. title fill
4. content fill with blue topics
5. product bind
6. dryRun publish highlight

### Motion Quality

For each click sequence, validate:

1. at least 15 `mousemove` events before click
2. coordinates show curvature and are not collinear
3. event intervals vary across the path
4. all `mousedown` and `click` events are trusted

### Silent Window Stability

Run the full dryRun chain in:

1. minimized mode
2. offscreen mode

Compare:

1. success rate
2. element targeting stability
3. screenshot fidelity
4. whether Chrome closes cleanly

### Repeatability

Run five consecutive dryRun tasks using the chosen default silent mode and confirm:

1. all succeed
2. Chrome is closed after each run
3. no stale singleton artifacts remain

## Risks

1. Overly aggressive jitter or overshoot could reduce click precision on small targets
2. macOS minimized windows may behave differently under CDP when file chooser or focus-sensitive controls appear
3. Humanized waits that are too long will slow throughput unnecessarily

## Recommended Default

Implement both `minimized` and `offscreen`, validate both, then choose the more stable one as the default for production CDP publishing. Until validation proves otherwise, prefer `offscreen` as the likely default because it tends to preserve a normal active window state while remaining visually silent.
