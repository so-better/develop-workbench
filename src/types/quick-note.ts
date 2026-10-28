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
}

/**
 * 待办简记的完整状态。
 */
export interface QuickNoteState {
  notes: QuickNote[]
}
