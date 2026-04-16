import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDefaultLocalGatewayCapabilityChecks,
  probeLocalGatewayChatCapability,
  probeLocalGatewayImageCapability
} from './localGatewayCapabilityChecks.ts'

test('createDefaultLocalGatewayCapabilityChecks starts unknown for chat and image', () => {
  assert.deepEqual(createDefaultLocalGatewayCapabilityChecks(), {
    chat: {
      status: 'unknown',
      ok: false,
      checkedAt: null,
      message: '尚未完成真实聊天探测。'
    },
    image: {
      status: 'unknown',
      ok: false,
      checkedAt: null,
      message: '尚未完成真实生图探测。'
    }
  })
})

test('probeLocalGatewayChatCapability passes when the public chat endpoint returns text', async () => {
  const result = await probeLocalGatewayChatCapability({
    fetch: async (url, init) => {
      assert.match(String(url), /gemini-web-chat:generateContent/)
      assert.equal(init?.headers?.Authorization, 'Bearer local-dev-secret')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: 'OK' }]
              }
            }
          ]
        })
      }
    }
  })

  assert.equal(result.status, 'passing')
  assert.equal(result.ok, true)
  assert.equal(result.message, null)
  assert.equal(typeof result.checkedAt, 'number')
})

test('probeLocalGatewayChatCapability fails with the gateway error message when chat does not run through', async () => {
  const result = await probeLocalGatewayChatCapability({
    fetch: async () => ({
      ok: false,
      status: 502,
      json: async () => ({
        error: '所有 Chat 账号都在 cooldown。'
      })
    })
  })

  assert.equal(result.status, 'failing')
  assert.equal(result.ok, false)
  assert.equal(result.message, '所有 Chat 账号都在 cooldown。')
})

test('probeLocalGatewayImageCapability passes when the public image endpoint returns inline image data', async () => {
  const result = await probeLocalGatewayImageCapability({
    fetch: async (url, init) => {
      assert.match(String(url), /flow-web-image:generateContent/)
      assert.equal(init?.headers?.Authorization, 'Bearer local-dev-secret')
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: 'ZmFrZQ=='
                    }
                  }
                ]
              }
            }
          ]
        })
      }
    }
  })

  assert.equal(result.status, 'passing')
  assert.equal(result.ok, true)
  assert.equal(result.message, null)
})

test('probeLocalGatewayImageCapability fails when the image response contains no image payload', async () => {
  const result = await probeLocalGatewayImageCapability({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: '没有图' }]
            }
          }
        ]
      })
    })
  })

  assert.equal(result.status, 'failing')
  assert.equal(result.ok, false)
  assert.equal(result.message, '真实生图请求未返回图片数据。')
})
