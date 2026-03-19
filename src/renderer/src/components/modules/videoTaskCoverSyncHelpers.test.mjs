import assert from 'node:assert/strict'
import test from 'node:test'

import {
  replaceVideoTaskCoverById,
  restoreVideoTaskCoverById
} from './videoTaskCoverSyncHelpers.ts'

test('replaceVideoTaskCoverById updates only the targeted preview task', () => {
  const tasks = [
    {
      id: 'task-1',
      title: 'A',
      body: 'body-a',
      assignedImages: ['/covers/old-a.jpg'],
      mediaType: 'video',
      videoPath: '/videos/a.mp4',
      status: 'idle',
      log: ''
    },
    {
      id: 'task-2',
      title: 'B',
      body: 'body-b',
      assignedImages: ['/covers/old-b.jpg'],
      mediaType: 'video',
      videoPath: '/videos/b.mp4',
      status: 'idle',
      log: ''
    }
  ]

  const result = replaceVideoTaskCoverById(tasks, 'task-2', '/covers/manual-b.jpg')

  assert.equal(result.changed, true)
  assert.deepEqual(
    result.tasks.map((task) => task.assignedImages),
    [['/covers/old-a.jpg'], ['/covers/manual-b.jpg']]
  )
})

test('replaceVideoTaskCoverById does not update sibling preview tasks that share the same source video', () => {
  const tasks = [
    {
      id: 'task-1',
      title: 'A',
      body: 'body-a',
      assignedImages: [],
      mediaType: 'video',
      videoPath: '/videos/shared.mp4',
      status: 'idle',
      log: ''
    },
    {
      id: 'task-2',
      title: 'B',
      body: 'body-b',
      assignedImages: [],
      mediaType: 'video',
      videoPath: '/videos/shared.mp4',
      status: 'idle',
      log: ''
    }
  ]

  const result = replaceVideoTaskCoverById(tasks, 'task-2', '/covers/shared-manual.jpg')

  assert.equal(result.changed, true)
  assert.deepEqual(
    result.tasks.map((task) => task.assignedImages),
    [[], ['/covers/shared-manual.jpg']]
  )
})

test('restoreVideoTaskCoverById falls back to the stored first-frame cover for the targeted preview task', () => {
  const tasks = [
    {
      id: 'task-video',
      title: 'Video',
      body: 'body-video',
      assignedImages: ['/covers/manual.jpg'],
      mediaType: 'video',
      videoPath: '/videos/video.mp4',
      status: 'idle',
      log: ''
    }
  ]

  const result = restoreVideoTaskCoverById(tasks, 'task-video', '/covers/first-frame.jpg')

  assert.equal(result.changed, true)
  assert.deepEqual(result.tasks[0]?.assignedImages, ['/covers/first-frame.jpg'])
})
