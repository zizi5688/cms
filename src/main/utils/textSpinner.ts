type SynonymDict = Record<string, string[]>

const DICT: SynonymDict = {
  绝美: ['绝绝子', '神仙颜值', '美到犯规'],
  显瘦: ['遮肉', '巨显瘦', '瘦到离谱'],
  百搭: ['随便搭都行', '万能搭配', '怎么穿都好看'],
  高级: ['质感拉满', '贵气感', '高级感爆棚'],
  氛围感: ['氛围直接拉满', '氛围感绝了', '氛围在线'],
  温柔: ['温柔到不行', '奶乎乎', '软糯'],
  复古: ['复古感拉满', '复古味儿', 'old school'],
  显白: ['提亮肤色', '自带打光', '白到发光'],
  舒适: ['穿着不累', '舒服到飞起', '体感超好'],
  质感: ['有质感', '细节很顶', '高级质感'],
  平价: ['性价比拉满', '学生党友好', '不心疼'],
  必入: ['闭眼入', '必须冲', '不买亏'],
  推荐: ['安利', '强推', '真的可以'],
  种草: ['入坑', '狠狠爱上', '直接上头'],
  完美: ['无可挑剔', '太顶了', '直接封神'],
  好看: ['巨好看', '好看到离谱', '颜值在线'],
  抢眼: ['回头率爆表', '一眼惊艳', '太吸睛'],
  小众: ['不撞款', '冷门宝藏', '独一份'],
  出片: ['巨出片', '拍照超能打', '随手拍都好看'],
  绝了: ['太顶了', '真的离谱', '狠狠爱了']
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}

export function spinText(text: string): string {
  const raw = String(text ?? '')
  if (!raw.trim()) return raw

  const replaceProbability = randomBetween(0.3, 0.5)
  const keys = Object.keys(DICT).sort((a, b) => b.length - a.length)

  let next = raw
  for (const key of keys) {
    if (!next.includes(key)) continue
    const synonyms = DICT[key]
    if (!synonyms || synonyms.length === 0) continue

    const re = new RegExp(escapeRegExp(key), 'g')
    next = next.replace(re, (matched) => {
      if (Math.random() > replaceProbability) return matched
      const candidate = pickOne(synonyms)
      return candidate || matched
    })
  }

  return next
}
