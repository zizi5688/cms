import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProjectCardSummaries,
  buildProjectThumbnailPaths,
  normalizeTrackedProjects,
  removeTrackedProjects,
  sliceProjectCards,
  upsertTrackedProject
} from './projectViewHelpers.ts'

test('normalizeTrackedProjects removes invalid and duplicate legacy entries', () => {
  const normalized = normalizeTrackedProjects([
    null,
    { taskId: '  ' },
    { taskId: 'task-b', createdAt: 50, lastOpenedAt: 100 },
    { taskId: 'task-a', createdAt: 20, lastOpenedAt: 200 },
    { taskId: 'task-b', createdAt: 60, lastOpenedAt: 300 }
  ])

  assert.deepEqual(normalized, [
    { taskId: 'task-a', createdAt: 20, lastOpenedAt: 200 },
    { taskId: 'task-b', createdAt: 50, lastOpenedAt: 100 }
  ])
})

test('buildProjectCardSummaries only includes tracked projects and keeps four newest thumbnails', () => {
  const cards = buildProjectCardSummaries({
    trackedProjects: [{ taskId: 'task-new', createdAt: 100, lastOpenedAt: 500 }],
    tasks: [
      {
        id: 'task-legacy',
        productName: '旧线程',
        status: 'completed',
        createdAt: 10,
        updatedAt: 20,
        outputAssets: [
          {
            id: 'legacy-1',
            filePath: '/tmp/legacy.png',
            previewPath: null,
            createdAt: 20,
            updatedAt: 20,
            sortOrder: 1
          }
        ]
      },
      {
        id: 'task-new',
        productName: '春季大片',
        status: 'completed',
        createdAt: 100,
        updatedAt: 300,
        outputAssets: [
          {
            id: 'asset-1',
            filePath: '/tmp/1.png',
            previewPath: '/tmp/1-preview.png',
            createdAt: 110,
            updatedAt: 120,
            sortOrder: 1
          },
          {
            id: 'asset-2',
            filePath: '/tmp/2.png',
            previewPath: null,
            createdAt: 130,
            updatedAt: 140,
            sortOrder: 2
          },
          {
            id: 'asset-3',
            filePath: '/tmp/3.png',
            previewPath: null,
            createdAt: 150,
            updatedAt: 160,
            sortOrder: 3
          },
          {
            id: 'asset-4',
            filePath: '/tmp/4.png',
            previewPath: null,
            createdAt: 170,
            updatedAt: 180,
            sortOrder: 4
          },
          {
            id: 'asset-5',
            filePath: '/tmp/5.png',
            previewPath: null,
            createdAt: 190,
            updatedAt: 200,
            sortOrder: 5
          }
        ]
      }
    ]
  })

  assert.equal(cards.length, 1)
  assert.equal(cards[0]?.taskId, 'task-new')
  assert.equal(cards[0]?.title, '春季大片')
  assert.deepEqual(cards[0]?.thumbnailPaths, [
    '/tmp/5.png',
    '/tmp/4.png',
    '/tmp/3.png',
    '/tmp/2.png'
  ])
})

