import { app, BrowserWindow, ipcMain, session, shell, WebContentsView } from 'electron'
import type { DownloadItem, Rectangle } from 'electron'
import { randomUUID } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { backupCorruptStoreSync } from './store-backup'
import { tryNormalizeHttpUrl } from '../utils'
import type {
  EmbeddedBrowserBounds,
  EmbeddedBrowserDownload,
  EmbeddedBrowserState
} from '../types/embedded-browser'

export const BROWSER_PARTITION = 'persist:workbench-browser'
const BATCH_LOAD_ABORTED = -3

interface BrowserEntry {
  id: string
  aliases: Set<string>
  activationVersion: number
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

interface DownloadEntry {
  item: DownloadItem | null
  state: EmbeddedBrowserDownload
}

const DOWNLOADS_FILE = 'downloads.json'
const MAX_DOWNLOADS = 200
const entries = new Map<number, BrowserEntry>()
/** entries 指向活动页，pages 持有全部页面；非活动页只隐藏，不重新加载。 */
const pages = new Map<number, BrowserEntry[]>()
const trackedWindows = new WeakSet<BrowserWindow>()
const downloads = new Map<string, DownloadEntry>()
const retryWindows = new Map<
  number,
  { window: BrowserWindow; timer: NodeJS.Timeout }
>()
let browserSessionConfigured = false

const getEmptyState = (): EmbeddedBrowserState => ({
  tabs: [],
  activeTabId: null,
  activationVersion: 0,
  visible: false,
  url: null,
  title: null,
  loading: false,
  error: null,
  canGoBack: false,
  canGoForward: false
})

const getDownloadsPath = (): string => join(app.getPath('userData'), DOWNLOADS_FILE)

/** 活动任务不占历史配额；中断任务只有仍持有可续传的 DownloadItem 时才需要保留操作能力。 */
const isActiveDownload = (entry: DownloadEntry): boolean =>
  entry.state.status === 'progressing' ||
  entry.state.paused ||
  (entry.state.status === 'interrupted' && entry.item !== null && entry.state.canResume)

/** 从 Map 中真正淘汰旧历史，而不是只截断展示列表。不会删除磁盘上的下载文件。 */
const pruneDownloadHistory = (): void => {
  const history = Array.from(downloads.values())
    .filter((entry) => !isActiveDownload(entry))
    .sort((left, right) => right.state.startedAt - left.state.startedAt)

  for (const entry of history.slice(MAX_DOWNLOADS)) {
    downloads.delete(entry.state.id)
  }
}

const getDownloadStates = (): EmbeddedBrowserDownload[] =>
  Array.from(downloads.values())
    .map((entry) => entry.state)
    .sort((left, right) => right.startedAt - left.startedAt)

/** 统计可清理的下载历史记录，正在下载的任务不计入。 */
export const getEmbeddedBrowserDownloadHistoryStats = (): {
  count: number
  bytes: number
} => ({
  count: Array.from(downloads.values()).filter((entry) => !isActiveDownload(entry)).length,
  // 历史清理只删除元数据，不删除已下载文件，因此不将文件体积计作可释放空间。
  bytes: 0
})

let persistTimer: NodeJS.Timeout | null = null
let persistQueue: Promise<void> = Promise.resolve()

const persistDownloadsNow = (): Promise<void> => {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }

  const targetPath = getDownloadsPath()
  const tempPath = `${targetPath}.${randomUUID()}.tmp`
  const content = JSON.stringify({ downloads: getDownloadStates() }, null, 2)

