# Super CMS 产品需求文档 (PRD)

> 本文档以当前仓库代码实现为准，作为 Super CMS v1.0 的“核心功能说明书”。  
> 注意：你提供的结构中提到 `lowdb` 与“数据回流爬取”在当前版本代码中并未出现；对应章节会按同一结构描述“实际实现/现状”，并明确未实现点。

## 1. 产品概述

* **产品定位**：本地优先的小红书矩阵号运营与资产管理工具。
* **核心价值**：解决多账号运营中素材混乱、排期繁琐、内容同质化的问题，提供从“资产管理”到“智能裂变”再到“自动排期”的闭环体验。

### 1.1 产品形态与架构（v1.0 实际实现）

* **客户端形态**：桌面端 Electron 应用（主进程 + 预加载桥 + 渲染进程 React）。
* **本地优先**：所有数据落地到用户工作区 `db.json` 与工作区 `assets/`；不依赖云端数据库。
* **自动化能力**：通过 Electron `BrowserWindow` 打开小红书创作后台页面，并在 preload 脚本中做 DOM 自动化（发布/草稿发布/商品同步）。

## 2. 用户角色 (User Personas)

* **核心用户**：电商卖家、矩阵号运营人员。
* **扩展用户**：
  * 视觉/剪辑同学：批量素材去水印/放大/切宫格后交付运营。
  * 运营主管：关注账号健康状态、队列进度、排期是否拥堵、失败原因。

### 2.1 典型任务（Jobs To Be Done）

* 需要把一批图片 + 文案快速组合成可投放的“任务队列”，并分发到多个账号。
* 需要一键把“待排期池”拖进某周某天，并自动按间隔排开。
* 需要从历史任务中“裂变生成”更多相似但不重复的内容（图文重组 + 文案同义词替换 + 图片轻微变异）。
* 需要尽量减少重复发布/平台查重风险（图片微调、文案替换、元数据差异）。

## 3. 功能模块详解 (需包含字段级细节)

### 3.0 核心数据模型（v1.0 实际字段）

> v1.0 同时存在“渲染侧任务模型（用于数据工坊/飞书上传）”与“主进程发布任务模型（用于媒体矩阵/排期/发布）”，两者字段不同。

#### 3.0.1 工作区 DB Schema（`db.json`）

* **存储文件**：`<workspacePath>/db.json`
* **存储引擎**：Electron Store（内部 JSON 持久化）；当前版本并未使用 `lowdb`。
* **默认结构**：
  * `accounts: []`：账号列表（见 3.0.3）
  * `xhs_tasks: []`：发布任务列表（见 3.0.2）
  * `xhs_products: []`：商品列表（用于绑定商品）

#### 3.0.2 PublishTask（媒体矩阵/排期/发布的任务）

* **字段（主进程）**
  * `id: string`：UUID
  * `accountId: string`：所属账号 ID
  * `status: 'pending' | 'processing' | 'failed' | 'publish_failed' | 'draft_saved' | 'scheduled' | 'published'`
  * `images: string[]`：图片引用列表（支持四类来源）
    * HTTP URL（保持原样）
    * 工作区相对路径：`assets/...`
    * 绝对文件路径（导入时可本地化到工作区）
    * 生成资源路径：`<userData>/generated_assets/...`（裂变图片变异输出）
  * `title: string`：标题
  * `content: string`：正文
  * `tags?: string[]`：标签（裂变触发依赖此字段）
  * `productId?: string`、`productName?: string`：绑定商品信息
  * `publishMode: 'draft' | 'immediate'`：发布模式（任务创建时写入；队列发布会读取）
  * `scheduledAt?: number | null`：排期时间（毫秒时间戳；null/undefined 表示未排期）
  * `publishedAt: string | null`：发布完成时间（ISO 字符串）
  * `createdAt: number`：创建时间（毫秒）
  * `errorMsg: string` / `errorMessage?: string`：失败原因（两字段兼容）
  * `isRaw?: boolean`：兼容历史数据/迁移使用（调度器对 `status==='scheduled'` 的 raw 做特殊判断）
