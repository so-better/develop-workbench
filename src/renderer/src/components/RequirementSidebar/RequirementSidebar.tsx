import {
  BranchesOutlined,
  DownOutlined,
  FilterOutlined,
  NodeCollapseOutlined,
  NodeExpandOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Select,
  Skeleton,
  Tooltip
} from 'antd'
import type {
  MeegleMyRequirements,
  MeegleRequirementGroup,
  MeegleRequirementNodeCompletion
} from '../../../../types/requirements'
import { formatFetchedAt } from '../../pages/RequirementWorkbench/workbench-utils'
import RequirementGroup from '../RequirementGroup/RequirementGroup'
import './RequirementSidebar.css'

interface FilterOption {
  value: string
  label: string
}

interface RequirementSidebarProps {
  data: MeegleMyRequirements | null
  loading: boolean
  activityLoading: boolean
  projectOptions: FilterOption[]
  projectsLoading: boolean
  projectSwitching: boolean
  onProjectChange: (projectKey: string) => void
  onRefresh: () => void
  showToggleAll: boolean
  allGroupsCollapsed: boolean
  onToggleAllGroups: () => void
  showClosedRequirements: boolean
  onShowClosedRequirementsChange: (checked: boolean) => void
  onCreateRequirement: (key: string) => void
  onOpenVersionSummary: () => void
  filtersCollapsed: boolean
  onToggleFilters: () => void
  activeFilterCount: number
  requirementFilter: string
  onRequirementFilterChange: (value: string) => void
  versionOptions: FilterOption[]
  versionFilter: string | null
  onVersionFilterChange: (value: string | null) => void
  productLineOptions: FilterOption[]
  productLineFilters: string[]
  onProductLineFiltersChange: (values: string[]) => void
  statusOptions: FilterOption[]
  statusFilters: string[]
  onStatusFiltersChange: (values: string[]) => void
  allRequirementsCount: number
  filteredGroups: MeegleRequirementGroup[]
  collapsedGroupKeys: Set<string>
  hasSearch: boolean
  selectedRequirementId: string | null
  nodeCompletions: Record<string, MeegleRequirementNodeCompletion>
  onSelectRequirement: (requirementId: string, groupKey: string) => void
  onToggleGroup: (groupKey: string) => void
}

/**
 * 需求工作台左侧栏：空间、筛选和需求列表。
 */
