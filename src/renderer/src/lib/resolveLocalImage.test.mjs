import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveLocalImage } from './resolveLocalImage.ts'

test('resolveLocalImage upgrades insecure qimg covers to https', () => {
  const input = 'http://qimg.xiaohongshu.com/arkgoods/demo.jpg?imageView2/1/w/162/h/162/q/90.jpg'

  assert.equal(
    resolveLocalImage(input),
    'https://qimg.xiaohongshu.com/arkgoods/demo.jpg?imageView2/1/w/162/h/162/q/90.jpg'
  )
})

test('resolveLocalImage keeps https covers unchanged', () => {
  const input = 'https://qimg.xiaohongshu.com/material_space/demo.jpg?imageView2/1/w/162/h/162/q/90.jpg'

  assert.equal(resolveLocalImage(input), input)
})
