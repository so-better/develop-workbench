import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CheckCircleFilled,
  ClockCircleFilled,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  LinkOutlined,
  MinusCircleOutlined,
  NodeCollapseOutlined,
  NodeExpandOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SearchOutlined
} from '@ant-design/icons'
import {
  Alert,
  App,
  Avatar,
  Button,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { InputRef } from 'antd'
import type { Dayjs } from 'dayjs'
import type {
  MeegleMyRequirements,
  MeegleRequirement,
  MeegleRequirementActivity,
  MeegleRequirementCollaborator,
  MeegleRequirementComment,
  MeegleRequirementGroup,
  MeegleRequirementOwner
} from '../../../types/requirements'
import type { SettingsSection } from '../../../types/settings'
import RequirementFlowchart from './RequirementFlowchart'

interface RequirementWorkbenchProps {
  /** 打开设置弹窗，并定位到指定分类。 */
  onOpenSettings: (section: SettingsSection) => void
}

interface BasicInfoField {
  label: string
  value: ReactNode
  wide?: boolean
  hideLabel?: boolean
}

interface BasicInfoGroup {
  title: string
  fields: BasicInfoField[]
}

/** 记住上次选择需求的 localStorage key。 */
const SELECTED_REQUIREMENT_KEY = 'develop-workbench:selected-requirement'

/**
 * 将异常转换为适合界面展示的简短文本。
 */
const getErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)

  return message.replace(/\s+/g, ' ').trim().slice(0, 280) || '未知错误'
}

/**
 * 格式化同步时间。
 */
