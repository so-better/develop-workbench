import { DownloadOutlined } from '@ant-design/icons'
import { Alert, Button, Modal } from 'antd'
import type { UpdateCheckResult } from '../../../../types/updates'
import './UpdatePrompt.css'

interface UpdatePromptProps {
  update: UpdateCheckResult | null
  open: boolean
  onLater: (version: string) => void
  onDownload: (update: UpdateCheckResult) => void
}

/**
 * 新版本提示。
 * 点击下载后交给应用层处理，下载完成后再询问是否立即安装。
 */
export default function UpdatePrompt({
  update,
  open,
  onLater,
  onDownload
}: UpdatePromptProps): JSX.Element | null {
  if (!update) return null

  const handleLater = (): void => {
    onLater(update.latestVersion)
  }

  return (
    <Modal
      title="发现新版本"
      open={open}
      width={540}
      centered
      zIndex={1100}
      onCancel={handleLater}
      footer={[
        <Button key="later" onClick={handleLater}>
          跳过此版本
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined />}
          disabled={!update.package}
          onClick={() => onDownload(update)}
        >
          下载更新
        </Button>
      ]}
    >
      <div className="update-prompt">
        <div className="update-prompt-versions">
          <span>当前版本</span>
          <strong>v{update.currentVersion}</strong>
          <span className="update-prompt-arrow">→</span>
          <strong className="update-prompt-latest">
            v{update.latestVersion}
          </strong>
        </div>

        {update.package ? (
          <div className="update-prompt-package">
            <span>安装包</span>
            <strong>{update.package.name}</strong>
          </div>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="当前平台暂无可下载的安装包"
          />
        )}

        <p className="update-prompt-hint">
          下载会进入下载管理，完成后会先询问是否立即安装，不会直接退出应用。选择“跳过此版本”后，该版本不再自动提示，可在设置 → 应用信息中手动检查。
        </p>
      </div>
    </Modal>
  )
}
