import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, App, Button, Modal, Spin, Tabs, Tooltip } from 'antd'
import type { AppInfo } from '../../../../types/app'
import type { LarkCliInfo, LarkCliPathSource } from '../../../../types/lark'
import type { UpdateCheckResult } from '../../../../types/updates'
import {
  DEFAULT_SETTINGS_SECTION
} from '../../../../types/settings'
import type { SettingsSection } from '../../../../types/settings'
import { getErrorMessage } from '../../../../utils'
import ExecutablePathField from '../ExecutablePathField/ExecutablePathField'
import AdbSettings from '../AdbSettings/AdbSettings'
import GitSettings from '../GitSettings/GitSettings'
import LarkAuth from '../LarkAuth/LarkAuth'
import IdeSettings from '../IdeSettings/IdeSettings'
import MeegleSettings from '../MeegleSettings/MeegleSettings'
import RepositorySettings from '../RepositorySettings/RepositorySettings'
import SkillSettings from '../SkillSettings/SkillSettings'
import StorageCleanup from '../StorageCleanup/StorageCleanup'
import TerminalSettings from '../TerminalSettings/TerminalSettings'
import MigrationSettings from '../MigrationSettings/MigrationSettings'
import ClipboardSettings from '../ClipboardSettings/ClipboardSettings'

const CodeEditor = lazy(() => import('../CodeEditor/CodeEditor'))

interface SettingsModalProps {
  open: boolean
  initialSection?: SettingsSection
  appInfo: AppInfo | null
  onLarkCliUpdated: () => void
  onOpenUpdatePrompt: (update: UpdateCheckResult) => void
  onClose: () => void
}

const platformNames: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows'
}

const larkCliSourceNames: Record<LarkCliPathSource, string> = {
  settings: '应用设置',
  environment: '环境变量',
  auto: '自动检测'
}

/** 模型配置示例，复制后替换 API Key 即可使用。 */
const AI_CONFIG_EXAMPLE = `{
  "name": "DeepSeek Flash（思考）",
  "model": "deepseek-flash",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-...",
  "headers": {},
  "options": {
    "thinking": {
      "type": "enabled"
    },
    "reasoning_effort": "high"
  }
}
`

/** 单模型配置字段说明。 */
const AI_CONFIG_FIELDS = [
  ['name', '界面显示的模型名称，可自定义。'],
  ['model', '真实 API 模型名，例如 deepseek-flash。'],
  ['baseUrl', 'OpenAI 兼容接口根地址，程序会自动拼接 /chat/completions。'],
  ['apiKey', '接口 API Key，仅保存在本机配置，由主进程调用。'],
  ['headers', '附加 HTTP 请求头，无特殊要求时填写 {}。'],
  [
    'options',
    '请求体参数，例如 temperature、thinking、reasoning_effort；无特殊要求时填写 {}。'
  ]
] as const

/**
 * 设置弹窗。
 * 统一承载环境、仓库、IDE、模型、技能、存储清理和应用信息。
 */
