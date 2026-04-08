import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getVisibleSidebarMenuItems,
  getVisibleSidebarModuleOrder
} from './sidebarNavigation.ts'

test('sidebar navigation only exposes visible workbench and reporting entries', () => {
  assert.deepEqual(
    getVisibleSidebarMenuItems().map((item) => ({
      id: item.id,
      label: item.label
    })),
    [
      { id: 'aiStudio', label: '素材工作台' },
      { id: 'autopublish', label: '发布工作台' },
      { id: 'raceboard', label: '数据赛马场' },
      { id: 'heatboard', label: '热度看板' }
    ]
  )
})

test('visible module order excludes hidden material and workshop entries', () => {
  assert.deepEqual(getVisibleSidebarModuleOrder(), [
    'aiStudio',
    'autopublish',
    'raceboard',
    'heatboard',
    'settings'
  ])
})
