import assert from 'node:assert/strict'
import test from 'node:test'

import { readWorkflowSourceDescriptor } from './aiStudioWorkflowSourceHelpers.ts'

test('readWorkflowSourceDescriptor prefers frozen workflow source inputs during master-stage retries', () => {
  assert.deepEqual(
    readWorkflowSourceDescriptor({
      primaryImagePath: '/tmp/draft-primary.png',
      referenceImagePaths: ['/tmp/draft-ref.png'],
      metadata: {
        workflow: {
          activeStage: 'master-selecting',
          sourcePrimaryImagePath: '/tmp/original-primary.png',
          sourceReferenceImagePaths: ['/tmp/original-ref-a.png', '/tmp/original-ref-b.png']
        }
      }
    }),
    {
      activeStage: 'master-selecting',
      currentAiMasterAssetId: null,
      sourcePrimaryImagePath: '/tmp/original-primary.png',
      sourceReferenceImagePaths: ['/tmp/original-ref-a.png', '/tmp/original-ref-b.png'],
      useCurrentAiMasterAsPrimary: false
    }
  )
})

test('readWorkflowSourceDescriptor still uses the selected ai master for child-stage generation', () => {
  assert.deepEqual(
    readWorkflowSourceDescriptor({
      primaryImagePath: '/tmp/draft-primary.png',
      referenceImagePaths: ['/tmp/draft-ref.png'],
      metadata: {
        workflow: {
          activeStage: 'child-ready',
          currentAiMasterAssetId: 'master-clean-1',
          sourcePrimaryImagePath: '/tmp/original-primary.png',
          sourceReferenceImagePaths: ['/tmp/original-ref.png']
        }
      }
    }),
    {
      activeStage: 'child-ready',
      currentAiMasterAssetId: 'master-clean-1',
      sourcePrimaryImagePath: '/tmp/original-primary.png',
      sourceReferenceImagePaths: ['/tmp/original-ref.png'],
      useCurrentAiMasterAsPrimary: true
    }
  )
})
