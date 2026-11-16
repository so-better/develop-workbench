import {
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  ReloadOutlined,
  TagOutlined
} from '@ant-design/icons'
import { Button, Input, Tag, Tooltip } from 'antd'
import type { MeegleRequirement } from '../../../../types/requirements'
import type { RequirementPersonalStatus } from '../../../../types/requirement-status'
import {
  formatUpdatedAt,
  getPriorityTone,
  getStatusTone
} from '../../pages/RequirementWorkbench/workbench-utils'
import RobotMark from '../RobotMark/RobotMark'
import './RequirementHeader.css'

interface RequirementHeaderProps {
  projectName: string
  versionName: string | null
  requirement: MeegleRequirement
  requirementUrl: string | null
  isLocal: boolean
  loading: boolean
  activityLoading: boolean
  personalStatus: RequirementPersonalStatus | null
  personalStatusLoading: boolean
  personalStatusEditing: boolean
  personalStatusDraft: string
  onRefresh: () => void
  onCopyName: () => void
  onCopyUrl: () => void
  onPersonalStatusDraftChange: (value: string) => void
  onStartPersonalStatusEdit: () => void
  onCancelPersonalStatusEdit: () => void
  onSavePersonalStatus: () => void
  onAnalyze: () => void
}

/**
 * 需求详情头部：标题、状态、个人标记和快捷操作。
 */
export default function RequirementHeader({
  projectName,
  versionName,
  requirement,
  requirementUrl,
  isLocal,
  loading,
  activityLoading,
  personalStatus,
  personalStatusLoading,
  personalStatusEditing,
  personalStatusDraft,
  onRefresh,
  onCopyName,
  onCopyUrl,
  onPersonalStatusDraftChange,
  onStartPersonalStatusEdit,
  onCancelPersonalStatusEdit,
  onSavePersonalStatus,
  onAnalyze
}: RequirementHeaderProps): JSX.Element {
  return (
    <header className="workbench-header">
      <div className="workbench-heading">
        <span className="workbench-eyebrow">
          {projectName} / {versionName ?? '我负责的需求'}
        </span>
        <div className="workbench-title-row">
          <Tooltip title="刷新数据">
            <Button
              type="text"
              size="small"
              className="workbench-refresh-icon"
              icon={<ReloadOutlined />}
              loading={loading || activityLoading}
              aria-label="刷新数据"
              onClick={() => onRefresh()}
            />
          </Tooltip>
          <div className="workbench-title-content">
            <h1>{requirement.name}</h1>
            <span className="workbench-title-copy-actions">
              <Tooltip title="复制标题">
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  aria-label="复制需求名称"
                  onClick={() => onCopyName()}
                />
              </Tooltip>
              {requirementUrl ? (
                <Tooltip title="复制链接">
                  <Button
                    type="text"
                    size="small"
                    icon={<LinkOutlined />}
                    aria-label="复制需求链接"
                    onClick={() => onCopyUrl()}
                  />
                </Tooltip>
              ) : null}
            </span>
          </div>
        </div>
        <div className="workbench-heading-meta">
          <Tag
            className={`requirement-header-tag is-${getStatusTone(requirement.status)}`}
          >
            <span
              className={`requirement-status-dot is-${getStatusTone(
                requirement.status
              )}`}
            />
            {requirement.status ?? '状态未知'}
          </Tag>
          {requirement.priority ? (
            <Tag
              className={`requirement-header-tag is-${getPriorityTone(
                requirement.priority
              )}`}
            >
              {requirement.priority}
            </Tag>
          ) : null}
          {isLocal ? (
            <Tag className="local-requirement-tag" bordered={false}>
              临时
            </Tag>
          ) : null}
          <span className="workbench-updated-at">
            {formatUpdatedAt(requirement.updatedAt)}
          </span>
          {!isLocal ? (
            <div className="workbench-personal-status">
              <span className="workbench-personal-status-icon">
                <TagOutlined />
              </span>
              <div className="workbench-personal-status-body">
                {personalStatusLoading ? (
                  <span className="workbench-personal-status-value is-placeholder">
                    读取中...
                  </span>
                ) : personalStatusEditing ? (
                  <Input
                    className="workbench-personal-status-input"
                    variant="borderless"
                    size="small"
                    autoFocus
                    maxLength={120}
                    value={personalStatusDraft}
                    placeholder="标记当前进展"
                    aria-label="个人标记"
                    onChange={(event) => onPersonalStatusDraftChange(event.target.value)}
                    onBlur={() => onSavePersonalStatus()}
                    onPressEnter={(event) => {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        onCancelPersonalStatusEdit()
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={`workbench-personal-status-value${
                      personalStatus?.value ? '' : ' is-placeholder'
                    }`}
                    onClick={onStartPersonalStatusEdit}
                  >
                    {personalStatus?.value || '添加个人标记'}
                  </button>
                )}
              </div>
              {!personalStatusEditing && !personalStatusLoading ? (
                <Tooltip title="编辑个人标记">
                  <Button
                    type="text"
                    size="small"
                    className="workbench-personal-status-edit"
                    icon={<EditOutlined />}
                    aria-label="编辑个人标记"
                    onClick={onStartPersonalStatusEdit}
                  />
                </Tooltip>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="workbench-header-actions">
          <div className="workbench-scope-note">
            <span className="workbench-scope-note-icon">
              <InfoCircleOutlined />
            </span>
            <div className="workbench-scope-note-copy">
              <strong>{isLocal ? '本地临时需求' : '研发执行视图'}</strong>
              <span>
                {isLocal
                  ? '仅保存在本机，不会同步到 Meegle。'
                  : '完整字段、附件、审批和复杂流程请前往飞书处理。'}
              </span>
            </div>
            <div className="workbench-scope-note-actions">
              {requirementUrl ? (
                <Button
                  type="primary"
                  icon={<ExportOutlined />}
                  onClick={() => window.electron.openEmbeddedBrowser(requirementUrl)}
                >
                  在飞书中处理
                </Button>
              ) : null}
              <Button
                type="primary"
                ghost
                icon={<RobotMark />}
                onClick={onAnalyze}
              >
                AI 分析
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
