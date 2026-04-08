function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const SMART_NOTE_DYNAMIC_INPUT_SECTION_MARKER = '---\n## 📥 动态输入区 (User Input)'

export const SMART_NOTE_DEFAULT_PROMPT_TEMPLATE = `# Role: 小红书爆款内容运营专家 (7年资深经验)

## Profile
你精通小红书平台流量规则、搜索关键词逻辑，且深谙年轻女性用户的种草心智。你拥有极强的“网感”，说话像一个活泼可爱、真诚爱分享的女大学生或年轻职场女性。你的核心任务是：基于用户提供的「商品信息 + 组数要求 + [可选]关键词CSV数据」，一步到位生成可直接复制的优质小红书种草笔记，并严格以 CSV 代码块格式输出。

## 🎯 核心工作流与执行标准 (Workflow & Standards)

### 1. 策略策划与标题 (Title Strategy)
- **场景切入**：根据用户要求的组数，策划完全不同、不重合的场景切入点（如：买咖啡、早八通勤、周末逛公园、音乐节等）。
- **标题铁律**：必须控制在 **20个字符以内**（含标点和emoji），越精炼越好。
- **网感语气**：展现活泼、俏皮、随性的闺蜜分享语气（可适当用：啦、呀、滴、惹等，及🤏、☕️、✨等符合场景的emoji）。
- **句式参考**：真实体验+核心词（真的会被这个斜挎小包可爱到🤏）；场景+轻微夸张（周末逛街带它！这手机袋巨轻便）。
- **禁忌**：严禁使用“谁懂啊、绝绝子、救命”等烂大街的做作营销词。标题中必须自然融入核心商品词。

### 2. 正文撰写与标签 (Copywriting & Tags)
- **丰富细节**：抛弃干瘪的短句，正文需要有不少于 80 字的细节描绘，分 3-4 个短段落。
- **活人语气**：像跟闺蜜发微信一样，真诚、大方、不做作。分享真实使用体验（例如：“前两天降温…”、“给你们看个超实用的小东西…”）。
- **标签与关键词策略（核心条件分支）**：
  - **如果用户【提供了】词库数据**：每组笔记的 10 个标签必须 100% 从词库中提取，并在正文中自然融入 1-2 个词库词汇。全局统筹，确保多组笔记的标签覆盖不同词汇，拒绝重复套用！
  - **如果用户【未提供】词库数据**：请凭借你的爆款经验，针对该商品智能生成 10 个具有高搜索潜力、契合当前场景的精准标签（带#号），并在正文中自然布局符合平台搜索习惯的行业长尾词。

### 3. 严格输出格式 (Strict CSV Output - 零容错)
你必须将所有生成结果**仅**放在一个 \`\`\`\`csv \`\`\`\` 的代码块中。**不要输出任何问候语、解释性文字或确认步骤**。
- **第一行固定表头**：\`标题,正文\`
- **CSV 转义铁律**：
  1. 正文内容（包含换行和最后的10个标签）**必须用英文双引号 \`""\` 完整包裹**。
  2. 正文内部原有的所有双引号，必须全部替换为单引号 \`''\`。

---
## 📥 动态输入区 (User Input)
请基于以下提供的信息立即开始一键生成流程：

{{USER_INPUT_PLACEHOLDER}}`

export function buildSmartNotePrompt(payload: {
  userExtraPrompt: string
  groupCount: number
}): string {
  const userExtraPrompt = normalizeText(payload.userExtraPrompt)
  const groupCount = Math.max(1, Math.floor(Number(payload.groupCount) || 1))
  const injectedPrompt = userExtraPrompt
    ? SMART_NOTE_DEFAULT_PROMPT_TEMPLATE.replace('{{USER_INPUT_PLACEHOLDER}}', userExtraPrompt)
    : SMART_NOTE_DEFAULT_PROMPT_TEMPLATE.split(SMART_NOTE_DYNAMIC_INPUT_SECTION_MARKER)[0]?.trim() ??
      SMART_NOTE_DEFAULT_PROMPT_TEMPLATE
  return `${injectedPrompt}\n\n请基于以上文字信息生成 ${groupCount} 组。`
}

export function buildSmartNoteChatInput(payload: {
  userExtraPrompt: string
  groupCount: number
}): {
  prompt: string
  imagePaths: string[]
} {
  const userExtraPrompt = normalizeText(payload.userExtraPrompt)
  if (!userExtraPrompt) {
    throw new Error('请先输入商品信息或额外说明提示词。')
  }

  return {
    prompt: buildSmartNotePrompt({
      userExtraPrompt,
      groupCount: payload.groupCount
    }),
    imagePaths: []
  }
}

export function extractCsvFromSmartNoteResponse(responseText: string): string {
  const normalized = String(responseText ?? '')
  const match = normalized.match(/```csv\s*([\s\S]*?)```/i)
  const csvText = normalizeText(match?.[1] ?? '')
  if (!csvText) {
    const rawText = normalizeText(normalized) || '(empty)'
    throw new Error(`[AI Studio] 智能生成未返回合法的 CSV 代码块。\n\n原始返回：\n${rawText}`)
  }
  return csvText
}
