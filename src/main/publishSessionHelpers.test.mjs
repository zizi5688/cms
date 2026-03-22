import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPublishSessionSnapshot,
  derivePublishStageUpdate,
  buildPublishFailureSummary,
  derivePublishLiveMessage,
  updatePublishSessionMessage
} from './publishSessionHelpers.ts'

test('createPublishSessionSnapshot builds a dedicated cover step for video publishing', () => {
  const snapshot = createPublishSessionSnapshot({
    sessionId: 'session-1',
    accountId: 'account-1',
    accountName: '账号A',
    taskTitle: '春季穿搭视频',
    mediaType: 'video'
  })

  assert.deepEqual(
    snapshot.steps.map((step) => [step.key, step.label, step.state]),
    [
      ['prepare', '准备发布环境', 'active'],
      ['upload', '上传视频', 'pending'],
      ['cover', '设置封面', 'pending'],
      ['content', '填写文案/挂车', 'pending'],
      ['publish', '提交发布', 'pending']
    ]
  )
})

test('derivePublishStageUpdate maps automation step logs into a publish stage update', () => {
  const started = derivePublishStageUpdate('开始：上传视频封面（先封面后文案）', 'video')
  const finished = derivePublishStageUpdate('完成：点击发布并等待成功', 'video')

  assert.deepEqual(started, {
    stageKey: 'cover',
    state: 'active',
    message: '正在设置封面'
  })
  assert.deepEqual(finished, {
    stageKey: 'publish',
    state: 'done',
    message: '发布已提交'
  })
})

test('derivePublishStageUpdate accepts helper log prefixes and keeps product progress visible', () => {
  const started = derivePublishStageUpdate('[15:31:03] [小红书助手] 开始：上传视频', 'video')
  const productProgress = derivePublishStageUpdate('[15:31:44] [小红书助手] [步骤 4] 挂载商品 3/3', 'video')

  assert.deepEqual(started, {
    stageKey: 'upload',
    state: 'active',
    message: '正在上传视频'
  })
  assert.deepEqual(productProgress, {
    stageKey: 'content',
    state: 'active',
    message: '正在填写文案/挂车（挂载商品 3/3）'
  })
})

test('buildPublishFailureSummary strips diagnostic payload and keeps a user-facing reason', () => {
  const summary = buildPublishFailureSummary(
    '[XHS Automation] StepFailed: 上传视频封面（先封面后文案） - 系统文件选择器未确认封面已选中，已停止后续“确定”点击。\\n{"step":"上传视频封面（先封面后文案）"}',
    'video'
  )

  assert.deepEqual(summary, {
    stageKey: 'cover',
    userMessage: '设置封面失败：系统文件选择器未确认封面已选中，已停止后续“确定”点击。',
    message: '设置封面失败'
  })
})

test('buildPublishFailureSummary accepts helper log prefixes before the automation failure line', () => {
  const summary = buildPublishFailureSummary(
    '[15:31:04] [小红书助手] [XHS Automation] StepFailed: 上传视频封面（先封面后文案） - 系统文件选择器未确认封面已选中，已停止后续“确定”点击。\\n{"step":"上传视频封面（先封面后文案）"}',
    'video'
  )

  assert.deepEqual(summary, {
    stageKey: 'cover',
    userMessage: '设置封面失败：系统文件选择器未确认封面已选中，已停止后续“确定”点击。',
    message: '设置封面失败'
  })
})

test('derivePublishLiveMessage converts helper logs into concise live status text', () => {
  const loadingProducts = derivePublishLiveMessage(
    '[15:55:21] [小红书助手] 正在打开“添加商品”弹窗（同步脚本同源逻辑）...',
    'video'
  )
  const productProgress = derivePublishLiveMessage(
    '[15:55:20] [小红书助手] [步骤 4] 挂载商品 1/3',
    'video'
  )
  const autoCoverSkip = derivePublishLiveMessage(
    '[15:55:22] [小红书助手] 使用默认首帧，跳过手动设置封面',
    'video'
  )

  assert.equal(loadingProducts, '正在打开添加商品弹窗')
  assert.equal(productProgress, '正在填写文案/挂车（挂载商品 1/3）')
  assert.equal(autoCoverSkip, '正在设置封面（默认首帧，跳过手动设置封面）')
})

test('updatePublishSessionMessage refreshes the current message without mutating steps', () => {
  const snapshot = createPublishSessionSnapshot({
    sessionId: 'session-2',
    accountId: 'account-2',
    accountName: '账号B',
    taskTitle: '视频 B',
    mediaType: 'video',
    startedAt: 1
  })

  const updated = updatePublishSessionMessage(snapshot, '正在加载商品列表')

  assert.equal(updated.message, '正在加载商品列表')
  assert.deepEqual(updated.steps, snapshot.steps)
  assert.notEqual(updated.updatedAt, snapshot.updatedAt)
})
