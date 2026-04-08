import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
  buildProjectAssetFavoriteUpsert,
  buildProjectAssetLibraryUpserts,
  listProjectAssetLibrary
} from './projectAssetLibraryHelpers.ts'

test('listProjectAssetLibrary only returns assets from the current project library', () => {
  const assets = [
    {
      id: 'project-a-1',
      taskId: 'project-a',
      role: AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
      filePath: '/tmp/project-a-1.png',
      createdAt: 10
    },
    {
      id: 'project-a-input',
      taskId: 'project-a',
      role: 'source-reference',
      filePath: '/tmp/project-a-input.png',
      createdAt: 20
    },
    {
      id: 'project-b-1',
      taskId: 'project-b',
      role: AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
      filePath: '/tmp/project-b-1.png',
      createdAt: 30
    },
    {
      id: 'project-a-2',
      taskId: 'project-a',
      role: AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
      filePath: '/tmp/project-a-2.png',
      createdAt: 40
    }
  ]

  assert.deepEqual(
    listProjectAssetLibrary({
      projectTaskId: 'project-a',
      assets
    }).map((asset) => asset.id),
    ['project-a-2', 'project-a-1']
  )
})

test('buildProjectAssetLibraryUpserts only creates new unique image assets for the project', () => {
  const existingAssets = [
    {
      id: 'existing-a',
      taskId: 'project-a',
      role: AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
      filePath: '/tmp/already-there.png'
    }
  ]

  const writes = buildProjectAssetLibraryUpserts({
    projectTaskId: 'project-a',
    filePaths: [
      '/tmp/already-there.png',
      '/tmp/new-image.png',
      '/tmp/new-image.png',
      '/tmp/not-supported.txt',
      ''
    ],
    existingAssets,
    now: 123
  })

  assert.equal(writes.length, 1)
  assert.equal(writes[0].taskId, 'project-a')
  assert.equal(writes[0].role, AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE)
  assert.equal(writes[0].filePath, '/tmp/new-image.png')
  assert.equal(writes[0].previewPath, '/tmp/new-image.png')
  assert.equal(writes[0].originPath, '/tmp/new-image.png')
  assert.equal(writes[0].metadata.importedAt, 123)
})

test('buildProjectAssetFavoriteUpsert reuses an existing project asset and marks it favorite', () => {
  const write = buildProjectAssetFavoriteUpsert({
    projectTaskId: 'project-a',
    asset: {
      id: 'output-1',
      taskId: 'task-1',
      filePath: '/tmp/favorite-me.png',
      previewPath: '/tmp/favorite-me-preview.png',
      originPath: '/tmp/favorite-me-origin.png'
    },
    existingAssets: [
      {
        id: 'existing-library-asset',
        taskId: 'project-a',
        role: AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE,
        filePath: '/tmp/favorite-me.png',
        previewPath: '/tmp/existing-preview.png',
        originPath: '/tmp/existing-origin.png',
        metadata: { importedAt: 12 }
      }
    ],
    now: 456
  })

  assert.equal(write.id, 'existing-library-asset')
  assert.equal(write.taskId, 'project-a')
  assert.equal(write.role, AI_STUDIO_PROJECT_LIBRARY_IMAGE_ROLE)
  assert.equal(write.filePath, '/tmp/favorite-me.png')
  assert.equal(write.previewPath, '/tmp/favorite-me-preview.png')
  assert.equal(write.originPath, '/tmp/favorite-me-origin.png')
  assert.equal(write.metadata.importedAt, 12)
  assert.equal(write.metadata.favorite, true)
})
