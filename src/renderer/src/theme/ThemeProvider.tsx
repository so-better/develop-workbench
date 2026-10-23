import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import type { ThemeMode, ThemeState } from '../../../types/theme'

interface ThemeContextValue {
  mode: ThemeMode
  isDark: boolean
  setMode: (mode: ThemeMode) => void
}

interface ThemeProviderProps {
  children: ReactNode
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// Ant Design 的日期面板和 dayjs 格式化统一使用中文。
dayjs.locale('zh-cn')

/**
 * 读取系统当前的明暗偏好。
 * 主进程会先应用持久化主题，因此首次读取即可得到正确结果。
 */
const getSystemIsDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * 将明暗状态同步到根节点。
 * 供 CSS 变量和浏览器原生控件读取。
 */
const applyDocumentTheme = (isDark: boolean): void => {
  const root = document.documentElement
  root.dataset.theme = isDark ? 'dark' : 'light'
  root.style.colorScheme = isDark ? 'dark' : 'light'
}

// 模块加载时先同步应用一次，确保 React 首次渲染前页面已经是正确主题。
applyDocumentTheme(getSystemIsDark())

/**
 * 全局主题提供器。
 * 同步主进程主题状态，并为 Ant Design 提供对应的亮色或暗色算法。
 */
export default function ThemeProvider({ children }: ThemeProviderProps): JSX.Element {
  // 首屏先根据系统偏好渲染，随后再从主进程读取用户上次保存的选择。
  const [themeState, setThemeState] = useState<ThemeState>(() => ({
    mode: 'system',
    isDark: getSystemIsDark()
  }))

  useEffect(() => {
    let active = true

    /**
     * 接收主进程返回的主题状态。
     * 组件卸载后忽略迟到的异步结果，避免无效更新。
     */
    const applyThemeState = (next: ThemeState): void => {
      if (active) setThemeState(next)
    }

    // 初始化时读取持久化主题，并订阅后续由系统或用户触发的主题变化。
    window.electron
      .getTheme()
      .then(applyThemeState)
      .catch(() => {
        applyThemeState({ mode: 'system', isDark: getSystemIsDark() })
      })

    const unsubscribe = window.electron.onThemeChange(applyThemeState)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // 使用 useLayoutEffect 在绘制前同步主题，避免切换时出现浅色闪屏。
  useLayoutEffect(() => {
    applyDocumentTheme(themeState.isDark)
  }, [themeState.isDark])

  /**
   * 请求主进程切换主题。
   * 以主进程返回结果为准，保证系统主题、原生窗口和页面状态一致。
   */
  const setMode = useCallback((mode: ThemeMode): void => {
    window.electron
      .setTheme(mode)
      .then(setThemeState)
      .catch(() => undefined)
  }, [])

  // Ant Design 主题配置：暗色模式下切换算法，并复用同一套基础设计变量。
  const themeConfig = useMemo<ThemeConfig>(
    () => ({
      algorithm: themeState.isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: '#1677ff',
        colorInfo: '#1677ff',
        colorSuccess: '#16a34a',
        colorWarning: '#f59e0b',
        colorError: '#ef4444',
        borderRadius: 10,
        controlHeight: 36,
        colorBgLayout: themeState.isDark ? '#0b0f19' : '#f5f7fb',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
      }
    }),
    [themeState.isDark]
  )

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      mode: themeState.mode,
      isDark: themeState.isDark,
      setMode
    }),
    [setMode, themeState.isDark, themeState.mode]
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      <ConfigProvider theme={themeConfig} locale={zhCN}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

/**
 * 读取当前主题状态和切换方法。
 * 必须在 ThemeProvider 内部使用，否则说明组件树配置有误。
 */
export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider')
  }

  return context
}