  persistQueue = persistQueue.then(async () => {
    try {
      const handle = await open(tempPath, 'w')

      try {
        await handle.writeFile(content, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }

      await rename(tempPath, targetPath)
    } catch {
      await rm(tempPath, { force: true }).catch(() => undefined)
    }
  })

  return persistQueue
}

const schedulePersistDownloads = (): void => {
  if (persistTimer) return

  persistTimer = setTimeout(() => {
    persistTimer = null
    persistDownloadsNow()
  }, 400)
}

const persistDownloadsSync = (): void => {
  try {
    writeFileSync(
      getDownloadsPath(),
      JSON.stringify({ downloads: getDownloadStates() }, null, 2),
      'utf8'
    )
  } catch {
    // 退出阶段写入失败不阻塞应用关闭。
  }
}

const parseDownloadRecord = (value: unknown): EmbeddedBrowserDownload | null => {
  if (!value || typeof value !== 'object') return null

  const item = value as Record<string, unknown>

  if (
    typeof item.id !== 'string' ||
    typeof item.filename !== 'string' ||
    typeof item.url !== 'string' ||
    (item.savePath !== null && typeof item.savePath !== 'string') ||
    typeof item.totalBytes !== 'number' ||
    typeof item.receivedBytes !== 'number' ||
    typeof item.bytesPerSecond !== 'number' ||
    typeof item.status !== 'string' ||
    typeof item.startedAt !== 'number' ||
    typeof item.canResume !== 'boolean' ||
    typeof item.paused !== 'boolean'
  ) {
    return null
  }

  if (
    item.status !== 'completed' &&
    item.status !== 'cancelled' &&
    item.status !== 'interrupted' &&
    item.status !== 'progressing'
  ) {
    return null
  }

  return {
    id: item.id,
    filename: item.filename,
    url: item.url,
    savePath: item.savePath ?? null,
    totalBytes: item.totalBytes,
    receivedBytes: item.receivedBytes,
    bytesPerSecond: 0,
    status: item.status === 'progressing' ? 'interrupted' : item.status,
    startedAt: item.startedAt,
    canResume: item.canResume,
    paused: false,
    origin:
      item.origin === 'ai'
        ? 'ai'
        : item.origin === 'update'
          ? 'update'
          : 'browser'
  }
}

const loadPersistedDownloads = (): void => {
  let raw: string

  try {
    raw = readFileSync(getDownloadsPath(), 'utf8')
  } catch {
    return
  }

  let parsed: { downloads?: unknown } | null

  try {
    parsed = JSON.parse(raw) as { downloads?: unknown } | null
  } catch {
    backupCorruptStoreSync(getDownloadsPath())
    return
  }

  if (!parsed || !Array.isArray(parsed.downloads)) {
    backupCorruptStoreSync(getDownloadsPath())
    return
  }

  for (const value of parsed.downloads) {
    const state = parseDownloadRecord(value)

    if (state) downloads.set(state.id, { item: null, state })
  }
  // 重启后运行中的任务已转为中断历史，再按同一规则收敛到历史上限。
  pruneDownloadHistory()
}

const closeRetryWindow = (webContentsId: number): void => {
  const retry = retryWindows.get(webContentsId)

  if (!retry) return

  clearTimeout(retry.timer)
  retryWindows.delete(webContentsId)

  if (!retry.window.isDestroyed()) retry.window.destroy()
}

/**
 * 向所有窗口广播下载列表，面板关闭后重新打开也能恢复记录。
 */
const broadcastDownloads = (): void => {
  pruneDownloadHistory()
  const state = getDownloadStates()

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('embedded-browser:downloads', state)
  }

  schedulePersistDownloads()
}

/** 清空已结束的下载历史，不删除已下载文件。返回清理的记录数。 */
export const clearEmbeddedBrowserDownloadHistory = (): number => {
  let removed = 0

  for (const [id, entry] of downloads) {
    if (isActiveDownload(entry)) continue

    downloads.delete(id)
    removed += 1
  }

  if (removed > 0) {
    broadcastDownloads()
    persistDownloadsNow()
  }

  return removed
}

