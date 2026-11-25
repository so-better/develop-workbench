import {
  CheckSquareOutlined,
  CloudOutlined,
  CommentOutlined,
  DownloadOutlined,
  GlobalOutlined,
  HistoryOutlined,
  ReadOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Badge, Button, Tooltip } from 'antd'
import RobotMark from '../RobotMark/RobotMark'
import ThemeSwitcher from '../ThemeSwitcher/ThemeSwitcher'
import type { AppInfo } from '../../../../types/app'
import './AppFooter.css'

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
  onOpenFeedback: () => void
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
  onOpenFeedback,
  onOpenQuickAccess
}: AppFooterProps): JSX.Element {
  const isMac = window.electron.platform === 'darwin'
  const quickAccessShortcut = isMac ? '⌘K' : 'Ctrl K'
  return (
    <footer className="app-footer">
      <div className="footer-meta">
        {appInfo ? (
          <span className="footer-version">v{appInfo.appVersion}</span>
        ) : null}
        <Button
          type="text"
          size="small"
          icon={<HistoryOutlined />}
          title="更新日志"
          onClick={onOpenChangelog}
        >
          <span className="footer-meta-label">更新日志</span>
        </Button>
        <Button
          type="text"
          size="small"
          icon={<ReadOutlined />}
          title="使用手册"
          onClick={onOpenGuide}
        >
          <span className="footer-meta-label">使用手册</span>
        </Button>
        <Button
          type="text"
          size="small"
          icon={<CloudOutlined />}
          title="飞书云文档"
          onClick={onOpenCloudDocs}
        >
          <span className="footer-meta-label">飞书云文档</span>
        </Button>
        <Button
          type="text"
          size="small"
          icon={<CommentOutlined />}
          title="提交反馈"
          onClick={onOpenFeedback}
        >
          <span className="footer-meta-label">提交反馈</span>
        </Button>
      </div>

      <Button
        type="text"
        size="small"
        className="footer-search-trigger"
        icon={<SearchOutlined />}
        onClick={onOpenQuickAccess}
      >
        <span className="footer-action-label">搜索</span>
        <kbd>{quickAccessShortcut}</kbd>
      </Button>

      <div className="footer-end">
        <div className="footer-activity">
          {browserTabCount > 0 ? (
            <Badge count={browserTabCount} size="small">
              <Tooltip title="恢复已收起的浏览器页面">
                <Button
                  type="text"
                  size="small"
                  icon={<GlobalOutlined />}
                  onClick={onResumeBrowser}
                >
                  <span className="footer-action-label">浏览器</span>
                </Button>
              </Tooltip>
            </Badge>
          ) : null}
          <Badge count={quickNoteCount} size="small">
            <Button
              type="text"
              size="small"
              icon={<CheckSquareOutlined />}
              data-quick-notes-trigger
              onClick={onOpenQuickNotes}
            >
              <span className="footer-action-label">待办简记</span>
            </Button>
          </Badge>
          <Badge count={downloadCount} size="small">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={onOpenDownloads}
            >
              <span className="footer-action-label">下载管理</span>
            </Button>
          </Badge>
        </div>

        <span className="footer-divider" aria-hidden="true" />

        <div className="footer-actions">
          <Tooltip title="AI 助手">
            <Button
              type="text"
              size="small"
              icon={<RobotMark />}
              aria-label="打开 AI 助手"
              onClick={onOpenAi}
            />
          </Tooltip>
          <Tooltip title="设置">
            <Button
              type="text"
              size="small"
              icon={<SettingOutlined />}
              aria-label="设置"
              onClick={onOpenSettings}
            />
          </Tooltip>
          <ThemeSwitcher />
        </div>
      </div>
    </footer>
  )
}
