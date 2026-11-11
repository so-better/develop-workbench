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
  reminderSentAt: string | null
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
  dueAt: string
}
