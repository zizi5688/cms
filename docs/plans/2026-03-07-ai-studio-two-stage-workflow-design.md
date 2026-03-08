# AI Studio 两阶段工作流设计稿

- 日期：2026-03-07
- 状态：已确认
- 范围：在现有 `AI Studio` 单任务图生图基础上，收口为“母图 -> 去水印 -> 选当前AI母图 -> 子图串行生成”的两阶段工作流 MVP

## 1. 背景

当前 `AI Studio` 已经完成以下基础能力：

- 自定义 AI 供应商、模型、端点配置
- Gemini 原生 `generateContent` 图像生成接入
- 单次任务主图 + 参考图输入
- 结果预览、查看原图、打开所在文件夹
- 主提示词模板编辑与保存

同时，业务流程已经明确：

1. 从网络母图或已有素材出发，先生成多张 `AI 母图`
2. 从候选母图中选出 1 张合格结果
3. 将该结果先做现有“魔法去印”处理
4. 仅使用“去水印成功后的 AI 母图”继续生成多张独立子图
5. 子图生成使用固定主模板 + Variant 列表，按次串行调用 API

原先的 9 宫格只是 Gemini 网页版能力限制下的折中方案；在软件内接入原生 API 后，目标已经变为“多次独立调用，得到多张独立高清子图”。

## 2. 目标

本次改造只做最小可用的两阶段工作流，不扩散为批量任务平台。

目标是让用户在 `AI Studio` 内完成以下闭环：

- 配置母图输入与母图模板
- 连续生成多张 `AI 母图`
- 每张母图成功后自动调用现有去水印能力
- 只允许去水印成功的母图设为 `当前AI母图`
- 基于 `当前AI母图` 和子图模板 + Variant 列表，自动串行生成 `N` 张独立子图
- 某一张子图失败时，跳过失败并继续后续队列
- 在结果区清楚地区分：母图候选、当前AI母图、子图结果、失败记录

## 3. 非目标

本次不做以下内容：

- 多母图并行展开子图
- 多任务批量工作流
- 并发生成
- 自动筛选最优母图或最优子图
- 精细费用统计与供应商账单对账
- 失败项批量重试编辑器
- 内置系统提示词模板

## 4. 核心业务规则

### 4.1 母图规则

- 母图阶段支持数量选择，默认 `3`
- 母图阶段沿用现有主图/参考图输入方式
- 母图生成为串行调用；每次请求只要求模型返回 `1` 张图
- 某一张母图生成失败时，跳过失败，继续生成下一张母图

### 4.2 去水印规则

- 每张 `AI 母图` 成功后，立即自动调用现有“魔法去印”能力
- 去水印能力复用现有 `process-watermark` IPC 与底层 `cms_engine`
- 去水印成功后，生成对应的 `_Clean` 文件并作为母图候选默认预览
- 去水印失败时，该母图保留原始结果，但标记为“去水印失败”，不能进入子图阶段

### 4.3 当前AI母图规则

- 按钮文案统一改为：`设为当前AI母图`
- 只有“去水印成功”的母图候选卡片允许出现该按钮
- 一旦设为 `当前AI母图`，子图阶段的第一参考图固定为该母图的去水印版本
- 不允许使用未去印成功的母图继续生成子图

### 4.4 子图规则

- 子图阶段支持数量选择，默认按 Variant 行数决定，同时支持 `4 / 6 / 9 / 自定义`
- 每次子图请求只生成 `1` 张图
- 子图阶段按 Variant 列表顺序串行调用
- 同一轮子图请求的主参考图必须是 `当前AI母图`
- 原始参考图可继续作为辅助参考图使用，但不得替代 `当前AI母图` 的主导地位
- 某一张子图生成失败时，标记失败并继续后续任务，不中断队列

## 5. 界面结构

整体继续复用现有双栏结构：

- 左侧：控制区 `ControlPanel`
- 右侧：结果区 `ResultPanel`

顶部新增一条轻量阶段条，用于显示当前工作流所在阶段：

1. `母图设置`
2. `母图候选`
3. `子图生成`
4. `子图结果`

阶段条用于状态提示，不额外拆成多页面。

## 6. 左侧控制区设计

### 6.1 输入素材区

保留现有输入方式：

- 主图拖拽/选择框
- 参考图拖拽/选择框（最多 `4` 张）

输入素材区继续作为整个流程的起点。

### 6.2 母图设置区

新增或调整以下内容：

- `母图模板` 选择 / 编辑 / 保存
- `母图数量` 输入，默认 `3`
- 主按钮：`开始生成AI母图`

点击后进入母图串行队列。

### 6.3 子图设置区

默认在没有 `当前AI母图` 时置灰。

解锁后显示：

- 当前AI母图缩略图与文件名
- `子图模板` 选择 / 编辑 / 保存
- `子图数量`：`4 / 6 / 9 / 自定义`
- `Variant 列表`：一行一条
- 主按钮：`开始生成子图`

### 6.4 执行状态区

控制区底部新增轻量状态摘要：

- 当前阶段：`母图生成中 / 母图去水印中 / 母图待选择 / 子图生成中 / 已完成`
- 当前项：例如 `母图 2/3`、`子图 4/9`
- 总进度：例如 `6/12`
- 成功/失败计数

## 7. 右侧结果区设计

### 7.1 母图候选区

母图候选卡片墙按以下状态展示：

- `生成中`
- `去水印中`
- `可设为当前AI母图`
- `去水印失败`
- `已设为当前AI母图`

卡片默认预览去水印后的 `_Clean` 版本。

卡片操作：

- `设为当前AI母图`（仅去水印成功时显示）
- `查看大图`
- `打开所在文件夹`
- `查看原始AI母图`
- `重试去水印`（仅去水印失败时显示）

