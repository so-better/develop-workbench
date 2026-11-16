import { useEffect, useRef, useState } from 'react'
import { Alert, App, Input, Select, Spin } from 'antd'
import { IDE_PRESETS } from '../../../../types/ide'
import type { IdeConfigState, IdePresetId } from '../../../../types/ide'
import ExecutablePathField from '../ExecutablePathField/ExecutablePathField'
import './IdeSettings.css'

/**
 * 内置 IDE 启动配置。
 */
export default function IdeSettings(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<IdeConfigState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<IdePresetId | null>(null)
  const [command, setCommand] = useState('')
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
      await saveConfig(config.command, value)
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
      await saveConfig(config.command)
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
        await saveConfig(selected)
      }
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  /**
   * 保存当前内置 IDE 和可执行文件。
   */
  const saveConfig = async (
    commandOverride?: string,
    presetOverride?: IdePresetId
  ): Promise<void> => {
    const nextCommand = (commandOverride ?? command).trim()
    const targetPreset = presetOverride
      ? IDE_PRESETS.find((item) => item.id === presetOverride) ?? null
      : selectedPreset

    if (!targetPreset || !nextCommand) return

    try {
      const next = await window.electron.setIdeConfig({
        preset: targetPreset.id,
        name: targetPreset.name,
        command: nextCommand,
        args: targetPreset.args
      })

      detectRequestRef.current += 1
      setState(next)
      setCommand(next.config?.command ?? nextCommand)
      message.success('IDE 配置已自动保存')
    } catch (saveError) {
      message.error(saveError instanceof Error ? saveError.message : '保存 IDE 配置失败')
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>IDE</h3>
        <p>选择内置 IDE。名称和启动参数由预设固定，检测或选择可执行文件后会自动保存。</p>
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

          <ExecutablePathField
            id="ide-command"
            label="可执行文件"
            value={command}
            placeholder={preset ? '自动检测或手动选择可执行文件' : '请先选择 IDE'}
            help="macOS 可以直接选择 .app 应用，也可以选择可执行文件。"
            disabled={!preset}
            chooseLabel="选择应用/文件"
            onChange={setCommand}
            onSave={() => saveConfig()}
            onChoose={() => handleChooseCommand()}
            onDetect={() => handleDetect()}
          />

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
