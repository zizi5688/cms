import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyTaskDetailVideoCover,
  buildTaskDetailProjectCards,
  listTaskDetailProjectSelectableAssets
} from './taskDetailVideoCoverHelpers.ts'

test('applyTaskDetailVideoCover replaces the first image and forces manual mode', () => {
  const result = applyTaskDetailVideoCover(
    ['/covers/original.jpg', '/gallery/2.jpg'],
    '/covers/manual.jpg'
  )

  assert.deepEqual(result, {
    draftImages: ['/covers/manual.jpg', '/gallery/2.jpg'],
    videoCoverMode: 'manual'
  })
})

test('buildTaskDetailProjectCards groups tasks by project and counts project-library assets', () => {
  const tasks = [
    {
      id: 'root-a',
      productName: 'Project A',
      status: 'completed',
      metadata: {
        projectId: 'project-a',
        projectRootTaskId: 'root-a',
        projectName: 'Project A'
      },
      createdAt: 100,
      updatedAt: 200
    },
    {
      id: 'child-a',
      productName: 'Project A Child',
      status: 'completed',
      metadata: {
        projectId: 'project-a',
        projectRootTaskId: 'root-a',
        projectName: 'Project A'
      },
      createdAt: 150,
      updatedAt: 260
    },
    {
      id: 'root-b',
      productName: 'Project B',
      status: 'completed',
      metadata: {
        projectId: 'project-b',
        projectRootTaskId: 'root-b',
        projectName: 'Project B'
      },
      createdAt: 120,
      updatedAt: 180
    }
  ]

  const assets = [
    {
      id: 'asset-a-1',
      taskId: 'root-a',
      kind: 'output',
      role: 'project-library-image',
      filePath: '/library/a-1.jpg',
      previewPath: '/library/a-1.jpg',
      createdAt: 170,
      updatedAt: 280,
      sortOrder: 1
    },
    {
      id: 'asset-a-2',
      taskId: 'child-a',
      kind: 'output',
      role: 'master-clean',
      filePath: '/library/a-2.png',
      previewPath: '/library/a-2.png',
      createdAt: 171,
      updatedAt: 281,
      sortOrder: 2
    },
    {
      id: 'asset-b-1',
      taskId: 'root-b',
      kind: 'output',
      role: 'project-library-image',
      filePath: '/library/b-1.webp',
      previewPath: '/library/b-1.webp',
      createdAt: 140,
      updatedAt: 190,
      sortOrder: 0
    },
    {
      id: 'asset-ignore',
      taskId: 'root-b',
      kind: 'input',
      role: 'output',
      filePath: '/library/ignore.jpg',
      previewPath: '/library/ignore.jpg',
      createdAt: 200,
      updatedAt: 210,
      sortOrder: 9
    }
  ]

  const cards = buildTaskDetailProjectCards({
    tasks,
    assets,
    trackedProjects: [
      { taskId: 'root-a', createdAt: 100, lastOpenedAt: 500 },
      { taskId: 'root-b', createdAt: 120, lastOpenedAt: 400 }
    ]
  })

  assert.deepEqual(
    cards.map((card) => ({
      projectId: card.projectId,
      rootTaskId: card.rootTaskId,
      title: card.title,
      assetCount: card.assetCount
    })),
    [
      {
        projectId: 'project-a',
        rootTaskId: 'root-a',
        title: 'Project A',
        assetCount: 2
      },
      {
        projectId: 'project-b',
        rootTaskId: 'root-b',
        title: 'Project B',
        assetCount: 1
      }
    ]
  )
})

