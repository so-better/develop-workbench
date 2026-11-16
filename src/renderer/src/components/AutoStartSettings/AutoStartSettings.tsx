import { useEffect, useState } from 'react'
import { RocketOutlined } from '@ant-design/icons'
import { Alert, App, Spin, Switch } from 'antd'
import type { AutoStartState } from '../../../../types/auto-start'
import { getErrorMessage } from '../../../../utils'
import './AutoStartSettings.css'

/**
 * 开机自启设置。
 * 开关状态由操作系统登录项维护。
 */
export default function AutoStartSettings(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<AutoStartState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)

    window.electron
      .getAutoStart()
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError, '读取开机自启状态失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async (enabled: boolean): Promise<void> => {
    if (!state?.supported || saving) return

    setSaving(true)

    try {
      const next = await window.electron.setAutoStart(enabled)
      setState(next)
      message.success(enabled ? '已开启开机自启' : '已关闭开机自启')
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '设置未完成'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>开机自启</h3>
        <p>登录系统后自动启动应用。</p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : state ? (
        <div className="auto-start-settings">
          {state.reason ? (
            <Alert type="warning" showIcon message={state.reason} />
          ) : null}

          <section className="auto-start-card">
            <div className="auto-start-row">
              <span className="auto-start-row-icon">
                <RocketOutlined />
              </span>
              <div className="auto-start-row-copy">
                <strong>登录时自动启动</strong>
                <p>开启后，系统登录时会自动启动「AI 研发工作台」。</p>
              </div>
              <div className="auto-start-row-control">
                <span
                  className={`auto-start-state${state.enabled ? ' is-on' : ''}`}
                >
                  {state.enabled ? '已开启' : '已关闭'}
                </span>
                <Switch
                  checked={state.enabled}
                  loading={saving}
                  disabled={!state.supported || saving}
                  onChange={(checked) => void handleToggle(checked)}
                />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