* **关键派生概念（渲染层）**
  * “待排期池任务”：`status !== 'published' && scheduledAt == null`
  * “日历/看板可展示任务”：`getTaskDisplayTime(task) != null`（已发布使用 `publishedAt`，未发布使用 `scheduledAt`）
  * “裂变任务”：`tags` 包含 `'remix'`（大小写不敏感）或 `'裂变'`

#### 3.0.3 Account（矩阵账号）

* **字段（主进程持久化版本）**
  * `id: string`
  * `name: string`
  * `partitionKey: string`：形如 `persist:xhs_<timestamp>[_n]`，用于隔离浏览器持久化分区（登录态/缓存）
  * `lastLoginTime: number | null`
* **状态（service 版）**
  * `status: 'logged_in' | 'expired' | 'offline'`

#### 3.0.4 数据工坊 Task（CSV+图片分配产生的任务清单）

* **字段（渲染侧 Zustand，仅用于数据工坊/飞书上传）**
  * `id: string`
  * `title: string`
  * `body: string`
  * `assignedImages: string[]`：图片文件路径（绝对路径字符串）
  * `status: 'idle' | 'uploading' | 'success' | 'error'`：飞书上传用状态
  * `log: string`：分配日志/上传日志

### 3.1 工作区与资产管理 (Workspace)

* **逻辑**：基于 `lowdb` 的本地 JSON 存储 + 本地文件系统。
  * **v1.0 实际实现**：使用 Electron Store 将业务数据持久化为工作区内的 `db.json`；功能目标与“本地 JSON 存储”一致，但未使用 lowdb。
* **关键规则**：
  * 初始化校验逻辑（db.json 与 assets 文件夹）。
  * 图片路径管理（支持绝对路径读取，生成缩略图）。

#### 3.1.1 工作区路径（Workspace Path）

* **默认路径**：`~/Documents/SuperCMS_Data`
* **初始化与状态**
  * `initialized`：可写并已准备好工作区结构
  * `uninitialized`：路径不可用或未通过写权限检测
* **切换工作区**
  * 用户在“设置”中选择新目录后，主进程写入配置并触发应用重启（保证 store 的 cwd 切换一致性）。

#### 3.1.2 DB 初始化与迁移（db.json）

* **首次启动创建**
  * 若工作区下 `db.json` 不存在，会创建并写入默认结构 `{ accounts: [], xhs_tasks: [], xhs_products: [] }`
* **历史数据迁移**
  * 若检测到旧版本分散存储（独立的 `accounts/xhs_tasks/xhs_products` store），会在首次创建 `db.json` 时读取旧 store 并合并迁移到新 `db.json`。
* **写入健壮性（NAS/网络盘场景）**
  * 对 `EBUSY/EPERM` 等文件占用错误做短退避重试（最多 3 次），并对 `store.set/delete/clear` 做同策略封装，减少共享盘锁冲突导致的写失败。

#### 3.1.3 资产目录与图片本地化（assets/）

* **目录约定**
  * `assets/images/`：任务图片的“工作区归档存储”
* **导入策略（Settings 可配）**
  * `importStrategy = 'copy' | 'move'`
  * `copy`：复制源文件到工作区，不删除源文件
  * `move`：复制成功后删除源文件（仅当源文件不在工作区目录内时才会删除，避免误删工作区内部文件）
* **本地化命名规则（去重与稳定引用）**
  * 对源图片计算 `sha1`（HEIC 会先转 JPEG buffer 再算 hash），落盘为：
    * HEIC：`<sha1>.jpg`
    * 其他：`<sha1>.<ext>`
  * 任务中保存相对路径：`assets/images/<filename>`
* **绝对路径读取与安全封装（渲染层展示）**
  * 为了通过 CSP 且安全加载本地文件，渲染层将绝对路径/工作区相对路径转换为 `safe-file://...` URL。
  * 主进程注册 `safe-file` 协议：把 `safe-file://` 映射为本地文件并通过 `net.fetch(file://...)` 返回内容流。
* **缩略图（v1.0 现状）**
  * 当前版本未实现独立“缩略图生成与缓存”；卡片封面直接使用 `<img>` 加载图片并用 CSS `object-cover` 显示。

#### 3.1.4 自动备份（灾备）

