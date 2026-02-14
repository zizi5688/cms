# Changelog

## [Unreleased] - 2026-02-08

### Refactor (重构)
- **xhs-automation**: 重构视频发布流程为严格串行模式：上传视频 → 等待进入“设置封面”阶段 → 先封面后文案 → 挂车 → 发布/存草稿，避免并行状态竞争。
- **xhs-automation**: 重写 `setVideoCover/findCoverTarget`，引入三层定位策略（file input 优先 / DOM 结构特征 / “智能推荐封面”等文本锚点兜底），显著提升封面入口命中率。
- **xhs-automation**: 统一以 `runStep()` 编排关键步骤，提升可读性与日志可观测性（每步可定位卡点与失败原因）。
- **AccountManager**: 存储层迁移至 SQLite，移除对 `db.json` 的依赖。
- **AccountManager**: 优化账号删除逻辑，增加数据库级联删除支持。
- **TaskManager**: 存储层迁移至 SQLite，解决 JSON 全量读写导致的性能瓶颈。
- **TaskManager**: 优化任务查询性能，支持 SQL 级筛选与排序。

### Fix (修复)
- 修复了将“重新上传”类入口误判为上传失败信号的风险：失败判定改为仅匹配明确失败语义（如“上传失败/请重试”）。
- 修复了非关键 UI（如封面弹窗）异常导致流程长时间挂起的风险：封面设置引入短超时与总预算（deadline）约束，超时自动降级继续主流程。
- **Build**: 修复 `better-sqlite3` Native 模块版本不匹配问题，增加自动重编译支持。
- **Lifecycle**: 优化启动时序，确保数据库初始化失败时不会触发后续任务调度导致的崩溃。

### Feat (特性)
- 新增自动化操作的“容错降级（Fail-Soft）”机制：封面设置失败时记录 warning 并跳过，优先保证草稿保存/发布成功，封面交由用户人工确认。
- 新增交互模拟增强：点击前补齐 `mouseenter -> mouseover -> mousemove` 悬停事件链，适配 React 合成事件与 hover 才可见的入口。
- **Infrastructure**: 引入 `better-sqlite3` 作为本地存储引擎，替代 `electron-store` (JSON)。
- **Infrastructure**: 新增 `SqliteService` 并实现 `accounts/tasks/products` 表结构初始化。
- **Migration**: 实现 `migrateFromJSON` 逻辑，支持从 `db.json` 无缝迁移旧数据到 SQLite。
