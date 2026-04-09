import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasCoverSelectionSignal,
  normalizeImageSrcForCompare
} from './xhsCoverUploadSignals.ts'

test('normalizeImageSrcForCompare strips query and hash suffixes', () => {
  assert.equal(
    normalizeImageSrcForCompare('https://example.com/demo.jpg?x=1#hash'),
    'https://example.com/demo.jpg'
  )
})

test('hasCoverSelectionSignal detects when selected file count increases', () => {
  const baseline = {
    text: '设置封面',
    imageSources: [],
    selectedFileCount: 0,
    fileValues: []
  }
  const next = {
    text: '设置封面',
    imageSources: [],
    selectedFileCount: 1,
    fileValues: []
  }

  assert.equal(hasCoverSelectionSignal(next, '/tmp/output-001 7.jpg', baseline), true)
})

test('hasCoverSelectionSignal detects injected fakepath filename', () => {
  const baseline = {
    text: '设置封面',
    imageSources: [],
    selectedFileCount: 0,
    fileValues: []
  }
  const next = {
    text: '设置封面',
    imageSources: [],
    selectedFileCount: 0,
    fileValues: ['c:\\\\fakepath\\\\output-001 7.jpg']
  }

  assert.equal(hasCoverSelectionSignal(next, '/tmp/output-001 7.jpg', baseline), true)
})

test('hasCoverSelectionSignal detects image/text change with upload wording', () => {
  const baseline = {
    text: '设置封面',
    imageSources: ['blob:before'],
    selectedFileCount: 0,
    fileValues: []
  }
  const next = {
    text: '设置封面 上传成功',
    imageSources: ['blob:after'],
    selectedFileCount: 0,
    fileValues: []
  }

  assert.equal(hasCoverSelectionSignal(next, '/tmp/output-001 7.jpg', baseline), true)
})

test('hasCoverSelectionSignal stays false when there is no actual selection change', () => {
  const baseline = {
    text: '设置封面',
    imageSources: ['blob:same'],
    selectedFileCount: 0,
    fileValues: []
  }
  const next = {
    text: '设置封面',
    imageSources: ['blob:same'],
    selectedFileCount: 0,
    fileValues: []
  }

  assert.equal(hasCoverSelectionSignal(next, '/tmp/output-001 7.jpg', baseline), false)
})
