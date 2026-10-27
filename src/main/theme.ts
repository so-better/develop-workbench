import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { getPreferences, updatePreferences } from './preferences'
import type { ThemeMode, ThemeState } from '../types/theme'

// 窗口底色与页面背景保持一致，用于避免加载和主题切换时的闪屏。
const LIGHT_BACKGROUND = '#f5f7fb'
const DARK_BACKGROUND = '#101114'

/**
 * 校验外部传入的值是否为合法的主题模式。
 * 用于 IPC 参数和偏好文件解析。
 */
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark'

/**
 * 读取当前主题状态。
 * mode 表示用户选择，isDark 表示系统解析后的实际明暗结果。
 */
const getThemeState = (): ThemeState => ({
  mode: nativeTheme.themeSource,
  isDark: nativeTheme.shouldUseDarkColors
})

/**
 * 根据当前主题返回窗口底色。
 * 创建窗口或切换主题时使用，避免深色模式出现白色闪屏。
 */
export const getThemeBackgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND

/** Windows 原生标题栏覆盖层颜色。 */
export const getTitleBarOverlayOptions = (): {
  color: string
  symbolColor: string
  height: number
} => ({
  color: nativeTheme.shouldUseDarkColors ? '#18191c' : '#ffffff',
  symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e7e9' : '#172033',
  height: 32
})

let titleBarOverlayWindow: BrowserWindow | null = null

/** 记录启用了标题栏覆盖层的主窗口，主题切换时只更新该窗口。 */
export const registerTitleBarOverlayWindow = (window: BrowserWindow): void => {
  titleBarOverlayWindow = window
  window.setTitleBarOverlay(getTitleBarOverlayOptions())
}

/**
 * 将主题变化广播给所有窗口。
 * 同时更新原生窗口底色，保证窗口框架和页面内容一致。
 */
const broadcastThemeState = (): void => {
  const state = getThemeState()

  // 所有窗口共用同一份主题状态，避免多窗口之间显示不一致。
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(state.isDark ? DARK_BACKGROUND : LIGHT_BACKGROUND)

    if (
      process.platform === 'win32' &&
      titleBarOverlayWindow &&
      !titleBarOverlayWindow.isDestroyed()
    ) {
      titleBarOverlayWindow.setTitleBarOverlay(getTitleBarOverlayOptions())
    }

    window.webContents.send('theme:changed', state)
  }
}

/**
 * 初始化主题模块。
 * 先恢复上次选择，再注册 IPC 和系统主题变化监听。
 */
export const initializeTheme = (): void => {
  // 在创建窗口前恢复上次主题，使 nativeTheme 和 prefer-color-scheme 一开始就是正确值。
  nativeTheme.themeSource = getPreferences().theme

  // 读取当前主题，供渲染进程初始化 ThemeProvider 时使用。
  ipcMain.handle('theme:get', (): ThemeState => getThemeState())

  // 接收渲染进程的主题切换请求。
  ipcMain.handle('theme:set', (_event, mode: unknown): ThemeState => {
    if (!isThemeMode(mode)) {
      throw new Error('Invalid theme mode')
    }

    nativeTheme.themeSource = mode
    updatePreferences({ theme: mode })

    return getThemeState()
  })

  // 用户切换或操作系统主题变化时统一广播给所有窗口。
  nativeTheme.on('updated', broadcastThemeState)
}