export default function RequirementSidebar({
  data,
  loading,
  activityLoading,
  projectOptions,
  projectsLoading,
  projectSwitching,
  onProjectChange,
  onRefresh,
  showToggleAll,
  allGroupsCollapsed,
  onToggleAllGroups,
  showClosedRequirements,
  onShowClosedRequirementsChange,
  onCreateRequirement,
  onOpenVersionSummary,
  filtersCollapsed,
  onToggleFilters,
  activeFilterCount,
  requirementFilter,
  onRequirementFilterChange,
  versionOptions,
  versionFilter,
  onVersionFilterChange,
  productLineOptions,
  productLineFilters,
  onProductLineFiltersChange,
  statusOptions,
  statusFilters,
  onStatusFiltersChange,
  allRequirementsCount,
  filteredGroups,
  collapsedGroupKeys,
  hasSearch,
  selectedRequirementId,
  nodeCompletions,
  onSelectRequirement,
  onToggleGroup
}: RequirementSidebarProps): JSX.Element {
  return (
    <aside className="workbench-sidebar">
      <div className="workbench-brand">
        <div className="workbench-brand-text">
          <strong>研发工作台</strong>
          <Select
            size="small"
            variant="borderless"
            showSearch
            className="workbench-project-select"
            value={data?.project.projectKey}
            options={projectOptions}
            loading={projectsLoading || projectSwitching}
            disabled={projectSwitching}
            optionFilterProp="label"
            popupMatchSelectWidth={220}
            onChange={(value: string) => onProjectChange(value)}
          />
        </div>
      </div>

      <div className="workbench-sidebar-heading">
        <span className="workbench-sidebar-title">
          <span>我负责的需求</span>
          <span
            className="workbench-sidebar-count"
            aria-label={`共 ${data?.total ?? 0} 项`}
          >
            共 {data?.total ?? 0} 项
          </span>
        </span>
        <span className="workbench-sidebar-heading-actions">
          <Tooltip title="刷新数据">
            <Button
              type="text"
              size="small"
              className="workbench-sidebar-refresh"
              icon={<ReloadOutlined />}
              loading={loading || activityLoading}
              aria-label="刷新数据"
              onClick={() => onRefresh()}
            />
          </Tooltip>
          {showToggleAll ? (
            <Tooltip title={allGroupsCollapsed ? '全部展开' : '全部收起'}>
              <Button
                type="text"
                size="small"
                className="workbench-toggle-all"
                icon={allGroupsCollapsed ? <NodeExpandOutlined /> : <NodeCollapseOutlined />}
                aria-label={allGroupsCollapsed ? '全部展开' : '全部收起'}
                onClick={onToggleAllGroups}
              />
            </Tooltip>
          ) : null}
          <Checkbox
            className="workbench-show-closed"
            checked={showClosedRequirements}
            disabled={loading || !data}
            onChange={(event) => onShowClosedRequirementsChange(event.target.checked)}
          >
            显示已结束
          </Checkbox>
        </span>
      </div>

      <div className="workbench-sidebar-actions">
        <Dropdown
          trigger={['click']}
          disabled={!data}
          menu={{
            items: [
              { key: 'formal', label: '正式需求（飞书创建）' },
              { key: 'local', label: '临时需求（仅本机）' }
            ],
            onClick: ({ key }) => onCreateRequirement(key)
          }}
        >
          <Button
            type="dashed"
            size="small"
            className="workbench-add-local"
            icon={<PlusOutlined />}
            disabled={!data}
          >
            新建需求 <DownOutlined />
          </Button>
        </Dropdown>
        <Tooltip title="按版本查看仓库和分支汇总">
          <Button
            type="default"
            size="small"
            className="workbench-repository-summary"
            icon={<BranchesOutlined />}
            disabled={loading && !data}
            onClick={onOpenVersionSummary}
          >
            仓库汇总
          </Button>
        </Tooltip>
      </div>

      <div
        className={`workbench-filter-stack${filtersCollapsed ? ' is-collapsed' : ''}`}
      >
        <button
          type="button"
          className="workbench-filter-toggle"
          aria-expanded={!filtersCollapsed}
          onClick={onToggleFilters}
        >
          <span className="workbench-filter-toggle-label">
            <FilterOutlined />
            筛选
          </span>
          <span className="workbench-filter-toggle-meta">
            {activeFilterCount > 0 ? `${activeFilterCount} 项` : '全部'}
          </span>
          <DownOutlined
            className={`workbench-filter-toggle-chevron${
              filtersCollapsed ? ' is-collapsed' : ''
            }`}
          />
        </button>

        {filtersCollapsed ? null : (
          <>
            <Input
              className="workbench-requirement-search"
              prefix={<SearchOutlined />}
              placeholder="搜索需求、状态、版本或产线"
              value={requirementFilter}
              onChange={(event) => onRequirementFilterChange(event.target.value)}
              allowClear
              disabled={loading || !data}
            />

            <Select
              allowClear
              showSearch
              className="workbench-filter-select workbench-version-filter"
              value={versionFilter ?? undefined}
              options={versionOptions}
              placeholder={`全部版本（${data?.groups.length ?? 0}）`}
              aria-label="按版本筛选"
              optionFilterProp="label"
              disabled={loading || !data || versionOptions.length === 0}
              onChange={(value?: string) => onVersionFilterChange(value ?? null)}
            />

            {productLineOptions.length > 1 ? (
              <Select
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                maxTagPlaceholder={(omitted) => `+${omitted.length}`}
                className="workbench-filter-select workbench-product-line-filter"
                value={productLineFilters}
                options={productLineOptions}
                placeholder={`全部产线（${productLineOptions.length}）`}
                aria-label="按产线筛选"
                disabled={loading || !data}
                onChange={onProductLineFiltersChange}
              />
            ) : null}

            <Select
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              maxTagPlaceholder={(omitted) => `+${omitted.length}`}
              className="workbench-filter-select workbench-status-filter"
              value={statusFilters}
              options={statusOptions}
              placeholder={`全部状态（${allRequirementsCount}）`}
              aria-label="按状态筛选"
              disabled={loading || !data || allRequirementsCount === 0}
              onChange={onStatusFiltersChange}
            />
          </>
        )}
      </div>

      {/* 只有首次加载时显示骨架屏；刷新时保留已有列表，避免界面跳动。 */}
      <div className="workbench-requirement-groups">
        {loading && !data ? (
          <div className="workbench-requirement-skeleton">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} active paragraph={false} title={{ width: '82%' }} />
            ))}
          </div>
        ) : filteredGroups.length > 0 ? (
          filteredGroups.map((group) => (
            <RequirementGroup
              key={group.key}
              group={group}
              collapsedGroupKeys={collapsedGroupKeys}
              hasSearch={hasSearch}
              selectedRequirementId={selectedRequirementId}
              nodeCompletions={nodeCompletions}
              onSelectRequirement={onSelectRequirement}
              onToggleGroup={onToggleGroup}
            />
          ))
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={data?.total === 0 ? '当前没有待办需求' : '没有匹配的需求'}
          />
        )}
      </div>

      <p className="workbench-sidebar-footnote">
        数据来自 Meegle 与本地临时需求
        {data ? ` · 同步于 ${formatFetchedAt(data.fetchedAt)}` : ''}
      </p>
    </aside>
  )
}
