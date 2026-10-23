import { Empty } from 'antd'
import ThemeSwitcher from './components/ThemeSwitcher'

/**
 * 应用根组件。
 * 当前保持空白工作区，仅提供主题切换入口作为基础能力示例。
 */
export default function App(): JSX.Element {
  return (
    <div className="app-shell">
      <ThemeSwitcher />
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="工作台基础框架已就绪" />
    </div>
  )
}
