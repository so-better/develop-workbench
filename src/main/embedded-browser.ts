import { BrowserWindow, ipcMain, session, WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserState
} from '../types/embedded-browser'

export const BROWSER_PARTITION = 'persist:workbench-browser'
const BATCH_LOAD_ABORTED = -3

interface BrowserEntry {
  window: BrowserWindow
  view: WebContentsView
  visible: boolean
  suppressed: boolean
  bounds: Rectangle | null
  error: string | null
  requestedUrl: string | null
  animateInOnNextBounds: boolean
  animationTimer: NodeJS.Timeout | null
  closing: boolean
}

const entries = new Map<number, BrowserEntry>()
let browserSessionConfigured = false

const getEmptyState = (): EmbeddedBrowserState => ({
  visible: false,
  url: null,
  title: null,
  loading: false,
  error: null
})

const configureBrowserSession = (): void => {
  if (browserSessionConfigured) return

  browserSessionConfigured = true

  const browserSession = session.fromPartition(BROWSER_PARTITION)

  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  browserSession.setPermissionCheckHandler(() => false)
}

const normalizeHttpUrl = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    return url.toString()
  } catch {
    return null
  }
}

const toState = (entry: BrowserEntry): EmbeddedBrowserState => {
  const webContents = entry.view.webContents
  const currentUrl = webContents.getURL() || entry.requestedUrl

  return {
    visible: entry.visible,
    url: currentUrl || null,
    title: webContents.getTitle() || null,
    loading: webContents.isLoading(),
    error: entry.error
  }
}

const broadcastState = (entry: BrowserEntry): void => {
  if (entry.window.isDestroyed()) return

  entry.window.webContents.send('embedded-browser:state', toState(entry))
}

const applyVisibility = (entry: BrowserEntry): void => {
  const hasUsableBounds =
    entry.bounds !== null && entry.bounds.width > 0 && entry.bounds.height > 0

  entry.view.setVisible(entry.visible && !entry.suppressed && hasUsableBounds)
}

const loadUrl = (entry: BrowserEntry, rawUrl: string): boolean => {
  const url = normalizeHttpUrl(rawUrl)

  if (!url) return false

  if (entry.closing) {
    entry.closing = false
    cancelViewAnimation(entry)
  }

  entry.requestedUrl = url
  entry.error = null

  if (!entry.visible) {
    entry.bounds = null
    entry.animateInOnNextBounds = true
  }

  entry.visible = true
  applyVisibility(entry)
  broadcastState(entry)
  void entry.view.webContents.loadURL(url).catch(() => undefined)

  return true
}

const cancelViewAnimation = (entry: BrowserEntry): void => {
  if (!entry.animationTimer) return

  clearTimeout(entry.animationTimer)
  entry.animationTimer = null
}

/**
 * 关闭动画结束后销毁原生视图。
 * 不复用旧页面，避免下一次打开时先闪出上一页内容。
 */
const disposeEntry = (entry: BrowserEntry): void => {
  cancelViewAnimation(entry)

  if (entries.get(entry.window.id) === entry) {
    entries.delete(entry.window.id)
  }

  if (!entry.window.isDestroyed()) {
    try {
      entry.window.contentView.removeChildView(entry.view)
    } catch {
      // 窗口或视图可能已随窗口销毁。
    }
  }

  // 窗口关闭时 WebContentsView 可能已经先被销毁，webContents 会变成 undefined。
  const webContents = entry.view.webContents

  if (webContents && !webContents.isDestroyed()) {
    webContents.removeAllListeners()
    webContents.close()
  }
}

/**
 * 原生视图没有 CSS 动画能力，只能从右侧目标外逐帧移动 bounds。
 * 渲染层的面板滑入动画与这里保持同一时长和方向。
 */
const animateViewIn = (entry: BrowserEntry, target: Rectangle): void => {
  const startX = target.x + target.width
  const duration = 200
  const startedAt = Date.now()

  cancelViewAnimation(entry)
  entry.view.setBounds({ ...target, x: startX })
  entry.view.setVisible(true)

  const tick = (): void => {
    if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) {
      entry.animationTimer = null
      return
    }

    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    const x = Math.round(startX + (target.x - startX) * eased)

    entry.view.setBounds({ ...target, x })

    if (progress < 1) {
      entry.animationTimer = setTimeout(tick, 16)
      return
    }

    entry.animationTimer = null
  }

  entry.animationTimer = setTimeout(tick, 16)
}

/**
 * 关闭时把原生视图移出窗口，动画完成后再隐藏并销毁。
 */
const animateViewOut = (entry: BrowserEntry): void => {
  const target = entry.bounds

  if (!target) {
    entry.visible = false
    applyVisibility(entry)
    broadcastState(entry)
    disposeEntry(entry)
    return
  }

  const current = entry.view.getBounds()
  const startX = current.x
  const endX = target.x + target.width
  const duration = 200
  const startedAt = Date.now()

  cancelViewAnimation(entry)
  entry.closing = true

  const finish = (): void => {
    entry.animationTimer = null
    entry.closing = false
    entry.visible = false
    applyVisibility(entry)
    broadcastState(entry)
    disposeEntry(entry)
  }

  const tick = (): void => {
    if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) {
      entry.animationTimer = null
      entry.closing = false
      return
    }

    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = Math.pow(progress, 3)
    const x = Math.round(startX + (endX - startX) * eased)

    entry.view.setBounds({ ...current, x })

    if (progress < 1) {
      entry.animationTimer = setTimeout(tick, 16)
      return
    }

    finish()
  }

  entry.animationTimer = setTimeout(tick, 16)
}

/**
 * 统一关闭入口：被弹窗遮挡时直接隐藏，否则走滑出动画。
 */
