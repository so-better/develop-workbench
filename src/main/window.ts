import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { openEmbeddedBrowser } from './embedded-browser'
import {
  getThemeBackgroundColor,
  getTitleBarOverlayOptions,
  registerTitleBarOverlayWindow
} from './theme'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let applicationMenuInstalled = false

// 用户通过菜单、托盘或 Cmd+Q 退出时，允许窗口真正关闭。
app.on('before-quit', () => {
  isQuitting = true
  tray?.destroy()
  tray = null
})

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

/** Windows 托盘图标路径。 */
const getTrayIconPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../build/icon.png')

/**
 * 创建 Windows 托盘菜单。
 * 关闭按钮只最小化，托盘菜单提供明确的退出入口。
 */
const createWindowsTray = (): void => {
  if (process.platform !== 'win32' || tray) return

  const image = nativeImage.createFromPath(getTrayIconPath())

  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('AI 研发工作台')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: focusMainWindow
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit()
      }
    ])
  )
  tray.on('click', focusMainWindow)
  tray.on('double-click', focusMainWindow)
}

/** 安装标准编辑菜单，让渲染页和内置浏览器都能使用系统复制粘贴等操作。 */
const installApplicationMenu = (): void => {
  if (applicationMenuInstalled) return

  const template: MenuItemConstructorOptions[] = []

  if (process.platform === 'darwin') {
    template.push({ role: 'appMenu' })
  }

  template.push({ role: 'editMenu' })

  if (process.platform === 'darwin') {
    template.push({ role: 'windowMenu' })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  applicationMenuInstalled = true
}

/**
 * 创建主窗口，并加载开发环境或生产环境对应的渲染页面。
 */
export const createMainWindow = (): void => {
  installApplicationMenu()
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
    createWindowsTray()
  }

  // 首次打开时最大化到屏幕工作区，随后再显示窗口。
  window.once('ready-to-show', () => {
    window.maximize()
    showMainWindow()
  })

  let lastWindowShownAt = 0
  const notifyWindowShown = (): void => {
    const now = Date.now()

    if (now - lastWindowShownAt < 250) return

    lastWindowShownAt = now

    if (!window.webContents.isDestroyed()) {
      window.webContents.send('window:shown')
    }
  }

  // 每次窗口重新显示或从最小化恢复时通知渲染进程刷新状态并静默检查更新。
  window.on('show', notifyWindowShown)
  window.on('restore', notifyWindowShown)

  // 点击关闭按钮时最小化而不是销毁窗口；通过菜单、托盘或 Cmd+Q 退出。
  window.on('close', (event) => {
    if (isQuitting) return

    event.preventDefault()
    window.minimize()
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
