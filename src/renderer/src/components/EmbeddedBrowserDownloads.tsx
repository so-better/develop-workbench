import { App, Button, Empty, Progress, Tag } from 'antd'
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

import type { EmbeddedBrowserDownload } from '../../../types/embedded-browser'

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
      {downloads.map((download) => {
        const status =
          download.status === 'progressing' && download.paused
            ? pausedStatusMeta
            : downloadStatusMeta[download.status]
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
                  {formatBytes(download.receivedBytes)}
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
              {download.status === 'progressing' ? (
                <Progress
                  percent={percent}
                  size="small"
                  status={download.paused ? 'normal' : 'active'}
                  strokeColor={download.paused ? '#d97706' : undefined}
                  showInfo={download.totalBytes > 0}
                />
              ) : null}
              <div className="embedded-browser-download-actions">
                {download.status === 'progressing' ? (
                  <>
                    {download.paused ? (
                      <Button
                        type="text"
                        size="small"
                        className="embedded-browser-download-resume"
                        icon={<PlayCircleOutlined />}
                        onClick={() => void handleResume(download.id)}
                      >
                        继续下载
                      </Button>
                    ) : (
                      <Button
                        type="text"
                        size="small"
                        className="embedded-browser-download-pause"
                        icon={<PauseCircleOutlined />}
                        onClick={() => void handlePause(download.id)}
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
                      onClick={() => void handleCancel(download.id)}
                    >
                      取消下载
                    </Button>
                  </>
                ) : null}
                {download.status === 'interrupted' ? (
                  <Button
                    type="text"
                    size="small"
                    className="embedded-browser-download-retry"
                    icon={<RedoOutlined />}
                    onClick={() => void handleRetry(download.id)}
                  >
                    重试下载
                  </Button>
                ) : null}
                {download.status === 'completed' ? (
                  <>
                    <Button
                      size="small"
                      type="primary"
                      className="embedded-browser-download-open"
                      onClick={() => void handleOpen(download.id)}
                    >
                      打开文件
                    </Button>
                    <Button
                      type="text"
                      size="small"
                      className="embedded-browser-download-show"
                      icon={<FolderOpenOutlined />}
                      onClick={() => void handleShow(download.id)}
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

      <div className="embedded-browser-download-footer">
        <Button
          type="text"
          size="small"
          className="embedded-browser-download-clear"
          icon={<DeleteOutlined />}
          disabled={!downloads.some((item) => item.status !== 'progressing')}
          onClick={() => void handleClear()}
        >
          清除已结束
        </Button>
      </div>
    </div>
  )
}
