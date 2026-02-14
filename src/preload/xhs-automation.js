const { contextBridge } = require('electron')
const fs = require('fs')
const path = require('path')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isVisible(el) {
  if (!el) return false
  const style = window.getComputedStyle(el)
  if (!style) return true
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

async function waitFor(fn, { timeoutMs = 20_000, intervalMs = 250 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await fn()
      if (value) return value
    } catch {}
    await sleep(intervalMs)
  }
  throw new Error('timeout')
}

function getValueSetter(el) {
  const proto = Object.getPrototypeOf(el)
  const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null
  return desc && typeof desc.set === 'function' ? desc.set : null
}

function dispatchInputEvents(el) {
  try {
    el.dispatchEvent(new Event('input', { bubbles: true }))
  } catch {}
  try {
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } catch {}
  try {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', ctrlKey: true }))
  } catch {}
  try {
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', ctrlKey: true }))
  } catch {}
}

function setInputValue(el, value) {
  el.focus?.()
  const setter = getValueSetter(el)
  if (setter) setter.call(el, value)
  else el.value = value
  dispatchInputEvents(el)
}

function setContentEditableValue(el, value) {
  el.focus?.()
  try {
    document.execCommand('selectAll', false, null)
    document.execCommand('insertText', false, value)
    return
  } catch {}

  el.textContent = value
  dispatchInputEvents(el)
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function findFirstVisible(selectors) {
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector))
    const found = nodes.find((n) => isVisible(n))
    if (found) return found
  }
  return null
}

function findClickableByText(textCandidates) {
  const candidates = Array.from(
    document.querySelectorAll('button, [role="button"], div[tabindex], span[tabindex]')
  )
  const wanted = textCandidates.map((t) => normalizeText(t))
  const visible = candidates.filter((el) => isVisible(el))

  for (const el of visible) {
    const text = normalizeText(el.innerText || el.textContent || '')
    if (!text) continue
    if (wanted.some((w) => text.includes(w))) {
      const disabled =
        el.getAttribute?.('aria-disabled') === 'true' ||
        el.getAttribute?.('disabled') !== null ||
        el.disabled === true
      if (!disabled) return el
    }
  }

  return null
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

async function setFileToInput(inputEl, imagePath) {
  const buffer = await fs.promises.readFile(imagePath)
  const filename = path.basename(imagePath)
  const mime = guessMimeType(imagePath)
  const blob = new Blob([buffer], { type: mime })
  const file = new File([blob], filename, { type: mime })
  const dt = new DataTransfer()
  dt.items.add(file)

  let assigned = false
  try {
    inputEl.files = dt.files
    assigned = true
  } catch {}

  if (!assigned) {
    try {
      Object.defineProperty(inputEl, 'files', { value: dt.files, configurable: true })
      assigned = true
    } catch {}
  }

  try {
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
  } catch {}
  try {
    inputEl.dispatchEvent(new Event('change', { bubbles: true }))
  } catch {}

  return dt
}

async function uploadImage(imagePath) {
  const input = await waitFor(
    () => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
      const preferred =
        inputs.find((i) => (i.getAttribute('accept') || '').includes('image')) ||
        inputs.find((i) => {
          const accept = (i.getAttribute('accept') || '').toLowerCase()
          return accept.includes('.png') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('image')
        }) ||
        inputs[0]
      return preferred && (isVisible(preferred) || preferred)
    },
    { timeoutMs: 30_000, intervalMs: 250 }
  )

  const dt = await setFileToInput(input, imagePath)

  try {
    const dropZone = findFirstVisible(['[data-testid*="upload"]', '.upload', '.uploader', '.drop', '.dropzone'])
    if (dropZone) {
      dropZone.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt
        })
      )
    }
  } catch {}

  await waitFor(
    () => {
      const imgs = Array.from(document.querySelectorAll('img'))
      return imgs.some((img) => typeof img.src === 'string' && img.src.startsWith('blob:'))
    },
    { timeoutMs: 90_000, intervalMs: 500 }
  )
}

async function fillTitle(title) {
  const el = await waitFor(
    () =>
      findFirstVisible([
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
        'input[aria-label*="标题"]',
        'textarea[aria-label*="标题"]'
      ]),
    { timeoutMs: 20_000, intervalMs: 250 }
  )

  setInputValue(el, String(title ?? '').trim())
}

async function fillContent(content) {
  const el = await waitFor(
    () =>
      findFirstVisible([
        'textarea[placeholder*="正文"]',
        'textarea[placeholder*="内容"]',
        'textarea[aria-label*="正文"]',
        'textarea[aria-label*="内容"]',
        '[contenteditable="true"]'
      ]),
    { timeoutMs: 20_000, intervalMs: 250 }
  )

  const value = String(content ?? '').trim()
  if (el.getAttribute && el.getAttribute('contenteditable') === 'true') setContentEditableValue(el, value)
  else setInputValue(el, value)
}

async function clickPublish() {
  const button = await waitFor(() => findClickableByText(['发布', '发布笔记', '立即发布']), {
    timeoutMs: 30_000,
    intervalMs: 250
  })

  button.click?.()
  try {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  } catch {}

  await sleep(1500)
}

async function publish(task) {
  const imagePath = typeof task?.imagePath === 'string' ? task.imagePath : ''
  const title = typeof task?.title === 'string' ? task.title : ''
  const content = typeof task?.content === 'string' ? task.content : ''

  if (!imagePath) return { ok: false, error: '[XHS] Missing imagePath.' }
  if (!title && !content) return { ok: false, error: '[XHS] Missing title/content.' }

  try {
    await uploadImage(imagePath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `[XHS] Upload failed: ${msg}` }
  }

  try {
    if (title) await fillTitle(title)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `[XHS] Fill title failed: ${msg}` }
  }

  try {
    if (content) await fillContent(content)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `[XHS] Fill content failed: ${msg}` }
  }

  try {
    await clickPublish()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `[XHS] Click publish failed: ${msg}` }
  }

  return { ok: true }
}

try {
  contextBridge.exposeInMainWorld('__xhsAutomation', {
    publish
  })
} catch {}

