import { useState } from 'react'
import { DownloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Modal } from 'antd'
import type { UpdateCheckResult } from '../../../../types/updates'

interface UpdatePromptProps {
  update: UpdateCheckResult | null
  open: boolean
  onClose: () => void
}

/**
 * 新版本提示。
 * 只下载安装包，安装动作在下载管理中进行。
 */
export default function UpdatePrompt({
  update,
  open,
  onClose
}: UpdatePromptProps): JSX.Element | null {
  const { message } = App.useApp()
  const [downloading, setDownloading] = useState(false)

  if (!update) return null

  const handleDownload = async (): Promise<void> => {
    if (!update.package || downloading) return

    setDownloading(true)
    onClose()
    message.info('已开始下载，请在下载管理中查看进度')

    try {
      await window.electron.downloadUpdatePackage(update.package)
    } catch {
      // 下载状态统一交给下载管理界面处理。
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      title="发现新版本"
      open={open}
      width={540}
      centered
      zIndex={1100}
      onCancel={onClose}
      footer={[
        <Button key="later" onClick={onClose}>
          稍后
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined />}
          loading={downloading}
          disabled={!update.package}
          onClick={() => handleDownload()}
        >
          下载安装包
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
          安装包来自飞书云盘，下载完成后可在下载管理中安装更新。
        </p>
      </div>
    </Modal>
  )
}
