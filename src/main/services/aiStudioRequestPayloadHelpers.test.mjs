import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildGeminiGenerationConfig,
  buildGeminiImageConfig,
  resolveImageSizeForModel
} from './aiStudioRequestPayloadHelpers.ts'

test('resolveImageSizeForModel defaults Gemini image models to 2K', () => {
  assert.equal(resolveImageSizeForModel('gemini-3.1-flash-image-preview'), '2K')
  assert.equal(resolveImageSizeForModel(''), '2K')
})

test('buildGeminiImageConfig includes both aspect ratio and image size', () => {
  assert.deepEqual(
    buildGeminiImageConfig({ aspectRatio: '3:4', imageSize: '2K' }),
    {
      aspectRatio: '3:4',
      imageSize: '2K'
    }
  )
})

test('resolveImageSizeForModel preserves explicit 4K overrides for mapped models', () => {
  assert.equal(resolveImageSizeForModel('nano-banana-pro-4k-vip'), '4K')
})


test('buildGeminiGenerationConfig nests imageConfig under generationConfig', () => {
  assert.deepEqual(
    buildGeminiGenerationConfig({ aspectRatio: '3:4', imageSize: '2K' }),
    {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: '3:4',
        imageSize: '2K'
      }
    }
  )
})
