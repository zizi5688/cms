import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDuplicateVideoCoverWarningMessage,
  findDuplicateVideoCoverAssignments
} from './videoDispatchCoverGuard.ts'

test('findDuplicateVideoCoverAssignments reports same cover reused by different videos', () => {
  const tasks = [
    {
      id: 'task-1',
      title: '标题A',
      assignedImages: ['/covers/shared.jpg'],
      mediaType: 'video',
      videoPath: '/videos/a.mp4'
    },
    {
      id: 'task-2',
      title: '标题B',
      assignedImages: ['/covers/shared.jpg'],
      mediaType: 'video',
      videoPath: '/videos/b.mp4'
    },
    {
      id: 'task-3',
      title: '标题C',
      assignedImages: ['/covers/unique.jpg'],
      mediaType: 'video',
      videoPath: '/videos/c.mp4'
    }
  ]

  const result = findDuplicateVideoCoverAssignments(tasks)

  assert.equal(result.length, 1)
  assert.equal(result[0]?.coverPath, '/covers/shared.jpg')
  assert.deepEqual(
    result[0]?.entries.map((entry) => ({ videoPath: entry.videoPath, title: entry.title })),
    [
      { videoPath: '/videos/a.mp4', title: '标题A' },
      { videoPath: '/videos/b.mp4', title: '标题B' }
    ]
  )
})

test('findDuplicateVideoCoverAssignments ignores image tasks and same-video duplicates', () => {
  const tasks = [
    {
      id: 'task-1',
      title: '标题A',
      assignedImages: ['/covers/shared.jpg'],
      mediaType: 'video',
      videoPath: '/videos/shared.mp4'
    },
    {
      id: 'task-2',
      title: '标题B',
      assignedImages: ['/covers/shared.jpg'],
      mediaType: 'video',
      videoPath: '/videos/shared.mp4'
    },
    {
      id: 'task-3',
      title: '图文任务',
      assignedImages: ['/covers/shared.jpg'],
      mediaType: 'image'
    }
  ]

  const result = findDuplicateVideoCoverAssignments(tasks)

  assert.deepEqual(result, [])
})

test('buildDuplicateVideoCoverWarningMessage lists conflicting videos for dispatch alert', () => {
  const message = buildDuplicateVideoCoverWarningMessage([
    {
      coverPath: '/covers/shared.jpg',
      entries: [
        { taskId: 'task-1', title: '标题A', videoPath: '/videos/a.mp4' },
        { taskId: 'task-2', title: '标题B', videoPath: '/videos/b.mp4' }
      ]
    }
  ])

  assert.match(message, /已停止派发/)
  assert.match(message, /shared\.jpg/)
  assert.match(message, /a\.mp4/)
  assert.match(message, /b\.mp4/)
})
