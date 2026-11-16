import type { ReactNode } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Empty,
  Select,
  Skeleton,
  Tabs
} from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type {
  MeegleDefect,
  MeegleDefectComment,
  MeegleDefectComments,
  MeegleDefectOwner
} from '../../../../types/defects'
import {
  cleanDescription,
  formatCommentTime
} from '../../pages/DefectWorkbench/defect-utils'
import '../RequirementInfoSection/RequirementInfoSection.css'
import '../RequirementFlowSection/RequirementFlowSection.css'
import DefectPeople from '../DefectPeople/DefectPeople'
import MarkdownContent from '../MarkdownContent/MarkdownContent'
import MarkdownEditor from '../MarkdownEditor/MarkdownEditor'
import './DefectDetail.css'

export interface DefectInfoGroup {
  title: string
  fields: Array<{
    label: string
    value: ReactNode
    wide?: boolean
    hideLabel?: boolean
  }>
}

interface DefectDetailProps {
  defect: MeegleDefect
  activeTab: string
  description: string
  descriptionExpanded: boolean
  descriptionCollapsed: boolean
  infoGroups: DefectInfoGroup[]
  operatorMembers: MeegleDefectOwner[]
  assigneesEditing: boolean
  assigneesSaving: boolean
  usersLoading: boolean
  operatorKey: string | undefined
  bugOwnerKey: string | undefined
  userOptions: MeegleDefectOwner[]
  comments: MeegleDefectComments | null
  commentsLoading: boolean
  commentsError: string | null
  replyToComment: MeegleDefectComment | null
  commentDraft: string
  commentSubmitting: boolean
  onTabChange: (key: string) => void
  onToggleDescription: () => void
  onStartAssigneesEdit: () => void
  onCancelAssigneesEdit: () => void
  onSaveAssignees: () => void
  onOperatorKeyChange: (value?: string) => void
  onBugOwnerKeyChange: (value?: string) => void
  onSearchAssignees: (keyword: string) => void
  onRetryComments: () => void
  onStartReply: (comment: MeegleDefectComment) => void
  onCancelReply: () => void
  onCommentDraftChange: (value: string) => void
  onAddComment: () => void
}

const renderAssigneeOption = (owner: MeegleDefectOwner): JSX.Element => (
  <span className="requirement-node-owner-option">
    <Avatar size={24} src={owner.avatarUrl ?? undefined}>
      {owner.name.slice(0, 1)}
    </Avatar>
    <span className="requirement-node-owner-option-copy">
      <span className="requirement-node-owner-option-name">{owner.name}</span>
      {owner.email ? (
        <span className="requirement-node-owner-option-email">{owner.email}</span>
      ) : null}
    </span>
  </span>
)

const renderAssigneeLabel = (owner: MeegleDefectOwner): JSX.Element => (
  <span className="requirement-node-owner-tag-label">
    <Avatar size={16} src={owner.avatarUrl ?? undefined}>
      {owner.name.slice(0, 1)}
    </Avatar>
    <span>{owner.name}</span>
  </span>
)

/**
 * 缺陷详情：描述、处理人、字段和评论。
 */
