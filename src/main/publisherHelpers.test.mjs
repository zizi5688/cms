import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublishNotificationPayload,
  buildPublishWorkerWindowOptions
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