const formatFetchedAt = (value: string): string => {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * 格式化需求更新时间。
 */
const formatUpdatedAt = (value: string | null): string => {
  if (!value) return '更新时间未知'

  const date = value.slice(0, 10)
  const today = new Date()
  const todayValue = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-')

  if (date === todayValue) return '今天更新'

  return `${date.slice(5, 7)}-${date.slice(8, 10)} 更新`
}

/**
 * 去掉需求类型里的版本后缀，例如“技术需求1.0”显示为“技术需求”。
 */
const formatRequirementType = (value: string | null): string | null =>
  value ? value.replace(/1\.0$/, '').trim() || null : null

/**
 * 状态对应的视觉分组。
 */
const getStatusTone = (status: string | null): string => {
  const value = status ?? ''

  // “待上线/待发布”仍属于未完成状态，必须在“上线/发布”之前判断。
  if (/待上线|待发布|待验收|待验证|待测试/.test(value)) return 'testing'
  if (/终止|取消|打回|拒绝/.test(value)) return 'danger'
  if (/未开始|待开始|待处理/.test(value)) return 'idle'
  if (/测试|验收/.test(value)) return 'testing'
  if (/完成|结束|上线|发布/.test(value)) return 'done'
  if (/开始|开发|进行|处理中/.test(value)) return 'active'

  return 'neutral'
}

/**
 * 优先级对应的视觉分组。
 */
const getPriorityTone = (priority: string | null): string => {
  if (priority === 'P0') return 'p0'
  if (priority === 'P1') return 'p1'
  if (priority === 'P2') return 'p2'

  return 'default'
}

/**
 * 流程节点状态文案。
 */
const getNodeStatusLabel = (status: string): string => {
  if (status === 'doing') return '进行中'
  if (status === 'finished' || status === 'done') return '已完成'
  if (status === 'not_started') return '未开始'

  return status || '未知状态'
}

/**
 * 将飞书节点状态映射为视觉分组。
 */
const getNodeTone = (status: string): string => {
  if (status === 'doing') return 'doing'
  if (status === 'finished' || status === 'done') return 'done'

  return 'idle'
}

/**
 * 格式化节点总排期，例如 10-16 ~ 10-16。
 */
const formatNodeRange = (start: string | null, end: string | null): string => {
  if (!start && !end) return '未设置'

  const startText = start ? dayjs(start).format('MM-DD') : '未设置'
  const endText = end ? dayjs(end).format('MM-DD') : '未设置'

  return `${startText} ~ ${endText}`
}

/**
 * 格式化工时，统一使用“人天”。
 */
const formatWorkTime = (value: number | null): string =>
  value !== null ? `${value} 人天` : '未设置'

/**
 * 去掉评论里的隐藏提及信息，保留可读正文。
 */
const formatCommentContent = (content: string): string =>
  content.replace(/<!--[\s\S]*?-->/g, '').trim() || '（空白评论）'

/**
 * 构造引用回复内容。
 * 飞书评论没有父评论字段，这里使用引用 + @作者 + 通知作者的方式模拟回复。
 */
const buildReplyContent = (
  comment: MeegleRequirementComment,
  replyText: string
): string => {
  const quoted = formatCommentContent(comment.content)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  const creator = comment.creator
  const text = replyText.trim()

  if (!creator) return `${quoted}\n\n${text}`

  return `${quoted}\n> —— ${creator.name}\n\n@${creator.name} ${text}`
}

/**
 * 展示人员头像和昵称。
 */
const renderPersonChip = (person: MeegleRequirementOwner, key: string): JSX.Element => (
  <span className="requirement-info-person" key={key}>
    <Avatar size={20} src={person.avatarUrl ?? undefined}>
      {person.name.slice(0, 1)}
    </Avatar>
    <span>{person.name}</span>
  </span>
)

/**
 * 展示一组人员。
 */
const renderPeople = (people: MeegleRequirementOwner[]): ReactNode => {
  if (people.length === 0) return '未填写'

  return (
    <span className="requirement-info-people">
      {people.map((person, index) =>
        renderPersonChip(person, `${person.email ?? person.name}-${index}`)
      )}
    </span>
  )
}

/**
 * 按角色展示参与人员。
 */
const renderCollaborators = (
  collaborators: MeegleRequirementCollaborator[]
): ReactNode => {
  if (collaborators.length === 0) return '未填写'

  return (
    <div className="requirement-info-collaborators">
      {collaborators.map((collaborator) => (
        <div className="requirement-info-collaborator" key={collaborator.role}>
          <span className="requirement-info-collaborator-role">{collaborator.role}</span>
          <span className="requirement-info-collaborator-members">
            {renderPeople(collaborator.members)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * 展示一组标签。
 */
const renderInfoTags = (values: string[], tone = 'gray'): ReactNode => {
  if (values.length === 0) return '未填写'

  return (
    <span className="requirement-info-value-tags">
      {values.map((value) => (
        <Tag
          key={value}
          bordered={false}
          className={`requirement-info-tag is-${tone}`}
        >
          {value}
        </Tag>
      ))}
    </span>
  )
}

/**
 * 根据“是/否”选择标签颜色。
 */
const getBooleanTagTone = (value: string): string => {
  if (value === '是') return 'orange'
  if (value === '否') return 'green'

  return 'gray'
}

/**
 * 格式化节点实际时间。
 */
const formatNodeActualTime = (
  start: string | null,
  end: string | null,
  status: string
): string => {
  if (start && end) {
    return `${dayjs(start).format('MM-DD HH:mm')} - ${dayjs(end).format('MM-DD HH:mm')}`
  }

  if (start) return `${dayjs(start).format('MM-DD HH:mm')} 开始`
  if (status === 'doing') return '进行中'
  if (status === 'finished' || status === 'done') return '未记录'

  return '未开始'
}

/**
 * 需求工作台。
 * 左侧展示当前用户的需求，右侧暂时只保留需求头部信息。
 */
export default function RequirementWorkbench({
  onOpenSettings
}: RequirementWorkbenchProps): JSX.Element {
  const { message } = App.useApp()
  const [data, setData] = useState<MeegleMyRequirements | null>(null)
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requirementFilter, setRequirementFilter] = useState('')
  const [statusFilters, setStatusFilters] = useState<string[]>([])

  // 默认全部展开，只记录被用户主动收起的迭代。
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set())

  // 搜索框引用用于快捷键聚焦、Esc 清空和清空后的焦点恢复。
  const searchInputRef = useRef<InputRef>(null)

  /** 当前用户全部需求，用于保持选中项和生成头部信息。 */
  const allRequirements = useMemo(
    () => data?.groups.flatMap((group) => group.requirements) ?? [],
    [data]
  )

  /** 当前选中的需求。 */
  const selectedRequirement =
    allRequirements.find((requirement) => requirement.id === selectedRequirementId) ?? null

  /** 当前选中需求所属的迭代分组。 */
  const selectedGroup =
    data?.groups.find((group) =>
      group.requirements.some((requirement) => requirement.id === selectedRequirementId)
    ) ?? null

  // 流程节点单独加载，避免拖慢左侧需求列表。
  const [activity, setActivity] = useState<MeegleRequirementActivity | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [activityVersion, setActivityVersion] = useState(0)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)

  /** 当前选中的流程节点。 */
  const selectedNode = activity?.nodes.find((node) => node.key === selectedNodeKey) ?? null

  /** 当前节点剩余工时 = 估分 - 实际工时。 */
  const nodeRemainingWorkTime =
    selectedNode?.points !== null &&
    selectedNode?.points !== undefined &&
    selectedNode.actualWorkTime !== null
      ? Math.max(0, selectedNode.points - selectedNode.actualWorkTime)
      : null

  // 节点估分、排期和实际工时编辑弹窗。
  const [nodeEditing, setNodeEditing] = useState(false)
  const [nodeEditRange, setNodeEditRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [nodeEditPoints, setNodeEditPoints] = useState<number | null>(null)
  const [nodeEditActualWorkTime, setNodeEditActualWorkTime] = useState<number | null>(null)
  const [nodeEditSubmitting, setNodeEditSubmitting] = useState(false)

  // 回滚弹窗。
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackReason, setRollbackReason] = useState('')
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false)

  // 评论输入。
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)

  const [replyToComment, setReplyToComment] = useState<MeegleRequirementComment | null>(null)

  /** 飞书需求详情页地址。 */
  const requirementUrl =
    selectedRequirement && data
      ? `https://project.feishu.cn/${encodeURIComponent(
          data.project.key
        )}/story/detail/${encodeURIComponent(selectedRequirement.id)}`
      : null

  /** 基本信息 Tab 的分组字段。 */
  const basicInfoGroups: BasicInfoGroup[] = selectedRequirement
    ? [
        {
          title: '基础信息',
          fields: [
            {
              label: '当前状态',
              value: selectedRequirement.status ? (
                <Tag
                  bordered={false}
                  className={`requirement-header-tag is-${getStatusTone(
                    selectedRequirement.status
                  )}`}
                >
                  {selectedRequirement.status}
                </Tag>
              ) : (
                '未填写'
              )
            },
            {
              label: '优先级',
              value: selectedRequirement.priority ? (
                <Tag
                  bordered={false}
                  className={`requirement-header-tag is-${getPriorityTone(
                    selectedRequirement.priority
                  )}`}
                >
                  {selectedRequirement.priority}
                </Tag>
              ) : (
                '未填写'
              )
            },
            {
              label: '需求类型',
              value: renderInfoTags(
                [formatRequirementType(selectedRequirement.requirementType) ?? ''].filter(Boolean),
                'blue'
              )
            },
            {
              label: '产品线',
              value: renderInfoTags(
                selectedRequirement.productLines.length > 0
                  ? [selectedRequirement.productLines.join(' / ')]
                  : [],
                'teal'
              )
            },
            {
              label: '所属迭代',
              value: renderInfoTags([selectedGroup?.iterationName ?? '未规划迭代'], 'blue')
            },
            {
              label: '需求文档',
              value: selectedRequirement.documentUrl ? (
                <a
                  className="requirement-info-doc-link"
                  href={selectedRequirement.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <LinkOutlined />
                  查看文档
                </a>
              ) : (
                '未填写'
              )
            },
            {
              label: '创建人',
              value: renderPeople(
                selectedRequirement.createdBy ? [selectedRequirement.createdBy] : []
              )
            }
          ]
        },
        {
          title: '参与人员',
          fields: [
            {
              label: '参与人员',
              wide: true,
              hideLabel: true,
              value: renderCollaborators(selectedRequirement.collaborators)
            }
          ]
        },
        {
          title: '时间与版本',
          fields: [
            { label: '提出时间', value: selectedRequirement.proposedAt ?? '未填写' },
            {
              label: '预计上线时间',
              value: selectedRequirement.expectedReleaseAt ?? '未填写'
            },
            { label: '完成日期', value: selectedRequirement.completedAt ?? '未填写' },
            {
              label: '规划版本',
              value: renderInfoTags(selectedRequirement.planningVersions, 'purple')
            },
            {
              label: '实际上车版本',
              value: renderInfoTags(selectedRequirement.actualReleaseVersions, 'cyan')
            }
          ]
        },
        {
          title: '研发属性',
          fields: [
            {
              label: '需求等级',
              value: renderInfoTags(
                selectedRequirement.requirementLevel ? [selectedRequirement.requirementLevel] : [],
                'orange'
              )
            },
            {
              label: '需求性质',
              value: renderInfoTags(
                selectedRequirement.requirementNature ? [selectedRequirement.requirementNature] : [],
                'pink'
              )
            },
            {
              label: '需求复杂度',
              value: renderInfoTags(
                selectedRequirement.complexity !== null
                  ? [String(selectedRequirement.complexity)]
                  : [],
                'gray'
              )
            },
            {
              label: '研发难度估分',
              value: renderInfoTags(
                selectedRequirement.developmentDifficulty !== null
                  ? [String(selectedRequirement.developmentDifficulty)]
                  : [],
                'gray'
              )
            },
            {
              label: '预估开发量',
              value: renderInfoTags(
                selectedRequirement.estimatedWorkload ? [selectedRequirement.estimatedWorkload] : [],
                'gray'
              )
            },
            {
              label: '技术方案',
              value: selectedRequirement.technicalSolution ?? '未填写'
            },
            {
              label: '应用',
              value: renderInfoTags(
                selectedRequirement.application ? [selectedRequirement.application] : [],
                'teal'
              )
            },
            { label: '标签', value: renderInfoTags(selectedRequirement.tags, 'green') },
            {
              label: '是否涉及权限',
              value: selectedRequirement.permissionsInvolved
                ? renderInfoTags(
                    [selectedRequirement.permissionsInvolved],
                    getBooleanTagTone(selectedRequirement.permissionsInvolved)
                  )
                : '未填写'
            },
            {
              label: '是否涉及历史数据',
              value: selectedRequirement.historicalDataInvolved
                ? renderInfoTags(
                    [selectedRequirement.historicalDataInvolved],
                    getBooleanTagTone(selectedRequirement.historicalDataInvolved)
                  )
                : '未填写'
            },
            {
              label: '是否涉及性能测试',
              value: selectedRequirement.performanceTestInvolved
                ? renderInfoTags(
                    [selectedRequirement.performanceTestInvolved],
                    getBooleanTagTone(selectedRequirement.performanceTestInvolved)
                  )
                : '未填写'
            }
          ]
        }
      ]
    : []

  /**
   * 读取当前用户负责的需求，并尽量保留已有选择。
   */
  const loadRequirements = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const result = await window.electron.getMyRequirements()
      const storedId = localStorage.getItem(SELECTED_REQUIREMENT_KEY)

      setData(result)
      setSelectedRequirementId((currentId) => {
        const preferredId = currentId ?? storedId
        const requirements = result.groups.flatMap((group) => group.requirements)

        return (
          requirements.find((requirement) => requirement.id === preferredId)?.id ??
          requirements[0]?.id ??
          null
        )
      })
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRequirements()
  }, [loadRequirements])

  /**
   * 刷新需求和流程节点。
   */
  const refreshWorkbench = useCallback(async (): Promise<void> => {
    setActivityVersion((value) => value + 1)
    await loadRequirements()
  }, [loadRequirements])

  /**
   * 切换需求时清空节点选择；同一需求刷新时保留当前选中的节点。
   */
  useEffect(() => {
    setSelectedNodeKey(null)
  }, [selectedRequirementId])

  /**
   * 选中需求后读取流程节点。
   */
  useEffect(() => {
    if (!selectedRequirementId) {
      setActivity(null)
      setSelectedNodeKey(null)
      setActivityError(null)
      return
    }

    let cancelled = false
    setActivity(null)
    setActivityLoading(true)
    setActivityError(null)

    window.electron
      .getRequirementActivity(selectedRequirementId)
      .then((result) => {
        if (cancelled) return

        setActivity(result)
        setSelectedNodeKey((currentKey) => {
          if (currentKey && result.nodes.some((node) => node.key === currentKey)) {
            return currentKey
          }

          return (
            result.nodes.find((node) => node.status === 'doing')?.key ??
            result.nodes[0]?.key ??
            null
          )
        })
      })
      .catch((loadError) => {
        if (!cancelled) setActivityError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activityVersion, selectedRequirementId])

  /**
   * 切换需求或节点时退出内联编辑，避免把上一个节点的值带到新节点。
   */
  useEffect(() => {
    setNodeEditing(false)
    setRollbackOpen(false)
  }, [selectedNodeKey, selectedRequirementId])

  useEffect(() => {
    setCommentDraft('')
    setReplyToComment(null)
  }, [selectedRequirementId])

  /**
   * 打开节点内联编辑，并带入现有排期、估分和实际工时。
   */
  const openNodeEditor = (): void => {
    if (!selectedNode) return

    const start = selectedNode.scheduleStart ? dayjs(selectedNode.scheduleStart) : null
    const end = selectedNode.scheduleEnd ? dayjs(selectedNode.scheduleEnd) : null

    setNodeEditRange(start?.isValid() && end?.isValid() ? [start, end] : null)
    setNodeEditPoints(selectedNode.points)
    setNodeEditActualWorkTime(selectedNode.actualWorkTime)
    setNodeEditing(true)
  }

  /**
   * 保存节点排期、估分和实际工时。
   */
  const handleSaveNodeInfo = async (): Promise<void> => {
    if (!selectedRequirementId || !selectedNode) return

    const pointsChanged = nodeEditPoints !== selectedNode.points

    if (!nodeEditRange && pointsChanged) {
      message.warning('修改估分前请先设置总排期')
      return
    }

    setNodeEditSubmitting(true)

    try {
      const originalStart = selectedNode.scheduleStart
        ? dayjs(selectedNode.scheduleStart)
        : null
      const originalEnd = selectedNode.scheduleEnd ? dayjs(selectedNode.scheduleEnd) : null
      const startAt = nodeEditRange
        ? originalStart?.isSame(nodeEditRange[0], 'day')
          ? originalStart.valueOf()
          : nodeEditRange[0].startOf('day').valueOf()
        : undefined
      const endAt = nodeEditRange
        ? originalEnd?.isSame(nodeEditRange[1], 'day')
          ? originalEnd.valueOf()
          : nodeEditRange[1].endOf('day').valueOf()
        : undefined

      await window.electron.updateRequirementNode(selectedRequirementId, selectedNode.key, {
        startAt,
        endAt,
        points: nodeEditRange ? (nodeEditPoints ?? undefined) : undefined,
        actualWorkTime: nodeEditActualWorkTime
      })
      message.success('节点信息已更新')
      setNodeEditing(false)
      setActivityVersion((value) => value + 1)
    } catch (saveError) {
      message.error(getErrorMessage(saveError))
    } finally {
      setNodeEditSubmitting(false)
    }
  }

  /**
   * 回滚当前节点，必须填写回滚原因。
   */
  const handleRollbackNode = async (): Promise<void> => {
    if (!selectedRequirementId || !selectedNode || !rollbackReason.trim()) return

    setRollbackSubmitting(true)

    try {
      await window.electron.transitionRequirementNode(
        selectedRequirementId,
        selectedNode.key,
        'rollback',
        rollbackReason.trim()
      )
      message.success(`节点「${selectedNode.name}」已回滚`)
      setRollbackOpen(false)
      setRollbackReason('')
      setNodeEditing(false)
      await refreshWorkbench()
    } catch (rollbackError) {
      message.error(getErrorMessage(rollbackError))
    } finally {
      setRollbackSubmitting(false)
    }
  }

  /**
   * 开始引用回复。
   */
  const handleStartReply = (comment: MeegleRequirementComment): void => {
    setReplyToComment(comment)
  }

  /**
   * 取消引用回复。
   */
  const handleCancelReply = (): void => {
    setReplyToComment(null)
  }

  /**
   * 发表评论并刷新评论列表。
   */
  const handleAddComment = async (): Promise<void> => {
    if (!selectedRequirementId) return

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

      await window.electron.addRequirementComment(
        selectedRequirementId,
        content,
        notifyUserKeys
      )
      setCommentDraft('')
      setReplyToComment(null)
      message.success(replyToComment ? '回复已发表' : '评论已发表')
      setActivityVersion((value) => value + 1)
    } catch (commentError) {
      message.error(getErrorMessage(commentError))
    } finally {
      setCommentSubmitting(false)
    }
  }

  /**
   * 记住用户选择的需求，下次打开时继续展示。
   */
  useEffect(() => {
    if (selectedRequirementId) {
      localStorage.setItem(SELECTED_REQUIREMENT_KEY, selectedRequirementId)
    }
  }, [selectedRequirementId])

  /**
   * 状态筛选项。
   * 使用全部需求统计数量，避免搜索时选项数量频繁变化。
   */
  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>()

    for (const requirement of allRequirements) {
      const status = requirement.status ?? '状态未知'
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
  }, [allRequirements])

  /**
   * 先按状态筛选，再按需求名称、状态或迭代名称搜索。
   * 迭代名称命中时，保留该迭代下符合状态条件的全部需求。
   */
  const filteredGroups = useMemo(() => {
    const keyword = requirementFilter.trim().toLocaleLowerCase()

    const selectedStatuses = new Set(statusFilters)

    return (data?.groups ?? []).flatMap((group) => {
      const statusFiltered =
        selectedStatuses.size > 0
          ? group.requirements.filter((requirement) =>
              selectedStatuses.has(requirement.status ?? '状态未知')
            )
          : group.requirements

      if (statusFiltered.length === 0) return []

      if (!keyword || group.iterationName.toLocaleLowerCase().includes(keyword)) {
        return [{ ...group, requirements: statusFiltered }]
      }

      const requirements = statusFiltered.filter((requirement) =>
        [
          requirement.name,
          requirement.status ?? '',
          requirement.priority ?? '',
          requirement.requirementType ?? '',
          requirement.riskLabels.join(' '),
          requirement.productManagers.map((manager) => manager.name).join(' '),
          requirement.productOwners.map((owner) => owner.name).join(' ')
        ].some((value) => value.toLocaleLowerCase().includes(keyword))
      )

      return requirements.length > 0 ? [{ ...group, requirements }] : []
    })
  }, [data, requirementFilter, statusFilters])

  /** 是否存在有效搜索词或状态筛选。 */
  const hasSearch = requirementFilter.trim().length > 0
  const hasActiveFilter = hasSearch || statusFilters.length > 0

  /** 所有分组是否都已收起，用于切换按钮的文案和图标。 */
  const allGroupsCollapsed =
    (data?.groups.length ?? 0) > 0 &&
    (data?.groups ?? []).every((group) => collapsedGroupKeys.has(group.key))

  /** 筛选时自动展开分组，同时隐藏全部收起按钮。 */
  const showToggleAll = (data?.groups.length ?? 0) > 1 && !hasActiveFilter

  /**
   * 当筛选结果中不包含当前选中需求时，自动选中第一条可见需求。
   */
  useEffect(() => {
    if (filteredGroups.length === 0) return

    const visibleIds = new Set(
      filteredGroups.flatMap((group) => group.requirements.map((requirement) => requirement.id))
    )

    if (selectedRequirementId && visibleIds.has(selectedRequirementId)) return

    const firstRequirementId = filteredGroups[0]?.requirements[0]?.id

    if (firstRequirementId) setSelectedRequirementId(firstRequirementId)
  }, [filteredGroups, selectedRequirementId])

  /**
   * 收起或展开一个迭代分组。
   * 使用新的 Set 触发 React 更新，避免直接修改原状态。
   */
  const toggleRequirementGroup = (groupKey: string): void => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current)

      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }

      return next
    })
  }

  /**
   * 一键展开或收起全部迭代分组。
   */
  const toggleAllRequirementGroups = (): void => {
    if (!data) return

    setCollapsedGroupKeys((current) => {
      const allCollapsed = data.groups.every((group) => current.has(group.key))

      return allCollapsed ? new Set() : new Set(data.groups.map((group) => group.key))
    })
  }

  /**
   * 搜索快捷键：Cmd/Ctrl+K 聚焦，Esc 清空并退出搜索。
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isFocusShortcut =
        (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k'

      if (isFocusShortcut) {
        event.preventDefault()
        searchInputRef.current?.focus()
        return
      }

      if (event.key === 'Escape' && searchInputRef.current?.input === document.activeElement) {
        event.preventDefault()
        setRequirementFilter('')
        searchInputRef.current?.blur()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  /**
   * 选中需求后将其滚动到左侧列表可见区域。
   * 刷新或恢复上次选择时尤其有用。
   */
  useEffect(() => {
    if (!selectedRequirementId) return

    document
      .getElementById(`workbench-requirement-${selectedRequirementId}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedRequirementId, data, requirementFilter])

  /**
   * 渲染左侧单条需求。
   */
  const renderRequirementItem = (requirement: MeegleRequirement): JSX.Element => (
    <button
      key={requirement.id}
      id={`workbench-requirement-${requirement.id}`}
      type="button"
      className={`workbench-requirement-item${
        requirement.id === selectedRequirementId ? ' is-active' : ''
      }`}
      aria-current={requirement.id === selectedRequirementId ? 'true' : undefined}
      onClick={() => setSelectedRequirementId(requirement.id)}
    >
      <span className="workbench-requirement-item-title-row">
        {requirement.priority === 'P0' ||
        requirement.priority === 'P1' ||
        requirement.priority === 'P2' ? (
          <span className={`requirement-priority is-${getPriorityTone(requirement.priority)}`}>
            {requirement.priority}
          </span>
        ) : null}
        <span className="workbench-requirement-item-name" title={requirement.name}>
          {requirement.name}
        </span>
      </span>
      <span className="workbench-requirement-item-top">
        <span className="workbench-requirement-item-state">
          <span className={`requirement-status-dot is-${getStatusTone(requirement.status)}`} />
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
            return (
              <span className="workbench-requirement-item-owner is-empty">
                产品经理未填写
              </span>
            )
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
                  {productContact.members.length > 1
                    ? ` +${productContact.members.length - 1}`
                    : ''}
                </span>
              </span>
            </Tooltip>
          )
        })()}
      </span>
      <span className="workbench-requirement-item-footer">
        <span className="workbench-requirement-item-tags">
          {requirement.riskLabels.length > 0 ? (
            <Tooltip title={requirement.riskLabels.join('、')}>
              <span className="workbench-requirement-risk">{requirement.riskLabels[0]}</span>
            </Tooltip>
          ) : null}
          {formatRequirementType(requirement.requirementType) ? (
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

  /**
   * 渲染左侧需求分组。
   * 搜索时忽略收起状态，确保匹配结果始终可见。
   */
  const renderRequirementGroup = (group: MeegleRequirementGroup): JSX.Element => {
    const collapsed = collapsedGroupKeys.has(group.key) && !hasActiveFilter

    return (
      <section className="workbench-requirement-group" key={group.key}>
        <button
          type="button"
          className={`workbench-requirement-group-heading${collapsed ? ' is-collapsed' : ''}`}
          aria-expanded={!collapsed}
          onClick={() => toggleRequirementGroup(group.key)}
        >
          <span className="workbench-requirement-group-title">
            <DownOutlined className="workbench-requirement-group-chevron" />
            <span className="workbench-requirement-group-name">{group.iterationName}</span>
          </span>
          <span className="workbench-requirement-group-count">{group.requirements.length}</span>
        </button>

        {collapsed ? null : (
          <div className="workbench-requirement-group-list">
            {group.requirements.map(renderRequirementItem)}
          </div>
        )}
      </section>
    )
  }

  const projectName = data?.project.name ?? 'Meegle'

  return (
    <div className="workbench">
      {/* 左侧：当前用户负责的需求，按所属迭代分组。 */}
      <aside className="workbench-sidebar">
        <div className="workbench-brand">
          <div className="workbench-brand-mark">W</div>
          <div className="workbench-brand-text">
            <strong>研发工作台</strong>
            <span>{projectName}</span>
          </div>
        </div>

        <div className="workbench-sidebar-heading">
          <span>我负责的需求</span>
          <span className="workbench-sidebar-heading-actions">
            <span className="workbench-sidebar-count">{data?.total ?? 0}</span>
            <Tooltip title="刷新数据">
              <Button
                type="text"
                size="small"
                className="workbench-sidebar-refresh"
                icon={<ReloadOutlined />}
                loading={loading || activityLoading}
                aria-label="刷新数据"
                onClick={() => refreshWorkbench()}
              />
            </Tooltip>
            {showToggleAll ? (
              <Tooltip title={allGroupsCollapsed ? '全部展开' : '全部收起'}>
                <Button
                  type="text"
                  size="small"
                  className="workbench-toggle-all"
                  icon={allGroupsCollapsed ? <NodeExpandOutlined /> : <NodeCollapseOutlined />}
                  aria-label={allGroupsCollapsed ? '全部展开' : '全部收起'}
                  onClick={toggleAllRequirementGroups}
                />
              </Tooltip>
            ) : null}
          </span>
        </div>

        <div className="workbench-filter-stack">
          <Input
            ref={searchInputRef}
            className="workbench-requirement-search"
            prefix={<SearchOutlined />}
            placeholder={
              window.electron.platform === 'darwin'
                ? '搜索需求、状态或迭代  ⌘K'
                : '搜索需求、状态或迭代  Ctrl K'
            }
            aria-keyshortcuts="Meta+K Control+K"
            value={requirementFilter}
            onChange={(event) => setRequirementFilter(event.target.value)}
            allowClear
            disabled={loading || !data}
          />

          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            maxTagPlaceholder={(omitted) => `+${omitted.length}`}
            className="workbench-status-filter"
            value={statusFilters}
            options={statusOptions}
            placeholder={`全部状态（${allRequirements.length}）`}
            aria-label="按状态筛选"
            disabled={loading || !data || allRequirements.length === 0}
            onChange={(values: string[]) => setStatusFilters(values)}
          />
        </div>

        {/* 只有首次加载时显示骨架屏；刷新时保留已有列表，避免界面跳动。 */}
        <div className="workbench-requirement-groups">
          {loading && !data ? (
            <div className="workbench-requirement-skeleton">
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} active paragraph={false} title={{ width: '82%' }} />
              ))}
            </div>
          ) : filteredGroups.length > 0 ? (
            filteredGroups.map(renderRequirementGroup)
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={data?.total === 0 ? '当前没有待办需求' : '没有匹配的需求'}
            />
          )}
        </div>

        <p className="workbench-sidebar-footnote">
          数据来自 Meegle 我负责的需求
          {data ? ` · 同步于 ${formatFetchedAt(data.fetchedAt)}` : ''}
        </p>
      </aside>

      {/* 右侧：暂时只保留需求头部信息。 */}
      <section className="workbench-main">
        {error && !data ? (
          <div className="workbench-state">
            <div className="workbench-state-card">
              <Alert
                type="error"
                showIcon
                message="无法读取当前用户需求"
                description={error}
              />
              <div className="workbench-state-actions">
                <Button type="primary" onClick={() => loadRequirements()}>
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
        ) : selectedRequirement ? (
          <>
            <header className="workbench-header">
              <div className="workbench-heading">
                <span className="workbench-eyebrow">
                  {projectName} / {selectedGroup?.iterationName ?? '我负责的需求'}
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
                      onClick={() => refreshWorkbench()}
                    />
                  </Tooltip>
                  <h1>{selectedRequirement.name}</h1>
                </div>
                <div className="workbench-heading-meta">
                  <Tag
                    className={`requirement-header-tag is-${getStatusTone(
                      selectedRequirement.status
                    )}`}
                  >
                    <span
                      className={`requirement-status-dot is-${getStatusTone(
                        selectedRequirement.status
                      )}`}
                    />
                    {selectedRequirement.status ?? '状态未知'}
                  </Tag>
                  {selectedRequirement.priority ? (
                    <Tag
                      className={`requirement-header-tag is-${getPriorityTone(
                        selectedRequirement.priority
                      )}`}
                    >
                      {selectedRequirement.priority}
                    </Tag>
                  ) : null}
                  <span className="workbench-updated-at">
                    {formatUpdatedAt(selectedRequirement.updatedAt)}
                  </span>
                </div>
              </div>

              {requirementUrl ? (
                <Button
                  variant="filled"
                  size="small"
                  className="workbench-open-feishu"
                  icon={<ExportOutlined />}
                  href={requirementUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  在浏览器打开
                </Button>
              ) : null}
            </header>

            <div className="workbench-content">
              {error ? (
                <Alert
                  className="workbench-inline-alert"
                  type="warning"
                  showIcon
                  closable
                  message="刷新数据失败，当前展示上次同步结果"
                  description={error}
                  onClose={() => setError(null)}
                />
              ) : null}

              <section className="requirement-flow-section">
                {activityError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="流程节点加载失败"
                    description={activityError}
                    action={
                      <Button
                        size="small"
                        onClick={() => setActivityVersion((value) => value + 1)}
                      >
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
                      onSelectNode={setSelectedNodeKey}
                    />

                    {selectedNode ? (
                      <div className="requirement-node-detail">
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
                              <Button
                                size="small"
                                onClick={() => setNodeEditing(false)}
                              >
                                取消
                              </Button>
                              <Button
                                type="primary"
                                size="small"
                                loading={nodeEditSubmitting}
                                onClick={() => handleSaveNodeInfo()}
                              >
                                保存
                              </Button>
                            </span>
                          ) : (
                            <span className="requirement-node-head-actions">
                              {selectedNode.status === 'doing' ? (
                                <Button
                                  type="text"
                                  danger
                                  size="small"
                                  className="requirement-node-rollback-button"
                                  icon={<RollbackOutlined />}
                                  onClick={() => {
                                    setRollbackReason('')
                                    setRollbackOpen(true)
                                  }}
                                >
                                  回滚
                                </Button>
                              ) : null}
                              <Button
                                type="text"
                                size="small"
                                className="requirement-node-edit-button"
                                icon={<EditOutlined />}
                                onClick={openNodeEditor}
                              >
                                编辑
                              </Button>
                            </span>
                          )}
                        </div>

                        <div className={`requirement-node-summary-card${nodeEditing ? ' is-editing' : ''}`}>
                          <div className="requirement-node-summary-block is-owner">
                            <span className="requirement-node-summary-label">
                              负责人 <em>*</em>
                            </span>
                            <div className="requirement-node-owner-list">
                              {selectedNode.owners.length > 0 ? (
                                selectedNode.owners.map((owner, index) => (
                                  <span
                                    className="requirement-node-owner"
                                    key={`${owner.email ?? owner.name}-${index}`}
                                  >
                                    <Avatar
                                      size={20}
                                      src={owner.avatarUrl ?? undefined}
                                    >
                                      {owner.name.slice(0, 1)}
                                    </Avatar>
                                    {owner.name}
                                  </span>
                                ))
                              ) : (
                                <span className="requirement-node-summary-empty">未分配</span>
                              )}
                            </div>
                          </div>

                          <div className="requirement-node-summary-block">
                            <span className="requirement-node-summary-label">
                              总估分 <em>*</em>
                            </span>
                            {nodeEditing ? (
                              <InputNumber
                                size="small"
                                min={0}
                                step={0.1}
                                className="requirement-node-inline-input"
                                value={nodeEditPoints}
                                placeholder="未设置"
                                onChange={(value) =>
                                  setNodeEditPoints(typeof value === 'number' ? value : null)
                                }
                              />
                            ) : (
                              <strong>{formatWorkTime(selectedNode.points)}</strong>
                            )}
                          </div>

                          <div className="requirement-node-summary-block">
                            <span className="requirement-node-summary-label">
                              总排期 <em>*</em>
                            </span>
                            {nodeEditing ? (
                              <DatePicker.RangePicker
                                size="small"
                                format="MM-DD"
                                className="requirement-node-inline-range"
                                value={nodeEditRange}
                                onChange={(value) =>
                                  setNodeEditRange(value as [Dayjs, Dayjs] | null)
                                }
                              />
                            ) : (
                              <strong>
                                {formatNodeRange(
                                  selectedNode.scheduleStart,
                                  selectedNode.scheduleEnd
                                )}
                              </strong>
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

                        <details className="requirement-node-section" open>
                          <summary>工时</summary>
                          <div className="requirement-node-workhour">
                            <div className="requirement-node-workhour-row">
                              <span>
                                总实际工时 <em>*</em>
                              </span>
                              {nodeEditing ? (
                                <InputNumber
                                  size="small"
                                  min={0}
                                  step={0.1}
                                  className="requirement-node-inline-input"
                                  value={nodeEditActualWorkTime}
                                  placeholder="未记录"
                                  onChange={(value) =>
                                    setNodeEditActualWorkTime(
                                      typeof value === 'number' ? value : null
                                    )
                                  }
                                />
                              ) : (
                                <strong>
                                  {formatWorkTime(selectedNode.actualWorkTime)}
                                </strong>
                              )}
                            </div>
                            <div className="requirement-node-workhour-summary">
                              <span>总估分：{formatWorkTime(selectedNode.points)}</span>
                              <span>总剩余工时：{formatWorkTime(nodeRemainingWorkTime)}</span>
                            </div>
                            <div className="requirement-node-workhour-actual">
                              实际时间：
                              {formatNodeActualTime(
                                selectedNode.actualStart,
                                selectedNode.actualEnd,
                                selectedNode.status
                              )}
                            </div>
                          </div>
                        </details>
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
                            </div>
                            <Typography.Paragraph
                              className="requirement-description-text"
                              ellipsis={{
                                rows: 6,
                                expandable: true,
                                symbol: '展开'
                              }}
                            >
                              {selectedRequirement.description || '暂无需求描述'}
                            </Typography.Paragraph>
                          </div>

                          <div className="requirement-info-groups">
                            {basicInfoGroups.map((group) => (
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
                        </div>
                      )
                    },
                    {
                      key: 'comments',
                      label: '评论/备注',
                      children: (
                        <div className="requirement-info-tab">
                          {selectedRequirement.remark ? (
                            <div className="requirement-remark-block">
                              <h3>备注</h3>
                              <p>{selectedRequirement.remark}</p>
                            </div>
                          ) : null}

                          <div className="requirement-comments-heading">
                            <h3>评论</h3>
                            {activity ? (
                              <span>{activity.commentsTotal} 条</span>
                            ) : null}
                          </div>

                          {activityError ? (
                            <Alert
                              type="error"
                              showIcon
                              message="评论加载失败"
                              description={activityError}
                              action={
                                <Button
                                  size="small"
                                  onClick={() => setActivityVersion((value) => value + 1)}
                                >
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
                                          <strong>
                                            {comment.creator?.name ?? '未知成员'}
                                          </strong>
                                          <div className="requirement-comment-meta">
                                            <span>{comment.createdAt ?? ''}</span>
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
                                        <div className="requirement-comment-markdown">
                                          <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                              a: ({ href, children }) => (
                                                <a
                                                  href={href}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                >
                                                  {children}
                                                </a>
                                              )
                                            }}
                                          >
                                            {formatCommentContent(comment.content)}
                                          </ReactMarkdown>
                                        </div>
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
                                    <Button
                                      type="text"
                                      size="small"
                                      onClick={handleCancelReply}
                                    >
                                      取消
                                    </Button>
                                  </div>
                                ) : null}
                                <Input.TextArea
                                  rows={3}
                                  value={commentDraft}
                                  placeholder={
                                    replyToComment
                                      ? `回复 ${replyToComment.creator?.name ?? '未知成员'}`
                                      : '写下评论，支持 Markdown'
                                  }
                                  disabled={commentSubmitting}
                                  onChange={(event) => setCommentDraft(event.target.value)}
                                />
                                <div className="requirement-comment-editor-footer">
                                  <span>评论会直接同步到飞书项目</span>
                                  <Button
                                    type="primary"
                                    size="small"
                                    loading={commentSubmitting}
                                    onClick={() => handleAddComment()}
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
            </div>
          </>
        ) : (
          <div className="workbench-state">
            <div className="workbench-state-card">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="从左侧选择一条需求"
              />
              <div className="workbench-state-actions">
                <Button type="primary" onClick={() => loadRequirements()}>
                  重新读取
                </Button>
                <Button onClick={() => onOpenSettings('meegle')}>检查 Meegle 设置</Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <Modal
        title="回滚节点"
        open={rollbackOpen}
        okText="回滚"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !rollbackReason.trim() }}
        confirmLoading={rollbackSubmitting}
        destroyOnHidden
        onOk={() => handleRollbackNode()}
        onCancel={() => {
          setRollbackOpen(false)
          setRollbackReason('')
        }}
      >
        <div className="requirement-rollback-form">
          <p>
            将节点「{selectedNode?.name ?? ''}」回滚到上一节点。操作会直接写入飞书项目。
          </p>
          <label>回滚原因 *</label>
          <Input.TextArea
            rows={3}
            value={rollbackReason}
            placeholder="填写回滚原因"
            onChange={(event) => setRollbackReason(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
