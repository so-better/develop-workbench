import appIcon from '../../../../../build/icon.svg'

/**
 * Windows 原生标题栏覆盖层下的拖拽区。
 * 窗口按钮仍由 titleBarOverlay 提供。
 */
export default function AppTitleBar(): JSX.Element | null {
  if (window.electron.platform !== 'win32') return null

  return (
    <div className="app-titlebar">
      <div className="app-titlebar-brand">
        <img src={appIcon} alt="" className="app-titlebar-logo" />
        <span className="app-titlebar-title">AI 研发工作台</span>
      </div>
    </div>
  )
}
