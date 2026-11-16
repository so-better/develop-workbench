import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Avatar,
  Button,
  Checkbox,
  Empty,
  Input,
  Select,
  Skeleton,
  Tooltip
} from 'antd'
import '../RequirementSidebar/RequirementSidebar.css'
import '../RequirementGroup/RequirementGroup.css'
import '../RequirementListItem/RequirementListItem.css'
import '../RequirementInfoSection/RequirementInfoSection.css'
import { DEFECT_ROLES } from '../../../../types/defects'
import type {
  DefectRole,
  MeegleDefect,
  MeegleMyDefects
} from '../../../../types/defects'
import {
  formatDate,
  formatFetchedAt,
  getDefectVersionLabel,
  getPriorityTone,
  getSeverityTone,
  getStatusTone
} from '../../pages/DefectWorkbench/defect-utils'
import DefectStatusTag from '../DefectStatusTag/DefectStatusTag'

interface FilterOption {
  value: string
  label: string
}

interface DefectSidebarProps {
  data: MeegleMyDefects | null
  loading: boolean
  projectOptions: FilterOption[]
  projectsLoading: boolean
  projectSwitching: boolean
  showClosedDefects: boolean
  search: string
  role: DefectRole | null
  versionFilter: string | null
  versionOptions: FilterOption[]
  productLineOptions: FilterOption[]
  productLineFilters: string[]
  statusOptions: FilterOption[]
  statusFilters: string[]
  defectsCount: number
  filteredDefects: MeegleDefect[]
  selectedDefectId: string | null
  onProjectChange: (projectKey: string) => void
  onRefresh: () => void
  onShowClosedDefectsChange: (checked: boolean) => void
  onSearchChange: (value: string) => void
  onRoleChange: (role?: DefectRole) => void
  onVersionFilterChange: (value: string | null) => void
  onProductLineFiltersChange: (values: string[]) => void
  onStatusFiltersChange: (values: string[]) => void
  onSelectDefect: (defectId: string) => void
}

/**
 * 缺陷工作台左侧栏：空间、筛选和缺陷列表。
 */