* **触发时机**：主进程启动后、业务服务初始化前
* **备份对象**：`<workspacePath>/db.json`
* **备份位置**：`<userData>/backups/`
* **命名**：`cms_backup_YYYY-MM-DD_HH-mm-ss.json`
* **保留策略**：按创建时间倒序保留最近 7 份，自动清理更旧备份

### 3.2 待排期池 (Pending Pool)

* **交互**：左侧侧边栏，支持折叠（Resizable Panel）。
* **功能**：
  * 任务卡片展示（封面、标题、状态）。
  * **智能裂变入口 (The Remix Engine)**：
    * **随便来5个**：描述具体的裂变算法（原子级图片重组逻辑 + 文本同义词替换）。
    * **去重机制**：描述图片微调（Crop/Gamma/Exif清除）和文本 Spin 的逻辑。
  * 批量删除与撤回逻辑。

#### 3.2.1 入口位置与布局

* **入口位置**：媒体矩阵 → 日历视图（周/月份日历）左侧 “待排期池”
* **布局组件**：`react-resizable-panels` 的 `Group/Panel/Separator`
  * 支持拖拽改变宽度
  * 支持“一键折叠/展开”
  * 布局持久化：以 `id='cms-layout-persistence'` 保存/恢复默认布局

#### 3.2.2 待排期池任务定义与过滤规则

* **任务来源**：当前账号的 `PublishTask` 列表
* **进入待排期池的必要条件**
  * `status !== 'published'`
  * `scheduledAt == null`（null 或 undefined）
* **不进入待排期池的情况**
  * 已排期：`scheduledAt` 为 number
  * 已发布：`status === 'published'`

#### 3.2.3 卡片信息（字段级展示）

* **封面**
  * `images[0]` 作为封面图；若不存在则显示占位背景
* **图片数量**
  * 若 `images.length > 1` 显示层叠图标与数量 badge
* **裂变标记**
  * 若 `tags` 包含 `'remix'` 或 `'裂变'`，显示紫色“闪光”图标（并在月视图事件上显示 🎲 标记）
* **标题**
  * `task.title`，为空则显示 `(未命名)`；最多两行截断
* **商品信息**
  * `task.productName`，为空显示 “未绑定商品”
* **操作（单条）**
  * 右上角“删除”按钮：二次确认后调用彻底删除（不可恢复）

#### 3.2.4 多选与批量拖拽（交互规则）

* **选中态存储**：全局 store `selectedPublishTaskIds: string[]`（用于跨“池/周列/月视图”保持一致）
* **点击选择**
  * 单击：若未选中则变为“仅选中该条”
  * Ctrl/⌘ + 单击：切换该条的选中/取消选中
  * Shift + 单击：以锚点 `selectionAnchorId` 做区间选择（按待排期池当前排序）
* **拖拽规则**
  * 若拖拽的任务已在选中集合内：进入“批量拖拽”，拖拽载荷携带 `batchTasks/batchIds`
  * 若拖拽的任务未选中：拖拽前会自动把选择切换为“仅该条”，避免误把未选中的条目一起拖走

#### 3.2.5 批量删除与撤回（键盘 Delete/Backspace）

* **触发条件**：存在 `selectedPublishTaskIds` 且焦点不在输入控件（input/textarea/select 等）
* **分流规则**
  * 若选中集合中包含“已排期任务”（`scheduledAt` 为 number）：
    * 执行“批量撤回到待排期池”：把 `scheduledAt` 置为 null，并将 `status` 置为 `'pending'`
  * 若选中集合为“未排期任务”（`scheduledAt == null`）：
    * 执行“批量彻底删除”：逐条调用删除接口

#### 3.2.6 智能裂变入口（随便来 5 个）

* **入口位置**：待排期池头部按钮
* **触发行为**：点击后生成新任务并加入同一账号队列；新任务会在池中短暂高亮闪烁，并显示 toast 提示

#### 3.2.7 智能裂变算法（渲染侧 Surprise Remix：原子级重组）

* **目标**：从近期内容中自动抽取“同一批次/同一主题”的任务，随机重混图文组合，生成 `count=5` 条新任务 payload
* **输入集合**
  * 从当前账号任务中筛选 `createdAt` 在近 `lookbackDays=14` 天内的任务
