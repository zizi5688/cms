import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeOutputCountDraftOnBlur,
  parseOutputCountDraft
} from './outputCountDraftHelpers.ts'

test('parseOutputCountDraft accepts a positive integer draft', () => {
  assert.equal(
    parseOutputCountDraft(' 3 ', { fieldLabel: '输出张数', min: 1 }),
    3
  )
})

test('parseOutputCountDraft rejects blank drafts', () => {
  assert.throws(
    () => parseOutputCountDraft('', { fieldLabel: '输出张数', min: 1 }),
    /请先填写输出张数/
  )
})

test('parseOutputCountDraft rejects non-numeric drafts', () => {
  assert.throws(
    () => parseOutputCountDraft('abc', { fieldLabel: '输出张数', min: 1 }),
    /输出张数必须是正整数/
  )
})

test('parseOutputCountDraft rejects video counts above the allowed max', () => {
  assert.throws(
    () => parseOutputCountDraft('5', { fieldLabel: '输出条数', min: 1, max: 4 }),
    /输出条数不能大于 4/
  )
})

test('normalizeOutputCountDraftOnBlur keeps blank drafts unchanged', () => {
  assert.equal(
    normalizeOutputCountDraftOnBlur('', { fieldLabel: '输出张数', min: 1 }),
    ''
  )
})

test('normalizeOutputCountDraftOnBlur normalizes valid drafts', () => {
  assert.equal(
    normalizeOutputCountDraftOnBlur(' 04 ', { fieldLabel: '输出条数', min: 1, max: 4 }),
    '4'
  )
})

test('normalizeOutputCountDraftOnBlur leaves invalid drafts untouched for later validation', () => {
  assert.equal(
    normalizeOutputCountDraftOnBlur('abc', { fieldLabel: '输出条数', min: 1, max: 4 }),
    'abc'
  )
})
