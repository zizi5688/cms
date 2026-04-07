import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildNoteSidebarPreviewItems,
  buildUploadTasksFromNotePreviewTasks,
  collectDispatchableNotePreviewTaskIds,
  countUndispatchedNotePreviewTasks,
  markNotePreviewTasksDispatched,
  matchCreatedTasksToNotePreviewTaskIds,
  normalizeNoteSidebarConstraints
} from './noteSidebarHelpers.ts'

test('normalizeNoteSidebarConstraints falls back to defaults and clamps invalid ranges', () => {
  assert.deepEqual(
    normalizeNoteSidebarConstraints({
      groupCount: 'bad',
      minImages: '',
      maxImages: '2',
      maxReuse: '0'
    }),
    {
      groupCount: 1,
      minImages: 3,
      maxImages: 3,
      maxReuse: 1
    }
  )
})

test('normalizeNoteSidebarConstraints keeps integer intent for valid drafts', () => {
  assert.deepEqual(
    normalizeNoteSidebarConstraints({
      groupCount: '6.9',
      minImages: '4',
      maxImages: '7',
      maxReuse: '3'
    }),
    {
      groupCount: 6,
      minImages: 4,
      maxImages: 7,
      maxReuse: 3
    }
  )
})

test('buildUploadTasksFromNotePreviewTasks mirrors workshop upload payloads', () => {
  assert.deepEqual(
    buildUploadTasksFromNotePreviewTasks([
      {
        id: 'task-image',
        title: '图文笔记 A',
        body: '正文 A',
        assignedImages: ['/tmp/a.png', '/tmp/b.png'],
        mediaType: 'image',
        status: 'idle',
        log: ''
      },
      {
        id: 'task-video',
        title: '视频笔记 B',
        body: '正文 B',
        assignedImages: ['/tmp/cover.png'],
        mediaType: 'video',
        status: 'idle',
        log: ''
      }
    ]),
    [
      {
        title: '图文笔记 A',
        body: '正文 A',
        images: ['/tmp/a.png', '/tmp/b.png']
      },
      {
        title: '视频笔记 B',
        body: '正文 B',
        images: []
      }
    ]
  )
})

test('buildNoteSidebarPreviewItems exposes multi-image preview metadata for the sidebar UI', () => {
  const items = buildNoteSidebarPreviewItems([
    {
      id: 'task-1',
      title: '春日外套合集',
      body: '第一段\n第二段',
      assignedImages: ['/tmp/1.png', '/tmp/2.png', '/tmp/3.png'],
      mediaType: 'image',
      status: 'idle',
      log: ''
    },
    {
      id: 'task-2',
      title: '轻通勤鞋履',
      body: '正文',
      assignedImages: ['/tmp/4.png'],
      mediaType: 'image',
      status: 'idle',
      log: '图片不足：目标至少 3 张，实际分配 1 张。'
    }
  ])

  assert.deepEqual(items[0], {
    id: 'task-1',
    title: '春日外套合集',
    body: '第一段\n第二段',
    imagePaths: ['/tmp/1.png', '/tmp/2.png', '/tmp/3.png'],
    imageCount: 3,
    hasImageShortage: false,
    log: ''
  })
  assert.equal(items[1]?.hasImageShortage, true)
  assert.equal(items[1]?.imageCount, 1)
  assert.equal(items[1]?.log, '图片不足：目标至少 3 张，实际分配 1 张。')
})

test('collectDispatchableNotePreviewTaskIds ignores dispatched items', () => {
  assert.deepEqual(
    collectDispatchableNotePreviewTaskIds([
      { id: 'task-1', status: 'idle' },
      { id: 'task-2', status: 'success' },
      { id: 'task-3', status: 'error' }
    ]),
    ['task-1', 'task-3']
  )
})

test('markNotePreviewTasksDispatched updates status and appends dispatch log once', () => {
  const tasks = markNotePreviewTasksDispatched(
    [
      {
        id: 'task-1',
        title: 'A',
        body: '正文',
        assignedImages: ['/tmp/a.png'],
        mediaType: 'image',
        status: 'idle',
        log: ''
      },
      {
        id: 'task-2',
        title: 'B',
        body: '正文',
        assignedImages: ['/tmp/b.png'],
        mediaType: 'image',
        status: 'success',
        log: '已派发到媒体矩阵'
      }
    ],
    ['task-1', 'task-2']
  )

  assert.equal(tasks[0]?.status, 'success')
  assert.equal(tasks[0]?.log, '已派发到媒体矩阵')
  assert.equal(tasks[1]?.log, '已派发到媒体矩阵')
  assert.equal(countUndispatchedNotePreviewTasks(tasks), 0)
})

test('matchCreatedTasksToNotePreviewTaskIds pairs created tasks back to preview ids', () => {
  const sourceTasks = [
    {
      id: 'preview-1',
      accountId: 'acc-1',
      title: '标题 A',
      body: '正文 A',
      assignedImages: ['/tmp/cover-a.png'],
      mediaType: 'video',
      productId: 'product-1',
      videoPath: '/tmp/video-a.mp4',
      status: 'idle',
      log: ''
    },
    {
      id: 'preview-2',
      accountId: 'acc-1',
      title: '标题 B',
      body: '正文 B',
      assignedImages: ['/tmp/cover-b.png'],
      mediaType: 'video',
      productId: 'product-2',
      videoPath: '/tmp/video-b.mp4',
      status: 'idle',
      log: ''
    }
  ]

  const matchedIds = matchCreatedTasksToNotePreviewTaskIds(sourceTasks, [
    {
      id: 'created-2',
      accountId: 'acc-1',
      title: '标题 B',
      body: '正文 B',
      assignedImages: ['/tmp/cover-b.png'],
      mediaType: 'video',
      productId: 'product-2',
      videoPath: '/tmp/video-b.mp4',
      status: 'success',
      log: ''
    }
  ])

  assert.deepEqual(matchedIds, ['preview-2'])
})
