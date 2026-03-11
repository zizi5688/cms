# AI Studio 子图派送到数据工坊 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在正式版 AI 素材工作台 UI 中，支持多选/全选子图并一键发送到数据工坊，同时用开发态假数据验证链路畅通。

**Architecture:** 保持 AI Studio 与数据工坊解耦：AI Studio 只通过 `useCmsStore.workshopImport` 派送 `source='ai-studio'` 的图片路径列表，数据工坊继续沿用自身现有的预览任务生成逻辑。开发态假数据通过 `useAiStudioState` 写入 AI Studio 本地任务/素材表，不改正式两阶段界面结构。

**Tech Stack:** React、TypeScript、Zustand、electron-vite、现有 AI Studio 本地任务/素材 IPC。

---

### Task 1: 扩展派送协议

**Files:**
- Modify: `docs/plans/2026-03-08-ai-workshop-handoff-final-ui.md:1`
- Modify: `src/renderer/src/store/useCmsStore.ts`
- Modify: `src/renderer/src/components/modules/DataBuilder.tsx`

**Step 1: 让 `workshopImport` 支持 `source='ai-studio'` 与图片 `paths[]`**

**Step 2: 数据工坊识别 AI Studio 图片导入模式**

**Step 3: 直接接收图片路径列表并显示正常文件夹路径**

**Step 4: 禁用浏览/扫描并保持无绿色提示**

### Task 2: 扩展 AI Studio 状态动作

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`

**Step 1: 增加开发态假图生成 helper**

**Step 2: 增加 `seedDemoTask()` 注入正式 UI 假数据**

**Step 3: 增加子图全选/取消全选/发送动作**

**Step 4: 返回新增动作给正式 UI 组件使用**

### Task 3: 接入正式 UI 按钮

**Files:**
- Modify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Modify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`

**Step 1: 在 `ResultPanel` 增加多选工具条与发送按钮**

**Step 2: 在子图卡片上增加选中态与单卡切换按钮**

**Step 3: 在 `ControlPanel` 增加 DEV-only 联调工具区**

**Step 4: 空状态下也可注入假数据验证正式 UI**

### Task 4: 验证

**Files:**
- Verify: `src/renderer/src/components/modules/AiStudio/useAiStudioState.ts`
- Verify: `src/renderer/src/components/modules/AiStudio/ResultPanel.tsx`
- Verify: `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- Verify: `src/renderer/src/components/modules/DataBuilder.tsx`
- Verify: `src/renderer/src/store/useCmsStore.ts`

**Step 1: Run `npm run typecheck`**

**Step 2: Run `git diff --check`**

**Step 3: 启动 `npm run dev` 并在正式 UI 中点击“注入假数据”**

**Step 4: 选择/全选子图并点击“发送到数据工坊”做人工联调**
