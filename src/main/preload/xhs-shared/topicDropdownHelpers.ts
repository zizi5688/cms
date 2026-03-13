export type TopicDropdownRect = {
  top: number
  left: number
  width: number
  height: number
}

export type TopicDropdownCandidate = {
  id: string
  text: string
  containerId?: string | null
  domOrder: number
  rect: TopicDropdownRect
  isCreate?: boolean
}

export type TopicDropdownOptions = {
  baselineTextByContainerId?: ReadonlyMap<string, string> | null
}

export type TopicDropdownContainerSignature = {
  role?: string | null
  className?: string | null
  tagName?: string | null
  optionCount?: number
  hasTippyRootAttr?: boolean
}

export const TOPIC_DROPDOWN_NODE_SELECTOR = [
  'body [role="option"]',
  'body li',
  'body button',
  'body a',
  'body [class*="option"]',
  'body [class*="Option"]',
  'body [class*="topic"]',
  'body [class*="Topic"]',
  'body [data-tippy-root] *',
  'body .tippy-box *',
  'body .tippy-content *'
].join(', ')

export function isLikelyTopicDropdownContainerSignature(signature: TopicDropdownContainerSignature): boolean {
  const role = String(signature.role || '').trim().toLowerCase()
  if (role === 'listbox' || role === 'menu' || role === 'dialog' || role === 'tooltip') return true

  if (signature.hasTippyRootAttr === true) return true

  const className = String(signature.className || '').toLowerCase()
  if (
    className.includes('dropdown') ||
    className.includes('popover') ||
    className.includes('menu') ||
    className.includes('option') ||
    className.includes('list') ||
    className.includes('tippy') ||
    className.includes('tooltip')
  ) {
    return true
  }

  const tagName = String(signature.tagName || '').toLowerCase()
  if (tagName === 'ul' || tagName === 'ol') return true

  return Math.max(0, Math.floor(Number(signature.optionCount) || 0)) >= 2
}

function normalizeDigestPart(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function candidateGroupKey(candidate: TopicDropdownCandidate): string {
  const containerId = String(candidate.containerId || '').trim()
  return containerId || candidate.id
}

function buildGroupTextDigest(items: TopicDropdownCandidate[]): string {
  return items
    .map((item) => normalizeDigestPart(item.text))
    .filter(Boolean)
    .join(' | ')
}

export function buildTopicDropdownContainerTextIndex(
  candidates: TopicDropdownCandidate[]
): Map<string, string> {
  const groups = new Map<string, TopicDropdownCandidate[]>()
  for (const candidate of candidates) {
    const key = candidateGroupKey(candidate)
    const current = groups.get(key)
    if (current) current.push(candidate)
    else groups.set(key, [candidate])
  }

  const result = new Map<string, string>()
  for (const [key, items] of groups.entries()) {
    result.set(key, buildGroupTextDigest(items))
  }
  return result
}

type TopicDropdownGroup = {
  key: string
  items: TopicDropdownCandidate[]
  itemCount: number
  nonCreateCount: number
  domOrderStart: number
  domOrderEnd: number
  textDigest: string
  isNew: boolean
  textChanged: boolean
}

function compareGroups(a: TopicDropdownGroup, b: TopicDropdownGroup): number {
  const aHasFreshContent = a.isNew || a.textChanged
  const bHasFreshContent = b.isNew || b.textChanged
  if (aHasFreshContent !== bHasFreshContent) return aHasFreshContent ? -1 : 1
  if (a.textChanged !== b.textChanged) return a.textChanged ? -1 : 1
  if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
  if (a.nonCreateCount !== b.nonCreateCount) return b.nonCreateCount - a.nonCreateCount
  if (a.itemCount !== b.itemCount) return b.itemCount - a.itemCount
  if (a.domOrderEnd !== b.domOrderEnd) return b.domOrderEnd - a.domOrderEnd
  if (a.domOrderStart !== b.domOrderStart) return a.domOrderStart - b.domOrderStart
  return a.key.localeCompare(b.key)
}

export function orderTopicDropdownCandidates(
  candidates: TopicDropdownCandidate[],
  options: TopicDropdownOptions = {}
): TopicDropdownCandidate[] {
  if (candidates.length === 0) return []

  const groups = new Map<string, TopicDropdownCandidate[]>()
  for (const candidate of candidates) {
    const key = candidateGroupKey(candidate)
    const current = groups.get(key)
    if (current) current.push(candidate)
    else groups.set(key, [candidate])
  }

  const summaries: TopicDropdownGroup[] = []
  for (const [key, items] of groups.entries()) {
    const sortedItems = [...items].sort((a, b) => {
      if (a.domOrder !== b.domOrder) return a.domOrder - b.domOrder
      if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top
      if (a.rect.left !== b.rect.left) return a.rect.left - b.rect.left
      return a.text.length - b.text.length
    })
    const textDigest = buildGroupTextDigest(sortedItems)
    const baselineText = normalizeDigestPart(options.baselineTextByContainerId?.get(key) || '')
    summaries.push({
      key,
      items: sortedItems,
      itemCount: sortedItems.length,
      nonCreateCount: sortedItems.filter((item) => item.isCreate !== true).length,
      domOrderStart: sortedItems[0]?.domOrder ?? Number.POSITIVE_INFINITY,
      domOrderEnd: sortedItems[sortedItems.length - 1]?.domOrder ?? Number.NEGATIVE_INFINITY,
      textDigest,
      isNew: !baselineText,
      textChanged: Boolean(baselineText) && baselineText !== textDigest
    })
  }

  summaries.sort(compareGroups)
  const chosen = summaries[0]
  if (!chosen) return []

  const pool = chosen.nonCreateCount > 0 ? chosen.items.filter((item) => item.isCreate !== true) : chosen.items
  return [...pool].sort((a, b) => {
    if (a.domOrder !== b.domOrder) return a.domOrder - b.domOrder
    if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top
    if (a.rect.left !== b.rect.left) return a.rect.left - b.rect.left
    return a.text.length - b.text.length
  })
}