* **聚类（smartClustering）**
  * 先按 `createdAt` 升序排序
  * 相邻任务合并/拆分规则：
    * `fastGapMs = 60s`：间隔小于 60 秒直接合并（认为同一批）
    * `timeWindowMs = 5min`：间隔超过 5 分钟直接拆分
    * 介于二者之间：计算标题相似度 `titleSimilarity`（Jaccard 2-gram/字符集 + 前缀 4/5 字命中），若 `>= 0.3` 合并，否则拆分
  * 输出批次过滤：仅保留 `batch.length >= 3` 的批次
* **选批次**
  * 从合格批次中随机选取 1 个 `selectedBatch`
* **图片池构建**
  * 汇总该批次所有任务 `images`，去重后得到 `allImagesPool`
  * 计算批次内每条任务图片数的 `baselineMin/baselineMax`
  * 生成任务图片数范围：
    * `minImgCount = min(allImagesPool.length, max(3, baselineMin || 3))`
    * `maxImgCount = min(allImagesPool.length, max(minImgCount, baselineMax || minImgCount))`
* **生成每条新任务（最多 count=5）**
  * 每条任务最多尝试 `attempt=24` 次生成一个不重复组合
  * 随机挑选来源任务：
    * `baseTask`：用于继承 `accountId/productId/productName/publishMode`
    * `titleTask`：提供标题（会先去除 `[🎲]/[✨]` 等前缀）
    * `contentTask`：提供正文
  * 图片选择：
    * `targetCount` 在 `[minImgCount, maxImgCount]` 中随机
    * 从 `allImagesPool` 中无放回随机抽取 `targetCount` 张，并打乱顺序
  * 去重约束（组合级）
    * 组合 Key：`images + title + content + productId`
    * 不得与 `selectedBatch` 原始任务组合重复
    * 不得与本轮已生成组合重复
  * 去重约束（图片集级，前半段强约束）
    * 在前 `attempt < 12` 时，优先保证“图片集合 signature”不与原始任务集或已生成任务集重复
  * 输出 payload：
    * `tags: ['remix']`
    * 其他字段从 baseTask/titleTask/contentTask 拼装

#### 3.2.8 去重机制（主进程 Remix 强化：图片微调 + 文本 Spin）

> 渲染侧 Surprise Remix 负责“组合层面的去重”；真正用于降低平台重复度的“内容变异”发生在主进程创建任务入库时（当 tags 命中 remix）。

* **触发条件**
  * `tags` 包含 `'裂变'` 或（大小写不敏感）`'remix'`
* **文本 Spin（同义词替换）**
  * 对 `title` 与 `content` 分别执行 `spinText`
  * 词典：固定关键词 → 同义短语数组（如“绝美/显瘦/百搭/种草/必入”等）
  * 替换概率：每次调用会生成 `replaceProbability ∈ [0.3, 0.5]`，每个匹配到的关键词以该概率替换为随机同义短语
* **图片微调（mutateImage）**
  * 输入：绝对路径图片（工作区相对 `assets/...` 会先拼接为绝对路径）
  * 处理步骤：
    * 自动按 EXIF 方向旋转（`rotate()`）
    * 1% 边缘裁剪（每边约 1% 的像素，至少 1px，且保证裁剪后尺寸有效）
    * 亮度抖动：`brightness` 在 `[0.98, 1.02]` 内随机
    * 编码输出：jpg/webp/png（取决于原扩展名；默认 png）
  * 输出位置：`<userData>/generated_assets/`
  * 元数据：输出图片不会携带原图 metadata（sharp 默认不保留 metadata）

### 3.3 可视化排期日历 (Kanban Calendar)

* **视图**：周视图/月视图切换。
* **交互逻辑**：
  * 拖拽排期 (Drag & Drop)：从 Pool 拖入日历，或在日历内拖动修改时间。
  * **智能顺延**：描述“过期时间自动顺延”的逻辑。
  * 响应式布局：描述最小宽度限制与横向滚动机制。
* **卡片信息**：描述卡片上显示的所有元数据（图片数、发布时间、裂变标记、数据战绩）。

