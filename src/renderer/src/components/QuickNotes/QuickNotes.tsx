import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  CheckCircleFilled,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PlusOutlined,
  SyncOutlined
} from '@ant-design/icons'
import {
  App,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Select,
  Spin
} from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import type {
  QuickNote,
  QuickNoteRecurrence
} from '../../../../types/quick-note'
import { getErrorMessage, getQuickNoteSummary } from '../../../../utils'
import { formatQuickNoteRecurrence } from '../../../../utils/quick-note-recurrence'
import MarkdownContent from '../MarkdownContent/MarkdownContent'
import { hasRichTextFormatting, htmlToMarkdown } from './html-to-markdown'
import './QuickNotes.css'

const MAX_DRAFT_LENGTH = 5000
const MAX_CLIPBOARD_HTML_LENGTH = 200_000
const RECURRENCE_OPTIONS: Array<{
  value: QuickNoteRecurrence
  label: string
}> = [
  { value: 'none', label: '不重复' },
  { value: 'minutely', label: '每分钟' },
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' }
]
const PANEL_WIDTH = 560
const PANEL_Z_INDEX = 1100
const OVERLAY_Z_INDEX = 1000
const DUE_MODAL_Z_INDEX = 1300
const DATE_POPUP_Z_INDEX = 1400

const getRecurrenceHint = (recurrence: QuickNoteRecurrence): string => {
  switch (recurrence) {
    case 'none':
      return '提前 5 分钟提醒'
    case 'minutely':
      return '每分钟提醒一次（提前 30 秒）'
    case 'hourly':
      return '每小时提醒一次，提前 5 分钟'
    case 'daily':
      return '每天提醒一次，提前 5 分钟'
    case 'weekly':
      return '每周提醒一次，提前 5 分钟'
    case 'monthly':
      return '每月提醒一次，提前 5 分钟'
  }
}

const isOverlayTarget = (target: Element): boolean => {
  let element: Element | null = target

  while (element && element !== document.body) {
    if (
      element.matches(
        'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"]'
      )
    ) {
      return true
    }

    const style = window.getComputedStyle(element)
    const zIndex = Number(style.zIndex)

    if (
      (style.position === 'fixed' || style.position === 'absolute') &&
      Number.isFinite(zIndex) &&
      zIndex >= OVERLAY_Z_INDEX
    ) {
      return true
    }

    element = element.parentElement
  }

  return false
}