const closeBrowserEntry = (entry: BrowserEntry): void => {
  if (!entry.visible || entry.closing) return

  if (entry.suppressed) {
    entry.visible = false
    applyVisibility(entry)
    broadcastState(entry)
    disposeEntry(entry)
    return
  }

  animateViewOut(entry)
}

export const closeEmbeddedBrowserForWindow = (window: BrowserWindow): void => {
  const entry = entries.get(window.id)

  if (entry) closeBrowserEntry(entry)
}

/**
 * 主进程请求关闭时先通知渲染层，让面板播放滑出动画。
 * 400ms 后兜底强制关闭，避免渲染层未响应时原生视图残留。
 */
export const requestEmbeddedBrowserClose = (window: BrowserWindow): void => {
  const entry = entries.get(window.id)

  if (!entry?.visible) return

  window.webContents.send('embedded-browser:request-close')

  setTimeout(() => {
    if (entries.get(window.id) === entry) closeBrowserEntry(entry)
  }, 400)
}

export const isEmbeddedBrowserVisible = (window: BrowserWindow): boolean =>
  entries.get(window.id)?.visible ?? false

const getEntry = (window: BrowserWindow): BrowserEntry => {
  const existing = entries.get(window.id)

  if (existing) return existing

  configureBrowserSession()

  const view = new WebContentsView({
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })
  const entry: BrowserEntry = {
    window,
    view,
    visible: false,
    suppressed: false,
    bounds: null,
    error: null,
    requestedUrl: null,
    animateInOnNextBounds: false,
    animationTimer: null,
    closing: false
  }

  view.setBackgroundColor('#ffffff')
  view.setBorderRadius(10)
  view.setVisible(false)
  window.contentView.addChildView(view)

  const webContents = view.webContents
  const userAgent = webContents.getUserAgent().replace(/\sElectron\/[\d.]+/i, '')

  webContents.setUserAgent(userAgent)

  webContents.setWindowOpenHandler(({ url }) => {
    loadUrl(entry, url)
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    if (!normalizeHttpUrl(url)) event.preventDefault()
  })

  webContents.on('will-redirect', (event, url) => {
    if (!normalizeHttpUrl(url)) event.preventDefault()
  })

  webContents.on('did-start-loading', () => {
    entry.error = null
    broadcastState(entry)
  })

  webContents.on('did-stop-loading', () => {
    broadcastState(entry)
  })

  webContents.on('did-navigate', () => {
    broadcastState(entry)
  })

  webContents.on('did-navigate-in-page', () => {
    broadcastState(entry)
  })

  webContents.on('page-title-updated', () => {
    broadcastState(entry)
  })

  webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === BATCH_LOAD_ABORTED) return

      entry.error = errorDescription || '页面加载失败'
      broadcastState(entry)
    }
  )

  webContents.on('render-process-gone', () => {
    entry.error = '页面进程异常退出'
    broadcastState(entry)
  })

  window.once('closed', () => {
    disposeEntry(entry)
  })

  entries.set(window.id, entry)

  return entry
}

export const openEmbeddedBrowser = (window: BrowserWindow, rawUrl: string): boolean => {
  const entry = getEntry(window)

  return loadUrl(entry, rawUrl)
}

export const initializeEmbeddedBrowser = (): void => {
  ipcMain.handle('embedded-browser:open', (event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') throw new Error('链接格式不合法')

    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return false

    return openEmbeddedBrowser(window, rawUrl)
  })

  ipcMain.handle('embedded-browser:get-state', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return getEmptyState()

    const entry = entries.get(window.id)

    return entry ? toState(entry) : getEmptyState()
  })

  ipcMain.handle('embedded-browser:close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)

    if (entry) closeBrowserEntry(entry)
  })

  ipcMain.handle(
    'embedded-browser:set-bounds',
    (event, bounds: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender)

      if (!window) return

      const entry = entries.get(window.id)

      if (!entry || entry.closing) return

      const value = bounds as Partial<EmbeddedBrowserBounds> | null

      if (
        !value ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        !Number.isFinite(value.width) ||
        !Number.isFinite(value.height)
      ) {
        return
      }

      const windowBounds = window.getContentBounds()
      const x = Math.max(0, Math.min(Math.round(value.x as number), windowBounds.width))
      const y = Math.max(0, Math.min(Math.round(value.y as number), windowBounds.height))
      const width = Math.max(
        0,
        Math.min(Math.round(value.width as number), windowBounds.width - x)
      )
      const height = Math.max(
        0,
        Math.min(Math.round(value.height as number), windowBounds.height - y)
      )

      cancelViewAnimation(entry)

      const target = { x, y, width, height }

      // ResizeObserver 初始化时会重复回报相同尺寸，不能因此取消滑入动画。
      if (
        entry.animationTimer &&
        entry.bounds &&
        entry.bounds.x === target.x &&
        entry.bounds.y === target.y &&
        entry.bounds.width === target.width &&
        entry.bounds.height === target.height
      ) {
        return
      }

      const shouldAnimate = entry.animateInOnNextBounds

      entry.bounds = target
      entry.animateInOnNextBounds = false

      if (shouldAnimate && entry.visible && !entry.suppressed) {
        animateViewIn(entry, target)
      } else {
        entry.view.setBounds(target)
        applyVisibility(entry)
      }
    }
  )

  ipcMain.handle('embedded-browser:set-suppressed', (event, suppressed: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)

    if (!entry) return

    entry.suppressed = suppressed === true

    if (entry.suppressed) {
      cancelViewAnimation(entry)

      if (entry.closing) {
        entry.closing = false
        entry.visible = false
        applyVisibility(entry)
        broadcastState(entry)
        disposeEntry(entry)
        return
      }
    }

    applyVisibility(entry)
  })
}
