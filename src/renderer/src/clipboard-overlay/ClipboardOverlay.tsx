import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileFilled,
  FolderFilled,
  PictureOutlined,
  SnippetsOutlined
} from '@ant-design/icons'
import { App, Spin } from 'antd'
import type {
  ClipboardHistoryItem,
  ClipboardHistoryState
} from '../../../types/clipboard-history'
import { getErrorMessage } from '../../../utils'
import './clipboard-overlay.css'

/** 历史时间显示为相对时间，超过一天显示日期。 */
const formatTime = (value: string): string => {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''

  const diff = Date.now() - timestamp
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`

  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 图片缩略图进入可视区域后再加载，避免一次读取全部原图。 */
function ImagePreview({ id }: { id: string }): JSX.Element {
  const [source, setSource] = useState<string | null>(null)
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    let cancelled = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return

        observer.disconnect()
        window.electron
          .getClipboardHistoryImage(id, 280)
          .then((value) => {
            if (!cancelled) setSource(value)
          })
          .catch(() => undefined)
      },
      { rootMargin: '120px' }
    )

    observer.observe(element)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [id])

  return (
    <span ref={containerRef} className="clipboard-card-image-slot">
      {source ? (
        <img className="clipboard-card-image" src={source} alt="" />
      ) : (
        <span className="clipboard-card-placeholder">
          <PictureOutlined />
        </span>
      )}
    </span>
  )
}

/** 按记录类型渲染文本、图片或文件摘要。 */
function ItemPreview({ item }: { item: ClipboardHistoryItem }): JSX.Element {
  if (item.type === 'image' && item.imageFile) {
    return <ImagePreview id={item.id} />
  }

  if (item.type === 'files' && item.files?.length) {
    const first = item.files[0]

    return (
      <div className="clipboard-card-files">
        <span
          className={`clipboard-file-tile${first.isDirectory ? ' is-folder' : ''}`}
        >
          {first.isDirectory ? <FolderFilled /> : <FileFilled />}
        </span>
        <span className="clipboard-file-info">
          <strong title={first.name}>{first.name}</strong>
          <span>
            {item.files.length > 1
              ? `等 ${item.files.length} 个文件`
              : first.isDirectory
                ? '文件夹'
                : '文件'}
          </span>
        </span>
      </div>
    )
  }

  return <div className="clipboard-card-text">{item.text}</div>
}

/** 底部类型标签，文本/图片/文件使用不同颜色圆点。 */
const getItemTypeLabel = (item: ClipboardHistoryItem): string => {
  if (item.type === 'image') return '图片'
  if (item.type === 'files') return '文件'
  return '文本'
}

const getItemMeta = (item: ClipboardHistoryItem): string => {
  if (item.type === 'image') {
    const size = item.imageWidth && item.imageHeight
      ? `${item.imageWidth}×${item.imageHeight}`
      : formatSize(item.size)
    return `${size} · ${formatTime(item.createdAt)}`
  }

  if (item.type === 'files') {
    return `${item.files?.length ?? 0} 个文件 · ${formatTime(item.createdAt)}`
  }

  return `${formatSize(item.size)} · ${formatTime(item.createdAt)}`
}

/**
 * 粘贴选择底部浮层。
 * 读取系统剪贴板提供的最近内容，方向键选择、Enter 粘贴、Esc 关闭。
 */
export default function ClipboardOverlay(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<ClipboardHistoryState | null>(null)
  // 用记录 ID 而不是下标保存选中项，新内容插入时不会改变用户的选择。
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 鼠标悬停只影响高亮和 Enter 的目标，不写入 selectedId，避免触发自动滚动。
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const items = state?.items ?? []
  const selectedIndex = items.findIndex((item) => item.id === selectedId)
  const activeId = hoverId ?? selectedId

  const load = useCallback(async (): Promise<void> => {
    try {
      setState(await window.electron.getClipboardHistoryState())
    } catch {
      // 浮层加载失败时保持上一份状态。
    }
  }, [])

  // 浮层展示期间持续订阅主进程状态，并用轻量通知同步设置页。
  useEffect(() => {
    void load()

    const unsubscribeState = window.electron.onClipboardHistoryState((next) => {
      setState(next)
    })
    const unsubscribeChanged = window.electron.onClipboardHistoryChanged(() => {
      void load()
    })
    const unsubscribeShown = window.electron.onClipboardHistoryShown(() => {
      // 重新打开时回到最新一条，后续状态更新不重置选择。
      setSelectedId(null)
      setHoverId(null)
      void load()
    })

    return () => {
      unsubscribeState()
      unsubscribeChanged()
      unsubscribeShown()
    }
  }, [load])

  // 浮层是独立窗口，需要手动同步主应用的主题。
  useEffect(() => {
    if (state?.theme) document.documentElement.dataset.theme = state.theme
  }, [state?.theme])

  // 选中项被删除或首次加载时，自动落到最新一条；已有选中项保持不变。
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }

    if (!selectedId || !items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id)
    }
  }, [items, selectedId])

  // 只在选中项变化时滚动，用户手动横向浏览时不会被新记录拉回。
  useEffect(() => {
    if (!selectedId) return
    cardRefs.current.get(selectedId)?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'center'
    })
  }, [selectedId])

  // 选中即写入剪贴板并隐藏浮层，主进程负责恢复焦点和发送粘贴按键。
  const paste = useCallback(
    async (item: ClipboardHistoryItem): Promise<void> => {
      if (busyId) return
      setBusyId(item.id)

      try {
        const result = await window.electron.pasteClipboardHistoryItem(item.id)
        if (!result.success && result.message) message.error(result.message)
      } catch (error) {
        message.error(getErrorMessage(error, '粘贴失败'))
      } finally {
        setBusyId(null)
      }
    },
    [busyId, message]
  )

  // 方向键在卡片间移动，Enter 粘贴，Esc 关闭；不使用方向键直接粘贴。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void window.electron.hideClipboardHistory()
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (items.length === 0) return
        // 键盘接管后取消悬停高亮，方向键才能继续移动。
        setHoverId(null)
        const next = Math.max(0, (selectedIndex < 0 ? 0 : selectedIndex) - 1)
        setSelectedId(items[next].id)
        return
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        if (items.length === 0) return
        setHoverId(null)
        const next = Math.min(items.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + 1)
        setSelectedId(items[next].id)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        const item =
          items.find((entry) => entry.id === activeId) ??
          (selectedIndex >= 0 ? items[selectedIndex] : items[0])
        if (item) void paste(item)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeId, items, paste, selectedIndex])

  return (
    <div className="clipboard-overlay">
      <div className="clipboard-overlay-panel">
        <div className="clipboard-overlay-head">
          <div className="clipboard-overlay-title">
            <span className="clipboard-overlay-mark">
              <SnippetsOutlined />
            </span>
            <strong>选择粘贴内容</strong>
          </div>
          <div className="clipboard-overlay-hints">
            <span>
              <kbd>←</kbd>
              <kbd>→</kbd>
              选择
            </span>
            <span>
              <kbd>Enter</kbd>
              粘贴
            </span>
            <span>
              <kbd>Esc</kbd>
              关闭
            </span>
          </div>
        </div>

        {state === null ? (
          <div className="clipboard-overlay-loading">
            <Spin size="small" />
          </div>
        ) : items.length === 0 ? (
          <div className="clipboard-overlay-empty">
            <SnippetsOutlined />
            <span>还没有可粘贴的内容</span>
          </div>
        ) : (
          <div className="clipboard-cards" onMouseLeave={() => setHoverId(null)}>
            {items.map((item) => (
              <div
                key={item.id}
                ref={(element) => {
                  if (element) cardRefs.current.set(item.id, element)
                  else cardRefs.current.delete(item.id)
                }}
                className={`clipboard-card${item.id === activeId ? ' is-active' : ''}`}
                onClick={() => void paste(item)}
                onMouseEnter={() => setHoverId(item.id)}
                role="button"
                tabIndex={-1}
                aria-label={`粘贴${getItemTypeLabel(item)} ${item.text?.slice(0, 40) ?? item.files?.[0]?.name ?? ''}`}
              >
                <div className="clipboard-card-body">
                  <ItemPreview item={item} />
                </div>
                <div className="clipboard-card-foot">
                  <span className={`clipboard-card-type is-${item.type}`}>
                    {getItemTypeLabel(item)}
                  </span>
                  <span className="clipboard-card-meta">{getItemMeta(item)}</span>
                </div>
                {busyId === item.id ? (
                  <span className="clipboard-card-busy">
                    <Spin size="small" />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
