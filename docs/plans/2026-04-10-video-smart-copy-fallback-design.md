# Video Smart Copy Fallback Design

**Problem**

AI Studio's "video smart generation" is not a single video-only flow. In smart mode, it launches video rendering and chat-based copy generation in parallel, then waits for both branches before opening preview. Today, if the copy branch fails, the whole user flow feels broken even when the video branch already succeeded.

This is especially painful for the current environment because chat providers are unstable in two different ways:

- the local free route can intermittently fail after the upstream session is created, leaving the bridge with no readable turns
- the remote fallback route can fail with capacity or timeout errors

The product problem is not just "provider errors happen." The real problem is that one flaky copy branch is allowed to waste already-rendered video work.

**Goals**

- Keep generated video assets whenever the video branch succeeds.
- Add automatic copy-provider fallback for smart video-note generation.
- Restrict fallback to the copy branch only.
- Let users retry copy generation without re-running video rendering.
- Preserve current success behavior when the first copy provider works.
- Make logs and UI states clear enough to tell whether the failure came from the primary provider, the fallback provider, or both.

**Non-Goals**

- Building a general multi-hop AI router for all chat flows.
- Changing the standalone video-rendering path.
- Changing manual CSV entry behavior.
- Adding a new settings surface for copy-provider priority in this phase.
- Retrying video generation automatically.

## Recommended Approach

Treat smart video-note generation as a recoverable two-branch workflow:

- branch A: render video assets
- branch B: generate `标题,正文` CSV through the chat runtime

Branch B should attempt the configured default chat provider first. If that attempt fails, it should automatically retry once with a secondary enabled chat provider. If both copy attempts fail but branch A succeeds, the workflow should transition into a partial-failed recovery state that preserves rendered video assets and enables a "retry copy only" path.

This is the smallest design that meaningfully improves user outcome. It avoids inventing a full routing system while still covering the two real failure modes already observed in production-like use: local bridge instability and remote provider saturation.

## User Experience

### Smart Generation Happy Path

When the primary copy provider succeeds, the behavior stays the same:

- the app starts copy generation and video rendering together
- whichever branch finishes first waits for the other
- once both are ready, preview opens normally

### Automatic Fallback Path

When the primary copy provider fails but the fallback provider succeeds:

- the user should not see a blocking error
- preview should still open as a normal successful smart-generation result
- the activity log should record that copy generation automatically switched providers

The fallback should be mostly invisible to the user because the user outcome is still a complete success.

### Partial Recovery Path

When both copy providers fail but video rendering succeeds:

- the workflow should preserve rendered preview assets
- the UI should explicitly say that videos are ready but copy generation failed
- the user should be able to retry copy generation only
- retrying copy should not re-run `videoComposer.startGenerate()`

This changes the user experience from "the whole smart generation failed" to "the expensive part is done, only the copy branch needs recovery."

## Provider Fallback Rules

### Primary Provider

Use the current `chatProviderId` route as the first copy-generation attempt. This keeps the feature aligned with existing settings and respects the user's current default chat route.

### Secondary Provider

If the primary attempt fails, select the first other provider that satisfies all of these conditions:

- provider is enabled
- provider is not deleted
- provider has chat capability enabled
- provider has at least one enabled chat model
- provider has a non-empty API key
- provider is not the same provider used in the failed primary attempt

Only one fallback attempt should be made. No third provider, no loop, no scoring system.

### Why Only One Fallback

One fallback is enough to cover the current failure pattern without turning the feature into a long, opaque retry chain. More hops would increase latency, complicate logs, and make user-facing recovery harder to reason about.

## State Model

The current video-note orchestration state is good at tracking branch success and failure, but not good enough to explain multi-attempt copy behavior. The copy branch needs to retain enough information to support automatic fallback and later manual recovery.

Recommended additions:

- `copyAttemptProviderName`
- `copyFallbackProviderName`
- `copyAttemptCount`
- `copyFailureHistory`
- `canRetryCopyOnly`
- `rawCopyText`

These fields should support three things:

1. UI state that can explain whether copy is still running, has switched providers, or is now recoverable.
2. Logs that can show both provider failures when needed.
3. A retry-copy-only action that can reuse the preserved rendered assets.

## Architecture

### 1. Renderer Orchestration

The smart video-note handler in [AiStudio.tsx](/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/AiStudio/AiStudio.tsx) remains the orchestration entrypoint, but the copy branch should stop assuming that `state.startChatRun()` always uses a single fixed route.

The renderer should:

- start video rendering as it does today
- start copy generation through a helper that can attempt primary then fallback provider
- update the orchestration state after each copy attempt
- preserve rendered assets if copy fails
- expose a retry-copy-only path when video assets already exist

### 2. Chat Attempt Resolution

The current `startChatRun()` path in [useAiStudioState.ts](/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/AiStudio/useAiStudioState.ts) resolves only the default chat provider. For this feature, the renderer needs access to:

- the primary configured chat route
- at most one eligible fallback route
- enough metadata to log which provider actually handled the successful copy result

This likely means introducing a small chat-route helper that returns an ordered candidate list rather than a single selection.

### 3. Recovery UI

The existing view-model layer around [videoNoteEditorHelpers.ts](/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/AiStudio/videoNoteEditorHelpers.ts) should surface a stronger recovery state:

- "视频已完成，等待文案返回"
- "文案已完成，等待视频生成"
- "文案生成失败，视频已保留，可重试文案生成"

The important product change is that the final message no longer implies that the whole smart-generation flow needs to be rerun.

## Logging

The log stream should capture:

- primary copy provider chosen
- primary failure summary
- fallback provider chosen
- fallback success or failure summary
- retry-copy-only attempts

If the fallback succeeds, the UI can stay quiet while logs carry the explanation. If both providers fail, logs should preserve both failures so future diagnosis can tell whether the issue is:

- local bridge/readback instability
- remote provider overload
- malformed response content

## Risks

### Provider Selection Drift

If fallback-provider selection is implemented differently in different places, the UI and actual runtime path will diverge. The candidate ordering should live in one helper, not be duplicated across the renderer.

### Hidden Latency

Automatic fallback adds one more copy attempt. That is acceptable, but only because it is limited to a single extra provider. More than one fallback would make the user wait too long without enough value.

### State Complexity

The orchestration state becomes more expressive. If the new fields are added directly inside `AiStudio.tsx` without keeping the state transitions pure and testable, the code will get messy fast. The transition rules should remain concentrated in helper/state functions with targeted tests.

## Testing Strategy

- pure state tests for fallback success and fallback failure
- editor/view-model tests for recovery messaging
- orchestration tests proving retry-copy-only does not rerun video rendering
- regression coverage for existing copy-first and video-first success paths
- targeted web typecheck after renderer changes

## Rollout

Phase 1:

- add one-primary-one-fallback copy generation
- preserve rendered video assets after copy failure
- add retry-copy-only recovery
- improve logs and recovery messaging

Phase 2, if needed:

- richer provider-priority controls in settings
- smarter fallback scoring
- copy-only retry counters or rate limiting
