import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import {
  EditOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined
} from '@ant-design/icons'
import {
  Alert,
  App,
  Avatar,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Spin,
  Tabs,
  Tooltip
} from 'antd'
import { DEFECT_ROLES } from '../../../../types/defects'
import type {
  DefectRole,
  DefectTransition,
  DefectTransitionFieldValue,
  DefectTransitions,
  MeegleDefectComment,
  MeegleDefectComments,
  MeegleDefectOwner,
  MeegleMyDefects,
  UpdateDefectAssigneesInput
} from '../../../../types/defects'
import type { SettingsSection } from '../../../../types/settings'
import { getErrorMessage } from '../../../../utils'
import MarkdownContent from '../../components/MarkdownContent/MarkdownContent'
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor'

interface DefectWorkbenchProps {
  onOpenSettings: (section: SettingsSection) => void
}

const formatDate = (value: string | null): string =>
  value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD') : '未填写'

const formatFetchedAt = (value: string): string =>
  dayjs(value).isValid() ? dayjs(value).format('MM-DD HH:mm') : value

const formatCommentTime = (value: string | null): string =>
  value && dayjs(value).isValid() ? dayjs(value).format('MM-DD HH:mm') : (value ?? '')

/** 清理飞书描述里的内部注释标记。 */
const cleanDescription = (content: string): string =>
  content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

const getStatusTone = (status: string | null): string => {
  const value = status ?? ''

  // “未完成/未关闭/未解决”等不是完成态，必须先于完成态判断。
  if (/^未|未完成|未关闭|未解决/.test(value)) return 'idle'
  // 完成态优先判断，避免“测试通过”被归到测试中。
  if (/测试通过|已解决|已修复|关闭|完成|结束|done|closed|resolved/i.test(value)) {
    return 'done'
  }
  if (/终止|取消|打回|拒绝|重新打开|reopen/i.test(value)) return 'danger'
  if (/待验证|待测试|待验收|验证中|测试中|review/i.test(value)) return 'testing'
  if (/挂起|暂缓|暂停|on hold/i.test(value)) return 'idle'
  if (/新建|打开|open/i.test(value)) return 'active'
  if (/未开始|待开始|待处理|idle/i.test(value)) return 'idle'
  if (/开发|进行|处理中|修复中|doing|progress/i.test(value)) return 'active'

  return 'neutral'
}

const getPriorityTone = (priority: string | null): string => {
  switch (priority) {
    case 'P0':
      return 'p0'
    case 'P1':
      return 'p1'
    case 'P2':
      return 'p2'
    default:
      return 'default'
  }
}

const getSeverityTone = (severity: string | null): string => {
  const value = severity ?? ''

  if (/致命|严重/.test(value)) return 'p0'
  if (/一般/.test(value)) return 'p1'
  if (/轻微|提示/.test(value)) return 'p2'

  return 'default'
}

/** 与需求详情一致的人员头像 + 名称。 */
const renderPerson = (person: MeegleDefectOwner): JSX.Element => (
  <span
    className="requirement-info-person"
    key={person.userKey ?? person.email ?? person.name}
  >
    <Avatar size={20} src={person.avatarUrl ?? undefined}>
      {person.name.slice(0, 1)}
    </Avatar>
    <span>{person.name}</span>
  </span>
)

