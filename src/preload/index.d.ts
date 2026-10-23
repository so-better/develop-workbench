import type { ThemeMode, ThemeState } from '../types/theme'

export interface AppInfo {
  platform: string
  appVersion: string
  electron: string
  chrome: string
  node: string
}

export interface ElectronAPI {
  platform: string
  /** 获取应用与运行时版本信息。 */
  getAppInfo: () => Promise<AppInfo>
  /** 读取当前主题模式和实际明暗状态。 */
  getTheme: () => Promise<ThemeState>
  /** 切换主题模式并返回最新状态。 */
  setTheme: (mode: ThemeMode) => Promise<ThemeState>
  /** 订阅主题变化，返回取消订阅函数。 */
  onThemeChange: (listener: (state: ThemeState) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}

export {}
