import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import sharp from 'sharp'

import { prepareGeminiInlineImageFromPath } from './aiStudioGeminiInlineImageHelpers.ts'

async function createTempDir() {
  return await mkdtemp(join(os.tmpdir(), 'ai-studio-gemini-inline-'))
}

async function createNoiseJpeg(filePath, width, height) {
  const channels = 3
  const raw = Buffer.alloc(width * height * channels)
  for (let index = 0; index < raw.length; index += channels) {
    const pixel = Math.floor(index / channels)
    const x = pixel % width
    const y = Math.floor(pixel / width)
    raw[index] = (x * 17 + y * 11) % 256
    raw[index + 1] = (x * 7 + y * 19) % 256
    raw[index + 2] = (x * 13 + y * 5) % 256
  }

  await sharp(raw, {
    raw: {
      width,
      height,
      channels
    }
  })
    .jpeg({ quality: 96, mozjpeg: true })
    .toFile(filePath)
}

test('prepareGeminiInlineImageFromPath keeps already small images intact', async () => {
  const tempDir = await createTempDir()
  const filePath = join(tempDir, 'small.jpg')

  try {
    await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 3,
        background: '#88ccff'
      }
    })
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(filePath)

    const result = await prepareGeminiInlineImageFromPath(filePath, {
      maxBytes: 350 * 1024,
      maxEdge: 512
    })

    assert.equal(result.transformed, false)
    assert.equal(result.mimeType, 'image/jpeg')
    assert.ok(result.byteLength > 0)
    assert.ok(result.dataUrl.startsWith('data:image/jpeg;base64,'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('prepareGeminiInlineImageFromPath downsizes oversized images for Gemini inlineData', async () => {
  const tempDir = await createTempDir()
  const filePath = join(tempDir, 'large.jpg')

  try {
    await createNoiseJpeg(filePath, 2400, 2400)

    const originalMeta = await sharp(filePath).metadata()
    const originalSize = (await sharp(filePath).toBuffer()).byteLength
    assert.ok(originalSize > 350 * 1024)
    assert.ok(Math.max(originalMeta.width ?? 0, originalMeta.height ?? 0) > 512)

    const result = await prepareGeminiInlineImageFromPath(filePath, {
      maxBytes: 350 * 1024,
      maxEdge: 512
    })

    const encoded = Buffer.from(result.dataUrl.split(',')[1] ?? '', 'base64')
    const preparedMeta = await sharp(encoded).metadata()

    assert.equal(result.transformed, true)
    assert.equal(result.mimeType, 'image/jpeg')
    assert.ok(result.byteLength <= 350 * 1024)
    assert.ok(result.byteLength < originalSize)
    assert.ok(Math.max(preparedMeta.width ?? 0, preparedMeta.height ?? 0) <= 512)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
