import { SettingOutlined } from '@ant-design/icons'
import { Avatar } from 'antd'
import type { AppInfo } from '../../../types/app'
import type { LarkUser } from '../../../types/lark'

interface AppFooterProps {
  user: LarkUser | null
  appInfo: AppInfo | null
  onOpenSettings: () => void
}

/**
 * 应用底部状态栏。
 * 左侧只展示已登录的飞书用户，右侧始终提供设置入口和版本号。
 */
export default function AppFooter({ user, appInfo, onOpenSettings }: AppFooterProps): JSX.Element {
  return (
    <footer className="app-footer">
      <div className="footer-user">
        {user ? (
          <>
            <Avatar size={24} src={user.avatarUrl} className="footer-avatar">
              {user.name.slice(0, 1)}
            </Avatar>
            <span className="footer-user-name">{user.name}</span>
          </>
        ) : null}
      </div>

      <div className="footer-actions">
        {appInfo ? <span className="footer-version">v{appInfo.appVersion}</span> : null}
        <button type="button" className="footer-settings" onClick={onOpenSettings}>
          <SettingOutlined />
          <span>设置</span>
        </button>
      </div>
    </footer>
  )
}
