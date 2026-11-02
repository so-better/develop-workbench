import { useEffect } from 'react'
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import type { ThemeMode } from '../../../../types/theme'
import { useTheme } from '../../theme/ThemeProvider'

// 主题切换控件提供的三种模式。
const themeOptions: Array<{ label: string; value: ThemeMode; icon: JSX.Element }> = [
  { label: '跟随系统', value: 'system', icon: <DesktopOutlined /> },
  { label: '浅色', value: 'light', icon: <SunOutlined /> },
  { label: '深色', value: 'dark', icon: <MoonOutlined /> }
]

const themeMenuItems: MenuProps['items'] = themeOptions.map((option) => ({
  key: option.value,
  label: option.label,
  icon: option.icon
}))

/**
 * 主题模式切换控件。
 * 支持点击、键盘操作和 Cmd/Ctrl+Shift+L 快捷切换。
 */
export default function ThemeSwitcher(): JSX.Element {
  const { mode, setMode } = useTheme()
  const activeOption = themeOptions.find((option) => option.value === mode) ?? themeOptions[0]

  /** Cmd/Ctrl+Shift+L 依次切换跟随系统、浅色和深色。 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'l'
      ) {
        return
      }

      const target = event.target

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      const currentIndex = themeOptions.findIndex((option) => option.value === mode)
      const next = themeOptions[(currentIndex + 1) % themeOptions.length]
      setMode(next.value)
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [mode, setMode])

  return (
    <Dropdown
      placement="topRight"
      trigger={['click', 'hover']}
      menu={{
        items: themeMenuItems,
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => setMode(key as ThemeMode)
      }}
    >
      <Button
        type="text"
        size="middle"
        icon={activeOption.icon}
        aria-label={`主题：${activeOption.label}，快捷键 Cmd/Ctrl+Shift+L`}
        aria-haspopup="menu"
      />
    </Dropdown>
  )
}
