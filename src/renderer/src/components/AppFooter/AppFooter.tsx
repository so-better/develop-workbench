import {
  CheckSquareOutlined,
  CloudOutlined,
  DownloadOutlined,
  GlobalOutlined,
  HistoryOutlined,
  ReadOutlined,
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
  quickNoteCount: number
  /** 浏览器收起后保留的页面数量；为 0 时不展示恢复入口。 */
  browserTabCount: number
  onResumeBrowser: () => void
  onOpenDownloads: () => void
  onOpenQuickNotes: () => void
  onOpenGuide: () => void
  onOpenChangelog: () => void
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
  quickNoteCount,
  browserTabCount,
  onResumeBrowser,
  onOpenDownloads,
  onOpenQuickNotes,
  onOpenGuide,
  onOpenChangelog,
  onOpenAi,
  onOpenCloudDocs,
  onOpenQuickAccess
}: AppFooterProps): JSX.Element {
  const isMac = window.electron.platform === 'darwin'
  const quickAccessShortcut = isMac ? '⌘K' : 'Ctrl K'
  return (
    <footer className="app-footer">
      <div className="footer-leading">
        {appInfo ? (
          <span className="footer-version">
            <span>当前版本：</span>
            <Tag bordered={false}>v{appInfo.appVersion}</Tag>
          </span>
        ) : null}
        <Button
          type="text"
          size="small"
          icon={<HistoryOutlined />}
          onClick={onOpenChangelog}
        >
          更新日志
        </Button>
        <Badge count={quickNoteCount} size="small">
          <Button
            type="text"
            size="small"
            icon={<CheckSquareOutlined />}
            data-quick-notes-trigger
            onClick={onOpenQuickNotes}
          >
            待办简记
          </Button>
        </Badge>
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
        {browserTabCount > 0 ? (
          <Badge count={browserTabCount} size="small">
            <Tooltip title="恢复已收起的浏览器页面">
              <Button
                type="text"
                size="small"
                icon={<GlobalOutlined />}
                onClick={onResumeBrowser}
              >
                浏览器
              </Button>
            </Tooltip>
          </Badge>
        ) : null}
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
        <Tooltip title="使用手册">
          <Button
            type="text"
            size="middle"
            icon={<ReadOutlined />}
            aria-label="打开使用手册"
            onClick={onOpenGuide}
          />
        </Tooltip>
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
