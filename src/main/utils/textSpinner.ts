type SynonymDict = Record<string, string[]>

export type SpinTextOptions = {
  mode?: 'title' | 'content'
  forceChange?: boolean
  maxLength?: number
}

const DICT: SynonymDict = {
  绝美: ['绝绝子', '美到犯规', '神仙颜值'],
  显瘦: ['遮肉显瘦', '巨显瘦', '瘦到离谱'],
  百搭: ['怎么搭都行', '万能搭配', '随手搭都好看'],
  高级: ['质感拉满', '高级感爆棚', '细节很贵气'],
  氛围感: ['氛围感直接拉满', '氛围在线', '氛围感绝了'],
  温柔: ['软糯温柔', '奶乎乎', '温柔到不行'],
  复古: ['复古味儿很正', 'old school', '复古感拉满'],
  显白: ['提亮肤色', '自带打光', '白到发光'],
  舒适: ['穿着不累', '体感超好', '舒服到飞起'],
  质感: ['细节很顶', '质感在线', '高级质感'],
  平价: ['性价比拉满', '学生党友好', '不心疼'],
  必入: ['闭眼入', '必须冲', '不买亏'],
  推荐: ['安利', '强推', '真的可以'],
  种草: ['入坑', '狠狠爱上', '直接上头'],
  完美: ['无可挑剔', '太顶了', '直接封神'],
  好看: ['巨好看', '颜值在线', '好看到离谱'],
  抢眼: ['回头率爆表', '一眼惊艳', '太吸睛'],
  小众: ['不撞款', '冷门宝藏', '独一份'],
  出片: ['巨出片', '拍照超能打', '随手拍都好看'],
  绝了: ['太顶了', '真的离谱', '狠狠爱了'],
  稳: ['稳稳拿捏', '很稳', '完全稳住'],
  喜欢: ['狠狠爱了', '很上头', '越看越喜欢'],
  上身: ['上身效果', '上身氛围', '穿上身'],
  通勤: ['日常通勤', '上班通勤', '通勤党友好'],
  约会: ['约会氛围', '见面场景', '约会局'],
  实用: ['实穿', '使用率高', '非常能打'],
  细节: ['做工细节', '细节处理', '小设计'],
  性价比: ['性价比很高', '价格友好', '真香价位'],
  回购: ['会回购', '值得复购', '下次还买']
}