test('buildTaskDetailProjectCards excludes groups without project-library assets', () => {
  const tasks = [
    {
      id: 'project-with-assets',
      productName: '有图项目',
      status: 'completed',
      metadata: {
        projectId: 'project-with-assets',
        projectRootTaskId: 'project-with-assets',
        projectName: '有图项目'
      },
      createdAt: 100,
      updatedAt: 200
    },
    {
      id: 'plain-task',
      productName: 'output-001',
      status: 'draft',
      metadata: {},
      createdAt: 120,
      updatedAt: 220
    }
  ]

  const assets = [
    {
      id: 'asset-1',
      taskId: 'project-with-assets',
      kind: 'output',
      role: 'project-library-image',
      filePath: '/library/cover.jpg',
      previewPath: '/library/cover.jpg',
      createdAt: 130,
      updatedAt: 230,
      sortOrder: 0
    }
  ]

  const cards = buildTaskDetailProjectCards({
    tasks,
    assets,
    trackedProjects: [
      { taskId: 'project-with-assets', createdAt: 100, lastOpenedAt: 500 },
      { taskId: 'plain-task', createdAt: 120, lastOpenedAt: 400 }
    ]
  })

  assert.deepEqual(
    cards.map((card) => card.title),
    ['有图项目']
  )
})

test('listTaskDetailProjectSelectableAssets only includes output images and dedupes by file path', () => {
  const tasks = [
    {
      id: 'root-a',
      productName: 'Project A',
      status: 'completed',
      metadata: {
        projectId: 'project-a',
        projectRootTaskId: 'root-a',
        projectName: 'Project A'
      },
      createdAt: 100,
      updatedAt: 200
    },
    {
      id: 'child-a',
      productName: 'Child A',
      status: 'completed',
      metadata: {
        projectId: 'project-a',
        projectRootTaskId: 'root-a',
        projectName: 'Project A'
      },
      createdAt: 110,
      updatedAt: 210
    },
    {
      id: 'failed-a',
      productName: 'Failed A',
      status: 'failed',
      metadata: {
        projectId: 'project-a',
        projectRootTaskId: 'root-a',
        projectName: 'Project A'
      },
      createdAt: 120,
      updatedAt: 220
    }
  ]
  const assets = [
    {
      id: 'asset-a',
      taskId: 'root-a',
      kind: 'output',
      role: 'project-library-image',
      filePath: '/library/a.jpg',
      previewPath: '/library/a.jpg',
      createdAt: 100,
      updatedAt: 200,
      sortOrder: 0
    },
    {
      id: 'asset-b',
      taskId: 'child-a',
      kind: 'output',
      role: 'master-clean',
      filePath: '/library/b.png',
      previewPath: '/library/b.png',
      createdAt: 110,
      updatedAt: 210,
      sortOrder: 1
    },
    {
      id: 'asset-dup',
      taskId: 'child-a',
      kind: 'output',
      role: 'master-clean',
      filePath: '/library/a.jpg',
      previewPath: '/library/a.jpg',
      createdAt: 115,
      updatedAt: 215,
      sortOrder: 2
    },
    {
      id: 'asset-ref',
      taskId: 'root-a',
      kind: 'input',
      role: 'project-library-image',
      filePath: '/library/ref.jpg',
      previewPath: '/library/ref.jpg',
      createdAt: 116,
      updatedAt: 216,
      sortOrder: 3
    },
    {
      id: 'asset-failed',
      taskId: 'failed-a',
      kind: 'output',
      role: 'master-clean',
      filePath: '/library/failed.jpg',
      previewPath: '/library/failed.jpg',
      createdAt: 117,
      updatedAt: 217,
      sortOrder: 4
    },
    {
      id: 'asset-ignore',
      taskId: 'root-a',
      kind: 'input',
      role: 'project-library-image',
      filePath: '/library/c.mp4',
      previewPath: '/library/c.mp4',
      createdAt: 120,
      updatedAt: 220,
      sortOrder: 2
    }
  ]

  const result = listTaskDetailProjectSelectableAssets({
    projectId: 'project-a',
    rootTaskId: 'root-a',
    tasks,
    assets
  })

  assert.deepEqual(
    result.map((asset) => asset.id),
    ['asset-failed', 'asset-b', 'asset-a']
  )
})
