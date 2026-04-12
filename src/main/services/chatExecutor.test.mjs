import assert from 'node:assert/strict'
import test from 'node:test'

import { ChatExecutorError, createChatCompletionPayload, executeChatTask } from './chatExecutor.ts'

const ROUTE = {
  providerId: 'provider-openai',
  providerName: 'openai',
  capability: 'chat',
  baseUrl: 'https://openai.example.com',
  apiKey: 'openai-key',
  modelId: 'model-gpt-4o-mini',
  modelName: 'gpt-4o-mini',
  endpointPath: '/v1/chat/completions',
  protocol: 'openai'
}

test('createChatCompletionPayload maps prompt input to a single user message', () => {
  const payload = createChatCompletionPayload(ROUTE, {
    capability: 'chat',
    input: {
      prompt: 'hello router',
      temperature: 0.2
    }
  })

  assert.equal(payload.model, 'gpt-4o-mini')
  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello router' }])
  assert.equal(payload.temperature, 0.2)
})

test('createChatCompletionPayload builds openai multimodal content when imageUrls are provided', () => {
  const payload = createChatCompletionPayload(ROUTE, {
    capability: 'chat',
    input: {
      prompt: '请参考商品图生成文案',
      imageUrls: ['data:image/png;base64,AAA']
    }
  })

  assert.deepEqual(payload.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: '请参考商品图生成文案' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
      ]
    }
  ])
})

test('executeChatTask sends an openai-compatible chat request and returns the first assistant text', async () => {
  const calls = []
  const result = await executeChatTask(
    {
      route: ROUTE,
      request: {
        capability: 'chat',
        input: {
          messages: [{ role: 'user', content: 'say hi' }]
        }
      }
    },
    async (url, init) => {
      calls.push([url, init])
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 'chatcmpl-1',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'hi there'
                }
              }
            ]
          }
        }
      }
    }
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'https://openai.example.com/v1/chat/completions')
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].headers.Authorization, 'Bearer openai-key')
  assert.equal(result.outputText, 'hi there')
  assert.equal(result.response.choices[0].message.content, 'hi there')
})

test('executeChatTask throws a unified error when the route protocol is unsupported', async () => {
  await assert.rejects(
    () =>
      executeChatTask({
        route: {
          ...ROUTE,
          protocol: 'anthropic'
        },
        request: {
          capability: 'chat',
          input: { prompt: 'hello' }
        }
      }),
    /AI_CHAT_PROTOCOL_UNSUPPORTED/
  )
})

test('createChatCompletionPayload builds Gemini generateContent payloads', () => {
  const payload = createChatCompletionPayload(
    {
      ...ROUTE,
      endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
      protocol: 'google-genai'
    },
    {
      capability: 'chat',
      input: {
        messages: [
          { role: 'user', content: '你好' },
          { role: 'assistant', content: '你好，我在。' }
        ]
      }
    }
  )

  assert.deepEqual(payload, {
    contents: [
      { role: 'user', parts: [{ text: '你好' }] },
      { role: 'model', parts: [{ text: '你好，我在。' }] }
    ]
  })
})

test('createChatCompletionPayload builds Gemini multimodal payloads when imageUrls are provided', () => {
  const payload = createChatCompletionPayload(
    {
      ...ROUTE,
      endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
      protocol: 'google-genai'
    },
    {
      capability: 'chat',
      input: {
        prompt: '请参考商品图生成文案',
        imageUrls: ['data:image/png;base64,AAA']
      }
    }
  )

  assert.deepEqual(payload, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'AAA'
            }
          },
          {
            text: '请参考商品图生成文案'
          }
        ]
      }
    ]
  })
})

test('executeChatTask extracts text from Gemini candidates', async () => {
  const result = await executeChatTask(
    {
      route: {
        ...ROUTE,
        baseUrl: 'http://127.0.0.1:4174',
        apiKey: 'local-dev-secret',
        modelName: 'gemini-web-chat',
        endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
        protocol: 'google-genai'
      },
      request: {
        capability: 'chat',
        input: {
          prompt: '帮我写一句问候'
        }
      }
    },
    async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:4174/v1beta/models/gemini-web-chat:generateContent')
      assert.equal(init.headers.Authorization, 'Bearer local-dev-secret')
      assert.deepEqual(JSON.parse(init.body), {
        contents: [{ role: 'user', parts: [{ text: '帮我写一句问候' }] }]
      })
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: '你好，欢迎回来。' }]
                }
              }
            ]
          }
        }
      }
    }
  )

  assert.equal(result.outputText, '你好，欢迎回来。')
})