const syncDownloadState = (
  item: DownloadItem,
  state: EmbeddedBrowserDownload
): void => {
  state.filename = item.getFilename() || state.filename
  state.savePath = item.getSavePath() || null
  state.totalBytes = item.getTotalBytes()
  state.receivedBytes = item.getReceivedBytes()
  state.bytesPerSecond = item.getCurrentBytesPerSecond()
  state.canResume = item.canResume()
  state.paused = item.isPaused()
}

const configureBrowserSession = (): void => {
  if (browserSessionConfigured) return

  browserSessionConfigured = true

  const browserSession = session.fromPartition(BROWSER_PARTITION)

  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  browserSession.setPermissionCheckHandler(() => false)

  // 保留 Electron 默认保存对话框，同时记录下载状态供面板展示和操作。
  browserSession.on('will-download', (_event, item, webContents) => {
    const state: EmbeddedBrowserDownload = {
      id: randomUUID(),
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: null,
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      bytesPerSecond: 0,
      paused: false,
      status: 'progressing',
      startedAt: Date.now(),
      canResume: item.canResume(),
      origin: 'browser'
    }

    item.setSaveDialogOptions({
      title: '保存文件',
      buttonLabel: '保存'
    })
    downloads.set(state.id, { item, state })
    broadcastDownloads()

    item.on('updated', (_updatedEvent, updatedState) => {
      syncDownloadState(item, state)
      state.status = updatedState
      broadcastDownloads()
    })

    item.on('done', (_doneEvent, result) => {
      syncDownloadState(item, state)
      state.status = result
      state.savePath = item.getSavePath() || state.savePath
      // done 后 DownloadItem 已结束；中断只能重新下载，不再占用活动任务保留名额。
      const entry = downloads.get(state.id)
      if (entry) entry.item = null
      state.paused = false
      state.canResume = false
      broadcastDownloads()
      persistDownloadsNow()
      closeRetryWindow(webContents.id)
    })
  })
}


const toState = (entry: BrowserEntry): EmbeddedBrowserState => {
  const webContents = entry.view.webContents
  const currentUrl = webContents.getURL() || entry.requestedUrl

  return {
    activeTabId: entry.id,
    activationVersion: entry.activationVersion,
    tabs: (pages.get(entry.window.id) ?? []).map((page) => ({
      id: page.id,
      url: page.view.webContents.getURL() || page.requestedUrl,
      title: page.view.webContents.getTitle() || page.requestedUrl || '网页',
      loading: page.view.webContents.isLoading()
    })),
    visible: entry.visible,
    url: currentUrl || null,
    title: webContents.getTitle() || null,
    loading: webContents.isLoading(),
    error: entry.error,
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward()
  }
}

const broadcastState = (entry: BrowserEntry): void => {
  if (entry.window.isDestroyed()) return

  const active = entries.get(entry.window.id)
  entry.window.webContents.send('embedded-browser:state', active ? toState(active) : getEmptyState())
}

const applyVisibility = (entry: BrowserEntry): void => {
  const hasUsableBounds =
    entry.bounds !== null && entry.bounds.width > 0 && entry.bounds.height > 0

  entry.view.setVisible(entries.get(entry.window.id) === entry && entry.visible && !entry.suppressed && hasUsableBounds)
}

const loadUrl = (entry: BrowserEntry, rawUrl: string): boolean => {
  const url = tryNormalizeHttpUrl(rawUrl)

  if (!url) return false

  if (entry.closing) {
    entry.closing = false
    cancelViewAnimation(entry)
  }

  entry.requestedUrl = url
  entry.error = null
  // 浏览器始终位于弹窗之上，打开时清除可能残留的抑制状态。
  entry.suppressed = false

  if (!entry.visible) {
    entry.bounds = null
    entry.animateInOnNextBounds = true
  }

  entry.visible = true
  applyVisibility(entry)
  broadcastState(entry)
  entry.view.webContents.loadURL(url).catch(() => undefined)

  return true
}

const cancelViewAnimation = (entry: BrowserEntry): void => {
  if (!entry.animationTimer) return

  clearTimeout(entry.animationTimer)
  entry.animationTimer = null
}

