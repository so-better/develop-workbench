import {
  BugOutlined,
  FileTextOutlined,
  GlobalOutlined,
  ProjectOutlined
} from '@ant-design/icons'
import type { LarkUser } from '../../types/lark'
import type { SettingsSection } from '../../types/settings'
import RequirementWorkbench from './pages/RequirementWorkbench/RequirementWorkbench'
import DefectWorkbench from './pages/DefectWorkbench/DefectWorkbench'
import WeeklyReport from './pages/WeeklyReport/WeeklyReport'
import SitesPage from './pages/SitesPage/SitesPage'

interface PageRenderContext {
  onOpenSettings: (section: SettingsSection) => void
  larkUser: LarkUser | null
}

interface AppPageDefinition {
  label: string
  icon: JSX.Element
  render: (context: PageRenderContext) => JSX.Element
}

/**
 * 应用一级页面注册表。
 * 新增页面时只在这里补充页面定义。
 */
export const APP_PAGES = [
  {
    key: 'requirements',
    label: '需求',
    icon: <ProjectOutlined />,
    render: ({ onOpenSettings, larkUser }) => (
      <RequirementWorkbench onOpenSettings={onOpenSettings} larkUser={larkUser} />
    )
  },
  {
    key: 'defects',
    label: '缺陷',
    icon: <BugOutlined />,
    render: ({ onOpenSettings }) => (
      <DefectWorkbench onOpenSettings={onOpenSettings} />
    )
  },
  {
    key: 'sites',
    label: '站点',
    icon: <GlobalOutlined />,
    render: () => <SitesPage />
  },
  {
    key: 'weekly-report',
    label: '周报',
    icon: <FileTextOutlined />,
    render: () => <WeeklyReport />
  }
] as const satisfies ReadonlyArray<AppPageDefinition & { key: string }>

export type AppPage = (typeof APP_PAGES)[number]['key']
