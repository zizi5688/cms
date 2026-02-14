type ClusteringOptions = {
  timeWindowMs?: number
  similarityThreshold?: number
}

type ClusteringDecision = 'merge_fast' | 'merge_similarity' | 'split_similarity' | 'split_time'

type RemixOptions = {
  count?: number
  lookbackDays?: number
  timeWindowMs?: number
  similarityThreshold?: number
  prefix?: string
  publishedImageSignatures?: Set<string>
}

const EMOJI_PREFIXES = ['🔥', '💫', '✨', '🌟', '💖', '🎀', '🍃', '🌈', '💎', '🎯']

type CmsTaskCreatePayload = {
  accountId: string
  images: string[]
  title: string
  content: string
  tags?: string[]
  productId?: string
  productName?: string
  publishMode?: 'immediate'
}

function normalizeTitle(value: string): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  const withoutPrefix = trimmed.replace(/^\[\s*🎲\s*\]\s*/u, '').replace(/^\[\s*✨\s*\]\s*/u, '')
  return withoutPrefix.replace(/\s+/g, ' ').trim()
}

function toChars(value: string): string[] {
  return Array.from(String(value ?? ''))
}

function takePrefix(value: string, length: number): string {
  const chars = toChars(value.trim())
  return chars.slice(0, Math.max(0, length)).join('')
}

function buildNgrams(value: string, n: number): Set<string> {
  const chars = toChars(value)
  const grams = new Set<string>()
  if (n <= 0) return grams
  if (chars.length < n) return grams
  for (let i = 0; i <= chars.length - n; i += 1) {
    grams.add(chars.slice(i, i + n).join(''))
  }
  return grams
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const v of a) {
    if (b.has(v)) intersection += 1
  }
  const union = a.size + b.size - intersection
  if (union <= 0) return 0
  return intersection / union
}

function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a)
  const right = normalizeTitle(b)
  if (!left || !right) return 0

  const p4a = takePrefix(left, 4)
  const p4b = takePrefix(right, 4)
  if (p4a && p4a === p4b) return 1

  const p5a = takePrefix(left, 5)
  const p5b = takePrefix(right, 5)
  if (p5a && p5a === p5b) return 1

  const gramsA = buildNgrams(left, 2)
  const gramsB = buildNgrams(right, 2)
  const gramsScore = jaccardSimilarity(gramsA, gramsB)
  if (gramsScore > 0) return gramsScore

  const charsA = new Set(toChars(left))
  const charsB = new Set(toChars(right))
  return jaccardSimilarity(charsA, charsB)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function pickOne<T>(list: T[]): T | null {
  if (!list || list.length === 0) return null
  const index = Math.floor(Math.random() * list.length)
  return list[index] ?? null
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = items[i]
    items[i] = items[j] as T
    items[j] = temp as T
  }
  return items
}

function sampleUnique<T>(items: T[], count: number): T[] {
  const target = Math.min(Math.max(0, Math.floor(count)), items.length)
  if (target <= 0) return []
  const pool = items.slice()
  const picked: T[] = []
  for (let i = 0; i < target; i += 1) {
    const index = Math.floor(Math.random() * pool.length)
    picked.push(pool[index] as T)
    pool.splice(index, 1)
  }
  return picked
}

function imagesSignature(images: string[] | undefined | null): string {
  const unique = Array.from(new Set((images ?? []).filter((v) => Boolean(v))))
  unique.sort()
  return unique.join('|')
}

function comboKey(payload: {
  images: string[]
  title: string
  content: string
  productId?: string
}): string {
  const imagesPart = (payload.images ?? []).join('|')
  const titlePart = normalizeTitle(payload.title)
  const contentPart = String(payload.content ?? '').trim()
  const productPart = String(payload.productId ?? '')
  return `${imagesPart}@@${titlePart}@@${contentPart}@@${productPart}`
}

function shortenForToast(value: string, maxChars: number): string {
  const normalized = normalizeTitle(value)
  if (!normalized) return '(未命名)'
  const chars = toChars(normalized)
  if (chars.length <= maxChars) return normalized
  return `${chars.slice(0, maxChars).join('')}...`
}

function filterRecentTasks(tasks: CmsPublishTask[], lookbackDays: number): CmsPublishTask[] {
  const days = Number.isFinite(lookbackDays) ? lookbackDays : 14
  const since = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000
  return (tasks ?? []).filter((t) => isNumber(t.createdAt) && t.createdAt >= since)
}

