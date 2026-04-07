import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGeneratedVideoNotePreviewTasks } from './videoNotePreviewHelpers.ts'

test('buildGeneratedVideoNotePreviewTasks injects cover and preview metadata for generated videos', () => {
  const csv = ['标题,正文', '视频笔记 A,正文 A', '视频笔记 B,正文 B', '视频笔记 C,正文 C'].join('\n')

  const tasks = buildGeneratedVideoNotePreviewTasks(csv, [
    {
      videoPath: '/tmp/video-a.mp4',
      previewPath: '/tmp/video-a-preview.mp4',
      coverImagePath: '/tmp/video-a-cover.jpg'
    },
    {
      videoPath: '/tmp/video-b.mp4',
      coverImagePath: '/tmp/video-b-cover.jpg'
    }
  ])

  assert.deepEqual(
    tasks.map((task) => ({
      title: task.title,
      body: task.body,
      mediaType: task.mediaType,
      videoPath: task.videoPath,
      videoPreviewPath: task.videoPreviewPath,
      videoCoverMode: task.videoCoverMode,
      assignedImages: task.assignedImages
    })),
    [
      {
        title: '视频笔记 A',
        body: '正文 A',
        mediaType: 'video',
        videoPath: '/tmp/video-a.mp4',
        videoPreviewPath: '/tmp/video-a-preview.mp4',
        videoCoverMode: 'auto',
        assignedImages: ['/tmp/video-a-cover.jpg']
      },
      {
        title: '视频笔记 B',
        body: '正文 B',
        mediaType: 'video',
        videoPath: '/tmp/video-b.mp4',
        videoPreviewPath: undefined,
        videoCoverMode: 'auto',
        assignedImages: ['/tmp/video-b-cover.jpg']
      }
    ]
  )
})
