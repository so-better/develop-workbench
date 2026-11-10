import { useEffect, useState } from 'react'
import {
  ClockCircleOutlined,
  LaptopOutlined,
  LockOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'
import { Alert, App, Spin, Switch } from 'antd'
import type { PowerSettingKey, PowerSettingsState } from '../../../../types/power'
import { getErrorMessage } from '../../../../utils'
import './PowerSettings.css'

/**
 * 电源设置。
 * 运行期间使用 powerSaveBlocker；系统策略通过 pmset/powercfg 修改。
 */
export default function PowerSettings(): JSX.Element {
  const { message } = App.useApp()
  const [settings, setSettings] = useState<PowerSettingsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<PowerSettingKey | null>(null)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)

    window.electron
      .getPowerSettings()
      .then((next) => {
        if (!cancelled) setSettings(next)
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError, '读取电源设置失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleToggle = async (
    key: PowerSettingKey,
    enabled: boolean
  ): Promise<void> => {
    if (!settings || saving !== null) return

    setSaving(key)

    try {
      const next = await window.electron.setPowerSetting(key, enabled)
      setSettings(next)
      message.success(enabled ? '已开启' : '已关闭')
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '电源设置修改失败'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>防休眠</h3>
        <p>控制应用运行时和系统锁屏、合盖时的休眠行为。</p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : settings ? (
        <div className="power-settings">
          {!settings.supportsSystemSettings ? (
            <Alert
              type="warning"
              showIcon
              message="当前平台仅支持运行期间保持唤醒"
              description="系统电源策略开关在当前平台不可用。"
            />
          ) : null}

          <section className="power-settings-card">
            <header className="power-settings-card-head">
              <div>
                <h4>应用运行时</h4>
                <p>应用运行期间生效，退出后自动释放。</p>
              </div>
              <span className="power-settings-badge">免授权</span>
            </header>

            <div className="power-settings-row">
              <span className="power-settings-row-icon">
                <ClockCircleOutlined />
              </span>
              <div className="power-settings-row-copy">
                <strong>保持系统唤醒</strong>
                <p>
                  阻止系统因无人操作进入空闲睡眠；屏幕仍可正常息屏，合盖和手动睡眠不受此设置影响。
                </p>
              </div>
              <div className="power-settings-row-control">
                <span
                  className={`power-settings-state${settings.runtimeKeepAwake ? ' is-on' : ''}`}
                >
                  {settings.runtimeKeepAwake ? '已开启' : '已关闭'}
                </span>
                <Switch
                  checked={settings.runtimeKeepAwake}
                  loading={saving === 'runtime'}
                  disabled={saving !== null && saving !== 'runtime'}
                  onChange={(checked) => void handleToggle('runtime', checked)}
                />
              </div>
            </div>
          </section>

          <section className="power-settings-card">
            <header className="power-settings-card-head">
              <div>
                <h4>系统电源策略</h4>
                <p>修改系统电源设置，退出应用后仍然生效。</p>
              </div>
              <span className="power-settings-badge is-warning">
                <SafetyCertificateOutlined />
                需授权
              </span>
            </header>

            <div className="power-settings-row">
              <span className="power-settings-row-icon">
                <LaptopOutlined />
              </span>
              <div className="power-settings-row-copy">
                <strong>合盖后不睡眠</strong>
                <p>
                  {settings.lidSupported
                    ? settings.platform === 'darwin'
                      ? '关闭合盖睡眠，合上屏幕后系统继续运行。'
                      : '将合盖动作设置为不采取任何操作，合上屏幕后系统继续运行。'
                    : '当前设备不支持合盖电源策略。'}
                </p>
              </div>
              <div className="power-settings-row-control">
                <span
                  className={`power-settings-state${
                    settings.lidSleepDisabled ? ' is-on' : ''
                  }`}
                >
                  {settings.lidSupported
                    ? settings.lidSleepDisabled
                      ? '已开启'
                      : '已关闭'
                    : '不支持'}
                </span>
                <Switch
                  checked={settings.lidSleepDisabled}
                  disabled={
                    !settings.supportsSystemSettings ||
                    !settings.lidSupported ||
                    saving !== null
                  }
                  loading={saving === 'lid'}
                  onChange={(checked) => void handleToggle('lid', checked)}
                />
              </div>
            </div>

            <div className="power-settings-row">
              <span className="power-settings-row-icon">
                <LockOutlined />
              </span>
              <div className="power-settings-row-copy">
                <strong>锁屏后不睡眠</strong>
                <p>锁屏后禁止系统因空闲进入睡眠，避免后台任务中断。</p>
              </div>
              <div className="power-settings-row-control">
                <span
                  className={`power-settings-state${
                    settings.lockScreenSleepDisabled ? ' is-on' : ''
                  }`}
                >
                  {settings.lockScreenSleepDisabled ? '已开启' : '已关闭'}
                </span>
                <Switch
                  checked={settings.lockScreenSleepDisabled}
                  disabled={!settings.supportsSystemSettings || saving !== null}
                  loading={saving === 'lock'}
                  onChange={(checked) => void handleToggle('lock', checked)}
                />
              </div>
            </div>
          </section>

        </div>
      ) : null}
    </>
  )
}
