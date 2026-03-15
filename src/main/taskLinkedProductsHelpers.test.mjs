import assert from 'node:assert/strict'
import test from 'node:test'

import {
  derivePrimaryProductFields,
  normalizeLinkedProducts
} from './taskLinkedProductsHelpers.ts'

test('normalizeLinkedProducts keeps valid linked products and trims optional fields', () => {
  assert.deepEqual(
    normalizeLinkedProducts([
      { id: ' sku-1 ', name: ' 商品一 ', cover: ' /tmp/a.png ', productUrl: ' https://xhs/item/1 ' },
      { id: '', name: '无效商品' },
      { id: 'sku-2', name: '商品二' },
      { id: 'sku-1', name: '重复商品' }
    ]),
    [
      {
        id: 'sku-1',
        name: '商品一',
        cover: '/tmp/a.png',
        productUrl: 'https://xhs/item/1'
      },
      {
        id: 'sku-2',
        name: '商品二',
        cover: '',
        productUrl: ''
      }
    ]
  )
})

test('derivePrimaryProductFields prefers the first linked product and falls back to legacy fields', () => {
  assert.deepEqual(
    derivePrimaryProductFields({
      linkedProducts: [
        { id: 'sku-1', name: '商品一' },
        { id: 'sku-2', name: '商品二' }
      ],
      fallbackProductId: 'legacy-id',
      fallbackProductName: '旧商品'
    }),
    { productId: 'sku-1', productName: '商品一' }
  )

  assert.deepEqual(
    derivePrimaryProductFields({
      linkedProducts: [],
      fallbackProductId: ' legacy-id ',
      fallbackProductName: ' 旧商品 '
    }),
    { productId: 'legacy-id', productName: '旧商品' }
  )
})
