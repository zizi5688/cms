import assert from 'node:assert/strict'
import test from 'node:test'

import { findAbandonedPreSubmitTaskIds } from './staleTaskRecoveryHelpers.ts'

test('findAbandonedPreSubmitTaskIds returns only running tasks abandoned before this session', () => {
  assert.deepEqual(
    findAbandonedPreSubmitTaskIds(
      [
        {
          id: 'stale-image-task',
          status: 'running',
          latestRunId: null,
          remoteTaskId: null,
          updatedAt: 1_000
        },
        {
          id: 'current-session-task',
          status: 'running',
          latestRunId: null,
          remoteTaskId: null,
          updatedAt: 9_000
        },
        {
          id: 'submitted-task',
          status: 'running',
          latestRunId: 'run-1',
          remoteTaskId: 'remote-1',
          updatedAt: 1_500
        },
        {
          id: 'finished-task',
          status: 'failed',
          latestRunId: null,
          remoteTaskId: null,
          updatedAt: 500
        }
      ],
      5_000
    ),
    ['stale-image-task']
  )
})
