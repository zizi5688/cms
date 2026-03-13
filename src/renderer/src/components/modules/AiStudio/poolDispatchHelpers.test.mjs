import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPoolDispatchPlan, resolvePoolSendButtonText } from './poolDispatchHelpers.ts'

test('buildPoolDispatchPlan keeps pooled image selections when starting remix', () => {
  assert.deepEqual(
    buildPoolDispatchPlan({
      action: 'remix',
      studioCapability: 'image',
      assets: [
        { filePath: ' /tmp/look-a.jpg ', role: 'child-output' },
        { filePath: '/tmp/look-a.jpg', role: 'child-output' },
        { filePath: '/tmp/look-b.png', role: 'master-clean' }
      ]
    }),
    {
      target: 'material-video',
      mediaType: 'image',
      clearSelection: false,
      paths: ['/tmp/look-a.jpg', '/tmp/look-b.png']
    }
  )
})

test('buildPoolDispatchPlan rejects pooled video assets for remix', () => {
  assert.throws(
    () =>
      buildPoolDispatchPlan({
        action: 'remix',
        studioCapability: 'image',
        assets: [{ filePath: '/tmp/demo.mp4', role: 'video-output' }]
      }),
    /仅支持图片素材池/
  )
})

test('buildPoolDispatchPlan keeps workshop dispatch clearing selections', () => {
  assert.deepEqual(
    buildPoolDispatchPlan({
      action: 'workshop',
      studioCapability: 'image',
      assets: [{ filePath: '/tmp/look-a.jpg', role: 'child-output' }]
    }),
    {
      target: 'workshop',
      mediaType: 'image',
      clearSelection: true,
      paths: ['/tmp/look-a.jpg']
    }
  )
})

test('resolvePoolSendButtonText uses the updated material-pool label', () => {
  assert.equal(resolvePoolSendButtonText(), '发送素材池')
})
