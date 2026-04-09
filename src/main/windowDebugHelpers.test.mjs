import assert from 'node:assert/strict'
import test from 'node:test'

import {
  listInspectableWindows,
  normalizeWindowDebugFilePaths,
  resolveWindowDebugPort,
  validateReadOnlyWindowDebugScript
} from './windowDebugHelpers.ts'

test('listInspectableWindows normalizes browser window metadata', () => {
  const windows = [
    {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: {
        id: 42,
        getTitle: () => '小红书创作服务平台',
        getURL: () => 'https://creator.xiaohongshu.com/publish/publish'
      }
    },
    {
      isDestroyed: () => false,
      isVisible: () => false,
      webContents: {
        id: 7,
        getTitle: () => 'Super CMS [DEV]',
        getURL: () => 'http://127.0.0.1:5174/'
      }
    }
  ]

  assert.deepEqual(listInspectableWindows(windows), [
    {
      id: 7,
      title: 'Super CMS [DEV]',
      url: 'http://127.0.0.1:5174/',
      visible: false
    },
    {
      id: 42,
      title: '小红书创作服务平台',
      url: 'https://creator.xiaohongshu.com/publish/publish',
      visible: true
    }
  ])
})

test('validateReadOnlyWindowDebugScript accepts DOM read-only inspection expressions', () => {
  const result = validateReadOnlyWindowDebugScript(`(() => ({
    title: document.title,
    href: location.href,
    fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map((input) => ({
      accept: input.accept,
      multiple: input.multiple
    }))
  }))()`)

  assert.deepEqual(result, { ok: true })
})

test('validateReadOnlyWindowDebugScript rejects imperative DOM actions', () => {
  const result = validateReadOnlyWindowDebugScript(`(() => {
    document.querySelector('button')?.click()
    return true
  })()`)

  assert.equal(result.ok, false)
  assert.match(result.reason || '', /只读|read-only/i)
})

test('validateReadOnlyWindowDebugScript rejects network and navigation side effects', () => {
  const navResult = validateReadOnlyWindowDebugScript(`location.href = "https://example.com"`)
  const fetchResult = validateReadOnlyWindowDebugScript(`fetch("https://example.com/api")`)

  assert.equal(navResult.ok, false)
  assert.equal(fetchResult.ok, false)
})

test('resolveWindowDebugPort falls back to the default local port when env is invalid', () => {
  assert.equal(resolveWindowDebugPort({ CMS_WINDOW_DEBUG_PORT: '4198' }), 4198)
  assert.equal(resolveWindowDebugPort({ CMS_WINDOW_DEBUG_PORT: 'abc' }), 4196)
  assert.equal(resolveWindowDebugPort({ CMS_WINDOW_DEBUG_PORT: '70000' }), 4196)
})

test('normalizeWindowDebugFilePaths keeps only non-empty string paths', () => {
  assert.deepEqual(
    normalizeWindowDebugFilePaths([' /tmp/a.jpg ', '', null, 42, '/tmp/b.png']),
    ['/tmp/a.jpg', '/tmp/b.png']
  )
})
