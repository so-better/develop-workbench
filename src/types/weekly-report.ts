import type { RichTextDelta } from './rich-text'

/**
 * 飞书个人工作周报。
 */
export interface WeeklyReportField {
  id: string
  title: string
  required: boolean
  component: string
  html: string
  text: string
}

export interface WeeklyReportState {
  ruleId: string
  ruleName: string
  ruleIconName: string
  reportId: string | null
  submitted: boolean
  submittedAt: number | null
  fields: WeeklyReportField[]
}


export interface SubmitWeeklyReportInput {
  ruleId: string
  fields: Array<{
    id: string
    html: string
    text: string
    delta: RichTextDelta
  }>
}


/** 周报自动提交状态。 */
export type WeeklyReportAutoState =
  | 'idle'
  | 'running'
  | 'submitted'
  | 'skipped'
  | 'failed'

/** 周报自动提交最近一次执行结果。 */
export interface WeeklyReportAutoStatus {
  state: WeeklyReportAutoState
  message: string | null
  /** 最近一次自动提交对应的周开始时间，用于避免跨周展示旧状态。 */
  weekStart: number | null
  /** 飞书结果通知发送失败原因。 */
  notificationError: string | null
  updatedAt: number | null
}
