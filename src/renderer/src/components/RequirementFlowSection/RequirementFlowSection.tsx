import type { RefObject } from 'react'
import type { Dayjs } from 'dayjs'
import { Alert, Avatar, Button, DatePicker, Empty, Input, InputNumber, Modal, Select, Skeleton, Typography } from 'antd'
import {
  CheckCircleFilled,
  CheckOutlined,
  ClockCircleFilled,
  EditOutlined,
  ExportOutlined,
  MinusCircleOutlined,
  RollbackOutlined,
  WarningFilled
} from '@ant-design/icons'
import type {
  MeegleRequirementActivity,
  MeegleRequirementOwner,
  MeegleWorkflowNode
} from '../../../../types/requirements'
import type { ScheduleConflict } from '../../../../utils/schedule-conflicts'
import {
  formatActualWorkTime,
  formatNodeRange,
  formatRemainingWorkTime,
  formatScheduleDate,
  formatWorkTime,
  getNodeStatusLabel,
  getNodeTone
} from '../../pages/RequirementWorkbench/workbench-utils'
import RequirementFlowchart from '../RequirementFlowchart/RequirementFlowchart'
import './RequirementFlowSection.css'

interface RequirementFlowSectionProps {
  activity: MeegleRequirementActivity | null
  activityLoading: boolean
  activityError: string | null
  requirementUrl: string | null
  selectedNodeKey: string | null
  selectedNode: MeegleWorkflowNode | null
  nodeDetailRef: RefObject<HTMLDivElement>
  selectedNodeScheduleConflicts: ScheduleConflict[]
  nodeEditing: boolean
  nodeEditSubmitting: boolean
  completeSubmitting: boolean
  completeOpen: boolean
  completeActualWorkTime: number | null
  rollbackOpen: boolean
  rollbackSubmitting: boolean
  rollbackReason: string
  nodeEditOwnerKeys: string[]
  nodeOwnerOptions: MeegleRequirementOwner[]
  nodeOwnerSearching: boolean
  nodeEditPoints: number | null
  nodeEditRange: [Dayjs, Dayjs] | null
  nodeEditActualWorkTime: number | null
  nodeRemainingWorkTime: number | null
  onRetryActivity: () => void
  onSelectNode: (nodeKey: string) => void
  onCancelNodeEditing: () => void
  onSaveNodeInfo: () => void
  onOpenNodeEditor: () => void
  onCompleteNode: (actualWorkTime?: number) => void
  onOpenComplete: (defaultActualWorkTime: number | null) => void
  onOpenRollback: () => void
  onOwnerKeysChange: (keys: string[]) => void
  onOwnerSearch: (keyword: string) => void
  onPointsChange: (value: number | null) => void
  onRangeChange: (value: [Dayjs, Dayjs] | null) => void
  onActualWorkTimeChange: (value: number | null) => void
  onCompleteActualWorkTimeChange: (value: number | null) => void
  onCloseComplete: () => void
  onSubmitComplete: () => void
  onRollbackReasonChange: (value: string) => void
  onCloseRollback: () => void
  onSubmitRollback: () => void
}

/**
 * 需求详情中的流程节点、节点详情以及完成/回滚弹窗。
 */
