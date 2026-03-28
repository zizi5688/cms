import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSeedanceVideoTaskPayload,
  buildImageGenerationDirectiveLines,
  buildGeminiGenerationConfig,
  buildGeminiImageConfig,
  isGeminiGenerateContentPath,
  isSeedanceVideoModel,
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

test('buildImageGenerationDirectiveLines includes 2K clarity guidance for prompt-based image APIs', () => {
  assert.deepEqual(
    buildImageGenerationDirectiveLines({
      aspectRatio: '3:4',
      imageSize: '2K',
      referenceCount: 2
    }),
    [
      '输出比例：3:4。',
      '输出清晰度：2K。',
      '第 1 张输入图为主图，后续 2 张为参考图，请保留主体材质、结构与关键细节。'
    ]
  )
})

test('resolveImageSizeForModel preserves explicit 4K overrides for mapped models', () => {
  assert.equal(resolveImageSizeForModel('nano-banana-pro-4k-vip'), '4K')
})

test('isSeedanceVideoModel recognizes both plain and doubao Seedance identifiers', () => {
  assert.equal(isSeedanceVideoModel('seedance-1-5-pro'), true)
  assert.equal(isSeedanceVideoModel('doubao-seedance-1-5-pro-250928'), true)
  assert.equal(isSeedanceVideoModel('jimeng-video-3.0'), false)
})

test('buildSeedanceVideoTaskPayload maps a subject reference image into content items', () => {
  assert.deepEqual(
    buildSeedanceVideoTaskPayload({
      model: 'seedance-1-5-pro',
      prompt: '让模特转身看向镜头',
      mode: 'subject-reference',
      imageUrls: ['data:image/png;base64,AAA'],
      aspectRatio: 'adaptive',
      duration: 4
    }),
    {
      model: 'seedance-1-5-pro',
      content: [
        { type: 'text', text: '让模特转身看向镜头' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,AAA' }
        }
      ],
      ratio: 'adaptive',
      duration: 4,
      watermark: false
    }
  )
})

test('buildSeedanceVideoTaskPayload assigns first and last frame roles', () => {
  assert.deepEqual(
    buildSeedanceVideoTaskPayload({
      model: 'doubao-seedance-1-5-pro-250928',
      prompt: '镜头推进后停在桌面产品特写',
      mode: 'first-last-frame',
      imageUrls: ['data:image/png;base64,FIRST', 'data:image/png;base64,LAST'],
      aspectRatio: '16:9',
      duration: 4
    }),
    {
      model: 'doubao-seedance-1-5-pro-250928',
      content: [
        { type: 'text', text: '镜头推进后停在桌面产品特写' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,FIRST' },
          role: 'first_frame'
        },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,LAST' },
          role: 'last_frame'
        }
      ],
      ratio: '16:9',
      duration: 4,
      watermark: false
    }
  )
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

test('isGeminiGenerateContentPath recognizes Gemini native generateContent endpoints', () => {
  assert.equal(
    isGeminiGenerateContentPath('/v1beta/models/gemini-3-pro-image-preview:generateContent'),
    true
  )
  assert.equal(
    isGeminiGenerateContentPath('/v1beta/models/gemini-2.5-flash-image:generateContent?key=demo'),
    true
  )
  assert.equal(isGeminiGenerateContentPath('/v1/chat/completions'), false)
  assert.equal(isGeminiGenerateContentPath('/v1/draw/nano-banana'), false)
})
