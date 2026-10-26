import { useEffect, useState } from 'react'
import { Alert, App, Button, Popconfirm, Spin, Tag } from 'antd'
import { LogoutOutlined } from '@ant-design/icons'
import type { LarkLoginSession, LarkUser } from '../../../../types/lark'

interface LarkAuthProps {
  /** lark-cli 当前是否可用。 */
  available: boolean
}

/**
 * Lark Cli 授权状态和扫码入口。
 * 交互与 Meegle Cli 授权保持一致。
 */
export default function LarkAuth({ available }: LarkAuthProps): JSX.Element {
  const { message } = App.useApp()
  const [user, setUser] = useState<LarkUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<LarkLoginSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 读取当前飞书授权用户。
   */
  const loadUser = async (showLoading = true): Promise<LarkUser | null> => {
    if (showLoading) setLoading(true)

    try {
      const next = await window.electron.getLarkUser()
      setUser(next)
      return next
    } catch {
      setUser(null)
      return null
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    loadUser()

    const unsubscribe = window.electron.onLarkLoginEvent((event) => {
      if (event.status === 'success') {
        // 保持 starting，等用户信息刷新后再结束，避免自动登录立即重复触发。
        setStarting(true)
        setError(null)
        message.success('Lark Cli 授权成功')
        loadUser(false).finally(() => {
          setSession(null)
          setStarting(false)
        })
        return
      }

      setStarting(false)
      setError(event.message)
      setSession(null)
    })

    return () => {
      unsubscribe()
      window.electron.cancelLarkLogin().catch(() => undefined)
    }
  }, [message])

  /**
   * 发起新的 Lark Cli 扫码授权。
   */
  const startLogin = async (): Promise<void> => {
    if (!available) return

    setStarting(true)
    setError(null)
    setSession(null)

    try {
      setSession(await window.electron.startLarkLogin())
    } catch {
      setError('无法发起 Lark Cli 授权，请检查 Lark Cli 配置')
    } finally {
      setStarting(false)
    }
  }

  /**
   * 未授权且 lark-cli 可用时，自动生成二维码。
   */
  useEffect(() => {
    if (
      loading ||
      error ||
      !available ||
      user ||
      starting ||
      session
    ) {
      return
    }

    startLogin()
  }, [available, error, loading, session, starting, user])

  /**
   * 扫码完成后主动检查一次授权状态。
   */
  const checkAuth = async (): Promise<void> => {
    setChecking(true)

    try {
      const next = await loadUser(false)

      if (next) {
        setSession(null)
        message.success('Lark Cli 授权成功')
        return
      }

      message.info('尚未检测到 Lark Cli 授权，请完成扫码后重试')
    } catch {
      message.error('检查 Lark Cli 授权状态失败')
    } finally {
      setChecking(false)
    }
  }

  /**
   * 退出当前 Lark Cli 授权。
   */
  const logout = async (): Promise<void> => {
    setLoggingOut(true)

    try {
      await window.electron.logoutLark()
      setUser(null)
      setSession(null)
      message.success('已退出 Lark Cli 授权')
    } catch {
      message.error('退出 Lark Cli 授权失败')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="lark-auth">
      <div className="meegle-section-heading">
        <div className="meegle-section-title">Lark Cli 授权</div>
        {user ? (
          <div className="meegle-login-actions">
            <Tag color="green" bordered={false}>
              已授权
            </Tag>
            <Popconfirm
              title="退出 Lark Cli 授权？"
              okText="退出"
              cancelText="取消"
              placement="top"
              onConfirm={() => logout()}
            >
              <Button
                type="text"
                size="small"
                className="meegle-logout"
                icon={<LogoutOutlined />}
                aria-label="退出 Lark Cli 授权"
                title="退出 Lark Cli 授权"
                loading={loggingOut}
              />
            </Popconfirm>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : !available ? (
        <Alert
          type="warning"
          showIcon
          message="请先配置可用的 Lark Cli"
        />
      ) : user ? (
        <p className="settings-help">
          飞书已授权，可使用飞书文档、链接和数据交互能力。
        </p>
      ) : starting ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : error ? (
        <>
          <Alert type="error" showIcon message={error} />
          <div className="login-state-actions">
            <Button type="primary" onClick={() => startLogin()}>
              重新生成二维码
            </Button>
          </div>
        </>
      ) : session ? (
        <div className="meegle-login">
          <div className="login-qr meegle-qr">
            <img src={session.qrCodeDataUrl} alt="Lark Cli 授权二维码" />
          </div>
          <p className="settings-help">使用飞书扫描二维码完成 Lark Cli 授权。</p>
          <div className="login-state-actions">
            <Button variant="filled" onClick={() => startLogin()}>
              刷新二维码
            </Button>
            <Button
              type="primary"
              loading={checking}
              onClick={() => checkAuth()}
            >
              我已授权
            </Button>
          </div>
        </div>
      ) : (
        <div className="settings-loading">
          <Spin />
        </div>
      )}
    </div>
  )
}
