/**
 * 待办简记。
 * 数据保存在应用 userData 目录，不依赖渲染进程的 localStorage。
 */
import { app, ipcMain, Notification, powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getQuickNoteSummary } from '../utils'
import {
  formatQuickNoteRecurrence,
  getNextRecurringReminderAt,
  isQuickNoteRecurrence
} from '../utils/quick-note-recurrence'
import { backupCorruptStore } from './store-backup'
import { focusMainWindow, getMainWindow } from './window'
import type {
  QuickNote,
  QuickNoteRecurrence,
  QuickNoteReminder,
  QuickNoteState
} from '../types/quick-note'

const STORE_FILE = 'quick-notes.json'
const MAX_TEXT_LENGTH = 5000
const MAX_NOTES = 500
const REMINDER_LEAD_MS = 5 * 60 * 1000
const MINUTELY_REMINDER_LEAD_MS = 30 * 1000
const IMMEDIATE_REMINDER_WINDOW_MS = 60 * 1000
const MAX_TIMEOUT_MS = 2_147_000_000

const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

/** 待办保留 Markdown 换行和缩进，只统一换行符并去除首尾空白。 */
const normalizeText = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .trim()
        .slice(0, MAX_TEXT_LENGTH)
    : ''

const normalizeStoredTimestamp = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null

  const timestamp = Date.parse(value)

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

const parseDueAt = (value: unknown): string | null => {
  if (value === null || value === undefined) return null

  if (typeof value !== 'string') {
    throw new Error('截止时间不合法')
  }

  if (!value.trim()) return null

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    throw new Error('截止时间不合法')
  }

  return new Date(timestamp).toISOString()
}

/** 校验并规范化重复规则；没有截止时间时不重复。 */
const parseRecurrence = (
  value: unknown,
  dueAt: string | null
): QuickNoteRecurrence => {
  if (!dueAt || !isQuickNoteRecurrence(value)) return 'none'

  return value
}

