import { Avatar, Tag, Tooltip } from 'antd'
import { CheckCircleFilled, WarningFilled } from '@ant-design/icons'
import type {
  MeegleRequirement,
  MeegleRequirementNodeCompletion
} from '../../../../types/requirements'
import {
  formatRequirementType,
  formatUpdatedAt,
  getPriorityTone,
  getStatusTone
} from '../../pages/RequirementWorkbench/workbench-utils'
import './RequirementListItem.css'

interface RequirementListItemProps {
  requirement: MeegleRequirement
  groupKey: string
  selected: boolean
  nodeCompletion?: MeegleRequirementNodeCompletion
  onSelect: (requirementId: string, groupKey: string) => void
}

/**
 * 左侧单条需求。
 */
export default function RequirementListItem({
  requirement,
  groupKey,
  selected,
  nodeCompletion,
  onSelect
}: RequirementListItemProps): JSX.Element {
  const isMyNodeDone = nodeCompletion?.completed === true
  const scheduleConflictCount = nodeCompletion?.scheduleConflictCount ?? 0
  const scheduleConflictTitle = `流程节点排期异常 ${scheduleConflictCount} 处，打开需求查看`

  return (
    <button
      id={`workbench-requirement-${groupKey}-${requirement.id}`}
      type="button"
      className={`workbench-requirement-item${selected ? ' is-active' : ''}${
        isMyNodeDone ? ' is-my-node-done' : ''
      }`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(requirement.id, groupKey)}
    >
      <span className="workbench-requirement-item-title-row">
        {requirement.priority === 'P0' ||
        requirement.priority === 'P1' ||
        requirement.priority === 'P2' ? (
          <span
            className={`requirement-priority is-${getPriorityTone(requirement.priority)}`}
          >
            {requirement.priority}
          </span>
        ) : null}
        {scheduleConflictCount > 0 ? (
          <Tooltip title={scheduleConflictTitle}>
            <span
              className="workbench-requirement-item-conflict-icon"
              role="img"
              aria-label="流程节点排期异常"
            >
              <WarningFilled />
            </span>
          </Tooltip>
        ) : null}
        <span className="workbench-requirement-item-name" title={requirement.name}>
          {requirement.name}
        </span>
        {isMyNodeDone ? (
          <Tooltip
            title={`我负责的节点已完成：${nodeCompletion.doneNodeNames.join('、')}`}
          >
            <span
              className="workbench-requirement-item-done-check"
              aria-label="我已完成"
            >
              <CheckCircleFilled />
            </span>
          </Tooltip>
        ) : null}
      </span>
      <span className="workbench-requirement-item-top">
        <span className="workbench-requirement-item-state">
          <span
            className={`requirement-status-dot is-${getStatusTone(requirement.status)}`}
          />
          <span className="workbench-requirement-item-status">
            {requirement.status ?? '状态未知'}
          </span>
        </span>
        {(() => {
          const productContact =
            requirement.productManagers.length > 0
              ? { label: '产品经理', members: requirement.productManagers }
              : requirement.productOwners.length > 0
                ? { label: '产品负责人', members: requirement.productOwners }
                : null

          if (!productContact) {
            return null
          }

          return (
            <Tooltip
              title={`${productContact.label}：${productContact.members
                .map((member) => member.name)
                .join('、')}`}
            >
              <span className="workbench-requirement-item-owner">
                <Avatar
                  size={20}
                  src={productContact.members[0].avatarUrl ?? undefined}
                  className="workbench-requirement-contact-avatar"
                >
                  {productContact.members[0].name.slice(0, 1)}
                </Avatar>
                <span className="workbench-requirement-item-owner-text">
                  {productContact.label} · {productContact.members[0].name}
                </span>
                {productContact.members.length > 1 ? (
                  <span className="workbench-requirement-item-owner-extra">
                    等 {productContact.members.length} 人
                  </span>
                ) : null}
              </span>
            </Tooltip>
          )
        })()}
      </span>
      <span className="workbench-requirement-item-footer">
        <span className="workbench-requirement-item-tags">
          {scheduleConflictCount > 0 ? (
            <Tooltip title={scheduleConflictTitle}>
              <span
                className="workbench-requirement-item-conflict"
                aria-label="流程节点排期异常"
              >
                <WarningFilled />
                排期异常
              </span>
            </Tooltip>
          ) : null}
          {isMyNodeDone ? (
            <Tooltip
              title={`我负责的节点已完成：${nodeCompletion.doneNodeNames.join('、')}`}
            >
              <span className="workbench-requirement-item-done-flag">
                <CheckCircleFilled />
                我已完成
              </span>
            </Tooltip>
          ) : null}
          {requirement.source === 'local' ? (
            <Tag className="local-requirement-tag" bordered={false}>
              临时
            </Tag>
          ) : null}
          {requirement.source !== 'local' &&
          formatRequirementType(requirement.requirementType) ? (
            <span className="workbench-requirement-type">
              {formatRequirementType(requirement.requirementType)}
            </span>
          ) : null}
        </span>
        <span className="workbench-requirement-item-updated">
          {formatUpdatedAt(requirement.updatedAt)}
        </span>
      </span>
    </button>
  )
}
