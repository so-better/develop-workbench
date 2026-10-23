import { useEffect, useState } from 'react'
import { CopyOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Modal, Spin } from 'antd'
import type { AppInfo } from '../../../types/app'
import type { LarkCliInfo, LarkCliPathSource } from '../../../types/lark'

type SettingsSection = 'ai' | 'lark-cli' | 'app-info'

interface SettingsModalProps {
  open: boolean
  appInfo: AppInfo | null
  onLarkCliUpdated: () => void
  onClose: () => void
}

const platformNames: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux'
}

const larkCliSourceNames: Record<LarkCliPathSource, string> = {
  settings: '应用设置',
  environment: '环境变量',
  auto: '自动检测'
}

/**
 * 设置弹窗。
 * 当前包含模型配置和 lark-cli 路径，并在底部展示真实的应用运行信息。
 */
export default function SettingsModal({
  open,
  appInfo,
  onLarkCliUpdated,
  onClose
}: SettingsModalProps): JSX.Element {
  const { message } = App.useApp()
  const [activeSection, setActiveSection] = useState<SettingsSection>('ai')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [larkInfo, setLarkInfo] = useState<LarkCliInfo | null>(null)
  const [larkPathDraft, setLarkPathDraft] = useState('')
  const [larkPathDirty, setLarkPathDirty] = useState(false)
  const [larkLoading, setLarkLoading] = useState(false)
  const [larkError, setLarkError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    let mounted = true

    setActiveSection('ai')
    setLoading(true)
    setError(null)
    setDraft('')
    setLarkLoading(true)
    setLarkError(null)
    setLarkInfo(null)
    setLarkPathDraft('')
    setLarkPathDirty(false)

    window.electron
      .readAiConfig()
      .then((document) => {
        if (!mounted) return
        setDraft(document.content)
      })
      .catch(() => {
        if (mounted) setError('读取模型配置失败')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    window.electron
      .getLarkCliInfo()
      .then((info) => {
        if (!mounted) return
        setLarkInfo(info)
        setLarkPathDraft(info.path ?? '')
        setLarkPathDirty(false)
      })
      .catch(() => {
        if (mounted) setLarkError('读取 lark-cli 配置失败')
      })
      .finally(() => {
        if (mounted) setLarkLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [open])

  /**
   * 自动检测 lark-cli，但暂不写入偏好。
   * 检测结果会填入输入框，并在统一保存时生效。
   */
  const handleAutoDetect = async (): Promise<void> => {
    setSaving(true)

    try {
      const info = await window.electron.detectLarkCliInfo()
      setLarkInfo(info)
      setLarkPathDraft(info.path ?? '')
      setLarkPathDirty(false)
      message.success(info.available ? '自动检测完成，保存后生效' : '未检测到 lark-cli')
    } catch {
      message.error('自动检测失败')
    } finally {
      setSaving(false)
    }
  }

  /**
   * 打开系统文件选择器，将选中的路径填入输入框。
   */
  const handleChooseLarkCli = async (): Promise<void> => {
    try {
      const selectedPath = await window.electron.selectLarkCliPath(larkPathDraft.trim() || larkInfo?.path)

      if (selectedPath) {
        setLarkPathDraft(selectedPath)
        setLarkPathDirty(true)
      }
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  /**
   * 统一保存模型配置和 lark-cli 路径。
   * 先校验当前草稿，再按顺序写入；任一校验失败都不会继续写入其他设置。
   */
  const handleSave = async (): Promise<void> => {
    try {
      JSON.parse(draft)
    } catch {
      setActiveSection('ai')
      message.error('模型配置不是有效的 JSON，请检查后再保存')
      return
    }

    const larkPathToSave =
      larkPathDirty || larkInfo?.source === 'settings'
        ? larkPathDraft.trim() || null
        : null

    setSaving(true)

    try {
      let nextLarkInfo: LarkCliInfo

      try {
        nextLarkInfo = await window.electron.setLarkCliPath(larkPathToSave)
      } catch {
        setActiveSection('lark-cli')
        message.error('lark-cli 路径无法执行，请重新选择可执行文件')
        return
      }

      try {
        const document = await window.electron.writeAiConfig(draft)
        setDraft(document.content)
      } catch {
        setActiveSection('ai')
        message.error('保存模型配置失败')
        return
      }

      setLarkInfo(nextLarkInfo)
      setLarkPathDraft(nextLarkInfo.path ?? '')
      setLarkPathDirty(false)
      onLarkCliUpdated()
      message.success('设置已保存')
    } finally {
      setSaving(false)
    }
  }

  const saveDisabled = loading || larkLoading || Boolean(error) || Boolean(larkError)
  const appInfoItems = [
    {
      label: '应用版本',
      value: appInfo ? `v${appInfo.appVersion}` : '-'
    },
    {
      label: '平台',
      value: appInfo ? (platformNames[appInfo.platform] ?? appInfo.platform) : '-'
    },
    {
      label: 'Electron',
      value: appInfo?.electron ?? '-'
    },
    {
      label: 'Chromium',
      value: appInfo?.chrome ?? '-'
    },
    {
      label: 'Node.js',
      value: appInfo?.node ?? '-'
    }
  ]

  /**
   * 通过主进程写入系统剪贴板。
   */
  const copyValue = async (value: string): Promise<void> => {
    try {
      await window.electron.copyText(value)
      message.success('已复制')
    } catch {
      message.error('复制失败')
    }
  }

  return (
    <Modal
      title="设置"
      width={820}
      centered
      open={open}
      onCancel={onClose}
      maskClosable={!saving}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          disabled={saveDisabled}
          onClick={() => handleSave()}
        >
          保存
        </Button>
      ]}
    >
      <div className="settings-dialog">
        <nav className="settings-nav" aria-label="设置分类">
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'ai' ? ' is-active' : ''}`}
            aria-current={activeSection === 'ai' ? 'page' : undefined}
            onClick={() => setActiveSection('ai')}
          >
            模型配置
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'lark-cli' ? ' is-active' : ''}`}
            aria-current={activeSection === 'lark-cli' ? 'page' : undefined}
            onClick={() => setActiveSection('lark-cli')}
          >
            飞书登录
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'app-info' ? ' is-active' : ''}`}
            aria-current={activeSection === 'app-info' ? 'page' : undefined}
            onClick={() => setActiveSection('app-info')}
          >
            应用信息
          </button>
        </nav>

        <section className="settings-panel">
          {activeSection === 'ai' ? (
            <>
              <div className="settings-panel-header">
                <h3>模型配置</h3>
                <p>直接编辑 JSON 配置，保存后会更新本地配置。</p>
              </div>

              {loading ? (
                <div className="settings-loading">
                  <Spin />
                </div>
              ) : error ? (
                <Alert type="error" showIcon message={error} />
              ) : (
                <Input.TextArea
                  className="config-editor"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoSize={{ minRows: 10, maxRows: 18 }}
                  spellCheck={false}
                />
              )}
            </>
          ) : activeSection === 'lark-cli' ? (
            <>
              <div className="settings-panel-header">
                <h3>飞书登录</h3>
                <p>应用通过 lark-cli 获取飞书登录状态。可以手动指定可执行文件，也可以使用自动检测结果。</p>
              </div>

              {larkLoading ? (
                <div className="settings-loading">
                  <Spin />
                </div>
              ) : larkError ? (
                <Alert type="error" showIcon message={larkError} />
              ) : (
                <>
                  <div className="lark-status">
                    <div className="lark-status-main">
                      <span
                        className={`lark-status-dot${larkInfo?.available ? ' is-available' : ' is-unavailable'}`}
                        aria-hidden="true"
                      />
                      <span>当前状态</span>
                      <strong className={larkInfo?.available ? 'is-available' : 'is-unavailable'}>
                        {larkInfo?.available ? '可用' : '不可用'}
                      </strong>
                    </div>
                    {larkInfo?.version ? (
                      <span className="lark-status-version">
                        lark-cli {larkInfo.version}
                        {larkInfo.source ? ` · ${larkCliSourceNames[larkInfo.source]}` : ''}
                      </span>
                    ) : null}
                  </div>

                  {!larkInfo?.path ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="未检测到 lark-cli。请选择可执行文件，或安装后点击自动检测。"
                    />
                  ) : null}

                  {larkInfo?.path && !larkInfo.available ? (
                    <Alert
                      type="error"
                      showIcon
                      message="当前路径不可用。请重新选择文件，或点击自动检测后保存。"
                    />
                  ) : null}

                  <div className="lark-path-field">
                    <label htmlFor="lark-cli-path">lark-cli 可执行文件</label>
                    <div className="lark-path-controls">
                      <Input
                        id="lark-cli-path"
                        value={larkPathDraft}
                        onChange={(event) => {
                          setLarkPathDraft(event.target.value)
                          setLarkPathDirty(true)
                        }}
                        placeholder="输入路径或选择文件"
                        spellCheck={false}
                      />
                      <Button onClick={() => handleChooseLarkCli()}>选择文件</Button>
                      <Button onClick={() => handleAutoDetect()} disabled={saving}>
                        自动检测
                      </Button>
                    </div>
                    <p className="settings-help">自动检测只更新当前结果，点击保存后生效。</p>
                  </div>
                </>
              )}
            </>
          ) : null}

          {activeSection === 'app-info' ? (
            <>
              <div className="settings-panel-header">
                <h3>应用信息</h3>
                <p>当前运行的桌面应用和运行时版本。</p>
              </div>

              <div className="settings-info-list">
                {appInfoItems.map((item) => (
                  <div className="settings-info-row" key={item.label}>
                    <span>{item.label}</span>
                    <div className="settings-info-value">
                      <strong>{item.value}</strong>
                      <button
                        type="button"
                        className="settings-copy-button"
                        aria-label={`复制${item.label}`}
                        title="复制"
                        disabled={!appInfo}
                        onClick={() => copyValue(item.value)}
                      >
                        <CopyOutlined />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </Modal>
  )
}