interface QuickNotesProps {
  open: boolean
  notes: QuickNote[]
  loading: boolean
  error: string | null
  onOpen: () => void
  onReload: () => void
  onClose: () => void
  onAdd: (
    text: string,
    dueAt: string | null,
    recurrence: QuickNoteRecurrence
  ) => Promise<void>
  onSetDueAt: (
    id: string,
    dueAt: string | null,
    recurrence: QuickNoteRecurrence
  ) => Promise<void>
  onSetDone: (id: string, done: boolean) => Promise<void>
  onUpdateText: (id: string, text: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClearCompleted: () => Promise<void>
}

/**
 * 全局待办简记。
 * 浮动面板跟随底部状态栏的“待办简记”入口定位。
 */
export default function QuickNotes({
  open,
  notes,
  loading,
  error,
  onOpen,
  onReload,
  onClose,
  onAdd,
  onSetDueAt,
  onSetDone,
  onUpdateText,
  onRemove,
  onClearCompleted
}: QuickNotesProps): JSX.Element | null {
  const { message, notification } = App.useApp()
  const [draft, setDraft] = useState('')
  const [composerDueAt, setComposerDueAt] = useState<Dayjs | null>(null)
  const [composerRecurrence, setComposerRecurrence] =
    useState<QuickNoteRecurrence>('none')
  const [composerDueOpen, setComposerDueOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [editingDueNoteId, setEditingDueNoteId] = useState<string | null>(null)
  const [editingDueValue, setEditingDueValue] = useState<Dayjs | null>(null)
  const [editingDueRecurrence, setEditingDueRecurrence] =
    useState<QuickNoteRecurrence>('none')
  const [dueSaving, setDueSaving] = useState(false)
  const [editingTextNoteId, setEditingTextNoteId] = useState<string | null>(
    null
  )
  const [editingTextValue, setEditingTextValue] = useState('')
  const [textSaving, setTextSaving] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{
    left: number
    bottom: number
    width: number
  } | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<TextAreaRef>(null)
  const isMac = window.electron.platform === 'darwin'
  const shortcut = isMac ? '⌘⇧K' : 'Ctrl Shift K'

  // 面板锚定底栏入口；用布局副作用在首帧前定位，避免先出现在旧位置再跳动。
  useLayoutEffect(() => {
    if (!open) return

    const updatePosition = (): void => {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16)
      const trigger = document.querySelector<HTMLElement>(
        '[data-quick-notes-trigger]'
      )
      const rect = trigger?.getBoundingClientRect() ?? null
      const left = rect
        ? Math.max(
            8,
            Math.min(
              rect.left + rect.width / 2 - width / 2,
              window.innerWidth - width - 8
            )
          )
        : window.innerWidth - width - 16

      setPanelPosition({
        left,
        bottom: rect ? Math.max(8, window.innerHeight - rect.top + 8) : 62,
        width
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)

    return () => window.removeEventListener('resize', updatePosition)
  }, [open])

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
    const unsubscribe = window.electron.onQuickNoteReminder((reminder) => {
      const recurrenceLabel = formatQuickNoteRecurrence(
        reminder.recurrence,
        reminder.dueAt,
        reminder.recurrenceDay
      )

      notification.warning({
        message: recurrenceLabel ? '循环待办提醒' : '待办即将截止',
        description: recurrenceLabel
          ? `${reminder.text} · ${recurrenceLabel} · 提醒 ${dayjs(
              reminder.occurrenceAt
            ).format('MM-DD HH:mm')} · 最终截止 ${dayjs(reminder.dueAt).format(
              'MM-DD HH:mm'
            )}`
          : `${reminder.text} · 截止 ${dayjs(reminder.dueAt).format(
              'MM-DD HH:mm'
            )}`,
        duration: 12,
        placement: 'topLeft',
        key: `quick-note-reminder-${reminder.id}-${reminder.occurrenceAt}`,
        onClick: onOpen
      })
      void window.electron
        .ackQuickNoteReminder(reminder.id, reminder.occurrenceAt)
        .catch(() => undefined)
    })

    return unsubscribe
  }, [notification, onOpen])

  useEffect(() => {
    void window.electron.notifyQuickNotesRendererReady().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (open) return

    setComposerDueOpen(false)
    setEditingDueNoteId(null)
    setEditingDueValue(null)
    setEditingDueRecurrence('none')
    setDueSaving(false)
  }, [open])

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
      if (panelRef.current?.contains(target)) return
      if (isOverlayTarget(target)) return

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
      if (composerDueOpen) return

      const target = event.target
      const targetInsidePanel =
        target instanceof Element && panelRef.current?.contains(target)

      if (
        !targetInsidePanel &&
        target instanceof Element &&
        isOverlayTarget(target)
      ) {
        return
      }
      if (
        document.querySelector(
          '.quick-notes-popconfirm:not(.ant-popover-hidden)'
        )
      ) {
        return
      }

      if (document.querySelector('.ant-image-preview-root')) {
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
  }, [composerDueOpen, onClose, open])

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

    if (composerDueAt && !composerDueAt.isAfter(dayjs())) {
      message.warning('截止时间需晚于当前时间')
      return
    }

    setSubmitting(true)

