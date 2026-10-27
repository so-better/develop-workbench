import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { openEmbeddedBrowser } from './embedded-browser'
import {
  getThemeBackgroundColor,
  getTitleBarOverlayOptions,
  registerTitleBarOverlayWindow
} from './theme'

let mainWindow: BrowserWindow | null = null

/**
 * 获取主窗口引用。
 * 供单实例唤醒和 macOS activate 事件使用。
 */
export const getMainWindow = (): BrowserWindow | null => mainWindow

/**
 * 显示并聚焦主窗口。
 * 应用启动完成和窗口恢复时都需要主动获取焦点。
 */
const showMainWindow = (): void => {
  if (!mainWindow) return

  mainWindow.show()
  mainWindow.focus()
}

/**
 * 聚焦已有窗口。
 * 用户再次启动应用或点击 Dock 图标时调用。
 */
export const focusMainWindow = (): void => {
  if (!mainWindow) return

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * 创建主窗口，并加载开发环境或生产环境对应的渲染页面。
 */
export const createMainWindow = (): void => {
  // 使用主显示器可用区域（已排除菜单栏、Dock 等），按 95% 计算初始窗口尺寸。
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize
  const initialWidth = Math.round(workAreaWidth * 0.95)
  const initialHeight = Math.round(workAreaHeight * 0.95)

  const window = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 1080,
    minHeight: 720,
    center: true,
    // 等页面渲染完成后再显示，避免启动时出现白屏。
    show: false,
    autoHideMenuBar: true,
    title: 'AI 研发工作台',
    ...(process.platform === 'win32'
      ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: getTitleBarOverlayOptions()
      }
      : {}),
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    backgroundColor: getThemeBackgroundColor(),
    webPreferences: {
      // 预加载脚本是渲染进程访问系统能力的唯一入口。
      preload: join(__dirname, '../preload/index.js'),
      // 安全基线：隔离渲染进程上下文，并禁用 Node.js 与沙箱逃逸。
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = window

  if (process.platform === 'win32') {
    registerTitleBarOverlayWindow(window)
  }

  // 首次打开时最大化到屏幕工作区，随后再显示窗口。
  window.once('ready-to-show', () => {
    window.maximize()
    showMainWindow()
  })

  // 每次窗口重新显示时通知渲染进程刷新 lark 登录状态。
  window.on('show', () => {
    window.webContents.send('window:shown')
  })

  // 窗口销毁后释放引用，避免访问已销毁的 BrowserWindow。
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  // 所有新窗口链接统一交给应用内浏览器。
  window.webContents.setWindowOpenHandler(({ url }) => {
    openEmbeddedBrowser(window, url)
    return { action: 'deny' }
  })

  // 屏蔽主页面刷新快捷键；内嵌浏览器保留自己的刷新按钮。
  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()

    if (((input.control || input.meta) && key === 'r') || key === 'f5') {
      event.preventDefault()
    }
  })

  // 阻止应用页面直接跳走，改为在应用内浏览器打开。
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault()
      openEmbeddedBrowser(window, url)
    }
  })

  // 开发环境由 Vite 提供页面地址，生产环境加载构建后的 HTML 文件。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  if (rendererUrl) {
    window.loadURL(rendererUrl)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