/**
 * 仅关闭标签、清理缓存或退出窗口时销毁原生视图。
 */
const disposeEntry = (entry: BrowserEntry, onDisposed?: () => void): void => {
  cancelViewAnimation(entry)
  const remaining = (pages.get(entry.window.id) ?? []).filter((page) => page !== entry)
  if (remaining.length) pages.set(entry.window.id, remaining)
  else pages.delete(entry.window.id)

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
    // 移除页面生命周期监听，避免销毁时回写旧视图状态；清理等待器需在此之后注册。
    webContents.removeAllListeners()
    if (onDisposed) webContents.once('destroyed', onDisposed)
    webContents.close()
  } else {
    onDisposed?.()
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
 * 收起时把原生视图移出窗口，动画完成后隐藏，保留页面状态。
 */
const animateViewOut = (entry: BrowserEntry): void => {
  const target = entry.bounds

  if (!target) {
    entry.visible = false
    applyVisibility(entry)
    broadcastState(entry)
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
  }

  const tick = (): void => {
    if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) {
      entry.animationTimer = null
      entry.closing = false
      return
    }

    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    // 与 CSS easeInCubic 近似一致，避免 React 面板和原生视图速度不同。
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
    return
  }

  animateViewOut(entry)
}

export const closeEmbeddedBrowserForWindow = (window: BrowserWindow): void => {
  const entry = entries.get(window.id)

  if (entry) closeBrowserEntry(entry)
}

/** 缓存清理专用：跳过/取消动画，等待原生页面销毁后才能开始清理 Session。 */
export const closeEmbeddedBrowserForCleanup = (window: BrowserWindow): Promise<void> => {
  const retained = [...(pages.get(window.id) ?? [])]
  entries.delete(window.id)
  if (!window.isDestroyed()) window.webContents.send('embedded-browser:state', getEmptyState())
  return Promise.all(retained.map((entry) => new Promise<void>((resolve) => {
    entry.visible = false
    disposeEntry(entry, resolve)
  }))).then(() => undefined)
}

/**
 * 主进程请求关闭时先通知渲染层，让面板播放滑出动画。
 * 400ms 后兜底强制关闭，避免渲染层未响应时原生视图残留。
 */
export const requestEmbeddedBrowserClose = (window: BrowserWindow): void => {
  const entry = entries.get(window.id)

  if (!entry?.visible) return

  const activationVersion = entry.activationVersion
  window.webContents.send('embedded-browser:request-close')

  setTimeout(() => {
    // 收起后再次激活同一标签，也不应被旧请求的兜底定时器重新收起。
    if (entries.get(window.id) === entry && entry.activationVersion === activationVersion) closeBrowserEntry(entry)
  }, 400)
}

export const isEmbeddedBrowserVisible = (window: BrowserWindow): boolean =>
  entries.get(window.id)?.visible ?? false

/** 切换内嵌浏览器的独立开发者工具窗口。 */
const toggleEntryDevTools = (entry: BrowserEntry): void => {
  const webContents = entry.view.webContents

  if (webContents.isDestroyed()) return

  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
    return
  }

  webContents.openDevTools({ mode: 'detach', activate: true })
}