    try {
      await onAdd(
        text,
        composerDueAt?.toISOString() ?? null,
        composerRecurrence
      )
      setDraft('')
      setComposerDueAt(null)
      setComposerRecurrence('none')
      window.requestAnimationFrame(() => inputRef.current?.focus())
    } catch (addError) {
      message.error(getErrorMessage(addError, '添加待办失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const openDueEditor = (note: QuickNote): void => {
    setEditingDueNoteId(note.id)
    setEditingDueValue(note.dueAt ? dayjs(note.dueAt) : null)
    setEditingDueRecurrence(note.recurrence)
  }

  const closeDueEditor = (): void => {
    if (dueSaving) return

    setEditingDueNoteId(null)
    setEditingDueValue(null)
    setEditingDueRecurrence('none')
  }

  const openTextEditor = (note: QuickNote): void => {
    setEditingTextNoteId(note.id)
    setEditingTextValue(note.text)
  }

  const closeTextEditor = (): void => {
    if (textSaving) return

    setEditingTextNoteId(null)
    setEditingTextValue('')
  }

  const handleSaveText = async (): Promise<void> => {
    const id = editingTextNoteId
    const text = editingTextValue.trim()

    if (!id || !text) {
      message.warning('待办内容不能为空')
      return
    }

    setTextSaving(true)

    try {
      await onUpdateText(id, text)
      setEditingTextNoteId(null)
      setEditingTextValue('')
    } catch (updateError) {
      message.error(getErrorMessage(updateError, '保存待办失败'))
    } finally {
      setTextSaving(false)
    }
  }

  const handleSaveDue = async (): Promise<void> => {
    if (!editingDueNoteId || dueSaving) return

    if (editingDueValue && !editingDueValue.isAfter(dayjs())) {
      message.warning('截止时间需晚于当前时间')
      return
    }

    setDueSaving(true)

    try {
      await onSetDueAt(
        editingDueNoteId,
        editingDueValue?.toISOString() ?? null,
        editingDueValue ? editingDueRecurrence : 'none'
      )
      setEditingDueNoteId(null)
      setEditingDueValue(null)
      setEditingDueRecurrence('none')
    } catch (dueError) {
      message.error(getErrorMessage(dueError, '更新截止时间失败'))
    } finally {
      setDueSaving(false)
    }
  }

  const handleComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ): void => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return
    }

