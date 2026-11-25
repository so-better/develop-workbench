import { Alert, App, Button } from 'antd'
import {
  CopyOutlined,
  ReloadOutlined,
  SettingOutlined
} from '@ant-design/icons'
import type { SettingsSection } from '../../../../types/settings'
import './ErrorRecovery.css'

interface ErrorRecoveryProps {
  /** 错误标题。 */
  title: string

  /** 错误详情。 */
  error: string

  /** 重试中状态。 */
  retrying?: boolean

  /** 重试回调。 */
  onRetry?: () => void

  /** 需要引导用户检查的设置分类。 */
  settingsSection?: SettingsSection

  /** 打开设置弹窗。 */
  onOpenSettings?: (section: SettingsSection) => void

  /** 最近一次成功读取/同步时间。 */
  lastSuccessAt?: number | null

  /** 有旧数据时使用 warning，完全无数据时使用 error。 */
  variant?: 'error' | 'warning'

  /** 额外样式类。 */
  className?: string
}

const formatLastSuccess = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/**
 * 统一的错误恢复提示。
 * 提供重试、检查设置和复制错误信息，减少用户在网络/配置异常时卡住。
 */
export default function ErrorRecovery({
  title,
  error,
  retrying = false,
  onRetry,
  settingsSection,
  onOpenSettings,
  lastSuccessAt,
  variant = 'error',
  className
}: ErrorRecoveryProps): JSX.Element {
  const { message } = App.useApp()

  const handleCopy = async (): Promise<void> => {
    try {
      await window.electron.copyText(`${title}\n${error}`)
      message.success('错误信息已复制')
    } catch {
      message.error('复制错误信息失败')
    }
  }

  return (
    <div className={`error-recovery${className ? ` ${className}` : ''}`}>
      <Alert
        type={variant}
        showIcon
        message={title}
        description={
          <div className="error-recovery-description">
            <span>{error}</span>
            {lastSuccessAt ? (
              <span className="error-recovery-last-success">
                最近成功：{formatLastSuccess(lastSuccessAt)}
              </span>
            ) : null}
          </div>
        }
      />
      <div className="error-recovery-actions">
        {onRetry ? (
          <Button
            type="primary"
            size="small"
            icon={<ReloadOutlined />}
            loading={retrying}
            onClick={onRetry}
          >
            重试
          </Button>
        ) : null}
        {settingsSection && onOpenSettings ? (
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => onOpenSettings(settingsSection)}
          >
            检查设置
          </Button>
        ) : null}
        <Button size="small" icon={<CopyOutlined />} onClick={() => void handleCopy()}>
          复制错误
        </Button>
      </div>
    </div>
  )
}
