import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  BugOutlined,
  CloseOutlined,
  CompressOutlined,
  DownloadOutlined,
  ExpandOutlined,
  ExportOutlined,
  GlobalOutlined,
  LinkOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { App as AntdApp, Button, Popconfirm } from 'antd'
import EmbeddedBrowserDownloads from '../EmbeddedBrowserDownloads/EmbeddedBrowserDownloads'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserDownload,
  EmbeddedBrowserState
} from '../../../../types/embedded-browser'

const PANEL_WIDTH_KEY = 'embedded-browser-panel-width'
const MIN_PANEL_WIDTH = 360

/**
 * 面板宽度限制在 360px 到窗口宽度的 90% 之间。
 */
const clampPanelWidth = (value: number): number =>
  Math.max(
    MIN_PANEL_WIDTH,
    Math.min(value, window.innerWidth * 0.9)
  )

interface EmbeddedBrowserPanelProps {
  /** 应用层维护的下载列表。 */
  downloads: EmbeddedBrowserDownload[]

  /** 是否展开底部下载抽屉。 */
  downloadsOpen: boolean

  /** 关闭底部下载抽屉。 */
  onCloseDownloads: () => void
}

/**
 * 应用内浏览器。
 * 所有外部链接统一在这个面板中打开，不调用系统浏览器。
 */
