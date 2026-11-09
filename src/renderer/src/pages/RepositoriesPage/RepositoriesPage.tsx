import RepositorySettings from '../../components/RepositorySettings/RepositorySettings'
import type { SettingsSection } from '../../../../types/settings'
import './RepositoriesPage.css'

interface RepositoriesPageProps {
  /** 未配置代码根目录时跳转到设置。 */
  onOpenSettings: (section: SettingsSection) => void
}

/**
 * 代码仓库一级页面。
 * 只展示仓库列表和克隆入口，代码根目录仍在设置中配置。
 */
export default function RepositoriesPage({
  onOpenSettings
}: RepositoriesPageProps): JSX.Element {
  return (
    <div className="repositories-page">
      <header className="repositories-page-header">
        <div className="repositories-page-heading">
          <span className="repositories-page-eyebrow">开发环境 / 代码</span>
          <h1>代码仓库</h1>
          <p>查看根目录下扫描到的本地仓库、当前分支和轻舟接入状态。</p>
        </div>
      </header>

      <main className="repositories-page-content">
        <RepositorySettings mode="list" onOpenSettings={onOpenSettings} />
      </main>
    </div>
  )
}