#### 3.3.1 日历模式入口与视图切换

* **入口**：媒体矩阵模块顶部 “日历/列表” 切换按钮
* **日历模式组件**
  * 周视图：7 列看板（按自然周 startOf('week') 展示）
  * 月视图：react-big-calendar 的 `month` 视图 + DnD addon

#### 3.3.2 排期偏好（Preferences）

* `defaultStartTime: string`（默认 `'10:00'`）
  * 用途：当月视图拖入落点没有具体时间（00:00）时，补齐默认开始时间
  * 用途：当某天没有任何排期任务时，池任务拖入该天会落在 `defaultStartTime`
* `defaultInterval: number`（默认 `30`，单位分钟）
  * 用途：同一天内“连续排期”的间隔（批量拖入/追加到当日末尾）
  * 用途：当天拖入时间已过期时的“追赶间隔”（见 3.3.4）

#### 3.3.3 Drag & Drop：从待排期池拖入周看板

* **drop 目标**：每一天列（DayColumn）是 drop zone
* **不可投放约束**
  * 过去日期（按天比较）不允许 drop（`canDrop=false`）
* **单条拖入（未排期任务）**
  * 若该天没有任何已排期任务：
    * 默认落在 `withDefaultStartTime(date, defaultStartTime)`
    * 若目标日为“今天”且默认时间早于当前时间，则触发“追赶机制”（见 3.3.4）
  * 若该天已有排期任务：
    * 取该天最大 `scheduledAt`，并在其基础上 `+ defaultInterval` 作为新任务落点
    * 若计算后早于当前时间且目标日为今天，则触发“追赶机制”（见 3.3.4）
* **批量拖入（多选任务）**
  * 先计算一个 `baseTime`（同上规则）
  * 对第 i 条任务：`scheduledAt = baseTime + i * defaultInterval`
  * 统一提交“批量排期更新”（每条任务不同时间）

#### 3.3.4 智能顺延（过期时间自动顺延）

* **场景 A：拖入“今天”，但计算得到的时间早于 now**
  * 取 `now + catchUpInterval`（catchUpInterval 默认等于 `defaultInterval`，兜底 30 分钟）
  * 对齐到 5 分钟刻度：把分钟数向上补齐到下一个 5 的倍数（例如 10:02 → 10:05）
* **场景 B：已排期任务跨天拖动后落到过去时间**
  * 先保持原时分秒，仅改变日期：`setDateKeepingTime(targetDate, originalDateTime)`
  * 若结果仍早于 now：
    * 若目标日已有排期任务且最大 `scheduledAt` 晚于 now，则顺延到 `maxScheduledAt + defaultInterval`
    * 否则顺延到 `now + 10min`，并对齐到 5 分钟刻度

#### 3.3.5 Drag & Drop：月视图内拖动/外部拖入

* **日历内拖动（已排期任务）**
  * 拖动事件到新日期：保持原时间，仅修改日期（`setDateKeepingTime(newDate, oldDateTime)`）
  * 已发布任务不可拖动
* **从外部拖入（月视图空格）**
  * 若落点 time 为 00:00（无具体时间），使用 `defaultStartTime` 补齐
  * 落入后强制把任务状态置为 `'pending'`（避免遗留状态影响发布队列）

#### 3.3.6 响应式布局（最小宽度与横向滚动）

* **周视图最小宽度**：内部容器 `min-width: 1120px`
* **滚动策略**：外层 `overflow-x-auto`，屏幕不足时允许横向滚动，避免 7 列被挤压到不可读

#### 3.3.7 卡片信息（周视图/日历卡片字段）

* **周视图卡片（看板列中的任务）**
  * 封面：`images[0]`
  * 裂变标记：`tags` 命中 remix/裂变时显示图标
  * 图片数 badge：`images.length > 1` 时显示
  * 时间：
    * 已发布：显示 `已发 HH:mm`（基于 `publishedAt` 解析）
    * 未发布：显示 `HH:mm`（基于 `scheduledAt`）
    * 已过期：显示 `⚠️` 并以红色样式提示（仅对未发布且 scheduledAt < now）
  * 标题：
    * 失败：前缀 `❌`
    * 成功/已发布：前缀 `✅`
  * 商品：显示 `productName` 或 “未绑定商品”
  * 操作：
    * 右上角撤回按钮：把任务撤回至待排期池（scheduledAt=null，status='pending'）
    * 点击时间可内联编辑（输入 HH:mm，回车/失焦提交）
