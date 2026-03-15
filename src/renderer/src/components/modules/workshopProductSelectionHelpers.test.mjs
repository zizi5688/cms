import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSelectedWorkshopProducts,
  resolveWorkshopAccountId
} from './workshopProductSelectionHelpers.ts'

test('resolveWorkshopAccountId keeps the current account when it is still valid', () => {
  assert.equal(
    resolveWorkshopAccountId({
      accounts: [
        { id: 'acc-a', name: '账号A' },
        { id: 'acc-b', name: '账号B' }
      ],
      currentAccountId: ' acc-b ',
      preferredAccountId: 'acc-a'
    }),
    'acc-b'
  )
})

test('resolveWorkshopAccountId falls back to the preferred account before the first account', () => {
  assert.equal(
    resolveWorkshopAccountId({
      accounts: [
        { id: 'acc-a', name: '账号A' },
        { id: 'acc-b', name: '账号B' }
      ],
      currentAccountId: 'missing',
      preferredAccountId: ' acc-b '
    }),
    'acc-b'
  )
})

test('buildSelectedWorkshopProducts keeps selection order and removes duplicates', () => {
  assert.deepEqual(
    buildSelectedWorkshopProducts({
      allProducts: [
        {
          id: 'sku-1',
          accountId: 'acc-a',
          name: ' 商品一 ',
          cover: ' /tmp/cover-1.png ',
          productUrl: ' https://xhs.example/item/1 '
        },
        {
          id: 'sku-2',
          accountId: 'acc-a',
          name: '商品二',
          cover: '',
          productUrl: ''
        }
      ],
      selectedProductIds: [' sku-2 ', 'sku-1', 'sku-2', 'missing']
    }),
    [
      { id: 'sku-2', name: '商品二', cover: '', productUrl: '' },
      {
        id: 'sku-1',
        name: '商品一',
        cover: '/tmp/cover-1.png',
        productUrl: ''
      }
    ]
  )
})
