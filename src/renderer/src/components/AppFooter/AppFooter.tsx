import { DownloadOutlined, SettingOutlined } from '@ant-design/icons'
import { Badge, Button, Tag, Tooltip } from 'antd'
import RobotMark from '../RobotMark/RobotMark'
import ThemeSwitcher from '../ThemeSwitcher/ThemeSwitcher'
import type { AppInfo } from '../../../../types/app'

interface AppFooterProps {
  appInfo: AppInfo | null
  onOpenSettings: () => void
  downloadCount: number
  onOpenDownloads: () => void
  onOpenAi: () => void
}

/**
 * 应用底部状态栏。
 * 不展示应用登录信息，只保留 AI、下载、设置、主题和版本入口。
 */
export default function AppFooter({
  appInfo,
  onOpenSettings,
  downloadCount,
  onOpenDownloads,
  onOpenAi
}: AppFooterProps): JSX.Element {
  return (
    <footer className="app-footer">
      {appInfo ? (
        <span className="footer-version">
          <span>当前版本：</span>
          <Tag bordered={false}>v{appInfo.appVersion}</Tag>
        </span>
      ) : null}

      <div className="footer-actions">
        <Tooltip title="AI 助手">
          <Button
            type="text"
            size="small"
            className="footer-ai"
            icon={<RobotMark />}
            aria-label="打开 AI 助手"
            onClick={onOpenAi}
          />
        </Tooltip>
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
      </div>
    </footer>
  )
}
