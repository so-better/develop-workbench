import type { ReactNode } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Empty,
  Skeleton,
  Tabs,
  Typography
} from 'antd'
import {
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  RightOutlined
} from '@ant-design/icons'
import type {
  MeegleRequirement,
  MeegleRequirementActivity,
  MeegleRequirementComment
} from '../../../../types/requirements'
import {
  cleanMarkdownContent,
  formatCommentContent
} from '../../pages/RequirementWorkbench/workbench-utils'
import MarkdownContent from '../MarkdownContent/MarkdownContent'
import MarkdownEditor from '../MarkdownEditor/MarkdownEditor'
import './RequirementInfoSection.css'

export interface BasicInfoField {
  label: string
  value: ReactNode
  wide?: boolean
  hideLabel?: boolean
}

export interface BasicInfoGroup {
  title: string
  fields: BasicInfoField[]
}

interface RequirementInfoSectionProps {
  requirement: MeegleRequirement
  requirementUrl: string | null
  primaryInfoGroups: BasicInfoGroup[]
  moreInfoGroups: BasicInfoGroup[]
  descriptionEditing: boolean
  descriptionSaving: boolean
  descriptionDraft: string
  descriptionExpanded: boolean
  moreFieldsOpen: boolean
  activity: MeegleRequirementActivity | null
  activityLoading: boolean
  activityError: string | null
  replyToComment: MeegleRequirementComment | null
  commentDraft: string
  commentSubmitting: boolean
  onDescriptionDraftChange: (value: string) => void
  onStartDescriptionEdit: () => void
  onCancelDescriptionEdit: () => void
  onSaveDescription: () => void
  onToggleDescriptionExpanded: () => void
  onToggleMoreFields: () => void
  onRetryActivity: () => void
  onStartReply: (comment: MeegleRequirementComment) => void
  onCancelReply: () => void
  onCommentDraftChange: (value: string) => void
  onAddComment: () => void
}

/**
 * 需求详情中的基本信息、飞书字段和评论。
 */
