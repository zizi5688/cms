import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublishNotificationPayload,
  shouldHidePublishWindowAfterNativeDialog,
  buildPublishWorkerWindowOptions,
  readPublishDebugState,
  runWithTimeout
} from './publisherHelpers.ts'

test('buildPublishWorkerWindowOptions hides the publish window and disables background throttling', () => {
  const options = buildPublishWorkerWindowOptions({
    partitionKey: 'persist:xhs_demo',
    preload: '/tmp/xhs-automation.js'
  })

  assert.equal(options.width, 1200)
  assert.equal(options.height, 900)
  assert.equal(options.show, false)
  assert.equal(options.autoHideMenuBar, true)
  assert.equal(options.webPreferences?.backgroundThrottling, false)
  assert.equal(options.webPreferences?.partition, 'persist:xhs_demo')
  assert.equal(options.webPreferences?.preload, '/tmp/xhs-automation.js')
})

test('buildPublishWorkerWindowOptions shows the publish window when visual mode is enabled', () => {
  const options = buildPublishWorkerWindowOptions({
    partitionKey: 'persist:xhs_demo',
    preload: '/tmp/xhs-automation.js',
    showWindow: true
  })

  assert.equal(options.show, true)
})

test('readPublishDebugState reads visual debug env flags', () => {
  const state = readPublishDebugState({
    CMS_PUBLISH_VISUAL: 'true',
    CMS_PUBLISH_KEEP_OPEN: '1',
    CMS_PUBLISH_OPEN_DEVTOOLS: 'yes'
  })

  assert.deepEqual(state, {
    visual: true,
    keepWindowOpen: true,
    openDevTools: true
  })
})

test('shouldHidePublishWindowAfterNativeDialog always hides in non-visual mode', () => {
  assert.equal(
    shouldHidePublishWindowAfterNativeDialog({
      debugState: { visual: false, keepWindowOpen: false, openDevTools: false },
      wasVisibleBeforeDialog: true
    }),
    true
  )
})

test('shouldHidePublishWindowAfterNativeDialog restores previous visibility in visual mode', () => {
  assert.equal(
    shouldHidePublishWindowAfterNativeDialog({
      debugState: { visual: true, keepWindowOpen: false, openDevTools: false },
      wasVisibleBeforeDialog: true
    }),
    false
  )
  assert.equal(
    shouldHidePublishWindowAfterNativeDialog({
      debugState: { visual: true, keepWindowOpen: false, openDevTools: false },
      wasVisibleBeforeDialog: false
    }),
    true
  )
})

test('buildPublishNotificationPayload formats the start notification with account and task title', () => {
  const payload = buildPublishNotificationPayload({
    phase: 'start',
    accountName: '账号A',
    taskTitle: '春季奶油风卧室布置'
  })

  assert.equal(payload.title, '开始执行：账号A')
  assert.equal(payload.body, '春季奶油风卧室布置')
})

test('buildPublishNotificationPayload formats the finish notification for success and failure', () => {
  const success = buildPublishNotificationPayload({
    phase: 'finish',
    accountName: '账号A',
    taskTitle: '春季奶油风卧室布置',
    success: true
  })
  const failed = buildPublishNotificationPayload({
    phase: 'finish',
    accountName: '账号A',
    taskTitle: '春季奶油风卧室布置',
    success: false,
    error: '网络超时'
  })

  assert.equal(success.title, '执行完成：账号A')
  assert.equal(success.body, '春季奶油风卧室布置')
  assert.equal(failed.title, '执行失败：账号A')
  assert.equal(failed.body, '春季奶油风卧室布置\n网络超时')
})

test('runWithTimeout rejects hung work with the provided timeout message', async () => {
  await assert.rejects(
    () => runWithTimeout(new Promise(() => {}), 20, '[XHS] Publish page load timeout.'),
    /Publish page load timeout/
  )
})

test('runWithTimeout preserves the original rejection when work fails before timeout', async () => {
  await assert.rejects(
    () => runWithTimeout(Promise.reject(new Error('boom')), 200, '[XHS] Publish page load timeout.'),
    /boom/
  )
})