export default function DefectSidebar({
  data,
  loading,
  projectOptions,
  projectsLoading,
  projectSwitching,
  showClosedDefects,
  search,
  role,
  versionFilter,
  versionOptions,
  productLineOptions,
  productLineFilters,
  statusOptions,
  statusFilters,
  defectsCount,
  filteredDefects,
  selectedDefectId,
  onProjectChange,
  onRefresh,
  onShowClosedDefectsChange,
  onSearchChange,
  onRoleChange,
  onVersionFilterChange,
  onProductLineFiltersChange,
  onStatusFiltersChange,
  onSelectDefect
}: DefectSidebarProps): JSX.Element {
  return (
    <aside className="workbench-sidebar">
      <div className="workbench-brand">
        <div className="workbench-brand-text">
          <strong>缺陷工作台</strong>
          <Select
            size="small"
            variant="borderless"
            showSearch
            className="workbench-project-select"
            value={data?.project.projectKey}
            placeholder="选择空间"
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
          <span>我参与的缺陷</span>
          <span className="workbench-sidebar-count">共 {data?.total ?? 0} 项</span>
        </span>
        <span className="workbench-sidebar-heading-actions">
          <Tooltip title="刷新数据">
            <Button
              type="text"
              size="small"
              className="workbench-sidebar-refresh"
              icon={<ReloadOutlined />}
              loading={loading}
              aria-label="刷新缺陷"
              onClick={onRefresh}
            />
          </Tooltip>
          <Checkbox
            className="workbench-show-closed"
            checked={showClosedDefects}
            disabled={loading}
            onChange={(event) => onShowClosedDefectsChange(event.target.checked)}
          >
            显示已结束
          </Checkbox>
        </span>
      </div>

      <div className="workbench-filter-stack">
        <Input
          className="workbench-requirement-search"
          prefix={<SearchOutlined />}
          placeholder="搜索缺陷、状态、版本或产线"
          value={search}
          allowClear
          disabled={loading && !data}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <Select
          className="workbench-filter-select"
          value={role ?? undefined}
          allowClear
          options={DEFECT_ROLES.map((item) => ({ value: item, label: item }))}
          placeholder="全部角色"
          aria-label="按缺陷角色筛选"
          onChange={onRoleChange}
        />
        <Select
          className="workbench-filter-select"
          value={versionFilter ?? undefined}
          allowClear
          showSearch
          optionFilterProp="label"
          options={versionOptions}
          placeholder={`全部版本（${versionOptions.length}）`}
          aria-label="按缺陷版本筛选"
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
            aria-label="按缺陷产线筛选"
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
          placeholder={`全部状态（${defectsCount}）`}
          aria-label="按缺陷状态筛选"
          onChange={onStatusFiltersChange}
        />
      </div>

      <div className="workbench-requirement-groups">
        {loading && !data ? (
          <div className="workbench-requirement-skeleton">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} active paragraph={false} title={{ width: '86%' }} />
            ))}
          </div>
        ) : filteredDefects.length > 0 ? (
          <div className="workbench-requirement-group">
            <div className="workbench-requirement-group-list">
              {filteredDefects.map((defect) => (
                <button
                  key={defect.id}
                  type="button"
                  className={`workbench-requirement-item${
                    selectedDefectId === defect.id ? ' is-active' : ''
                  }`}
                  onClick={() => onSelectDefect(defect.id)}
                >
                  <span className="workbench-requirement-item-title-row">
                    {defect.priority ? (
                      <span
                        className={`requirement-priority is-${getPriorityTone(
                          defect.priority
                        )}`}
                      >
                        {defect.priority}
                      </span>
                    ) : null}
                    <span
                      className="workbench-requirement-item-name"
                      title={defect.name}
                    >
                      {defect.name}
                    </span>
                  </span>
                  <span className="workbench-requirement-item-top">
                    <span className="workbench-requirement-item-state">
                      <DefectStatusTag
                        value={defect.status}
                        tone={getStatusTone(defect.status)}
                      />
                    </span>
                    <span
                      className={`workbench-requirement-item-owner${
                        defect.owners.length ? '' : ' is-empty'
                      }`}
                    >
                      {defect.owners.length ? (
                        <>
                          <Avatar
                            size={20}
                            src={defect.owners[0].avatarUrl ?? undefined}
                            className="workbench-requirement-contact-avatar"
                          >
                            {defect.owners[0].name.slice(0, 1)}
                          </Avatar>
                          <span className="workbench-requirement-item-owner-text">
                            {defect.owners[0].name}
                          </span>
                          {defect.owners.length > 1 ? (
                            <span className="workbench-requirement-item-owner-extra">
                              等 {defect.owners.length} 人
                            </span>
                          ) : null}
                        </>
                      ) : (
                        '待补充负责人'
                      )}
                    </span>
                  </span>
                  <span className="workbench-requirement-item-footer">
                    <span className="workbench-requirement-item-tags">
                      {defect.severity ? (
                        <span
                          className={`requirement-priority is-${getSeverityTone(
                            defect.severity
                          )}`}
                        >
                          {defect.severity}
                        </span>
                      ) : null}
                      <span className="workbench-requirement-type">
                        {getDefectVersionLabel(defect)}
                      </span>
                    </span>
                    <span className="workbench-requirement-item-updated">
                      {formatDate(defect.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              data?.total === 0
                ? showClosedDefects
                  ? '当前没有缺陷'
                  : '当前没有未解决缺陷'
                : '没有匹配的缺陷'
            }
          />
        )}
      </div>

      <p className="workbench-sidebar-footnote">
        数据来自 Meegle 我参与的缺陷
        {data ? ` · 同步于 ${formatFetchedAt(data.fetchedAt)}` : ''}
      </p>
    </aside>
  )
}