export default function RequirementInfoSection({
  requirement,
  requirementUrl,
  primaryInfoGroups,
  moreInfoGroups,
  descriptionEditing,
  descriptionSaving,
  descriptionDraft,
  descriptionExpanded,
  moreFieldsOpen,
  activity,
  activityLoading,
  activityError,
  replyToComment,
  commentDraft,
  commentSubmitting,
  onDescriptionDraftChange,
  onStartDescriptionEdit,
  onCancelDescriptionEdit,
  onSaveDescription,
  onToggleDescriptionExpanded,
  onToggleMoreFields,
  onRetryActivity,
  onStartReply,
  onCancelReply,
  onCommentDraftChange,
  onAddComment
}: RequirementInfoSectionProps): JSX.Element {
  const renderInfoGroups = (groups: BasicInfoGroup[]): JSX.Element => (
    <div className="requirement-info-groups">
      {groups.map((group) => (
        <section className="requirement-info-group" key={group.title}>
          <h4>{group.title}</h4>
          <dl className="requirement-info-grid">
            {group.fields.map((field) => (
              <div key={field.label} className={field.wide ? 'is-wide' : undefined}>
                {field.hideLabel ? null : <dt>{field.label}</dt>}
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )

  return (
    <section className="requirement-info-section">
      <Tabs
        className="requirement-info-tabs"
        defaultActiveKey="basic"
        items={[
          {
            key: 'basic',
            label: '基本信息',
            children: (
              <div className="requirement-info-tab">
                <div className="requirement-info-description">
                  <div className="requirement-info-description-head">
                    <h3>需求描述</h3>
                    {descriptionEditing ? (
                      <span className="requirement-info-description-actions">
                        <Button size="small" onClick={onCancelDescriptionEdit}>
                          取消
                        </Button>
                        <Button
                          type="primary"
                          size="small"
                          loading={descriptionSaving}
                          onClick={() => onSaveDescription()}
                        >
                          保存
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="text"
                        size="small"
                        className="requirement-info-description-edit"
                        icon={<EditOutlined />}
                        onClick={onStartDescriptionEdit}
                      >
                        编辑
                      </Button>
                    )}
                  </div>
                  {descriptionEditing ? (
                    <>
                      <MarkdownEditor
                        className="requirement-description-editor"
                        rows={10}
                        value={descriptionDraft}
                        placeholder="支持 Markdown，可插入标题、列表、链接等"
                        onChange={onDescriptionDraftChange}
                      />
                      <p className="requirement-description-edit-hint">
                        保存后会直接同步到飞书项目。
                      </p>
                    </>
                  ) : (
                    (() => {
                      const description =
                        cleanMarkdownContent(requirement.description ?? '') ||
                        '暂无需求描述'
                      const collapsed =
                        !descriptionExpanded &&
                        (description.length > 420 ||
                          description.split('\n').length > 12)

                      return (
                        <>
                          <div
                            className={`requirement-description-box${
                              collapsed ? ' is-collapsed' : ''
                            }`}
                          >
                            <MarkdownContent
                              content={description}
                              className="requirement-description-markdown"
                            />
                          </div>
                          {description.length > 420 ||
                          description.split('\n').length > 12 ? (
                            <Button
                              type="link"
                              size="small"
                              className="requirement-description-toggle"
                              onClick={onToggleDescriptionExpanded}
                            >
                              {descriptionExpanded ? '收起' : '展开'}
                            </Button>
                          ) : null}
                        </>
                      )
                    })()
                  )}
                </div>

                {renderInfoGroups(primaryInfoGroups)}

                <div className="requirement-info-more">
                  <div className="requirement-info-more-head">
                    <button
                      type="button"
                      className="requirement-info-more-toggle"
                      aria-expanded={moreFieldsOpen}
                      aria-controls="requirement-more-fields"
                      onClick={onToggleMoreFields}
                    >
                      {moreFieldsOpen ? (
                        <DownOutlined className="requirement-info-more-chevron" />
                      ) : (
                        <RightOutlined className="requirement-info-more-chevron" />
                      )}
                      更多飞书字段
                    </button>
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
                  {moreFieldsOpen ? (
                    <div
                      id="requirement-more-fields"
                      className="requirement-info-groups requirement-info-more-groups"
                    >
                      {moreInfoGroups.map((group) => (
                        <section className="requirement-info-group" key={group.title}>
                          <h4>{group.title}</h4>
                          <dl className="requirement-info-grid">
                            {group.fields.map((field) => (
                              <div
                                key={field.label}
                                className={field.wide ? 'is-wide' : undefined}
                              >
                                {field.hideLabel ? null : <dt>{field.label}</dt>}
                                <dd>{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          },
          {
            key: 'comments',
            label: (
              <span className="requirement-info-tab-label">
                评论/备注
                {activity && activity.commentsTotal > 0 ? (
                  <span className="requirement-info-tab-count">
                    {activity.commentsTotal}
                  </span>
                ) : null}
              </span>
            ),
            children: (
              <div className="requirement-info-tab">
                {requirement.remark ? (
                  <div className="requirement-remark-block">
                    <h3>备注</h3>
                    <p>{requirement.remark}</p>
                  </div>
                ) : null}

                <div className="requirement-comments-heading">
                  <h3>评论</h3>
                  {activity ? <span>共 {activity.commentsTotal} 条</span> : null}
                </div>

                {activityError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="评论加载失败"
                    description={activityError}
                    action={
                      <Button size="small" onClick={onRetryActivity}>
                        重试
                      </Button>
                    }
                  />
                ) : activityLoading && !activity ? (
                  <Skeleton active paragraph={{ rows: 3 }} />
                ) : activity ? (
                  <>
                    <div className="requirement-comment-list">
                      {activity.comments.length > 0 ? (
                        activity.comments.map((comment) => (
                          <article className="requirement-comment" key={comment.id}>
                            <Avatar
                              size={24}
                              src={comment.creator?.avatarUrl ?? undefined}
                            >
                              {comment.creator?.name.slice(0, 1) ?? '?'}
                            </Avatar>
                            <div className="requirement-comment-body">
                              <div className="requirement-comment-head">
                                <strong>{comment.creator?.name ?? '未知成员'}</strong>
                                <div className="requirement-comment-meta">
                                  <span>{comment.createdAt ?? ''}</span>
                                  <Button
                                    type="text"
                                    size="small"
                                    className="requirement-comment-reply-button"
                                    onClick={() => onStartReply(comment)}
                                  >
                                    回复
                                  </Button>
                                </div>
                              </div>
                              <MarkdownContent
                                content={formatCommentContent(comment.content)}
                                className="requirement-comment-markdown"
                              />
                            </div>
                          </article>
                        ))
                      ) : (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="暂无评论"
                        />
                      )}
                    </div>

                    {activity.commentsTotal > activity.comments.length ? (
                      <p className="requirement-comment-note">
                        仅展示最新 {activity.comments.length} 条评论，共{' '}
                        {activity.commentsTotal} 条。
                      </p>
                    ) : null}

                    <div className="requirement-comment-editor">
                      {replyToComment ? (
                        <div className="requirement-comment-reply-banner">
                          <span>
                            正在回复 {replyToComment.creator?.name ?? '未知成员'}
                          </span>
                          <Button type="text" size="small" onClick={onCancelReply}>
                            取消
                          </Button>
                        </div>
                      ) : null}
                      <MarkdownEditor
                        rows={4}
                        value={commentDraft}
                        placeholder={
                          replyToComment
                            ? `回复 ${replyToComment.creator?.name ?? '未知成员'}`
                            : '写下评论，支持 Markdown'
                        }
                        disabled={commentSubmitting}
                        onChange={onCommentDraftChange}
                      />
                      <div className="requirement-comment-editor-footer">
                        <span>评论会直接同步到飞书项目</span>
                        <Button
                          type="primary"
                          size="small"
                          loading={commentSubmitting}
                          onClick={() => onAddComment()}
                        >
                          {replyToComment ? '发表回复' : '发表评论'}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )
          }
        ]}
      />
    </section>
  )
}
