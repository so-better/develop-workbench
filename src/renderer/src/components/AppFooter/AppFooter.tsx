import {
  CloudOutlined,
  DownloadOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
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
  onOpenCloudDocs: () => void
  onOpenQuickAccess: () => void
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
  onOpenAi,
  onOpenCloudDocs,
  onOpenQuickAccess
}: AppFooterProps): JSX.Element {
  const quickAccessShortcut = window.electron.platform === 'darwin' ? '⌘K' : 'Ctrl K'
  return (
    <footer className="app-footer">
      <div className="footer-leading">
        {appInfo ? (
          <span className="footer-version">
            <span>当前版本：</span>
            <Tag bordered={false}>v{appInfo.appVersion}</Tag>
          </span>
        ) : null}
        <Badge count={downloadCount} size="small">
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            onClick={onOpenDownloads}
          >
            下载管理
          </Button>
        </Badge>
      </div>

      <div className="footer-actions">
        <Button
          type="text"
          size="small"
          className="footer-search-trigger"
          icon={<SearchOutlined />}
          onClick={onOpenQuickAccess}
        >
          搜索
          <kbd>{quickAccessShortcut}</kbd>
        </Button>
        <Tooltip title="飞书云文档">
          <Button
            type="text"
            size="middle"
            icon={<CloudOutlined />}
            aria-label="打开飞书云文档"
            onClick={onOpenCloudDocs}
          />
        </Tooltip>
        <Tooltip title="AI 助手">
          <Button
            type="text"
            size="middle"
            icon={<RobotMark />}
            aria-label="打开 AI 助手"
            onClick={onOpenAi}
          />
        </Tooltip>
        <Tooltip title="设置">
          <Button
            type="text"
            size="middle"
            icon={<SettingOutlined />}
            aria-label="设置"
            onClick={onOpenSettings}
          />
        </Tooltip>
        <ThemeSwitcher />
      </div>
    </footer>
  )
}
