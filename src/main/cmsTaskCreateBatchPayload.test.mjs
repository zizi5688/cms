import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeCreateBatchTaskPayload } from './cmsTaskCreateBatchPayload.ts'

test('normalizeCreateBatchTaskPayload keeps linked products for task creation', () => {
  const normalized = normalizeCreateBatchTaskPayload({
    accountId: 'account-1',
    images: ['cover-1.png'],
    title: '标题',
    content: '正文',
    productId: 'primary-product',
    productName: '主商品',
    linkedProducts: [
      { id: 'product-1', name: '商品 1', cover: 'cover-1', productUrl: 'url-1' },
      { id: 'product-2', name: '商品 2', cover: 'cover-2', productUrl: 'url-2' },
      { id: 'product-1', name: '商品 1', cover: 'cover-1', productUrl: 'url-1' },
      { id: '', name: 'invalid', cover: '', productUrl: '' }
    ]
  })

  assert.deepEqual(normalized.linkedProducts, [
    { id: 'product-1', name: '商品 1', cover: 'cover-1', productUrl: 'url-1' },
    { id: 'product-2', name: '商品 2', cover: 'cover-2', productUrl: 'url-2' }
  ])
  assert.equal(normalized.productId, 'primary-product')
  assert.equal(normalized.productName, '主商品')
})

test('normalizeCreateBatchTaskPayload defaults missing videoCoverMode to auto for legacy compatibility', () => {
  const normalized = normalizeCreateBatchTaskPayload({
    accountId: 'account-1',
    mediaType: 'video',
    videoPath: '/videos/demo.mp4',
    images: ['/covers/first-frame.jpg'],
    title: '视频标题',
    content: '视频正文'
  })

  assert.equal(normalized.mediaType, 'video')
  assert.equal(normalized.videoCoverMode, 'auto')
})

test('normalizeCreateBatchTaskPayload keeps explicit videoCoverMode when provided', () => {
  const normalized = normalizeCreateBatchTaskPayload({
    accountId: 'account-1',
    mediaType: 'video',
    videoPath: '/videos/demo.mp4',
    images: ['/covers/manual.jpg'],
    videoCoverMode: 'auto',
    title: '视频标题',
    content: '视频正文'
  })

  assert.equal(normalized.videoCoverMode, 'auto')
})
