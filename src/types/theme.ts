/**
 * 支持的主题模式。
 * system 跟随系统，light 强制浅色，dark 强制深色。
 */
export type ThemeMode = 'system' | 'light' | 'dark'

/**
 * 主进程返回给渲染进程的主题状态。
 * mode 是用户选择，isDark 是最终解析出的实际明暗结果。
 */
export interface ThemeState {
  mode: ThemeMode
  isDark: boolean
}
