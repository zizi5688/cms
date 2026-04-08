import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SMART_NOTE_DEFAULT_PROMPT_TEMPLATE,
  buildSmartNotePrompt,
  buildSmartNoteChatInput,
  extractCsvFromSmartNoteResponse
} from './smartNoteGenerationHelpers.ts'

test('buildSmartNotePrompt injects user prompt and group count instructions', () => {
  const result = buildSmartNotePrompt({
    userExtraPrompt: '主推春季通勤斜挎包，语气自然一点',
    groupCount: 10
  })

  assert.match(result, /主推春季通勤斜挎包，语气自然一点/)
  assert.match(result, /请基于以上文字信息生成 10 组。/)
  assert.doesNotMatch(result, /商品请参考图片/)
  assert.doesNotMatch(result, /\{\{USER_INPUT_PLACEHOLDER\}\}/)
  assert.ok(result.startsWith(SMART_NOTE_DEFAULT_PROMPT_TEMPLATE.replace('{{USER_INPUT_PLACEHOLDER}}', '主推春季通勤斜挎包，语气自然一点').slice(0, 20)))
})

test('extractCsvFromSmartNoteResponse returns csv fenced block content', () => {
  const result = extractCsvFromSmartNoteResponse(`
这里是说明

\`\`\`csv
标题,正文
测试标题,"测试正文"
\`\`\`
`)

  assert.equal(result, '标题,正文\n测试标题,"测试正文"')
})

test('extractCsvFromSmartNoteResponse rejects when csv fence is missing', () => {
  assert.throws(
    () => extractCsvFromSmartNoteResponse('标题,正文\n测试标题,"测试正文"'),
    /未返回合法的 CSV 代码块/
  )
})

test('buildSmartNoteChatInput builds a text-only chat payload during the temporary downgrade', () => {
  const result = buildSmartNoteChatInput({
    userExtraPrompt: '突出春季日常通勤场景',
    groupCount: 6
  })

  assert.deepEqual(result.imagePaths, [])
  assert.match(result.prompt, /突出春季日常通勤场景/)
  assert.match(result.prompt, /请基于以上文字信息生成 6 组。/)
})

test('buildSmartNoteChatInput rejects blank text input during the temporary downgrade', () => {
  assert.throws(
    () =>
      buildSmartNoteChatInput({
        userExtraPrompt: '   ',
        groupCount: 3
      }),
    /请先输入商品信息或额外说明提示词/
  )
})