const createEntry = (window: BrowserWindow): BrowserEntry => {
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
    id: randomUUID(),
    aliases: new Set(),
    activationVersion: 0,
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
    openEmbeddedBrowser(window, url)
    return { action: 'deny' }
  })

  webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    const openQuickNotesShortcut =
      (input.meta || input.control) && !input.alt && input.shift && key === 'k'
    const toggleDevToolsShortcut =
      key === 'f12' ||
      ((input.meta || input.control) && input.alt && key === 'i') ||
      (input.control && input.shift && key === 'i')

    if (openQuickNotesShortcut && !input.isAutoRepeat) {
      event.preventDefault()
      entry.window.webContents.focus()
      entry.window.webContents.send('quick-notes:open')
      return
    }

    if (toggleDevToolsShortcut && !input.isAutoRepeat) {
      event.preventDefault()
      toggleEntryDevTools(entry)
      return
    }

    if (input.key === 'Escape' && !input.isAutoRepeat) {
      event.preventDefault()
      entry.window.webContents.send('embedded-browser:request-close')
    }
  })

  webContents.on('will-navigate', (event, url) => {
    if (!tryNormalizeHttpUrl(url)) event.preventDefault()
    else {
      // 用户主动跳转建立新的地址链，旧页面入口不再匹配当前标签。
      entry.aliases.clear()
      entry.aliases.add(url)
    }
  })

  webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
    if (!tryNormalizeHttpUrl(url)) event.preventDefault()
    else if (isMainFrame) entry.aliases.add(url)
  })

  webContents.on('did-start-loading', () => {
    entry.error = null
    broadcastState(entry)
  })

  webContents.on('did-stop-loading', () => {
    broadcastState(entry)
  })

  webContents.on('did-navigate', (_event, url) => {
    // 后退、前进等程序导航不一定触发 will-navigate；离开已知重定向链即清除旧入口。
    if (!entry.aliases.has(url)) entry.aliases.clear()
    entry.aliases.add(url)
    broadcastState(entry)
  })

  webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) {
      entry.aliases.clear()
      entry.aliases.add(url)
    }
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

  if (!trackedWindows.has(window)) {
    trackedWindows.add(window)
    window.once('closed', () => {
      for (const page of [...(pages.get(window.id) ?? [])]) disposeEntry(page)
    })
  }
  pages.set(window.id, [...(pages.get(window.id) ?? []), entry])

  return entry
}

export const openEmbeddedBrowser = (
  window: BrowserWindow,
  rawUrl: string
): boolean => {
  const url = tryNormalizeHttpUrl(rawUrl)
  if (!url) return false
  const existing = (pages.get(window.id) ?? []).find((page) =>
    page.view.webContents.getURL() === url || page.aliases.has(url))
  const entry = existing ?? createEntry(window)
  if (!existing) {
    entry.requestedUrl = url
    entry.aliases.add(url)
  }
  activatePage(entry)
  return existing ? true : loadUrl(entry, url)
}

/** 先隐藏旧页，再显示目标页；沿用当前面板尺寸，切换不触发 loadURL。 */
const activatePage = (entry: BrowserEntry): void => {
  const previous = entries.get(entry.window.id)
  const bounds = previous?.visible ? previous.bounds : null
  if (previous) {
    cancelViewAnimation(previous)
    previous.closing = false
    previous.visible = false
    previous.view.setVisible(false)
  }
  entries.set(entry.window.id, entry)
  entry.closing = false
  entry.visible = true
  entry.activationVersion++
  entry.suppressed = false
  entry.bounds = bounds
  entry.animateInOnNextBounds = !bounds
  if (bounds) entry.view.setBounds(bounds)
  applyVisibility(entry)
  broadcastState(entry)
}

/** 授权流程持有具体标签，不因用户切换到其他页面而改变目标。 */
export const getActiveEmbeddedBrowserTabId = (window: BrowserWindow): string | null =>
  entries.get(window.id)?.id ?? null

export const hasEmbeddedBrowserTab = (window: BrowserWindow, id: string): boolean =>
  !window.isDestroyed() && Boolean(pages.get(window.id)?.some((page) => page.id === id))

export const closeEmbeddedBrowserTab = (window: BrowserWindow, id: string): void => {
  const retained = pages.get(window.id) ?? []
  const index = retained.findIndex((page) => page.id === id)
  if (index < 0) return
  const entry = retained[index]
  if (entries.get(window.id) === entry) {
    const next = retained[index + 1] ?? retained[index - 1]
    if (next) {
      const wasVisible = entry.visible
      activatePage(next)
      if (!wasVisible) {
        next.visible = false
        applyVisibility(next)
      }
    }
  }
  disposeEntry(entry)
  const active = entries.get(window.id)
  if (!window.isDestroyed()) window.webContents.send('embedded-browser:state', active ? toState(active) : getEmptyState())
}

