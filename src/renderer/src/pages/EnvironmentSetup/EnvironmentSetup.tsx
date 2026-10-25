import { Alert, Button, Tag } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  SettingOutlined
} from '@ant-design/icons'
import type { AuthProvider } from '../../../../types/auth'
import type { LarkCliInfo, LarkUser } from '../../../../types/lark'
import type { MeegleState } from '../../../../types/meegle'
import type { SettingsSection } from '../../../../types/settings'

interface EnvironmentSetupProps {
  /** Meegle CLI 与授权状态。 */
  meegleState: MeegleState | null

  /** lark-cli 配置状态。 */
  larkCliInfo: LarkCliInfo | null

  /** 已授权的飞书用户。 */
  larkUser: LarkUser | null

  /** 最近一次触发过期的 CLI。 */
  authExpiredProvider: AuthProvider | null

  /** 打开对应设置分类。 */
  onOpenSettings: (section: SettingsSection) => void
}

/**
 * 环境准备页。
 * 应用没有账号体系，仅展示本地 CLI 的安装和授权状态。
 */
export default function EnvironmentSetup({
  meegleState,
  larkCliInfo,
  larkUser,
  authExpiredProvider,
  onOpenSettings
}: EnvironmentSetupProps): JSX.Element {
  const meegleAvailable = meegleState?.cli.available ?? false
  const meegleAuthenticated = meegleState?.authenticated ?? false
  const larkAvailable = larkCliInfo?.available ?? false
  const meegleStatus = meegleAuthenticated
    ? '已登录'
    : meegleAvailable
      ? '未登录'
      : '未检测到'
  const larkStatus = larkUser
    ? '已登录'
    : larkAvailable
      ? '未登录'
      : '未检测到'

  return (
    <section className="environment-setup">
      <div className="environment-card">
        <div className="environment-icon">W</div>
        <h2>环境准备</h2>
        <p>
          使用本工作台前，请确保 Lark Cli 和 Meegle Cli 已完成登录。目前检测到：Meegle Cli {meegleStatus}，Lark Cli {larkStatus}。
        </p>

        {authExpiredProvider ? (
          <Alert
            type="warning"
            showIcon
            message={`${
              authExpiredProvider === 'meegle' ? 'Meegle Cli' : 'Lark Cli'
            } 授权已过期，请重新授权后继续使用`}
          />
        ) : null}

        <div className="environment-status-list">
          <div className="environment-status-row">
            <div className="environment-status-copy">
              <strong>Meegle Cli 授权</strong>
              <span>必需，用于读取需求、流程和项目数据</span>
            </div>
            <Tag
              className={`environment-status-tag${
                meegleAuthenticated
                  ? ' is-success'
                  : meegleAvailable
                    ? ' is-warning'
                    : ' is-error'
              }`}
              bordered={false}
            >
              {meegleAuthenticated ? (
                <>
                  <CheckCircleFilled />
                  已授权
                </>
              ) : meegleAvailable ? (
                <>
                  <ExclamationCircleFilled />
                  未授权
                </>
              ) : (
                <>
                  <CloseCircleFilled />
                  未检测到 CLI
                </>
              )}
            </Tag>
            {!meegleAuthenticated ? (
              <Button
                type="link"
                size="small"
                className="environment-settings-button is-required"
                icon={<SettingOutlined />}
                onClick={() => onOpenSettings('meegle')}
              >
                去设置
              </Button>
            ) : null}
          </div>

          <div className="environment-status-row">
            <div className="environment-status-copy">
              <strong>Lark Cli 授权</strong>
              <span>必需，用于飞书文档、链接和数据交互</span>
            </div>
            <Tag
              className={`environment-status-tag${
                larkUser
                  ? ' is-success'
                  : larkAvailable
                    ? ' is-warning'
                    : ' is-error'
              }`}
              bordered={false}
            >
              {larkUser ? (
                <>
                  <CheckCircleFilled />
                  已授权
                </>
              ) : larkAvailable ? (
                <>
                  <ExclamationCircleFilled />
                  未授权
                </>
              ) : (
                <>
                  <CloseCircleFilled />
                  未检测到 Lark Cli
                </>
              )}
            </Tag>
            {!larkUser ? (
              <Button
                type="link"
                size="small"
                className="environment-settings-button is-required"
                icon={<SettingOutlined />}
                onClick={() => onOpenSettings('lark-cli')}
              >
                去设置
              </Button>
            ) : null}
          </div>
        </div>

        {!authExpiredProvider && (!meegleAuthenticated || !larkUser) ? (
          <Alert
            type="warning"
            showIcon
            message="完成 Lark Cli 和 Meegle Cli 登录后即可进入需求工作台"
          />
        ) : null}
      </div>
    </section>
  )
}
