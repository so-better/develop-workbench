import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  BoldOutlined,
  CodeOutlined,
  EditOutlined,
  EyeOutlined,
  FontSizeOutlined,
  ItalicOutlined,
  LinkOutlined,
  MessageOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import { Button, Input, Segmented, Tooltip } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import MarkdownContent from './MarkdownContent'

type MarkdownEditorMode = 'edit' | 'preview'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

interface FormatAction {
  title: string
  icon: JSX.Element
  before: string
  after?: string
  placeholder?: string
}

const FORMAT_ACTIONS: FormatAction[] = [
  {
    title: '标题',
    icon: <FontSizeOutlined />,
    before: '## ',
    after: '',
    placeholder: '标题'
  },
  {
    title: '加粗',
    icon: <BoldOutlined />,
    before: '**',
    after: '**',
    placeholder: '加粗文本'
  },
  {
    title: '斜体',
    icon: <ItalicOutlined />,
    before: '*',
    after: '*',
    placeholder: '斜体文本'
  },
  {
    title: '行内代码',
    icon: <CodeOutlined />,
    before: '`',
    after: '`',
    placeholder: '代码'
  },
  {
    title: '链接',
    icon: <LinkOutlined />,
    before: '[',
    after: '](https://)',
    placeholder: '链接文本'
  },
  {
    title: '无序列表',
    icon: <UnorderedListOutlined />,
    before: '- ',
    after: '',
    placeholder: '列表项'
  },
  {
    title: '引用',
    icon: <MessageOutlined />,
    before: '> ',
    after: '',
    placeholder: '引用内容'
  }
]

/**
 * 统一的 Markdown 编辑器。
 * 使用现有 TextArea 和 MarkdownContent，提供格式工具与编辑/预览切换。
 */
export default function MarkdownEditor({
  value,
  onChange,
  placeholder = '支持 Markdown',
  rows = 4,
  disabled = false,
  autoFocus = false,
  className
}: MarkdownEditorProps): JSX.Element {
  const [mode, setMode] = useState<MarkdownEditorMode>('edit')
  const textareaRef = useRef<TextAreaRef>(null)
  const previousModeRef = useRef<MarkdownEditorMode>(mode)

  const getTextarea = (): HTMLTextAreaElement | null =>
    textareaRef.current?.resizableTextArea?.textArea ?? null

  const focusRange = (start: number, end: number): void => {
    window.requestAnimationFrame(() => {
      const textarea = getTextarea()

      if (!textarea) return

      textarea.focus()
      textarea.setSelectionRange(start, end)
    })
  }

  const applyFormat = (action: FormatAction): void => {
    if (disabled) return

    const textarea = getTextarea()

    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)
    const content = selected || action.placeholder || ''
    const after = action.after ?? ''
    const insertion = action.before + content + after
    const next = value.slice(0, start) + insertion + value.slice(end)

    onChange(next)

    const selectionStart = start + action.before.length
    focusRange(selectionStart, selectionStart + content.length)
  }

  const applyLinePrefix = (prefix: string, placeholder: string): void => {
    if (disabled) return

    const textarea = getTextarea()

    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
    const lineEndIndex = value.indexOf('\n', end)
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
    const originalBlock = value.slice(lineStart, lineEnd)
    const block = originalBlock || placeholder
    const nextBlock = block
      .split('\n')
      .map((line) => `${prefix}${line}`)
      .join('\n')
    const next =
      value.slice(0, lineStart) + nextBlock + value.slice(lineEnd)

    onChange(next)

    if (!originalBlock) {
      focusRange(
        lineStart + prefix.length,
        lineStart + prefix.length + placeholder.length
      )
      return
    }

    focusRange(lineStart + prefix.length, lineStart + prefix.length)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (disabled || (!event.metaKey && !event.ctrlKey)) return

    const key = event.key.toLowerCase()

    if (key === 'b' || key === 'i') {
      event.preventDefault()
      applyFormat(FORMAT_ACTIONS[key === 'b' ? 1 : 2])
      return
    }

    if (key === 'k') {
      event.preventDefault()
      applyFormat(FORMAT_ACTIONS[4])
    }
  }

  useEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = mode

    // 只在从预览切回编辑时恢复焦点，首次挂载时尊重 autoFocus。
    if (mode === 'edit' && previousMode === 'preview') {
      focusRange(value.length, value.length)
    }
  }, [mode, value.length])

  return (
    <div className={`markdown-editor${className ? ` ${className}` : ''}`}>
      <div className="markdown-editor-toolbar">
        {mode === 'edit' ? (
          <div className="markdown-editor-tools" role="toolbar" aria-label="Markdown 格式工具">
            {FORMAT_ACTIONS.map((action) => (
              <Tooltip title={action.title} key={action.title}>
                <Button
                  type="text"
                  size="small"
                  className="markdown-editor-tool"
                  icon={action.icon}
                  aria-label={action.title}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (action.after === '' && action.before.endsWith(' ')) {
                      applyLinePrefix(action.before, action.placeholder ?? '')
                      return
                    }

                    applyFormat(action)
                  }}
                />
              </Tooltip>
            ))}
          </div>
        ) : (
          <span className="markdown-editor-preview-label">预览效果</span>
        )}

        <Segmented
          size="small"
          className="markdown-editor-mode"
          value={mode}
          options={[
            { label: '编辑', value: 'edit', icon: <EditOutlined /> },
            { label: '预览', value: 'preview', icon: <EyeOutlined /> }
          ]}
          onChange={(next) => setMode(next as MarkdownEditorMode)}
        />
      </div>

      {mode === 'edit' ? (
        <Input.TextArea
          ref={textareaRef}
          className="markdown-editor-input"
          value={value}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div
          className="markdown-editor-preview"
          style={{ minHeight: Math.max(96, rows * 22) }}
        >
          {value.trim() ? (
            <MarkdownContent content={value} />
          ) : (
            <p className="markdown-editor-preview-empty">暂无可预览内容</p>
          )}
        </div>
      )}
    </div>
  )
}
