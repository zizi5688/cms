import assert from 'node:assert/strict'
import test from 'node:test'

import { createPublishQueueScheduler } from './publishQueueScheduler.ts'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('queues different accounts and drains them serially instead of dropping later runs', async () => {
  const events = []
  const scheduler = createPublishQueueScheduler(async ({ accountId }) => {
    events.push(`start:${accountId}`)
    await sleep(5)
    events.push(`end:${accountId}`)
    return { processed: 1, succeeded: 1, failed: 0 }
  })

  const first = scheduler.enqueue({ accountId: 'account-a' })
  const second = scheduler.enqueue({ accountId: 'account-b' })

  assert.equal(scheduler.isBusy(), true)
  await assert.doesNotReject(first)
  await assert.doesNotReject(second)

  assert.deepEqual(events, ['start:account-a', 'end:account-a', 'start:account-b', 'end:account-b'])
  assert.equal(scheduler.isBusy(), false)
})

test('reuses the in-flight promise for the same account', async () => {
  const scheduler = createPublishQueueScheduler(async ({ accountId }) => {
    await sleep(5)
    return { processed: 1, succeeded: accountId === 'account-a' ? 1 : 0, failed: 0 }
  })

  const first = scheduler.enqueue({ accountId: 'account-a' })
  const second = scheduler.enqueue({ accountId: 'account-a' })

  assert.equal(first, second)
  const result = await first
  assert.deepEqual(result, { processed: 1, succeeded: 1, failed: 0 })
})
