import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QuickNote } from '../../../types/quick-note'
import { getErrorMessage } from '../../../utils'

interface QuickNotesController {
  notes: QuickNote[]
  openCount: number
  loading: boolean
  error: string | null
  add: (text: string) => Promise<void>
  setDone: (id: string, done: boolean) => Promise<void>
  remove: (id: string) => Promise<void>
  clearCompleted: () => Promise<void>
}

/**
 * 待办简记状态。
 * 所有写操作都由主进程落盘后再更新界面。
 */
export const useQuickNotes = (): QuickNotesController => {
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    window.electron
      .getQuickNoteState()
      .then((state) => {
        if (mounted) setNotes(state.notes)
      })
      .catch((loadError) => {
        if (mounted) {
          setError(getErrorMessage(loadError, '读取待办简记失败'))
        }
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const add = useCallback(async (text: string): Promise<void> => {
    const state = await window.electron.addQuickNote(text)

    setNotes(state.notes)
    setError(null)
  }, [])

  const setDone = useCallback(async (id: string, done: boolean): Promise<void> => {
    const state = await window.electron.setQuickNoteDone(id, done)

    setNotes(state.notes)
    setError(null)
  }, [])

  const remove = useCallback(async (id: string): Promise<void> => {
    const state = await window.electron.removeQuickNote(id)

    setNotes(state.notes)
    setError(null)
  }, [])

  const clearCompleted = useCallback(async (): Promise<void> => {
    const state = await window.electron.clearCompletedQuickNotes()

    setNotes(state.notes)
    setError(null)
  }, [])

  const openCount = useMemo(
    () => notes.filter((note) => !note.done).length,
    [notes]
  )

  return {
    notes,
    openCount,
    loading,
    error,
    add,
    setDone,
    remove,
    clearCompleted
  }
}
