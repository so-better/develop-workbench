import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent
} from 'react'
import {
  App,
  Button,
  ConfigProvider,
  Input,
  Spin,
  Tooltip,
  theme as antdTheme
} from 'antd'
import type { InputRef } from 'antd'
import {
  CloseOutlined,
  DownOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
  UpOutlined
} from '@ant-design/icons'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import './TerminalPage.css'
import { getErrorMessage } from '../../../../utils'
import { DEFAULT_TERMINAL_SETTINGS } from '../../../../types/terminal'
import type {
  TerminalCreateInput,
  TerminalSessionInfo,
  TerminalSettings
} from '../../../../types/terminal'

interface TerminalTab {
  id: string
  title: string
  customTitle: boolean
  exited: boolean
}

interface SortableTabProps {
  tab: TerminalTab
  active: boolean
  renaming: boolean
  renameDraft: string
  onSelect: () => void
  onClose: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
  onStartRename: () => void
  onRenameDraftChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
}

/** 可拖拽排序的终端标签。 */
const SortableTab = ({
  tab,
  active,
  renaming,
  renameDraft,
  onSelect,
  onClose,
  onContextMenu,
  onStartRename,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel
}: SortableTabProps): JSX.Element => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tab.id, disabled: renaming })

  return (
    <div
      ref={setNodeRef}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : undefined
      }}
      className={`terminal-tab${active ? ' is-active' : ''}${
        tab.exited ? ' is-exited' : ''
      }${isDragging ? ' is-dragging' : ''}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return

        event.preventDefault()
        onSelect()
      }}
    >
      {renaming ? (
        <Input
          size="small"
          autoFocus
          className="terminal-tab-rename"
          value={renameDraft}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onRenameDraftChange(event.target.value)}
          onBlur={onRenameCommit}
          onPressEnter={onRenameCommit}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return

            event.preventDefault()
            event.stopPropagation()
            onRenameCancel()
          }}
        />
      ) : (
        <>
          <span
            ref={setActivatorNodeRef}
            className="terminal-tab-title"
            title={tab.title}
            onDoubleClick={onStartRename}
            {...attributes}
            {...listeners}
          >
            {tab.title}
          </span>
          <Button
            type="text"
            size="small"
            className="terminal-tab-close"
            icon={<CloseOutlined />}
            aria-label={`关闭 ${tab.title}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          />
        </>
      )}
    </div>
  )
}

interface TerminalContextMenu {
  id: string
  x: number
  y: number
}

const DEFAULT_TERMINAL_TITLE = '终端'
const CONTEXT_MENU_WIDTH = 168
const CONTEXT_MENU_HEIGHT = 236
const IS_MAC = navigator.userAgent.includes('Mac')
const IS_WINDOWS = navigator.userAgent.includes('Windows')
/** 路径链接最多拼接的物理行数，避免超长自动换行导致重复扫描。 */
const MAX_LINK_LINE_COUNT = 100
/** 终端输出里可点击的绝对路径和 ~/ 路径。 */
const TERMINAL_PATH_PATTERN =
  /(?<![\w:/])(?:~\/|[A-Za-z]:[\\/]|\\\\[^\\/\s'"`<>|]+[\\/]|\/)[^\s'"`<>|]+/g

/** 把拖入的文件路径转换成 shell 可接受的参数。 */
const quoteShellPath = (path: string): string => {
  if (navigator.userAgent.includes('Windows')) {
    return `"${path.replace(/"/g, '""')}"`
  }

  return `'${path.replace(/'/g, "'\\''")}'`
}

/** 终端页面固定使用深色，内部所有 antd 组件和浮层统一适配。 */
const TERMINAL_DARK_THEME = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorBgContainer: '#18191c',
    colorBorder: '#303238',
    colorText: '#e6e8eb',
    colorTextPlaceholder: '#8b909a',
    colorPrimary: '#69b1ff'
  }
}

/** 终端固定使用深色配色，不跟随应用明暗主题。 */
const TERMINAL_THEME: ITheme = {
  background: '#101114',
  foreground: '#e6e8eb',
  cursor: '#69b1ff',
  cursorAccent: '#101114',
  selectionBackground: 'rgba(105, 177, 255, 0.28)',
  black: '#1f2024',
  red: '#f97066',
  green: '#47cd89',
  yellow: '#fdb022',
  blue: '#69b1ff',
  magenta: '#b692f6',
  cyan: '#67e3f9',
  white: '#d0d5dd',
  brightBlack: '#667085',
  brightRed: '#fda29b',
  brightGreen: '#75e0a7',
  brightYellow: '#fec84b',
  brightBlue: '#9ec5fe',
  brightMagenta: '#d6bbfb',
  brightCyan: '#a5f0fc',
  brightWhite: '#f2f4f7'
}

