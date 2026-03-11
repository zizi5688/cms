import assert from 'node:assert/strict'
import test from 'node:test'

import { computePreviewTargetCount, prepareWorkflowForMasterRun } from './workflowRunHelpers.ts'

test('prepareWorkflowForMasterRun synchronizes child requested count with the requested output count', () => {
  const workflow = {
    workflow: {
      activeStage: 'master-setup',
      sourcePrimaryImagePath: null,
      sourceReferenceImagePaths: [],
      currentAiMasterAssetId: 'old-master',
      currentItemKind: 'idle',
      currentItemIndex: 3,
      currentItemTotal: 4,
      failures: [{ stageKind: 'child-generate', sequenceIndex: 4, message: 'old failure' }]
    },
    masterStage: {
      templateId: 'template-a',
      promptExtra: 'old prompt',
      requestedCount: 3,
      completedCount: 2,
      cleanSuccessCount: 2,
      cleanFailedCount: 1
    },
    childStage: {
      templateId: 'template-b',
      promptExtra: 'old child prompt',
      requestedCount: 4,
      completedCount: 4,
      failedCount: 1,
      variantLines: ['v1', 'v2', 'v3', 'v4']
    }
  }

  const next = prepareWorkflowForMasterRun(workflow, {
    promptText: 'new prompt',
    templateId: null,
    requestedCount: 5,
    primaryImagePath: '/tmp/source.png',
    referenceImagePaths: ['/tmp/ref-b.png', '/tmp/ref-a.png', '/tmp/ref-b.png']
  })

  assert.equal(next.masterStage.requestedCount, 5)
  assert.equal(next.childStage.requestedCount, 5)
  assert.equal(next.workflow.currentItemTotal, 5)
  assert.equal(next.workflow.currentAiMasterAssetId, null)
  assert.deepEqual(next.workflow.sourceReferenceImagePaths, ['/tmp/ref-b.png', '/tmp/ref-a.png'])
  assert.deepEqual(next.workflow.failures, [])
})

test('computePreviewTargetCount does not cap previews at four when more outputs are expected', () => {
  assert.equal(
    computePreviewTargetCount({
      isRunning: false,
      currentItemTotal: 5,
      expectedOutputCount: 5,
      generatedCount: 4,
      maxFailureIndex: 0
    }),
    5
  )
})
