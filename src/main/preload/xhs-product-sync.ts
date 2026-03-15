/**
 * xhs-product-sync.ts — 小红书商品同步自动化
 *
 * 从草稿箱打开编辑器，进入添加商品弹窗，爬取所有商品信息返回。
 */
import { ipcRenderer } from 'electron'
import {
  sleep,
  normalizeText,
  isVisible,
  isVisibleForWait,
  waitFor,
  queryFirstVisible,
  findLeafByTextIncludes,
  findTopMostVisibleModal,
  getModalRoot,
  getElementLabel
} from './xhs-shared/dom-helpers'
import { simulateClick, gaussianDelay, scrollToBottom } from './xhs-shared/interaction'

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'

// ---------------------------------------------------------------------------
// 视觉辅助（调试用高亮）
// ---------------------------------------------------------------------------

function withRedBorder(el: HTMLElement): () => void {
  const previous = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    boxShadow: el.style.boxShadow
  }
  try {
    el.style.outline = '5px solid red'
    el.style.outlineOffset = '2px'
    el.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.85)'
  } catch {
    // 静默
  }
  return () => {
    try {
      el.style.outline = previous.outline
      el.style.outlineOffset = previous.outlineOffset
      el.style.boxShadow = previous.boxShadow
    } catch {
      // 静默
    }
  }
}

function withBlueBorder(el: HTMLElement): () => void {
  const previous = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    boxShadow: el.style.boxShadow
  }
  try {
    el.style.outline = '5px solid blue'
    el.style.outlineOffset = '2px'
    el.style.boxShadow = '0 0 10px rgba(0, 102, 255, 0.85)'
  } catch {
    // 静默
  }
  return () => {
    try {
      el.style.outline = previous.outline
      el.style.outlineOffset = previous.outlineOffset
      el.style.boxShadow = previous.boxShadow
    } catch {
      // 静默
    }
  }
}

// ---------------------------------------------------------------------------
// 页面元素查找
// ---------------------------------------------------------------------------

async function visualWaitFor(
  keyword: string,
  timeoutMs: number,
  root?: ParentNode | null
): Promise<HTMLElement> {
  const wanted = normalizeText(keyword)
  if (!wanted) throw new Error('[XHS] visualWaitFor requires keyword.')

  const startedAt = Date.now()
  while (Date.now() - startedAt < Math.max(0, timeoutMs)) {
    const searchRoot = root || findTopMostVisibleModal() || document.body
    const el =
      findLeafByTextIncludes(wanted, searchRoot) ||
      (searchRoot !== document.body ? findLeafByTextIncludes(wanted, document.body) : null)

    if (el) {
      const label = getElementLabel(el)
      console.log(`Found [${wanted}] tag=${label.tagName} class=${label.className || '(none)'}`)
      try {
        el.scrollIntoView?.({ block: 'center', inline: 'nearest' })
      } catch {
        // 静默
      }
      await simulateClick(el)
      return el
    }

    await sleep(350 + Math.floor(Math.random() * 300))
  }

  throw new Error(`[XHS] visualWaitFor timeout: ${wanted}`)
}

// ---------------------------------------------------------------------------
// 草稿箱相关
// ---------------------------------------------------------------------------

function detectDraftModalRoot(): HTMLElement | null {
  const candidates = [
    findLeafByTextIncludes('图文笔记', document.body),
    findLeafByTextIncludes('视频笔记', document.body)
  ].filter(Boolean) as HTMLElement[]

  const classCandidates = Array.from(
    document.querySelectorAll(
      '[class*="draft"][class*="modal"], [class*="Draft"][class*="Modal"], [class*="draft-modal"]'
    )
  ).filter((el) => isVisible(el)) as HTMLElement[]

  const picked = candidates[0] || classCandidates[0] || null
  if (!picked) return null
  return getModalRoot(picked) || picked
}