### 7.2 当前AI母图区

从母图候选区中选定后，单独置顶展示一张大卡：

- 标签：`当前AI母图`
- 子图阶段唯一主参考图

### 7.3 子图结果区

子图结果与母图候选分区展示，不混排。

每张子图显示：

- 子图编号，如 `子图 01`
- 查看大图
- 打开所在文件夹
- 设为精选（保留现有结果筛选思路）

### 7.4 失败记录区

单独展示失败项，不打断流程：

- 母图生成失败
- 母图去水印失败
- 子图生成失败

后续可在此基础上扩展重试入口，但本次只做最小展示。

## 8. 数据模型策略

本次不新增独立 workflow 表，沿用现有 `task / asset / run` 结构，在 `task.metadata` 中承载两阶段流程状态。

### 8.1 Task

仍使用单个 `AiStudioTaskRecord` 代表整条两阶段工作流。

建议在 `task.metadata` 中新增：

```ts
workflow: {
  mode: 'two-stage',
  activeStage: 'master-setup' | 'master-generating' | 'master-cleaning' | 'master-selecting' | 'child-generating' | 'completed',
  sourcePrimaryImagePath: string | null,
  sourceReferenceImagePaths: string[],
  currentAiMasterAssetId: string | null,
  requireCleanMasterBeforeChild: true,
  skipFailedChildRuns: true
},
masterStage: {
  templateId: string | null,
  promptExtra: string,
  requestedCount: number,
  completedCount: number,
  cleanSuccessCount: number,
  cleanFailedCount: number
},
childStage: {
  templateId: string | null,
  promptExtra: string,
  requestedCount: number,
  variantLines: string[],
  completedCount: number,
  failedCount: number
}
```

### 8.2 Asset

复用现有 `AiStudioAssetRecord`，扩展 `role` 约定：

- `source-primary`
- `source-reference`
- `master-raw`
- `master-clean`
- `child-output`

在 `asset.metadata` 中记录派生关系与状态：

```ts
{
  stage: 'master' | 'child',
  sequenceIndex: number,
  sourceAssetId?: string,
  derivedFromAssetId?: string,
  watermarkStatus?: 'pending' | 'succeeded' | 'failed'
}
```

### 8.3 Run

继续使用现有 `AiStudioRunRecord`。阶段信息进入 `requestPayload.workflow`：

```ts
workflow: {
  stageKind: 'master-generate' | 'master-clean' | 'child-generate',
  sequenceIndex: number,
  variantText?: string,
  currentAiMasterAssetId?: string
}
```

## 9. 执行链路

### 9.1 母图阶段

1. 保存原始主图、参考图、母图模板与母图数量
2. 按数量串行生成母图
3. 每成功 1 张母图，落一条 `master-raw` asset
4. 某张失败时，记录失败 run 并继续下一张

### 9.2 去水印阶段

1. 每张 `master-raw` 成功后立即调用现有去水印能力
2. 成功后落一条 `master-clean` asset
3. 用 `sourceAssetId` 将 `master-clean` 与对应 `master-raw` 关联
4. 若失败，则更新该母图状态为 `去水印失败`

### 9.3 当前AI母图阶段

1. 母图队列结束后进入 `母图待选择`
2. 仅 `master-clean` 资产允许 `设为当前AI母图`
3. 选中后将 `currentAiMasterAssetId` 写回 `task.metadata.workflow`

### 9.4 子图阶段

1. 读取子图模板、子图数量、Variant 列表
2. 按顺序串行调用
3. 每轮请求的第一参考图必须是 `当前AI母图`
4. 原始参考图可继续作为辅助参考图
5. 每成功 1 张落一条 `child-output` asset
6. 失败时记失败并继续后续队列

### 9.5 完成阶段

- 子图队列全部结束后，如果至少成功产出 1 张子图，任务记为 `completed`
- 如子图全部失败，则任务可保持 `failed`，并通过元数据表达“母图阶段已完成但子图阶段失败”

本次不新增 `partial-failed` 等额外顶层状态。

## 10. 失败策略

本次统一采用“跳过失败继续跑后面的”策略：

- 母图生成失败：继续下一张母图
- 母图去水印失败：继续后续母图，且该母图不可设为 `当前AI母图`
- 子图生成失败：继续下一张子图

只有在“没有任何去水印成功的母图”时，流程才会卡在母图选择前，无法进入子图阶段。

## 11. 实现边界

### 本次必须交付

- 两阶段工作流 UI
- 母图数量配置
- 母图自动去水印
- `设为当前AI母图`
- 子图数量 + Variant 串行生成
- 阶段进度显示
- 失败跳过继续
- 母图 / 当前AI母图 / 子图 / 失败记录分区

### 本次明确不做

- 批量项目编排
- 多母图并行展开
- 并发请求
- 自动优选
- 精细费用预算
- 高级重试与恢复

## 12. 验收标准

至少完成一次完整手动验证：

1. 上传主图与参考图
2. 设置母图数量为 `3`
3. 成功生成至少 `2` 张母图
4. 至少 `1` 张母图去水印成功
5. 将其中一张设为 `当前AI母图`
6. 设置 `4` 条 Variant
7. 自动串行生成 `4` 张子图
8. 人为允许中途出现单张失败，确保后续任务仍继续
9. 结果区正确分区展示并可预览

## 13. 后续扩展建议

该 MVP 跑通后，下一阶段优先级建议如下：

1. 失败项重试
2. 子图继续生成（从当前AI母图继续追加更多 Variant）
3. 结果打标/精选
4. 简版费用展示
5. 多母图并行探索
