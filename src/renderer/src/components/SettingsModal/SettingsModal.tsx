import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CopyOutlined, DeleteOutlined, FileTextOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Modal, Popconfirm, Spin, Tooltip } from 'antd'
import type { AiArtifactStats } from '../../../../types/ai'
import type { AppInfo } from '../../../../types/app'
import type { LarkCliInfo, LarkCliPathSource } from '../../../../types/lark'
import {
  DEFAULT_SETTINGS_SECTION
} from '../../../../types/settings'
import type { SettingsSection } from '../../../../types/settings'
import { getErrorMessage } from '../../../../utils'
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

/** 把字节数格式化为设置页可读文本。 */
const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${Math.max(0, Math.round(bytes))} B`
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
 * 当前包含模型配置和 lark-cli 路径，并在底部展示真实的应用运行信息。
 */
export default function SettingsModal({
  open,
  initialSection = DEFAULT_SETTINGS_SECTION,
  appInfo,
  onLarkCliUpdated,
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
  const lastSavedDraftRef = useRef('')
  const [larkInfo, setLarkInfo] = useState<LarkCliInfo | null>(null)
  const [larkPathDraft, setLarkPathDraft] = useState('')
  const [larkSaving, setLarkSaving] = useState(false)
  const [larkLoading, setLarkLoading] = useState(false)
  const [larkError, setLarkError] = useState<string | null>(null)
  const [artifactStats, setArtifactStats] = useState<AiArtifactStats | null>(null)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const [artifactClearing, setArtifactClearing] = useState(false)
  const [artifactError, setArtifactError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    let mounted = true

    setActiveSection(initialSection)
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

  useEffect(() => {
    if (!open || activeSection !== 'cleanup') return

    let mounted = true

    setArtifactLoading(true)
    setArtifactError(null)

    window.electron
      .getAiArtifactStats()
      .then((stats) => {
        if (mounted) setArtifactStats(stats)
      })
      .catch((statsError) => {
        if (mounted) {
          setArtifactError(getErrorMessage(statsError, '读取 AI 产物统计失败'))
        }
      })
      .finally(() => {
        if (mounted) setArtifactLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [activeSection, open])

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

  const handleClearArtifacts = async (): Promise<void> => {
    setArtifactClearing(true)
    setArtifactError(null)

    try {
      const removed = await window.electron.clearAiArtifacts()
      setArtifactStats({ count: 0, bytes: 0 })
      message.success(`已清理 ${removed.count} 个 AI 产物`)
    } catch (clearError) {
      setArtifactError(getErrorMessage(clearError, '清理 AI 产物失败'))
    } finally {
      setArtifactClearing(false)
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
            className={`settings-nav-item${activeSection === 'cleanup' ? ' is-active' : ''}`}
            aria-current={activeSection === 'cleanup' ? 'page' : undefined}
            onClick={() => setActiveSection('cleanup')}
          >
            内存清理
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
                <p>
                  仅支持 OpenAI Chat Completions 接口。按字段说明填写，格式正确时自动保存。
                </p>
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
              </div>

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
                        onBlur={() => persistLarkPath()}
                        onPressEnter={() => persistLarkPath()}
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

          {activeSection === 'cleanup' ? (
            <>
              <div className="settings-panel-header">
                <h3>内存清理</h3>
                <p>清理应用内部生成的临时文件，不会删除已经保存到本机的文件。</p>
              </div>

              {artifactLoading ? (
                <div className="settings-loading">
                  <Spin />
                </div>
              ) : artifactError ? (
                <Alert type="error" showIcon message={artifactError} />
              ) : (
                <div className="storage-cleanup-card">
                  <div className="storage-cleanup-head">
                    <span className="storage-cleanup-icon">
                      <FileTextOutlined />
                    </span>
                    <div className="storage-cleanup-copy">
                      <strong>AI 产物</strong>
                      <span>对话中生成的内部临时文件</span>
                    </div>
                    <Popconfirm
                      title="清理 AI 产物？"
                      description="将删除对话中生成的内部缓存文件，已经保存到本机的文件不受影响。"
                      okText="清理"
                      cancelText="取消"
                      onConfirm={handleClearArtifacts}
                    >
                      <Button
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        loading={artifactClearing}
                        disabled={!artifactStats?.count || artifactClearing}
                      >
                        清理
                      </Button>
                    </Popconfirm>
                  </div>

                  <div className="storage-cleanup-stats">
                    <div className="storage-cleanup-stat">
                      <span>文件数量</span>
                      <strong>{artifactStats?.count ?? 0}</strong>
                    </div>
                    <div className="storage-cleanup-stat">
                      <span>占用空间</span>
                      <strong>{formatBytes(artifactStats?.bytes ?? 0)}</strong>
                    </div>
                  </div>

                  <div className="storage-cleanup-note">
                    清理后，当前对话中尚未下载的产物将失效；已经保存到本机的文件不受影响。
                  </div>
                </div>
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
            </>
          ) : null}
        </section>
      </div>
    </Modal>
  )
}
