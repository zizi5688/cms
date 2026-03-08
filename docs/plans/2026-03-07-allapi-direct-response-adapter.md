# ALLAPI Direct Response Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 AI Studio 对 ALLAPI 的 `chat/completions` 与 Gemini `generateContent` 端点使用对应请求体，并在同步返回图片时直接完成任务。

**Architecture:** 在 `AiStudioService` 内按端点协议分流：保留 GRSAI 旧链路；为自定义端点构造协议对应 payload，并把同步图片响应解析成现有输出资产。连接测试也按协议发送最小合法探测请求。

**Tech Stack:** Electron main process, TypeScript, fetch, existing SQLite run/task persistence.

---

### Task 1: 协议识别与请求体构造

**Files:**
- Modify: `src/main/services/aiStudioService.ts`

**Step 1:** 识别 `:generateContent` 与 `/chat/completions` 端点。
**Step 2:** 为 chat-completions 构造 `model + messages + modalities` 请求体。
**Step 3:** 为 generateContent 构造 `contents + responseModalities + imageConfig` 请求体。

### Task 2: 同步响应解析

**Files:**
- Modify: `src/main/services/aiStudioService.ts`

**Step 1:** 扩展结果解析，兼容 `choices[].message.content`、`images/data`、`candidates[].content.parts[].inlineData`。
**Step 2:** 若返回图片结果则直接落盘并标记 `succeeded`。
**Step 3:** 若返回任务 ID 则保留现有异步轮询模式。

### Task 3: 连接测试与前端提示

**Files:**
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1:** chat-completions 发送最小合法探测 body。
**Step 2:** 根据同步/异步结果调整提示文案，移除 GRSAI 固定字样。

### Task 4: 验证

**Files:**
- Modify: `src/main/services/aiStudioService.ts`
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`

**Step 1:** 运行 `npm run typecheck`。
**Step 2:** 记录验证结果，等待用户确认是否提交。