export default function EmbeddedBrowserPanel({
  downloads,
  downloadsOpen,
  onCloseDownloads
}: EmbeddedBrowserPanelProps): JSX.Element | null {
  const { message } = AntdApp.useApp()
  const [state, setState] = useState<EmbeddedBrowserState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY))

    return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : null
  })
  const panelRef = useRef<HTMLElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const previousVisibleRef = useRef<boolean | null>(null)
  const openingBoundsRef = useRef<EmbeddedBrowserBounds | null>(null)
  const lastBoundsRef = useRef('')
  const closingRef = useRef(false)

  useEffect(() => {
    // 兼容旧版本留下的抑制状态；新逻辑下浏览器始终显示在最上层。
    window.electron.setEmbeddedBrowserSuppressed(false).catch(() => undefined)
  }, [])

  useEffect(() => {
    let mounted = true

    window.electron
      .getEmbeddedBrowserState()
      .then((next) => {
        if (mounted && next) setState(next)
      })
      .catch(() => undefined)

    const unsubscribe = window.electron.onEmbeddedBrowserState((next) => {
      setState(next)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    // 收起动画期间重新激活任意页面（包括同一页），取消旧面板的退出样式。
    closingRef.current = false
    setClosing(false)
  }, [state?.activeTabId, state?.activationVersion])

  useEffect(() => {
    // 只滚动标签栏，避免 scrollIntoView 连带移动整个浏览器面板。
    const strip = tabsRef.current
    const active = strip?.querySelector<HTMLElement>('.embedded-browser-tab.is-active')
    if (!strip || !active) return
    const parentBounds = strip.getBoundingClientRect()
    const bounds = active.getBoundingClientRect()
    if (bounds.left < parentBounds.left) strip.scrollLeft -= parentBounds.left - bounds.left + 12
    else if (bounds.right > parentBounds.right) strip.scrollLeft += bounds.right - parentBounds.right + 12
  }, [state?.activeTabId, state?.visible, state?.tabs.length, expanded, panelWidth])

  useEffect(() => {
    if (!state?.visible) {
      setExpanded(false)
      closingRef.current = false
      setClosing(false)
    }
  }, [state?.visible])

  // 打开动画开始前先记录未偏移的目标准位置，
  // 否则面板 transform 后会量到错误的 bounds。
  useLayoutEffect(() => {
    const previousVisible = previousVisibleRef.current

    previousVisibleRef.current = Boolean(state?.visible)

    if (!state?.visible) {
      openingBoundsRef.current = null
      lastBoundsRef.current = ''
      setOpening(false)
      return
    }

    if (previousVisible !== false) return

    const element = viewportRef.current

    if (element) {
      const rect = element.getBoundingClientRect()

      openingBoundsRef.current = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      }
      lastBoundsRef.current = ''
    }

    setOpening(true)

    const timer = window.setTimeout(() => {
      setOpening(false)
    }, 220)

    return () => {
      window.clearTimeout(timer)
    }
  }, [state?.visible])

  /** 复制当前页面链接。 */
  const handleCopyUrl = async (): Promise<void> => {
    if (!state?.url) return

    try {
      await window.electron.copyText(state.url)
      message.success('链接已复制')
    } catch {
      message.error('复制链接失败')
    }
  }

  /**
   * 关闭必须由渲染层触发，才能同时播放面板滑出动画。
   */
  const requestClose = (): void => {
    if (closingRef.current) return

    closingRef.current = true
    setOpening(false)
    setClosing(true)
    window.electron.closeEmbeddedBrowser()
  }

  // 轻舟登录完成后由主进程请求关闭浏览器面板。
  useEffect(() => {
    return window.electron.onEmbeddedBrowserCloseRequest(() => {
      requestClose()
    })
  }, [])

  // Esc 关闭面板。
  useEffect(() => {
    if (!state?.visible) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return

      event.preventDefault()
      requestClose()
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [state?.visible])

  // 点击面板外关闭；有可见弹窗时暂停处理，避免点击弹窗或遮罩中断浏览器流程。
  useEffect(() => {
    if (!state?.visible) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target

      if (target instanceof Node && panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.ant-popover')) return

      // 普通 Modal 和确认弹窗共用 wrap；用布局与可见性判断，排除未销毁的隐藏弹窗。
      const hasVisibleModal = Array.from(
        document.querySelectorAll<HTMLElement>('.ant-modal-wrap')
      ).some((element) => {
        if (element.getClientRects().length === 0) return false

        const visibility = window.getComputedStyle(element).visibility

        return visibility !== 'hidden' && visibility !== 'collapse'
      })

      if (hasVisibleModal) return

      requestClose()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [state?.visible])

  useEffect(() => {
    const handleResize = (): void => {
      setPanelWidth((current) =>
        current === null ? null : clampPanelWidth(current)
      )
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  /**
   * 拖拽左边缘调整宽度，原生视图通过 ResizeObserver 跟随。
   */
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!state?.visible) resizeCleanupRef.current?.()
    return () => resizeCleanupRef.current?.()
  }, [state?.visible])
  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    resizeCleanupRef.current?.()
    event.preventDefault()

    const startX = event.clientX
    const startWidth =
      panelRef.current?.getBoundingClientRect().width ?? MIN_PANEL_WIDTH

    const handleMove = (moveEvent: PointerEvent): void => {
      setPanelWidth(
        clampPanelWidth(startWidth + startX - moveEvent.clientX)
      )
    }

    const handleUp = (): void => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      resizeCleanupRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      const width = panelRef.current?.getBoundingClientRect().width

      if (width) localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)))
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    resizeCleanupRef.current = handleUp
  }

  // 将占位区域的屏幕位置同步给主进程，原生 WebContentsView 不能使用 CSS 定位。
  useEffect(() => {
    const element = viewportRef.current

    if (!state?.visible || !element) return

    const updateBounds = (): void => {
      // 关闭期间由主进程独立播放原生视图滑出动画，不能再回写 bounds。
      if (closingRef.current) return

      const rect = element.getBoundingClientRect()
      const next = opening
        ? openingBoundsRef.current
        : {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height
          }

      if (!next) return

      // 重复的 ResizeObserver 回调不应打断主进程滑入动画。
      const key = [next.x, next.y, next.width, next.height].join(':')

      if (lastBoundsRef.current === key) return

      lastBoundsRef.current = key
      window.electron.setEmbeddedBrowserBounds(next)
    }

    updateBounds()

    const observer = new ResizeObserver(updateBounds)
    observer.observe(element)
    window.addEventListener('resize', updateBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [expanded, opening, state?.visible])

  if (!state?.visible) return null

  let host = ''

  if (state.url) {
    try {
      host = new URL(state.url).hostname
    } catch {
      host = ''
    }
  }

  return (
    <>
      <div
        className={`embedded-browser-mask${closing ? ' is-closing' : ''}`}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        className={`embedded-browser-panel${expanded ? ' is-expanded' : ''}${
          opening ? ' is-opening' : ''
        }${closing ? ' is-closing' : ''}`}
        style={!expanded && panelWidth ? { width: `${panelWidth}px` } : undefined}
        aria-label="应用内浏览器"
      >
      {!expanded ? (
        <div
          className="embedded-browser-resize-handle"
          role="separator"
          aria-label="调整浏览器宽度"
          aria-orientation="vertical"
          onPointerDown={startResize}
        />
      ) : null}

      <div className="embedded-browser-toolbar">
        <div className="embedded-browser-nav">
          <Button
            type="text"
            size="small"
            icon={<ArrowLeftOutlined />}
            disabled={!state.canGoBack}
            aria-label="后退"
            onClick={() => window.electron.goBackEmbeddedBrowser()}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowRightOutlined />}
            disabled={!state.canGoForward}
            aria-label="前进"
            onClick={() => window.electron.goForwardEmbeddedBrowser()}
          />
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            loading={state.loading}
            aria-label="刷新"
            onClick={() => window.electron.reloadEmbeddedBrowser()}
          />
        </div>

        <div className="embedded-browser-location" title={state.url ?? undefined}>
          <GlobalOutlined />
          <div className="embedded-browser-location-copy">
            <span className="embedded-browser-title">
              {state.title || host || '网页'}
            </span>
            <span className="embedded-browser-host">{host || state.url || ''}</span>
          </div>
        </div>

        <div className="embedded-browser-actions">
          <Button
            type="text"
            size="small"
            icon={<BugOutlined />}
            aria-label="开发者工具"
            onClick={() => window.electron.toggleEmbeddedBrowserDevTools()}
          />
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            disabled={!state.url}
            aria-label="在默认浏览器打开"
            onClick={() => window.electron.openEmbeddedBrowserExternal()}
          />
          <Button
            type="text"
            size="small"
            icon={<LinkOutlined />}
            disabled={!state.url}
            aria-label="复制链接"
            onClick={() => handleCopyUrl()}
          />
          <Button
            type="text"
            size="small"
            icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
            aria-label={expanded ? '还原' : '最大化'}
            onClick={() => setExpanded((value) => !value)}
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            aria-label="收起浏览器并保留页面"
            title="收起浏览器并保留页面"
            onClick={requestClose}
          />
        </div>
      </div>

      <div className="embedded-browser-tabbar">
        <div ref={tabsRef} className="embedded-browser-tabs" role="tablist" aria-label="已打开页面">
          {state.tabs.map((tab) => (
            <div className={`embedded-browser-tab${tab.id === state.activeTabId ? ' is-active' : ''}`} key={tab.id}>
              <button type="button" role="tab" aria-selected={tab.id === state.activeTabId} title={tab.url ?? tab.title} onClick={() => window.electron.selectEmbeddedBrowserTab(tab.id)}>
                {tab.loading ? <ReloadOutlined spin /> : <GlobalOutlined />}
                <span>{tab.title}</span>
              </button>
              <Button type="text" size="small" icon={<CloseOutlined />} aria-label={`关闭页面 ${tab.title}`} onClick={() => window.electron.closeEmbeddedBrowserTab(tab.id)} />
            </div>
          ))}
        </div>
        <Popconfirm
          title="关闭所有标签页？"
          description="所有页面会被释放，未提交的页面内容将丢失。"
          okText="关闭全部"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => {
            void window.electron.closeAllEmbeddedBrowserTabs().catch(() => message.error('关闭所有标签页失败'))
          }}
        >
          <Button
            className="embedded-browser-close-all"
            type="text"
            size="small"
            title="关闭所有标签页并释放页面"
            aria-label="关闭所有标签页"
          >
            关闭全部
          </Button>
        </Popconfirm>
      </div>

      {state.error ? (
        <div className="embedded-browser-error">
          <span>{state.error}</span>
          <Button
            type="link"
            size="small"
            onClick={() => window.electron.reloadEmbeddedBrowser()}
          >
            重试
          </Button>
        </div>
      ) : null}

        <div ref={viewportRef} className="embedded-browser-viewport" />

        {downloadsOpen ? (
          <section className="embedded-browser-download-panel">
            <div className="embedded-browser-download-panel-head">
              <strong>
                <DownloadOutlined />
                下载管理
              </strong>
              <span className="embedded-browser-download-summary">
                {downloads.filter((item) => item.status === 'progressing').length > 0
                  ? `${
                      downloads.filter((item) => item.status === 'progressing').length
                    } 个下载中 · `
                  : ''}
                共 {downloads.length} 项
              </span>
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="关闭下载管理"
                onClick={onCloseDownloads}
              />
            </div>
            <EmbeddedBrowserDownloads downloads={downloads} />
          </section>
        ) : null}
      </aside>

    </>
  )
}
