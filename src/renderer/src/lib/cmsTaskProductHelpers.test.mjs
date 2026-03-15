import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatTaskProductSummary,
  mergeTaskSelectableProducts,
  resolveTaskSelectedProductIds
} from './cmsTaskProductHelpers.ts'

test('resolveTaskSelectedProductIds prefers linked products and preserves selection order', () => {
  assert.deepEqual(
    resolveTaskSelectedProductIds({
      linkedProducts: [
        { id: ' sku-2 ', name: '商品二' },
        { id: 'sku-1', name: '商品一' },
        { id: 'sku-2', name: '重复商品' }
      ],
      productId: 'legacy-id'
    }),
    ['sku-2', 'sku-1']
  )
})

test('resolveTaskSelectedProductIds falls back to the legacy product id', () => {
  assert.deepEqual(
    resolveTaskSelectedProductIds({
      linkedProducts: [],
      productId: ' legacy-id '
    }),
    ['legacy-id']
  )
})

test('mergeTaskSelectableProducts keeps saved linked products available even when the latest list is missing them', () => {
  assert.deepEqual(
    mergeTaskSelectableProducts({
      accountId: 'acc-a',
      products: [
        { id: 'sku-2', accountId: 'acc-a', name: '商品二', price: '¥29.9', cover: '/tmp/b.png', productUrl: '' }
      ],
      linkedProducts: [{ id: 'sku-1', name: ' 商品一 ', cover: ' /tmp/a.png ', productUrl: ' https://old.example/item/1 ' }],
      productId: 'legacy-id',
      productName: '旧商品'
    }),
    [
      {
        id: 'sku-1',
        accountId: 'acc-a',
        name: '商品一',
        price: '',
        cover: '/tmp/a.png',
        productUrl: ''
      },
      {
        id: 'legacy-id',
        accountId: 'acc-a',
        name: '旧商品',
        price: '',
        cover: '',
        productUrl: ''
      },
      {
        id: 'sku-2',
        accountId: 'acc-a',
        name: '商品二',
        price: '¥29.9',
        cover: '/tmp/b.png',
        productUrl: ''
      }
    ]
  )
})

test('formatTaskProductSummary uses the first selected product and appends the remaining count', () => {
  assert.equal(
    formatTaskProductSummary({
      linkedProducts: [
        { id: 'sku-1', name: '商品一' },
        { id: 'sku-2', name: '商品二' },
        { id: 'sku-3', name: '商品三' }
      ]
    }),
    '商品一 +2'
  )

  assert.equal(
    formatTaskProductSummary({
      linkedProducts: [],
      productName: '旧商品'
    }),
    '旧商品'
  )

  assert.equal(
    formatTaskProductSummary({
      linkedProducts: [],
      productName: ''
    }),
    '未绑定商品'
  )
})