const TITLE_FALLBACK_TOKENS = ['稳了', '真香', '拿捏', '会回购']
const CONTENT_FALLBACK_SUFFIXES = [
  '实测细节很能打。',
  '上身和质感都在线。',
  '日常通勤也很稳。',
  '这类场景真的很出片。'
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

function truncateByCodeUnits(value: string, maxUnits: number): string {
  const input = String(value ?? '')
  const limit = Math.max(0, Math.floor(maxUnits))
  if (!input || limit <= 0) return ''
  let used = 0
  let out = ''
  for (const ch of input) {
    const units = ch.length
    if (used + units > limit) break
    out += ch
    used += units
  }
  return out
}

function normalizeSpaces(value: string, mode: 'title' | 'content'): string {
  if (mode === 'title') return value.replace(/\s+/g, ' ').trim()
  return value.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function normalizeForCompare(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[!！~～。.,，、;；:：]/g, '')
    .trim()
}

function applySynonymRewrite(raw: string, mode: 'title' | 'content'): { text: string; replaceCount: number } {
  const baseProbability = mode === 'title' ? 0.72 : 0.58
  const keys = Object.keys(DICT).sort((a, b) => b.length - a.length)
  let next = raw
  let replaceCount = 0
  for (const key of keys) {
    if (!next.includes(key)) continue
    const synonyms = DICT[key]
    if (!synonyms || synonyms.length === 0) continue
    const re = new RegExp(escapeRegExp(key), 'g')
    next = next.replace(re, (matched) => {
      if (Math.random() > baseProbability) return matched
      const candidate = pickOne(synonyms)
      if (!candidate || candidate === matched) return matched
      replaceCount += 1
      return candidate
    })
  }
  return { text: next, replaceCount }
}

function applyPhraseRewrite(raw: string): { text: string; replaceCount: number } {
  const transforms: Array<[RegExp, string[]]> = [
    [/太好看了/g, ['好看到离谱', '颜值真的能打', '越看越喜欢']],
    [/真的推荐/g, ['真的可以冲', '这波可以闭眼入', '值得认真安利']],
    [/非常舒服/g, ['体感很舒服', '穿着不累', '上身很轻松']],
    [/很显瘦/g, ['遮肉显瘦', '版型很显瘦', '对身材很友好']],
    [/很百搭/g, ['怎么搭都顺眼', '万能搭配', '一件搞定搭配']],
    [/质感很好/g, ['质感很顶', '细节很能打', '做工在线']]
  ]
  let next = raw
  let replaceCount = 0
  for (const [re, values] of transforms) {
    next = next.replace(re, (matched) => {
      if (Math.random() > 0.55) return matched
      const candidate = pickOne(values)
      if (!candidate || candidate === matched) return matched
      replaceCount += 1
      return candidate
    })
  }
  return { text: next, replaceCount }
}

function applyPunctuationVariation(raw: string, mode: 'title' | 'content'): { text: string; replaceCount: number } {
  let next = raw
  let replaceCount = 0
  if (/[!！]/.test(next) && Math.random() < 0.7) {
    next = next.replace(/[!！]+/g, mode === 'title' ? '！！' : '！')
    replaceCount += 1
  } else if (mode === 'title' && !/[!！?？]/.test(next) && Math.random() < 0.45) {
    next = `${next}！`
    replaceCount += 1
  }
  if (mode === 'content' && /。/.test(next) && Math.random() < 0.35) {
    next = next.replace(/。/g, '，')
    replaceCount += 1
  }
  return { text: next, replaceCount }
}

function applyForceFallback(raw: string, mode: 'title' | 'content', maxLength: number | undefined): string {
  const base = normalizeSpaces(raw, mode)
  if (!base) return base
  if (mode === 'title') {
    const token = pickOne(TITLE_FALLBACK_TOKENS)
    const candidate = base.includes(token) ? `${base}！` : `${base}${token}`
    const limited = typeof maxLength === 'number' && maxLength > 0 ? truncateByCodeUnits(candidate, maxLength) : candidate
    if (normalizeForCompare(limited) !== normalizeForCompare(base)) return limited
    const punctuated = `${base}！`
    return typeof maxLength === 'number' && maxLength > 0
      ? truncateByCodeUnits(punctuated, maxLength)
      : punctuated
  }
  const suffix = pickOne(CONTENT_FALLBACK_SUFFIXES)
  if (!base.includes(suffix)) return `${base}\n${suffix}`
  return `${base}\n${suffix.slice(0, Math.max(1, Math.floor(suffix.length / 2)))}`
}

export function spinText(text: string, options?: SpinTextOptions): string {
  const mode = options?.mode === 'content' ? 'content' : 'title'
  const raw = String(text ?? '')
  const normalizedRaw = normalizeSpaces(raw, mode)
  if (!normalizedRaw) return normalizedRaw

  const byDict = applySynonymRewrite(normalizedRaw, mode)
  const byPhrase = applyPhraseRewrite(byDict.text)
  const byPunctuation = applyPunctuationVariation(byPhrase.text, mode)
  let next = byPunctuation.text
  const replaceCount = byDict.replaceCount + byPhrase.replaceCount + byPunctuation.replaceCount

  if (options?.forceChange && normalizeForCompare(next) === normalizeForCompare(normalizedRaw)) {
    next = applyForceFallback(normalizedRaw, mode, options?.maxLength)
  }

  if (mode === 'title' && replaceCount > 0 && Math.random() < 0.2) {
    next = next.replace(/^(🔥|💫|✨|🌟|💖|🎀|🍃|🌈|💎|🎯|⭐|🪄)/, (matched) => matched || '✨')
  }

  if (typeof options?.maxLength === 'number' && options.maxLength > 0) {
    next = truncateByCodeUnits(next, options.maxLength)
  }
  return normalizeSpaces(next, mode)
}