export default function RequirementFlowSection({
  activity,
  activityLoading,
  activityError,
  requirementUrl,
  selectedNodeKey,
  selectedNode,
  nodeDetailRef,
  selectedNodeScheduleConflicts,
  nodeEditing,
  nodeEditSubmitting,
  completeSubmitting,
  completeOpen,
  completeActualWorkTime,
  rollbackOpen,
  rollbackSubmitting,
  rollbackReason,
  nodeEditOwnerKeys,
  nodeOwnerOptions,
  nodeOwnerSearching,
  nodeEditPoints,
  nodeEditRange,
  nodeEditActualWorkTime,
  nodeRemainingWorkTime,
  onRetryActivity,
  onSelectNode,
  onCancelNodeEditing,
  onSaveNodeInfo,
  onOpenNodeEditor,
  onCompleteNode,
  onOpenComplete,
  onOpenRollback,
  onOwnerKeysChange,
  onOwnerSearch,
  onPointsChange,
  onRangeChange,
  onActualWorkTimeChange,
  onCompleteActualWorkTimeChange,
  onCloseComplete,
  onSubmitComplete,
  onRollbackReasonChange,
  onCloseRollback,
  onSubmitRollback
}: RequirementFlowSectionProps): JSX.Element {
  return (
    <>
      <section className="requirement-flow-section">
        <div className="requirement-section-heading">
          <h2>流程节点</h2>
          {requirementUrl ? (
            <Typography.Link
              className="requirement-info-feishu-link"
              href={requirementUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExportOutlined />
              在飞书中编辑
            </Typography.Link>
          ) : null}
        </div>
        {activityError ? (
          <Alert
            type="error"
            showIcon
            message="流程节点加载失败"
            description={activityError}
            action={
              <Button size="small" onClick={onRetryActivity}>
                重试
              </Button>
            }
          />
        ) : activityLoading && !activity ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : activity && activity.nodes.length > 0 ? (
          <>
            <RequirementFlowchart
              nodes={activity.nodes}
              selectedNodeKey={selectedNodeKey}
              onSelectNode={onSelectNode}
            />

            {selectedNode ? (
              <div className="requirement-node-detail" ref={nodeDetailRef}>
                <div className="requirement-node-detail-head">
                  <span className="requirement-node-detail-title">
                    <span
                      className={`requirement-node-detail-dot is-${getNodeTone(
                        selectedNode.status
                      )}`}
                    />
                    <strong>{selectedNode.name}</strong>
                    <span
                      className={`requirement-node-status-tag is-${getNodeTone(
                        selectedNode.status
                      )}`}
                    >
                      {getNodeStatusLabel(selectedNode.status)}
                    </span>
                  </span>
                  {nodeEditing ? (
                    <span className="requirement-node-edit-actions">
                      <Button size="small" onClick={onCancelNodeEditing}>
                        取消
                      </Button>
                      <Button
                        type="primary"
                        size="small"
                        loading={nodeEditSubmitting}
                        onClick={() => onSaveNodeInfo()}
                      >
                        保存
                      </Button>
                    </span>
                  ) : (
                    <span className="requirement-node-head-actions">
                      {selectedNode.status === 'doing' ? (
                        <Button
                          type="text"
                          size="small"
                          className="requirement-node-complete-button"
                          icon={<CheckOutlined />}
                          loading={completeSubmitting}
                          onClick={() => {
                            if (
                              selectedNode.supportsActualWorkTime &&
                              selectedNode.actualWorkTime !== null &&
                              selectedNode.actualWorkTime > 0
                            ) {
                              void onCompleteNode(selectedNode.actualWorkTime)
                              return
                            }

                            onOpenComplete(
                              selectedNode.supportsActualWorkTime
                                ? selectedNode.actualWorkTime ??
                                    selectedNode.points ??
                                    null
                                : null
                            )
                          }}
                        >
                          完成
                        </Button>
                      ) : null}
                      {selectedNode.status === 'finished' ||
                      selectedNode.status === 'done' ? (
                        <Button
                          type="text"
                          danger
                          size="small"
                          className="requirement-node-rollback-button"
                          icon={<RollbackOutlined />}
                          onClick={onOpenRollback}
                        >
                          回滚
                        </Button>
                      ) : null}
                      <Button
                        type="text"
                        size="small"
                        className="requirement-node-edit-button"
                        icon={<EditOutlined />}
                        onClick={onOpenNodeEditor}
                      >
                        编辑
                      </Button>
                    </span>
                  )}
                </div>

                {selectedNodeScheduleConflicts.length > 0 ? (
                  <div className="requirement-node-schedule-warning" role="alert">
                    <WarningFilled />
                    <div>
                      <strong>排期顺序异常</strong>
                      {selectedNodeScheduleConflicts.map((conflict) => (
                        <span key={`${conflict.fromKey}-${conflict.toKey}`}>
                          {conflict.fromKey === selectedNode.key
                            ? `后续节点「${conflict.toName}」的排期结束（${formatScheduleDate(conflict.toDate)}）早于本节点开始（${formatScheduleDate(conflict.fromDate)}）`
                            : `本节点排期结束（${formatScheduleDate(conflict.toDate)}）早于前置节点「${conflict.fromName}」的开始（${formatScheduleDate(conflict.fromDate)}）`}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div
                  className={`requirement-node-summary-card${
                    nodeEditing ? ' is-editing' : ''
                  }`}
                >
                  <div className="requirement-node-summary-block is-owner">
                    <span className="requirement-node-summary-label">负责人</span>
                    {nodeEditing ? (
                      <Select
                        mode="multiple"
                        showSearch
                        allowClear
                        maxTagCount="responsive"
                        className="requirement-node-owner-select"
                        placeholder="搜索姓名片段或邮箱"
                        value={nodeEditOwnerKeys}
                        options={nodeOwnerOptions.flatMap((owner) =>
                          owner.userKey
                            ? [{ value: owner.userKey, label: owner.name }]
                            : []
                        )}
                        loading={nodeOwnerSearching}
                        filterOption={false}
                        notFoundContent={nodeOwnerSearching ? '搜索中...' : '未找到用户'}
                        optionRender={(option) => {
                          const owner = nodeOwnerOptions.find(
                            (item) => item.userKey === String(option.value)
                          )

                          if (!owner) return option.label

                          return (
                            <span className="requirement-node-owner-option">
                              <Avatar size={24} src={owner.avatarUrl ?? undefined}>
                                {owner.name.slice(0, 1)}
                              </Avatar>
                              <span className="requirement-node-owner-option-copy">
                                <span className="requirement-node-owner-option-name">
                                  {owner.name}
                                </span>
                                {owner.email ? (
                                  <span className="requirement-node-owner-option-email">
                                    {owner.email}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          )
                        }}
                        labelRender={(props) => {
                          const owner = nodeOwnerOptions.find(
                            (item) => item.userKey === String(props.value)
                          )

                          if (!owner) return props.label

                          return (
                            <span className="requirement-node-owner-tag-label">
                              <Avatar size={16} src={owner.avatarUrl ?? undefined}>
                                {owner.name.slice(0, 1)}
                              </Avatar>
                              <span>{owner.name}</span>
                            </span>
                          )
                        }}
                        onChange={(value: string[]) => onOwnerKeysChange(value)}
                        onSearch={onOwnerSearch}
                      />
                    ) : (
                      <div className="requirement-node-owner-list">
                        {selectedNode.owners.length > 0 ? (
                          selectedNode.owners.map((owner, index) => (
                            <span
                              className="requirement-node-owner"
                              key={`${owner.email ?? owner.name}-${index}`}
                            >
                              <Avatar size={20} src={owner.avatarUrl ?? undefined}>
                                {owner.name.slice(0, 1)}
                              </Avatar>
                              {owner.name}
                            </span>
                          ))
                        ) : (
                          <span className="requirement-node-summary-empty">
                            未分配
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="requirement-node-summary-block">
                    <span className="requirement-node-summary-label">
                      总估分 {selectedNode.supportsPoints ? <em>*</em> : null}
                    </span>
                    {selectedNode.supportsPoints ? (
                      nodeEditing ? (
                        <InputNumber
                          min={0}
                          step={0.1}
                          className="requirement-node-inline-input"
                          value={nodeEditPoints}
                          placeholder="未设置"
                          onChange={(value) =>
                            onPointsChange(typeof value === 'number' ? value : null)
                          }
                        />
                      ) : (
                        <strong>{formatWorkTime(selectedNode.points)}</strong>
                      )
                    ) : (
                      <strong className="requirement-node-summary-na">不适用</strong>
                    )}
                  </div>

                  <div className="requirement-node-summary-block">
                    <span className="requirement-node-summary-label">
                      总排期 {selectedNode.supportsSchedule ? <em>*</em> : null}
                    </span>
                    {selectedNode.supportsSchedule ? (
                      nodeEditing ? (
                        <DatePicker.RangePicker
                          format="MM-DD"
                          className="requirement-node-inline-range"
                          value={nodeEditRange}
                          onChange={(value) =>
                            onRangeChange(value as [Dayjs, Dayjs] | null)
                          }
                        />
                      ) : (
                        <strong>
                          {formatNodeRange(
                            selectedNode.scheduleStart,
                            selectedNode.scheduleEnd
                          )}
                        </strong>
                      )
                    ) : (
                      <strong className="requirement-node-summary-na">不适用</strong>
                    )}
                  </div>

                  {nodeEditing ? null : (
                    <div
                      className={`requirement-node-summary-status is-${getNodeTone(
                        selectedNode.status
                      )}`}
                    >
                      {selectedNode.status === 'finished' ||
                      selectedNode.status === 'done' ? (
                        <CheckCircleFilled />
                      ) : selectedNode.status === 'doing' ? (
                        <ClockCircleFilled />
                      ) : (
                        <MinusCircleOutlined />
                      )}
                      <span>{getNodeStatusLabel(selectedNode.status)}</span>
                    </div>
                  )}
                </div>

                {selectedNode.supportsPoints ||
                selectedNode.supportsActualWorkTime ? (
                  <details className="requirement-node-section" open>
                    <summary>工时</summary>
                    <div className="requirement-node-workhour">
                      {selectedNode.supportsActualWorkTime ? (
                        <div className="requirement-node-workhour-row">
                          <span>
                            总实际工时 <em>*</em>
                          </span>
                          {nodeEditing ? (
                            <InputNumber
                              min={0}
                              step={0.1}
                              className="requirement-node-workhour-input"
                              addonAfter="人天"
                              value={nodeEditActualWorkTime}
                              placeholder="待填"
                              onChange={(value) =>
                                onActualWorkTimeChange(
                                  typeof value === 'number' ? value : null
                                )
                              }
                            />
                          ) : (
                            <strong>
                              {formatActualWorkTime(selectedNode.actualWorkTime)}
                            </strong>
                          )}
                        </div>
                      ) : null}
                      {selectedNode.supportsPoints ? (
                        <div className="requirement-node-workhour-summary">
                          <span>总估分：{formatWorkTime(selectedNode.points)}</span>
                          <span>
                            总剩余工时：
                            {formatRemainingWorkTime(nodeRemainingWorkTime)}
                          </span>
                        </div>
                      ) : null}
                      {selectedNode.supportsActualWorkTime ? (
                        <div className="requirement-node-workhour-note">
                          如需要详细的填写，到飞书详情页去写
                        </div>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}
        </>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无流程节点信息"
        />
      )}
    </section>

    <Modal
      title={
        <span className="requirement-complete-title">
          <CheckCircleFilled />
          完成节点
        </span>
      }
      width={480}
      open={completeOpen}
      okText="完成节点"
      cancelText="取消"
      confirmLoading={completeSubmitting}
      okButtonProps={{
        disabled:
          Boolean(selectedNode?.supportsActualWorkTime) &&
          (completeActualWorkTime === null ||
            !Number.isFinite(completeActualWorkTime) ||
            completeActualWorkTime <= 0)
      }}
      destroyOnHidden
      onOk={onSubmitComplete}
      onCancel={onCloseComplete}
    >
      <div className="requirement-complete-form">
        <div className="requirement-complete-node">
          <div className="requirement-complete-node-copy">
            <span>当前节点</span>
            <strong>{selectedNode?.name ?? ''}</strong>
          </div>
          {selectedNode ? (
            <span
              className={`requirement-node-status-tag is-${getNodeTone(
                selectedNode.status
              )}`}
            >
              {getNodeStatusLabel(selectedNode.status)}
            </span>
          ) : null}
        </div>

        <p className="requirement-complete-desc">
          完成后会推进需求流程，并按飞书项目规则通知相关人。
        </p>

        {selectedNode?.supportsActualWorkTime ? (
          <div className="requirement-complete-worktime">
            <div className="requirement-complete-worktime-head">
              <ClockCircleFilled />
              <span>工时确认</span>
            </div>
            <div className="requirement-complete-worktime-row">
              <div className="requirement-complete-field">
                <span>总估分</span>
                <strong>{formatWorkTime(selectedNode.points)}</strong>
              </div>
              <div className="requirement-complete-field">
                <label>
                  实际工时 <em>*</em>
                </label>
                <InputNumber
                  min={0}
                  step={0.5}
                  precision={2}
                  value={completeActualWorkTime}
                  placeholder="请填写实际工时"
                  addonAfter="人天"
                  onChange={onCompleteActualWorkTimeChange}
                />
              </div>
            </div>
            <p className="requirement-complete-hint">
              飞书要求完成前填写实际工时，系统会先更新工时，再完成节点。
            </p>
          </div>
        ) : null}
      </div>
    </Modal>

    <Modal
      title={
        <span className="requirement-rollback-title">
          <WarningFilled style={{ color: '#faad14', marginRight: 8 }} />
          确认回滚该节点么？
        </span>
      }
      open={rollbackOpen}
      okText="回滚"
      cancelText="取消"
      okButtonProps={{ danger: true, disabled: !rollbackReason.trim() }}
      confirmLoading={rollbackSubmitting}
      destroyOnHidden
      onOk={onSubmitRollback}
      onCancel={onCloseRollback}
    >
      <div className="requirement-rollback-form">
        <p>回滚后，节点状态整体重新计算</p>
        <Input.TextArea
          rows={5}
          maxLength={140}
          showCount
          value={rollbackReason}
          placeholder="请填写节点回滚原因"
          onChange={(event) => onRollbackReasonChange(event.target.value)}
        />
      </div>
    </Modal>
    </>
  )
}
