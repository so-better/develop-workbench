import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CopyOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Modal, Spin } from 'antd'
import type { AppInfo } from '../../../../types/app'
import type { LarkCliInfo, LarkCliPathSource } from '../../../../types/lark'
import type { SettingsSection } from '../../../../types/settings'
import GitSettings from '../GitSettings/GitSettings'
import LarkAuth from '../LarkAuth/LarkAuth'
import IdeSettings from '../IdeSettings/IdeSettings'
import MeegleSettings from '../MeegleSettings/MeegleSettings'
import RepositorySettings from '../RepositorySettings/RepositorySettings'

const CodeEditor = lazy(() => import('../CodeEditor/CodeEditor'))

interface SettingsModalProps {
  open: boolean
  initialSection?: SettingsSection
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
  initialSection = 'ai',
  appInfo,
  onLarkCliUpdated,
  onClose
}: SettingsModalProps): JSX.Element {
  const { message } = App.useApp()
  const [activeSection, setActiveSection] = useState<SettingsSection>('ai')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiSaveState, setAiSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'invalid' | 'error'
  >('idle')
  const lastSavedDraftRef = useRef('')
  const [larkInfo, setLarkInfo] = useState<LarkCliInfo | null>(null)
  const [larkPathDraft, setLarkPathDraft] = useState('')
  const [larkSaving, setLarkSaving] = useState(false)
  const [larkLoading, setLarkLoading] = useState(false)
  const [larkError, setLarkError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    let mounted = true

    setActiveSection(initialSection)
    setLoading(true)
    setError(null)
    setDraft('')
    setAiSaveState('idle')
    lastSavedDraftRef.current = ''
    setLarkLoading(true)
    setLarkError(null)
    setLarkInfo(null)
    setLarkPathDraft('')

    window.electron
      .readAiConfig()
      .then((document) => {
        if (!mounted) return
        setDraft(document.content)
        lastSavedDraftRef.current = document.content
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
      })
      .catch(() => {
        if (mounted) setLarkError('读取 Lark Cli 配置失败')
      })
      .finally(() => {
        if (mounted) setLarkLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [initialSection, open])

  /**
   * 模型配置 JSON 合法时防抖自动保存。
   */
  useEffect(() => {
    if (loading || error) return
    if (draft === lastSavedDraftRef.current) {
      setAiSaveState('idle')
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        JSON.parse(draft)
      } catch {
        if (!cancelled) setAiSaveState('invalid')
        return
      }

      if (cancelled) return
      setAiSaveState('saving')

      try {
        const document = await window.electron.writeAiConfig(draft)

        if (cancelled) return
        lastSavedDraftRef.current = document.content
        setAiSaveState('saved')
      } catch {
        if (!cancelled) setAiSaveState('error')
      }
    }, 700)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draft, error, loading])

  /**
   * 自动检测 Lark Cli，检测成功后立即保存。
   */
  const handleAutoDetect = async (): Promise<void> => {
    setLarkSaving(true)

    try {
      const info = await window.electron.detectLarkCliInfo()
      setLarkInfo(info)
      setLarkPathDraft(info.path ?? '')

      if (info.available && info.path) {
        await persistLarkPath(info.path)
      } else {
        message.warning('未检测到 Lark Cli')
      }
    } catch {
      message.error('自动检测失败')
    } finally {
      setLarkSaving(false)
    }
  }

  /**
   * 打开系统文件选择器，选择后立即保存。
   */
  const handleChooseLarkCli = async (): Promise<void> => {
    try {
      const selectedPath = await window.electron.selectLarkCliPath(
        larkPathDraft.trim() || larkInfo?.path
      )

      if (selectedPath) {
        setLarkPathDraft(selectedPath)
        await persistLarkPath(selectedPath)
      }
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  /**
   * 立即保存 Lark Cli 路径；空值恢复自动检测。
   */
  const persistLarkPath = async (value?: string | null): Promise<void> => {
    const pathToSave =
      value !== undefined ? value : larkPathDraft.trim() || null

    if (value === undefined && pathToSave === (larkInfo?.path ?? null)) return

    setLarkSaving(true)

    try {
      const info = await window.electron.setLarkCliPath(pathToSave)
      setLarkInfo(info)
      setLarkPathDraft(info.path ?? '')
      onLarkCliUpdated()
      message.success('Lark Cli 配置已自动保存')
    } catch {
      message.error('Lark Cli 路径无法执行，请重新选择可执行文件')
    } finally {
      setLarkSaving(false)
    }
  }

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
      width={1040}
      centered
      open={open}
      onCancel={onClose}
      maskClosable
      footer={null}
    >
      <div className="settings-dialog">
        <nav className="settings-nav" aria-label="设置分类">
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'lark-cli' ? ' is-active' : ''}`}
            aria-current={activeSection === 'lark-cli' ? 'page' : undefined}
            onClick={() => setActiveSection('lark-cli')}
          >
            Lark Cli
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'meegle' ? ' is-active' : ''}`}
            aria-current={activeSection === 'meegle' ? 'page' : undefined}
            onClick={() => setActiveSection('meegle')}
          >
            Meegle Cli
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'git' ? ' is-active' : ''}`}
            aria-current={activeSection === 'git' ? 'page' : undefined}
            onClick={() => setActiveSection('git')}
          >
            Git
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'ide' ? ' is-active' : ''}`}
            aria-current={activeSection === 'ide' ? 'page' : undefined}
            onClick={() => setActiveSection('ide')}
          >
            IDE
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'repositories' ? ' is-active' : ''}`}
            aria-current={activeSection === 'repositories' ? 'page' : undefined}
            onClick={() => setActiveSection('repositories')}
          >
            代码仓库
          </button>
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
                <p>直接编辑 JSON 配置，格式正确时自动保存。</p>
                {aiSaveState !== 'idle' ? (
                  <p
                    className={`settings-autosave-status is-${aiSaveState}`}
                  >
                    {aiSaveState === 'saving'
                      ? '正在自动保存...'
                      : aiSaveState === 'saved'
                        ? '已自动保存'
                        : aiSaveState === 'invalid'
                          ? 'JSON 格式错误，修正后会自动保存'
                          : '自动保存失败'}
                  </p>
                ) : null}
              </div>

              {loading ? (
                <div className="settings-loading">
                  <Spin />
                </div>
              ) : error ? (
                <Alert type="error" showIcon message={error} />
              ) : (
                <Suspense
                  fallback={
                    <div className="settings-loading">
                      <Spin />
                    </div>
                  }
                >
                  <CodeEditor
                    className="config-editor"
                    language="json"
                    height={360}
                    value={draft}
                    onChange={setDraft}
                  />
                </Suspense>
              )}
            </>
          ) : activeSection === 'lark-cli' ? (
            <>
              <div className="settings-panel-header">
                <h3>Lark Cli</h3>
                <p>连接飞书，用于读取飞书用户、文档和链接数据。</p>
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
                        Lark Cli {larkInfo.version}
                        {larkInfo.source ? ` · ${larkCliSourceNames[larkInfo.source]}` : ''}
                      </span>
                    ) : null}
                  </div>

                  {!larkInfo?.path ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="未检测到 Lark Cli。请选择可执行文件，或安装后点击自动检测。"
                    />
                  ) : null}

                  {larkInfo?.path && !larkInfo.available ? (
                    <Alert
                      type="error"
                      showIcon
                      message="当前路径不可用。请重新选择文件，或点击自动检测。"
                    />
                  ) : null}

                  <div className="lark-path-field">
                    <label htmlFor="lark-cli-path">Lark Cli 可执行文件</label>
                    <div className="lark-path-controls">
                      <Input
                        id="lark-cli-path"
                        value={larkPathDraft}
                        onChange={(event) => {
                          setLarkPathDraft(event.target.value)
                        }}
                        onBlur={() => void persistLarkPath()}
                        onPressEnter={() => void persistLarkPath()}
                        placeholder="输入路径或选择文件"
                        spellCheck={false}
                      />
                      <Button variant="filled" onClick={() => handleChooseLarkCli()}>
                        选择文件
                      </Button>
                      <Button
                        variant="filled"
                        onClick={() => handleAutoDetect()}
                        loading={larkSaving}
                      >
                        自动检测
                      </Button>
                    </div>
                    <p className="settings-help">
                      选择文件、自动检测或输入后失焦会立即保存。
                    </p>
                  </div>

                  <LarkAuth available={Boolean(larkInfo?.available)} />
                </>
              )}
            </>
          ) : null}

          {activeSection === 'git' ? (
            <GitSettings />
          ) : null}

          {activeSection === 'repositories' ? <RepositorySettings /> : null}

          {activeSection === 'meegle' ? (
            <MeegleSettings />
          ) : null}

          {activeSection === 'ide' ? (
            <IdeSettings />
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
