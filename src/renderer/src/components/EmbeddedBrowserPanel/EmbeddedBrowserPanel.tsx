import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  CloseOutlined,
  CompressOutlined,
  DownloadOutlined,
  ExpandOutlined,
  GlobalOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { Button } from 'antd'
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
  const [state, setState] = useState<EmbeddedBrowserState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)
  const [panelWidth, setPanelWidth] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY))

    return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : null
  })
  const panelRef = useRef<HTMLElement>(null)
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

  // 点击面板外关闭；弹窗打开时不处理，避免登录或确认流程被中断。
  useEffect(() => {
    if (!state?.visible) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target

      if (target instanceof Node && panelRef.current?.contains(target)) return

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
  const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
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
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      const width = panelRef.current?.getBoundingClientRect().width

      if (width) localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)))
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
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
            icon={<ReloadOutlined />}
            loading={state.loading}
            title="刷新"
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
            icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
            title={expanded ? '还原' : '最大化'}
            aria-label={expanded ? '还原' : '最大化'}
            onClick={() => setExpanded((value) => !value)}
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            title="关闭"
            aria-label="关闭"
            onClick={requestClose}
          />
        </div>
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
