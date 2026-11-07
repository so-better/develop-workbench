import { useCallback, useEffect, useState } from 'react'
import { DeleteOutlined } from '@ant-design/icons'
import { Alert, App, Button, Popconfirm } from 'antd'
import type { ClipboardHistorySettings } from '../../../../types/clipboard-history'
import { getErrorMessage } from '../../../../utils'
import './clipboard-settings.css'

const isMac = window.electron.platform === 'darwin'
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+V'

const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

/** 将浏览器 KeyboardEvent.key 转成 Electron accelerator 支持的键名。 */
const normalizeKey = (key: string): string | null => {
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead'].includes(key)) {
    return null
  }

  if (SPECIAL_KEYS[key]) return SPECIAL_KEYS[key]
  if (/^F\d{1,2}$/i.test(key)) return key.toUpperCase()
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase()
  if (/^[`\-=[\];',./\\]$/.test(key)) return key

  return null
}

/**
 * 录制键盘组合并生成跨平台 accelerator。
 * 统一用 CommandOrControl，避免 macOS 和 Windows 保存出不同配置。
 */
const buildAccelerator = (event: KeyboardEvent): string | null => {
  const key = normalizeKey(event.key)
  if (!key) return null

  const modifiers: string[] = []
  if (event.metaKey || event.ctrlKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')

  if (modifiers.length === 0) return null

  return [...modifiers, key].join('+')
}

const SHORTCUT_PART_NAMES = isMac
  ? { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
  : { CommandOrControl: 'Ctrl', Command: 'Cmd', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }

/** 把 accelerator 拆成可分别展示的键帽。 */
const getShortcutParts = (shortcut: string): string[] =>
  shortcut
    .split('+')
    .map((part) => (SHORTCUT_PART_NAMES as Record<string, string>)[part] ?? part)

/** 把 accelerator 转成一段可读文案，用于消息提示。 */
const formatShortcut = (shortcut: string): string =>
  getShortcutParts(shortcut).join(isMac ? '' : ' + ')

/**
 * 粘贴选择设置。
 * 控制全局快捷键，以及本地缓存的查看和清理。
 */
export default function ClipboardSettings(): JSX.Element {
  const { message } = App.useApp()
  const [state, setState] = useState<ClipboardHistorySettings | null>(null)
  const [recording, setRecording] = useState(false)
  const [saving, setSaving] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setState(await window.electron.getClipboardHistorySettings())
    } catch (error) {
      message.error(getErrorMessage(error, '读取粘贴选择设置失败'))
    }
  }, [message])

  // 录制期间临时注销全局快捷键，避免按下当前组合时先弹出历史浮层。
  const startRecording = useCallback((): void => {
    setRecordError(null)
    setSaving(false)
    setRecording(true)
    void window.electron.setClipboardHistoryRecording(true)
  }, [])

  // 结束录制并恢复全局快捷键注册；保留错误信息供用户查看。
  const endRecording = useCallback((): void => {
    setRecording(false)
    setSaving(false)
    void window.electron.setClipboardHistoryRecording(false).then(() => {
      void reload()
    })
  }, [reload])

  useEffect(() => {
    return () => {
      // 离开设置页时恢复全局快捷键。
      void window.electron.setClipboardHistoryRecording(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const unsubscribe = window.electron.onClipboardHistoryChanged(() => {
      void reload()
    })

    return unsubscribe
  }, [reload])

  // 录制时点击设置区域外或窗口失焦，视为取消录制。
  useEffect(() => {
    if (!recording) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.clipboard-settings')) return
      endRecording()
    }

    const handleBlur = (): void => endRecording()

    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [endRecording, recording])

  // 捕获录制按键，成功后写入主进程并更新快捷键状态。
  useEffect(() => {
    if (!recording) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        endRecording()
        return
      }

      // 只按下修饰键时继续等待主键，不提示错误。
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return
      if (saving) return

      // 单独使用 Shift + 字母会与输入大写冲突，要求至少包含 Cmd/Ctrl 或 Alt。
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        setRecordError('快捷键需要包含 ⌘/Ctrl 或 Alt')
        return
      }

      const accelerator = buildAccelerator(event)
      if (!accelerator) return

      setSaving(true)
      setRecordError(null)

      void window.electron
        .setClipboardHistoryShortcut(accelerator)
        .then((next) => {
          setState(next)
          setRecordError(null)
          message.success(`快捷键已改为 ${formatShortcut(next.shortcut)}`)
          endRecording()
        })
        .catch((error) => {
          // 主进程会恢复旧快捷键，这里结束录制并保留错误提示。
          setRecordError(getErrorMessage(error, '修改快捷键失败'))
          endRecording()
        })
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [endRecording, message, recording, saving])

  const handleResetShortcut = async (): Promise<void> => {
    if (recording || saving) return
    setSaving(true)
    setRecordError(null)

    try {
      const next = await window.electron.setClipboardHistoryShortcut(DEFAULT_SHORTCUT)
      setState(next)
      message.success(`快捷键已恢复为 ${formatShortcut(next.shortcut)}`)
    } catch (error) {
      message.error(getErrorMessage(error, '恢复默认快捷键失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async (): Promise<void> => {
    try {
      setState(await window.electron.clearClipboardHistory())
      message.success('最近内容已清空')
    } catch (error) {
      message.error(getErrorMessage(error, '清空失败'))
    }
  }

  return (
    <>
      <div className="settings-panel-header">
        <h3>粘贴选择</h3>
        <p>读取系统剪贴板，提供快速选择粘贴；不接管系统剪贴板。</p>
      </div>

      <div className="clipboard-settings">
        {state && !state.shortcutRegistered && !recording ? (
          <Alert
            type="warning"
            showIcon
            message="当前快捷键未注册成功"
            description="可能已被其他应用占用，请修改快捷键或恢复默认。"
          />
        ) : null}

        <div className="clipboard-settings-row">
          <div className="clipboard-settings-copy">
            <strong>全局快捷键</strong>
            <span>按下后打开粘贴选择</span>
          </div>
          <div className="clipboard-settings-actions">
            <button
              type="button"
              className={`clipboard-shortcut-field${recording ? ' is-recording' : ''}`}
              disabled={saving}
              title={recording ? '按 Esc 取消' : '点击修改快捷键'}
              onClick={() => (recording ? endRecording() : startRecording())}
            >
              {recording ? (
                <span>{saving ? '保存中…' : '请按下组合键…'}</span>
              ) : (
                getShortcutParts(state?.shortcut ?? DEFAULT_SHORTCUT).map((part) => (
                  <kbd key={part}>{part}</kbd>
                ))
              )}
            </button>
            <Button
              type="text"
              size="small"
              disabled={recording || saving}
              onClick={() => void handleResetShortcut()}
            >
              恢复默认
            </Button>
          </div>
        </div>

        {recording || recordError ? (
          <p className={`clipboard-shortcut-tip${recordError ? ' is-error' : ''}`}>
            {recordError ?? '请按下包含 ⌘/Ctrl 或 Alt 的组合键，Esc 取消'}
          </p>
        ) : null}

        <div className="clipboard-settings-footer">
          <span>清空只删除本机保存的最近内容，不会影响系统剪贴板。</span>
          <Popconfirm
            title="清空最近内容？"
            description="会删除所有已收集内容和图片缓存，无法恢复。"
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleClear()}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />}>
              清空最近内容
            </Button>
          </Popconfirm>
        </div>

        <p className="clipboard-settings-hint">
          应用只在提供粘贴选择时读取剪贴板；选择粘贴时会写入剪贴板并发送粘贴快捷键。
          macOS 首次自动粘贴时，可能需要在“系统设置 → 隐私与安全性 → 辅助功能”中允许本应用。没有权限时，内容仍会复制到剪贴板，可手动粘贴。
        </p>
      </div>
    </>
  )
}
