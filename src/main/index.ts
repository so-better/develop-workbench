/**
 * Electron 主进程入口。
 * 负责窗口生命周期、单实例控制、外部链接拦截以及基础 IPC。
 */
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { join } from 'node:path'
import { getThemeBackgroundColor, initializeTheme } from './theme'

// 持有主窗口引用，避免被垃圾回收，同时供单实例唤醒逻辑使用。
let mainWindow: BrowserWindow | null = null

// 标记当前是否运行在 electron-vite 的开发模式。
const isDevelopment = process.env.NODE_ENV_ELECTRON_VITE === 'development'

/**
 * 显示主窗口。
 * 开发模式下使用 showInactive，避免热重启时把窗口切到前台抢走编辑器焦点。
 */
const showMainWindow = (): void => {
  if (!mainWindow) return

  if (isDevelopment) {
    mainWindow.showInactive()
  } else {
    mainWindow.show()
  }
}

/**
 * 使用系统默认浏览器打开外部链接。
 * 仅允许 http/https，避免 file:// 等本地协议被意外执行。
 */
const openExternalUrl = (url: string): void => {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:') {
      shell.openExternal(url)
    }
  } catch {
    return
  }
}

/**
 * 创建主窗口，并加载开发环境或生产环境对应的渲染页面。
 */
const createWindow = (): void => {
  // 使用主显示器可用区域（已排除菜单栏、Dock 等），按 95% 计算初始窗口尺寸。
  const { width: workAreaWidth, height: workAreaHeight } = screen.getPrimaryDisplay().workAreaSize
  const initialWidth = Math.round(workAreaWidth * 0.95)
  const initialHeight = Math.round(workAreaHeight * 0.95)

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 1080,
    minHeight: 720,
    center: true,
    // 等页面渲染完成后再显示，避免启动时出现白屏。
    show: false,
    title: 'AI 研发工作台',
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

  // 页面准备完成后显示窗口；开发模式不主动抢占焦点。
  mainWindow.once('ready-to-show', showMainWindow)

  // 窗口销毁后释放引用，避免访问已销毁的 BrowserWindow。
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 拦截 window.open 等新窗口请求，统一交给系统浏览器打开。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  // 阻止应用内跳转到外部页面，例如误点链接时改为在系统浏览器中打开。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
      openExternalUrl(url)
    }
  })

  // 开发环境由 Vite 提供页面地址，生产环境加载构建后的 HTML 文件。
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 单实例锁：确保同一时间只运行一个工作台实例。
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  // 已有实例在运行时，当前进程直接退出。
  app.quit()
} else {
  // 用户再次启动应用时，聚焦已有窗口而不是新开一个实例。
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  // Electron 初始化完成后，再注册 IPC 并创建窗口。
  app.whenReady().then(() => {
    // Windows 需要设置 AppUserModelID，任务栏分组和通知才能正确显示。
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.lingkai.ai-workbench')
    }

    // 开发模式下让 macOS Dock 显示项目图标，而不是默认的 Electron 图标。
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
    }

    // 先恢复上次选择的主题并注册主题 IPC，再创建窗口，避免启动时主题闪烁。
    initializeTheme()

    // 向渲染进程暴露基础运行信息，通过 preload 中的 getAppInfo 方法调用。
    ipcMain.handle('app:get-info', () => ({
      platform: process.platform,
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    }))

    createWindow()

    // macOS 点击 Dock 图标时恢复或聚焦窗口，这是用户主动操作，需要正常聚焦。
    app.on('activate', () => {
      if (!mainWindow) {
        createWindow()
        return
      }

      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    })
  })

  // Windows/Linux 关闭所有窗口后退出；macOS 保持应用常驻。
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