const renderPeople = (people: MeegleDefectOwner[]): ReactNode => {
  if (people.length === 0) return '未填写'

  return <div className="requirement-info-people">{people.map(renderPerson)}</div>
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

function StatusTag({
  value,
  tone
}: {
  value: string | null
  tone: string
}): JSX.Element {
  return <span className={`requirement-header-tag is-${tone}`}>{value ?? '未知'}</span>
}

/**
 * 飞书项目缺陷工作台。
 * 读取当前用户通过缺陷角色参与的缺陷，列表和基础详情在本地展示。
 */
export default function DefectWorkbench({
  onOpenSettings
}: DefectWorkbenchProps): JSX.Element {
  const { message } = App.useApp()
  const [role, setRole] = useState<DefectRole | null>(null)
  const [data, setData] = useState<MeegleMyDefects | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [iterationFilter, setIterationFilter] = useState<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')
  const [comments, setComments] = useState<MeegleDefectComments | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [commentsVersion, setCommentsVersion] = useState(0)
  const [assigneesEditing, setAssigneesEditing] = useState(false)
  const [assigneesSaving, setAssigneesSaving] = useState(false)
  const [operatorKey, setOperatorKey] = useState<string | undefined>()
  const [bugOwnerKey, setBugOwnerKey] = useState<string | undefined>()
  const [userOptions, setUserOptions] = useState<MeegleDefectOwner[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [replyToComment, setReplyToComment] = useState<MeegleDefectComment | null>(null)
  const userSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userSearchRequestRef = useRef(0)
  const loadRequestRef = useRef(0)
  const [transitionOpen, setTransitionOpen] = useState(false)
  const [transitions, setTransitions] = useState<DefectTransitions | null>(null)
  const [transitionLoading, setTransitionLoading] = useState(false)
  const [transitionSubmitting, setTransitionSubmitting] = useState(false)
  const [transitionError, setTransitionError] = useState<string | null>(null)
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | undefined>()
  const [transitionValues, setTransitionValues] = useState<
    Record<string, string | string[]>
  >({})

  const load = useCallback(async (showLoading = true): Promise<void> => {
    const requestId = ++loadRequestRef.current

    if (showLoading) setLoading(true)
    setError(null)

    try {
      const next = await window.electron.getMyDefects(role)

      if (requestId !== loadRequestRef.current) return

      setData(next)
      setSelectedId((current) =>
        next.defects.some((defect) => defect.id === current)
          ? current
          : (next.defects[0]?.id ?? null)
      )
    } catch (loadError) {
      if (requestId === loadRequestRef.current) {
        setError(getErrorMessage(loadError, '缺陷加载失败'))
      }
    } finally {
      if (showLoading && requestId === loadRequestRef.current) {
        setLoading(false)
      }
    }
  }, [role])

  useEffect(() => {
    load()
  }, [load, reloadVersion])

  useEffect(() => {
    const handleProjectChanged = (): void => {
      setRole(null)
      setSelectedId(null)
      setStatusFilters([])
      setIterationFilter(null)
      setDescriptionExpanded(false)
      setAssigneesEditing(false)
      setActiveTab('basic')
      setCommentDraft('')
      setReplyToComment(null)
      setTransitionOpen(false)
      setSelectedTransitionId(undefined)
      setTransitionValues({})
      setReloadVersion((version) => version + 1)
    }

    window.addEventListener('meegle:project-changed', handleProjectChanged)

    return () => {
      window.removeEventListener('meegle:project-changed', handleProjectChanged)
    }
  }, [])

  const defects = data?.defects ?? []

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>()

    for (const defect of defects) {
      const status = defect.status ?? '状态未知'
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }

    return Array.from(counts.entries())
      .sort((left, right) => {
        const countCompare = right[1] - left[1]

        return countCompare !== 0
          ? countCompare
          : left[0].localeCompare(right[0], 'zh-CN')
      })
      .map(([status, count]) => ({
        value: status,
        label: `${status}（${count}）`
      }))
  }, [defects])

  const iterationOptions = useMemo(() => {
    const options = new Map<string, string>()

    for (const defect of defects) {
      if (defect.iterationId) {
        options.set(defect.iterationId, defect.iterationName ?? defect.iterationId)
      }
    }

    return Array.from(options.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
  }, [defects])

  const filteredDefects = useMemo(() => {
    const keyword = search.trim().toLowerCase()

    return defects.filter((defect) => {
      if (
        statusFilters.length > 0 &&
        !statusFilters.includes(defect.status ?? '状态未知')
      ) {
        return false
      }
      if (iterationFilter && defect.iterationId !== iterationFilter) return false
      if (!keyword) return true

      return [
        defect.name,
        defect.status,
        defect.priority,
        defect.severity,
        defect.iterationName,
        ...defect.owners.map((owner) => owner.name)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    })
  }, [defects, iterationFilter, search, statusFilters])

  const selectedDefect =
    filteredDefects.find((defect) => defect.id === selectedId) ??
    filteredDefects[0] ??
    null

  useEffect(() => {
    if (!selectedDefect || activeTab !== 'comments') return

    let active = true

    setCommentsLoading(true)
    setCommentsError(null)
    setComments(null)
    window.electron
      .getDefectComments(selectedDefect.id)
      .then((result) => {
        if (active) setComments(result)
      })
      .catch((loadError) => {
        if (active) setCommentsError(getErrorMessage(loadError, '读取评论失败'))
      })
      .finally(() => {
        if (active) setCommentsLoading(false)
      })

    return () => {
      active = false
    }
  }, [activeTab, commentsVersion, data?.fetchedAt, selectedDefect?.id])

  const defectUrl =
    selectedDefect && data
      ? `https://project.feishu.cn/${encodeURIComponent(
          data.project.key
        )}/issue/detail/${encodeURIComponent(selectedDefect.id)}`
      : null

  const linkedRequirementUrl =
    selectedDefect?.linkedRequirement && data
      ? `https://project.feishu.cn/${encodeURIComponent(
          data.project.key
        )}/story/detail/${encodeURIComponent(selectedDefect.linkedRequirement.id)}`
      : null

  const operatorMembers =
    selectedDefect?.collaborators.find((item) => item.role === '经办人')?.members ?? []
  const peopleRows = selectedDefect
    ? [
        { role: '当前负责人', members: selectedDefect.owners },
        {
          role: 'BUG 解决人',
          members: selectedDefect.resolver ? [selectedDefect.resolver] : []
        },
        ...selectedDefect.collaborators.filter((item) => item.role !== '经办人'),
        {
          role: '创建人',
          members: selectedDefect.createdBy ? [selectedDefect.createdBy] : []
        },
        {
          role: '更新人',
          members: selectedDefect.updatedBy ? [selectedDefect.updatedBy] : []
        },
        { role: '关注人', members: selectedDefect.watchers }
      ]
    : []

  const infoGroups: Array<{
    title: string
    fields: Array<{
      label: string
      value: ReactNode
      wide?: boolean
      hideLabel?: boolean
    }>
  }> = selectedDefect
    ? [
        {
          title: '基础信息',
          fields: [
            {
              label: '当前状态',
              value: (
                <StatusTag
                  value={selectedDefect.status}
                  tone={getStatusTone(selectedDefect.status)}
                />
              )
            },
            {
              label: '优先级',
              value: selectedDefect.priority ? (
                <StatusTag
                  value={selectedDefect.priority}
                  tone={getPriorityTone(selectedDefect.priority)}
                />
              ) : (
                '未填写'
              )
            },
            {
              label: '缺陷等级',
              value: selectedDefect.severity ? (
                <StatusTag
                  value={selectedDefect.severity}
                  tone={getSeverityTone(selectedDefect.severity)}
                />
              ) : (
                '未填写'
              )
            },
            {
              label: '发现阶段',
              value: selectedDefect.findingStage ?? '未填写'
            },
            {
              label: '规划迭代',
              value: selectedDefect.iterationName ?? '未规划迭代'
            }
          ]
        },
        {
          title: '版本与关联',
          fields: [
            {
              label: '影响版本',
              value: selectedDefect.affectedVersions.join(' / ') || '未填写'
            },
            {
              label: '解决版本',
              value: selectedDefect.fixedVersions.join(' / ') || '未填写'
            },
            {
              label: '关联需求',
              value:
                selectedDefect.linkedRequirement && linkedRequirementUrl ? (
                  <a
                    className="defect-info-link"
                    href={linkedRequirementUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selectedDefect.linkedRequirement.name}
                  </a>
                ) : (
                  '未关联'
                )
            }
          ]
        },
        {
          title: '人员信息',
          fields: [
            {
              label: '参与人员',
              wide: true,
              hideLabel: true,
              value: (
                <div className="requirement-info-collaborators">
                  {peopleRows.map((group) => (
                    <div className="requirement-info-collaborator" key={group.role}>
                      <span className="requirement-info-collaborator-role">
                        {group.role}
                      </span>
                      <div className="requirement-info-collaborator-members">
                        {renderPeople(group.members)}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          ]
        },
        {
          title: '时间信息',
          fields: [
            {
              label: '提出时间',
              value: formatDate(selectedDefect.proposedAt)
            },
            {
              label: '更新时间',
              value: formatDate(selectedDefect.updatedAt)
            },
            {
              label: '完成日期',
              value: formatDate(selectedDefect.completedAt)
            }
          ]
        }
      ]
    : []

  const description = selectedDefect
    ? cleanDescription(selectedDefect.description ?? '')
    : ''
  const descriptionCollapsed =
    !descriptionExpanded &&
    (description.length > 420 || description.split('\n').length > 12)

  const selectedTransition: DefectTransition | null =
    transitions?.transitions.find(
      (transition) => transition.id === selectedTransitionId
    ) ?? null

  const missingTransitionRoles =
    selectedTransition && selectedDefect
      ? selectedTransition.requiredRoles.filter(
          (role) =>
            !selectedDefect.collaborators.some(
              (group) => group.role === role.name && group.members.length > 0
            )
        )
      : []

  const handleRoleChange = (nextRole?: DefectRole): void => {
    setRole(nextRole ?? null)
    setSelectedId(null)
    setStatusFilters([])
    setIterationFilter(null)
  }

  const handleRefresh = (): void => {
    void load()
  }

  const buildReplyContent = (
    comment: MeegleDefectComment,
    replyText: string
  ): string => {
    const quoted = cleanDescription(comment.content)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    const creator = comment.creator

    if (!creator) return `${quoted}\n\n${replyText}`

    return `${quoted}\n> —— ${creator.name}\n\n@${creator.name} ${replyText}`
  }

  const handleStartReply = (comment: MeegleDefectComment): void => {
    setReplyToComment(comment)
  }

  const handleCancelReply = (): void => {
    setReplyToComment(null)
  }

  const handleAddComment = async (): Promise<void> => {
    if (!selectedDefect) return

    if (!commentDraft.trim()) {
      message.warning('请输入评论内容')
      return
    }

    setCommentSubmitting(true)

    try {
      const notifyUserKeys = replyToComment?.creator?.userKey
        ? [replyToComment.creator.userKey]
        : undefined
      const content = replyToComment
        ? buildReplyContent(replyToComment, commentDraft)
        : commentDraft

      await window.electron.addDefectComment(
        selectedDefect.id,
        content,
        notifyUserKeys
      )
      setCommentDraft('')
      setReplyToComment(null)
      message.success(replyToComment ? '回复已发表' : '评论已发表')
      setCommentsVersion((version) => version + 1)
    } catch (commentError) {
      message.error(getErrorMessage(commentError, '发表评论失败'))
    } finally {
      setCommentSubmitting(false)
    }
  }

  const handleOpenTransition = (): void => {
    if (!selectedDefect) return

    setTransitionOpen(true)
    setTransitionLoading(true)
    setTransitionError(null)
    setTransitions(null)
    setSelectedTransitionId(undefined)
    setTransitionValues({})
    window.electron
      .getDefectTransitions(selectedDefect.id)
      .then((result) => setTransitions(result))
      .catch((loadError) =>
        setTransitionError(getErrorMessage(loadError, '读取流转状态失败'))
      )
      .finally(() => setTransitionLoading(false))
  }

  const handleSelectTransition = (transitionId?: string): void => {
    setSelectedTransitionId(transitionId)
    setTransitionValues({})
    setTransitionError(null)
  }

  const handleTransitionValueChange = (
    fieldKey: string,
    value: string | string[]
  ): void => {
    setTransitionValues((current) => ({ ...current, [fieldKey]: value }))
  }

  const handleSubmitTransition = async (): Promise<void> => {
    if (!selectedDefect || !selectedTransition || transitionSubmitting) return

    if (missingTransitionRoles.length > 0) {
      message.warning(
        `请先在飞书补齐角色：${missingTransitionRoles
          .map((role) => role.name)
          .join('、')}`
      )
      return
    }

    const fields: DefectTransitionFieldValue[] = []
    const missing = selectedTransition.fields.find((field) => {
      const value = transitionValues[field.key]
      return Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim()
    })

    if (missing) {
      message.warning(`请填写「${missing.name}」`)
      return
    }

    for (const field of selectedTransition.fields) {
      const value = transitionValues[field.key]

      const fieldValue =
        field.type === 'tree-multi-select'
          ? JSON.stringify(Array.isArray(value) ? value : [])
          : field.type === 'multi-select'
            ? JSON.stringify(
                (Array.isArray(value) ? value : []).map((optionId) => ({
                  option_id: optionId
                }))
              )
            : String(value ?? '')

      fields.push({
        fieldKey: field.key,
        fieldValue
      })
    }

    setTransitionSubmitting(true)
    setTransitionError(null)

    try {
      await window.electron.transitionDefect(
        selectedDefect.id,
        selectedTransition.id,
        fields
      )
      await load()
      setTransitionOpen(false)
      setSelectedTransitionId(undefined)
      setTransitionValues({})
      message.success(`缺陷已流转到「${selectedTransition.stateName}」`)
    } catch (transitionFailure) {
      setTransitionError(getErrorMessage(transitionFailure, '缺陷流转失败'))
    } finally {
      setTransitionSubmitting(false)
    }
  }

  const getAssigneeSeed = (): MeegleDefectOwner[] => {
    const people = [
      ...operatorMembers,
      ...(selectedDefect?.bugOwner ? [selectedDefect.bugOwner] : []),
      ...(selectedDefect?.resolver ? [selectedDefect.resolver] : [])
    ]
    const unique = new Map<string, MeegleDefectOwner>()

    for (const person of people) {
      if (person.userKey) unique.set(person.userKey, person)
    }

    return Array.from(unique.values())
  }

  const handleSearchAssignees = (keyword: string): void => {
    const requestId = ++userSearchRequestRef.current

    if (userSearchTimerRef.current) clearTimeout(userSearchTimerRef.current)

    const query = keyword.trim()

    if (!query) {
      setUsersLoading(false)
      setUserOptions(getAssigneeSeed())
      return
    }

    userSearchTimerRef.current = setTimeout(() => {
      setUsersLoading(true)
      window.electron
        .searchRequirementUsers(query)
        .then((users) => {
          if (requestId !== userSearchRequestRef.current) return

          setUserOptions((current) => {
            const merged = new Map(
              current.flatMap((user) =>
                user.userKey ? [[user.userKey, user] as const] : []
              )
            )

            for (const user of users) {
              if (user.userKey) {
                merged.set(user.userKey, {
                  name: user.name,
                  email: user.email,
                  avatarUrl: user.avatarUrl,
                  userKey: user.userKey
                })
              }
            }

            return Array.from(merged.values())
          })
        })
        .catch(() => undefined)
        .finally(() => {
          if (requestId === userSearchRequestRef.current) {
            setUsersLoading(false)
          }
        })
    }, 250)
  }

  const handleStartAssigneesEdit = (): void => {
    if (!selectedDefect) return

    setOperatorKey(operatorMembers[0]?.userKey ?? undefined)
    setBugOwnerKey(selectedDefect.bugOwner?.userKey ?? undefined)
    setUserOptions(getAssigneeSeed())
    setAssigneesEditing(true)
  }

  const handleCancelAssigneesEdit = (): void => {
    if (assigneesSaving) return

    setAssigneesEditing(false)
    setOperatorKey(operatorMembers[0]?.userKey ?? undefined)
    setBugOwnerKey(selectedDefect?.bugOwner?.userKey ?? undefined)
  }

  const handleSaveAssignees = async (): Promise<void> => {
    if (!selectedDefect || assigneesSaving) return

    const currentOperatorKeys = Array.from(
      new Set(
        operatorMembers
          .map((member) => member.userKey)
          .filter((key): key is string => Boolean(key))
      )
    )
    const currentOperatorKey = currentOperatorKeys[0] ?? null
    const patch: UpdateDefectAssigneesInput = {}

    if ((operatorKey ?? null) !== currentOperatorKey) {
      patch.bugOperator = operatorKey ?? null
      patch.operatorCurrentKeys = currentOperatorKeys
    }
    if ((bugOwnerKey ?? null) !== (selectedDefect.bugOwner?.userKey ?? null)) {
      patch.bugOwner = bugOwnerKey ?? null
    }

    if (Object.keys(patch).length === 0) {
      setAssigneesEditing(false)
      message.info('BUG 处理人没有变化')
      return
    }

    setAssigneesSaving(true)
    message.loading({
      content: '正在保存 BUG 处理人...',
      key: 'defect-assignees-saving',
      duration: 0
    })

    try {
      await window.electron.updateDefectAssignees(selectedDefect.id, patch)
      setAssigneesEditing(false)
      await load()
      message.success({
        content: 'BUG 处理人已更新',
        key: 'defect-assignees-saving'
      })
    } catch (updateError) {
      message.error({
        content: getErrorMessage(updateError, '更新 BUG 处理人失败'),
        key: 'defect-assignees-saving'
      })
    } finally {
      setAssigneesSaving(false)
    }
  }

  return (
    <div className="workbench">
      <aside className="workbench-sidebar">
        <div className="workbench-brand">
          <div className="workbench-brand-text">
            <strong>缺陷工作台</strong>
            <span>{data?.project.name ?? '我参与的缺陷'}</span>
          </div>
        </div>

        <div className="workbench-sidebar-heading">
          <span className="workbench-sidebar-title">
            <span>我参与的缺陷</span>
            <span className="workbench-sidebar-count">
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
                loading={loading}
                aria-label="刷新缺陷"
                onClick={handleRefresh}
              />
            </Tooltip>
          </span>
        </div>

        <div className="workbench-filter-stack">
          <Input
            className="workbench-requirement-search"
            prefix={<SearchOutlined />}
            placeholder="搜索缺陷、状态或负责人"
            value={search}
            allowClear
            disabled={loading && !data}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            className="workbench-filter-select"
            value={role ?? undefined}
            allowClear
            options={DEFECT_ROLES.map((item) => ({ value: item, label: item }))}
            placeholder="全部角色"
            aria-label="按缺陷角色筛选"
            onChange={handleRoleChange}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            maxTagPlaceholder={(omitted) => `+${omitted.length}`}
            className="workbench-filter-select workbench-status-filter"
            value={statusFilters}
            options={statusOptions}
            placeholder={`全部状态（${defects.length}）`}
            aria-label="按缺陷状态筛选"
            onChange={(values: string[]) => setStatusFilters(values)}
          />
          <Select
            className="workbench-filter-select"
            value={iterationFilter ?? undefined}
            allowClear
            showSearch
            optionFilterProp="label"
            options={iterationOptions}
            placeholder="全部迭代"
            aria-label="按缺陷迭代筛选"
            onChange={(value?: string) => setIterationFilter(value ?? null)}
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
                      selectedDefect?.id === defect.id ? ' is-active' : ''
                    }`}
                    onClick={() => {
                      setSelectedId(defect.id)
                      setDescriptionExpanded(false)
                      setAssigneesEditing(false)
                      setActiveTab('basic')
                      setCommentDraft('')
                      setReplyToComment(null)
                      setTransitionOpen(false)
                      setSelectedTransitionId(undefined)
                      setTransitionValues({})
                    }}
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
                        <StatusTag
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
                          {defect.iterationName ?? '未规划迭代'}
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
              description={data?.total === 0 ? '当前没有未解决缺陷' : '没有匹配的缺陷'}
            />
          )}
        </div>

        <p className="workbench-sidebar-footnote">
          数据来自 Meegle 我参与的缺陷
          {data ? ` · 同步于 ${formatFetchedAt(data.fetchedAt)}` : ''}
        </p>
      </aside>

      <section className="workbench-main">
        {error && !data ? (
          <div className="workbench-state">
            <div className="workbench-state-card">
              <Alert
                type="error"
                showIcon
                message="无法读取缺陷"
                description={error}
              />
              <div className="workbench-state-actions">
                <Button type="primary" onClick={handleRefresh}>
                  重试
                </Button>
                <Button onClick={() => onOpenSettings('meegle')}>检查 Meegle 设置</Button>
              </div>
            </div>
          </div>
        ) : loading && !data ? (
          <header className="workbench-header workbench-header-skeleton">
            <div className="workbench-heading">
              <Skeleton
                active
                title={{ width: '34%' }}
                paragraph={{ rows: 2, width: ['72%', '30%'] }}
              />
            </div>
          </header>
        ) : selectedDefect && data ? (
          <>
            <header className="workbench-header">
              <div className="workbench-heading">
                <span className="workbench-eyebrow">
                  {data.project.name} / {selectedDefect.iterationName ?? '我参与的缺陷'}
                </span>
                <div className="workbench-title-row">
                  <Tooltip title="刷新数据">
                    <Button
                      type="text"
                      size="small"
                      className="workbench-refresh-icon"
                      icon={<ReloadOutlined />}
                      loading={loading}
                      aria-label="刷新数据"
                      onClick={handleRefresh}
                    />
                  </Tooltip>
                  <h1>{selectedDefect.name}</h1>
                </div>
                <div className="workbench-heading-meta">
                  <StatusTag
                    value={selectedDefect.status}
                    tone={getStatusTone(selectedDefect.status)}
                  />
                  {selectedDefect.priority ? (
                    <StatusTag
                      value={selectedDefect.priority}
                      tone={getPriorityTone(selectedDefect.priority)}
                    />
                  ) : null}
                  {selectedDefect.severity ? (
                    <StatusTag
                      value={selectedDefect.severity}
                      tone={getSeverityTone(selectedDefect.severity)}
                    />
                  ) : null}
                  <span className="workbench-updated-at">
                    更新于 {formatDate(selectedDefect.updatedAt)}
                  </span>
                </div>
                {defectUrl ? (
                  <div className="workbench-feishu-callout">
                    <InfoCircleOutlined className="workbench-feishu-callout-icon" />
                    <span className="workbench-feishu-callout-text">
                      飞书详情页包含更完整的操作，需要时可在应用内打开完整页面。
                    </span>
                    <a
                      className="workbench-feishu-callout-action"
                      href={defectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开完整飞书详情页 →
                    </a>
                  </div>
                ) : null}
              </div>
            </header>

            <div className="workbench-content">
              {error ? (
                <Alert
                  className="workbench-inline-alert"
                  type="warning"
                  showIcon
                  closable
                  message="刷新失败，当前展示上次同步结果"
                  description={error}
                  onClose={() => setError(null)}
                />
              ) : null}

              <div className="defect-content-actions">
                <Button
                  type="primary"
                  danger
                  icon={<SwapOutlined />}
                  onClick={handleOpenTransition}
                >
                  处理缺陷
                </Button>
              </div>

            <section className="requirement-info-section">
              <Tabs
                className="requirement-info-tabs"
                activeKey={activeTab}
                onChange={setActiveTab}
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
                                  onClick={() =>
                                    setDescriptionExpanded((value) => !value)
                                  }
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
                                  <section
                                    className="requirement-info-group"
                                    aria-label="BUG处理人"
                                  >
                                    <div className="defect-info-group-heading">
                                      <h4>BUG处理人</h4>
                                      {assigneesEditing ? (
                                        <span className="requirement-info-description-actions">
                                          <Button
                                            size="small"
                                            onClick={handleCancelAssigneesEdit}
                                          >
                                            取消
                                          </Button>
                                          <Button
                                            type="primary"
                                            size="small"
                                            loading={assigneesSaving}
                                            onClick={() => void handleSaveAssignees()}
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
                                          onClick={handleStartAssigneesEdit}
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
                                          {assigneesEditing ? (
                                            <Select
                                              className="defect-assignee-select"
                                              allowClear
                                              showSearch
                                              filterOption={false}
                                              loading={usersLoading}
                                              value={operatorKey}
                                              options={userOptions.map((user) => ({
                                                value: user.userKey,
                                                label: user.name
                                              }))}
                                              placeholder="搜索或选择成员"
                                              notFoundContent={
                                                usersLoading ? '搜索中...' : '未找到用户'
                                              }
                                              optionRender={(option) => {
                                                const owner = userOptions.find(
                                                  (item) =>
                                                    item.userKey === String(option.value)
                                                )

                                                return owner
                                                  ? renderAssigneeOption(owner)
                                                  : option.label
                                              }}
                                              labelRender={(props) => {
                                                const owner = userOptions.find(
                                                  (item) =>
                                                    item.userKey === String(props.value)
                                                )

                                                return owner
                                                  ? renderAssigneeLabel(owner)
                                                  : props.label
                                              }}
                                              onSearch={handleSearchAssignees}
                                              onChange={(value?: string) =>
                                                setOperatorKey(value)
                                              }
                                            />
                                          ) : (
                                            renderPeople(operatorMembers)
                                          )}
                                        </div>
                                      </div>
                                      <div className="requirement-info-collaborator">
                                        <span className="requirement-info-collaborator-role">
                                          BUG责任人
                                        </span>
                                        <div className="requirement-info-collaborator-members">
                                          {assigneesEditing ? (
                                            <Select
                                              className="defect-assignee-select"
                                              allowClear
                                              showSearch
                                              filterOption={false}
                                              loading={usersLoading}
                                              value={bugOwnerKey}
                                              options={userOptions.map((user) => ({
                                                value: user.userKey,
                                                label: user.name
                                              }))}
                                              placeholder="搜索或选择成员"
                                              notFoundContent={
                                                usersLoading ? '搜索中...' : '未找到用户'
                                              }
                                              optionRender={(option) => {
                                                const owner = userOptions.find(
                                                  (item) =>
                                                    item.userKey === String(option.value)
                                                )

                                                return owner
                                                  ? renderAssigneeOption(owner)
                                                  : option.label
                                              }}
                                              labelRender={(props) => {
                                                const owner = userOptions.find(
                                                  (item) =>
                                                    item.userKey === String(props.value)
                                                )

                                                return owner
                                                  ? renderAssigneeLabel(owner)
                                                  : props.label
                                              }}
                                              onSearch={handleSearchAssignees}
                                              onChange={(value?: string) =>
                                                setBugOwnerKey(value)
                                              }
                                            />
                                          ) : selectedDefect.bugOwner ? (
                                            renderPeople([selectedDefect.bugOwner])
                                          ) : (
                                            '未填写'
                                          )}
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
                              <section className="requirement-info-group">
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
                              <Button
                                size="small"
                                onClick={() =>
                                  setCommentsVersion((version) => version + 1)
                                }
                              >
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
                                  <article
                                    className="requirement-comment"
                                    key={comment.id}
                                  >
                                    <Avatar
                                      size={24}
                                      src={comment.creator?.avatarUrl ?? undefined}
                                    >
                                      {comment.creator?.name.slice(0, 1) ?? '?'}
                                    </Avatar>
                                    <div className="requirement-comment-body">
                                      <div className="requirement-comment-head">
                                        <strong>
                                          {comment.creator?.name ?? '未知成员'}
                                        </strong>
                                        <div className="requirement-comment-meta">
                                          <span>
                                            {formatCommentTime(comment.createdAt)}
                                          </span>
                                          <Button
                                            type="text"
                                            size="small"
                                            className="requirement-comment-reply-button"
                                            onClick={() => handleStartReply(comment)}
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
                              <Button
                                type="text"
                                size="small"
                                onClick={handleCancelReply}
                              >
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
                            onChange={setCommentDraft}
                          />
                          <div className="requirement-comment-editor-footer">
                            <span>评论会直接同步到飞书项目</span>
                            <Button
                              type="primary"
                              size="small"
                              loading={commentSubmitting}
                              onClick={() => void handleAddComment()}
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
            </div>
          </>
        ) : (
          <div className="workbench-state">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选择左侧缺陷查看详情"
            />
          </div>
        )}
      </section>

      <Modal
        title="处理缺陷"
        open={transitionOpen}
        width={620}
        okText="确认流转"
        cancelText="取消"
        okButtonProps={{
          disabled: !selectedTransition || missingTransitionRoles.length > 0
        }}
        confirmLoading={transitionSubmitting}
        onOk={() => void handleSubmitTransition()}
        onCancel={() => {
          if (!transitionSubmitting) setTransitionOpen(false)
        }}
      >
        <div className="defect-transition-form">
          {transitionLoading ? (
            <div className="defect-transition-loading">
              <Spin />
            </div>
          ) : transitionError ? (
            <Alert type="error" showIcon message={transitionError} />
          ) : transitions ? (
            <>
              <div className="defect-transition-current">
                <span>当前状态</span>
                <StatusTag
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
                          {missingTransitionRoles.map((role) => role.name).join('、')}
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
                      onChange={(value?: string) => handleSelectTransition(value)}
                    />
                  </label>
                  {selectedTransition?.fields.map((field) => (
                    <label key={field.key}>
                      <span>{field.name}</span>
                      {(field.type === 'tree-multi-select' ||
                      field.type === 'multi-select') ? (
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
                            handleTransitionValueChange(field.key, value)
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
                            handleTransitionValueChange(field.key, value ?? '')
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
                            handleTransitionValueChange(
                              field.key,
                              event.target.value
                            )
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
    </div>
  )
}