* **月视图事件卡片**
  * 封面缩略：`images[0]`
  * 标题：最多两行截断
  * 时间：`HH:mm`
  * 裂变标记：右上角 🎲 badge（并提示“请检查文案”）
* **数据战绩（v1.0 现状）**
  * 当前版本 UI 卡片未展示阅读/点赞等战绩字段；代码中也未发现对应数据结构与回流逻辑。

### 3.4 任务详情与编辑

* **详情弹窗**：双击卡片触发。
* **内容**：多图预览、标题/正文编辑、标签管理。

#### 3.4.1 触发与关闭规则

* **触发**
  * 周视图：双击看板卡片
  * 月视图：当前实现为单元格事件渲染；未接入双击（可作为 v1.1 优化）
* **关闭**
  * 点击遮罩层空白处关闭
  * 按 `Esc` 关闭
  * 右上角关闭按钮

#### 3.4.2 详情内容（v1.0 实际实现）

* **多图预览**
  * 主预览区：`object-contain` 展示当前选中图片
  * 缩略图列表：点击切换主预览
  * 计数 badge：显示 `current/total`
* **基础信息**
  * 标题：`task.title`（只读展示）
  * 状态 badge：根据 `status` 映射为“待处理/处理中/草稿已存/已发布/失败”
  * 裂变 badge：`tags` 命中 remix/裂变显示“裂变”
  * 排期时间：`scheduledAt` 格式化为 `YYYY-MM-DD HH:mm`（无则为 `—`）
  * 创建时间：`createdAt` 格式化展示
  * 商品：`productName`（有则展示）
* **正文**
  * 只读 textarea 展示 `task.content`
* **删除**
  * 使用原生 message box 二次确认；确认后删除任务并关闭弹窗

#### 3.4.3 标题/正文编辑与标签管理（v1.0 状态说明）

* v1.0 详情弹窗未提供标题/正文编辑与标签管理 UI；当前仅支持“预览 + 删除”。
* `tags` 字段已在底层模型中存在，并用于裂变判定；编辑能力可作为 v1.1 的产品迭代点。

### 3.5 数据回流 (Data Feedback - MVP)

* **机制**：描述 Electron 隐形窗口爬取阅读/点赞数的逻辑。
* **展示**：在日历卡片上的数据透出。

#### 3.5.1 v1.0 现状（与代码一致）

* 当前代码中未实现“数据回流爬取阅读/点赞数”的完整链路：
  * 未找到阅读/点赞/收藏等字段定义
  * 未找到定时爬取/隐形窗口抓取/结果落库/渲染展示等逻辑
* 当前仅存在“自动化发布/商品同步”窗口（可见窗口为主），以及一份未在入口接线的旧版“隐藏窗口自动化发布”实现，可作为未来数据回流的技术参考。

#### 3.5.2 MVP 需求建议（保持与现有架构兼容）

* **数据模型（建议在 PublishTask 上扩展）**
  * `metrics?: { views?: number; likes?: number; collects?: number; comments?: number; fetchedAt?: number }`
* **抓取窗口**
  * 每账号复用一个 `show:false` 的 BrowserWindow（复用登录态分区 `partitionKey`）
  * 通过 preload 注入抓取脚本，从单条笔记页面或作品列表抓取指标
* **调度策略**
  * 仅对 `status==='published'` 且 `publishedAt` 存在的任务抓取
  * 每账号串行（复用现有 `runningByAccount`/`p-limit(1)` 思路）
  * 增量更新：`fetchedAt` 距离 now 太近则跳过（例如 6h 内不重复抓）
* **展示（渲染层）**
  * 周视图卡片增加一行 `views/likes` 等简版指标
  * 月视图事件 tooltip/详情弹窗展示全量指标

### 3.6 数据工坊（Data Workshop / CSV 生成清单）

#### 3.6.1 功能目标

