import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Input, Select, Spin } from 'antd'
import { IDE_PRESETS } from '../../../types/ide'
import type { IdeConfigState, IdePresetId } from '../../../types/ide'

interface IdeSettingsProps {
  /** 向设置弹窗注册底部保存按钮的处理函数。 */
  onSaveReady: (handler: (() => Promise<void>) | null) => void
}

/**
 * 内置 IDE 启动配置。
 */
export default function IdeSettings({ onSaveReady }: IdeSettingsProps): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<IdeConfigState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<IdePresetId | null>(null)
  const [command, setCommand] = useState('')
  const saveRef = useRef<() => Promise<void>>(async () => undefined)
  const detectRequestRef = useRef(0)

  const selectedPreset = preset
    ? IDE_PRESETS.find((item) => item.id === preset) ?? null
    : null

  /**
   * 读取已保存的 IDE 配置。
   */
  const loadState = async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const next = await window.electron.getIdeConfig()
      setState(next)
      setPreset(next.config?.preset ?? null)
      setCommand(next.config?.command ?? '')
    } catch {
      setError('读取 IDE 配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  /**
   * 选择内置 IDE 后自动检测命令。
   */
  const handlePresetChange = async (value: IdePresetId): Promise<void> => {
    const nextPreset = IDE_PRESETS.find((item) => item.id === value)

    if (!nextPreset) return

    const requestId = detectRequestRef.current + 1
    detectRequestRef.current = requestId
    setPreset(value)
    setCommand('')

    try {
      const config = await window.electron.detectIdeConfig(value)

      if (detectRequestRef.current !== requestId) return

      setCommand(config.command)
      message.success(`已检测到 ${config.name}，保存后生效`)
    } catch {
      if (detectRequestRef.current !== requestId) return

      message.warning(`未检测到 ${nextPreset.name}，请手动选择可执行文件`)
    }
  }

  /**
   * 自动检测当前 IDE。
   */
  const handleDetect = async (): Promise<void> => {
    if (!preset) {
      message.warning('请先选择 IDE')
      return
    }

    const requestId = detectRequestRef.current + 1
    detectRequestRef.current = requestId

    try {
      const config = await window.electron.detectIdeConfig(preset)

      if (detectRequestRef.current !== requestId) return

      setCommand(config.command)
      message.success(`已检测到 ${config.name}，保存后生效`)
    } catch (detectError) {
      if (detectRequestRef.current !== requestId) return

      message.error(detectError instanceof Error ? detectError.message : '未检测到 IDE')
    }
  }

  /**
   * 选择 IDE 可执行文件。
   */
  const handleChooseCommand = async (): Promise<void> => {
    if (!preset) {
      message.warning('请先选择 IDE')
      return
    }

    try {
      const selected = await window.electron.selectIdeCommand(command || null, preset)

      if (selected) {
        detectRequestRef.current += 1
        setCommand(selected)
        setError(null)
      }
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  /**
   * 保存当前内置 IDE 和可执行文件。
   */
  const saveConfig = async (): Promise<void> => {
    if (!selectedPreset) {
      message.error('请选择 IDE')
      return
    }

    if (!command.trim()) {
      message.error('请选择或自动检测 IDE 可执行文件')
      return
    }

    try {
      const next = await window.electron.setIdeConfig({
        preset: selectedPreset.id,
        name: selectedPreset.name,
        command,
        args: selectedPreset.args
      })

      detectRequestRef.current += 1
      setState(next)
      setCommand(next.config?.command ?? command)
      message.success('IDE 配置已保存')
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : '保存 IDE 配置失败')
    }
  }

  // 每次渲染更新引用，只在父组件回调变化时重新注册，避免状态循环。
  saveRef.current = saveConfig

  useEffect(() => {
    onSaveReady(() => saveRef.current())
    return () => onSaveReady(null)
  }, [onSaveReady])

  return (
    <>
      <div className="settings-panel-header">
        <h3>IDE</h3>
        <p>选择内置 IDE。名称和启动参数由预设固定，可执行文件支持自动检测或手动选择。</p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : (
        <>
          <div className="ide-status">
            <span
              className={`lark-status-dot${state?.available ? ' is-available' : ' is-unavailable'}`}
              aria-hidden="true"
            />
            <span>当前状态</span>
            <strong className={state?.available ? 'is-available' : 'is-unavailable'}>
              {state?.available ? '可用' : '未配置或不可用'}
            </strong>
          </div>

          <div className="settings-field">
            <label htmlFor="ide-preset">IDE</label>
            <Select
              id="ide-preset"
              value={preset ?? undefined}
              placeholder="请选择 IDE"
              options={IDE_PRESETS.map((item) => ({
                value: item.id,
                label: item.name
              }))}
              onChange={(value: IdePresetId) => handlePresetChange(value)}
            />
          </div>

          <div className="settings-field">
            <label htmlFor="ide-command">可执行文件</label>
            <div className="ide-command-controls">
              <Input
                id="ide-command"
                value={command}
                placeholder={preset ? '自动检测或手动选择可执行文件' : '请先选择 IDE'}
                spellCheck={false}
                disabled={!preset}
                onChange={(event) => setCommand(event.target.value)}
              />
              <Button
                variant="filled"
                disabled={!preset}
                onClick={() => handleChooseCommand()}
              >
                选择应用/文件
              </Button>
              <Button variant="filled" disabled={!preset} onClick={() => handleDetect()}>
                自动检测
              </Button>
            </div>
            <p className="settings-help">
              macOS 可以直接选择 .app 应用，也可以选择可执行文件。
            </p>
          </div>

          <div className="settings-field">
            <label htmlFor="ide-args">启动参数</label>
            <Input.TextArea
              id="ide-args"
              className="ide-args-editor"
              value={selectedPreset?.args.join('\n') ?? ''}
              autoSize={{ minRows: 2, maxRows: 6 }}
              readOnly
            />
            <p className="settings-help">
              启动参数由内置预设固定，{'{path}'} 会替换为仓库路径。
            </p>
          </div>
        </>
      )}
    </>
  )
}
