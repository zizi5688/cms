# CMS Chrome CDP Publisher Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不删除旧 Electron 发布链路的前提下，把 CMS 新增一套可切换的 Chrome CDP 发布模式，并接入 CMS 专用 Chrome Profile 管理。

**Architecture:** 保留 `src/main/publisher.ts` 的队列、冷却、失败处理和发布会话广播，只在“单条任务执行器”这一层增加 `publishMode === 'cdp'` 分支。新分支通过 `src/cdp/` 里的 Chrome 启动器和 XHS 发布适配器驱动真实 Chrome；账号绑定、登录引导、静默验证和全局配置通过现有 IPC、SQLite `accounts` 表和设置页/账号面板做增量扩展。

**Tech Stack:** Electron main/preload, React renderer, Zustand, Electron Store, SQLite, Puppeteer pipe mode, CMS 专用 Chrome 数据目录 `~/chrome-cms-data`

---

### Task 1: 补齐 CDP 配置与数据模型

**Files:**
- Modify: `src/main/services/sqliteService.ts`
- Modify: `src/main/services/accountManager.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/store/useCmsStore.ts`

**Step 1:** 给 `accounts` 表增加 CMS Profile 绑定列（如 `cmsProfileId`），并保留旧 Electron 分区字段。

**Step 2:** 给 `CmsConfig` / `get-config` / `save-config` 增加 `publishMode`、`chromeExecutablePath`、`cmsChromeDataDir`。

**Step 3:** 扩展账号 IPC 返回结构，带上 `status`、`lastLoginTime`、`cmsProfileId`。

**Step 4:** 新增 IPC：列出 CMS Chrome Profiles、绑定账号到 CMS Profile、打开 CMS 登录、验证 CMS 登录态。

**Step 5:** 跑 node 侧类型检查，确保 IPC 和前端类型对齐。

### Task 2: 新建 CDP 适配层

**Files:**
- Create: `src/cdp/chrome-launcher.ts`
- Create: `src/cdp/human-input.ts`
- Create: `src/cdp/xhs-publisher.ts`
- Modify: `tsconfig.node.json`

**Step 1:** 迁移 `humanMove` / `humanClick` / `humanType` 到 `src/cdp/human-input.ts`。

**Step 2:** 在 `chrome-launcher.ts` 中实现 CMS 专用 Chrome 启动/关闭、SingletonLock 检查、`cms-accounts.json` 读取、登录引导和静默验证。

**Step 3:** 在 `xhs-publisher.ts` 中实现 XHS 发布函数：打开发布页、上传素材、填标题、填正文、打标签、点发布，并处理真实 UA、随机窗口尺寸和 jitter。

**Step 4:** 给关键步骤加结构化日志，便于复用 `publisher:session` 和故障排查。

### Task 3: 接入 publisher.ts 分支切换

**Files:**
- Modify: `src/main/publisher.ts`
- Modify: `src/main/publisherHelpers.ts`（如需）

**Step 1:** 读取新配置，保留旧 `BrowserWindow + preload/xhs-automation.ts` 流程不动。

**Step 2:** 在 `publishTask()` 中新增 `cdp` 分支：按账号绑定的 CMS Profile 启动 Chrome，执行发布，安全关闭。

**Step 3:** 处理异常和超时，把 CDP 错误映射回现有发布失败摘要和 session 广播。

**Step 4:** 确保队列逻辑、冷却、每日上限完全复用原实现。

### Task 4: 接入账号管理与设置 UI

**Files:**
- Modify: `src/renderer/src/components/AutoPublish/AutoPublishView.tsx`
- Modify: `src/renderer/src/components/modules/Settings.tsx`

**Step 1:** 设置页新增发布模式、Chrome 可执行文件路径、CMS 数据目录路径。

**Step 2:** 账号面板新增 CMS Profile 绑定下拉，显示昵称和登录状态。

**Step 3:** 在 CDP 模式下提供“登录/重新登录”“验证登录态”按钮；Electron 模式保留旧登录入口。

**Step 4:** 绑定变更后即时保存并刷新账号列表 / CMS Profile 列表。

### Task 5: 验证与回归

**Files:**
- Verify: `src/main/**/*`
- Verify: `src/preload/**/*`
- Verify: `src/renderer/src/**/*`

**Step 1:** 跑 `npm run typecheck`。

**Step 2:** 跑已有 Node 测试，补充必要的 helper 测试。

**Step 3:** 手动验证：
- CDP 模式单任务发布
- 不同账号切换到不同 CMS Profile
- Electron 模式回退仍可用
- 日常 Chrome 打开时不冲突

**Step 4:** 到达可提交节点后，按 `git-governance` 给出 checkpoint，并询问：`是否现在提交这个节点？`