export function smartClustering(
  tasks: CmsPublishTask[],
  options?: ClusteringOptions
): CmsPublishTask[][] {
  const timeWindowMs = options?.timeWindowMs ?? 5 * 60 * 1000
  const similarityThreshold = options?.similarityThreshold ?? 0.3
  const fastGapMs = 60 * 1000
  const isDev = Boolean(import.meta.env?.DEV)
  const sorted = (tasks ?? [])
    .filter((t) => isNumber(t.createdAt))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)

  const batches: CmsPublishTask[][] = []
  let current: CmsPublishTask[] = []

  for (const task of sorted) {
    const prev = current[current.length - 1]
    if (!prev) {
      current = [task]
      continue
    }
    const timeGap = task.createdAt - prev.createdAt
    let similarity: number | null = null
    let decision: ClusteringDecision = 'merge_similarity'

    if (timeGap < fastGapMs) {
      decision = 'merge_fast'
    } else if (timeGap > timeWindowMs) {
      decision = 'split_time'
    } else {
      similarity = titleSimilarity(prev.title ?? '', task.title ?? '')
      if (similarity >= similarityThreshold) decision = 'merge_similarity'
      else decision = 'split_similarity'
    }

    if (isDev) {
      console.log('[Remix] Clustering: Task A vs Task B', {
        timeGap,
        similarity,
        decision
      })
    }

    if (decision === 'split_time' || decision === 'split_similarity') {
      batches.push(current)
      current = [task]
    } else {
      current.push(task)
    }
  }
  if (current.length > 0) batches.push(current)

  const finalBatches = batches.filter((b) => b.length >= 3)
  if (isDev) {
    console.log(
      '[Remix] Final Batches:',
      finalBatches.map((b) => b.length)
    )
  }
  return finalBatches
}

/** 均匀展开图片张数，例如 pool=7,min=3,max=7,count=5 → [3,4,5,6,7] (shuffled) */
function spreadImageCounts(count: number, min: number, max: number): number[] {
  if (min >= max) return Array.from({ length: count }, () => min)
  const span = max - min + 1
  const result: number[] = []
  for (let i = 0; i < count; i += 1) {
    result.push(min + (i % span))
  }
  return shuffleInPlace(result)
}

/** 计算两组图片路径集合的 Jaccard 相似度 */
function imageSetJaccard(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  return jaccardSimilarity(setA, setB)
}

