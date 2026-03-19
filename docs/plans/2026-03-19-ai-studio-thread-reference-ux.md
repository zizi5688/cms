# AI Studio Thread Reference UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 AI Studio 增加线程缩略图“再次参考”、线程来源目录快捷打开，以及提示词输入框图片粘贴导入。

**Architecture:** 把新增行为尽量沉到纯 helper 中测试，再把组件层接到现有 `PreviewActionButton`、`shellShowItemInFolder` 和 `cms.image.saveBase64` 通道上。输入规则继续复用 `addInputImages`，避免新建第二套导入逻辑。

**Tech Stack:** React, TypeScript, Electron preload/main IPC, node:test.

---

### Task 1: 新增可测试 helper

**Files:**
- Create: `src/renderer/src/components/modules/AiStudio/threadInteractionHelpers.ts`
- Test: `src/renderer/src/components/modules/AiStudio/threadInteractionHelpers.test.mjs`

**Step 1:** 写失败测试，覆盖“输出文件路径解析到父级来源目录”。
**Step 2:** 写失败测试，覆盖“从粘贴事件提取图片文件、过滤非图片、保留路径/Blob 项”。
**Step 3:** 写最小实现，让测试转绿。

### Task 2: 接入线程区交互

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`

**Step 1:** 给线程缩略图接入 hover 容器与“再次参考”按钮。
**Step 2:** 在线程文本末尾加入“打开保存文件夹”按钮。
**Step 3:** 失败时沿用现有日志与弹窗反馈。

### Task 3: 接入粘贴图片导入

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/TaskQueue.tsx`

**Step 1:** 先写失败测试对应的组件调用路径。
**Step 2:** 在 `Textarea` 上实现 `onPaste`。
**Step 3:** 复用 `addInputImages`，让粘贴图片直接进入现有参考图区。

### Task 4: 补最小 IPC 类型与验证

**Files:**
- Modify: `src/preload/index.d.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

**Step 1:** 仅在需要时补充图片保存桥接类型，不重复造已有能力。
**Step 2:** 运行 AI Studio 相关测试与 `npm run typecheck`。
**Step 3:** 整理一个可提交 checkpoint，等待用户确认是否提交。
