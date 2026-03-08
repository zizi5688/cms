# AI 模型下拉设计

**背景**
AI 服务当前要求用户手动输入 GRSAI 模型名，容易因记忆错误或文档差异导致请求失败；同时 Base URL 与模型名职责分离不够直观。

**目标**
将 AI 工作台任务级模型与设置页默认模型改为下拉选择，默认展示 GRSAI Nano Banana 文档当前可见模型，并保留“自定义模型”兜底入口，减少误填成本。

**方案**

1. 新增一份共享的 GRSAI 模型元数据清单，供设置页与工作台复用。
2. 任务级“模型”由自由输入改为下拉；选择“自定义模型”时展开文本输入框。
3. 设置页“默认模型”同步改为下拉；默认占位不再误导用户手填任意值。
4. 补充 Base URL 文案，明确“只填 Host，不填接口路径”。

**范围**

- `src/renderer/src/components/modules/AiStudio/ControlPanel.tsx`
- `src/renderer/src/components/modules/Settings.tsx`
- `src/renderer/src/lib/grsaiModels.ts`

**验证**

- `npm run typecheck`
- 人工确认：设置页与 AI 工作台均可选择模型，且切换到自定义时仍可手填。
