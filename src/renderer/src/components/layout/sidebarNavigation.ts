import type { SidebarItemKey } from './Sidebar'

export type SidebarMenuItem = {
  id: SidebarItemKey
  icon: 'ChartColumnBig' | 'Rocket' | 'Sparkles' | 'Trophy'
  label: string
}

const VISIBLE_SIDEBAR_MENU_ITEMS: SidebarMenuItem[] = [
  { id: 'aiStudio', icon: 'Sparkles', label: '素材工作台' },
  { id: 'autopublish', icon: 'Rocket', label: '发布工作台' },
  { id: 'raceboard', icon: 'Trophy', label: '数据赛马场' },
  { id: 'heatboard', icon: 'ChartColumnBig', label: '热度看板' }
]

const VISIBLE_SIDEBAR_MODULE_ORDER: SidebarItemKey[] = [
  'aiStudio',
  'autopublish',
  'raceboard',
  'heatboard',
  'settings'
]

export function getVisibleSidebarMenuItems(): SidebarMenuItem[] {
  return VISIBLE_SIDEBAR_MENU_ITEMS
}

export function getVisibleSidebarModuleOrder(): SidebarItemKey[] {
  return VISIBLE_SIDEBAR_MODULE_ORDER
}
