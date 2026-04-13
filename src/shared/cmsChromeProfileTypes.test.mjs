import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeCmsElectronPublishAction } from './cmsChromeProfileTypes.ts'

test('normalizeCmsElectronPublishAction defaults unknown values to save_draft', () => {
  assert.equal(normalizeCmsElectronPublishAction(undefined), 'save_draft')
  assert.equal(normalizeCmsElectronPublishAction(''), 'save_draft')
  assert.equal(normalizeCmsElectronPublishAction('unexpected'), 'save_draft')
})

test('normalizeCmsElectronPublishAction preserves explicit action values', () => {
  assert.equal(normalizeCmsElectronPublishAction('auto_publish'), 'auto_publish')
  assert.equal(normalizeCmsElectronPublishAction('save_draft'), 'save_draft')
})
