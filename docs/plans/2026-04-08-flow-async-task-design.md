# Flow Async Task Design

**Goal:** Replace the current blocking Flow image request path with an asynchronous task flow so CMS no longer treats long-running Flow generations as terminal failures when the browser-side job is still progressing or the final 2K recovery is delayed.

## Problem

The current `flow-web-image` path is synchronous end-to-end:

- CMS sends one blocking `generateContent` request to the local gateway.
- The local gateway uploads references, triggers Flow, waits for generated images, optionally performs 2K recovery, and only then returns a Gemini-style response.
- Any timeout or protection event inside that single request is surfaced back to CMS as a hard failure.

This creates two false-failure modes:

1. Reference upload consumes most of the 180 second budget, so Flow starts generating only when CMS is about to time out.
2. Flow successfully generates an image, but 2K recovery or edit-view download exceeds the budget or hits protection, so CMS still marks the run failed.

## Desired Behavior

For `flow-web-image`, CMS should:

1. Submit a task and receive a gateway task id immediately.
2. Persist that task id as the remote task id for the run.
3. Poll the gateway task status on the existing `pollRun` loop.
4. Download/persist outputs only after the gateway reports success and exposes final inline image results.

The gateway should:

1. Accept a submit request and enqueue a background Flow job.
2. Persist task state transitions and result payloads.
3. Expose a status/result endpoint that CMS can poll.
4. Keep the existing synchronous public route behavior for non-Flow models.

## Scope

### In scope

- Add asynchronous task lifecycle for `flow-web-image` only.
- Increase timeout budget from 180s to 300s in both gateway and CMS.
- Return task ids immediately for Flow image generation requests.
- Let CMS poll gateway task state and reconcile completion.

### Out of scope

- Rewriting non-Flow providers to async.
- Building a generic distributed queue.
- Changing renderer UX beyond what is needed to honor the existing polling model.
- Reworking Flow browser automation semantics outside task orchestration and timeout budget.

## Architecture

### Gateway

Introduce a lightweight local task store in the gateway:

- `queued`
- `running`
- `succeeded`
- `failed`

Each task stores:

- task id
- provider/model metadata
- prompt summary
- reference count
- requested image size / output count
- created / started / finished timestamps
- error message
- final provider response payload

New gateway endpoints:

- `POST /v1/flow/tasks`
  - Creates an async Flow task and returns `{ taskId, status }`
- `GET /v1/flow/tasks/:taskId`
  - Returns current task status and, on success, the final provider-style image result payload

The public Gemini route for `flow-web-image` will internally use the async task runner and return a task-style envelope instead of blocking on the full browser session. CMS will be the first consumer of this behavior.

### CMS Main Process

For `flow-web-image` submit:

- detect async-capable gateway route
- submit the task
- store gateway task id as the run remote task id
- mark run `submitted`

For polling:

- poll the async task endpoint
- map gateway task states to CMS run states
- once `succeeded`, persist output assets from the returned inline image payload

### CMS Renderer

No new UX model is required. The existing `startRun -> pollRun` loop can stay intact if the main process now uses async gateway tasks behind the scenes.

## API Contract

### Submit response

```json
{
  "taskId": "flow-task-123",
  "status": "queued"
}
```

### Poll response

```json
{
  "taskId": "flow-task-123",
  "status": "running"
}
```

### Success response

```json
{
  "taskId": "flow-task-123",
  "status": "succeeded",
  "response": {
    "candidates": [
      {
        "content": {
          "parts": [
            {
              "inlineData": {
                "mimeType": "image/jpeg",
                "data": "<base64>"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### Failure response

```json
{
  "taskId": "flow-task-123",
  "status": "failed",
  "error": "FLOW_REQUEST_TIMEOUT: ..."
}
```

## Error Handling

- Gateway task failure remains visible, but only after the background task actually fails.
- CMS should no longer treat submit-time timeout as terminal for Flow async routes.
- If polling fails transiently, CMS keeps the run in `submitted`/`running` unless the gateway explicitly reports `failed`.
- Existing user-facing normalization for Flow timeout/protection messages remains useful, but now applies to polled task failure rather than synchronous submit failure.

## Timeout Change

Increase the request/task budget from 180 seconds to 300 seconds:

- Gateway Flow automation timeout
- CMS provider timeout normalization/message text

This is a secondary mitigation. It improves headroom, but the async task architecture is the real fix.

## Risks

- Gateway task state persistence must survive repeated polls and local restarts well enough for the current session.
- CMS must distinguish async Flow task ids from older direct-response or legacy task ids.
- We need to avoid breaking existing non-Flow Gemini-compatible paths.

## Verification

- Flow no-reference submit still succeeds.
- Flow one-reference submit returns a task id quickly and later resolves successfully by polling.
- Flow two-reference submit returns a task id quickly and later resolves successfully by polling.
- Gateway task records move through `queued/running/succeeded/failed`.
- Existing non-Flow image providers still work unchanged.
