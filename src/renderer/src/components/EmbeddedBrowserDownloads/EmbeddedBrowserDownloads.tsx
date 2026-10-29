import { App, Button, Empty, Popconfirm, Progress, Tag } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  StopOutlined
} from '@ant-design/icons'

import type { EmbeddedBrowserDownload } from '../../../../types/embedded-browser'

interface EmbeddedBrowserDownloadsProps {
  /** 下载列表。 */
  downloads: EmbeddedBrowserDownload[]
}

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '未知大小'

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

const formatSpeed = (bytes: number): string =>
  Number.isFinite(bytes) && bytes > 0 ? `${formatBytes(bytes)}/s` : ''

const downloadStatusMeta: Record<
  EmbeddedBrowserDownload['status'],
  { label: string; color: string; icon: JSX.Element }
> = {
  progressing: {
    label: '下载中',
    color: 'processing',
    icon: <DownloadOutlined />
  },
  completed: {
    label: '已完成',
    color: 'success',
    icon: <CheckCircleFilled />
  },
  cancelled: {
    label: '已取消',
    color: 'default',
    icon: <CloseCircleFilled />
  },
  interrupted: {
    label: '已中断',
    color: 'error',
    icon: <ExclamationCircleFilled />
  }
}

const pausedStatusMeta = {
  label: '已暂停',
  color: 'warning',
  icon: <PauseCircleOutlined />
}

/**
 * 下载列表和操作。
 * 面板底部抽屉和应用级弹窗复用同一套列表。
 */
