import { Alert, Empty, Input, Modal, Select, Spin } from 'antd'
import type { DefectTransition, DefectTransitions } from '../../../../types/defects'
import { getStatusTone } from '../../pages/DefectWorkbench/defect-utils'
import '../RequirementInfoSection/RequirementInfoSection.css'
import DefectStatusTag from '../DefectStatusTag/DefectStatusTag'
import './DefectTransitionModal.css'

interface DefectTransitionModalProps {
  open: boolean
  loading: boolean
  error: string | null
  submitting: boolean
  transitions: DefectTransitions | null
  selectedTransition: DefectTransition | null
  selectedTransitionId: string | undefined
  transitionValues: Record<string, string | string[]>
  missingTransitionRoles: string[]
  onClose: () => void
  onSelectTransition: (transitionId?: string) => void
  onTransitionValueChange: (fieldKey: string, value: string | string[]) => void
  onSubmit: () => void
}

/**
 * 缺陷状态流转弹窗。
 */
export default function DefectTransitionModal({
  open,
  loading,
  error,
  submitting,
  transitions,
  selectedTransition,
  selectedTransitionId,
  transitionValues,
  missingTransitionRoles,
  onClose,
  onSelectTransition,
  onTransitionValueChange,
  onSubmit
}: DefectTransitionModalProps): JSX.Element {
  return (
    <Modal
      title="处理缺陷"
      open={open}
      width={620}
      okText="确认流转"
      cancelText="取消"
      okButtonProps={{
        disabled: !selectedTransition || missingTransitionRoles.length > 0
      }}
      confirmLoading={submitting}
      onOk={() => onSubmit()}
      onCancel={() => {
        if (!submitting) onClose()
      }}
    >
      <div className="defect-transition-form">
        {loading ? (
          <div className="defect-transition-loading">
            <Spin />
          </div>
        ) : error ? (
          <Alert type="error" showIcon message={error} />
        ) : transitions ? (
          <>
            <div className="defect-transition-current">
              <span>当前状态</span>
              <DefectStatusTag
                value={transitions.currentStateName}
                tone={getStatusTone(transitions.currentStateName)}
              />
            </div>
            {transitions.transitions.length > 0 ? (
              <>
                {selectedTransition?.requiredRoles.length ? (
                  <div className="defect-transition-roles">
                    <div className="defect-transition-role-values">
                      <span className="defect-transition-role-label">需要角色</span>
                      {selectedTransition.requiredRoles.map((role) => (
                        <span
                          key={role.key}
                          className="requirement-info-tag is-blue"
                        >
                          {role.name}
                        </span>
                      ))}
                    </div>
                    {missingTransitionRoles.length > 0 ? (
                      <p className="defect-transition-role-warning">
                        当前缺陷缺少：
                        {missingTransitionRoles.join('、')}
                        ，请先在飞书补齐后再流转
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <label>
                  <span>目标状态</span>
                  <Select
                    value={selectedTransitionId}
                    options={transitions.transitions.map((transition) => ({
                      value: transition.id,
                      label: transition.stateName
                    }))}
                    placeholder="请选择目标状态"
                    onChange={(value?: string) => onSelectTransition(value)}
                  />
                </label>
                {selectedTransition?.fields.map((field) => (
                  <label key={field.key}>
                    <span>{field.name}</span>
                    {field.type === 'tree-multi-select' ||
                    field.type === 'multi-select' ? (
                      <Select
                        mode="multiple"
                        value={
                          Array.isArray(transitionValues[field.key])
                            ? (transitionValues[field.key] as string[])
                            : []
                        }
                        options={field.options}
                        placeholder="请选择"
                        onChange={(value: string[]) =>
                          onTransitionValueChange(field.key, value)
                        }
                      />
                    ) : field.type === 'select' ? (
                      <Select
                        value={
                          typeof transitionValues[field.key] === 'string'
                            ? (transitionValues[field.key] as string)
                            : undefined
                        }
                        options={field.options}
                        placeholder="请选择"
                        onChange={(value?: string) =>
                          onTransitionValueChange(field.key, value ?? '')
                        }
                      />
                    ) : (
                      <Input.TextArea
                        rows={3}
                        value={
                          typeof transitionValues[field.key] === 'string'
                            ? (transitionValues[field.key] as string)
                            : ''
                        }
                        placeholder={`请输入${field.name}`}
                        onChange={(event) =>
                          onTransitionValueChange(field.key, event.target.value)
                        }
                      />
                    )}
                  </label>
                ))}
                {selectedTransition?.fields.length === 0 ? (
                  <p className="defect-transition-hint">
                    该状态不需要额外填写字段，确认后会直接流转。
                  </p>
                ) : null}
              </>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="当前状态没有可流转的目标状态"
              />
            )}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