async function waitForDraftModalVisible(): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const modalRoot = detectDraftModalRoot()
      if (modalRoot) {
        clearInterval(timer)
        resolve(modalRoot)
        return
      }

      if (Date.now() - startedAt > 120_000) {
        clearInterval(timer)
        reject(new Error('[XHS] Draft modal not detected (timeout).'))
      }
    }, 500)
  })
}

async function ensureOnPublishPage(): Promise<void> {
  const url = normalizeText(location.href)
  if (url.startsWith(XHS_PUBLISH_URL)) return
  try {
    location.href = XHS_PUBLISH_URL
  } catch {
    // 静默
  }
  await waitFor(
    () => {
      const u = normalizeText(location.href)
      if (!u.includes('/publish/publish')) return null
      const hasUpload = document.querySelector('input[type="file"]')
      return hasUpload ? true : null
    },
    { timeoutMs: 60_000, intervalMs: 250, timeoutMessage: '[XHS] Publish page not ready.' }
  )
}

async function openDraftBoxAutoOrManual(): Promise<HTMLElement> {
  try {
    await visualWaitFor('草稿箱', 15_000, document.body)
  } catch {
    console.log(`[Manual Request] Could not find '草稿箱' button automatically.`)
    try {
      window.alert('🤖 Lyra: 我没找到【草稿箱】按钮。\n\n请您手动点击一下右上角的草稿箱，点击后我会自动继续！')
    } catch {
      // 静默
    }
  }
  const modalRoot = await waitForDraftModalVisible()
  return modalRoot
}

async function clickDraftImageTab(modalRoot: HTMLElement): Promise<void> {
  await visualWaitFor('图文笔记', 10_000, modalRoot)
}

function findDraftListRoot(modalRoot: HTMLElement | null): HTMLElement | null {
  const base = modalRoot || document.body
  const candidates = [
    ...Array.from(base.querySelectorAll('ul, [role="list"]')),
    ...Array.from(base.querySelectorAll('[class*="list"], [class*="List"]'))
  ]
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue
    if (!isVisibleForWait(el)) continue
    if (!el.querySelector) continue
    const hasEdit = Boolean(findLeafByTextIncludes('编辑', el))
    if (hasEdit) return el
  }
  return null
}

async function clickFirstEditInDraftModal(modalRoot: HTMLElement): Promise<void> {
  const listRoot = findDraftListRoot(modalRoot)
  await visualWaitFor('编辑', 5000, listRoot || modalRoot)
}

async function waitForEditorReady(startUrl: string): Promise<void> {
  await waitFor(
    () => {
      const url = normalizeText(location.href)
      if (url && startUrl && url !== startUrl) return true

      const hasAddProduct = Boolean(findLeafByTextIncludes('添加商品', document.body))
      const draftModal = detectDraftModalRoot()
      if (!draftModal && hasAddProduct) return true
      return null
    },
    { timeoutMs: 60_000, intervalMs: 250, timeoutMessage: '[XHS] Editor not ready after opening draft.' }
  )
}

// ---------------------------------------------------------------------------
// 商品弹窗
// ---------------------------------------------------------------------------

async function scrollEditorToBottom(): Promise<void> {
  const candidates = [
    queryFirstVisible<HTMLElement>('.content-input'),
    queryFirstVisible<HTMLElement>('[class*="content-input"]'),
    queryFirstVisible<HTMLElement>('[class*="content"]'),
    queryFirstVisible<HTMLElement>('main'),
    queryFirstVisible<HTMLElement>('body')
  ].filter(Boolean) as HTMLElement[]

  for (const el of candidates) {
    try {
      el.scrollTop = 999999
    } catch {
      // 静默
    }
  }

  await scrollToBottom(document.documentElement, 4)
}

async function openProductModal(): Promise<HTMLElement> {
  await scrollEditorToBottom()
  await visualWaitFor('添加商品', 5000, document.body)

  const input = await waitFor(
    () => queryFirstVisible<HTMLElement>('input[placeholder*="搜索"]') || null,
    {
      timeoutMs: 25_000,
      intervalMs: 250,
      timeoutMessage: '[XHS] Product modal did not open (search input not found).'
    }
  )

  return getModalRoot(input) || document.body
}

