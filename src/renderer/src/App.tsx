import { useCallback, useEffect, useState } from 'react'
import { Spin } from 'antd'
import AppFooter from './components/AppFooter'
import LoginState from './components/LoginState'
import SettingsModal from './components/SettingsModal'
import type { AppInfo } from '../../types/app'
import type { LarkCliInfo, LarkUser } from '../../types/lark'
import type { SettingsSection } from '../../types/settings'

/**
 * 应用根组件。
 * 未登录时展示扫码入口，登录后保留 Footer 用户状态和设置入口。
 */
export default function App(): JSX.Element {
  // 应用版本及运行时信息，用于 Footer 和设置弹窗。
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  // 当前飞书用户；null 表示未登录或登录状态读取失败。
  const [larkUser, setLarkUser] = useState<LarkUser | null>(null)

  // 未登录时读取 lark-cli 状态，用于区分“未登录”和“未检测到 CLI”。
  const [larkCliInfo, setLarkCliInfo] = useState<LarkCliInfo | null>(null)

  // 首次鉴权检查期间显示加载态，避免未登录页面闪烁。
  const [authLoading, setAuthLoading] = useState(true)

  // 设置弹窗开关状态及打开时定位到的设置分类。
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('ai')

  /**
   * 刷新 lark 登录状态。
   * 未登录时同时读取 lark-cli 信息，用于区分未登录和 CLI 不可用。
   */
  const refreshLarkState = useCallback(async (showLoading = false): Promise<void> => {
    if (showLoading) setAuthLoading(true)

    try {
      const user = await window.electron.getLarkUser()
      setLarkUser(user)

      if (user) {
        setLarkCliInfo(null)
      } else {
        setLarkCliInfo(await window.electron.getLarkCliInfo())
      }
    } catch {
      setLarkUser(null)
      setLarkCliInfo(null)
    } finally {
      if (showLoading) setAuthLoading(false)
    }
  }, [])

  /**
   * 扫码登录成功后刷新用户状态。
   */
  const handleLoggedIn = useCallback((): void => {
    refreshLarkState(true)
  }, [refreshLarkState])

  /**
   * 退出 lark-cli 飞书登录态并刷新页面。
   */
  const handleLogout = useCallback(async (): Promise<void> => {
    await window.electron.logoutLark()
    await refreshLarkState(true)
  }, [refreshLarkState])

  /**
   * 打开设置弹窗，并定位到指定分类。
   */
  const openSettings = useCallback((section: SettingsSection = 'ai'): void => {
    setSettingsSection(section)
    setSettingsOpen(true)
  }, [])

  /**
   * 初始化应用信息与登录状态，并监听窗口重新显示。
   * 每次窗口显示时重新读取登录状态，避免外部登录或登出后界面过期。
   */
  useEffect(() => {
    let mounted = true

    // 应用信息只需读取一次。
    window.electron
      .getAppInfo()
      .then((info) => {
        if (mounted) setAppInfo(info)
      })
      .catch(() => undefined)

    // 首次进入显示鉴权加载态；后续窗口显示时静默刷新。
    refreshLarkState(true)
    const unsubscribe = window.electron.onWindowShown(() => {
      refreshLarkState()
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [refreshLarkState])

  return (
    <div className="app-shell">
      <main className="workspace-canvas">
        {/* 鉴权完成后才展示未登录引导，已登录时暂时保持空白工作区。 */}
        {authLoading ? (
          <div className="auth-loading">
            <Spin />
          </div>
        ) : larkUser ? null : (
          <LoginState
            cliInfo={larkCliInfo}
            onOpenSettings={() => openSettings('lark-cli')}
            onLoggedIn={handleLoggedIn}
          />
        )}
      </main>

      {/* 未登录时 Footer 左侧为空，右侧始终保留设置入口和版本号。 */}
      <AppFooter
        user={larkUser}
        appInfo={appInfo}
        onOpenSettings={() => openSettings()}
        onLogout={handleLogout}
      />

      {/* lark-cli 路径修改后立即刷新登录状态。 */}
      <SettingsModal
        open={settingsOpen}
        initialSection={settingsSection}
        appInfo={appInfo}
        onLarkCliUpdated={refreshLarkState}
        onClose={() => setSettingsOpen(false)}
      />

    </div>
  )
}
