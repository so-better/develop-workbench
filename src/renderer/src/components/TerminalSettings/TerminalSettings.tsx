import { useEffect, useState } from 'react'
import { Alert, App, Button, InputNumber, Spin, Switch } from 'antd'
import { DEFAULT_TERMINAL_SETTINGS } from '../../../../types/terminal'
import type {
  TerminalSettings as TerminalSettingsValue,
  TerminalShellInfo,
  TerminalShellSource
} from '../../../../types/terminal'
import { getErrorMessage } from '../../../../utils'
import ExecutablePathField from '../ExecutablePathField/ExecutablePathField'
import './TerminalSettings.css'

const SHELL_SOURCE_NAMES: Record<TerminalShellSource, string> = {
  settings: '应用设置',
  environment: '环境变量',
  auto: '自动检测'
}

/**
 * 终端设置。
 * shell 只影响新会话，字体、字号、scrollback 和 WebGL 会实时应用。
 */
export default function TerminalSettings(): JSX.Element {
  const { message } = App.useApp()
  const [settings, setSettings] = useState<TerminalSettingsValue | null>(null)
  const [shellInfo, setShellInfo] = useState<TerminalShellInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detectingShell, setDetectingShell] = useState(false)
  const [shellDraft, setShellDraft] = useState('')
  const [fontSizeDraft, setFontSizeDraft] = useState<number | null>(null)
  const [scrollbackDraft, setScrollbackDraft] = useState<number | null>(null)

  const applyDrafts = (next: TerminalSettingsValue): void => {
    setSettings(next)
    setFontSizeDraft(next.fontSize)
    setScrollbackDraft(next.scrollback)
  }

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError(null)

    Promise.all([
      window.electron.getTerminalSettings(),
      window.electron.getTerminalShellInfo()
    ])
      .then(([nextSettings, nextShellInfo]) => {
        if (cancelled) return

        applyDrafts(nextSettings)
        setShellInfo(nextShellInfo)
        // 自动检测模式下也把实际生效的路径显示出来。
        setShellDraft(nextSettings.shell ?? nextShellInfo.path)
      })
      .catch(() => {
        if (!cancelled) setError('读取终端设置失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const saveSettings = async (
    patch: Partial<TerminalSettingsValue>,
    successMessage?: string
  ): Promise<void> => {
    try {
      const next = await window.electron.updateTerminalSettings(patch)

      applyDrafts(next)

      if ('shell' in patch) {
        try {
          const info = await window.electron.getTerminalShellInfo()

          setShellInfo(info)
          setShellDraft(next.shell ?? info.path)
        } catch {
          // 状态刷新失败不影响已保存的设置。
        }
      }

      if (successMessage) message.success(successMessage)
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存终端设置失败'))
    }
  }

  const handleChooseShell = async (): Promise<void> => {
    try {
      const selected = await window.electron.selectTerminalShell()

      if (!selected) return

      setShellDraft(selected)
      await saveSettings({ shell: selected }, 'Shell 已更新，新建终端生效')
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  const handleSaveShell = async (): Promise<void> => {
    if (!settings) return

    const nextShell = shellDraft.trim() || null

    if (nextShell === settings.shell) return

    // 自动模式下输入框展示的是实际生效路径，未改动时不应保存成固定路径。
    if (settings.shell === null && nextShell === shellInfo?.path) return

    await saveSettings({ shell: nextShell }, 'Shell 已保存，新建终端生效')
  }

  const handleDetectShell = async (): Promise<void> => {
    setDetectingShell(true)

    try {
      const info = await window.electron.detectTerminalShell()

      setShellInfo(info)

      if (!info.available) {
        message.warning('未检测到可用的 Shell')
        return
      }

      setShellDraft(info.path)
      await saveSettings({ shell: info.path }, '已检测并保存 Shell')
    } catch {
      message.error('自动检测 Shell 失败')
    } finally {
      setDetectingShell(false)
    }
  }

  const handleSaveFontSize = async (): Promise<void> => {
    if (!settings) return

    if (fontSizeDraft === null) {
      setFontSizeDraft(settings.fontSize)
      return
    }

    if (fontSizeDraft === settings.fontSize) return

    await saveSettings({ fontSize: fontSizeDraft })
  }

  const handleSaveScrollback = async (): Promise<void> => {
    if (!settings) return

    if (scrollbackDraft === null) {
      setScrollbackDraft(settings.scrollback)
      return
    }

    if (scrollbackDraft === settings.scrollback) return

    await saveSettings({ scrollback: scrollbackDraft })
  }

  const handleReset = async (): Promise<void> => {
    await saveSettings(
      {
        shell: null,
        fontFamily: DEFAULT_TERMINAL_SETTINGS.fontFamily,
        fontSize: DEFAULT_TERMINAL_SETTINGS.fontSize,
        scrollback: DEFAULT_TERMINAL_SETTINGS.scrollback,
        webgl: DEFAULT_TERMINAL_SETTINGS.webgl,
        copyOnSelect: DEFAULT_TERMINAL_SETTINGS.copyOnSelect
      },
      '已恢复默认终端设置'
    )
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>终端</h3>
        <p>
          配置默认 shell、字体、滚动历史和渲染方式。shell 只影响新开的终端，其余设置会立即生效。
        </p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : settings ? (
        <div className="terminal-settings">
          <section className="terminal-settings-section">
            <div className="terminal-settings-section-heading">
              <h4>Shell</h4>
              <p>只影响新开的终端，已运行的 shell 不会切换。</p>
            </div>

            <div className="lark-status">
              <div className="lark-status-main">
                <span
                  className={`lark-status-dot${shellInfo?.available ? ' is-available' : ' is-unavailable'}`}
                  aria-hidden="true"
                />
                <span>当前状态</span>
                <strong
                  className={
                    shellInfo?.available ? 'is-available' : 'is-unavailable'
                  }
                >
                  {shellInfo?.available ? '可用' : '不可用'}
                </strong>
              </div>
              {shellInfo?.available ? (
                <span className="lark-status-version">
                  {shellInfo.name} · {SHELL_SOURCE_NAMES[shellInfo.source]}
                </span>
              ) : null}
            </div>

            {shellInfo && !shellInfo.available ? (
              <Alert
                type="warning"
                showIcon
                message="未检测到可用的 Shell"
                description="请选择 shell 可执行文件，或点击自动检测。"
              />
            ) : null}

            <ExecutablePathField
              id="terminal-shell-path"
              label="Shell 可执行文件"
              value={shellDraft}
              placeholder="选择或输入 Shell 路径"
              help="选择文件、自动检测或输入后失焦会立即保存。清空路径可恢复自动检测。"
              detecting={detectingShell}
              onChange={setShellDraft}
              onSave={() => void handleSaveShell()}
              onChoose={() => void handleChooseShell()}
              onDetect={() => void handleDetectShell()}
            />
          </section>

          <section className="terminal-settings-section">
            <div className="terminal-settings-section-heading">
              <h4>外观</h4>
              <p>修改后立即应用到当前终端。</p>
            </div>

            <div className="terminal-settings-grid">
              <div className="terminal-settings-field">
                <label htmlFor="terminal-font-size">字号</label>
                <InputNumber
                  id="terminal-font-size"
                  min={10}
                  max={24}
                  value={fontSizeDraft}
                  onChange={(value) =>
                    setFontSizeDraft(typeof value === 'number' ? value : null)
                  }
                  onBlur={() => void handleSaveFontSize()}
                  onPressEnter={() => void handleSaveFontSize()}
                />
                <p className="settings-help">范围 10–24 px。</p>
              </div>

              <div className="terminal-settings-field">
                <label htmlFor="terminal-scrollback">滚动历史行数</label>
                <InputNumber
                  id="terminal-scrollback"
                  min={1000}
                  max={100000}
                  step={1000}
                  value={scrollbackDraft}
                  onChange={(value) =>
                    setScrollbackDraft(typeof value === 'number' ? value : null)
                  }
                  onBlur={() => void handleSaveScrollback()}
                  onPressEnter={() => void handleSaveScrollback()}
                />
                <p className="settings-help">范围 1000–100000 行。</p>
              </div>
            </div>
          </section>

          <section className="terminal-settings-section">
            <div className="terminal-settings-section-heading">
              <h4>交互</h4>
            </div>

            <div className="terminal-settings-toggle">
              <div className="terminal-settings-toggle-copy">
                <strong>WebGL 加速</strong>
                <p>使用 GPU 渲染，适合高刷新和大量输出；关闭后回退 DOM 渲染。</p>
              </div>
              <Switch
                id="terminal-webgl"
                aria-label="WebGL 加速"
                checked={settings.webgl}
                onChange={(checked) =>
                  void saveSettings(
                    { webgl: checked },
                    checked ? '已启用 WebGL 加速' : '已关闭 WebGL 加速'
                  )
                }
              />
            </div>

            <div className="terminal-settings-toggle">
              <div className="terminal-settings-toggle-copy">
                <strong>选中即复制</strong>
                <p>
                  鼠标选中文本后自动写入剪贴板；关闭时使用 Cmd/Ctrl+C
                  或右键复制。
                </p>
              </div>
              <Switch
                id="terminal-copy-on-select"
                aria-label="选中即复制"
                checked={settings.copyOnSelect}
                onChange={(checked) =>
                  void saveSettings(
                    { copyOnSelect: checked },
                    checked ? '已开启选中即复制' : '已关闭选中即复制'
                  )
                }
              />
            </div>
          </section>

          <div className="terminal-settings-actions">
            <Button onClick={() => void handleReset()}>恢复默认设置</Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
