import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMousePath,
  sampleStepCount
} from './human-input.ts'

test('sampleStepCount stays within expected short-range bounds', () => {
  const count = sampleStepCount(80)
  assert.ok(count >= 18)
  assert.ok(count <= 30)
})

test('sampleStepCount grows for longer distance', () => {
  const count = sampleStepCount(260)
  assert.ok(count >= 24)
  assert.ok(count <= 48)
})

test('buildMousePath starts and ends at requested coordinates', () => {
  const path = buildMousePath({
    fromX: 10,
    fromY: 20,
    toX: 210,
    toY: 160,
    randomValues: [0.2, 0.7, 0.4, 0.6]
  })

  assert.deepEqual(path[0], { x: 10, y: 20 })
  assert.deepEqual(path.at(-1), { x: 210, y: 160 })
})

test('buildMousePath produces enough intermediate points for medium distance', () => {
  const path = buildMousePath({
    fromX: 0,
    fromY: 0,
    toX: 200,
    toY: 0,
    randomValues: [0.1, 0.9, 0.3, 0.8]
  })

  assert.ok(path.length >= 8)
  assert.ok(path.length <= 40)
})