// ---------------------------------------------------------------------------
// 商品数据提取
// ---------------------------------------------------------------------------

type ProductRecord = {
  id: string
  name: string
  price: string
  cover: string
  productUrl: string
}

function isLeaf(el: Element): boolean {
  return el instanceof HTMLElement && el.children.length === 0
}

function collectVisibleLeafIdElements(modalRoot: HTMLElement | null): HTMLElement[] {
  const root = modalRoot || document.body
  let nodes: Element[] = []
  try {
    nodes = Array.from(root.querySelectorAll('*'))
  } catch {
    // 静默
  }
  return nodes.filter((el): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false
    if (!isVisible(el)) return false
    if (!isLeaf(el)) return false
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) return false
    return text.includes('商品ID:') || text.includes('商品ID：')
  })
}

function extractIdFromIdElement(idEl: HTMLElement | null): string {
  const text = normalizeText(idEl?.innerText || idEl?.textContent || '')
  const match = text.match(/[a-zA-Z0-9]{10,}/)
  return match?.[0] ?? ''
}

function findProductRowForIdElement(idEl: HTMLElement, modalRoot: HTMLElement | null): HTMLElement | null {
  const root = modalRoot || document.body
  let current: HTMLElement | null = idEl?.parentElement ?? null
  for (let steps = 0; current && steps < 16; steps += 1) {
    if (current === root) return null
    if (current instanceof HTMLElement && isVisible(current)) {
      const text = normalizeText(current.innerText || current.textContent || '')
      if (text && /[¥￥]\s*\d/.test(text)) return current
    }
    current = current.parentElement
  }
  return null
}

function isInvalidTitleText(text: string): boolean {
  const t = normalizeText(text)
  if (!t) return true
  if (t.includes('商品ID')) return true
  if (t === '普通商品') return true
  if (t === '店内爆品') return true
  return false
}

function pickBestTitleCandidate(candidates: Element[]): HTMLElement | null {
  let best: HTMLElement | null = null
  let bestLen = 0
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue
    if (!isVisible(el)) continue
    const t = normalizeText(el.innerText || el.textContent || '')
    if (isInvalidTitleText(t)) continue
    if (/[¥￥]/.test(t)) continue
    if (t.length <= bestLen) continue
    best = el
    bestLen = t.length
  }
  return best
}

function findTitleElementInRow(productRow: HTMLElement, idEl: HTMLElement): HTMLElement | null {
  const idContainer = idEl?.parentElement ?? null
  if (idContainer && productRow.contains(idContainer)) {
    const prev = idContainer.previousElementSibling
    if (prev instanceof HTMLElement) {
      const prevLeafCandidates = prev.querySelectorAll
        ? Array.from(prev.querySelectorAll('*')).filter((el) => isLeaf(el))
        : []
      const prevCandidates = [prev, ...prevLeafCandidates]
      const picked = pickBestTitleCandidate(prevCandidates)
      if (picked) return picked
    }
  }

  const leafCandidates = Array.from(productRow.querySelectorAll('*')).filter((el) => isLeaf(el))
  return pickBestTitleCandidate(leafCandidates)
}

function locateIdLeafElementById(modalRoot: HTMLElement | null, wantedId: string): HTMLElement | null {
  const id = normalizeText(wantedId)
  if (!id) return null
  const idEls = collectVisibleLeafIdElements(modalRoot)
  for (const el of idEls) {
    const extracted = extractIdFromIdElement(el)
    if (extracted === id) return el
  }
  return null
}

function extractCover(root: HTMLElement): string {
  const img = root.querySelector?.('img') || null
  const src = normalizeText((img as HTMLImageElement)?.src || img?.getAttribute?.('src') || '')
  return src
}

