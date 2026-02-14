/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { ipcRenderer } from 'electron'

const XHS_PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish'

const Humanizer = {
  sleep: async (min, max) => {
    const minMs = Math.max(0, Number(min) || 0)
    const maxMs = Math.max(minMs, Number(max) || 0)
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1) + minMs)
    console.log(`[Humanizer] Sleeping for ${delay}ms...`)
    return new Promise((resolve) => setTimeout(resolve, delay))
  },

  click: async (element, description) => {
    if (!(element instanceof HTMLElement)) return
    console.log(`[Humanizer] Preparing to click: ${description}`)

    const originalOutline = element.style.outline
    const originalZIndex = element.style.zIndex
    try {
      element.style.outline = '3px solid #ef4444'
      element.style.zIndex = '99999'
    } catch (error) {
      void error
    }

    await Humanizer.sleep(800, 2000)

    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2 + (Math.random() * 10 - 5)
    const y = rect.top + rect.height / 2 + (Math.random() * 10 - 5)

    const mouseOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }
    try {
      element.dispatchEvent(new MouseEvent('mousedown', mouseOpts))
      element.dispatchEvent(new MouseEvent('mouseup', mouseOpts))
      element.dispatchEvent(new MouseEvent('click', mouseOpts))
    } catch (error) {
      void error
      try {
        element.click?.()
      } catch (error2) {
        void error2
      }
    } finally {
      try {
        element.style.outline = originalOutline
        element.style.zIndex = originalZIndex
      } catch (error) {
        void error
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function isVisible(el) {
  if (!el) return false
  if (!(el instanceof HTMLElement)) return false
  const style = window.getComputedStyle(el)
  if (!style) return false
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return true
}

function isVisibleForWait(el) {
  if (!isVisible(el)) return false
  return el.offsetParent !== null
}

async function waitFor(fn, { timeoutMs = 20_000, intervalMs = 250, timeoutMessage = 'timeout' } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      void error
    }
    await sleep(intervalMs)
  }
  throw new Error(timeoutMessage)
}

function withRedBorder(el) {
  const previous = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    boxShadow: el.style.boxShadow
  }
  try {
    el.style.outline = '5px solid red'
    el.style.outlineOffset = '2px'
    el.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.85)'
  } catch (error) {
    void error
  }
  return () => {
    try {
      el.style.outline = previous.outline
      el.style.outlineOffset = previous.outlineOffset
      el.style.boxShadow = previous.boxShadow
    } catch (error) {
      void error
    }
  }
}

function withBlueBorder(el) {
  const previous = {
    outline: el.style.outline,
    outlineOffset: el.style.outlineOffset,
    boxShadow: el.style.boxShadow
  }
  try {
    el.style.outline = '5px solid blue'
    el.style.outlineOffset = '2px'
    el.style.boxShadow = '0 0 10px rgba(0, 102, 255, 0.85)'
  } catch (error) {
    void error
  }
  return () => {
    try {
      el.style.outline = previous.outline
      el.style.outlineOffset = previous.outlineOffset
      el.style.boxShadow = previous.boxShadow
    } catch (error) {
      void error
    }
  }
}

function getElementLabel(el) {
  const tagName = String(el?.tagName || '')
  const className = typeof el?.className === 'string' ? el.className : ''
  const text = normalizeText(el?.innerText || el?.textContent || '')
  return { tagName, className, text }
}

function getModalRoot(fromEl) {
  if (!fromEl) return null
  const candidates = [
    fromEl.closest?.('[role="dialog"]') ?? null,
    fromEl.closest?.('[class*="modal"]') ?? null,
    fromEl.closest?.('[class*="Modal"]') ?? null,
    fromEl.closest?.('[class*="Dialog"]') ?? null
  ].filter(Boolean)
  return candidates[0] ?? null
}

function getHtmlLength(el) {
  try {
    const html = typeof el?.innerHTML === 'string' ? el.innerHTML : ''
    return html.length
  } catch (error) {
    void error
    return Number.POSITIVE_INFINITY
  }
}

function findLeafByTextIncludes(keyword, root) {
  const wanted = normalizeText(keyword)
  if (!wanted) return null

  const base = root || document.body

  let allCandidates = []
  try {
    allCandidates = Array.from(base.querySelectorAll('*'))
  } catch (error) {
    void error
  }

  const matched = []
  for (const el of allCandidates) {
    if (!(el instanceof HTMLElement)) continue
    if (!isVisibleForWait(el)) continue
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (!text.includes(wanted)) continue
    matched.push(el)
  }

  if (matched.length === 0) return null

  matched.sort((a, b) => {
    const al = getHtmlLength(a)
    const bl = getHtmlLength(b)
    if (al !== bl) return al - bl
    const ac = a.querySelectorAll ? a.querySelectorAll('*').length : 0
    const bc = b.querySelectorAll ? b.querySelectorAll('*').length : 0
    if (ac !== bc) return ac - bc
    return 0
  })

  const target = matched[0] || null
  if (!target) return null
  if (!isVisibleForWait(target)) return null
  return target
}