export default function DefectDetail({
  defect,
  activeTab,
  description,
  descriptionExpanded,
  descriptionCollapsed,
  infoGroups,
  operatorMembers,
  assigneesEditing,
  assigneesSaving,
  usersLoading,
  operatorKey,
  bugOwnerKey,
  userOptions,
  comments,
  commentsLoading,
  commentsError,
  replyToComment,
  commentDraft,
  commentSubmitting,
  onTabChange,
  onToggleDescription,
  onStartAssigneesEdit,
  onCancelAssigneesEdit,
  onSaveAssignees,
  onOperatorKeyChange,
  onBugOwnerKeyChange,
  onSearchAssignees,
  onRetryComments,
  onStartReply,
  onCancelReply,
  onCommentDraftChange,
  onAddComment
}: DefectDetailProps): JSX.Element {
  const renderAssigneeSelect = (
    value: string | undefined,
    onChange: (next?: string) => void
  ): JSX.Element => (
    <Select
      className="defect-assignee-select"
      allowClear
      showSearch
      filterOption={false}
      loading={usersLoading}
      value={value}
      options={userOptions.map((user) => ({
        value: user.userKey,
        label: user.name
      }))}
      placeholder="搜索或选择成员"
      notFoundContent={usersLoading ? '搜索中...' : '未找到用户'}
      optionRender={(option) => {
        const owner = userOptions.find((item) => item.userKey === String(option.value))

        return owner ? renderAssigneeOption(owner) : option.label
      }}
      labelRender={(props) => {
        const owner = userOptions.find((item) => item.userKey === String(props.value))

        return owner ? renderAssigneeLabel(owner) : props.label
      }}
      onSearch={onSearchAssignees}
      onChange={(next?: string) => onChange(next)}
    />
  )

  return (
    <section className="requirement-info-section">
      <Tabs
        className="requirement-info-tabs"
        activeKey={activeTab}
        onChange={onTabChange}
        items={[
          {
            key: 'basic',
            label: '基本信息',
            children: (
              <div className="requirement-info-tab">
                <section className="requirement-info-group defect-description-card">
                  <div className="defect-info-group-heading">
                    <h4>详细描述</h4>
                  </div>
                  {description ? (
                    <>
                      <div
                        className={`requirement-description-box defect-description-box${
                          descriptionCollapsed ? ' is-collapsed' : ''
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
                          onClick={onToggleDescription}
                        >
                          {descriptionExpanded ? '收起' : '展开'}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <p className="defect-muted">暂无详细描述</p>
                  )}
                </section>

                <div className="requirement-info-groups">
                  <section className="requirement-info-group" aria-label="BUG处理人">
                    <div className="defect-info-group-heading">
                      <h4>BUG处理人</h4>
                      {assigneesEditing ? (
                        <span className="requirement-info-description-actions">
                          <Button size="small" onClick={onCancelAssigneesEdit}>
                            取消
                          </Button>
                          <Button
                            type="primary"
                            size="small"
                            loading={assigneesSaving}
                            onClick={() => onSaveAssignees()}
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
                          onClick={onStartAssigneesEdit}
                        >
                          编辑
                        </Button>
                      )}
                    </div>
                    <div className="requirement-info-collaborators">
                      <div className="requirement-info-collaborator">
                        <span className="requirement-info-collaborator-role">
                          BUG经办人
                        </span>
                        <div className="requirement-info-collaborator-members">
                          {assigneesEditing
                            ? renderAssigneeSelect(operatorKey, onOperatorKeyChange)
                            : <DefectPeople people={operatorMembers} />}
                        </div>
                      </div>
                      <div className="requirement-info-collaborator">
                        <span className="requirement-info-collaborator-role">
                          BUG责任人
                        </span>
                        <div className="requirement-info-collaborator-members">
                          {assigneesEditing
                            ? renderAssigneeSelect(bugOwnerKey, onBugOwnerKeyChange)
                            : defect.bugOwner
                              ? <DefectPeople people={[defect.bugOwner]} />
                              : '未填写'}
                        </div>
                      </div>
                    </div>
                    {assigneesEditing ? (
                      <p className="requirement-description-edit-hint">
                        保存后会直接同步到飞书项目。
                      </p>
                    ) : null}
                  </section>

                  {infoGroups.map((group) => (
                    <section className="requirement-info-group" key={group.title}>
                      <div className="defect-info-group-heading">
                        <h4>{group.title}</h4>
                      </div>
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
              </div>
            )
          },
          {
            key: 'comments',
            label: '评论/备注',
            children: (
              <div className="requirement-info-tab">
                <div className="requirement-comments-heading">
                  <h3>评论</h3>
                  <span>共 {comments?.total ?? 0} 条</span>
                </div>
                {commentsError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="评论加载失败"
                    description={commentsError}
                    action={
                      <Button size="small" onClick={onRetryComments}>
                        重试
                      </Button>
                    }
                  />
                ) : commentsLoading && !comments ? (
                  <Skeleton active paragraph={{ rows: 3 }} />
                ) : comments ? (
                  <>
                    <div className="requirement-comment-list">
                      {comments.comments.length > 0 ? (
                        comments.comments.map((comment) => (
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
                                  <span>{formatCommentTime(comment.createdAt)}</span>
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
                                content={cleanDescription(comment.content)}
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
                    {comments.total > comments.comments.length ? (
                      <p className="requirement-comment-note">
                        仅展示最新 {comments.comments.length} 条评论，共{' '}
                        {comments.total} 条。
                      </p>
                    ) : null}
                  </>
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
              </div>
            )
          }
        ]}
      />
    </section>
  )
}
