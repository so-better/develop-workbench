/**
 * 待办简记。
 * 数据保存在应用 userData 目录，不依赖渲染进程的 localStorage。
 */
import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupCorruptStore } from './store-backup'
import type { QuickNote, QuickNoteState } from '../types/quick-note'

const STORE_FILE = 'quick-notes.json'
const MAX_TEXT_LENGTH = 200
const MAX_NOTES = 500

const getStorePath = (): string => join(app.getPath('userData'), STORE_FILE)

/** 待办只保留单行文本，并将连续空白压缩为一个空格。 */
const normalizeText = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
    : ''

const normalizeStoredNote = (value: unknown): QuickNote | null => {
  if (!value || typeof value !== 'object') return null

  const note = value as Record<string, unknown>
  const text = normalizeText(note.text)

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
    completedAt: note.completedAt
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

export const addQuickNote = (value: unknown): Promise<QuickNoteState> => {
  const text = normalizeText(value)

  if (!text) throw new Error('待办内容不能为空')

  return mutateNotes(async () => {
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
          completedAt: null
        },
        ...notes
      ].slice(0, MAX_NOTES)
    )

    return getQuickNoteState()
  })
}

export const setQuickNoteDone = (
  idValue: unknown,
  doneValue: unknown
): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)

  if (typeof doneValue !== 'boolean') {
    throw new Error('待办状态不合法')
  }

  return mutateNotes(async () => {
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
}

export const removeQuickNote = (idValue: unknown): Promise<QuickNoteState> => {
  const id = requireNoteId(idValue)

  return mutateNotes(async () => {
    await writeNotes((await readNotes()).filter((note) => note.id !== id))

    return getQuickNoteState()
  })
}

export const clearCompletedQuickNotes = (): Promise<QuickNoteState> =>
  mutateNotes(async () => {
    await writeNotes((await readNotes()).filter((note) => !note.done))

    return getQuickNoteState()
  })

/**
 * 注册待办简记 IPC。
 */
export const initializeQuickNotes = (): void => {
  ipcMain.handle('quick-notes:get-state', () => getQuickNoteState())
  ipcMain.handle('quick-notes:add', (_event, text: unknown) => addQuickNote(text))
  ipcMain.handle(
    'quick-notes:set-done',
    (_event, id: unknown, done: unknown) => setQuickNoteDone(id, done)
  )
  ipcMain.handle('quick-notes:remove', (_event, id: unknown) => removeQuickNote(id))
  ipcMain.handle('quick-notes:clear-completed', () => clearCompletedQuickNotes())
}
