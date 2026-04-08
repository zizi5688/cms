# Flow Async Task Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Shift `flow-web-image` from a single blocking CMS request into an async submit/poll flow backed by local gateway task records, while raising the timeout budget to 300 seconds.

**Architecture:** The local gateway will own Flow task execution and persistence. CMS will submit a Flow task, store the gateway task id as the run remote id, and poll for status/result using the existing run loop. Non-Flow providers remain synchronous.

**Tech Stack:** TypeScript, Electron main/preload/renderer, local Fastify gateway, Flow browser automation.

---

### Task 1: Add gateway Flow task storage

**Files:**
- Create: `/Users/z/Ai 工具/Local AI Gateway/local-ai-gateway/src/server/repositories/flowTasksRepo.ts`
- Modify: `/Users/z/Ai 工具/Local AI Gateway/local-ai-gateway/src/server/http/app.ts`

**Step 1: Write the failing test**

- Add a repository test covering create, update, get, and list behavior for Flow task records.

**Step 2: Run test to verify it fails**

Run: `npm test -- flowTasksRepo`

**Step 3: Write minimal implementation**

- Add a small persistent store for task records using the gateway’s existing local DB/repository pattern.

**Step 4: Run test to verify it passes**

Run: `npm test -- flowTasksRepo`

### Task 2: Add async Flow submit and poll endpoints in the gateway

**Files:**
- Modify: `/Users/z/Ai 工具/Local AI Gateway/local-ai-gateway/src/server/http/app.ts`
- Modify: `/Users/z/Ai 工具/Local AI Gateway/local-ai-gateway/src/server/services/providerJobRunner.ts`

**Step 1: Write the failing test**

- Add route tests for:
  - submit returns `{ taskId, status }`
  - poll returns task status
  - success poll returns final inline image payload
  - failure poll returns task error

**Step 2: Run test to verify it fails**

Run: `npm test -- publicGeminiRoutes`

**Step 3: Write minimal implementation**

- Add `POST /v1/flow/tasks`
- Add `GET /v1/flow/tasks/:taskId`
- For `flow-web-image`, enqueue background execution instead of blocking the HTTP request.

**Step 4: Run test to verify it passes**

Run: `npm test -- publicGeminiRoutes`

### Task 3: Raise gateway Flow timeout budget to 300 seconds

**Files:**
- Modify: `/Users/z/Ai 工具/Local AI Gateway/local-ai-gateway/src/server/providers/flowBrowser/flowCdpProxyAutomation.ts`

**Step 1: Write the failing test**

- Update timeout expectation tests that currently encode 180 seconds.

**Step 2: Run test to verify it fails**

Run: `npm test -- flowCdpProxyAutomation`

**Step 3: Write minimal implementation**

- Change the Flow automation timeout budget and related expectation strings from 180 to 300 seconds.

**Step 4: Run test to verify it passes**

Run: `npm test -- flowCdpProxyAutomation`

### Task 4: Teach CMS main process to submit async Flow tasks

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/services/aiStudioService.ts`

**Step 1: Write the failing test**

- Add tests for:
  - Flow submit returns `submitted` with remote task id
  - Flow poll maps queued/running/succeeded/failed correctly
  - successful poll downloads outputs from returned inline image payload

**Step 2: Run test to verify it fails**

Run: `npm test -- aiStudioService`

**Step 3: Write minimal implementation**

- Detect Flow async route
- Submit task to gateway async endpoint
- Persist task id
- Poll gateway task endpoint inside `pollImageRunResult`

**Step 4: Run test to verify it passes**

Run: `npm test -- aiStudioService`

### Task 5: Raise CMS timeout budget to 300 seconds and update user-facing copy

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/services/aiStudioProviderErrorHelpers.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/main/services/aiStudioProviderErrorHelpers.test.mjs`

**Step 1: Write the failing test**

- Update timeout-message tests to expect 300-second text.

**Step 2: Run test to verify it fails**

Run: `npm test -- aiStudioProviderErrorHelpers`

**Step 3: Write minimal implementation**

- Change the default request timeout constant from 180s to 300s.

**Step 4: Run test to verify it passes**

Run: `npm test -- aiStudioProviderErrorHelpers`

### Task 6: Wire preload/renderer compatibility if needed

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/preload/index.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/preload/index.d.ts`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: Write the failing test**

- Add or update renderer/main boundary tests if async result shape changes.

**Step 2: Run test to verify it fails**

Run: `npm test -- useAiStudioState`

**Step 3: Write minimal implementation**

- Keep renderer polling loop intact unless IPC shape changes require a small compatibility update.

**Step 4: Run test to verify it passes**

Run: `npm test -- useAiStudioState`

### Task 7: End-to-end focused verification

**Files:**
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/docs/plans/2026-04-08-flow-async-task-design.md`
- Modify: `/Users/z/TraeBase/Project/CMS-2.0/docs/plans/2026-04-08-flow-async-task-implementation.md`

**Step 1: Run focused checks**

Run:

```bash
cd /Users/z/Ai\ 工具/Local\ AI\ Gateway/local-ai-gateway && npm test
cd /Users/z/TraeBase/Project/CMS-2.0 && npm test -- aiStudioProviderErrorHelpers
```

**Step 2: Manual smoke test**

- Submit:
  - 0 reference Flow image
  - 1 reference Flow image
  - 2 reference Flow image
- Confirm CMS immediately enters submitted/running, then later completes without false failure.

**Step 3: Prepare checkpoint**

- Summarize changed gateway files and CMS files.
- Report validation status.
- Ask `是否现在提交这个节点？`
