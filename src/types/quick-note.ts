/**
 * 待办重复规则。
 */
export type QuickNoteRecurrence =
  | 'none'
  | 'minutely'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'

/**
 * 单条待办简记。
 */
export interface QuickNote {
  id: string
  text: string
  done: boolean
  createdAt: string
  updatedAt: string
  completedAt: string | null
  dueAt: string | null
  /** 最近一次已提醒的循环时间；非循环待办为截止时间。 */
  reminderSentAt: string | null
  recurrence: QuickNoteRecurrence
  /** 每月重复时保留的日期（1-31），避免月末日期漂移。 */
  recurrenceDay: number | null
}

/**
 * 待办简记的完整状态。
 */
export interface QuickNoteState {
  notes: QuickNote[]
}

/**
 * 主进程无法发送系统通知时转发的应用内提醒。
 */
export interface QuickNoteReminder {
  id: string
  text: string
  /** 最终截止时间。 */
  dueAt: string
  /** 本次提醒对应的循环时间；非循环待办等于最终截止时间。 */
  occurrenceAt: string
  recurrence: QuickNoteRecurrence
  recurrenceDay: number | null
}
