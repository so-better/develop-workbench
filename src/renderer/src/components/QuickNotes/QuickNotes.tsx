import { useEffect, useRef, useState } from 'react'
import {
  CheckCircleFilled,
  CheckSquareOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined
} from '@ant-design/icons'
import { App, Button, Checkbox, Input, Popconfirm, Spin } from 'antd'
import type { InputRef } from 'antd'
import type { QuickNote } from '../../../../types/quick-note'
import { getErrorMessage } from '../../../../utils'

interface QuickNotesProps {
  open: boolean
  notes: QuickNote[]
  loading: boolean
  error: string | null
  onOpen: () => void
  onClose: () => void
  onAdd: (text: string) => Promise<void>
  onSetDone: (id: string, done: boolean) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClearCompleted: () => Promise<void>
}

/**
 * 全局待办简记。
 * 左下浮动面板，适合随开随记。
 */
export default function QuickNotes({
  open,
  notes,
  loading,
  error,
  onOpen,
  onClose,
  onAdd,
  onSetDone,
  onRemove,
  onClearCompleted
}: QuickNotesProps): JSX.Element | null {
  const { message } = App.useApp()
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<InputRef>(null)
  const isMac = window.electron.platform === 'darwin'
  const shortcut = isMac ? '⌘⇧K' : 'Ctrl Shift K'

  // 全局快捷键和内置浏览器内转发的事件。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onOpen()
        window.requestAnimationFrame(() => inputRef.current?.focus())
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    const unsubscribe = window.electron.onQuickNotesOpen(() => {
      onOpen()
      window.requestAnimationFrame(() => inputRef.current?.focus())
    })

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      unsubscribe()
    }
  }, [onOpen])

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // 全部完成后展开已完成列表，避免出现“空列表 + 100% 进度”的割裂感。
  useEffect(() => {
    if (!open) return

    const hasPending = notes.some((note) => !note.done)

    if (!hasPending && notes.length > 0) {
      setShowCompleted(true)
    }
  }, [notes, open])

  // 点击面板外关闭；底部入口本身不触发关闭，避免按钮点击后立即重开。
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target

      if (!(target instanceof Element)) return
      if (target.closest('[data-quick-notes-trigger]')) return
      if (target.closest('.ant-popover')) return
      if (panelRef.current?.contains(target)) return

      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (
        document.querySelector(
          '.quick-notes-popconfirm:not(.ant-popover-hidden)'
        )
      ) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose, open])

  const setBusy = (id: string, busy: boolean): void => {
    setBusyIds((current) => {
      const next = new Set(current)

      if (busy) {
        next.add(id)
      } else {
        next.delete(id)
      }

      return next
    })
  }

  const handleAdd = async (): Promise<void> => {
    const text = draft.trim()

    if (loading || !text || submitting) return

    setSubmitting(true)

    try {
      await onAdd(text)
      setDraft('')
      window.requestAnimationFrame(() => inputRef.current?.focus())
    } catch (addError) {
      message.error(getErrorMessage(addError, '添加待办失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (note: QuickNote): Promise<void> => {
    if (busyIds.has(note.id)) return

    setBusy(note.id, true)

    try {
      await onSetDone(note.id, !note.done)
    } catch (toggleError) {
      message.error(getErrorMessage(toggleError, '更新待办失败'))
    } finally {
      setBusy(note.id, false)
    }
  }

  const handleRemove = async (note: QuickNote): Promise<void> => {
    if (busyIds.has(note.id)) return

    setBusy(note.id, true)

    try {
      await onRemove(note.id)
    } catch (removeError) {
      message.error(getErrorMessage(removeError, '删除待办失败'))
    } finally {
      setBusy(note.id, false)
    }
  }

  const handleClearCompleted = async (): Promise<void> => {
    try {
      await onClearCompleted()
    } catch (clearError) {
      message.error(getErrorMessage(clearError, '清空已完成待办失败'))
    }
  }

  if (!open) return null

  const pendingNotes = notes.filter((note) => !note.done)
  const completedNotes = notes.filter((note) => note.done)
  const totalNotes = notes.length
  const completedCount = completedNotes.length
  const allDone = totalNotes > 0 && pendingNotes.length === 0
  const progress = totalNotes > 0 ? (completedCount / totalNotes) * 100 : 0

  const renderNote = (note: QuickNote): JSX.Element => {
    const busy = busyIds.has(note.id)

    return (
      <div
        className={`quick-note-row${note.done ? ' is-done' : ''}`}
        key={note.id}
      >
        <Checkbox
          checked={note.done}
          disabled={busy}
          aria-label={note.done ? `标记 ${note.text} 为未完成` : `完成 ${note.text}`}
          onChange={() => handleToggle(note)}
        />
        <span className="quick-note-text">{note.text}</span>
        <Popconfirm
          title="删除这条待办？"
          rootClassName="quick-notes-popconfirm"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          placement="left"
          disabled={busy}
          onConfirm={() => handleRemove(note)}
        >
          <Button
            type="text"
            size="small"
            danger
            className="quick-note-delete"
            icon={<DeleteOutlined />}
            aria-label={`删除待办 ${note.text}`}
            disabled={busy}
          />
        </Popconfirm>
      </div>
    )
  }

  return (
    <section
      ref={panelRef}
      className="quick-notes-panel"
      role="dialog"
      aria-label="待办简记"
    >
      <header className="quick-notes-head">
        <div className="quick-notes-title">
          <span className="quick-notes-title-icon">
            <CheckSquareOutlined />
          </span>
          <div>
            <strong>待办简记</strong>
            <span aria-live="polite">
              {allDone
                ? `全部完成 · 共 ${totalNotes} 项`
                : `未完成 ${pendingNotes.length} 项${
                    completedCount > 0 ? ` · 已完成 ${completedCount} 项` : ''
                  }`}
            </span>
          </div>
        </div>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          aria-label="关闭待办简记"
          onClick={onClose}
        />
      </header>

      {totalNotes > 0 && !allDone ? (
        <div
          className="quick-notes-progress"
          role="progressbar"
          aria-label="待办完成进度"
          aria-valuemin={0}
          aria-valuemax={totalNotes}
          aria-valuenow={completedCount}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      <div className="quick-notes-capture">
        <div className="quick-notes-input-row">
          <Input
            ref={inputRef}
            value={draft}
            maxLength={200}
            placeholder="记一条待办，Enter 添加"
            allowClear
            disabled={loading}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={(event) => {
              if (event.nativeEvent.isComposing) return
              handleAdd()
            }}
          />
          <Button
            color="primary"
            variant="text"
            loading={submitting}
            disabled={loading || !draft.trim()}
            onClick={() => handleAdd()}
          >
            添加
          </Button>
        </div>
      </div>

      {error ? <div className="quick-notes-error">{error}</div> : null}

      <div className="quick-notes-body">
        {loading ? (
          <div className="quick-notes-loading">
            <Spin size="small" />
          </div>
        ) : pendingNotes.length === 0 && completedNotes.length === 0 ? (
          <div className="quick-notes-empty">
            <span className="quick-notes-empty-icon">
              <CheckSquareOutlined />
            </span>
            <strong>还没有待办</strong>
            <span>在上方记录第一条，按 Enter 保存</span>
          </div>
        ) : (
          <>
            {pendingNotes.length > 0 ? (
              <div className="quick-notes-list">
                {pendingNotes.map(renderNote)}
              </div>
            ) : (
              <div className="quick-notes-all-done">
                <CheckCircleFilled />
                <span>所有待办都完成了</span>
              </div>
            )}

            {completedNotes.length > 0 ? (
              <div className="quick-notes-completed">
                <div className="quick-notes-completed-head">
                  <button
                    type="button"
                    className="quick-notes-completed-toggle"
                    aria-expanded={showCompleted}
                    aria-controls="quick-notes-completed-list"
                    onClick={() => setShowCompleted((value) => !value)}
                  >
                    <CheckCircleFilled className="quick-notes-completed-check" />
                    <span>已完成 {completedNotes.length} 项</span>
                    <DownOutlined
                      className={`quick-notes-completed-chevron${
                        showCompleted ? ' is-open' : ''
                      }`}
                    />
                  </button>
                  <Popconfirm
                    title="清空已完成待办？"
                    rootClassName="quick-notes-popconfirm"
                    okText="清空"
                    cancelText="取消"
                    onConfirm={handleClearCompleted}
                  >
                    <Button
                      type="text"
                      size="small"
                      className="quick-notes-completed-clear"
                      icon={<DeleteOutlined />}
                    >
                      清空
                    </Button>
                  </Popconfirm>
                </div>
                {showCompleted ? (
                  <div
                    id="quick-notes-completed-list"
                    className="quick-notes-list quick-notes-completed-list"
                  >
                    {completedNotes.map(renderNote)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <footer className="quick-notes-foot">
        <span>
          <kbd>{shortcut}</kbd>
          随时打开
        </span>
        <span>
          <kbd>Enter</kbd>
          添加
          <kbd>Esc</kbd>
          关闭
        </span>
      </footer>
    </section>
  )
}
