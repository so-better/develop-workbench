import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import type { RichTextContent } from '../../../types/rich-text'

interface RichTextEditorProps {
  value: string
  onChange: (value: RichTextContent) => void
  placeholder?: string
  readOnly?: boolean
  minHeight?: number
  className?: string
}

/**
 * 飞书列表 HTML 使用 number1/bullet1，且每个列表项单独一层 ol。
 * Quill 只识别 ordered/bullet，因此载入前合并并转换。
 */
const normalizeFeishuListHtml = (html: string): string => {
  if (!html) return ''

  const document = new DOMParser().parseFromString(
    `<div id="rich-text-root">${html}</div>`,
    'text/html'
  )
  const root = document.getElementById('rich-text-root')

  if (!root) return html

  for (const list of Array.from(root.children)) {
    if (list.tagName !== 'OL' && list.tagName !== 'UL') continue

    for (const item of Array.from(list.querySelectorAll('li'))) {
      const rawType = item.getAttribute('data-list')

      if (rawType === 'number1' || rawType === 'ordered') {
        item.setAttribute('data-list', 'ordered')
      } else if (rawType === 'bullet1' || rawType === 'bullet') {
        item.setAttribute('data-list', 'bullet')
      }

      item.removeAttribute('class')
      item.removeAttribute('style')
      item.removeAttribute('data-line')
      item.removeAttribute('data-start')
      item.removeAttribute('data-ol-id')
    }

    list.removeAttribute('style')
  }

  let previousList: Element | null = null

  for (const child of Array.from(root.children)) {
    if (child.tagName !== 'OL' && child.tagName !== 'UL') {
      previousList = null
      continue
    }

    if (previousList && previousList.tagName === child.tagName) {
      while (child.firstChild) {
        previousList.appendChild(child.firstChild)
      }

      child.remove()
      continue
    }

    previousList = child
  }

  return root.innerHTML
}

const TOOLBAR_LABELS: Record<string, string> = {
  bold: '加粗',
  italic: '斜体',
  underline: '下划线',
  strike: '删除线',
  blockquote: '引用',
  link: '链接'
}

/**
 * Quill 默认没有中文工具提示，补齐按钮和链接编辑弹层的本地化。
 */
const localizeToolbar = (root: HTMLElement): void => {
  const toolbar = root.querySelector<HTMLElement>('.ql-toolbar')

  if (!toolbar) return

  toolbar.setAttribute('aria-label', '富文本格式工具')

  for (const button of Array.from(toolbar.querySelectorAll('button'))) {
    const classes = Array.from(button.classList)
    const format = classes
      .find((className) => className.startsWith('ql-') && className !== 'ql-active')
      ?.slice(3)
    const listValue = button.getAttribute('value')
    const label = format === 'list'
      ? listValue === 'ordered'
        ? '有序列表'
        : '无序列表'
      : format
        ? TOOLBAR_LABELS[format]
        : undefined

    if (!label) continue

    button.setAttribute('title', label)
    button.setAttribute('aria-label', label)
  }

  for (const picker of Array.from(toolbar.querySelectorAll('.ql-picker'))) {
    const label = picker.querySelector<HTMLElement>('.ql-picker-label')

    if (!label) continue

    const text = picker.classList.contains('ql-color')
      ? '文字颜色'
      : picker.classList.contains('ql-background')
        ? '背景色'
        : null

    if (!text) continue

    label.setAttribute('title', text)
    label.setAttribute('aria-label', text)
  }

  const linkInput = root.querySelector<HTMLInputElement>(
    '.ql-tooltip input[type="text"]'
  )

  if (linkInput) {
    linkInput.setAttribute('data-link', '请输入链接地址')
    linkInput.setAttribute('aria-label', '链接地址')
  }
}

const TOOLBAR_OPTIONS = [
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'link']
]

/**
 * 通用富文本编辑器。
 * 使用 Quill Delta 作为内容结构，适合需要和富文本后端往返的场景。
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容',
  readOnly = false,
  minHeight = 160,
  className
}: RichTextEditorProps): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const quillRef = useRef<Quill | null>(null)
  const onChangeRef = useRef(onChange)
  const lastHtmlRef = useRef('')
  const suppressChangeRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const readContent = (quill: Quill): RichTextContent => ({
    html: quill.getSemanticHTML(0, quill.getLength()),
    text: quill.getText().replace(/\n$/, ''),
    delta: {
      ops: quill.getContents().ops as Array<Record<string, unknown>>
    }
  })

  useEffect(() => {
    const container = containerRef.current

    if (!container) return

    const quill = new Quill(container, {
      theme: 'snow',
      placeholder,
      readOnly,
      modules: {
        toolbar: TOOLBAR_OPTIONS
      }
    })

    quillRef.current = quill
    if (wrapperRef.current) localizeToolbar(wrapperRef.current)
    suppressChangeRef.current = true

    if (value.trim()) {
      quill.clipboard.dangerouslyPasteHTML(normalizeFeishuListHtml(value))
    }

    suppressChangeRef.current = false

    const initialContent = readContent(quill)
    lastHtmlRef.current = initialContent.html
    onChangeRef.current(initialContent)

    const handleTextChange = (): void => {
      if (suppressChangeRef.current) return

      const content = readContent(quill)
      lastHtmlRef.current = content.html
      onChangeRef.current(content)
    }

    quill.on('text-change', handleTextChange)

    return () => {
      quill.off('text-change', handleTextChange)
      quillRef.current = null
      wrapperRef.current?.querySelector('.ql-toolbar')?.remove()
      container.innerHTML = ''
      container.className = ''
    }
    // Quill 只初始化一次，外部内容通过 value 同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const quill = quillRef.current

    if (!quill || value === lastHtmlRef.current) return

    const currentHtml = quill.getSemanticHTML(0, quill.getLength())

    if (value === currentHtml) {
      lastHtmlRef.current = value
      return
    }

    suppressChangeRef.current = true

    if (value.trim()) {
      quill.clipboard.dangerouslyPasteHTML(normalizeFeishuListHtml(value))
    } else {
      quill.setText('')
    }

    suppressChangeRef.current = false

    const content = readContent(quill)
    lastHtmlRef.current = content.html
    onChangeRef.current(content)
  }, [value])

  useEffect(() => {
    quillRef.current?.enable(!readOnly)
  }, [readOnly])

  return (
    <div
      ref={wrapperRef}
      className={`rich-text-editor${className ? ` ${className}` : ''}`}
      style={
        {
          '--rich-text-min-height': `${minHeight}px`
        } as CSSProperties
      }
    >
      <div ref={containerRef} />
    </div>
  )
}
