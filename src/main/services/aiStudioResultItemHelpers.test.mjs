import assert from 'node:assert/strict'
import test from 'node:test'

import { pushUniqueAiStudioImageResultItem } from './aiStudioResultItemHelpers.ts'

test('pushUniqueAiStudioImageResultItem keeps distinct inline images even when their base64 prefixes match', () => {
  const sharedPrefix = 'data:image/jpeg;base64,' + 'A'.repeat(256)
  const firstContent = `${sharedPrefix}1111`
  const secondContent = `${sharedPrefix}2222`
  const bucket = []

  pushUniqueAiStudioImageResultItem(bucket, { content: firstContent })
  pushUniqueAiStudioImageResultItem(bucket, { content: secondContent })

  assert.equal(bucket.length, 2)
  assert.deepEqual(bucket.map((item) => item.content), [firstContent, secondContent])
})
