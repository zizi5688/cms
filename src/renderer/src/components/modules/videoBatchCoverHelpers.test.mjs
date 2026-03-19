import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyBatchCoverPathsToVideoTasks,
  sortCoverImagePathsByNaturalFilename
} from './videoBatchCoverHelpers.ts'

test('sortCoverImagePathsByNaturalFilename sorts filenames in natural order', () => {
  const result = sortCoverImagePathsByNaturalFilename([
    '/tmp/cover-10.jpg',
    '/tmp/cover-2.jpg',
    '/tmp/cover-1.jpg'
  ])

  assert.deepEqual(result, ['/tmp/cover-1.jpg', '/tmp/cover-2.jpg', '/tmp/cover-10.jpg'])
})

test('applyBatchCoverPathsToVideoTasks overrides only the first matching preview tasks when covers are fewer', () => {
  const tasks = [
    { id: 'v1', mediaType: 'video', assignedImages: ['/covers/default-1.jpg'] },
    { id: 'v2', mediaType: 'video', assignedImages: ['/covers/default-2.jpg'] },
    { id: 'v3', mediaType: 'video', assignedImages: ['/covers/default-3.jpg'] }
  ]

  const result = applyBatchCoverPathsToVideoTasks(tasks, ['/tmp/cover-1.jpg', '/tmp/cover-2.jpg'])

  assert.equal(result.appliedCount, 2)
  assert.deepEqual(
    result.tasks.map((task) => task.assignedImages),
    [['/tmp/cover-1.jpg'], ['/tmp/cover-2.jpg'], ['/covers/default-3.jpg']]
  )
})

test('applyBatchCoverPathsToVideoTasks overrides each preview task one-to-one when counts match', () => {
  const tasks = [
    { id: 'v1', mediaType: 'video', assignedImages: ['/covers/default-1.jpg'] },
    { id: 'v2', mediaType: 'video', assignedImages: ['/covers/default-2.jpg'] }
  ]

  const result = applyBatchCoverPathsToVideoTasks(tasks, ['/tmp/cover-1.jpg', '/tmp/cover-2.jpg'])

  assert.equal(result.appliedCount, 2)
  assert.deepEqual(
    result.tasks.map((task) => task.assignedImages),
    [['/tmp/cover-1.jpg'], ['/tmp/cover-2.jpg']]
  )
})

test('applyBatchCoverPathsToVideoTasks ignores extra covers when there are more covers than preview tasks', () => {
  const tasks = [
    { id: 'v1', mediaType: 'video', assignedImages: ['/covers/default-1.jpg'] },
    { id: 'v2', mediaType: 'video', assignedImages: ['/covers/default-2.jpg'] }
  ]

  const result = applyBatchCoverPathsToVideoTasks(tasks, [
    '/tmp/cover-1.jpg',
    '/tmp/cover-2.jpg',
    '/tmp/cover-3.jpg'
  ])

  assert.equal(result.appliedCount, 2)
  assert.deepEqual(
    result.tasks.map((task) => task.assignedImages),
    [['/tmp/cover-1.jpg'], ['/tmp/cover-2.jpg']]
  )
})

test('applyBatchCoverPathsToVideoTasks preserves non-video tasks while mapping covers in video order', () => {
  const imageTask = { id: 'i1', mediaType: 'image', assignedImages: ['/images/original.jpg'] }
  const videoTaskA = { id: 'v1', mediaType: 'video', assignedImages: ['/covers/default-1.jpg'] }
  const videoTaskB = { id: 'v2', mediaType: 'video', assignedImages: ['/covers/default-2.jpg'] }

  const result = applyBatchCoverPathsToVideoTasks([imageTask, videoTaskA, videoTaskB], [
    '/tmp/cover-1.jpg',
    '/tmp/cover-2.jpg'
  ])

  assert.equal(result.tasks[0], imageTask)
  assert.deepEqual(result.tasks[1]?.assignedImages, ['/tmp/cover-1.jpg'])
  assert.deepEqual(result.tasks[2]?.assignedImages, ['/tmp/cover-2.jpg'])
})
