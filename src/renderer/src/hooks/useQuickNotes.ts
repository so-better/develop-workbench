import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QuickNote } from '../../../types/quick-note'
import { getErrorMessage } from '../../../utils'

interface QuickNotesController {
  notes: QuickNote[]
  openCount: number
  loading: boolean
  error: string | null
  reload: () => Promise<void>
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
  const reloadRequestRef = useRef(0)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const mountedRef = useRef(true)
  // 读与写共享队列，完整快照必须按操作顺序应用，不能被较早的加载覆盖。
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queueRef.current.then(operation, operation)
    queueRef.current = result.catch(() => undefined)
    return result
  }, [])

  /** 重新读取待办列表，用于失败后重试。 */
  const reload = useCallback(async (): Promise<void> => {
    const requestId = ++reloadRequestRef.current

    setLoading(true)
    setError(null)

    try {
      const state = await enqueue(() => window.electron.getQuickNoteState())

      if (!mountedRef.current || requestId !== reloadRequestRef.current) return
      setNotes(state.notes)
    } catch (loadError) {
      if (requestId === reloadRequestRef.current) {
        setError(getErrorMessage(loadError, '读取待办简记失败'))
      }
    } finally {
      if (requestId === reloadRequestRef.current) {
        setLoading(false)
      }
    }
  }, [enqueue])

  useEffect(() => {
    mountedRef.current = true
    void reload()
    return () => { mountedRef.current = false; reloadRequestRef.current += 1 }
  }, [reload])

  const mutate = useCallback((operation: () => Promise<{ notes: QuickNote[] }>): Promise<void> =>
    enqueue(async () => {
      const state = await operation()
      if (!mountedRef.current) return
      setNotes(state.notes)
      setError(null)
    }), [enqueue])

  const add = useCallback(async (text: string): Promise<void> => {
    await mutate(() => window.electron.addQuickNote(text))
  }, [mutate])

  const setDone = useCallback(async (id: string, done: boolean): Promise<void> => {
    await mutate(() => window.electron.setQuickNoteDone(id, done))
  }, [mutate])

  const remove = useCallback(async (id: string): Promise<void> => {
    await mutate(() => window.electron.removeQuickNote(id))
  }, [mutate])

  const clearCompleted = useCallback(async (): Promise<void> => {
    await mutate(() => window.electron.clearCompletedQuickNotes())
  }, [mutate])

  const openCount = useMemo(
    () => notes.filter((note) => !note.done).length,
    [notes]
  )

  return {
    notes,
    openCount,
    loading,
    error,
    reload,
    add,
    setDone,
    remove,
    clearCompleted
  }
}
