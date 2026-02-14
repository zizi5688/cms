# 文档更新报告（dual-doc-maintainer）

- 生成时间: 2026-02-14
- 执行模式: 全量模式
- 输出目录: `docs/`

## 1. 基线与扫描范围
基线探测:
- 文档存在性: `docs/user-manual.md`、`docs/architecture.md` 均不存在。
- 因此按规则直接执行全量模式，不计算增量 diff 区间。
- Git 环境信息（记录用）:
  - 当前分支: `codex/docs-management`
  - HEAD: `5d7bf64`
  - `origin/HEAD`: `origin/codex/p0-git-governance-rollout`

扫描范围:
- 主进程: `src/main/index.ts`, `src/main/services/*`, `src/main/taskManager.ts`, `src/main/publisher.ts`
- 预加载: `src/preload/index.ts`, `src/main/preload/*`
- 渲染层: `src/renderer/src/components/*`, `src/renderer/src/modules/*`, `src/renderer/src/store/useCmsStore.ts`, `src/renderer/src/lib/cms-engine.ts`
- 配置: `package.json`, `README.md`

## 2. 新增/修改模块摘要
新增文件:
- `docs/user-manual.md`
- `docs/architecture.md`
- `docs/_evidence.json`
- `docs/_update-report.md`

产出摘要:
- 完成 2 份交接文档全量生成（用户操作手册 + 架构文档）。
- 构建 24 条结构化证据索引，覆盖 UI、IPC、服务、数据库、日志、安全。
- 标注 6 条“待确认项”用于后续产品/架构确认。

## 3. 质量门禁结果
| 门禁项 | 阈值 | 本次结果 | 结论 |
| --- | --- | --- | --- |
| 证据完整率 | >= 90% | 94.4%（51/54 关键结论有直接代码证据） | 通过 |
| 失效证据链接 | = 0 | 0 | 通过 |
| 重复条目 | = 0 | 0 | 通过 |
| 待确认项 | <= 10 | 6 | 通过 |

说明:
- 本次达到门禁，不添加“未达门禁”页头标记。

## 4. 风险与待确认项
- 热度看板“绑定供应商”疑似未持久化，只更新了前端状态文本。
- 上传管理功能仍存在，但默认入口被隐藏，产品策略待明确。
- 当前监控主要依赖本地日志和诊断文件，缺少集中化告警能力。
- 主窗口 `sandbox=false` 的安全收敛路径待确认。
- 1688 调试模式依赖人工介入，自动化稳定性受外部页面影响较大。
- CSV 字段模板当前较宽松，建议确认是否需要强约束导入模板。

## 5. 安全脱敏执行记录
- 已脱敏字段类型: 飞书 appId/appSecret/baseToken/tableId、任意 token/密钥。
- 文档中仅保留字段名与用途，不包含实际敏感值。
- 未检测到需要中断写入的高风险明文密钥。
