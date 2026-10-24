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
