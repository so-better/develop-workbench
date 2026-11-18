import type { QuickNoteRecurrence } from '../types/quick-note'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const RECURRENCE_VALUES = new Set<QuickNoteRecurrence>([
  'none',
  'minutely',
  'hourly',
  'daily',
  'weekly',
  'monthly'
])

/** 校验重复规则是否合法。 */
export const isQuickNoteRecurrence = (
  value: unknown
): value is QuickNoteRecurrence =>
  typeof value === 'string' && RECURRENCE_VALUES.has(value as QuickNoteRecurrence)

/** 在保持本地时间的前提下退回一个重复周期。 */
const retreatRecurrence = (
  date: Date,
  recurrence: Exclude<QuickNoteRecurrence, 'none'>,
  recurrenceDay?: number | null
): void => {
  if (recurrence === 'minutely') {
    date.setMinutes(date.getMinutes() - 1)
    return
  }

  if (recurrence === 'hourly') {
    date.setHours(date.getHours() - 1)
    return
  }

  if (recurrence === 'daily') {
    date.setDate(date.getDate() - 1)
    return
  }

  if (recurrence === 'weekly') {
    date.setDate(date.getDate() - 7)
    return
  }

  const day = recurrenceDay ?? date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
}

/**
 * 计算下一次循环提醒时间。
 * 截止时间是最终期限；从最终期限向前回溯，取晚于 after 的最近一次提醒。
 */
export const getNextRecurringReminderAt = (
  dueAt: string,
  recurrence: QuickNoteRecurrence,
  recurrenceDay: number | null,
  after = Date.now()
): string | null => {
  if (recurrence === 'none') return null

  const due = new Date(dueAt)

  if (!Number.isFinite(due.getTime())) return null

  if (recurrence === 'minutely' || recurrence === 'hourly') {
    const interval = recurrence === 'minutely' ? 60_000 : 3_600_000
    const dueTime = due.getTime()

    if (dueTime <= after) return null

    const steps = Math.ceil((dueTime - after) / interval) - 1

    if (steps < 0) return null

    return new Date(dueTime - steps * interval).toISOString()
  }

  let occurrence = due
  let best: Date | null = null

  for (let index = 0; index < 10_000; index += 1) {
    if (occurrence.getTime() <= after) break

    best = new Date(occurrence)
    retreatRecurrence(occurrence, recurrence, recurrenceDay)
  }

  return best ? best.toISOString() : null
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** 格式化重复规则，例如“每周一 10:00”。 */
export const formatQuickNoteRecurrence = (
  recurrence: QuickNoteRecurrence,
  dueAt: string | null,
  recurrenceDay?: number | null
): string => {
  if (recurrence === 'none') return ''

  const date = dueAt ? new Date(dueAt) : null
  const valid = Boolean(date && Number.isFinite(date.getTime()))
  const time = valid
    ? `${pad(date!.getHours())}:${pad(date!.getMinutes())}`
    : ''

  if (recurrence === 'minutely') {
    return '每分钟'
  }

  if (recurrence === 'hourly') {
    return '每小时'
  }

  if (recurrence === 'daily') {
    return time ? `每天 ${time}` : '每天'
  }

  if (recurrence === 'weekly') {
    return valid
      ? `每周${WEEKDAY_LABELS[date!.getDay()]}${time ? ` ${time}` : ''}`
      : '每周'
  }

  const day = recurrenceDay ?? date?.getDate()

  return valid && day
    ? `每月${day}日${time ? ` ${time}` : ''}`
    : '每月'
}