function findTopMostVisibleModal() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="Dialog"]')).filter(
    (el) => isVisible(el)
  )
  if (dialogs.length === 0) return null

  let best = dialogs[0]
  let bestZ = Number.NEGATIVE_INFINITY
  for (const el of dialogs) {
    const z = Number.parseInt(window.getComputedStyle(el).zIndex || '0', 10)
    const zValue = Number.isFinite(z) ? z : 0
    if (zValue >= bestZ) {
      bestZ = zValue
      best = el
    }
  }
  return best
}

async function visualWaitFor(keyword, timeoutMs, root) {
  const wanted = normalizeText(keyword)
  if (!wanted) throw new Error('[XHS] visualWaitFor requires keyword.')

  const startedAt = Date.now()
  while (Date.now() - startedAt < Math.max(0, timeoutMs)) {
    const searchRoot = root || findTopMostVisibleModal() || document.body
    const el = findLeafByTextIncludes(wanted, searchRoot) || (searchRoot !== document.body ? findLeafByTextIncludes(wanted, document.body) : null)

    if (el) {
      const label = getElementLabel(el)
      console.log(`Found [${wanted}] tag=${label.tagName} class=${label.className || '(none)'}`)
      try {
        el.scrollIntoView?.({ block: 'center', inline: 'nearest' })
      } catch (error) {
        void error
      }
      await Humanizer.click(el, `keyword:${wanted}`)
      return el
    }

    await sleep(350 + Math.floor(Math.random() * 300))
  }

  throw new Error(`[XHS] visualWaitFor timeout: ${wanted}`)
}

function detectDraftModalRoot() {
  const candidates = [
    findLeafByTextIncludes('图文笔记', document.body),
    findLeafByTextIncludes('视频笔记', document.body)
  ].filter(Boolean)

  const classCandidates = Array.from(
    document.querySelectorAll('[class*="draft"][class*="modal"], [class*="Draft"][class*="Modal"], [class*="draft-modal"]')
  ).filter((el) => isVisible(el))

  const picked = candidates[0] || classCandidates[0] || null
  if (!picked) return null
  return getModalRoot(picked) || picked
}

