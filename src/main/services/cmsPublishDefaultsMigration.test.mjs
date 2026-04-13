import assert from 'node:assert/strict'
import test from 'node:test'

import { applyCmsPublishDefaultsMigration } from './cmsPublishDefaultsMigration.ts'

function createStore(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    get(key) {
      return values.get(key)
    },
    set(key, value) {
      values.set(key, value)
    },
    values
  }
}

test('applyCmsPublishDefaultsMigration migrates legacy cdp setting to electron once', () => {
  const store = createStore({
    publishMode: 'cdp',
    electronPublishAction: 'save_draft'
  })

  const result = applyCmsPublishDefaultsMigration(store)

  assert.equal(result.didMigrate, true)
  assert.equal(result.publishMode, 'electron')
  assert.equal(result.electronPublishAction, 'save_draft')
  assert.equal(store.get('publishMode'), 'electron')
  assert.equal(store.get('electronPublishAction'), 'save_draft')
  assert.equal(store.get('cmsPublishDefaultsMigrationVersion'), '2026-04-13-electron-default')
})

test('applyCmsPublishDefaultsMigration preserves explicit cdp choice after migration marker exists', () => {
  const store = createStore({
    publishMode: 'cdp',
    electronPublishAction: 'auto_publish',
    cmsPublishDefaultsMigrationVersion: '2026-04-13-electron-default'
  })

  const result = applyCmsPublishDefaultsMigration(store)

  assert.equal(result.didMigrate, false)
  assert.equal(result.publishMode, 'cdp')
  assert.equal(result.electronPublishAction, 'auto_publish')
  assert.equal(store.get('publishMode'), 'cdp')
  assert.equal(store.get('electronPublishAction'), 'auto_publish')
})