test('executeChatTask wraps fetch transport failures with actionable local gateway context', async () => {
  await assert.rejects(
    () =>
      executeChatTask(
        {
          route: {
            ...ROUTE,
            baseUrl: 'http://127.0.0.1:4174',
            apiKey: 'local-dev-secret',
            modelName: 'gemini-web-chat',
            endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
            protocol: 'google-genai'
          },
          request: {
            capability: 'chat',
            input: {
              prompt: '帮我写一句问候'
            }
          }
        },
        async () => {
          const error = new TypeError('fetch failed')
          error.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4174'), {
            code: 'ECONNREFUSED',
            address: '127.0.0.1',
            port: 4174
          })
          throw error
        }
      ),
    (error) => {
      assert.equal(error instanceof ChatExecutorError, true)
      assert.equal(error.code, 'AI_CHAT_NETWORK_ERROR')
      assert.match(error.message, /127\.0\.0\.1:4174/)
      assert.match(error.message, /本地网关/)
      assert.match(error.message, /ECONNREFUSED/)
      return true
    }
  )
})

test('executeChatTask retries transient transport failures before succeeding', async () => {
  let attempts = 0
  const result = await executeChatTask(
    {
      route: ROUTE,
      request: {
        capability: 'chat',
        input: {
          prompt: 'retry please'
        }
      }
    },
    async () => {
      attempts += 1
      if (attempts < 3) {
        const error = new TypeError('fetch failed')
        error.cause = Object.assign(new Error('other side closed'), {
          code: 'UND_ERR_SOCKET'
        })
        throw error
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'recovered'
                }
              }
            ]
          }
        }
      }
    },
    {
      sleep: async () => {}
    }
  )

  assert.equal(attempts, 3)
  assert.equal(result.outputText, 'recovered')
})

test('executeChatTask retries retryable HTTP errors and preserves provider message', async () => {
  let attempts = 0
  await assert.rejects(
    () =>
      executeChatTask(
        {
          route: {
            ...ROUTE,
            providerName: 'yunwu'
          },
          request: {
            capability: 'chat',
            input: {
              prompt: '请只回复 ok'
            }
          }
        },
        async () => {
          attempts += 1
          return {
            ok: false,
            status: 429,
            async json() {
              return {
                error: {
                  message: '当前分组上游负载已饱和，请稍后再试'
                }
              }
            }
          }
        },
        {
          sleep: async () => {}
        }
      ),
    (error) => {
      assert.equal(error instanceof ChatExecutorError, true)
      assert.equal(error.code, 'AI_CHAT_REQUEST_FAILED')
      assert.equal(error.status, 429)
      assert.equal(attempts, 3)
      assert.match(error.message, /当前分组上游负载已饱和/)
      assert.match(error.message, /已重试 3 \/ 3 次/)
      return true
    }
  )
})

test('executeChatTask uses a single attempt by default for local gateway routes', async () => {
  let attempts = 0

  await assert.rejects(
    () =>
      executeChatTask(
        {
          route: {
            ...ROUTE,
            baseUrl: 'http://127.0.0.1:4174',
            apiKey: 'local-dev-secret',
            modelName: 'gemini-web-chat',
            endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
            protocol: 'google-genai'
          },
          request: {
            capability: 'chat',
            input: {
              prompt: '长输出测试'
            }
          }
        },
        async () => {
          attempts += 1
          throw new TypeError('fetch failed')
        }
      ),
    (error) => {
      assert.equal(error instanceof ChatExecutorError, true)
      assert.equal(error.code, 'AI_CHAT_NETWORK_ERROR')
      assert.equal(attempts, 1)
      assert.doesNotMatch(error.message, /已重试/)
      return true
    }
  )
})

test('executeChatTask uses 120s timeout by default for local gateway routes', async () => {
  const originalSetTimeout = globalThis.setTimeout
  let capturedTimeoutMs = null

  globalThis.setTimeout = (callback, delay, ...args) => {
    if (capturedTimeoutMs === null) {
      capturedTimeoutMs = Number(delay)
    }
    return originalSetTimeout(callback, 0, ...args)
  }

  try {
    const result = await executeChatTask(
      {
        route: {
          ...ROUTE,
          baseUrl: 'http://127.0.0.1:4174',
          apiKey: 'local-dev-secret',
          modelName: 'gemini-web-chat',
          endpointPath: '/v1beta/models/gemini-web-chat:generateContent',
          protocol: 'google-genai'
        },
        request: {
          capability: 'chat',
          input: {
            prompt: '只回复 ok'
          }
        }
      },
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'ok' }]
                }
              }
            ]
          }
        }
      })
    )

    assert.equal(result.outputText, 'ok')
    assert.equal(capturedTimeoutMs, 120_000)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})
