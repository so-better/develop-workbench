import { useState } from 'react'
import { DownloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Modal } from 'antd'
import type { UpdateCheckResult } from '../../../../types/updates'
import { getErrorMessage } from '../../../../utils'
import './UpdatePrompt.css'

interface UpdatePromptProps {
  update: UpdateCheckResult | null
  open: boolean
  onClose: () => void
  onLater: (version: string) => void
  onStartUpdate: (version: string) => void
}

/**
 * 新版本提示。
 * 立即更新会下载安装包并尝试自动打开安装程序。
 */
export default function UpdatePrompt({
  update,
  open,
  onClose,
  onLater,
  onStartUpdate
}: UpdatePromptProps): JSX.Element | null {
  const { message } = App.useApp()
  const [downloading, setDownloading] = useState(false)

  if (!update) return null

  const handleLater = (): void => {
    onLater(update.latestVersion)
  }

  const handleDownload = async (): Promise<void> => {
    if (!update.package || downloading) return

    setDownloading(true)
    onStartUpdate(update.latestVersion)
    onClose()
    message.info('正在下载更新，完成后将自动打开安装程序')

    try {
      const result = await window.electron.downloadUpdatePackage(update.package)

      try {
        await window.electron.installUpdateDownload(result.downloadId)
      } catch (installError) {
        message.error(
          getErrorMessage(
            installError,
            '安装更新失败，请在下载管理中手动安装'
          )
        )
      }
    } catch (downloadError) {
      message.error(getErrorMessage(downloadError, '下载更新失败'))
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
      onCancel={handleLater}
      footer={[
        <Button key="later" onClick={handleLater}>
          稍后更新
        </Button>,
        <Button
          key="download"
          type="primary"
          icon={<DownloadOutlined />}
          loading={downloading}
          disabled={!update.package}
          onClick={() => handleDownload()}
        >
          立即更新
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
          立即更新会自动下载并打开安装程序，应用随后退出；如当前平台只有 zip 包，需要手动解压安装。选择“稍后更新”后，该版本不再自动弹出，可在设置 → 应用信息中手动检查。
        </p>
      </div>
    </Modal>
  )
}
