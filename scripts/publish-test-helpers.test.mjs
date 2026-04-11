import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeMouseInteractionQuality,
  summarizePublishResult,
  validateTrustedMouseEvents
} from './publish-test-helpers.ts'

test('validateTrustedMouseEvents requires trusted click and mousedown events', () => {
  const result = validateTrustedMouseEvents([
    { type: 'mousemove', isTrusted: true },
    { type: 'mousedown', isTrusted: true },
    { type: 'click', isTrusted: true }
  ])

  assert.equal(result.ok, true)
})

test('validateTrustedMouseEvents fails when click is not trusted', () => {
  const result = validateTrustedMouseEvents([
    { type: 'mousedown', isTrusted: true },
    { type: 'click', isTrusted: false }
  ])

  assert.equal(result.ok, false)
  assert.match(result.reason, /click/i)
})

test('summarizePublishResult reflects upload and text outcomes', () => {
  const summary = summarizePublishResult({
    titleFilled: true,
    bodyFilled: false,
    videoUploaded: true,
    trustedEventsOk: true
  })

  assert.match(summary, /标题: 成功/)
  assert.match(summary, /正文: 失败/)
  assert.match(summary, /视频: 成功/)
  assert.match(summary, /isTrusted: 通过/)
})

test('analyzeMouseInteractionQuality accepts curved and varied move stream', () => {
  const events = []
  for (let index = 0; index < 16; index += 1) {
    events.push({
      type: 'mousemove',
      isTrusted: true,
      timestamp: index === 0 ? 0 : index * (index % 2 === 0 ? 10 : 17),
      x: index * 5,
      y: index * 3 + (index % 4 === 0 ? 2 : 0)
    })
  }
  events.push({ type: 'mousedown', isTrusted: true, timestamp: 260, x: 80, y: 48 })
  events.push({ type: 'click', isTrusted: true, timestamp: 290, x: 80, y: 48 })

  const result = analyzeMouseInteractionQuality(events)
  assert.equal(result.ok, true)
  assert.equal(result.interactions[0].moveCountBeforeClick >= 15, true)
})

test('analyzeMouseInteractionQuality rejects straight low-move path', () => {
  const events = [
    { type: 'mousemove', isTrusted: true, timestamp: 0, x: 0, y: 0 },
    { type: 'mousemove', isTrusted: true, timestamp: 10, x: 10, y: 10 },
    { type: 'mousemove', isTrusted: true, timestamp: 20, x: 20, y: 20 },
    { type: 'mousedown', isTrusted: true, timestamp: 30, x: 30, y: 30 },
    { type: 'click', isTrusted: true, timestamp: 40, x: 30, y: 30 }
  ]

  const result = analyzeMouseInteractionQuality(events)
  assert.equal(result.ok, false)
  assert.match(result.reason, /未达标/)
})
