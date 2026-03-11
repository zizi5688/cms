import assert from 'node:assert/strict'
import test from 'node:test'

import { runWithConcurrencyLimit } from './parallelRunHelpers.ts'

test('runWithConcurrencyLimit preserves result order while capping parallel work', async () => {
  let activeCount = 0
  let peakCount = 0

  const results = await runWithConcurrencyLimit([1, 2, 3, 4], 2, async (value) => {
    activeCount += 1
    peakCount = Math.max(peakCount, activeCount)
    await new Promise((resolve) => setTimeout(resolve, 20 - value))
    activeCount -= 1
    return value * 10
  })

  assert.deepEqual(results, [10, 20, 30, 40])
  assert.equal(peakCount, 2)
})

test('runWithConcurrencyLimit clamps invalid limits to serial execution', async () => {
  let peakCount = 0
  let activeCount = 0

  const results = await runWithConcurrencyLimit(['a', 'b'], 0, async (value) => {
    activeCount += 1
    peakCount = Math.max(peakCount, activeCount)
    await new Promise((resolve) => setTimeout(resolve, 5))
    activeCount -= 1
    return value.toUpperCase()
  })

  assert.deepEqual(results, ['A', 'B'])
  assert.equal(peakCount, 1)
})