interface GeneratedDownloadHandle {
  id: string
  update: (receivedBytes: number) => void
  complete: (savePath: string, size?: number) => void
  fail: () => void
}

/** 获取已完成的更新包路径，供安装动作复用下载记录。 */
export const getCompletedUpdateDownloadPath = (downloadId: string): string => {
  const entry = downloads.get(downloadId)

  if (
    !entry ||
    entry.state.origin !== 'update' ||
    entry.state.status !== 'completed' ||
    !entry.state.savePath
  ) {
    throw new Error('更新包尚未下载完成')
  }

  return entry.state.savePath
}

/**
 * 为 AI 产物或更新包创建一个由应用驱动的下载记录。
 * 该记录没有 DownloadItem，但可以持续更新进度并复用统一列表。
 */
export const createGeneratedDownload = (input: {
  filename: string
  path: string
  size: number
  source: string
  origin?: 'ai' | 'update'
}): GeneratedDownloadHandle => {
  const state: EmbeddedBrowserDownload = {
    id: randomUUID(),
    filename: input.filename,
    url: input.source,
    savePath: input.path,
    totalBytes: Math.max(0, input.size),
    receivedBytes: 0,
    bytesPerSecond: 0,
    status: 'progressing',
    startedAt: Date.now(),
    canResume: false,
    paused: false,
    origin: input.origin ?? 'ai'
  }
  const update = (receivedBytes: number): void => {
    const next = Math.max(0, Math.round(receivedBytes))

    state.receivedBytes =
      state.totalBytes > 0 ? Math.min(next, state.totalBytes) : next
    broadcastDownloads()
  }

  downloads.set(state.id, { item: null, state })
  broadcastDownloads()

  return {
    id: state.id,
    update,
    complete: (savePath, size) => {
      state.savePath = savePath

      if (typeof size === 'number' && Number.isFinite(size) && size >= 0) {
        state.totalBytes = size
      }

      state.receivedBytes = state.totalBytes
      state.status = 'completed'
      state.bytesPerSecond = 0
      broadcastDownloads()
      persistDownloadsNow()
    },
    fail: () => {
      state.status = 'interrupted'
      state.bytesPerSecond = 0
      broadcastDownloads()
      persistDownloadsNow()
    }
  }
}