const formatDueAt = (value: string): string => {
  const date = new Date(value)
  const pad = (input: number): string => String(input).padStart(2, '0')

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

const normalizeStoredNote = (value: unknown): QuickNote | null => {
  if (!value || typeof value !== 'object') return null

  const note = value as Record<string, unknown>
  const text = normalizeText(note.text)
  const dueAt = normalizeStoredTimestamp(note.dueAt)
  const reminderSentAt = dueAt
    ? normalizeStoredTimestamp(note.reminderSentAt)
    : null
  const recurrence = dueAt && isQuickNoteRecurrence(note.recurrence)
    ? note.recurrence
    : 'none'
  const storedRecurrenceDay =
    typeof note.recurrenceDay === 'number' &&
    Number.isInteger(note.recurrenceDay) &&
    note.recurrenceDay >= 1 &&
    note.recurrenceDay <= 31
      ? note.recurrenceDay
      : null
  const recurrenceDay =
    recurrence === 'monthly' && dueAt
      ? storedRecurrenceDay ?? new Date(dueAt).getDate()
      : null

  if (
    typeof note.id !== 'string' ||
    !note.id ||
    !text ||
    typeof note.done !== 'boolean' ||
    typeof note.createdAt !== 'string' ||
    typeof note.updatedAt !== 'string' ||
    (note.completedAt !== null && typeof note.completedAt !== 'string')
  ) {
    return null
  }

  return {
    id: note.id,
    text,
    done: note.done,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    completedAt: note.completedAt,
    dueAt,
    reminderSentAt,
    recurrence,
    recurrenceDay
  }
}

const readNotes = async (): Promise<QuickNote[]> => {
  let raw: string

  try {
    raw = await readFile(getStorePath(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  try {
    const parsed = JSON.parse(raw) as { notes?: unknown }

    if (!Array.isArray(parsed.notes)) {
      await backupCorruptStore(getStorePath())
      return []
    }

    return parsed.notes
      .map(normalizeStoredNote)
      .filter((note): note is QuickNote => Boolean(note))
  } catch {
    await backupCorruptStore(getStorePath())
    return []
  }
}

const writeNotes = async (notes: QuickNote[]): Promise<void> => {
  const filePath = getStorePath()
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`

  await writeFile(temporaryPath, JSON.stringify({ notes }, null, 2), 'utf8')
  await rename(temporaryPath, filePath)
}

const getQuickNoteState = async (): Promise<QuickNoteState> => ({
  notes: await readNotes()
})

/** 串行化写操作，避免快速切换/删除时互相覆盖。 */
let mutationQueue: Promise<void> = Promise.resolve()

const mutateNotes = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = mutationQueue.then(operation, operation)

  mutationQueue = result.then(
    () => undefined,
    () => undefined
  )

  return result
}

const requireNoteId = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('待办 ID 不合法')
  }

  return value
}

let reminderTimer: ReturnType<typeof setTimeout> | null = null
let reminderTask: Promise<void> = Promise.resolve()
const activeNotifications = new Set<Notification>()
const pendingReminders = new Map<string, QuickNoteReminder>()

const getReminderKey = (id: string, dueAt: string): string => `${id}|${dueAt}`

const clearPendingRemindersForNote = (id: string): void => {
  const prefix = `${id}|`

  for (const key of pendingReminders.keys()) {
    if (key.startsWith(prefix)) pendingReminders.delete(key)
  }
}

const prunePendingReminders = (notes: QuickNote[]): void => {
  const ids = new Set(notes.map((note) => note.id))

  for (const [key, reminder] of pendingReminders) {
    if (!ids.has(reminder.id)) pendingReminders.delete(key)
  }
}

const clearReminderTimer = (): void => {
  if (!reminderTimer) return

  clearTimeout(reminderTimer)
  reminderTimer = null
}

const sendInAppReminder = (reminder: QuickNoteReminder): void => {
  const window = getMainWindow()

  if (
    !window ||
    window.isDestroyed() ||
    window.webContents.isDestroyed()
  ) {
    return
  }

  try {
    window.webContents.send('quick-notes:reminder', reminder)
  } catch (error) {
    console.warn('发送应用内待办提醒失败：', error)
  }
}

const flushPendingReminders = (): void => {
  for (const reminder of pendingReminders.values()) {
    sendInAppReminder(reminder)
  }
}

/** 记录某次循环提醒已发送，并重新安排下一次提醒。 */
const markReminderSent = async (
  id: string,
  occurrenceValue: string
): Promise<boolean> => {
  const occurrence = normalizeStoredTimestamp(occurrenceValue)

  if (!occurrence) return false

  const key = getReminderKey(id, occurrence)
  const occurrenceTime = Date.parse(occurrence)

  const marked = await mutateNotes(async () => {
    const notes = await readNotes()
    const current = notes.find((item) => item.id === id)

    if (
      !current ||
      current.done ||
      !current.dueAt ||
      current.reminderSentAt === occurrence ||
      occurrenceTime > Date.parse(current.dueAt)
    ) {
      return false
    }

    const now = new Date().toISOString()

    await writeNotes(
      notes.map((item) =>
        item.id === id
          ? {
              ...item,
              reminderSentAt: occurrence,
              updatedAt: now
            }
          : item
      )
    )

    return true
  })

  pendingReminders.delete(key)

  if (marked) queueReminderCheck()

  return marked
}

const attemptReminder = (note: QuickNote, occurrenceAt: string): void => {
  if (!note.dueAt) return

  const key = getReminderKey(note.id, occurrenceAt)

  if (pendingReminders.has(key)) return

  const reminder: QuickNoteReminder = {
    id: note.id,
    text: getQuickNoteSummary(note.text, 120),
    dueAt: note.dueAt,
    occurrenceAt,
    recurrence: note.recurrence,
    recurrenceDay: note.recurrenceDay
  }
  const recurrenceLabel = formatQuickNoteRecurrence(
    note.recurrence,
    note.dueAt,
    note.recurrenceDay
  )

  pendingReminders.set(key, reminder)

  if (!Notification.isSupported()) {
    sendInAppReminder(reminder)
    return
  }

  let notification: Notification

  try {
    notification = new Notification({
      title: recurrenceLabel ? '循环待办提醒' : '待办即将截止',
      body: recurrenceLabel
        ? `${reminder.text}\n${recurrenceLabel}\n提醒时间：${formatDueAt(
            occurrenceAt
          )}\n最终截止：${formatDueAt(reminder.dueAt)}`
        : `${reminder.text}\n截止时间：${formatDueAt(reminder.dueAt)}`
    })
  } catch (error) {
    console.warn('发送待办通知失败，改用应用内提醒：', error)
    sendInAppReminder(reminder)
    return
  }

  let settled = false
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  const release = (): void => {
    activeNotifications.delete(notification)
  }

  const fail = (): void => {
    if (settled) return

    settled = true

    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }

    release()

    try {
      notification.close()
    } catch {
      // 通知可能已经关闭。
    }

    sendInAppReminder(reminder)
  }

  const success = (): void => {
    if (settled) return

    settled = true

    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }

    void markReminderSent(note.id, occurrenceAt).catch((error) => {
      console.warn('记录待办提醒状态失败，改用应用内提醒：', error)
      sendInAppReminder(reminder)
    })
  }

  notification.once('show', success)
  notification.once('failed', fail)
  notification.on('click', () => {
    release()
    focusMainWindow()

    const window = getMainWindow()

    if (window && !window.isDestroyed()) {
      window.webContents.send('quick-notes:open')
    }
  })
  notification.once('close', release)

  const cleanupTimer = setTimeout(release, 10 * 60 * 1000)
  cleanupTimer.unref?.()

  activeNotifications.add(notification)
  fallbackTimer = setTimeout(fail, 6_000)
  fallbackTimer.unref?.()

  try {
    notification.show()
  } catch (error) {
    console.warn('发送待办通知失败，改用应用内提醒：', error)
    fail()
  }
}

/** 分钟级提醒使用更短的前置时间，避免同一提醒窗口覆盖多个周期。 */
const getReminderLeadMs = (recurrence: QuickNoteRecurrence): number =>
  recurrence === 'minutely' ? MINUTELY_REMINDER_LEAD_MS : REMINDER_LEAD_MS

/**
 * 新建循环待办时，如果下一次提醒会在一分钟内触发，则跳过当前周期。
 * 最后一次提醒（最终截止时间）不跳过，避免临近截止时完全没有提醒。
 */
const getInitialReminderSentAt = (
  dueAt: string | null,
  recurrence: QuickNoteRecurrence,
  recurrenceDay: number | null
): string | null => {
  if (!dueAt || recurrence === 'none') return null

  const now = Date.now()
  const occurrence = getNextRecurringReminderAt(
    dueAt,
    recurrence,
    recurrenceDay,
    now
  )

  if (!occurrence) return null

  const nextAfter = getNextRecurringReminderAt(
    dueAt,
    recurrence,
    recurrenceDay,
    Date.parse(occurrence)
  )

  if (!nextAfter) return null

  const triggerAt = Date.parse(occurrence) - getReminderLeadMs(recurrence)

  return triggerAt - now <= IMMEDIATE_REMINDER_WINDOW_MS ? occurrence : null
}

/** 计算下一条待办提醒；循环待办从最终截止时间向前回溯。 */
const getNextReminder = (
  note: QuickNote,
  now: number
): { at: number; occurrence: string } | null => {
  if (!note.dueAt) return null

  if (note.recurrence === 'none') {
    if (note.reminderSentAt) return null

    const dueAt = Date.parse(note.dueAt)

    if (!Number.isFinite(dueAt) || dueAt <= now) return null

    return { at: dueAt, occurrence: note.dueAt }
  }

  const last = note.reminderSentAt ? Date.parse(note.reminderSentAt) : 0
  const after = Math.max(now, Number.isFinite(last) ? last : 0)
  const occurrence = getNextRecurringReminderAt(
    note.dueAt,
    note.recurrence,
    note.recurrenceDay,
    after
  )

  if (!occurrence) return null

  const at = Date.parse(occurrence)

  return Number.isFinite(at) ? { at, occurrence } : null
}

const scheduleNextReminder = async (): Promise<void> => {
  clearReminderTimer()

  const notes = await readNotes()
  const now = Date.now()
  let nextAt = Number.POSITIVE_INFINITY

  for (const note of notes) {
    if (note.done) continue

    const next = getNextReminder(note, now)

    if (!next) continue
    if (pendingReminders.has(getReminderKey(note.id, next.occurrence))) continue

    const triggerAt = next.at - getReminderLeadMs(note.recurrence)

    if (triggerAt <= now) {
      nextAt = now
      break
    }

    nextAt = Math.min(nextAt, triggerAt)
  }

  if (!Number.isFinite(nextAt)) return

  const delay = Math.max(0, Math.min(nextAt - now, MAX_TIMEOUT_MS))

  reminderTimer = setTimeout(() => {
    reminderTimer = null
    queueReminderCheck()
  }, delay)
}

const runReminderCheck = async (): Promise<void> => {
  clearReminderTimer()

  const notes = await readNotes()
  const now = Date.now()

  for (const note of notes) {
    if (note.done) continue

    const next = getNextReminder(note, now)

    if (!next) continue
    if (next.at - now > getReminderLeadMs(note.recurrence)) continue
    if (pendingReminders.has(getReminderKey(note.id, next.occurrence))) continue

    attemptReminder(note, next.occurrence)
  }

  await scheduleNextReminder()
}

const queueReminderCheck = (): void => {
  reminderTask = reminderTask
    .then(runReminderCheck, runReminderCheck)
    .catch((error) => {
      console.warn('检查待办提醒失败：', error)
      void scheduleNextReminder().catch((scheduleError) => {
        console.warn('重新安排待办提醒失败：', scheduleError)
      })
    })
}

export const acknowledgeQuickNoteReminder = async (
  idValue: unknown,
  occurrenceValue: unknown
): Promise<boolean> => {
  const id = requireNoteId(idValue)
  const occurrence = normalizeStoredTimestamp(occurrenceValue)

  if (!occurrence) return false

  return markReminderSent(id, occurrence)
}

export const addQuickNote = async (
  value: unknown,
  dueValue: unknown,
  recurrenceValue: unknown
): Promise<QuickNoteState> => {
  const text = normalizeText(value)
  const dueAt = parseDueAt(dueValue)
  const recurrence = parseRecurrence(recurrenceValue, dueAt)
  const recurrenceDay =
    recurrence === 'monthly' && dueAt ? new Date(dueAt).getDate() : null
  const reminderSentAt = getInitialReminderSentAt(
    dueAt,
    recurrence,
    recurrenceDay
  )

  if (!text) throw new Error('待办内容不能为空')

  const state = await mutateNotes(async () => {
    const now = new Date().toISOString()
    const notes = await readNotes()

    await writeNotes(
      [
        {
          id: randomUUID(),
          text,
          done: false,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          dueAt,
          reminderSentAt,
          recurrence,
          recurrenceDay
        },
        ...notes
      ].slice(0, MAX_NOTES)
    )

    return getQuickNoteState()
  })

  queueReminderCheck()

  return state
}

export const setQuickNoteDone = async (
  idValue: unknown,
  doneValue: unknown
): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)

  if (typeof doneValue !== 'boolean') {
    throw new Error('待办状态不合法')
  }

  const state = await mutateNotes(async () => {
    const notes = await readNotes()
    const now = new Date().toISOString()

    await writeNotes(
      notes.map((note) =>
        note.id === id
          ? {
              ...note,
              done: doneValue,
              completedAt: doneValue ? now : null,
              updatedAt: now
            }
          : note
      )
    )

    return getQuickNoteState()
  })

  clearPendingRemindersForNote(id)
  queueReminderCheck()

  return state
}

export const updateQuickNoteText = async (
  idValue: unknown,
  textValue: unknown
): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)
  const text = normalizeText(textValue)

  if (!text) throw new Error('待办内容不能为空')

  const state = await mutateNotes(async () => {
    const notes = await readNotes()
    const now = new Date().toISOString()
    let found = false

    const next = notes.map((note) => {
      if (note.id !== id) return note

      found = true
      return {
        ...note,
        text,
        updatedAt: now
      }
    })

    if (!found) throw new Error('待办不存在')

    await writeNotes(next)

    return getQuickNoteState()
  })

  // 已有待发送提醒时同步正文，避免通知里仍是旧内容。
  for (const [key, reminder] of pendingReminders) {
    if (reminder.id === id) {
      pendingReminders.set(key, {
        ...reminder,
        text: getQuickNoteSummary(text, 120)
      })
    }
  }

  return state
}

export const setQuickNoteDueAt = async (
  idValue: unknown,
  dueValue: unknown,
  recurrenceValue: unknown
): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)
  const dueAt = parseDueAt(dueValue)
  const recurrence = parseRecurrence(recurrenceValue, dueAt)
  const recurrenceDay =
    recurrence === 'monthly' && dueAt ? new Date(dueAt).getDate() : null

  const state = await mutateNotes(async () => {
    const notes = await readNotes()
    const now = new Date().toISOString()

    await writeNotes(
      notes.map((note) =>
        note.id === id
          ? {
              ...note,
              dueAt,
              recurrence,
              recurrenceDay,
              reminderSentAt:
                note.dueAt === dueAt &&
                note.recurrence === recurrence &&
                note.recurrenceDay === recurrenceDay
                  ? note.reminderSentAt
                  : null,
              updatedAt: now
            }
          : note
      )
    )

    return getQuickNoteState()
  })

  clearPendingRemindersForNote(id)
  queueReminderCheck()

  return state
}

export const removeQuickNote = async (idValue: unknown): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)

  const state = await mutateNotes(async () => {
    await writeNotes((await readNotes()).filter((note) => note.id !== id))

    return getQuickNoteState()
  })

  clearPendingRemindersForNote(id)
  queueReminderCheck()

  return state
}

export const clearCompletedQuickNotes = async (): Promise<QuickNoteState> => {
  const state = await mutateNotes(async () => {
    await writeNotes((await readNotes()).filter((note) => !note.done))

    return getQuickNoteState()
  })

  prunePendingReminders(state.notes)
  queueReminderCheck()

  return state
}

/**
 * 注册待办简记 IPC。
 */
export const initializeQuickNotes = (): void => {
  ipcMain.handle('quick-notes:get-state', () => getQuickNoteState())
  ipcMain.handle(
    'quick-notes:add',
    (_event, text: unknown, dueAt: unknown, recurrence: unknown) =>
      addQuickNote(text, dueAt, recurrence)
  )
  ipcMain.handle(
    'quick-notes:set-done',
    (_event, id: unknown, done: unknown) => setQuickNoteDone(id, done)
  )
  ipcMain.handle(
    'quick-notes:update-text',
    (_event, id: unknown, text: unknown) => updateQuickNoteText(id, text)
  )
  ipcMain.handle(
    'quick-notes:set-due-at',
    (_event, id: unknown, dueAt: unknown, recurrence: unknown) =>
      setQuickNoteDueAt(id, dueAt, recurrence)
  )
  ipcMain.handle('quick-notes:remove', (_event, id: unknown) => removeQuickNote(id))
  ipcMain.handle('quick-notes:clear-completed', () => clearCompletedQuickNotes())
  ipcMain.handle('quick-notes:ack-reminder', (_event, id: unknown, dueAt: unknown) =>
    acknowledgeQuickNoteReminder(id, dueAt)
  )
  ipcMain.handle('quick-notes:renderer-ready', () => {
    flushPendingReminders()
    return true
  })

  powerMonitor.on('resume', queueReminderCheck)
  powerMonitor.on('unlock-screen', queueReminderCheck)
  queueReminderCheck()
}
