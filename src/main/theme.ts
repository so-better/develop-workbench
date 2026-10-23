import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemeMode, ThemeState } from '../types/theme'

// 窗口底色与页面背景保持一致，用于避免加载和主题切换时的闪屏。
const LIGHT_BACKGROUND = '#f5f7fb'
const DARK_BACKGROUND = '#0b0f19'

/**
 * 校验外部传入的值是否为合法的主题模式。
 * 用于 IPC 参数和偏好文件解析。
 */
const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark'

// 首次启动或偏好文件损坏时使用的默认主题。
const DEFAULT_THEME_MODE: ThemeMode = 'system'

// 内存缓存，避免每次读取主题时都访问磁盘。
let cachedThemeMode: ThemeMode | null = null

/**
 * 获取主题偏好文件路径。
 * 文件存放在 Electron 的 userData 目录，跟随应用安装和用户环境隔离。
 */
const getThemePreferencePath = (): string => join(app.getPath('userData'), 'preferences.json')

/**
 * 从磁盘读取主题模式。
 * 文件不存在或格式异常时回退到跟随系统，保证应用仍可正常启动。
 */
const readThemePreference = (): ThemeMode => {
  // 已读取过时直接返回缓存，避免重复磁盘 IO。
  if (cachedThemeMode) return cachedThemeMode

  try {
    const raw = readFileSync(getThemePreferencePath(), 'utf-8')
    const parsed = JSON.parse(raw) as { theme?: unknown }

    // 校验主题字段，兼容旧版本或手工修改过的配置文件。
    cachedThemeMode = isThemeMode(parsed.theme) ? parsed.theme : DEFAULT_THEME_MODE
  } catch {
    // 文件不存在、无权限或 JSON 格式错误时使用默认主题。
    cachedThemeMode = DEFAULT_THEME_MODE
  }

  return cachedThemeMode
}

/**
 * 将主题模式写入内存和磁盘。
 * 写入失败时保留内存中的选择，不阻断当前主题切换。
 */
const saveThemePreference = (theme: ThemeMode): void => {
  // 先更新内存，确保即使磁盘写入失败，本次会话仍能保持用户选择。
  cachedThemeMode = theme

  try {
    writeFileSync(getThemePreferencePath(), JSON.stringify({ theme }, null, 2), 'utf-8')
  } catch {
    // 偏好持久化失败不影响当前主题，静默忽略写入异常。
    return
  }
}

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

/**
 * 将主题变化广播给所有窗口。
 * 同时更新原生窗口底色，保证窗口框架和页面内容一致。
 */
const broadcastThemeState = (): void => {
  const state = getThemeState()

  // 所有窗口共用同一份主题状态，避免多窗口之间显示不一致。
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(state.isDark ? DARK_BACKGROUND : LIGHT_BACKGROUND)
    window.webContents.send('theme:changed', state)
  }
}

/**
 * 初始化主题模块。
 * 先恢复上次选择，再注册 IPC 和系统主题变化监听。
 */
export const initializeTheme = (): void => {
  // 在创建窗口前恢复上次主题，使 nativeTheme 和 prefer-color-scheme 一开始就是正确值。
  nativeTheme.themeSource = readThemePreference()

  // 读取当前主题，供渲染进程初始化 ThemeProvider 时使用。
  ipcMain.handle('theme:get', (): ThemeState => getThemeState())

  // 接收渲染进程的主题切换请求。
  ipcMain.handle('theme:set', (_event, mode: unknown): ThemeState => {
    if (!isThemeMode(mode)) {
      throw new Error('Invalid theme mode')
    }

    nativeTheme.themeSource = mode
    saveThemePreference(mode)

    return getThemeState()
  })

  // 用户切换或操作系统主题变化时统一广播给所有窗口。
  nativeTheme.on('updated', broadcastThemeState)
}
