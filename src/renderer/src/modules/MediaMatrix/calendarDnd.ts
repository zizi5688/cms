export const calendarDndTypes = {
  UNSCHEDULED_TASK: 'UNSCHEDULED_TASK',
  SCHEDULED_TASK: 'SCHEDULED_TASK'
} as const

export type UnscheduledTaskDragItem = {
  type: typeof calendarDndTypes.UNSCHEDULED_TASK
  task: CmsPublishTask
  batchIds: string[]
  batchTasks: CmsPublishTask[]
}

export type ScheduledTaskDragItem = {
  type: typeof calendarDndTypes.SCHEDULED_TASK
  task: CmsPublishTask
}

export type CalendarDragItem = UnscheduledTaskDragItem | ScheduledTaskDragItem