function extractPrice(text: string, root: HTMLElement): string {
  const priceEl =
    root.querySelector?.('[class*="price"]') ||
    root.querySelector?.('span[class*="Price"], div[class*="Price"]') ||
    null
  const byEl = normalizeText((priceEl as HTMLElement)?.innerText || priceEl?.textContent || '')
  if (byEl) return byEl
  const match = text.match(/[¥￥]\s*\d+(?:\.\d+)?/)
  return match?.[0] ?? ''
}

function findScrollableContainer(modalRoot: HTMLElement): HTMLElement | null {
  const candidates = Array.from(modalRoot.querySelectorAll('div, section'))
  for (const el of candidates) {
    if (!isVisible(el)) continue
    const style = window.getComputedStyle(el)
    const overflowY = style.overflowY
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue
    if (el.scrollHeight <= el.clientHeight + 4) continue
    return el as HTMLElement
  }
  return null
}

async function scrapeProductsFromModal(modalRoot: HTMLElement): Promise<ProductRecord[]> {
  const found = new Map<string, ProductRecord>()
  const scrollContainer = findScrollableContainer(modalRoot)

  for (let round = 0; round < 16; round += 1) {
    const idElements = collectVisibleLeafIdElements(modalRoot)
    for (const idEl of idElements) {
      const id = extractIdFromIdElement(idEl)
      if (!id) continue
      if (found.has(id)) continue

      const productRow = findProductRowForIdElement(idEl, modalRoot)
      if (!productRow) continue

      const titleEl = findTitleElementInRow(productRow, idEl)
      const title = normalizeText(titleEl?.innerText || titleEl?.textContent || '')
      if (isInvalidTitleText(title)) continue

      const rowText = normalizeText(productRow.innerText || productRow.textContent || '')
      found.set(id, {
        id,
        name: title,
        price: extractPrice(rowText, productRow),
        cover: extractCover(productRow),
        productUrl: ''
      })
    }

    if (!scrollContainer) break
    const prevTop = scrollContainer.scrollTop
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    await sleep(gaussianDelay(300, 650))
    if (scrollContainer.scrollTop === prevTop) break
  }

  return Array.from(found.values())
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function runProductSync(): Promise<ProductRecord[]> {
  await ensureOnPublishPage()
  const startUrl = normalizeText(location.href)
  console.log(`[Debug] Starting Product Sync. url=${startUrl}`)

  const draftModalRoot = await openDraftBoxAutoOrManual()
  await clickDraftImageTab(draftModalRoot)
  await clickFirstEditInDraftModal(draftModalRoot)
  await waitForEditorReady(startUrl)

  const productModalRoot = await openProductModal()
  await visualWaitFor('商品ID', 10_000, productModalRoot)
  const products = await scrapeProductsFromModal(productModalRoot)
  if (products.length > 0) {
    const first = products[0]
    console.log(`[Debug] Scraped: ${first.name} [${first.id}]`)
    const idEl = locateIdLeafElementById(productModalRoot, first.id)
    const productRow = idEl ? findProductRowForIdElement(idEl, productModalRoot) : null
    const titleEl = productRow && idEl ? findTitleElementInRow(productRow, idEl) : null
    const cleanupTitle = titleEl ? withBlueBorder(titleEl) : null
    const cleanupId = idEl ? withRedBorder(idEl) : null
    await sleep(gaussianDelay(1400, 2600))
    cleanupTitle?.()
    cleanupId?.()
  }
  return products
}

// ---------------------------------------------------------------------------
// IPC 入口
// ---------------------------------------------------------------------------

ipcRenderer.on(
  'productSync:run',
  async (_event: Electron.IpcRendererEvent, payload: unknown) => {
    const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
    const taskId = typeof body?.taskId === 'string' ? body.taskId : null
    if (!taskId) return

    try {
      const products = await runProductSync()
      ipcRenderer.send('productSync:result', { taskId, ok: true, products })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ipcRenderer.send('productSync:result', { taskId, ok: false, error: message })
    }
  }
)
