import { useCallback, useEffect, useState } from 'react'
import AppFooter from './components/AppFooter'
import SettingsModal from './components/SettingsModal'
import ThemeSwitcher from './components/ThemeSwitcher'
import type { AppInfo } from '../../types/app'
import type { LarkUser } from '../../types/lark'

/**
 * 应用根组件。
 * 当前页面保持空白，仅承载底部登录状态、设置入口和设置弹窗。
 */
export default function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [larkUser, setLarkUser] = useState<LarkUser | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  /**
   * 重新读取 lark-cli 登录用户。
   * 窗口重新显示或 lark-cli 路径变化后调用。
   */
  const refreshLarkUser = useCallback(async (): Promise<void> => {
    try {
      setLarkUser(await window.electron.getLarkUser())
    } catch {
      setLarkUser(null)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    window.electron
      .getAppInfo()
      .then((info) => {
        if (mounted) setAppInfo(info)
      })
      .catch(() => undefined)

    refreshLarkUser()
    const unsubscribe = window.electron.onWindowShown(refreshLarkUser)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [refreshLarkUser])

  return (
    <div className="app-shell">
      <main className="workspace-canvas">
        <ThemeSwitcher />
      </main>

      <AppFooter user={larkUser} appInfo={appInfo} onOpenSettings={() => setSettingsOpen(true)} />

      <SettingsModal
        open={settingsOpen}
        appInfo={appInfo}
        onLarkCliUpdated={refreshLarkUser}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