const retryDownload = (downloadId: string): void => {
  const entry = downloads.get(downloadId)

  if (!entry) throw new Error('下载记录不存在')
  if (entry.state.status !== 'interrupted') {
    throw new Error('只有中断的下载可以重试')
  }

  const retryWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: {
      partition: BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const timer = setTimeout(() => {
    closeRetryWindow(retryWindow.webContents.id)
  }, 30 * 60 * 1000)

  retryWindows.set(retryWindow.webContents.id, { window: retryWindow, timer })

  try {
    retryWindow.webContents.downloadURL(entry.state.url)
  } catch (error) {
    closeRetryWindow(retryWindow.webContents.id)
    throw error
  }
}

export const initializeEmbeddedBrowser = (): void => {
  loadPersistedDownloads()
  app.on('before-quit', persistDownloadsSync)

  ipcMain.handle('embedded-browser:show', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const entry = window && entries.get(window.id)
    if (entry) activatePage(entry)
  })
  ipcMain.handle('embedded-browser:select-tab', (event, id: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || typeof id !== 'string') return
    const entry = pages.get(window.id)?.find((page) => page.id === id)
    if (entry) activatePage(entry)
  })
  ipcMain.handle('embedded-browser:close-tab', (event, id: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || typeof id !== 'string') return
    closeEmbeddedBrowserTab(window, id)
  })

  ipcMain.handle('embedded-browser:open', (event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') throw new Error('链接格式不合法')

    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return false

    return openEmbeddedBrowser(window, rawUrl)
  })

  ipcMain.handle('embedded-browser:open-external', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)
    const url = entry?.view.webContents.getURL()

    if (!url || !/^https?:\/\//i.test(url)) return

    await shell.openExternal(url)
  })

  ipcMain.handle('embedded-browser:get-state', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return getEmptyState()

    const entry = entries.get(window.id)

    return entry ? toState(entry) : getEmptyState()
  })

  ipcMain.handle('embedded-browser:go-back', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)

    if (entry?.view.webContents.navigationHistory.canGoBack()) {
      entry.view.webContents.navigationHistory.goBack()
    }
  })

  ipcMain.handle('embedded-browser:go-forward', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)

    if (entry?.view.webContents.navigationHistory.canGoForward()) {
      entry.view.webContents.navigationHistory.goForward()
    }
  })

  // 刷新内嵌浏览器当前页面。
  ipcMain.handle('embedded-browser:reload', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)

    if (entry && !entry.closing) {
      entry.view.webContents.reload()
    }
  })

  ipcMain.handle('embedded-browser:toggle-devtools', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) return

    const entry = entries.get(window.id)

    if (entry) toggleEntryDevTools(entry)
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
        return
      }
    }

    applyVisibility(entry)
  })

  ipcMain.handle('embedded-browser:get-downloads', () => getDownloadStates())

  ipcMain.handle('embedded-browser:cancel-download', (_event, downloadId: unknown) => {
    if (typeof downloadId !== 'string') throw new Error('下载 ID 不合法')

    downloads.get(downloadId)?.item?.cancel()
  })

  ipcMain.handle('embedded-browser:open-download', async (_event, downloadId: unknown) => {
    if (typeof downloadId !== 'string') throw new Error('下载 ID 不合法')

    const entry = downloads.get(downloadId)

    if (!entry?.state.savePath || entry.state.status !== 'completed') {
      throw new Error('文件尚未下载完成')
    }

    const error = await shell.openPath(entry.state.savePath)

    if (error) throw new Error(error)
  })

  ipcMain.handle(
    'embedded-browser:show-download',
    (_event, downloadId: unknown) => {
      if (typeof downloadId !== 'string') throw new Error('下载 ID 不合法')

      const entry = downloads.get(downloadId)

      if (!entry?.state.savePath) throw new Error('文件路径不存在')

      shell.showItemInFolder(entry.state.savePath)
    }
  )

  ipcMain.handle('embedded-browser:clear-downloads', () => {
    clearEmbeddedBrowserDownloadHistory()
  })

  ipcMain.handle('embedded-browser:pause-download', (_event, downloadId: unknown) => {
    if (typeof downloadId !== 'string') throw new Error('下载 ID 不合法')

    const entry = downloads.get(downloadId)

    if (!entry?.item || entry.state.status !== 'progressing') {
      throw new Error('当前下载不能暂停')
    }

    entry.item.pause()
    syncDownloadState(entry.item, entry.state)
    entry.state.paused = true
    broadcastDownloads()
    persistDownloadsNow()
  })

  ipcMain.handle('embedded-browser:resume-download', (_event, downloadId: unknown) => {
    if (typeof downloadId !== 'string') throw new Error('下载 ID 不合法')

    const entry = downloads.get(downloadId)

    if (!entry?.item || entry.state.status !== 'progressing') {
      throw new Error('当前下载不能继续')
    }

    entry.item.resume()
    syncDownloadState(entry.item, entry.state)
    entry.state.paused = false
    broadcastDownloads()
    persistDownloadsNow()
  })

  ipcMain.handle('embedded-browser:retry-download', (_event, downloadId: unknown) => {
    if (typeof downloadId !== 'string') throw new Error('下载 ID 不合法')
    retryDownload(downloadId)
  })
}