* 输入 CSV 文案（标题、正文）
* 选择一个图片文件夹并扫描得到图片列表
* 按规则把图片随机分配到每条文案，生成“任务清单预览”
* 选中若干预览条目，派发到指定账号的发布队列（可绑定商品）

#### 3.6.2 CSV 解析与字段映射规则（字段级）

* 使用 PapaParse `header=true`，跳过空行
* header 会做 BOM 清理与 trim，并用小写进行匹配
* 标题字段匹配优先级：
  * 精确 key：`title`、`标题`
  * 包含匹配：header 包含 `title`
* 正文字段匹配优先级：
  * 精确 key：`body`、`正文`、`content`
  * 包含匹配：header 包含 `body/content/正文`
* 行过滤：只要该行任一字段 trim 后非空即认为“有效行”

#### 3.6.3 图片分配算法（generateManifest）

* **输入**
  * `imageFiles: string[]`：扫描目录得到的图片绝对路径
  * 选项：
    * `groupCount`：生成组数（0 表示等于 CSV 行数）
    * `minImages/maxImages`：每条任务分配图片数量范围（闭区间随机）
    * `maxReuse`：同一张图片最多被分配到多少条任务
    * `bestEffort`：图片不足时是否允许继续（默认 true）
* **核心规则**
  * 每条任务随机目标图片数 `desired ∈ [minImages, maxImages]`
  * 分配时遵守：
    * 同一条任务内不重复选同一张图
    * 全局复用次数不超过 `maxReuse`
  * 如果最终分配数 `< minImages`：
    * `bestEffort=false`：直接抛错终止生成
    * `bestEffort=true`：在任务 `log` 写入“图片不足”提示并继续生成

#### 3.6.4 预览、选择与派发

* 预览列表为虚拟滚动（性能）
* 支持全选/多选
* 派发时需要选择：
  * 账号 `accountId`
  * 商品（可选“无商品链接”）
* 派发 API：批量创建发布任务 `createBatch`（进入媒体矩阵待处理队列）

### 3.7 上传管理（Feishu Base 同步）

#### 3.7.1 功能目标

* 把数据工坊生成的“最终任务清单”（UploadTask）按顺序写入飞书多维表格
* 展示进度、成功/失败统计、每条任务状态与错误原因

#### 3.7.2 配置前置条件（字段级）

* 必填：
  * `appId`
  * `appSecret`
  * `baseToken`
  * `tableId`
  * `titleField`
  * `bodyField`
* 选填：
  * `imageField`

#### 3.7.3 同步策略

* 仅同步 `status !== 'success'` 的任务
* 每条任务处理流程：
  * 置为 `uploading`
  * 逐张图片上传获取 token
  * 创建记录写入字段映射（标题/正文/图片 token）
  * 成功：置为 `success` 并把 `record_id` 写入任务 log
  * 失败：置为 `error` 并写入错误原因
* 进度条：按完成数 / 总数展示

### 3.8 素材处理（ImageLab）

#### 3.8.1 功能目标（流水线）

* 输入图片 → 去水印 → 高清放大（Real-ESRGAN）→ 切宫格 → 导出/删除 → 发送到数据工坊继续生成任务

#### 3.8.2 去水印

* 依赖用户配置：
  * `pythonPath`（Python 解释器）
  * `watermarkScriptPath`（去水印脚本）
  * `watermarkBox`（相对坐标的去印区域）
* 区域配置：
  * 用户在首张图上框选区域，保存后持久化到配置

#### 3.8.3 高清放大与 GPU 并发控制

* 依赖用户配置 `realEsrganPath`
* 主进程对 GPU 相关处理使用 `p-limit(1)` 串行，避免多进程并发导致显存占用/崩溃

#### 3.8.4 切宫格与导出

* 输入 rows/cols，生成切片图片集合
* 支持导出（复制/导出到用户选择目录）与删除（从磁盘移除）
* 一键“发送到数据工坊”：把切片目录写入数据工坊路径并切换到对应模块

### 3.9 设置（Settings）

#### 3.9.1 工作区管理

* 展示当前工作区路径与状态
* 支持切换工作区并触发重启

#### 3.9.2 导入策略

* `importStrategy`：copy/move
* move 会删除源文件（有风险提示）

