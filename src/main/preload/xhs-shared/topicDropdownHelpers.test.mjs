import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TOPIC_DROPDOWN_NODE_SELECTOR,
  isLikelyTopicDropdownContainerSignature,
  orderTopicDropdownCandidates
} from './topicDropdownHelpers.ts'

test('orderTopicDropdownCandidates prefers the popup whose content changed for the current topic', () => {
  const ordered = orderTopicDropdownCandidates(
    [
      {
        id: 'history-1',
        text: '#奶油风',
        containerId: 'history',
        domOrder: 1,
        rect: { top: 170, left: 110, width: 200, height: 32 }
      },
      {
        id: 'active-1',
        text: '#奶油风',
        containerId: 'active',
        domOrder: 20,
        rect: { top: 96, left: 120, width: 220, height: 32 }
      },
      {
        id: 'active-2',
        text: '#奶油风 装修',
        containerId: 'active',
        domOrder: 21,
        rect: { top: 128, left: 120, width: 240, height: 32 }
      }
    ],
    {
      baselineTextByContainerId: new Map([
        ['history', '#奶油风'],
        ['active', '#旧提示词']
      ])
    }
  )

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['active-1', 'active-2']
  )
})

test('orderTopicDropdownCandidates keeps popup items when the popup renders above the editor', () => {
  const ordered = orderTopicDropdownCandidates(
    [
      {
        id: 'active-1',
        text: '#奶油风',
        containerId: 'active',
        domOrder: 20,
        rect: { top: 96, left: 120, width: 220, height: 32 }
      },
      {
        id: 'active-2',
        text: '#奶油风 装修',
        containerId: 'active',
        domOrder: 21,
        rect: { top: 128, left: 120, width: 240, height: 32 }
      }
    ]
  )

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['active-1', 'active-2']
  )
})

test('orderTopicDropdownCandidates keeps the first real option ahead of later options', () => {
  const ordered = orderTopicDropdownCandidates(
    [
      {
        id: 'create',
        text: '新建话题 #奶油风',
        containerId: 'active',
        domOrder: 9,
        rect: { top: 246, left: 120, width: 210, height: 32 },
        isCreate: true
      },
      {
        id: 'first',
        text: '#奶油风 家居灵感灵感灵感',
        containerId: 'active',
        domOrder: 10,
        rect: { top: 278, left: 120, width: 280, height: 32 }
      },
      {
        id: 'second',
        text: '#奶油风',
        containerId: 'active',
        domOrder: 11,
        rect: { top: 274, left: 120, width: 180, height: 32 }
      }
    ]
  )

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['first', 'second']
  )
})

test('isLikelyTopicDropdownContainerSignature recognizes tippy dropdown wrappers', () => {
  assert.equal(
    isLikelyTopicDropdownContainerSignature({
      role: '',
      className: 'tippy-content',
      tagName: 'div',
      optionCount: 0,
      hasTippyRootAttr: false
    }),
    true
  )

  assert.equal(
    isLikelyTopicDropdownContainerSignature({
      role: '',
      className: '',
      tagName: 'div',
      optionCount: 0,
      hasTippyRootAttr: true
    }),
    true
  )

  assert.equal(
    isLikelyTopicDropdownContainerSignature({
      role: '',
      className: 'plain-wrapper',
      tagName: 'div',
      optionCount: 1,
      hasTippyRootAttr: false
    }),
    false
  )
})

test('TOPIC_DROPDOWN_NODE_SELECTOR includes tippy descendants for XHS smart-tag suggestions', () => {
  assert.equal(TOPIC_DROPDOWN_NODE_SELECTOR.includes('[data-tippy-root] *'), true)
  assert.equal(TOPIC_DROPDOWN_NODE_SELECTOR.includes('.tippy-content *'), true)
  assert.equal(TOPIC_DROPDOWN_NODE_SELECTOR.includes('.tippy-box *'), true)
})
