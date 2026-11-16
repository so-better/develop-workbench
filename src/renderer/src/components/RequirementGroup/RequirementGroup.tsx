import { DownOutlined } from '@ant-design/icons'
import type {
  MeegleRequirementGroup,
  MeegleRequirementNodeCompletion
} from '../../../../types/requirements'
import { groupRequirementsByProductLine } from '../../pages/RequirementWorkbench/workbench-utils'
import RequirementListItem from '../RequirementListItem/RequirementListItem'
import './RequirementGroup.css'

interface RequirementGroupProps {
  group: MeegleRequirementGroup
  collapsedGroupKeys: Set<string>
  hasSearch: boolean
  selectedRequirementId: string | null
  nodeCompletions: Record<string, MeegleRequirementNodeCompletion>
  onSelectRequirement: (requirementId: string, groupKey: string) => void
  onToggleGroup: (groupKey: string) => void
}

/**
 * 左侧需求分组。
 * 搜索时忽略收起状态，确保匹配结果始终可见。
 */
export default function RequirementGroup({
  group,
  collapsedGroupKeys,
  hasSearch,
  selectedRequirementId,
  nodeCompletions,
  onSelectRequirement,
  onToggleGroup
}: RequirementGroupProps): JSX.Element {
  const collapsed = collapsedGroupKeys.has(group.key) && !hasSearch
  const productLineGroups = groupRequirementsByProductLine(group.requirements)

  return (
    <section className="workbench-requirement-group">
      <button
        type="button"
        className={`workbench-requirement-group-heading${collapsed ? ' is-collapsed' : ''}`}
        aria-expanded={!collapsed}
        onClick={() => onToggleGroup(group.key)}
      >
        <span className="workbench-requirement-group-title">
          <DownOutlined className="workbench-requirement-group-chevron" />
          <span className="workbench-requirement-group-name">{group.versionName}</span>
        </span>
        <span
          className="workbench-requirement-group-count"
          aria-label={`${group.requirements.length} 个需求`}
        >
          {group.requirements.length}
          <span className="workbench-requirement-group-count-unit">项</span>
        </span>
      </button>

      {collapsed ? null : productLineGroups.length <= 1 ? (
        <div className="workbench-requirement-group-list">
          {group.requirements.map((requirement) => (
            <RequirementListItem
              key={`${group.key}:${requirement.id}`}
              requirement={requirement}
              groupKey={group.key}
              selected={requirement.id === selectedRequirementId}
              nodeCompletion={nodeCompletions[requirement.id]}
              onSelect={onSelectRequirement}
            />
          ))}
        </div>
      ) : (
        <div className="workbench-requirement-group-list">
          {productLineGroups.map((productLineGroup) => {
            const productLineKey = `${group.key}:product-line:${productLineGroup.key}`
            const productLineCollapsed =
              collapsedGroupKeys.has(productLineKey) && !hasSearch

            return (
              <section className="workbench-requirement-subgroup" key={productLineKey}>
                <button
                  type="button"
                  className={`workbench-requirement-subgroup-heading${
                    productLineCollapsed ? ' is-collapsed' : ''
                  }`}
                  aria-expanded={!productLineCollapsed}
                  onClick={() => onToggleGroup(productLineKey)}
                >
                  <span className="workbench-requirement-subgroup-title">
                    <DownOutlined className="workbench-requirement-subgroup-chevron" />
                    <span className="workbench-requirement-subgroup-name">
                      {productLineGroup.label}
                    </span>
                  </span>
                  <span
                    className="workbench-requirement-subgroup-count"
                    aria-label={`${productLineGroup.requirements.length} 个需求`}
                  >
                    {productLineGroup.requirements.length}
                  </span>
                </button>

                {productLineCollapsed ? null : (
                  <div className="workbench-requirement-subgroup-list">
                    {productLineGroup.requirements.map((requirement) => (
                      <RequirementListItem
                        key={`${group.key}:${requirement.id}`}
                        requirement={requirement}
                        groupKey={group.key}
                        selected={requirement.id === selectedRequirementId}
                        nodeCompletion={nodeCompletions[requirement.id]}
                        onSelect={onSelectRequirement}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
