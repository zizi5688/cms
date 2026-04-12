import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasCoverSelectionSignal
} from './preload/xhsCoverUploadSignals.ts'

test('hasCoverSelectionSignal detects selected file count growth', () => {
  const baseline = {
    text: '上传图片',
    imageSources: [],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-root"></div>'
  }

  const current = {
    text: '上传图片',
    imageSources: [],
    selectedFileCount: 1,
    fileValues: [],
    htmlSignature: '<div class="upload-root"></div>'
  }

  assert.equal(hasCoverSelectionSignal(current, '/tmp/cover.png', baseline), true)
})

test('hasCoverSelectionSignal detects modal preview image changes after choosing the cover', () => {
  const baseline = {
    text: '上传图片',
    imageSources: ['blob:https://creator.xiaohongshu.com/modal-before'],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-list"><img src="blob:modal-before" /></div>'
  }

  const current = {
    text: '重新上传',
    imageSources: ['blob:https://creator.xiaohongshu.com/modal-after'],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-list"><img src="blob:modal-after" /></div>'
  }

  assert.equal(hasCoverSelectionSignal(current, '/tmp/cover.png', baseline), true)
})

test('hasCoverSelectionSignal detects modal DOM rerenders even when image urls are unstable', () => {
  const baseline = {
    text: '上传图片',
    imageSources: [],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-list"><canvas data-version="1"></canvas></div>'
  }

  const current = {
    text: '重新上传',
    imageSources: [],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-list is-selected"><canvas data-version="2"></canvas></div>'
  }

  assert.equal(hasCoverSelectionSignal(current, '/tmp/cover.png', baseline), true)
})

test('hasCoverSelectionSignal stays false when nothing meaningful changed', () => {
  const baseline = {
    text: '上传图片',
    imageSources: ['blob:https://creator.xiaohongshu.com/modal-before'],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-list"><img src="blob:modal-before" /></div>'
  }

  const current = {
    text: '上传图片',
    imageSources: ['blob:https://creator.xiaohongshu.com/modal-before'],
    selectedFileCount: 0,
    fileValues: [],
    htmlSignature: '<div class="upload-list"><img src="blob:modal-before" /></div>'
  }

  assert.equal(hasCoverSelectionSignal(current, '/tmp/cover.png', baseline), false)
})