export function buildSurpriseRemix(
  tasks: CmsPublishTask[],
  options?: RemixOptions
): {
  selectedBatch: CmsPublishTask[]
  sampleTitle: string
  payloads: CmsTaskCreatePayload[]
} | null {
  const count = options?.count ?? 5
  const lookbackDays = options?.lookbackDays ?? 14
  const timeWindowMs = options?.timeWindowMs ?? 5 * 60 * 1000
  const similarityThreshold = options?.similarityThreshold ?? 0.3
  const remixTag = 'remix'

  const recent = filterRecentTasks(tasks ?? [], lookbackDays)
  const batches = smartClustering(recent, { timeWindowMs, similarityThreshold })
  const selectedBatch = pickOne(batches)
  if (!selectedBatch) return null

  const allImagesPool = Array.from(
    new Set(selectedBatch.flatMap((task) => (task.images ?? []).filter((v) => Boolean(v))))
  )
  if (allImagesPool.length === 0) return null

  const imgCounts = selectedBatch.map((t) => (t.images ?? []).length).filter((n) => n > 0)
  const baselineMin = imgCounts.length > 0 ? Math.min(...imgCounts) : 0
  const baselineMax = imgCounts.length > 0 ? Math.max(...imgCounts) : 0
  const minImgCount = Math.min(allImagesPool.length, Math.max(3, baselineMin || 3))
  if (minImgCount <= 0) return null
  const maxImgCount = Math.min(
    allImagesPool.length,
    Math.max(minImgCount, baselineMax || minImgCount)
  )
  const enforceUniqueImageSets = maxImgCount > minImgCount || allImagesPool.length > minImgCount

  const originals = new Set<string>()
  const originalImageSets = new Set<string>()
  for (const t of selectedBatch) {
    originals.add(
      comboKey({
        images: t.images ?? [],
        title: t.title ?? '',
        content: t.content ?? '',
        productId: t.productId
      })
    )
    originalImageSets.add(imagesSignature(t.images))
  }

  // Step 3: 跨历史去重 — 合并已发布任务的图片签名
  if (options?.publishedImageSignatures) {
    for (const sig of options.publishedImageSignatures) {
      originalImageSets.add(sig)
    }
  }

  const imageSources = selectedBatch.filter((t) => (t.images ?? []).length > 0)
  const titleSources = selectedBatch.filter((t) => normalizeTitle(t.title ?? ''))
  const contentSources = selectedBatch.filter((t) => String(t.content ?? '').trim())

  // Step 2a: 标题/正文来源轮换 — shuffle 后 i%length 轮换取值
  const shuffledTitleSources = shuffleInPlace(titleSources.slice())
  const shuffledContentSources = shuffleInPlace(contentSources.slice())

  // Step 4a: 图片张数均匀展开
  const targetCounts = spreadImageCounts(count, minImgCount, maxImgCount)

  const createdKeys = new Set<string>()
  const createdImageSets = new Set<string>()
  const usedCovers = new Set<string>()
  const acceptedImageLists: string[][] = []
  const payloads: CmsTaskCreatePayload[] = []

  for (let i = 0; i < count; i += 1) {
    // Step 2: 标题/正文轮换选择（在 retry 循环外）
    const titleTask = shuffledTitleSources.length > 0
      ? shuffledTitleSources[i % shuffledTitleSources.length]
      : pickOne(selectedBatch)
    const contentTask = shuffledContentSources.length > 0
      ? shuffledContentSources[i % shuffledContentSources.length]
      : pickOne(selectedBatch)
    if (!titleTask || !contentTask) break

    const rawTitleBase = normalizeTitle(titleTask.title ?? '') || '(未命名)'
    // Step 2b: emoji 前缀轮换
    const emoji = EMOJI_PREFIXES[i % EMOJI_PREFIXES.length]
    const rawTitle = takePrefix(`${emoji}${rawTitleBase}`, 20)
    const content = String(contentTask.content ?? '').trim()

    // Step 4a: 使用均匀展开的张数
    const targetCount = targetCounts[i] ?? minImgCount

    let payload: CmsTaskCreatePayload | null = null
    let key = ''
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const baseTask = pickOne(imageSources) ?? pickOne(selectedBatch)
      if (!baseTask) break

      const selectedImages = shuffleInPlace(sampleUnique(allImagesPool, targetCount))
      const signature = imagesSignature(selectedImages)
      const shouldEnforceUniqueImages = enforceUniqueImageSets && attempt < 12
      if (shouldEnforceUniqueImages) {
        if (originalImageSets.has(signature)) continue
        if (createdImageSets.has(signature)) continue
      }

      // Step 4b: 封面去重 — 前 8 次 attempt 尝试不同封面
      const cover = selectedImages[0] ?? ''
      if (cover && usedCovers.has(cover) && attempt < 8) {
        // 尝试从已选图片中 swap 封面
        const altIndex = selectedImages.findIndex((img, idx) => idx > 0 && !usedCovers.has(img))
        if (altIndex > 0) {
          const temp = selectedImages[0]
          selectedImages[0] = selectedImages[altIndex] as string
          selectedImages[altIndex] = temp as string
        } else if (attempt < 4) {
          // 前 4 次硬拒重复封面
          continue
        }
      }

      // Step 4c: Jaccard 距离约束 — 前 12 次 attempt 拒绝高相似度
      if (attempt < 12 && acceptedImageLists.length > 0) {
        const tooSimilar = acceptedImageLists.some(
          (prev) => imageSetJaccard(prev, selectedImages) > 0.8
        )
        if (tooSimilar) continue
      }

      payload = {
        accountId: baseTask.accountId,
        images: selectedImages,
        title: rawTitle,
        content,
        tags: [remixTag],
        productId: baseTask.productId,
        productName: baseTask.productName,
        publishMode: 'immediate'
      }

      key = comboKey({
        images: payload.images,
        title: payload.title,
        content: payload.content,
        productId: payload.productId
      })

      if (originals.has(key)) continue
      if (createdKeys.has(key)) continue
      break
    }

    if (!payload) break
    createdKeys.add(key)
    createdImageSets.add(imagesSignature(payload.images))
    usedCovers.add(payload.images[0] ?? '')
    acceptedImageLists.push(payload.images.slice())
    payloads.push(payload)
  }

  if (payloads.length === 0) return null

  return {
    selectedBatch,
    sampleTitle: shortenForToast(selectedBatch[0]?.title ?? '', 18),
    payloads
  }
}
