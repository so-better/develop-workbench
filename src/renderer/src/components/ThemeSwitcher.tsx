import { Segmented } from 'antd'
import type { ThemeMode } from '../../../types/theme'
import { useTheme } from '../theme/ThemeProvider'

// 主题切换控件提供的三种模式。
const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' }
]

/**
 * 主题模式切换控件。
 * 只负责展示和触发切换，实际主题状态由 ThemeProvider 与主进程维护。
 */
export default function ThemeSwitcher(): JSX.Element {
  const { mode, setMode } = useTheme()

  return (
    <div className="theme-switcher" role="group" aria-label="主题模式">
      <Segmented
        size="small"
        value={mode}
        options={themeOptions}
        onChange={(value) => setMode(value as ThemeMode)}
      />
    </div>
  )
}
