import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countManifestCsvRows,
  generateOneToOneVideoManifest
} from './cms-engine.ts'

test('countManifestCsvRows counts meaningful CSV rows', () => {
  const csv = ['标题,正文', '视频笔记 A,正文 A', '', '视频笔记 B,正文 B'].join('\n')

  assert.equal(countManifestCsvRows(csv), 2)
})

test('generateOneToOneVideoManifest pairs videos with CSV rows in order without cycling', () => {
  const csv = ['标题,正文', '视频笔记 A,正文 A', '视频笔记 B,正文 B', '视频笔记 C,正文 C'].join('\n')

  const tasks = generateOneToOneVideoManifest(csv, [
    '/tmp/video-a.mp4',
    '/tmp/video-b.mp4'
  ])

  assert.deepEqual(
    tasks.map((task) => ({
      title: task.title,
      body: task.body,
      mediaType: task.mediaType,
      videoPath: task.videoPath
    })),
    [
      {
        title: '视频笔记 A',
        body: '正文 A',
        mediaType: 'video',
        videoPath: '/tmp/video-a.mp4'
      },
      {
        title: '视频笔记 B',
        body: '正文 B',
        mediaType: 'video',
        videoPath: '/tmp/video-b.mp4'
      }
    ]
  )
})
