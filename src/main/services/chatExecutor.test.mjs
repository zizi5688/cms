import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatCompletionPayload, executeChatTask } from './chatExecutor.ts'

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
          protocol: 'google-genai'
        },
        request: {
          capability: 'chat',
          input: { prompt: 'hello' }
        }
      }),
    /AI_CHAT_PROTOCOL_UNSUPPORTED/
  )
})
