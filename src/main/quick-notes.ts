/**
 * 待办简记。
 * 数据保存在应用 userData 目录，不依赖渲染进程的 localStorage。
 */
import { app, ipcMain, Notification, powerMonitor } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getQuickNoteSummary } from '../utils'
import { backupCorruptStore } from './store-backup'
import { focusMainWindow, getMainWindow } from './window'
import type {
  QuickNote,
  QuickNoteReminder,
  QuickNoteState
} from '../types/quick-note'

const STORE_FILE = 'quick-notes.json'
const MAX_TEXT_LENGTH = 5000
const MAX_NOTES = 500
const REMINDER_LEAD_MS = 5 * 60 * 1000
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
    reminderSentAt
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

const markReminderSent = async (
  id: string,
  dueAt: string
): Promise<boolean> => {
  const key = getReminderKey(id, dueAt)

  const marked = await mutateNotes(async () => {
    const notes = await readNotes()
    const current = notes.find((item) => item.id === id)

    if (
      !current ||
      current.done ||
      !current.dueAt ||
      current.dueAt !== dueAt ||
      current.reminderSentAt
    ) {
      return false
    }

    const now = new Date().toISOString()

    await writeNotes(
      notes.map((item) =>
        item.id === id
          ? {
              ...item,
              reminderSentAt: now,
              updatedAt: now
            }
          : item
      )
    )

    return true
  })

  pendingReminders.delete(key)

  return marked
}

const attemptReminder = (note: QuickNote): void => {
  if (!note.dueAt) return

  const key = getReminderKey(note.id, note.dueAt)

  if (pendingReminders.has(key)) return

  const reminder: QuickNoteReminder = {
    id: note.id,
    text: getQuickNoteSummary(note.text, 120),
    dueAt: note.dueAt
  }

  pendingReminders.set(key, reminder)

  if (!Notification.isSupported()) {
    sendInAppReminder(reminder)
    return
  }

  let notification: Notification

  try {
    notification = new Notification({
      title: '待办即将截止',
      body: `${reminder.text}\n截止时间：${formatDueAt(reminder.dueAt)}`
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

    void markReminderSent(note.id, note.dueAt as string).catch((error) => {
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

const scheduleNextReminder = async (): Promise<void> => {
  clearReminderTimer()

  const notes = await readNotes()
  const now = Date.now()
  let nextAt = Number.POSITIVE_INFINITY

  for (const note of notes) {
    if (note.done || !note.dueAt || note.reminderSentAt) continue

    const dueAt = Date.parse(note.dueAt)

    if (!Number.isFinite(dueAt) || dueAt <= now) continue
    if (pendingReminders.has(getReminderKey(note.id, note.dueAt))) continue

    const triggerAt = dueAt - REMINDER_LEAD_MS

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
    if (note.done || !note.dueAt || note.reminderSentAt) continue

    const dueAt = Date.parse(note.dueAt)

    if (!Number.isFinite(dueAt) || dueAt <= now) continue
    if (dueAt - now > REMINDER_LEAD_MS) continue
    if (pendingReminders.has(getReminderKey(note.id, note.dueAt))) continue

    attemptReminder(note)
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
  dueValue: unknown
): Promise<boolean> => {
  const id = requireNoteId(idValue)
  const dueAt = parseDueAt(dueValue)

  if (!dueAt) return false

  return markReminderSent(id, dueAt)
}

export const addQuickNote = async (
  value: unknown,
  dueValue: unknown
): Promise<QuickNoteState> => {
  const text = normalizeText(value)
  const dueAt = parseDueAt(dueValue)

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
          reminderSentAt: null
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

export const setQuickNoteDueAt = async (
  idValue: unknown,
  dueValue: unknown
): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)
  const dueAt = parseDueAt(dueValue)

  const state = await mutateNotes(async () => {
    const notes = await readNotes()
    const now = new Date().toISOString()

    await writeNotes(
      notes.map((note) =>
        note.id === id
          ? {
              ...note,
              dueAt,
              reminderSentAt: note.dueAt === dueAt ? note.reminderSentAt : null,
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
  ipcMain.handle('quick-notes:add', (_event, text: unknown, dueAt: unknown) =>
    addQuickNote(text, dueAt)
  )
  ipcMain.handle(
    'quick-notes:set-done',
    (_event, id: unknown, done: unknown) => setQuickNoteDone(id, done)
  )
  ipcMain.handle(
    'quick-notes:set-due-at',
    (_event, id: unknown, dueAt: unknown) => setQuickNoteDueAt(id, dueAt)
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
