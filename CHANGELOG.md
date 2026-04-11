# Changelog

## [1.2.0] - 2026-04-11

### Feat (特性)
- **CDP Publish**: 新增基于真实 Chrome Profile 的 CDP 发布模式，支持 CMS 专用数据目录、账号绑定、登录引导、dryRun 测试入口与发布安全指标回传。
- **Automation**: 小红书视频与图文在进入编辑页后统一复用同一套标题、正文、蓝字话题、挂车与发布按钮定位链路，降低两套流程分叉维护成本。
- **Safety**: 新增发布任务安全检查结果展示，已发布任务卡片可用红绿状态点快速查看自动化指纹与鼠标轨迹体检结果。

### Fix (修复)
- **Cover Upload**: 修复小红书封面弹窗双版本并存时的兼容问题，兼容旧版“+ 上传图片”和新版“上传封面”Tab 流程。
- **Stealth**: 移除错误的 UA 覆写，保留 `webdriver` 与 `window.process` 清理，确保检测结果与真实系统 Chrome 保持一致。
- **Image Publish**: 修复图文链路进入共享发布流程前视口异常、挂车勾选失败等问题，恢复与视频链路一致的后续编辑行为。

## [Unreleased] - 2026-02-08

### Refactor (重构)
- **xhs-automation**: 重构视频发布流程为严格串行模式：上传视频 → 等待进入“设置封面”阶段 → 先封面后文案 → 挂车 → 发布/存草稿，避免并行状态竞争。
- **xhs-automation**: 重写 `setVideoCover/findCoverTarget`，引入三层定位策略（file input 优先 / DOM 结构特征 / “智能推荐封面”等文本锚点兜底），显著提升封面入口命中率。
- **xhs-automation**: 统一以 `runStep()` 编排关键步骤，提升可读性与日志可观测性（每步可定位卡点与失败原因）。
- **AccountManager**: 存储层迁移至 SQLite，移除对 `db.json` 的依赖。
- **AccountManager**: 优化账号删除逻辑，增加数据库级联删除支持。
- **TaskManager**: 存储层迁移至 SQLite，解决 JSON 全量读写导致的性能瓶颈。
- **TaskManager**: 优化任务查询性能，支持 SQL 级筛选与排序。
- **Publisher**: 集成 `QueueService`，使用原子获取模式。
- **Security**: 增加发布锁 (`isPublishing`)，确保同一时间只有一个发布循环在运行。

### Fix (修复)
- 修复了将“重新上传”类入口误判为上传失败信号的风险：失败判定改为仅匹配明确失败语义（如“上传失败/请重试”）。
- 修复了非关键 UI（如封面弹窗）异常导致流程长时间挂起的风险：封面设置引入短超时与总预算（deadline）约束，超时自动降级继续主流程。
- **Automation**: 修复 `xhs-automation` 无法正确读取 `publishMode` 导致所有任务都被降级为“存草稿”的问题；增加对 `taskData.publishMode` 的兼容读取。
- **Assets**: 深度优化 `safe-file` 寻址逻辑，针对旧绝对路径实现“文件名级”智能寻回。
- **Build**: 修复 `better-sqlite3` Native 模块版本不匹配问题，增加自动重编译支持。
- **Migration**: 修正数据合并策略，强制 JSON 中的 `scheduledAt` 覆盖数据库状态，确保排期时间正确恢复。
- **Migration**: 将数据迁移语句升级为 `INSERT OR IGNORE`，防止因部分迁移造成的唯一主键冲突崩溃。
- **Lifecycle**: 为 TaskManager 增加静默防御，当 DB 未就绪时返回空结果而非抛出异常，彻底解决启动崩溃。
- **Queue**: 紧急修复 SQL 查询逻辑，移除对 `scheduledAt IS NULL` 的匹配，防止自动调度器误执行“待排期池”中的任务。
- **Queue**: 增加双重校验，确保只有显式设定了排期时间且已过期的任务才会被队列捕获。

### Feat (特性)
- 新增自动化操作的“容错降级（Fail-Soft）”机制：封面设置失败时记录 warning 并跳过，优先保证草稿保存/发布成功，封面交由用户人工确认。
- 新增交互模拟增强：点击前补齐 `mouseenter -> mouseover -> mousemove` 悬停事件链，适配 React 合成事件与 hover 才可见的入口。
- **Infrastructure**: 引入 `better-sqlite3` 作为本地存储引擎，替代 `electron-store` (JSON)。
- **Infrastructure**: 新增 `SqliteService` 并实现 `accounts/tasks/products` 表结构初始化。
- **Migration**: 实现 `migrateFromJSON` 逻辑，支持从 `db.json` 无缝迁移旧数据到 SQLite。
- **Migration**: 升级迁移策略为“存在即合并”模式：只要检测到 `db.json` 即自动执行合并导入。
- **Migration**: 新增自动归档功能，导入完成后将 `db.json` 重命名为 `.bak`，防止重复处理，同时支持手动回滚重试。
- **Queue**: 数据库 Schema 升级，为 tasks 表增加 `locked_at` 和 `retry_count` 字段以支持持久化队列。
- **Queue**: 新增 `QueueService`，实现基于 SQLite 的原子任务获取 (`acquireNextTask`) 与状态流转。
- **Queue**: 实现任务失败自动重试机制 (Max Retries = 3)。
- **Queue**: 实现启动时自动检测“僵尸任务”逻辑：不再自动重试，而是将其标记为 Failed 并提示“异常中断”，等待人工干预。