async function waitForDraftModalVisible() {
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

async function ensureOnPublishPage() {
  const url = normalizeText(location.href)
  if (url.startsWith(XHS_PUBLISH_URL)) return
  try {
    location.href = XHS_PUBLISH_URL
  } catch (error) {
    void error
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

async function openDraftBoxAutoOrManual() {
  try {
    await visualWaitFor('草稿箱', 15_000, document.body)
  } catch (error) {
    void error
    console.log(`[Manual Request] Could not find '草稿箱' button automatically.`)
    try {
      window.alert('🤖 Lyra: 我没找到【草稿箱】按钮。\n\n请您手动点击一下右上角的草稿箱，点击后我会自动继续！')
    } catch (error2) {
      void error2
    }
  }
  const modalRoot = await waitForDraftModalVisible()
  return modalRoot
}

async function clickDraftImageTab(modalRoot) {
  await visualWaitFor('图文笔记', 10_000, modalRoot)
}

function findDraftListRoot(modalRoot) {
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

async function clickFirstEditInDraftModal(modalRoot) {
  const listRoot = findDraftListRoot(modalRoot)
  await visualWaitFor('编辑', 5000, listRoot || modalRoot)
}

function queryFirstVisible(selector) {
  try {
    const nodes = Array.from(document.querySelectorAll(selector))
    return nodes.find((n) => isVisible(n)) || null
  } catch (error) {
    void error
    return null
  }
}

async function waitForEditorReady(startUrl) {
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

async function scrollToBottom(retries = 4) {
  for (let i = 0; i < retries; i += 1) {
    try {
      window.scrollTo(0, document.body.scrollHeight)
    } catch (error) {
      void error
    }
    await Humanizer.sleep(350, 900)
  }
}

async function scrollEditorToBottom() {
  const candidates = [
    queryFirstVisible('.content-input'),
    queryFirstVisible('[class*="content-input"]'),
    queryFirstVisible('[class*="content"]'),
    queryFirstVisible('main'),
    queryFirstVisible('body')
  ].filter(Boolean)

  for (const el of candidates) {
    try {
      el.scrollTop = 999999
    } catch (error) {
      void error
    }
  }

  await scrollToBottom(4)
}

async function openProductModal() {
  await scrollEditorToBottom()
  await visualWaitFor('添加商品', 5000, document.body)

  const input = await waitFor(() => queryFirstVisible('input[placeholder*="搜索"]') || null, {
    timeoutMs: 25_000,
    intervalMs: 250,
    timeoutMessage: '[XHS] Product modal did not open (search input not found).'
  })

  return getModalRoot(input) || document.body
}

function isLeaf(el) {
  return el instanceof HTMLElement && el.children.length === 0
}

function collectVisibleLeafIdElements(modalRoot) {
  const root = modalRoot || document.body
  let nodes = []
  try {
    nodes = Array.from(root.querySelectorAll('*'))
  } catch (error) {
    void error
  }
  return nodes.filter((el) => {
    if (!(el instanceof HTMLElement)) return false
    if (!isVisible(el)) return false
    if (!isLeaf(el)) return false
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) return false
    return text.includes('商品ID:') || text.includes('商品ID：')
  })
}

function extractIdFromIdElement(idEl) {
  const text = normalizeText(idEl?.innerText || idEl?.textContent || '')
  const match = text.match(/[a-zA-Z0-9]{10,}/)
  return match?.[0] ?? ''
}

function findProductRowForIdElement(idEl, modalRoot) {
  const root = modalRoot || document.body
  let current = idEl?.parentElement ?? null
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

function isInvalidTitleText(text) {
  const t = normalizeText(text)
  if (!t) return true
  if (t.includes('商品ID')) return true
  if (t === '普通商品') return true
  if (t === '店内爆品') return true
  return false
}

function pickBestTitleCandidate(candidates) {
  let best = null
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

function findTitleElementInRow(productRow, idEl) {
  const idContainer = idEl?.parentElement ?? null
  if (idContainer && productRow.contains(idContainer)) {
    const prev = idContainer.previousElementSibling
    if (prev instanceof HTMLElement) {
      const prevLeafCandidates = prev.querySelectorAll ? Array.from(prev.querySelectorAll('*')).filter((el) => isLeaf(el)) : []
      const prevCandidates = [prev, ...prevLeafCandidates]
      const picked = pickBestTitleCandidate(prevCandidates)
      if (picked) return picked
    }
  }

  const leafCandidates = Array.from(productRow.querySelectorAll('*')).filter((el) => isLeaf(el))
  const picked = pickBestTitleCandidate(leafCandidates)
  return picked
}

function locateIdLeafElementById(modalRoot, wantedId) {
  const id = normalizeText(wantedId)
  if (!id) return null
  const idEls = collectVisibleLeafIdElements(modalRoot)
  for (const el of idEls) {
    const extracted = extractIdFromIdElement(el)
    if (extracted === id) return el
  }
  return null
}

function extractCover(root) {
  const img = root.querySelector?.('img') || null
  const src = normalizeText(img?.src || img?.getAttribute?.('src') || '')
  return src
}

function extractPrice(text, root) {
  const priceEl =
    root.querySelector?.('[class*="price"]') ||
    root.querySelector?.('span[class*="Price"], div[class*="Price"]') ||
    null
  const byEl = normalizeText(priceEl?.innerText || priceEl?.textContent || '')
  if (byEl) return byEl
  const match = text.match(/[¥￥]\s*\d+(?:\.\d+)?/)
  return match?.[0] ?? ''
}

function findScrollableContainer(modalRoot) {
  const candidates = Array.from(modalRoot.querySelectorAll('div, section'))
  for (const el of candidates) {
    if (!isVisible(el)) continue
    const style = window.getComputedStyle(el)
    const overflowY = style.overflowY
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue
    if (el.scrollHeight <= el.clientHeight + 4) continue
    return el
  }
  return null
}

async function scrapeProductsFromModal(modalRoot) {
  const found = new Map()
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
        cover: extractCover(productRow)
      })
    }

    if (!scrollContainer) break
    const prevTop = scrollContainer.scrollTop
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    await Humanizer.sleep(300, 650)
    if (scrollContainer.scrollTop === prevTop) break
  }

  return Array.from(found.values())
}

async function runProductSync() {
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
    await Humanizer.sleep(1400, 2600)
    cleanupTitle?.()
    cleanupId?.()
  }
  return products
}

ipcRenderer.on('productSync:run', async (_event, payload) => {
  const taskId = payload && typeof payload === 'object' ? payload.taskId : null
  if (typeof taskId !== 'string' || !taskId) return

  try {
    const products = await runProductSync()
    ipcRenderer.send('productSync:result', { taskId, ok: true, products })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ipcRenderer.send('productSync:result', { taskId, ok: false, error: message })
  }
})
