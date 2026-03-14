# 存储维护手动恢复设计

## 背景

仓库历史里曾经实现过一套“存储维护（缓存瘦身）”能力，包含：
- 清理 `userData/generated_assets` 中超过保留期且不再被任务引用的孤儿图片
- 清理 `userData/temp_covers` 与 `userData/temp_previews` 中的旧临时文件
- 清理 `userData/Partitions` 中超过保留期且不再活跃的受管分区
- 将 `userData/generated_videos` 中超过保留期的视频迁移到飞牛归档目录
- 为每次执行生成 manifest，并支持按 `runId` 回滚

这套能力在历史分支 `codex/cache-footprint-audit` 与 `codex/note-race-delete-date` 中完整存在，但没有真正进入当前主线。当前主线只残留了部分配置字段与渲染层状态：
- `storageMaintenanceEnabled`
- `storageMaintenanceStartTime`
- `storageMaintenanceRetainDays`
- `storageArchivePath`

因此现在的状态是：
- 设置页没有入口；
- 主进程没有完整后端与 IPC；
- 配置字段仍然残留在 renderer / preload 类型中。

## 目标

本次恢复目标是“手动运维版”，即：
- 恢复设置页中的存储维护入口；
- 恢复主进程存储维护服务；
- 支持 `dry-run`、实跑与按 `runId` 回滚；
- 恢复飞牛归档目录配置与执行状态展示；
- 保留执行期间的写入保护，避免与发布、视频生成等流程并发冲突；
- 恢复一键烟测脚本，作为回归保障。

## 非目标

本次不做：
- 夜间自动调度与无人值守自动运行；
- AI Studio 工作区 `ai-studio/tasks/...` 产物清理；
- 新的全局存储治理框架；
- 通用“任意目录归档/清理”能力；
- 复杂的历史运行记录页面。

## 已确认方案

采用“手动运维优先、自动调度延后”的方案：

### 1. 恢复范围

第一版只恢复旧实现中边界比较清楚、风险可控的目录：
- `userData/generated_assets`
- `userData/generated_videos`
- `userData/temp_covers`
- `userData/temp_previews`
- `userData/Partitions` 中受管命名分区

不把 AI Studio 工作区输出纳入本次范围，原因是当前 AI Studio 结果主要持久化在工作区 `ai-studio/tasks/...`，与旧实现面向 `userData` 的生命周期不同，混在同一次恢复中会把“恢复旧功能”升级成“重做存储系统”。

### 2. 设置页行为

设置页恢复一张“存储维护（缓存瘦身）”卡片，包含：
- 保留天数
- 飞牛归档目录选择/清空
- 当前运行状态
- 下次计划执行、上次执行时间、上次 `runId`、锁原因
- 手动执行 `reason`
- `刷新状态`
- `立即 dry-run`
- `立即实跑`
- 按 `runId` 执行回滚
- 最近一次手动结果摘要

本次不开放“启用夜间自动维护”和“夜间开始时间”的真实控制行为。可以保留展示型字段或说明文案，但不得在本次恢复中启动自动 timer。

### 3. 主进程行为

恢复 `StorageMaintenanceService` 作为主进程服务，保留以下核心能力：
- 读取配置并执行清理/迁移；
- 为每次执行生成 manifest；
- 按 manifest 支持回滚；
- 对跨盘/NAS 路径采用 `rename` 失败后 `copy + remove` 的降级策略；
- 迁移历史视频后，同步改写数据库中旧任务的 `videoPath`；
- 对未进入终态的任务视频跳过迁移。

自动调度相关的 helper 可以保留在服务内部，但本次恢复中不在 `app.whenReady()` 后启动定时执行。

### 4. 并发保护

手动执行存储维护时，需要继续保留旧实现中的写入保护：
- 若发布队列正在运行，拒绝启动存储维护；
- 若存储维护正在运行，拒绝新的发布/批量发布/视频生成/导入等写入动作；
- 队列手动启动也应在存储维护运行中被拦截。

这样即使第一版只恢复手动入口，也能避免“手动点击维护时与正在写文件的流程撞车”。

### 5. 错误提示

沿用旧实现中的中文提示策略：
- 归档目录未设置时，实跑前二次确认；
- NAS/飞牛目录未挂载或无权限时，提示用户先在 Finder 中挂载共享目录；
- `dry-run` 与实跑在日志和弹窗中明确区分；
- 回滚失败时透出 `runId` 与错误摘要，便于人工排查。

## 数据与兼容性

### 配置字段

继续沿用现有字段：
- `storageMaintenanceEnabled`
- `storageMaintenanceStartTime`
- `storageMaintenanceRetainDays`
- `storageArchivePath`

其中：
- `storageMaintenanceRetainDays`
- `storageArchivePath`

是本次手动版的有效字段；
- `storageMaintenanceEnabled`
- `storageMaintenanceStartTime`

本次只做兼容保留，不作为自动执行的行为开关。

### 数据库影响

旧实现只会更新 `tasks.videoPath`，用于把迁移后的历史视频指向归档目录。当前主线的 `tasks` 表仍然保留 `videoPath` 字段，因此这条兼容链路仍然成立。

### AI Studio 边界

AI Studio 当前主要把任务运行目录放在工作区：
- `workspace/ai-studio/tasks/<taskId>/run-xxx`

因此本次恢复不会扫描、清理或迁移 AI Studio 目录，也不会接触 `ai_studio_*` 表。

## 验证标准

恢复完成后，至少满足以下标准：
- 设置页能看到“存储维护（缓存瘦身）”入口；
- `dry-run` 能返回摘要且不改动真实文件；
- 实跑能清理孤儿文件/旧临时文件、迁移符合条件的视频；
- 回滚能按 `runId` 恢复 manifest 中记录的可回滚项；
- 队列运行时无法启动存储维护；
- 存储维护运行时，新的发布与关键写入动作会被拦截；
- 烟测脚本能完整跑通 `dry-run -> real-run -> rollback`；
- `npm run typecheck` 通过。

## 后续阶段

若第一版手动恢复稳定，再考虑第二阶段：
- 重新评估夜间自动调度；
- 重新设计 AI Studio 工作区产物清理策略；
- 增加历史运行记录展示或更细粒度的目录策略。