export default function SettingsModal({
  open,
  initialSection = DEFAULT_SETTINGS_SECTION,
  appInfo,
  onLarkCliUpdated,
  onOpenUpdatePrompt,
  onClose
}: SettingsModalProps): JSX.Element {
  const { message } = App.useApp()
  const [activeSection, setActiveSection] = useState<SettingsSection>(DEFAULT_SETTINGS_SECTION)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiSaveState, setAiSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'invalid' | 'error'
  >('idle')
  const [aiSaveError, setAiSaveError] = useState<string | null>(null)
  const [aiSettingsTab, setAiSettingsTab] = useState('model')
  const lastSavedDraftRef = useRef('')
  const aiSaveTimerRef = useRef<number | null>(null)
  const [larkInfo, setLarkInfo] = useState<LarkCliInfo | null>(null)
  const [larkPathDraft, setLarkPathDraft] = useState('')
  const [larkSaving, setLarkSaving] = useState(false)
  const [larkLoading, setLarkLoading] = useState(false)
  const [larkError, setLarkError] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    if (!open) return

    let mounted = true

    setActiveSection(initialSection)
    setAiSettingsTab(initialSection === 'skills' ? 'skills' : 'model')
    setLoading(true)
    setError(null)
    setDraft('')
    setAiSaveState('idle')
    setAiSaveError(null)
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
    aiSaveTimerRef.current = window.setTimeout(async () => {
      aiSaveTimerRef.current = null

      try {
        JSON.parse(draft)
      } catch {
        if (!cancelled) {
          setAiSaveState('invalid')
          setAiSaveError('JSON 格式错误，请检查括号、引号和逗号')
        }
        return
      }

      if (cancelled) return
      setAiSaveState('saving')

      try {
        const document = await window.electron.writeAiConfig(draft)

        if (cancelled) return
        lastSavedDraftRef.current = document.content
        setAiSaveState('saved')
        setAiSaveError(null)
      } catch (saveError) {
        if (!cancelled) {
          setAiSaveState('error')
          setAiSaveError(getErrorMessage(saveError, '自动保存失败'))
        }
      }
    }, 700)

    return () => {
      cancelled = true

      if (aiSaveTimerRef.current) {
        window.clearTimeout(aiSaveTimerRef.current)
        aiSaveTimerRef.current = null
      }
    }
  }, [draft, error, loading])

  /** 关闭设置前先冲刷尚未执行的模型配置自动保存。 */
  const handleClose = async (): Promise<void> => {
    if (aiSaveTimerRef.current) {
      window.clearTimeout(aiSaveTimerRef.current)
      aiSaveTimerRef.current = null
    }

    if (!loading && !error && draft !== lastSavedDraftRef.current) {
      try {
        JSON.parse(draft)
      } catch {
        message.warning('模型配置 JSON 格式错误，本次修改未保存')
        onClose()
        return
      }

      try {
        const document = await window.electron.writeAiConfig(draft)

        lastSavedDraftRef.current = document.content
      } catch (saveError) {
        message.error(getErrorMessage(saveError, '模型配置保存失败，未关闭设置'))
        return
      }
    }

    onClose()
  }

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

  const handleCheckUpdates = async (): Promise<void> => {
    if (checkingUpdate) return

    setCheckingUpdate(true)

    try {
      const result = await window.electron.checkForUpdates()

      if (result.hasUpdate) {
        onOpenUpdatePrompt(result)
        return
      }

      message.success(`当前已是最新版本 v${result.currentVersion}`)
    } catch (checkError) {
      message.error(getErrorMessage(checkError, '检查更新失败'))
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <Modal
      title="设置"
      width={1040}
      centered
      open={open}
      onCancel={() => void handleClose()}
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
            className={`settings-nav-item${activeSection === 'adb' ? ' is-active' : ''}`}
            aria-current={activeSection === 'adb' ? 'page' : undefined}
            onClick={() => setActiveSection('adb')}
          >
            ADB
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
            className={`settings-nav-item${activeSection === 'terminal' ? ' is-active' : ''}`}
            aria-current={activeSection === 'terminal' ? 'page' : undefined}
            onClick={() => setActiveSection('terminal')}
          >
            终端
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'repositories' ? ' is-active' : ''}`}
            aria-current={activeSection === 'repositories' ? 'page' : undefined}
            onClick={() => setActiveSection('repositories')}
          >
            代码目录
          </button>
          <button
            type="button"
            className={`settings-nav-item${
              activeSection === 'ai' || activeSection === 'skills'
                ? ' is-active'
                : ''
            }`}
            aria-current={
              activeSection === 'ai' || activeSection === 'skills'
                ? 'page'
                : undefined
            }
            onClick={() => {
              setActiveSection('ai')
              setAiSettingsTab('model')
            }}
          >
            模型与技能
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'clipboard' ? ' is-active' : ''}`}
            aria-current={activeSection === 'clipboard' ? 'page' : undefined}
            onClick={() => setActiveSection('clipboard')}
          >
            粘贴选择
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'cleanup' ? ' is-active' : ''}`}
            aria-current={activeSection === 'cleanup' ? 'page' : undefined}
            onClick={() => setActiveSection('cleanup')}
          >
            存储清理
          </button>
          <button
            type="button"
            className={`settings-nav-item${activeSection === 'migration' ? ' is-active' : ''}`}
            aria-current={activeSection === 'migration' ? 'page' : undefined}
            onClick={() => setActiveSection('migration')}
          >
            一键迁移
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
          {activeSection === 'ai' || activeSection === 'skills' ? (
            <>
              <div className="settings-panel-header">
                <h3>模型与技能</h3>
                <p>
                  配置 OpenAI Chat Completions 兼容模型和额外技能目录。
                </p>
              </div>

              <Tabs
                className="settings-ai-tabs"
                activeKey={aiSettingsTab}
                onChange={setAiSettingsTab}
                items={[
                  {
                    key: 'model',
                    label: '模型配置',
                    children: (
                      <>
                        {aiSaveState !== 'idle' ? (
                          <p
                            className={`settings-autosave-status is-${aiSaveState}`}
                            role="status"
                            aria-live="polite"
                          >
                            {aiSaveState === 'saving'
                              ? '正在自动保存...'
                              : aiSaveState === 'saved'
                                ? '已自动保存'
                                : aiSaveState === 'invalid'
                                  ? (aiSaveError ?? 'JSON 格式错误，修正后会自动保存')
                                  : (aiSaveError ?? '自动保存失败')}
                          </p>
                        ) : null}

                        {loading ? (
                          <div className="settings-loading">
                            <Spin />
                          </div>
                        ) : error ? (
                          <Alert type="error" showIcon message={error} />
                        ) : (
                          <div className="ai-config-layout">
                            <div className="ai-config-editor">
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
                            </div>

                            <aside
                              className="ai-config-guide"
                              aria-label="模型配置字段说明"
                            >
                              <div className="ai-config-guide-heading">
                                <div>
                                  <strong>字段说明</strong>
                                  <span>复制示例后替换 API Key 即可使用</span>
                                </div>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<CopyOutlined />}
                                  onClick={() => copyValue(AI_CONFIG_EXAMPLE)}
                                >
                                  复制示例
                                </Button>
                              </div>

                              <div className="ai-config-guide-body">
                                <section className="ai-config-guide-section">
                                  <h4>模型字段</h4>
                                  <dl>
                                    {AI_CONFIG_FIELDS.map(([name, description]) => (
                                      <div className="ai-config-field" key={name}>
                                        <dt><code>{name}</code></dt>
                                        <dd>{description}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                </section>
                              </div>
                            </aside>
                          </div>
                        )}
                      </>
                    )
                  },
                  {
                    key: 'skills',
                    label: '技能目录',
                    children: <SkillSettings />
                  }
                ]}
              />
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

                  <ExecutablePathField
                    id="lark-cli-path"
                    label="Lark Cli 可执行文件"
                    value={larkPathDraft}
                    placeholder="输入路径或选择文件"
                    help="选择文件、自动检测或输入后失焦会立即保存。"
                    detecting={larkSaving}
                    onChange={setLarkPathDraft}
                    onSave={() => persistLarkPath()}
                    onChoose={() => handleChooseLarkCli()}
                    onDetect={() => handleAutoDetect()}
                  />

                  <LarkAuth available={Boolean(larkInfo?.available)} />
                </>
              )}
            </>
          ) : null}


          {activeSection === 'git' ? (
            <GitSettings />
          ) : null}

          {activeSection === 'adb' ? <AdbSettings /> : null}

          {activeSection === 'repositories' ? (
            <RepositorySettings mode="settings" />
          ) : null}

          {activeSection === 'meegle' ? (
            <MeegleSettings />
          ) : null}

          {activeSection === 'ide' ? (
            <IdeSettings />
          ) : null}

          {activeSection === 'terminal' ? <TerminalSettings /> : null}

          {activeSection === 'cleanup' ? <StorageCleanup /> : null}
          {activeSection === 'clipboard' ? <ClipboardSettings /> : null}
          {activeSection === 'migration' ? <MigrationSettings /> : null}

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
                      <Tooltip title="复制">
                        <button
                          type="button"
                          className="settings-copy-button"
                          aria-label={`复制${item.label}`}
                          disabled={!appInfo}
                          onClick={() => copyValue(item.value)}
                        >
                          <CopyOutlined />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>

              <div className="settings-update-row">
                <div className="settings-update-copy">
                  <strong>版本更新</strong>
                  <span>
                    当前版本 v{appInfo?.appVersion ?? '-'}，从飞书云盘检查最新安装包
                  </span>
                </div>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  loading={checkingUpdate}
                  onClick={() => handleCheckUpdates()}
                >
                  检查更新
                </Button>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </Modal>
  )
}
