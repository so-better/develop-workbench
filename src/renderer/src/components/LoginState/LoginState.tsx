import { useCallback, useEffect, useState } from 'react'
import { QrcodeOutlined, SettingOutlined } from '@ant-design/icons'
import { Alert, App, Button, Spin } from 'antd'
import type { LarkCliInfo, LarkLoginSession } from '../../../../types/lark'

interface LoginStateProps {
  cliInfo: LarkCliInfo | null
  onOpenSettings: () => void
  onLoggedIn: () => void
}

/**
 * 未登录状态。
 * lark-cli 可用时直接展示扫码登录，不可用时引导用户先配置路径。
 */
export default function LoginState({
  cliInfo,
  onOpenSettings,
  onLoggedIn
}: LoginStateProps): JSX.Element {
  const { message } = App.useApp()
  const cliMissing = !cliInfo?.available

  // 当前设备授权会话，包含二维码和过期时间。
  const [session, setSession] = useState<LarkLoginSession | null>(null)

  // 正在向主进程申请新的登录会话。
  const [starting, setStarting] = useState(false)

  // 用户点击“我已登录”后正在主动检查登录状态。
  const [checking, setChecking] = useState(false)

  // 发起登录或授权失败时的错误信息。
  const [error, setError] = useState<string | null>(null)

  /**
   * 请求主进程创建新的设备授权会话并返回二维码。
   */
  const beginLogin = useCallback(async (): Promise<void> => {
    setStarting(true)
    setChecking(false)
    setError(null)
    setSession(null)

    try {
      setSession(await window.electron.startLarkLogin())
    } catch {
      setError('无法发起 Lark Cli 授权，请检查 Lark Cli 是否可用。')
    } finally {
      setStarting(false)
    }
  }, [])

  /**
   * 进入未登录页时自动创建二维码，并监听主进程的授权结果。
   * 页面卸载时取消订阅并终止尚未完成的授权进程。
   */
  useEffect(() => {
    if (cliMissing) return

    let active = true

    const unsubscribe = window.electron.onLarkLoginEvent((event) => {
      if (!active) return

      if (event.status === 'success') {
        message.success('Lark Cli 授权成功')
        onLoggedIn()
        return
      }

      setStarting(false)
      setChecking(false)
      setSession(null)
      setError(event.message)
    })

    // 先订阅事件，再发起登录，避免错过极快返回的授权结果。
    beginLogin()

    return () => {
      active = false
      unsubscribe()
      // 页面卸载时终止后台授权，避免遗留轮询进程。
      window.electron.cancelLarkLogin().catch(() => undefined)
    }
  }, [beginLogin, cliMissing, message, onLoggedIn])

  /**
   * 兜底检查登录状态。
   * 正常情况下主进程会自动通知，这里用于扫码完成后界面没有及时更新的情况。
   */
  const handleManualLogin = async (): Promise<void> => {
    setChecking(true)

    try {
      const user = await window.electron.getLarkUser()

      if (user) {
        message.success('Lark Cli 授权成功')
        onLoggedIn()
        return
      }

      message.info('尚未检测到 Lark Cli 授权，请确认已在飞书中完成授权')
    } catch {
      message.error('检测登录状态失败')
    } finally {
      setChecking(false)
    }
  }

  if (cliMissing) {
    return (
      <section className="login-state" aria-labelledby="login-state-title">
        <div className="login-state-icon">
          <SettingOutlined />
        </div>
        <h2 id="login-state-title">未检测到 Lark Cli</h2>
        <p>应用通过本机 Lark Cli 读取飞书授权状态。请先在设置中指定 Lark Cli 可执行文件。</p>
        <Button icon={<SettingOutlined />} onClick={onOpenSettings}>
          打开设置
        </Button>
      </section>
    )
  }

  return (
    <section className="login-state" aria-labelledby="login-state-title">
      <div className="login-state-icon">
        <QrcodeOutlined />
      </div>
      <h2 id="login-state-title">尚未完成 Lark Cli 授权</h2>
      <p>应用通过本机 Lark Cli 读取飞书授权状态。请使用飞书扫描二维码完成 Lark Cli 授权。</p>

      {starting ? (
        <div className="login-state-loading">
          <Spin />
        </div>
      ) : error ? (
        <>
          <Alert type="error" showIcon message={error} />
          <div className="login-state-actions">
            <Button type="primary" onClick={() => beginLogin()}>
              刷新二维码
            </Button>
          </div>
        </>
      ) : session ? (
        <>
          <div className="login-qr">
            <img src={session.qrCodeDataUrl} alt="Lark Cli 授权二维码" />
          </div>
          <p className="login-state-hint">
            授权完成后会自动刷新；如未刷新，可点击“我已登录”。
          </p>
          <div className="login-state-actions">
            <Button onClick={() => beginLogin()}>刷新二维码</Button>
            <Button type="primary" loading={checking} onClick={() => handleManualLogin()}>
              我已登录
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}
