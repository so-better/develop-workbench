import dayjs from 'dayjs'
import { Avatar, Button, Popconfirm, Tag } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import type { MeegleRequirement } from '../../../../types/requirements'
import MarkdownContent from '../MarkdownContent/MarkdownContent'
import {
  cleanMarkdownContent,
  getPriorityTone,
  getStatusTone
} from '../../pages/RequirementWorkbench/workbench-utils'
import './LocalRequirementDetail.css'

interface LocalRequirementDetailProps {
  requirement: MeegleRequirement
  deleting: boolean
  onEdit: () => void
  onDelete: () => void | Promise<void>
}

/**
 * 本地临时需求的详情卡片。
 */
export default function LocalRequirementDetail({
  requirement,
  deleting,
  onEdit,
  onDelete
}: LocalRequirementDetailProps): JSX.Element {
  return (
    <section className="requirement-info-section local-requirement-section">
      <div className="requirement-section-heading">
        <h2>需求信息</h2>
        <div className="local-requirement-actions">
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            disabled={deleting}
            onClick={onEdit}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除临时需求？"
            description="删除后无法恢复，代码仓库绑定也会一并解除。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDelete()}
          >
            <Button
              type="primary"
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={deleting}
            >
              删除
            </Button>
          </Popconfirm>
        </div>
      </div>

      <div className="requirement-info-description">
        <div className="requirement-info-description-head">
          <h3>需求描述</h3>
        </div>
        <div className="requirement-description-box">
          <MarkdownContent
            content={
              cleanMarkdownContent(requirement.description ?? '') ||
              '暂无需求描述'
            }
            className="requirement-description-markdown"
          />
        </div>
      </div>

      <dl className="requirement-info-grid local-requirement-grid">
        <div>
          <dt>所属版本</dt>
          <dd>{requirement.iterationName ?? '未规划版本'}</dd>
        </div>
        <div>
          <dt>产线</dt>
          <dd>
            {requirement.productLines.length > 0
              ? requirement.productLines.join(' / ')
              : '未设置'}
          </dd>
        </div>
        <div>
          <dt>产品</dt>
          <dd>
            {requirement.productManagers[0] ? (
              <span className="local-requirement-product">
                <Avatar
                  size={20}
                  src={requirement.productManagers[0].avatarUrl ?? undefined}
                >
                  {requirement.productManagers[0].name.slice(0, 1)}
                </Avatar>
                <span>{requirement.productManagers[0].name}</span>
              </span>
            ) : (
              '未设置'
            )}
          </dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>
            <Tag
              className={`local-requirement-status is-${getStatusTone(
                requirement.status
              )}`}
              bordered={false}
            >
              <span
                className={`requirement-status-dot is-${getStatusTone(
                  requirement.status
                )}`}
              />
              {requirement.status ?? '待处理'}
            </Tag>
          </dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>
            {requirement.priority ? (
              <Tag
                className={`requirement-header-tag is-${getPriorityTone(
                  requirement.priority
                )}`}
              >
                {requirement.priority}
              </Tag>
            ) : (
              '未设置'
            )}
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{dayjs(requirement.proposedAt).format('YYYY-MM-DD HH:mm')}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{dayjs(requirement.updatedAt).format('YYYY-MM-DD HH:mm')}</dd>
        </div>
      </dl>
    </section>
  )
}