test('buildProjectCardSummaries aggregates child task outputs for the same project shell', () => {
  const cards = buildProjectCardSummaries({
    trackedProjects: [{ taskId: 'project-root', createdAt: 100, lastOpenedAt: 500 }],
    tasks: [
      {
        id: 'project-root',
        productName: '春季橱窗项目',
        status: 'draft',
        createdAt: 100,
        updatedAt: 110,
        sourceFolderPath: '/workspace/ai-studio/projects/spring-campaign',
        metadata: {
          projectId: 'project-root',
          projectRootTaskId: 'project-root',
          projectName: '春季橱窗项目'
        },
        outputAssets: []
      },
      {
        id: 'task-a',
        productName: '子线程 A',
        status: 'completed',
        createdAt: 120,
        updatedAt: 210,
        sourceFolderPath: '/workspace/ai-studio/projects/spring-campaign',
        metadata: {
          projectId: 'project-root',
          projectRootTaskId: 'project-root',
          projectName: '春季橱窗项目'
        },
        outputAssets: [
          {
            id: 'asset-a',
            filePath: '/workspace/ai-studio/projects/spring-campaign/tasks/task-a/output-a.png',
            previewPath: null,
            createdAt: 150,
            updatedAt: 200,
            sortOrder: 1
          }
        ]
      },
      {
        id: 'task-b',
        productName: '子线程 B',
        status: 'completed',
        createdAt: 130,
        updatedAt: 310,
        sourceFolderPath: '/workspace/ai-studio/projects/spring-campaign',
        metadata: {
          projectId: 'project-root',
          projectRootTaskId: 'project-root',
          projectName: '春季橱窗项目'
        },
        outputAssets: [
          {
            id: 'asset-b',
            filePath: '/workspace/ai-studio/projects/spring-campaign/tasks/task-b/output-b.png',
            previewPath: null,
            createdAt: 250,
            updatedAt: 300,
            sortOrder: 1
          }
        ]
      }
    ]
  })

  assert.equal(cards.length, 1)
  assert.equal(cards[0]?.title, '春季橱窗项目')
  assert.equal(cards[0]?.outputCount, 2)
  assert.deepEqual(cards[0]?.thumbnailPaths, [
    '/workspace/ai-studio/projects/spring-campaign/tasks/task-b/output-b.png',
    '/workspace/ai-studio/projects/spring-campaign/tasks/task-a/output-a.png'
  ])
})

test('buildProjectThumbnailPaths ignores non-image outputs and respects the limit', () => {
  assert.deepEqual(
    buildProjectThumbnailPaths(
      [
        {
          id: 'a',
          filePath: '/tmp/a.mp4',
          previewPath: null,
          createdAt: 1,
          updatedAt: 1,
          sortOrder: 1
        },
        {
          id: 'b',
          filePath: '/tmp/b.png',
          previewPath: null,
          createdAt: 2,
          updatedAt: 2,
          sortOrder: 2
        },
        {
          id: 'c',
          filePath: '/tmp/c.jpg',
          previewPath: '/tmp/c-preview.jpg',
          createdAt: 3,
          updatedAt: 3,
          sortOrder: 3
        }
      ],
      2
    ),
    ['/tmp/c-preview.jpg', '/tmp/b.png']
  )
})

test('removeTrackedProjects removes deleted project roots and preserves order of remaining entries', () => {
  const trackedProjects = [
    { taskId: 'project-a', createdAt: 10, lastOpenedAt: 300 },
    { taskId: 'project-b', createdAt: 20, lastOpenedAt: 200 },
    { taskId: 'project-c', createdAt: 30, lastOpenedAt: 100 }
  ]

  assert.deepEqual(removeTrackedProjects(trackedProjects, ['project-b', 'project-a']), [
    { taskId: 'project-c', createdAt: 30, lastOpenedAt: 100 }
  ])
})

test('sliceProjectCards returns a short recent list without affecting the all view', () => {
  const cards = [
    { taskId: 'a', updatedAt: 300 },
    { taskId: 'b', updatedAt: 200 },
    { taskId: 'c', updatedAt: 100 }
  ]

  assert.deepEqual(
    sliceProjectCards(cards, 'recent', 2).map((card) => card.taskId),
    ['a', 'b']
  )
  assert.deepEqual(
    sliceProjectCards(cards, 'all', 2).map((card) => card.taskId),
    ['a', 'b', 'c']
  )
})

test('upsertTrackedProject inserts or refreshes tracked items at the front', () => {
  const first = upsertTrackedProject([], { taskId: 'task-a', createdAt: 10, lastOpenedAt: 10 })
  const second = upsertTrackedProject(first, {
    taskId: 'task-b',
    createdAt: 20,
    lastOpenedAt: 40
  })
  const refreshed = upsertTrackedProject(second, {
    taskId: 'task-a',
    createdAt: 10,
    lastOpenedAt: 80
  })

  assert.deepEqual(
    refreshed.map((entry) => entry.taskId),
    ['task-a', 'task-b']
  )
  assert.equal(refreshed[0]?.lastOpenedAt, 80)
})