/**
 * 多标签终端页面。
 * 每个标签对应主进程中的一个 PTY 会话，切换标签不会丢失进程状态。
 */
export default function TerminalPage(): JSX.Element {
  const { message, modal } = App.useApp()
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [ready, setReady] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchNoResult, setSearchNoResult] = useState(false)
  const [contextMenu, setContextMenu] = useState<TerminalContextMenu | null>(null)
  const [tabContextMenu, setTabContextMenu] =
    useState<TerminalContextMenu | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const renameCancelledRef = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )
  const terminalsRef = useRef(new Map<string, Terminal>())
  const fitAddonsRef = useRef(new Map<string, FitAddon>())
  const searchAddonsRef = useRef(new Map<string, SearchAddon>())
  const webglAddonsRef = useRef(new Map<string, WebglAddon>())
  const containersRef = useRef(new Map<string, HTMLDivElement>())
  const containerRefCallbacks = useRef(
    new Map<string, (node: HTMLDivElement | null) => void>()
  )
  const infosRef = useRef(new Map<string, TerminalSessionInfo>())
  const tabsRef = useRef<TerminalTab[]>([])
  const activeIdRef = useRef<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<InputRef>(null)
  const emptyAutoCreateRef = useRef(false)
  const creatingRef = useRef(false)
  const settingsFrameRef = useRef<number | null>(null)
  const selectionTimersRef = useRef(new Map<string, number>())
  const settingsRef = useRef<TerminalSettings>({ ...DEFAULT_TERMINAL_SETTINGS })

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    if (searchOpen) return

    for (const addon of searchAddonsRef.current.values()) {
      addon.clearDecorations()
    }
  }, [searchOpen])

  /** 复制文本并给出轻量提示。 */
  const copyToClipboard = useCallback(
    async (text: string): Promise<void> => {
      if (!text) return

      try {
        await window.electron.copyText(text)
        message.success({
          content: '已复制',
          key: 'terminal-copy',
          duration: 1.2
        })
      } catch {
        message.error({
          content: '复制失败',
          key: 'terminal-copy',
          duration: 1.5
        })
      }
    },
    [message]
  )

  /** 粘贴文本；多行内容先确认，避免误执行多条命令。 */
  const pasteIntoTerminal = useCallback(
    (id: string, text: string): void => {
      if (!text) return

      const target = terminalsRef.current.get(id)

      if (!target) return

      const lineCount = text.split(/\r\n|\r|\n/).length

      if (lineCount <= 1) {
        target.paste(text)
        return
      }

      modal.confirm({
        title: '粘贴多行内容？',
        content: `剪贴板包含 ${lineCount} 行内容，粘贴后可能会直接执行多条命令。`,
        okText: '粘贴',
        cancelText: '取消',
        onOk: () => {
          const current = terminalsRef.current.get(id)

          if (!current) return

          current.paste(text)
          current.focus()
        }
      })
    },
    [modal]
  )

  /** 只为当前活动终端启用 WebGL，避免多标签占用过多绘图上下文。 */
  const enableWebgl = useCallback((id: string): void => {
    if (!settingsRef.current.webgl) return
    if (webglAddonsRef.current.has(id)) return

    const terminal = terminalsRef.current.get(id)
    const container = containersRef.current.get(id)

    if (!terminal || !container) return
    if (container.clientWidth === 0 || container.clientHeight === 0) return

    try {
      const addon = new WebglAddon()

      addon.onContextLoss(() => {
        try {
          addon.dispose()
        } catch {
          // 忽略重复释放。
        }
        webglAddonsRef.current.delete(id)
      })
      terminal.loadAddon(addon)
      webglAddonsRef.current.set(id, addon)
    } catch {
      // WebGL 不可用时保持 DOM 渲染。
    }
  }, [])

  const disableWebgl = useCallback((id: string): void => {
    const addon = webglAddonsRef.current.get(id)

    if (!addon) return

    webglAddonsRef.current.delete(id)

    try {
      addon.dispose()
    } catch {
      // 终端可能已经销毁。
    }
  }, [])

  /** 应用终端外观设置；shell 只影响新会话，其他项实时生效。 */
  const applySettings = useCallback(
    (settings: TerminalSettings): void => {
      settingsRef.current = settings

      for (const terminal of terminalsRef.current.values()) {
        terminal.options.fontFamily = settings.fontFamily
        terminal.options.fontSize = settings.fontSize
        terminal.options.scrollback = settings.scrollback
      }

      if (!settings.webgl) {
        for (const id of [...webglAddonsRef.current.keys()]) disableWebgl(id)
      }

      if (settingsFrameRef.current !== null) {
        cancelAnimationFrame(settingsFrameRef.current)
      }

      settingsFrameRef.current = requestAnimationFrame(() => {
        settingsFrameRef.current = null

        const id = activeIdRef.current

        if (!id) return

        const terminal = terminalsRef.current.get(id)
        const fitAddon = fitAddonsRef.current.get(id)
        const page = pageRef.current

        if (!terminal || !fitAddon) return
        if (!page || page.clientWidth === 0 || page.clientHeight === 0) return

        try {
          fitAddon.fit()
        } catch {
          return
        }

        window.electron.resizeTerminal(id, terminal.cols, terminal.rows)

        if (settings.webgl) enableWebgl(id)
      })
    },
    [disableWebgl, enableWebgl]
  )

  useEffect(() => {
    let cancelled = false

    window.electron
      .getTerminalSettings()
      .then((settings) => {
        if (!cancelled) applySettings(settings)
      })
      .catch(() => undefined)

    const unsubscribe = window.electron.onTerminalSettingsChange((settings) => {
      applySettings(settings)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [applySettings])

  /**
   * 将 xterm 实例挂载到标签容器。
   * 会话本身由主进程持有，重复挂载只会重建展示层。
   */
  const mountTerminal = useCallback((id: string): void => {
    const info = infosRef.current.get(id)
    const container = containersRef.current.get(id)

    if (!info || !container || terminalsRef.current.has(id)) return

    const terminal = new Terminal({
      cols: info.cols,
      rows: info.rows,
      fontFamily: settingsRef.current.fontFamily,
      fontSize: settingsRef.current.fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: settingsRef.current.scrollback,
      theme: TERMINAL_THEME
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(
      new WebLinksAddon((_event, uri) => {
        if (/^https?:\/\//i.test(uri)) {
          void window.electron.openEmbeddedBrowser(uri)
          return
        }

        void window.electron.openExternalUrl(uri).catch(() => undefined)
      })
    )
    terminal.open(container)

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      // macOS 终端习惯用 Cmd+K 清屏，避免被全局快速访问快捷键抢走。
      const isClearShortcut =
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'

      if (isClearShortcut) {
        event.preventDefault()
        event.stopPropagation()
        terminal.clear()

        return false
      }

      const isCopyShortcut = IS_MAC
        ? event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'c'
        : event.ctrlKey &&
          event.shiftKey &&
          !event.metaKey &&
          !event.altKey &&
          event.key.toLowerCase() === 'c'

      if (isCopyShortcut) {
        const selection = terminal.getSelection()

        if (!selection) return true

        event.preventDefault()
        event.stopPropagation()
        void copyToClipboard(selection)

        return false
      }

      const isPasteShortcut = IS_MAC
        ? event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey &&
          event.key.toLowerCase() === 'v'
        : IS_WINDOWS
          ? event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey &&
            event.key.toLowerCase() === 'v'
          : event.ctrlKey &&
            event.shiftKey &&
            !event.metaKey &&
            !event.altKey &&
            event.key.toLowerCase() === 'v'

      if (isPasteShortcut) {
        event.preventDefault()
        event.stopPropagation()
        void window.electron
          .readTerminalClipboard()
          .then((text) => {
            if (text) pasteIntoTerminal(id, text)
          })
          .catch(() => undefined)

        return false
      }

      const isFindShortcut =
        (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
        event.key.toLowerCase() === 'f'

      if (!isFindShortcut) return true

      event.preventDefault()
      event.stopPropagation()
      setSearchOpen((current) => !current)

      return false
    })

    terminal.registerLinkProvider({
      provideLinks: (y, callback) => {
        const buffer = terminal.buffer.active
        const lineIndex = y - 1
        const line = buffer.getLine(lineIndex)

        if (!line) {
          callback(undefined)
          return
        }

        // 找到逻辑行的第一段，把自动换行拼回一行再匹配路径。
        let firstLine = lineIndex

        while (
          firstLine > 0 &&
          lineIndex - firstLine < MAX_LINK_LINE_COUNT
        ) {
          const current = buffer.getLine(firstLine)

          if (!current || !current.isWrapped) break

          firstLine--
        }

        const parts: Array<{ lineNumber: number; text: string }> = []
        let cursor = firstLine

        while (parts.length < MAX_LINK_LINE_COUNT) {
          const current = buffer.getLine(cursor)

          if (!current) break

          parts.push({
            lineNumber: cursor,
            text: current.translateToString(true)
          })

          const next = buffer.getLine(cursor + 1)

          if (!next || !next.isWrapped) break

          cursor++
        }

        const text = parts.map((part) => part.text).join('')
        const locate = (offset: number): { x: number; y: number } | null => {
          let consumed = 0

          for (const part of parts) {
            const length = part.text.length

            if (offset < consumed + length) {
              return {
                x: offset - consumed + 1,
                y: part.lineNumber + 1
              }
            }

            consumed += length
          }

          return null
        }
        const links: Array<{
          range: {
            start: { x: number; y: number }
            end: { x: number; y: number }
          }
          text: string
          activate: () => void
        }> = []

        TERMINAL_PATH_PATTERN.lastIndex = 0

        let match: RegExpExecArray | null

        while ((match = TERMINAL_PATH_PATTERN.exec(text))) {
          const raw = match[0].replace(/[.,;:!?)\]}]+$/, '')

          if (raw.length < 2) continue

          const start = locate(match.index)
          const end = locate(match.index + raw.length - 1)

          if (!start || !end) continue
          // 只在路径起始行注册链接，避免换行后重复。
          if (start.y !== y) continue

          links.push({
            range: { start, end },
            text: raw,
            activate: () => {
              void window.electron.openTerminalPath(raw).catch(() => {
                message.error('路径不存在或无法打开')
              })
            }
          })
        }

        callback(links.length > 0 ? links : undefined)
      }
    })

    terminal.onData((data) => {
      window.electron.writeTerminal(id, data)
    })

    terminal.onSelectionChange(() => {
      if (!settingsRef.current.copyOnSelect) return

      const existing = selectionTimersRef.current.get(id)

      if (existing !== undefined) window.clearTimeout(existing)

      const timer = window.setTimeout(() => {
        selectionTimersRef.current.delete(id)

        if (!settingsRef.current.copyOnSelect) return
        if (!terminalsRef.current.has(id)) return

        try {
          const selection = terminal.getSelection()

          if (selection.trim()) {
            void copyToClipboard(selection)
          }
        } catch {
          // 终端销毁瞬间读取选区可能失败。
        }
      }, 180)

      selectionTimersRef.current.set(id, timer)
    })

    // 跟随 shell 或 TUI 通过 OSC 0/2 设置的标题，保持标签名有意义。
    terminal.onTitleChange((title) => {
      const normalized = title.trim()
      const tab = tabsRef.current.find((item) => item.id === id)

      if (!normalized || tab?.customTitle) return

      const nextTitle = normalized.slice(0, 60)

      setTabs((current) =>
        current.map((item) =>
          item.id === id ? { ...item, title: nextTitle } : item
        )
      )
      window.electron.updateTerminalTitle(id, nextTitle, false)
    })

    terminalsRef.current.set(id, terminal)
    fitAddonsRef.current.set(id, fitAddon)
    searchAddonsRef.current.set(id, searchAddon)

    requestAnimationFrame(() => {
      if (!terminalsRef.current.has(id)) return

      const page = pageRef.current

      // 页面切换时容器宽度为 0，等待 ResizeObserver 在重新可见后调整。
      if (!page || page.clientWidth === 0 || page.clientHeight === 0) return

      try {
        fitAddon.fit()
      } catch {
        return
      }

      window.electron.resizeTerminal(id, terminal.cols, terminal.rows)

      if (activeIdRef.current === id) terminal.focus()
    })
  }, [copyToClipboard, message, pasteIntoTerminal])

  /** 为每个标签维护稳定的 ref 回调，避免每次渲染都重新挂载容器。 */
  const getContainerRef = useCallback(
    (id: string): ((node: HTMLDivElement | null) => void) => {
      const existing = containerRefCallbacks.current.get(id)

      if (existing) return existing

      const callback = (node: HTMLDivElement | null): void => {
        if (!node) {
          containersRef.current.delete(id)
          return
        }

        containersRef.current.set(id, node)
        mountTerminal(id)
      }

      containerRefCallbacks.current.set(id, callback)

      return callback
    },
    [mountTerminal]
  )

  useEffect(() => {
    let cancelled = false
    const offData = window.electron.onTerminalData(({ id, data }) => {
      terminalsRef.current.get(id)?.write(data)
    })
    const offExit = window.electron.onTerminalExit(({ id }) => {
      const terminal = terminalsRef.current.get(id)

      terminal?.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n')
      setTabs((current) =>
        current.map((tab) =>
          tab.id === id ? { ...tab, exited: true } : tab
        )
      )
    })

    window.electron
      .restoreTerminals()
      .then((sessions) => {
        if (cancelled) return

        for (const session of sessions) infosRef.current.set(session.id, session)

        const nextTabs = sessions.map((session) => ({
          id: session.id,
          title: session.title,
          customTitle: session.customTitle,
          exited: false
        }))

        tabsRef.current = nextTabs
        setTabs(nextTabs)
        setActiveId(nextTabs[0]?.id ?? null)
        setReady(true)
      })
      .catch((error) => {
        if (cancelled) return

        setReady(true)
        message.error(getErrorMessage(error, '读取终端会话失败'))
      })

    return () => {
      cancelled = true
      offData()
      offExit()

      for (const timer of selectionTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      selectionTimersRef.current.clear()
      if (settingsFrameRef.current !== null) {
        cancelAnimationFrame(settingsFrameRef.current)
        settingsFrameRef.current = null
      }

      for (const addon of webglAddonsRef.current.values()) addon.dispose()
      for (const terminal of terminalsRef.current.values()) terminal.dispose()

      terminalsRef.current.clear()
      fitAddonsRef.current.clear()
      searchAddonsRef.current.clear()
      webglAddonsRef.current.clear()
      containersRef.current.clear()
      containerRefCallbacks.current.clear()
    }
  }, [message])

  useEffect(() => {
    const element = pageRef.current

    if (!element) return

    const observer = new ResizeObserver(() => {
      const id = activeIdRef.current

      if (!id) return

      const terminal = terminalsRef.current.get(id)
      const fitAddon = fitAddonsRef.current.get(id)
      const page = pageRef.current

      if (!terminal || !fitAddon) return
      if (!page || page.clientWidth === 0 || page.clientHeight === 0) return

      try {
        fitAddon.fit()
      } catch {
        return
      }

      window.electron.resizeTerminal(id, terminal.cols, terminal.rows)
      enableWebgl(id)
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [enableWebgl])

  useEffect(() => {
    activeIdRef.current = activeId

    if (!activeId) return

    // 切换标签时先清掉旧的搜索高亮，搜索面板打开时会自动在新标签重新查找。
    for (const addon of searchAddonsRef.current.values()) {
      addon.clearDecorations()
    }

    // 只保留活动标签的 WebGL 上下文，避免多个 xterm 同时占用 GPU 资源。
    for (const id of [...webglAddonsRef.current.keys()]) {
      if (id !== activeId) disableWebgl(id)
    }

    const frame = requestAnimationFrame(() => {
      const terminal = terminalsRef.current.get(activeId)
      const fitAddon = fitAddonsRef.current.get(activeId)
      const page = pageRef.current

      if (!terminal || !fitAddon) return
      if (!page || page.clientWidth === 0 || page.clientHeight === 0) return

      try {
        fitAddon.fit()
      } catch {
        return
      }

      window.electron.resizeTerminal(activeId, terminal.cols, terminal.rows)
      enableWebgl(activeId)
      if (!searchOpen) terminal.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [activeId, disableWebgl, enableWebgl, tabs.length, searchOpen])

  useEffect(() => {
    if (!searchOpen) return

    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })

    return () => cancelAnimationFrame(frame)
  }, [searchOpen])

  const runSearch = useCallback(
    (direction: 'next' | 'previous'): boolean => {
      const id = activeIdRef.current
      const term = searchTerm

      if (!id || !term) {
        setSearchNoResult(false)
        return false
      }

      const addon = searchAddonsRef.current.get(id)

      if (!addon) return false

      try {
        const found =
          direction === 'next'
            ? addon.findNext(term, { incremental: true, caseSensitive: false })
            : addon.findPrevious(term, {
              incremental: true,
              caseSensitive: false
            })

        setSearchNoResult(!found)

        return found
      } catch {
        return false
      }
    },
    [searchTerm]
  )

  useEffect(() => {
    if (!searchOpen) return

    if (!searchTerm) {
      const id = activeIdRef.current

      if (id) searchAddonsRef.current.get(id)?.clearDecorations()

      setSearchNoResult(false)
      return
    }

    const frame = requestAnimationFrame(() => {
      runSearch('next')
    })

    return () => cancelAnimationFrame(frame)
  }, [activeId, runSearch, searchOpen, searchTerm])

  const closeSearch = useCallback((focusTerminal = true): void => {
    setSearchOpen(false)
    setSearchTerm('')
    setSearchNoResult(false)

    const id = activeIdRef.current

    if (!id) return

    searchAddonsRef.current.get(id)?.clearDecorations()
    if (focusTerminal) terminalsRef.current.get(id)?.focus()
  }, [])

  useEffect(() => {
    if (!contextMenu && !tabContextMenu) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return

      setContextMenu(null)
      setTabContextMenu(null)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenu, tabContextMenu])

  const handleCreate = useCallback(
    async (input?: TerminalCreateInput): Promise<void> => {
      if (creatingRef.current) return

      creatingRef.current = true
      setCreating(true)

      try {
        const info = await window.electron.createTerminal(input ?? {})
        infosRef.current.set(info.id, info)

        const nextTabs = [
          ...tabsRef.current,
          {
            id: info.id,
            title: info.title,
            customTitle: info.customTitle,
            exited: false
          }
        ]

        tabsRef.current = nextTabs
        setTabs(nextTabs)
        setActiveId(info.id)
      } catch (error) {
        message.error(getErrorMessage(error, '创建终端失败'))
      } finally {
        creatingRef.current = false
        setCreating(false)
      }
    },
    [message]
  )

  /** 选择目录后在该目录新建终端。 */
  const handleCreateWithDirectory = useCallback(async (): Promise<void> => {
    if (creatingRef.current) return

    try {
      const cwd = await window.electron.selectTerminalDirectory()

      if (!cwd) return

      await handleCreate({ cwd })
    } catch (error) {
      message.error(getErrorMessage(error, '选择目录失败'))
    }
  }, [handleCreate, message])

  const handleTerminalDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      setDragOver(false)

      const id = activeIdRef.current
      const terminal = id ? terminalsRef.current.get(id) : null

      if (!terminal) return

      const paths: string[] = []

      for (const file of Array.from(event.dataTransfer.files)) {
        try {
          const path = window.electron.getPathForFile(file)

          if (path) paths.push(path)
        } catch {
          // 单个文件取路径失败时跳过。
        }
      }

      if (paths.length === 0) return

      terminal.paste(paths.map(quoteShellPath).join(' '))
      terminal.focus()
    },
    []
  )

  const disposeTab = useCallback((id: string): void => {
    window.electron.closeTerminal(id)

    const selectionTimer = selectionTimersRef.current.get(id)

    if (selectionTimer !== undefined) window.clearTimeout(selectionTimer)
    selectionTimersRef.current.delete(id)

    webglAddonsRef.current.get(id)?.dispose()
    webglAddonsRef.current.delete(id)
    terminalsRef.current.get(id)?.dispose()
    terminalsRef.current.delete(id)
    fitAddonsRef.current.delete(id)
    searchAddonsRef.current.delete(id)
    containersRef.current.delete(id)
    containerRefCallbacks.current.delete(id)
    infosRef.current.delete(id)
  }, [])

  const handleCloseTabs = useCallback(
    (ids: string[]): void => {
      if (ids.length === 0) return

      const targets = new Set(ids)

      for (const id of targets) disposeTab(id)

      const nextTabs = tabsRef.current.filter((tab) => !targets.has(tab.id))

      tabsRef.current = nextTabs
      setTabs(nextTabs)
      setTabContextMenu(null)
      setActiveId((current) =>
        current && targets.has(current)
          ? nextTabs[nextTabs.length - 1]?.id ?? null
          : current
      )
    },
    [disposeTab]
  )

  const handleClose = useCallback(
    (id: string): void => {
      handleCloseTabs([id])
    },
    [handleCloseTabs]
  )

  const startRename = useCallback((tab: TerminalTab): void => {
    renameCancelledRef.current = false
    setRenamingTabId(tab.id)
    setRenameDraft(tab.title)
    setTabContextMenu(null)
  }, [])

  const cancelRename = useCallback((): void => {
    renameCancelledRef.current = true
    setRenamingTabId(null)
    setRenameDraft('')
  }, [])

  const commitRename = useCallback((): void => {
    const id = renamingTabId

    if (!id) return

    if (renameCancelledRef.current) {
      renameCancelledRef.current = false
      setRenamingTabId(null)
      setRenameDraft('')
      return
    }

    const title = renameDraft.trim()

    setRenamingTabId(null)
    setRenameDraft('')

    if (!title) return

    setTabs((current) =>
      current.map((tab) =>
        tab.id === id ? { ...tab, title, customTitle: true } : tab
      )
    )
    window.electron.updateTerminalTitle(id, title, true)
  }, [renameDraft, renamingTabId])

  const resetTabTitle = useCallback((id: string): void => {
    setTabContextMenu(null)
    setTabs((current) =>
      current.map((tab) =>
        tab.id === id
          ? { ...tab, title: DEFAULT_TERMINAL_TITLE, customTitle: false }
          : tab
      )
    )
    window.electron.updateTerminalTitle(id, DEFAULT_TERMINAL_TITLE, false)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent): void => {
    const { active, over } = event

    if (!over || active.id === over.id) return

    const current = tabsRef.current
    const oldIndex = current.findIndex((tab) => tab.id === active.id)
    const newIndex = current.findIndex((tab) => tab.id === over.id)

    if (oldIndex < 0 || newIndex < 0) return

    const nextTabs = arrayMove(current, oldIndex, newIndex)

    tabsRef.current = nextTabs
    setTabs(nextTabs)
    window.electron.reorderTerminals(nextTabs.map((tab) => tab.id))
  }, [])

  const handleTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, id: string): void => {
      event.preventDefault()
      event.stopPropagation()
      setContextMenu(null)
      setTabContextMenu({
        id,
        x: Math.max(
          8,
          Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8)
        ),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8)
        )
      })
    },
    []
  )

  const handleTabContextAction = useCallback(
    (
      action:
        | 'rename'
        | 'reset-title'
        | 'close'
        | 'close-others'
        | 'close-right'
    ): void => {
      const menu = tabContextMenu

      if (!menu) return

      const tab = tabsRef.current.find((item) => item.id === menu.id)

      setTabContextMenu(null)

      if (!tab) return

      switch (action) {
        case 'rename':
          startRename(tab)
          break
        case 'reset-title':
          resetTabTitle(tab.id)
          break
        case 'close':
          handleClose(tab.id)
          break
        case 'close-others':
          handleCloseTabs(
            tabsRef.current
              .filter((item) => item.id !== tab.id)
              .map((item) => item.id)
          )
          break
        case 'close-right': {
          const index = tabsRef.current.findIndex((item) => item.id === tab.id)

          if (index >= 0) {
            handleCloseTabs(
              tabsRef.current.slice(index + 1).map((item) => item.id)
            )
          }
          break
        }
      }
    },
    [handleClose, handleCloseTabs, resetTabTitle, startRename, tabContextMenu]
  )

  // 没有终端时直接补一个默认会话，不展示空状态；失败时可用工具栏的 + 重试。
  useEffect(() => {
    if (tabs.length > 0) {
      emptyAutoCreateRef.current = false
      return
    }

    if (!ready || creating || emptyAutoCreateRef.current) return

    emptyAutoCreateRef.current = true
    void handleCreate()
  }, [creating, handleCreate, ready, tabs.length])

  const handleContextAction = useCallback(
    async (
      action:
        | 'copy'
        | 'paste'
        | 'select-all'
        | 'clear'
        | 'new-tab'
        | 'close-tab'
    ): Promise<void> => {
      const menu = contextMenu

      if (!menu) return

      const terminal = terminalsRef.current.get(menu.id)

      setContextMenu(null)

      switch (action) {
        case 'copy': {
          const text = terminal?.getSelection() ?? ''

          if (text) await copyToClipboard(text)
          terminal?.clearSelection()
          break
        }
        case 'paste': {
          const text = await window.electron
            .readTerminalClipboard()
            .catch(() => '')

          if (text) pasteIntoTerminal(menu.id, text)
          break
        }
        case 'select-all':
          terminal?.selectAll()
          break
        case 'clear':
          terminal?.clear()
          break
        case 'new-tab':
          await handleCreate()
          return
        case 'close-tab':
          handleClose(menu.id)
          return
      }

      terminal?.focus()
    },
    [contextMenu, copyToClipboard, handleClose, handleCreate, pasteIntoTerminal]
  )

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, id: string): void => {
      event.preventDefault()
      setContextMenu({
        id,
        x: Math.max(
          8,
          Math.min(event.clientX, window.innerWidth - CONTEXT_MENU_WIDTH - 8)
        ),
        y: Math.max(
          8,
          Math.min(event.clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - 8)
        )
      })
    },
    []
  )

  const contextTerminal = contextMenu
    ? terminalsRef.current.get(contextMenu.id)
    : null
  const canCopy = Boolean(contextTerminal?.hasSelection())
  const contextTab = tabContextMenu
    ? tabs.find((tab) => tab.id === tabContextMenu.id) ?? null
    : null
  const contextTabIndex = contextTab
    ? tabs.findIndex((tab) => tab.id === contextTab.id)
    : -1

  return (
    <div
      className="terminal-page"
      ref={pageRef}
      onKeyDown={(event) => {
        const isFindShortcut =
          (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
          event.key.toLowerCase() === 'f'

        if (!isFindShortcut) return

        event.preventDefault()
        setSearchOpen((current) => !current)
      }}
    >
      <ConfigProvider theme={TERMINAL_DARK_THEME}>
      <div className="terminal-tabs">
        <Tooltip title="搜索（⌘/Ctrl+F）">
          <Button
            type="text"
            size="small"
            className="terminal-toolbar-button terminal-search-toggle"
            icon={<SearchOutlined />}
            aria-label="搜索终端内容"
            onClick={() => setSearchOpen(true)}
          />
        </Tooltip>

        <div className="terminal-tab-list" role="tablist" aria-label="终端标签">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeId}
                  renaming={tab.id === renamingTabId}
                  renameDraft={renameDraft}
                  onSelect={() => setActiveId(tab.id)}
                  onClose={() => handleClose(tab.id)}
                  onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
                  onStartRename={() => startRename(tab)}
                  onRenameDraftChange={setRenameDraft}
                  onRenameCommit={commitRename}
                  onRenameCancel={cancelRename}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <Tooltip title="新建终端">
          <Button
            type="text"
            size="small"
            className="terminal-toolbar-button terminal-new-tab"
            icon={<PlusOutlined />}
            loading={creating}
            aria-label="新建终端"
            onClick={() => void handleCreate()}
          />
        </Tooltip>

        <Tooltip title="在指定目录新建终端">
          <Button
            type="text"
            size="small"
            className="terminal-toolbar-button terminal-new-tab-directory"
            icon={<FolderOpenOutlined />}
            aria-label="在指定目录新建终端"
            onClick={() => void handleCreateWithDirectory()}
          />
        </Tooltip>
      </div>

      <div
        className={`terminal-body${dragOver ? ' is-drag-over' : ''}`}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return

          event.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return

          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDragOver(true)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return

          setDragOver(false)
        }}
        onDrop={handleTerminalDrop}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={getContainerRef(tab.id)}
            className={`terminal-host${
              tab.id === activeId ? ' is-active' : ''
            }`}
            onContextMenu={(event) => handleContextMenu(event, tab.id)}
          />
        ))}

        {dragOver ? (
          <div className="terminal-drop-overlay">松开以插入文件路径</div>
        ) : null}

        {searchOpen ? (
          <div className="terminal-search">
              <Input
                ref={searchInputRef}
                size="small"
                value={searchTerm}
                placeholder="搜索终端内容"
                prefix={<SearchOutlined />}
                status={searchNoResult ? 'error' : undefined}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeSearch()
                    return
                  }

                  if (event.key === 'Enter') {
                    event.preventDefault()
                    runSearch(event.shiftKey ? 'previous' : 'next')
                  }
                }}
              />
              {searchNoResult ? (
                <span className="terminal-search-empty">无结果</span>
              ) : null}
              <Tooltip title="上一个">
                <Button
                  type="text"
                  size="small"
                  icon={<UpOutlined />}
                  aria-label="上一个匹配"
                  onClick={() => runSearch('previous')}
                />
              </Tooltip>
              <Tooltip title="下一个">
                <Button
                  type="text"
                  size="small"
                  icon={<DownOutlined />}
                  aria-label="下一个匹配"
                  onClick={() => runSearch('next')}
                />
              </Tooltip>
              <Tooltip title="关闭">
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  aria-label="关闭搜索"
                  onClick={() => closeSearch()}
                />
              </Tooltip>
          </div>
        ) : null}

        {!ready || (creating && tabs.length === 0) ? (
          <div className="terminal-empty">
            <Spin />
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <>
          <div
            className="terminal-context-backdrop"
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu(null)
            }}
          />
          <div
            className="terminal-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="terminal-context-item"
              disabled={!canCopy}
              onClick={() => void handleContextAction('copy')}
            >
              复制
            </button>
            <button
              type="button"
              className="terminal-context-item"
              onClick={() => void handleContextAction('paste')}
            >
              粘贴
            </button>
            <button
              type="button"
              className="terminal-context-item"
              onClick={() => void handleContextAction('select-all')}
            >
              全选
            </button>
            <button
              type="button"
              className="terminal-context-item"
              onClick={() => void handleContextAction('clear')}
            >
              清屏
            </button>
            <div className="terminal-context-divider" />
            <button
              type="button"
              className="terminal-context-item"
              onClick={() => void handleContextAction('new-tab')}
            >
              新建标签
            </button>
            <button
              type="button"
              className="terminal-context-item is-danger"
              onClick={() => void handleContextAction('close-tab')}
            >
              关闭标签
            </button>
          </div>
        </>
      ) : null}

      {tabContextMenu ? (
        <>
          <div
            className="terminal-context-backdrop"
            onMouseDown={() => setTabContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setTabContextMenu(null)
            }}
          />
          <div
            className="terminal-context-menu"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          >
            <button
              type="button"
              className="terminal-context-item"
              onClick={() => handleTabContextAction('rename')}
            >
              重命名
            </button>
            {contextTab?.customTitle ? (
              <button
                type="button"
                className="terminal-context-item"
                onClick={() => handleTabContextAction('reset-title')}
              >
                恢复默认名称
              </button>
            ) : null}
            <div className="terminal-context-divider" />
            <button
              type="button"
              className="terminal-context-item"
              onClick={() => handleTabContextAction('close')}
            >
              关闭
            </button>
            <button
              type="button"
              className="terminal-context-item"
              disabled={tabs.length <= 1}
              onClick={() => handleTabContextAction('close-others')}
            >
              关闭其他
            </button>
            <button
              type="button"
              className="terminal-context-item"
              disabled={
                contextTabIndex < 0 || contextTabIndex >= tabs.length - 1
              }
              onClick={() => handleTabContextAction('close-right')}
            >
              关闭右侧
            </button>
          </div>
        </>
      ) : null}
      </ConfigProvider>
    </div>
  )
}
