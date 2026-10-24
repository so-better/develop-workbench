import { useState } from 'react'
import {
  DownloadOutlined,
  LogoutOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { App, Avatar, Badge, Button, Popconfirm, Tooltip } from 'antd'
import ThemeSwitcher from './ThemeSwitcher'
import type { AppInfo } from '../../../types/app'
import type { LarkUser } from '../../../types/lark'

interface AppFooterProps {
  user: LarkUser | null
  appInfo: AppInfo | null
  onOpenSettings: () => void
  onLogout: () => Promise<void>
  downloadCount: number
  onOpenDownloads: () => void
}

/**
 * 应用底部状态栏。
 * 左侧展示已登录用户和退出入口，右侧始终提供设置入口和版本号。
 */
export default function AppFooter({
  user,
  appInfo,
  onOpenSettings,
  onLogout,
  downloadCount,
  onOpenDownloads
}: AppFooterProps): JSX.Element {
  const { message } = App.useApp()
  const [loggingOut, setLoggingOut] = useState(false)

  /**
   * 确认退出 lark-cli 飞书登录态。
   */
  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true)

    try {
      await onLogout()
      message.success('已退出飞书登录')
    } catch {
      message.error('退出飞书登录失败')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <footer className="app-footer">
      <div className="footer-user">
        {user ? (
          <>
            <Avatar size={24} src={user.avatarUrl} className="footer-avatar">
              {user.name.slice(0, 1)}
            </Avatar>
            <span className="footer-user-name">{user.name}</span>
            <Popconfirm
              title="退出飞书登录？"
              okText="退出"
              cancelText="取消"
              placement="top"
              onConfirm={() => handleLogout()}
            >
              <Button
                type="text"
                size="small"
                className="footer-logout"
                icon={<LogoutOutlined />}
                aria-label="退出飞书登录"
                loading={loggingOut}
              />
            </Popconfirm>
          </>
        ) : null}
      </div>

      <div className="footer-actions">
        <Badge count={downloadCount} size="small">
          <Tooltip title="下载管理">
            <Button
              type="text"
              size="small"
              className="footer-download"
              icon={<DownloadOutlined />}
              aria-label="下载管理"
              onClick={onOpenDownloads}
            />
          </Tooltip>
        </Badge>
        <Tooltip title="设置">
          <button
            type="button"
            className="footer-settings"
            aria-label="设置"
            onClick={onOpenSettings}
          >
            <SettingOutlined />
          </button>
        </Tooltip>
        <ThemeSwitcher />
        {appInfo ? <span className="footer-version">v{appInfo.appVersion}</span> : null}
      </div>
    </footer>
  )
}
