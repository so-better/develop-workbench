import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Button, Dropdown, Tooltip } from 'antd'
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
 * 使用单一图标按钮和向上弹出的菜单，避免占用 Footer 横向空间。
 */
export default function ThemeSwitcher(): JSX.Element {
  const { mode, setMode } = useTheme()
  const activeOption = themeOptions.find((option) => option.value === mode) ?? themeOptions[0]

  return (
    <Dropdown
      placement="topRight"
      trigger={['click']}
      menu={{
        items: themeMenuItems,
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => setMode(key as ThemeMode)
      }}
    >
      <span className="theme-trigger-wrapper">
        <Tooltip title={`主题：${activeOption.label}`}>
          <Button
            type="text"
            size="small"
            className="theme-trigger"
            icon={activeOption.icon}
            aria-label={`主题：${activeOption.label}`}
          />
        </Tooltip>
      </span>
    </Dropdown>
  )
}
