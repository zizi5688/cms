import assert from 'node:assert/strict'
import test from 'node:test'

import { buildScheduledTaskReorderPatches } from './scheduledTaskReorderHelpers.ts'

function createTasks() {
  return [
    { id: 'task-1', scheduledAt: new Date(2026, 2, 15, 7, 0, 0, 0).getTime() },
    { id: 'task-2', scheduledAt: new Date(2026, 2, 15, 8, 0, 0, 0).getTime() },
    { id: 'task-3', scheduledAt: new Date(2026, 2, 15, 9, 0, 0, 0).getTime() },
    { id: 'task-4', scheduledAt: new Date(2026, 2, 15, 10, 0, 0, 0).getTime() },
    { id: 'task-5', scheduledAt: new Date(2026, 2, 15, 11, 0, 0, 0).getTime() }
  ]
}

test('buildScheduledTaskReorderPatches inserts the dragged task before the target and reuses the existing slots', () => {
  const patches = buildScheduledTaskReorderPatches({
    tasks: createTasks(),
    activeTaskId: 'task-5',
    overTaskId: 'task-3',
    placement: 'before'
  })

  assert.deepEqual(
    patches.map((patch) => [patch.id, new Date(patch.scheduledAt).getHours()]),
    [
      ['task-1', 7],
      ['task-2', 8],
      ['task-5', 9],
      ['task-3', 10],
      ['task-4', 11]
    ]
  )
})

test('buildScheduledTaskReorderPatches inserts the dragged task after the target and shifts later tasks back', () => {
  const patches = buildScheduledTaskReorderPatches({
    tasks: createTasks(),
    activeTaskId: 'task-5',
    overTaskId: 'task-3',
    placement: 'after'
  })

  assert.deepEqual(
    patches.map((patch) => [patch.id, new Date(patch.scheduledAt).getHours()]),
    [
      ['task-1', 7],
      ['task-2', 8],
      ['task-3', 9],
      ['task-5', 10],
      ['task-4', 11]
    ]
  )
})

test('buildScheduledTaskReorderPatches returns no updates when the reorder input is invalid', () => {
  assert.deepEqual(
    buildScheduledTaskReorderPatches({
      tasks: createTasks(),
      activeTaskId: 'task-5',
      overTaskId: 'task-5',
      placement: 'before'
    }),
    []
  )

  assert.deepEqual(
    buildScheduledTaskReorderPatches({
      tasks: [{ id: 'task-1', scheduledAt: null }, { id: 'task-2', scheduledAt: 1 }],
      activeTaskId: 'task-1',
      overTaskId: 'task-2',
      placement: 'before'
    }),
    []
  )
})