    event.preventDefault()
    handleAdd()
  }

  const handlePaste = (
    event: ReactClipboardEvent<HTMLTextAreaElement>
  ): void => {
    const html = event.clipboardData.getData('text/html')

    if (!html) return

    if (html.length > MAX_CLIPBOARD_HTML_LENGTH) {
      message.info('富文本内容过大，已按纯文本粘贴')
      return
    }

    if (!hasRichTextFormatting(html)) return

    const markdown = htmlToMarkdown(html)

    if (!markdown) return

    event.preventDefault()

    const textarea = inputRef.current?.resizableTextArea?.textArea
    const start = textarea?.selectionStart ?? draft.length
    const end = textarea?.selectionEnd ?? draft.length
    const next = `${draft.slice(0, start)}${markdown}${draft.slice(end)}`.slice(
      0,
      MAX_DRAFT_LENGTH
    )

    setDraft(next)
    window.requestAnimationFrame(() => {
      const target = inputRef.current?.resizableTextArea?.textArea

      if (!target) return

      const cursor = Math.min(start + markdown.length, next.length)

      target.focus()
      target.setSelectionRange(cursor, cursor)
    })
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
    const summary = getQuickNoteSummary(note.text, 80)
    const dueAt = note.dueAt ? dayjs(note.dueAt) : null
    const dueOverdue = Boolean(dueAt && !note.done && dueAt.isBefore(dayjs()))
    const recurrenceLabel = formatQuickNoteRecurrence(
      note.recurrence,
      note.dueAt,
      note.recurrenceDay
    )

    return (
      <div
        className={`quick-note-row${note.done ? ' is-done' : ''}`}
        key={note.id}
      >
        <Checkbox
          checked={note.done}
          disabled={busy}
          aria-label={
            note.done
              ? `标记「${summary}」为未完成`
              : `完成「${summary}」`
          }
          onChange={() => handleToggle(note)}
        />
        <div className="quick-note-content">
          <div className="quick-note-text">
            <MarkdownContent
              content={note.text}
              className="quick-note-markdown"
              breaks
            />
          </div>
          {dueAt || recurrenceLabel ? (
            <div className="quick-note-meta">
              {dueAt ? (
                <button
                  type="button"
                  className={`quick-note-due${dueOverdue ? ' is-overdue' : ''}`}
                  onClick={() => openDueEditor(note)}
                >
                  <ClockCircleOutlined />
                  截止 {dueAt.format('MM-DD HH:mm')}
                </button>
              ) : null}
              {recurrenceLabel ? (
                <span className="quick-note-recurrence">
                  <SyncOutlined />
                  {recurrenceLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="quick-note-actions">
          <Button
            type="text"
            size="small"
            className="quick-note-action"
            icon={<EditOutlined />}
            aria-label={`编辑待办「${summary}」`}
            title="编辑待办"
            disabled={busy}
            onClick={() => openTextEditor(note)}
          />
          {!dueAt ? (
            <Button
              type="text"
              size="small"
              className="quick-note-action"
              icon={<ClockCircleOutlined />}
              aria-label={`为「${summary}」设置截止时间`}
              title="设置截止时间"
              disabled={busy}
              onClick={() => openDueEditor(note)}
            />
          ) : null}
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
              className="quick-note-action quick-note-delete"
              icon={<DeleteOutlined />}
              aria-label={`删除待办「${summary}」`}
              disabled={busy}
            />
          </Popconfirm>
        </div>
      </div>
    )
  }

  return (
    <section
      ref={panelRef}
      className="quick-notes-panel"
      role="dialog"
      aria-label="待办简记"
      style={{
        left: panelPosition?.left,
        bottom: panelPosition?.bottom,
        width:
          panelPosition?.width ??
          Math.min(PANEL_WIDTH, window.innerWidth - 16),
        zIndex: PANEL_Z_INDEX
      }}
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
        <div className="quick-notes-composer">
          <Input.TextArea
            ref={inputRef}
            className="quick-notes-composer-input"
            value={draft}
            maxLength={MAX_DRAFT_LENGTH}
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder="记一条待办，支持 Markdown / 富文本粘贴"
            disabled={loading}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            onPaste={handlePaste}
          />
          <div className="quick-notes-composer-bar">
            <div className="quick-notes-composer-meta">
              <DatePicker
                value={composerDueAt}
                size="small"
                variant="borderless"
                showTime={{ format: 'HH:mm' }}
                format="MM-DD HH:mm"
                placeholder="截止时间（可选）"
                suffixIcon={<ClockCircleOutlined />}
                allowClear
                disabled={loading}
                popupStyle={{ zIndex: DATE_POPUP_Z_INDEX }}
                onOpenChange={(nextOpen) => setComposerDueOpen(nextOpen)}
                disabledDate={(current) =>
                  Boolean(
                    current && current.endOf('day').isBefore(dayjs(), 'day')
                  )
                }
                onChange={(value) => {
                  setComposerDueAt(value)
                  if (!value) setComposerRecurrence('none')
                }}
              />
              <Select
                className="quick-notes-recurrence-select"
                size="small"
                variant="borderless"
                value={composerRecurrence}
                options={RECURRENCE_OPTIONS}
                disabled={loading || !composerDueAt}
                popupMatchSelectWidth={120}
                styles={{
                  popup: { root: { zIndex: DATE_POPUP_Z_INDEX } }
                }}
                title={!composerDueAt ? '先选择截止时间后设置重复' : undefined}
                aria-label="重复规则"
                onChange={(value: QuickNoteRecurrence) =>
                  setComposerRecurrence(value)
                }
              />
              <span className="quick-notes-composer-hint">
                {!composerDueAt
                  ? '先选截止时间可设置重复'
                  : getRecurrenceHint(composerRecurrence)}
              </span>
            </div>
            <div className="quick-notes-composer-actions">
              {draft.length > 0 ? (
                <span className="quick-notes-draft-count">
                  {draft.length}/{MAX_DRAFT_LENGTH}
                </span>
              ) : null}
              <Button
                type="primary"
                size="small"
                className="quick-notes-add"
                icon={<PlusOutlined />}
                loading={submitting}
                disabled={loading || !draft.trim()}
                onClick={() => handleAdd()}
              >
                添加
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && notes.length > 0 ? <div className="quick-notes-error">{error}</div> : null}

      <div className="quick-notes-body">
        {loading ? (
          <div className="quick-notes-loading">
            <Spin size="small" />
          </div>
        ) : error && notes.length === 0 ? (
          <div className="quick-notes-empty is-error">
            <span className="quick-notes-empty-icon">
              <CheckSquareOutlined />
            </span>
            <strong>待办加载失败</strong>
            <span>{error}</span>
            <Button type="link" size="small" onClick={onReload}>
              重试
            </Button>
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

      <Modal
        open={editingTextNoteId !== null}
        title="编辑待办"
        okText="保存"
        cancelText="取消"
        confirmLoading={textSaving}
        zIndex={DUE_MODAL_Z_INDEX}
        closable={!textSaving}
        keyboard={!textSaving}
        maskClosable={!textSaving}
        destroyOnHidden
        okButtonProps={{ disabled: !editingTextValue.trim() }}
        onOk={() => void handleSaveText()}
        onCancel={closeTextEditor}
      >
        <div className="quick-note-text-editor">
          <Input.TextArea
            className="quick-note-text-editor-input"
            style={{ color: 'var(--app-text)' }}
            value={editingTextValue}
            maxLength={MAX_DRAFT_LENGTH}
            showCount
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder="输入待办内容，支持 Markdown，Shift+Enter 换行"
            spellCheck={false}
            onChange={(event) => setEditingTextValue(event.target.value)}
          />
          <span>保存后会保留换行和 Markdown 格式。</span>
        </div>
      </Modal>

      <Modal
        open={editingDueNoteId !== null}
        title="设置截止时间"
        okText="保存"
        cancelText="取消"
        confirmLoading={dueSaving}
        zIndex={DUE_MODAL_Z_INDEX}
        destroyOnHidden
        onOk={() => void handleSaveDue()}
        onCancel={closeDueEditor}
      >
        <div className="quick-note-due-editor">
          <DatePicker
            value={editingDueValue}
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            placeholder="选择截止时间"
            allowClear
            popupStyle={{ zIndex: DATE_POPUP_Z_INDEX }}
            disabledDate={(current) =>
              Boolean(current && current.endOf('day').isBefore(dayjs(), 'day'))
            }
            onChange={(value) => {
              setEditingDueValue(value)
              if (!value) setEditingDueRecurrence('none')
            }}
          />
          <Select
            className="quick-notes-recurrence-select"
            value={editingDueValue ? editingDueRecurrence : 'none'}
            options={RECURRENCE_OPTIONS}
            disabled={!editingDueValue}
            popupMatchSelectWidth={120}
            styles={{ popup: { root: { zIndex: DATE_POPUP_Z_INDEX } } }}
            title={!editingDueValue ? '先选择截止时间后设置重复' : undefined}
            aria-label="重复规则"
            onChange={(value: QuickNoteRecurrence) =>
              setEditingDueRecurrence(value)
            }
          />
          <span>
            {editingDueValue
              ? `截止时间为最终期限；保存后会${getRecurrenceHint(
                  editingDueRecurrence
                )}。完成或删除待办后停止提醒，清空日期可取消。`
              : '选择截止时间后可设置重复；清空日期可取消提醒。'}
          </span>
        </div>
      </Modal>

      <footer className="quick-notes-foot">
        <span>
          <kbd>{shortcut}</kbd>
          随时打开
        </span>
        <span>
          <kbd>Enter</kbd>
          添加
          <kbd>Shift Enter</kbd>
          换行
          <kbd>Esc</kbd>
          关闭
        </span>
      </footer>
    </section>
  )
}