export default function EmbeddedBrowserDownloads({
  downloads
}: EmbeddedBrowserDownloadsProps): JSX.Element {
  const { message } = App.useApp()

  const handleOpen = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.openEmbeddedBrowserDownload(downloadId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '打开文件失败')
    }
  }

  const handleInstall = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.installUpdateDownload(downloadId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '安装更新失败')
    }
  }

  const handleShow = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.showEmbeddedBrowserDownload(downloadId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法定位文件')
    }
  }

  const handleCancel = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.cancelEmbeddedBrowserDownload(downloadId)
    } catch {
      message.error('取消下载失败')
    }
  }

  const handlePause = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.pauseEmbeddedBrowserDownload(downloadId)
    } catch {
      message.error('暂停下载失败')
    }
  }

  const handleResume = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.resumeEmbeddedBrowserDownload(downloadId)
    } catch {
      message.error('继续下载失败')
    }
  }

  const handleRetry = async (downloadId: string): Promise<void> => {
    try {
      await window.electron.retryEmbeddedBrowserDownload(downloadId)
      message.success('已重新开始下载')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重试下载失败')
    }
  }

  const handleClear = async (): Promise<void> => {
    try {
      await window.electron.clearEmbeddedBrowserDownloads()
    } catch {
      message.error('清除下载记录失败')
    }
  }

  if (downloads.length === 0) {
    return (
      <Empty
        className="embedded-browser-download-empty"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无下载记录"
      />
    )
  }

  return (
    <div className="embedded-browser-downloads">
      <div className="embedded-browser-downloads-list">
        {downloads.map((download) => {
        const isAiArtifact = download.origin === 'ai'
        const isUpdate = download.origin === 'update'
        const isInstallableUpdate =
          isUpdate && /\.(dmg|exe)$/i.test(download.filename)
        const isGenerated = download.origin !== 'browser'
        const baseStatus =
          download.status === 'progressing' && download.paused
            ? pausedStatusMeta
            : downloadStatusMeta[download.status]
        const status = isAiArtifact
          ? download.status === 'progressing'
            ? { ...baseStatus, label: '保存中' }
            : download.status === 'completed'
              ? { ...baseStatus, label: '已保存' }
              : download.status === 'interrupted'
                ? { ...baseStatus, label: '保存失败' }
                : baseStatus
          : isUpdate
            ? download.status === 'progressing'
              ? { ...baseStatus, label: '下载中' }
              : download.status === 'completed'
                ? { ...baseStatus, label: '已下载' }
                : download.status === 'interrupted'
                  ? { ...baseStatus, label: '下载失败' }
                  : baseStatus
            : baseStatus
        const percent =
          download.totalBytes > 0
            ? Math.min(
                100,
                Math.round((download.receivedBytes / download.totalBytes) * 100)
              )
            : 0

        return (
          <div
            className={`embedded-browser-download is-${download.status}${
              download.paused ? ' is-paused' : ''
            }`}
            key={download.id}
          >
            <span className="embedded-browser-download-status" aria-hidden="true">
              {status.icon}
            </span>
            <div className="embedded-browser-download-body">
              <div className="embedded-browser-download-head">
                <strong title={download.filename}>
                  {download.filename || '未命名文件'}
                </strong>
                <Tag color={status.color} bordered={false}>
                  {status.label}
                </Tag>
              </div>
              <div className="embedded-browser-download-meta">
                <span className="embedded-browser-download-size">
                  {isUpdate ? '已下载 ' : ''}
                  {isUpdate && download.receivedBytes === 0
                    ? '0 B'
                    : formatBytes(download.receivedBytes)}
                  {download.totalBytes > 0
                    ? ` / ${formatBytes(download.totalBytes)}`
                    : ''}
                  {download.totalBytes > 0 ? ` · ${percent}%` : ''}
                </span>
                {download.status === 'progressing' &&
                !download.paused &&
                download.bytesPerSecond > 0 ? (
                  <span className="embedded-browser-download-speed">
                    {formatSpeed(download.bytesPerSecond)}
                  </span>
                ) : null}
              </div>
              {download.savePath ? (
                <div
                  className="embedded-browser-download-path-row"
                  title={download.savePath}
                >
                  <span>保存到</span>
                  <span className="embedded-browser-download-path">
                    {download.savePath}
                  </span>
                </div>
              ) : null}
              {download.status === 'progressing' && download.totalBytes > 0 ? (
                <Progress
                  percent={percent}
                  size="small"
                  status={download.paused ? 'normal' : 'active'}
                  strokeColor={download.paused ? '#d97706' : undefined}
                />
              ) : null}
              <div className="embedded-browser-download-actions">
                {download.status === 'progressing' && !isGenerated ? (
                  <>
                    {download.paused ? (
                      <Button
                        type="text"
                        size="small"
                        className="embedded-browser-download-resume"
                        icon={<PlayCircleOutlined />}
                        onClick={() => handleResume(download.id)}
                      >
                        继续下载
                      </Button>
                    ) : (
                      <Button
                        type="text"
                        size="small"
                        className="embedded-browser-download-pause"
                        icon={<PauseCircleOutlined />}
                        onClick={() => handlePause(download.id)}
                      >
                        暂停
                      </Button>
                    )}
                    <Button
                      type="text"
                      danger
                      size="small"
                      className="embedded-browser-download-cancel"
                      icon={<StopOutlined />}
                      onClick={() => handleCancel(download.id)}
                    >
                      取消下载
                    </Button>
                  </>
                ) : null}
                {download.status === 'interrupted' && !isGenerated ? (
                  <Button
                    type="text"
                    size="small"
                    className="embedded-browser-download-retry"
                    icon={<RedoOutlined />}
                    onClick={() => handleRetry(download.id)}
                  >
                    重试下载
                  </Button>
                ) : null}
                {download.status === 'completed' ? (
                  <>
                    {isInstallableUpdate ? (
                      <Popconfirm
                        title="安装更新并退出应用？"
                        description="将打开安装包并退出当前应用。"
                        rootClassName="update-install-confirm"
                        okText="安装"
                        cancelText="取消"
                        onConfirm={() => handleInstall(download.id)}
                      >
                        <Button
                          size="small"
                          type="primary"
                          className="embedded-browser-download-install"
                        >
                          安装更新
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Button
                        size="small"
                        type="primary"
                        className="embedded-browser-download-open"
                        onClick={() => handleOpen(download.id)}
                      >
                        打开文件
                      </Button>
                    )}
                    <Button
                      type="text"
                      size="small"
                      className="embedded-browser-download-show"
                      icon={<FolderOpenOutlined />}
                      onClick={() => handleShow(download.id)}
                    >
                      所在文件夹
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )
        })}
      </div>

      <div className="embedded-browser-download-footer">
        <Button
          type="text"
          size="small"
          className="embedded-browser-download-clear"
          icon={<DeleteOutlined />}
          disabled={!downloads.some((item) => item.status !== 'progressing')}
          onClick={() => handleClear()}
        >
          清除已结束
        </Button>
      </div>
    </div>
  )
}
