import { useEffect, useState } from 'react'
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, App, Button, Input, Popconfirm, Spin } from 'antd'
import { getErrorMessage } from '../../../../utils'

/** 判断路径是否为绝对路径，支持 POSIX、Windows 盘符和 UNC。 */
const isAbsolutePath = (value: string): boolean =>
  /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value)

/**
 * 技能目录设置。
 * 额外目录保存到应用偏好，保存后主进程会清空技能扫描缓存。
 */
export default function SkillSettings(): JSX.Element {
  const { message } = App.useApp()
  const [directories, setDirectories] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    setLoading(true)
    setError(null)

    window.electron
      .getSkillSettings()
      .then((state) => {
        if (mounted) setDirectories(state.directories)
      })
      .catch((loadError) => {
        if (mounted) setError(getErrorMessage(loadError, '读取技能目录失败'))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  /** 保存新的目录列表，失败时保留旧列表。 */
  const saveDirectories = async (next: string[]): Promise<void> => {
    setSaving(true)
    setError(null)

    try {
      const state = await window.electron.setSkillDirectories(next)

      setDirectories(state.directories)
      setDraft('')
      message.success('技能目录已保存')
    } catch (saveError) {
      setError(getErrorMessage(saveError, '保存技能目录失败'))
    } finally {
      setSaving(false)
    }
  }

  const addDraft = async (): Promise<void> => {
    const value = draft.trim()

    if (!value) return
    if (!isAbsolutePath(value)) {
      setError('请输入绝对路径')
      return
    }
    if (directories.some((directory) => directory === value)) {
      setError('该技能目录已添加')
      return
    }

    await saveDirectories([...directories, value])
  }

  /** 选择目录后直接加入列表并保存。 */
  const chooseDirectory = async (): Promise<void> => {
    try {
      const selected = await window.electron.selectSkillDirectory()

      if (!selected) return
      if (directories.some((directory) => directory === selected)) {
        setError('该技能目录已添加')
        return
      }

      await saveDirectories([...directories, selected])
    } catch (selectError) {
      setError(getErrorMessage(selectError, '打开目录选择器失败'))
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>技能目录</h3>
        <p>添加额外目录后会扫描其中的 SKILL.md 和脚本，保存后立即生效。</p>
      </div>

      {loading ? (
        <div className="settings-loading">
          <Spin />
        </div>
      ) : (
        <>
          {error ? <Alert type="error" showIcon message={error} /> : null}

          <div className="settings-field">
            <label htmlFor="skill-directory-path">扫描目录</label>
            <div className="skill-directory-add">
              <Input
                id="skill-directory-path"
                value={draft}
                placeholder="输入绝对路径，例如 /Users/me/shared-skills"
                spellCheck={false}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                onPressEnter={() => addDraft()}
              />
              <Button
                variant="filled"
                icon={<FolderOpenOutlined />}
                disabled={saving}
                onClick={() => chooseDirectory()}
              >
                选择目录
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                loading={saving}
                disabled={!draft.trim()}
                onClick={() => addDraft()}
              >
                添加
              </Button>
            </div>
            <p className="settings-help">
              仅支持绝对路径，可添加多个目录；相对路径和 ~ 不在此处展开。
            </p>
          </div>

          <div className="skill-directory-list">
            {directories.map((directory) => (
              <div className="skill-directory-row" key={directory}>
                <span className="skill-directory-path">{directory}</span>
                <Popconfirm
                  title="移除这个技能目录？"
                  description="只停止扫描，不会删除目录中的文件。"
                  okText="移除"
                  cancelText="取消"
                  onConfirm={() =>
                    saveDirectories(
                      directories.filter((item) => item !== directory)
                    )
                  }
                >
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    aria-label={`移除技能目录 ${directory}`}
                    disabled={saving}
                  />
                </Popconfirm>
              </div>
            ))}
            {directories.length === 0 ? (
              <div className="skill-directory-empty">还没有配置额外技能目录</div>
            ) : null}
          </div>
        </>
      )}
    </>
  )
}
