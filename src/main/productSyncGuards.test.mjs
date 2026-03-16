import assert from 'node:assert/strict'
import test from 'node:test'

import { ensureNonEmptyProductSyncResult } from './productSyncGuards.ts'

test('ensureNonEmptyProductSyncResult returns products when sync extraction succeeds', () => {
  const products = [
    { id: 'product-1', name: 'Product 1' },
    { id: 'product-2', name: 'Product 2' }
  ]

  assert.deepEqual(ensureNonEmptyProductSyncResult(products), products)
})

test('ensureNonEmptyProductSyncResult throws when sync result is empty', () => {
  assert.throws(
    () => ensureNonEmptyProductSyncResult([]),
    /未抓取到有效商品，本次不会覆盖已有商品/
  )
})
