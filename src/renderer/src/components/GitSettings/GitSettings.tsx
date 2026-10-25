import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Spin } from 'antd'
import type { GitInfo, GitPathSource } from '../../../../types/git'

const gitSourceNames: Record<GitPathSource, string> = {
  settings: '应用设置',
  environment: '环境变量',
  auto: '自动检测'
}

/**
 * Git 可执行文件配置。
 * 支持手动选择、自动检测和清除配置恢复自动模式。
 */
export default function GitSettings(): JSX.Element {
  const { message } = App.useApp()
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [pathDirty, setPathDirty] = useState(false)

  /**
   * 读取当前生效的 Git 路径和版本。
   */
  const loadState = async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const next = await window.electron.getGitInfo()
      setInfo(next)
      setPathDraft(next.path ?? '')
      setPathDirty(false)
    } catch {
      setError('读取 Git 配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  /**
   * 选择 Git 可执行文件后立即保存。
   */
  const handleChooseFile = async (): Promise<void> => {
    try {
      const selected = await window.electron.selectGitPath(
        pathDraft.trim() || info?.path
      )

      if (!selected) return

      setPathDraft(selected)
      setPathDirty(true)
      setError(null)
      await savePath(selected)
    } catch {
      message.error('无法打开文件选择器')
    }
  }

  /**
   * 只执行自动检测，并把检测结果填入输入框。
   * 检测成功后立即写入偏好。
   */
  const handleAutoDetect = async (): Promise<void> => {
    setDetecting(true)

    try {
      const detected = await window.electron.detectGitInfo()

      setInfo(detected)
      setPathDraft(detected.path ?? '')
      setPathDirty(false)

      if (detected.available && detected.path) {
        await savePath(detected.path)
      } else {
        message.warning('未检测到可用的 Git')
      }
    } catch {
      message.error('Git 自动检测失败')
    } finally {
      setDetecting(false)
    }
  }

  /**
   * 立即保存 Git 路径；空值恢复自动检测。
   */
  const savePath = async (value?: string | null): Promise<void> => {
    try {
      const next = await window.electron.setGitPath(
        value !== undefined ? value : pathDraft.trim() || null
      )

      setInfo(next)
      setPathDraft(next.path ?? '')
      setPathDirty(false)
      message.success('Git 配置已自动保存')
    } catch (saveError) {
      message.error(
        saveError instanceof Error ? saveError.message : '保存 Git 配置失败'
      )
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>Git</h3>
        <p>
          应用通过本机 Git 执行仓库扫描、克隆、分支切换和拉取。可以选择可执行文件，也可以使用自动检测。
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
                Git {info.version}
                {info.source ? ` · ${gitSourceNames[info.source]}` : ''}
              </span>
            ) : null}
          </div>

          {!info?.path ? (
            <Alert
              type="warning"
              showIcon
              message="未检测到 Git。请选择 Git 可执行文件，或安装后点击自动检测。"
            />
          ) : null}

          {info?.path && !info.available ? (
            <Alert
              type="error"
              showIcon
              message="当前 Git 路径不可用。请重新选择文件，或点击自动检测。"
            />
          ) : null}

          <div className="lark-path-field">
            <label htmlFor="git-path">Git 可执行文件</label>
            <div className="lark-path-controls">
              <Input
                id="git-path"
                value={pathDraft}
                onChange={(event) => {
                  setPathDraft(event.target.value)
                  setPathDirty(true)
                }}
                onBlur={() => {
                  if (pathDirty) void savePath()
                }}
                onPressEnter={() => {
                  if (pathDirty) void savePath()
                }}
                placeholder="输入路径或选择文件"
                spellCheck={false}
              />
              <Button variant="filled" onClick={() => handleChooseFile()}>
                选择文件
              </Button>
              <Button
                variant="filled"
                onClick={() => handleAutoDetect()}
                loading={detecting}
              >
                自动检测
              </Button>
            </div>
            <p className="settings-help">
              选择文件、自动检测或输入后失焦会立即保存。清空路径可恢复自动检测。
            </p>
          </div>
        </>
      )}
    </>
  )
}
