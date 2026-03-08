# AI 服务 Provider / Model / Endpoint 配置设计

## 背景

当前 Settings 页中的 AI 服务配置只有单组全局字段：
- `Provider`
- `Host / Base URL`
- `API Key`
- `默认模型`

这套结构可以满足单一供应商的录入，但无法支撑以下真实使用场景：
- 同时维护多个供应商（如 `grsai`、`allapi`）。
- 同一供应商下维护多个模型。
- 不同模型需要不同 `API 端点`。
- 新增自定义供应商 / 模型后，希望沉淀为可复用选项，而不是只保留当前输入值。

## 目标

本次改造目标：
- 将 AI 配置升级为“供应商档案 + 模型子项”结构。
- 允许用户新增并保存自定义供应商。
- 允许用户在当前供应商下新增并保存模型。
- 为每个模型单独保存 `API 端点`。
- 设置页中的当前选择始终与本地配置持久化保持一致。
- 保持旧的请求链路兼容，避免一次性重写所有运行时逻辑。

## 非目标

本次不做：
- 完整的多供应商运行时适配框架。
- 供应商 SDK 层抽象。
- 批量模型管理、删除、排序。
- 云端同步配置。

## 已确认方案

采用 `A` 方案：按供应商组织配置，并在供应商下保存模型与端点。

### 数据层结构

新增本地持久化结构 `aiProviderProfiles`，建议形态如下：

```ts
interface AiModelProfile {
  id: string
  modelName: string
  endpointPath: string
}

interface AiProviderProfile {
  id: string
  providerName: string
  baseUrl: string
  apiKey: string
  models: AiModelProfile[]
  defaultModelId: string | null
}
```

同时保留“当前激活选择”：
- `aiProvider`：当前使用中的供应商名称
- `aiDefaultImageModel`：当前使用中的模型名
- `aiBaseUrl` / `aiApiKey`：兼容字段，保存当前激活供应商的值
- 新增 `aiEndpointPath`：兼容字段，保存当前激活模型的端点

这样可以做到：
- 新界面按 profile 工作；
- 旧逻辑仍然能从兼容字段读取到当前值；
- 后续运行时可以渐进迁移，不需要一次性重写全部调用链。

## 迁移策略

应用读取配置时执行一次轻量迁移：

1. 若本地尚无 `aiProviderProfiles`：
   - 从旧字段 `aiProvider / aiBaseUrl / aiApiKey / aiDefaultImageModel` 生成一个默认 provider profile。
   - 若旧模型非空，则在该 provider 下创建一个模型项。
   - 该模型的 `endpointPath` 初始取空字符串，或使用旧兼容字段 `aiEndpointPath`。
2. 若已有 `aiProviderProfiles`：
   - 做字段标准化（去空格、去重、缺省值修复）。
3. 每次保存当前供应商 / 模型时：
   - 同步回写兼容字段，确保旧调用链读取到最新值。

## 设置页交互

### 1. 当前供应商
- 顶部保留 `Provider` 下拉。
- 下拉展示“已保存供应商列表 + 自定义供应商…”。
- 选择已保存供应商时，自动加载该供应商的：
  - `Host / Base URL`
  - `API Key`
  - `默认模型`候选列表
- 选择“自定义供应商…”时，显示：
  - 供应商名称输入框
  - `保存供应商` 按钮

### 2. 当前模型
- `默认模型` 下拉只展示“当前供应商下”的模型。
- 下拉展示“已保存模型列表 + 自定义模型…”。
- 选择“自定义模型…”时，显示：
  - 模型名称输入框
  - `API 端点` 输入框
  - `保存模型` 按钮

### 3. 供应商字段编辑
- `Host / Base URL`
- `API Key`

这两个字段属于当前供应商，而不是全局字段。
用户修改后，可通过现有自动保存机制持续写回当前 provider profile；新增供应商时，则由 `保存供应商` 作为明确确认动作。

### 4. 模型字段编辑
- `API 端点` 属于当前模型，而不是全局字段。
- 切换模型时，自动切换该模型的端点显示。
- 保存模型后，该模型进入下拉并可直接复用。

## 运行时读取规则

运行时优先读取“当前激活供应商 + 当前激活模型”解析结果：
- `providerName`
- `baseUrl`
- `apiKey`
- `modelName`
- `endpointPath`

为兼容现有代码：
- `aiProvider` 写入当前 provider 名称
- `aiBaseUrl` 写入当前 provider 的 `baseUrl`
- `aiApiKey` 写入当前 provider 的 `apiKey`
- `aiDefaultImageModel` 写入当前 model 名称
- `aiEndpointPath` 写入当前 model 的 `endpointPath`

这样即使尚未重构所有服务层，已有逻辑也能读取到最新激活值。

## 错误提示与约束

### 缺失提示
- 未保存或未选择供应商：`请先保存并选择供应商。`
- 当前供应商下没有模型：`当前供应商暂无模型，请先保存模型。`
- 当前模型缺少端点：`当前模型未配置 API 端点。`
- 测试连接失败时：错误信息需带上当前 `provider / model / endpointPath`。

### 输入约束
- `Host / Base URL` 仅填写 Host，不含接口路径。
- `API 端点` 单独填写路径，例如：
  - `/v1/chat/completions`
  - `/v1beta/models/gemini-2.5-flash-image-preview:generateContent`
- 保存模型时要求：
  - `modelName` 非空
  - `endpointPath` 非空
- 保存供应商时要求：
  - `providerName` 非空

## 验证标准

- 新建供应商后，下拉可立即选到，重启后仍能保留。
- 在某供应商下新建模型并填写端点后，下拉可立即选到，重启后仍能保留。
- 切换供应商时，`Host / API Key / 模型列表` 会联动更新。
- 切换模型时，`API 端点` 会联动更新。
- 测试连接和 AI Studio 运行读取到的是当前激活供应商 + 模型配置。
- 旧配置可自动迁移，不丢失已有 Provider / Model / Key / Base URL。
