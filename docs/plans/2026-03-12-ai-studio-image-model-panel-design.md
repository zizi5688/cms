# AI Studio 图片模型独立面板设计

## 背景

当前 AI Studio 的视频任务已经改为“任务自身持有 provider / model / endpoint”的工作方式，配置入口也集中在 AI Studio 内部的独立模型面板里。

图片任务仍存在两处不一致：

- 控制面板只暴露了固定图片模型下拉，没有视频侧那种供应商/模型独立面板。
- 图片运行前与初始化阶段仍会依赖 Settings 页里的兼容字段 `aiProvider / aiBaseUrl / aiApiKey / aiDefaultImageModel / aiEndpointPath`。

这会导致图片任务在以下场景中出现配置串用：

- 初始化新任务时回退到 Settings 中的旧值。
- 切换历史图片任务后，运行链路仍可能读到全局兼容字段，而不是当前任务的真实模型配置。
- Settings 与 AI Studio 同时承担配置职责，来源不明确。

## 目标

- 图片模型入口改为与视频模块一致的独立配置面板。
- 图片任务像视频任务一样，保存当前使用的 `provider + model`。
- 图片运行时按“当前任务 + aiProviderProfiles”解析出 `baseUrl / apiKey / endpointPath`。
- Settings 页面暂时移除 AI 配置面板，AI 相关管理收口到 AI Studio。
- 保留兼容字段作为“最近一次激活选择”的回退值，避免破坏旧配置与迁移逻辑。

## 非目标

- 本次不拆出图片专用的第二套 provider profile 存储。
- 本次不改模板存储结构。
- 本次不重做视频模型面板，仅让图片侧与其行为对齐。

## 根因

根因不是“图片下拉样式不对”，而是图片任务的数据归属仍偏向全局设置：

1. 图片任务创建时默认 `provider` 被硬编码为 `grsai`。
2. 图片工作流启动前只检查 `aiConfig.aiApiKey`，没有按任务解析当前 provider 的 API Key。
3. 主服务层对图片请求默认优先使用全局兼容配置，只有视频任务才明确走任务化 provider/profile 解析。

因此 UI 即使换成独立面板，只要运行时仍读全局配置，初始化问题仍会保留。

## 方案

采用任务作用域方案：

### 1. 图片任务持有选择

图片任务在创建、继承和切换模型时，都显式保存：

- `task.provider`
- `task.model`

其中：

- 有继承来源时，优先继承来源任务的 `provider / model`
- 无继承来源时，回退到当前兼容字段解析出的激活 provider/model
- 若仍无值，则回退到 `aiProviderProfiles[0]` 或默认图片模型

### 2. 图片运行时解析

为图片任务增加统一的 provider 解析逻辑：

- 输入：`task.provider`、`task.model`、`config.aiProviderProfiles`、兼容字段
- 输出：`providerName / baseUrl / apiKey / modelName / endpointPath`

解析顺序：

1. 当前任务指定的 provider / model
2. 当前兼容字段记录的最近一次激活选择
3. `aiProviderProfiles` 中的首个 provider / 默认模型
4. 最终兜底到默认图片模型

运行前校验看当前任务解析结果，而不是只看全局 `aiApiKey`。

### 3. 图片面板 UI

图片控制区把原有单一模型下拉替换为与视频同风格的弹层面板：

- 顶部是供应商 tabs
- 中间编辑当前供应商的 Host / API Key
- 下方管理模型名与 API 端点
- 点击模型后立即切换到当前图片任务
- 支持新增、保存、删除、测试连接

视觉语言沿用现有视频模型面板，不另起风格。

### 4. 兼容字段保留

虽然 Settings 面板会移除，但以下兼容字段继续保留并持久化：

- `aiProvider`
- `aiBaseUrl`
- `aiApiKey`
- `aiDefaultImageModel`
- `aiEndpointPath`

用途：

- 记录最近一次激活的图片 provider/model
- 为首次创建图片任务提供回退值
- 保持主进程现有迁移逻辑可继续工作

### 5. Settings 页面处理

Settings 页移除整块 AI 服务面板与其本地交互状态。

保留配置读写字段本身，不删除底层存储，避免影响现有主进程与迁移逻辑。

## 验证标准

- 新建图片任务后，图片模型面板可创建/保存 provider 与 model。
- 选择某个图片模型后，当前图片任务的 `provider / model` 会同步更新。
- 重新打开历史图片任务时，生成链路读取的是该任务自己的 provider/model，而不是 Settings 的旧值。
- 图片主流程、重试主图、启动子流程等前置校验均按任务解析 API Key。
- Settings 页面不再展示 AI 服务配置面板。

## 风险与回退

- 风险：图片与视频共用 `aiProviderProfiles`，删除 provider 时要兼顾当前任务回退逻辑。
- 风险：老任务可能没有 `provider`，需要保留兼容字段回退。
- 回退方式：保留兼容字段与 providerProfiles 存储结构，不做破坏性迁移；如需恢复 Settings 面板，可直接基于现有配置结构重新挂回。
