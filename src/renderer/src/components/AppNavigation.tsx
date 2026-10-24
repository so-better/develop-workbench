import appIcon from '../../../../build/icon.svg'
import { APP_PAGES } from '../navigation'
import type { AppPage } from '../navigation'

interface AppNavigationProps {
  activePage: AppPage
  onChange: (page: AppPage) => void
}

/**
 * 应用级一级导航。
 * 只放跨业务的一级页面入口，具体页面自己的侧栏留在页面内部。
 */
export default function AppNavigation({
  activePage,
  onChange
}: AppNavigationProps): JSX.Element {
  return (
    <nav className="app-navigation" aria-label="主导航">
      <img
        src={appIcon}
        alt=""
        className="app-navigation-logo"
      />

      <div className="app-navigation-items">
        {APP_PAGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`app-navigation-item${
              activePage === item.key ? ' is-active' : ''
            }`}
            aria-current={activePage === item.key ? 'page' : undefined}
            onClick={() => onChange(item.key)}
          >
            <span className="app-navigation-icon">{item.icon}</span>
            <span className="app-navigation-label">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
