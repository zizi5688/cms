# Changelog

## [1.4.4] - 2026-04-16

### Fix (修复)
- **Local Gateway Real Readiness**: 设置页里的 Chat / Flow 状态灯现在只会在真实请求实际跑通时显示绿色；如果账号处于 `cooldown`、真实探活失败，或生图链路没有真正恢复，就会显示红灯并给出原因。
- **Gateway Status Feedback**: 刷新状态、启动网关和重试恢复都会强制刷新真实探活结果；无效时间戳不再渲染成 `1970/1/1 08:00:00`，避免把历史空值误看成最近一次失败时间。

## [1.4.3] - 2026-04-15

### Fix (修复)
- **Local Gateway Profile Reuse**: 本地网关的 Chat 与 Flow 现在会统一复用用户在 CMS 中选定的真实 Chrome Profile，减少历史遗留独立 Profile 配置带来的登录态漂移和账号错配。
- **AI Studio Sidebar Drop**: 修复 AI Studio 图池拖拽在 Electron 中只能起手、右侧接收不到拖拽的问题；现在右侧创作中心整栏都可作为图文编辑态的图片投放区，不再只限素材蓝框范围内放手。

## [1.4.2] - 2026-04-14

### Fix (修复)
- **AI Studio Batch Pick Drag**: 修复创作中心图片图池在批量选图时，框选后无法继续把图片拖入笔记素材区的问题；现在卡片上的覆盖层不会再吞掉拖拽起手事件。

## [1.4.1] - 2026-04-13

### Fix (修复)
- **Legacy Publish Config Migration**: 生产环境升级到 1.4.1 后，会把历史遗留的 `publishMode=cdp` 默认配置一次性迁回 Electron，避免旧配置覆盖新版本默认值，导致设置页仍显示 Chrome CDP。
- **Electron Startup Guard**: 旧配置完成迁移后，Electron 模式下不会再因为残留的本地网关开机自启动设置而误拉 dedicated Chrome；Flow 图片能力仍保持按需 readiness，不影响后续生图。

## [1.4.0] - 2026-04-13

### Changed (调整)
- **Electron Default Publish Mode**: CMS 现已默认使用 Electron 发布模式，避免开发版或新环境首次启动时误切到 Chrome CDP 发布链路。
- **Electron Publish Action**: Electron 发布新增“发布方式”配置，支持“自动发布”和“保存草稿”；默认改为“保存草稿”。

### Fix (修复)
- **Draft Save Flow**: Electron 图文/视频发布在“保存草稿”模式下，完成素材上传、标题正文、封面和挂车后会直接关闭发布窗口，由小红书自动保存草稿，不再误点发布按钮。
- **Startup Chrome Popup**: 当发布模式是 Electron 时，CMS 启动阶段不再自动拉起本地网关的 dedicated Chrome，修复启动时偶发弹出 Chrome“打开您的个人资料时出了点问题”的干扰。
- **Flow Image Readiness**: AI Studio / Flow 生图链路改为按需启动本地网关图片能力，请求前自动补做 readiness，避免关闭开机自启动后首次生图直接命中 `127.0.0.1:4174` 未启动错误。

## [1.3.2] - 2026-04-13

### Fix (修复)
- **Local Gateway Image Recovery**: 本地网关图片链路现在会持续检查 `cdpProxy` 与 dedicated Chrome 会话状态；一旦检测到图片会话掉线，会自动清空就绪缓存并重新初始化，避免生成请求直接失败。
- **Image Session Health Cache**: 图片能力就绪判断不再只依赖 adapter 和 gateway，而是把 `cdpProxy.connected` 与 Chrome 调试状态一起纳入健康检查，降低长时间运行后的假阳性“已就绪”状态。

## [1.3.1] - 2026-04-13

### Fix (修复)
- **macOS Packaging**: 在 after-pack 阶段为复制进应用资源目录的 `.node` 与 `.dylib` 原生制品补做 ad-hoc 签名，降低 DMG 安装后被 Gatekeeper 拦截的概率。
- **macOS Launch Guard**: 应用首次启动时增加原生模块加载检测；如果遇到 quarantine 或 not verified 拦截，会弹出提示并提供可直接复制的 `xattr -cr /Applications/Super\ CMS.app` 修复命令。
- **Local Gateway Adapter**: 修复 Python adapter 在新电脑上因 venv 绝对路径 shebang 失效而无法启动的问题；启动前会自动校验并重建 `.venv`，同时统一改用 `.venv/bin/python -m uvicorn` 启动。

## [1.3.0] - 2026-04-12

### Feat (特性)
- **Gateway Chat Stability**: 本地网关 Chat 链路稳定性大幅提升：从 Chrome Profile 读取完整 cookie 替代手动配置，`GeminiClient` 单例复用减少重复初始化。
- **Multi-account Rotation**: 支持多 Google 账号轮询：一个账号 cookie 过期或连续失败后自动切换到下一个，5 分钟后自动恢复。
- **Settings UI**: 本地网关设置页重新整理：状态总览按功能分组、Chat 账号管理、高级设置折叠。

### Changed (调整)
- **Generation Feedback**: 智能生成加载体验优化：新增阶段提示（连接中→生成中→解析中）、已等待计时、失败内联提示，替代原有 `window.alert` 弹窗。
- **Dedicated Chrome**: dedicated Chrome 端口分离（`9333`），不再干扰用户日常 Chrome。
- **Gateway Timeout**: 长输出场景超时调整：本地网关路由 120 秒超时 + 1 次重试。

### Fix (修复)
- **XHS Cover Upload**: 小红书封面上传弹窗信号检测增强。

## [1.2.1] - 2026-04-11

### Fix (修复)
- **CMS Profiles**: 区分开发环境 `~/chrome-cms-data-dev` 与生产环境 `~/chrome-cms-data`，避免生产端误读开发阶段创建的 CMS Chrome Profile。
- **Profile Actions**: 修复生产环境中 `刷新 Profiles` 无反馈、`新建 Profile` 仍使用浏览器原生 prompt 的问题，改为应用内 modal 与明确的刷新提示。
- **Login Verification**: 修复生产环境验证登录态时的 CDP 启动异常，移除会导致 `Target.setDiscoverTargets` 崩溃的启动参数，并在验证前主动清理同账号残留的 CMS 登录浏览器。

### Chore (维护)
- **Release Loop**: 更新仓库内 phase release 收尾 skill，要求每次发版前先读取 GitHub 最新 tag，再向用户确认目标版本号。

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
