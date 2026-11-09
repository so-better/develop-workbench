import { useEffect, useState } from 'react'
import { Alert, App, Spin } from 'antd'
import type { AdbInfo, AdbPathSource } from '../../../../types/adb'
import ExecutablePathField from '../ExecutablePathField/ExecutablePathField'

const adbSourceNames: Record<AdbPathSource, string> = {
  settings: '应用设置',
  environment: '环境变量',
  auto: '自动检测'
}

/**
 * ADB 可执行文件配置。
 * 支持手动选择、自动检测和清空配置恢复自动模式。
 */
export default function AdbSettings(): JSX.Element {
  const { message } = App.useApp()
  const [info, setInfo] = useState<AdbInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [pathDirty, setPathDirty] = useState(false)

  const loadState = async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const next = await window.electron.getAdbInfo()
      setInfo(next)
      setPathDraft(next.path ?? '')
      setPathDirty(false)
    } catch {
      setError('读取 ADB 配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  const handleChooseFile = async (): Promise<void> => {
    try {
      const selected = await window.electron.selectAdbPath()

      if (!selected) return

      setPathDraft(selected)
      setPathDirty(true)
      setError(null)
      await savePath(selected)
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  const handleAutoDetect = async (): Promise<void> => {
    setDetecting(true)

    try {
      const detected = await window.electron.detectAdbInfo()

      setInfo(detected)
      setPathDraft(detected.path ?? '')
      setPathDirty(false)

      if (detected.available && detected.path) {
        await savePath(detected.path)
      } else {
        message.warning('未检测到可用的 ADB')
      }
    } catch {
      message.error('ADB 自动检测失败')
    } finally {
      setDetecting(false)
    }
  }

  const savePath = async (value?: string | null): Promise<void> => {
    try {
      const next = await window.electron.setAdbPath(
        value !== undefined ? value : pathDraft.trim() || null
      )

      setInfo(next)
      setPathDraft(next.path ?? '')
      setPathDirty(false)
      message.success('ADB 配置已自动保存')
    } catch (saveError) {
      message.error(
        saveError instanceof Error ? saveError.message : '保存 ADB 配置失败'
      )
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>ADB</h3>
        <p>
          应用通过本机 Android SDK 中的 ADB 操作模拟器和应用。可以选择可执行文件，也可以使用自动检测。
        </p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message={error} />
      ) : (
        <>
          <div className="lark-status">
            <div className="lark-status-main">
              <span
                className={`lark-status-dot${info?.available ? ' is-available' : ' is-unavailable'}`}
                aria-hidden="true"
              />
              <span>当前状态</span>
              <strong className={info?.available ? 'is-available' : 'is-unavailable'}>
                {info?.available ? '可用' : '不可用'}
              </strong>
            </div>
            {info?.version ? (
              <span className="lark-status-version">
                ADB {info.version}
                {info.source ? ` · ${adbSourceNames[info.source]}` : ''}
              </span>
            ) : null}
          </div>

          {!info?.path ? (
            <Alert
              type="warning"
              showIcon
              message="未检测到 ADB。请选择 ADB 可执行文件，或安装 Android SDK 后点击自动检测。"
            />
          ) : null}

          {info?.path && !info.available ? (
            <Alert
              type="error"
              showIcon
              message="当前 ADB 路径不可用。请重新选择文件，或点击自动检测。"
            />
          ) : null}

          <ExecutablePathField
            id="adb-path"
            label="ADB 可执行文件"
            value={pathDraft}
            placeholder="输入路径或选择文件"
            help="选择文件、自动检测或输入后失焦会立即保存。清空路径可恢复自动检测。"
            detecting={detecting}
            onChange={(value) => {
              setPathDraft(value)
              setPathDirty(true)
            }}
            onSave={() => {
              if (pathDirty) savePath()
            }}
            onChoose={() => handleChooseFile()}
            onDetect={() => handleAutoDetect()}
          />
        </>
      )}
    </>
  )
}
