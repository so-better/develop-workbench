import { useCallback, useEffect, useState } from 'react'
import { LogoutOutlined } from '@ant-design/icons'
import { Alert, App, Button, Popconfirm, Spin, Tag } from 'antd'
import ExecutablePathField from '../ExecutablePathField/ExecutablePathField'
import type {
  MeegleCliPathSource,
  MeegleLoginSession,
  MeegleState
} from '../../../../types/meegle'
import './MeegleSettings.css'

const CLI_SOURCE_NAMES: Record<MeegleCliPathSource, string> = {
  settings: '应用设置',
  environment: '环境变量',
  auto: '自动检测'
}

/**
 * Meegle 授权与配置。
 * CLI 配置和登录态都由 Meegle CLI 管理，应用只负责调用和展示。
 */
export default function MeegleSettings(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<MeegleState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cliPathDraft, setCliPathDraft] = useState('')
  const [cliPathDirty, setCliPathDirty] = useState(false)
  const [cliPathPending, setCliPathPending] = useState(false)
  const [savingPath, setSavingPath] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [loginSession, setLoginSession] = useState<MeegleLoginSession | null>(null)
  const [loginStarting, setLoginStarting] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  /**
   * 读取 Meegle CLI、登录用户和有效期。
   */
  const loadState = useCallback(async (showLoading = true): Promise<MeegleState | null> => {
    if (showLoading) setLoading(true)
    setError(null)

    try {
      const next = await window.electron.getMeegleState()
      setState(next)
      setCliPathDraft(next.cli.path ?? '')
      setCliPathDirty(false)
      setCliPathPending(false)
      return next
    } catch {
      setError('读取 Meegle 状态失败')
      return null
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadState()

    const unsubscribe = window.electron.onMeegleLoginEvent(async (event) => {
      if (event.status === 'success') {
        message.success('Meegle Cli 授权成功')
        setLoginStarting(false)
        setLoginError(null)
        // 保留 session 直到状态刷新完成，避免自动登录逻辑重复触发。
        await loadState(false)
        setLoginSession(null)
        return
      }

      setLoginStarting(false)
      setLoginSession(null)
      setLoginError(event.message)
    })

    return () => {
      unsubscribe()
      window.electron.cancelMeegleLogin().catch(() => undefined)
    }
  }, [loadState, message])

  /**
   * 立即保存 Meegle CLI 路径。
   * 空路径表示清除手动设置并恢复自动检测。
   */
  const saveCliPath = async (value?: string | null): Promise<void> => {
    if (!state) return

    const pathToSave = value !== undefined ? value : cliPathDraft.trim() || null

    setSavingPath(true)

    try {
      const info = await window.electron.setMeegleCliPath(pathToSave)
      setCliPathDraft(info.path ?? '')
      setCliPathDirty(false)
      setLoginSession(null)
      setLoginError(null)
      window.electron.cancelMeegleLogin().catch(() => undefined)
      await loadState(false)
      message.success('Meegle Cli 配置已自动保存')
    } catch {
      message.error('Meegle Cli 路径不可用，请重新选择可执行文件')
    } finally {
      setSavingPath(false)
    }
  }

  /**
   * 打开系统文件选择器选择 Meegle CLI。
   */
  const chooseCliPath = async (): Promise<void> => {
    try {
      const selectedPath = await window.electron.selectMeegleCliPath(
        cliPathDraft.trim() || state?.cli.path
      )

      if (selectedPath) {
        setCliPathDraft(selectedPath)
        setCliPathDirty(true)
        setCliPathPending(true)
        await saveCliPath(selectedPath)
      }
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  /**
   * 自动检测 Meegle CLI，检测成功后立即保存。
   */
  const detectCliPath = async (): Promise<void> => {
    setSavingPath(true)

    try {
      const info = await window.electron.detectMeegleCliInfo()
      setState((current) => (current ? { ...current, cli: info } : current))
      setCliPathDraft(info.path ?? '')
      setCliPathDirty(false)
      setCliPathPending(true)

      if (info.available && info.path) {
        await saveCliPath(info.path)
      } else {
        message.warning('未检测到 Meegle CLI')
      }
    } catch {
      message.error('自动检测 Meegle CLI 失败')
    } finally {
      setSavingPath(false)
    }
  }

  /**
   * 发起新的 Meegle Device Code 登录。
   */
  const startLogin = useCallback(async (): Promise<void> => {
    setLoginStarting(true)
    setLoginError(null)
    setLoginSession(null)

    try {
      setLoginSession(await window.electron.startMeegleLogin())
    } catch {
      setLoginError('无法发起 Meegle Cli 授权，请检查 Meegle CLI 配置。')
    } finally {
      setLoginStarting(false)
    }
  }, [])

  /**
   * 未登录时自动生成二维码，不再需要额外点击“扫码登录”。
   */
  useEffect(() => {
    if (
      loading ||
      Boolean(error) ||
      !state?.cli.available ||
      state.authenticated ||
      cliPathPending ||
      loginStarting ||
      loginSession ||
      loginError
    ) {
      return
    }

    startLogin()
  }, [cliPathPending, error, loading, state, loginStarting, loginSession, loginError, startLogin])

  /**
   * 扫码完成后主动检查一次登录状态。
   */
  const checkLogin = async (): Promise<void> => {
    setChecking(true)

    try {
      const next = await loadState(false)

      if (next?.authenticated) {
        message.success('Meegle Cli 授权成功')
        setLoginSession(null)
        return
      }

      message.info('尚未检测到 Meegle Cli 授权，请完成扫码后重试')
    } catch {
      message.error('检查 Meegle Cli 授权状态失败')
    } finally {
      setChecking(false)
    }
  }

  /**
   * 退出 Meegle Cli 授权。
   */
  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true)

    try {
      const next = await window.electron.logoutMeegle()
      setState(next)
      setLoginSession(null)
      message.success('已退出 Meegle Cli 授权')
    } catch {
      message.error('退出 Meegle Cli 授权失败')
    } finally {
      setLoggingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="settings-loading">
        <Spin />
      </div>
    )
  }

  if (error) {
    return <Alert type="error" showIcon message={error} />
  }

  if (!state) {
    return <Alert type="error" showIcon message="无法读取 Meegle 配置" />
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>Meegle Cli</h3>
        <p>连接 Meegle，用于读取飞书项目、需求和工作项。</p>
      </div>
      <div className="meegle-section">
        <div className="lark-status">
          <div className="lark-status-main">
            <span
              className={`lark-status-dot${state.cli.available ? ' is-available' : ' is-unavailable'}`}
              aria-hidden="true"
            />
            <span>当前状态</span>
            <strong className={state.cli.available ? 'is-available' : 'is-unavailable'}>
              {state.cli.available ? '可用' : '不可用'}
            </strong>
          </div>
          {state.cli.available ? (
            <span className="lark-status-version">
              Meegle CLI {state.cli.version ?? ''}
              {state.cli.source ? ` · ${CLI_SOURCE_NAMES[state.cli.source]}` : ''}
            </span>
          ) : null}
        </div>

        <ExecutablePathField
          id="meegle-cli-path"
          label="Meegle CLI 可执行文件"
          value={cliPathDraft}
          placeholder="选择或输入 Meegle CLI 路径"
          help="选择文件、自动检测或输入后失焦会立即保存。"
          detecting={savingPath}
          onChange={(value) => {
            setCliPathDraft(value)
            setCliPathDirty(true)
            setCliPathPending(true)
          }}
          onSave={() => {
            if (cliPathDirty) saveCliPath()
          }}
          onChoose={() => chooseCliPath()}
          onDetect={() => detectCliPath()}
        />
        {!state.cli.available ? (
          <Alert
            type="warning"
            showIcon
            message={state.cli.path ? 'Meegle CLI 路径不可用' : '未检测到 Meegle CLI'}
            description={
              state.cli.path
                ? '请确认文件存在、可执行，并且是有效的 Meegle CLI。'
                : '请安装 @lark-project/meegle，或手动选择可执行文件。'
            }
          />
        ) : null}
      </div>

      {state.cli.available ? (
        <>
          <div className="meegle-section">
            <div className="meegle-section-heading">
              <div className="meegle-section-title">Meegle Cli 授权</div>
              {state.authenticated ? (
                <div className="meegle-login-actions">
                  <Tag color="green" bordered={false}>
                    已授权
                  </Tag>
                  <Popconfirm
                    title="退出 Meegle Cli 授权？"
                    okText="退出"
                    cancelText="取消"
                    placement="top"
                    onConfirm={() => handleLogout()}
                  >
                    <Button
                      type="text"
                      size="small"
                      className="meegle-logout"
                      icon={<LogoutOutlined />}
                      aria-label="退出 Meegle Cli 授权"
                      title="退出 Meegle Cli 授权"
                      loading={loggingOut}
                    />
                  </Popconfirm>
                </div>
              ) : null}
            </div>

        {state.authenticated ? (
          <>
            {typeof state.expiresInMinutes === 'number' ? (
              <p className="settings-help">
                当前 Meegle Cli 授权有效期剩余约 {state.expiresInMinutes} 分钟，Meegle CLI 会自动刷新。
              </p>
            ) : null}
          </>
        ) : loginStarting ? (
          <div className="settings-loading">
            <Spin />
          </div>
        ) : loginError ? (
          <>
            <Alert type="error" showIcon message={loginError} />
            <div className="login-state-actions">
              <Button type="primary" onClick={() => startLogin()}>
                重新生成二维码
              </Button>
            </div>
          </>
        ) : loginSession ? (
          <div className="meegle-login">
            <div className="login-qr meegle-qr">
              <img src={loginSession.qrCodeDataUrl} alt="Meegle Cli 授权二维码" />
            </div>
            <p className="settings-help">使用飞书或 Meegle 扫描二维码完成授权。</p>
            {loginSession.userCode ? (
              <p className="settings-help">授权码：{loginSession.userCode}</p>
            ) : null}
            <div className="login-state-actions">
              <Button variant="filled" onClick={() => startLogin()}>
                刷新二维码
              </Button>
              <Button type="primary" loading={checking} onClick={() => checkLogin()}>
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
        </>
      ) : null}
    </>
  )
}
