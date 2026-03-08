# AI Result Open Buttons Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 AI Studio 结果大图卡片中增加“查看原图”和“打开所在文件夹”按钮，方便直接查看落盘文件。

**Architecture:** 复用现有 Electron shell 能力，不新增复杂状态。前端按钮仅针对当前主预览图，调用已存在的 `openPath` 与 `showItemInFolder` 通道。

**Tech Stack:** React, TypeScript, Electron preload/main shell helpers.

---

### Task 1: 复用现有系统能力

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/main/index.ts`

**Step 1:** 查找并复用现有 `openPath` / `showItemInFolder` 实现。
**Step 2:** 若 AI Studio 侧尚未暴露，则补最小 preload 类型与桥接。

### Task 2: 结果区按钮接入

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`

**Step 1:** 在主预览图卡片增加两个按钮。
**Step 2:** 无主图时禁用按钮。
**Step 3:** 失败时写日志并弹窗提示。

### Task 3: 验证

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`

**Step 1:** 运行 `npm run typecheck`。
**Step 2:** 重载 dev 确认按钮显示。