#### 3.9.3 飞书配置与字段映射

* 录入 appId/appSecret/baseToken/tableId
* 录入 titleField/bodyField/imageField
* “测试连接”用于校验配置并写日志

#### 3.9.4 工具路径配置

* Real-ESRGAN 可执行文件路径
* Python 解释器路径
* 去水印脚本路径

### 3.10 控制台日志（Console Panel）

* 底部常驻日志面板：展示系统日志与自动化日志流
* 支持展开/收起、自动滚动、清空
* 简单高亮规则：错误/失败红色，步骤信息蓝色

### 3.11 浏览器自动化发布（小红书）

> 本章节描述“用户可感知的发布行为”与“系统对外呈现的流程规则”。底层 DOM 自动化的具体定位策略见 TECHNICAL_ARCH。

#### 3.11.1 用户侧行为（可见窗口自动化）

* **触发时机**：到点自动发布、手动触发队列发布、批量存草稿等（由发布队列驱动）。
* **用户体验**：
  * 系统会打开一个可见的“小红书创作后台”窗口并自动执行操作。
  * 执行过程中持续输出步骤日志到“控制台日志”面板，便于定位卡点与失败原因。
  * 当脚本遇到关键异常会停止执行（避免误点击），并把错误原因回传到任务失败信息中。

#### 3.11.2 发布流程（重构后：严格串行）

* **重构前（旧逻辑的问题）**：视频上传、封面设置、文案填写可能存在并行/交叉等待，容易造成状态竞争（例如封面弹窗未就绪导致流程挂起，或 UI 状态变化导致错误点击）。
* **重构后（现行逻辑）**：统一采用严格串行的步骤编排，任何一步未完成不会进入下一步；非关键步骤引入“可跳过”的降级策略，优先保证草稿保存或发布动作可继续推进。

#### 3.11.3 视频发布流程（严格串行：先封面后文案）

* **严格顺序**：
  1. 上传视频
  2. 等待视频处理进入“设置封面”阶段（出现“设置封面”等标识）
  3. 设置封面（必须在文案前）
  4. 填写标题/正文（含话题）
  5. 挂车（添加商品）
  6. 发布或存草稿（取决于 publishMode）
* **发布模式**：
  * `draft`：等待自动保存完成后结束（以“草稿可用”为成功标准）。
  * `immediate`：在点击发布前进行“视频就绪”校验（发布按钮可用/清晰度提示等），点击发布后等待“发布成功/已发布”等成功反馈。

#### 3.11.4 容错降级体验（Fail-Soft）

* **封面设置为非阻塞步骤**：
  * 若封面入口因 UI 变化无法定位、封面弹窗加载超时、或上传交互失败，系统会记录 warning 并跳过封面设置。
  * 主流程继续完成标题/正文填写与挂车，优先保证草稿保存或发布动作能推进。
  * 该情况下封面需要由用户在创作后台页面中人工确认/调整（任务不因封面失败而直接终止）。

#### 3.11.5 误判屏蔽（“重新上传”不是失败信号）

* **规则**：上传成功后页面可能出现“重新上传”类入口，这是正常状态，不应被识别为失败信号。
* **失败判定**：仅当出现明确失败提示（如“上传失败/请重试”等）或长时间无法进入下一阶段时，才会认定上传失败并终止任务。

## 4. 非功能性需求

* **本地化**：所有数据存储在用户本地，无云端依赖。
* **性能**：
  * 图片裂变变异并发限制：`p-limit(3)`（避免 sharp 并发导致 OOM）
  * GPU/外部二进制处理串行：`p-limit(1)`（避免显存/子进程并发崩溃）
  * 大列表使用虚拟滚动（数据工坊预览列表）
* **UI/UX**：
  * 深色模式 (Dark Mode)：渲染层整体为深色主题，并对 react-big-calendar 做 dark 样式覆盖
  * 响应式布局：周视图最小宽度 + 横向滚动，避免列挤压
  * 关键操作二次确认：删除任务/删除账号/彻底删除等
* **可靠性**：
  * `db.json` 启动自动备份（保留 7 份）
  * NAS/锁冲突重试写入（降低 EBUSY/EPERM 失败概率）
