import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import dayjs from 'dayjs'
import { pinyin } from 'pinyin-pro'
import {
  CheckCircleFilled,
  ClockCircleFilled,
  CloseOutlined,
  BranchesOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  MinusCircleOutlined,
  NodeCollapseOutlined,
  NodeExpandOutlined,
  DeploymentUnitOutlined,
  PlusOutlined,
  PullRequestOutlined,
  ReloadOutlined,
  RightOutlined,
  RollbackOutlined,
  SearchOutlined,
  TagOutlined
} from '@ant-design/icons'
import {
  Alert,
  App,
  Avatar,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Skeleton,
  Spin,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { InputRef } from 'antd'
import type { Dayjs } from 'dayjs'
import type { RequirementRepoBinding } from '../../../../types/bindings'
import type { LocalRequirementInput } from '../../../../types/local-requirements'
import type { RequirementPersonalStatus } from '../../../../types/requirement-status'
import type { LarkUser } from '../../../../types/lark'
import { getErrorMessage } from '../../../../utils'
import type { Repository, RepositoryBindingStatus } from '../../../../types/repository'
import type {
  MeegleMyRequirements,
  MeegleProject,
  MeegleRequirement,
  MeegleRequirementActivity,
  MeegleRequirementCollaborator,
  MeegleRequirementComment,
  MeegleRequirementGroup,
  MeegleRequirementOwner
} from '../../../../types/requirements'
import type { SettingsSection } from '../../../../types/settings'
import RobotMark from '../../components/RobotMark/RobotMark'
import LocalRequirementModal from '../../components/LocalRequirementModal/LocalRequirementModal'
import type { LocalRequirementVersionOption } from '../../components/LocalRequirementModal/LocalRequirementModal'
import { useAiChatDialog } from '../../hooks/useAiChatDialog'
import MarkdownContent from '../../components/MarkdownContent/MarkdownContent'
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor'
import RequirementFlowchart from '../../components/RequirementFlowchart/RequirementFlowchart'

interface RequirementWorkbenchProps {
  /** 打开设置弹窗，并定位到指定分类。 */
  onOpenSettings: (section: SettingsSection) => void
  /** 当前飞书用户，用于生成分支名首字母。 */
  larkUser: LarkUser | null
}

/**
 * 提取用户姓名首字母，中文按拼音首字母转换。
 * 例如“凌凯”转换为 lk。
 */
const getUserNameInitials = (name: string | null | undefined): string => {
  const normalized = name?.trim()

  if (!normalized) return 'dev'

  if (!/[\u3400-\u9fff]/.test(normalized)) {
    const words = normalized.match(/[a-z]+/gi) ?? []
    const initials = words.map((word) => word[0]).join('').toLowerCase()

    return initials.slice(0, 4) || 'dev'
  }

  const initials = pinyin(normalized, {
    pattern: 'first',
    toneType: 'none',
    type: 'array'
  })
    .join('')
    .replace(/[^a-z]/gi, '')
    .toLowerCase()

  return initials.slice(0, 4) || 'dev'
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

interface BranchRowProps {
  label: string
  value: string | null
  placeholder: string
  status?: ReactNode
  tone?: 'requirement' | 'iteration'
  icon?: ReactNode
  onCopy: (value: string) => void
}

/**
 * 只读分支行：分支名 + 复制按钮 + 状态标签。
 */
const BranchRow = ({
  label,
  value,
  placeholder,
  status,
  tone,
  icon,
  onCopy
}: BranchRowProps): JSX.Element => (
  <div
    className={`requirement-repo-branch-row${tone ? ` is-${tone}` : ''}`}
  >
    {icon ? <span className="requirement-repo-branch-icon">{icon}</span> : null}
    <span className="requirement-repo-branch-label">{label}</span>
    {value ? (
      <span className="requirement-repo-branch-name" title={value}>
        {value}
      </span>
    ) : (
      <span className="requirement-repo-branch-empty">{placeholder}</span>
    )}
    {value ? (
      <Tooltip title="复制分支名">
        <Button
          type="text"
          size="small"
          className="requirement-repo-copy-branch"
          icon={<CopyOutlined />}
          aria-label={`复制 ${label}`}
          onClick={() => onCopy(value)}
        />
      </Tooltip>
    ) : (
      <span className="requirement-repo-copy-slot" />
    )}
    <span className="requirement-repo-branch-status">{status}</span>
  </div>
)

/** 判断是否为本地临时需求。 */
const isLocalRequirementId = (id: string | null): boolean =>
  Boolean(id?.startsWith('local:'))

/** 记住上次选择需求的 localStorage key。 */
const SELECTED_REQUIREMENT_KEY = 'develop-workbench:selected-requirement'
/** 打开已结束本地需求时的一次性标记。 */
const OPEN_CLOSED_REQUIREMENT_KEY = 'develop-workbench:open-closed-requirement'
/** 记住是否预置 IDE 会话的 localStorage key。 */
const IDE_SESSION_PROMPT_KEY = 'develop-workbench:ide-session-prompt'

/**
 * 将 Git 远程地址转换为不包含 .git 的仓库根地址。
 * 支持 https 和常见 SSH 地址。
 */
const getRemoteRepositoryBaseUrl = (remoteUrl?: string | null): string | null => {
  if (!remoteUrl?.trim()) return null

  let normalized = remoteUrl.trim()

  const scpMatch = normalized.match(/^git@([^:]+):(.+)$/)
  const sshMatch = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/)

  if (scpMatch) {
    normalized = `https://${scpMatch[1]}/${scpMatch[2]}`
  } else if (sshMatch) {
    normalized = `https://${sshMatch[1]}/${sshMatch[2]}`
  }

  try {
    const url = new URL(normalized)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    const path = url.pathname.replace(/\.git\/?$/i, '').replace(/\/$/, '')

    return path ? `${url.origin}${path}` : null
  } catch {
    return null
  }
}

/** 打开远程仓库分支页面。 */
const getRemoteBranchesUrl = (remoteUrl?: string | null): string | null => {
  const baseUrl = getRemoteRepositoryBaseUrl(remoteUrl)

  return baseUrl ? `${baseUrl}/branches` : null
}

/** 按 Codeup 地址格式生成创建合并请求页面。 */
const getMergeRequestUrl = (
  remoteUrl: string | null | undefined,
  sourceBranch: string,
  targetBranch: string
): string | null => {
  const baseUrl = getRemoteRepositoryBaseUrl(remoteUrl)

  if (!baseUrl) return null

  return `${baseUrl}/changes/new?target_branch=${encodeURIComponent(
    targetBranch
  )}&source_branch=${encodeURIComponent(sourceBranch)}`
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
 * 清理飞书内部 HTML 标记。
 * 不能直接删除注释，否则裸 URL 会和后面的中文标点连在一起被自动链接吞掉。
 */
const stripFeishuMarkers = (content: string): string =>
  content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

/**
 * 去掉评论里的隐藏提及信息，保留可读正文。
 */
const formatCommentContent = (content: string): string =>
  stripFeishuMarkers(content) || '（空白评论）'

/**
 * 清理需求描述中的飞书内部标记。
 */
const cleanMarkdownContent = (content: string): string => stripFeishuMarkers(content)

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
  onOpenSettings,
  larkUser
}: RequirementWorkbenchProps): JSX.Element {
  const { message, notification } = App.useApp()
  const { openAiDialog } = useAiChatDialog()
  const [data, setData] = useState<MeegleMyRequirements | null>(null)
  const [projects, setProjects] = useState<MeegleProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectSwitching, setProjectSwitching] = useState(false)
  const projectSwitchRef = useRef(false)
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null)
  const [personalStatus, setPersonalStatus] = useState<RequirementPersonalStatus | null>(null)
  const [personalStatusLoading, setPersonalStatusLoading] = useState(false)
  const [personalStatusEditing, setPersonalStatusEditing] = useState(false)
  const [personalStatusDraft, setPersonalStatusDraft] = useState('')
  const [personalStatusSaving, setPersonalStatusSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requirementFilter, setRequirementFilter] = useState('')
  const [showClosedRequirements, setShowClosedRequirements] = useState(
    () => localStorage.getItem(OPEN_CLOSED_REQUIREMENT_KEY) === '1'
  )
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [iterationFilter, setIterationFilter] = useState<string | null>(null)
  const [localModalOpen, setLocalModalOpen] = useState(false)
  const [localModalRequirement, setLocalModalRequirement] =
    useState<MeegleRequirement | null>(null)
  const [localSaving, setLocalSaving] = useState(false)
  const [localDeleting, setLocalDeleting] = useState(false)

  // 默认全部展开，只记录被用户主动收起的迭代。
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set())

  // 搜索框引用用于快捷键聚焦、Esc 清空和清空后的焦点恢复。
  const searchInputRef = useRef<InputRef>(null)

  /** 当前用户全部需求，用于保持选中项和生成头部信息。 */
  const allRequirements = useMemo(
    () => data?.groups.flatMap((group) => group.requirements) ?? [],
    [data]
  )

  /** 空间选择器选项，始终包含当前需求列表所属空间。 */
  const projectOptions = useMemo(() => {
    const options = new Map(projects.map((project) => [project.projectKey, project]))

    if (data?.project) {
      options.set(data.project.projectKey, data.project)
    }

    return Array.from(options.values()).map((project) => ({
      value: project.projectKey,
      label: project.name
    }))
  }, [data?.project, projects])

  /** 当前选中的需求。 */
  const selectedRequirement =
    allRequirements.find((requirement) => requirement.id === selectedRequirementId) ?? null

  /** 当前选中需求所属的迭代分组。 */
  const selectedGroup =
    data?.groups.find((group) =>
      group.requirements.some((requirement) => requirement.id === selectedRequirementId)
    ) ?? null

  /** 当前选中的是否为本地临时需求。 */
  const selectedRequirementIsLocal = isLocalRequirementId(selectedRequirementId)

  /** 新建/编辑临时需求时可选的现有迭代。 */
  const localVersionOptions = useMemo<LocalRequirementVersionOption[]>(() => {
    const options = (data?.groups ?? []).map((group) => ({
      key: group.key,
      label: group.iterationName,
      iterationId: group.iterationId,
      iterationName: group.key === 'unplanned' ? null : group.iterationName,
      iterationDate: group.releaseDate
    }))

    if (!options.some((option) => option.key === 'unplanned')) {
      options.push({
        key: 'unplanned',
        label: '未规划迭代',
        iterationId: null,
        iterationName: null,
        iterationDate: null
      })
    }

    return options
  }, [data])

  // 流程节点单独加载，避免拖慢左侧需求列表。
  const [activity, setActivity] = useState<MeegleRequirementActivity | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [activityVersion, setActivityVersion] = useState(0)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const activityRequirementIdRef = useRef<string | null>(null)

  /** 当前选中的流程节点。 */
  const selectedNode = activity?.nodes.find((node) => node.key === selectedNodeKey) ?? null

  /** 选中流程图节点后，将节点详情滚动到可视区域。 */
  const handleSelectNode = (nodeKey: string): void => {
    setSelectedNodeKey(nodeKey)

    window.requestAnimationFrame(() => {
      nodeDetailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    })
  }

  /** 当前节点剩余工时 = 估分 - 实际工时。 */
  const nodeRemainingWorkTime =
    selectedNode?.points !== null &&
      selectedNode?.points !== undefined &&
      selectedNode.actualWorkTime !== null
      ? Math.max(0, selectedNode.points - selectedNode.actualWorkTime)
      : null

  // 节点估分和排期编辑弹窗。
  const [nodeEditing, setNodeEditing] = useState(false)
  const [nodeEditRange, setNodeEditRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [nodeEditPoints, setNodeEditPoints] = useState<number | null>(null)
  const [nodeEditOwnerKeys, setNodeEditOwnerKeys] = useState<string[]>([])
  const [nodeOwnerOptions, setNodeOwnerOptions] = useState<MeegleRequirementOwner[]>([])
  const [nodeOwnerSearching, setNodeOwnerSearching] = useState(false)
  const [nodeEditSubmitting, setNodeEditSubmitting] = useState(false)
  const nodeOwnerSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodeOwnerSearchRequestRef = useRef(0)

  // 回滚弹窗。
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [rollbackReason, setRollbackReason] = useState('')
  const [rollbackSubmitting, setRollbackSubmitting] = useState(false)

  // 评论输入。
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)

  const [replyToComment, setReplyToComment] = useState<MeegleRequirementComment | null>(null)

  // 需求描述折叠状态。
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [moreFieldsOpen, setMoreFieldsOpen] = useState(false)

  // 需求描述编辑状态。
  const [descriptionEditing, setDescriptionEditing] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [descriptionSaving, setDescriptionSaving] = useState(false)

  // 需求仓库绑定。
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [repositoriesLoading, setRepositoriesLoading] = useState(false)
  const [bindings, setBindings] = useState<RequirementRepoBinding[]>([])
  const [bindingsLoading, setBindingsLoading] = useState(false)
  const [bindingsError, setBindingsError] = useState<string | null>(null)
  const [bindingVersion, setBindingVersion] = useState(0)
  const [repoBranches, setRepoBranches] = useState<Record<string, string[]>>({})
  const [branchLoadingIds, setBranchLoadingIds] = useState<Set<string>>(() => new Set())
  const [addBindingOpen, setAddBindingOpen] = useState(false)
  const [newRepositoryId, setNewRepositoryId] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState<string | null>(null)
  const [bindingSaving, setBindingSaving] = useState(false)
  const [removingBindingId, setRemovingBindingId] = useState<string | null>(null)
  const [syncingBindingId, setSyncingBindingId] = useState<string | null>(null)
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [createBranchBase, setCreateBranchBase] = useState<string | null>(null)
  const [createBranchName, setCreateBranchName] = useState('')
  const [createBranchSaving, setCreateBranchSaving] = useState(false)
  const [openingIdeBindingId, setOpeningIdeBindingId] = useState<string | null>(null)
  const [branchChoiceOpen, setBranchChoiceOpen] = useState(false)
  const [branchChoiceBinding, setBranchChoiceBinding] =
    useState<RequirementRepoBinding | null>(null)
  const [branchChoiceType, setBranchChoiceType] = useState<
    'requirement' | 'iteration'
  >('requirement')
  const [ideSessionPrompt, setIdeSessionPrompt] = useState(
    () => localStorage.getItem(IDE_SESSION_PROMPT_KEY) !== 'false'
  )
  const [canPrefillSession, setCanPrefillSession] = useState(false)
  const [openIdeConfirmBinding, setOpenIdeConfirmBinding] =
    useState<RequirementRepoBinding | null>(null)
  const [openIdeConfirmBranch, setOpenIdeConfirmBranch] = useState<string | null>(null)

  // 创建合并请求弹窗。
  const [mergeRequestBinding, setMergeRequestBinding] =
    useState<RequirementRepoBinding | null>(null)
  const [mergeRequestSource, setMergeRequestSource] = useState<string | null>(null)
  const [mergeRequestTarget, setMergeRequestTarget] = useState<string | null>(null)
  const [mergeRequestBranches, setMergeRequestBranches] = useState<string[]>([])
  const [mergeRequestBranchesLoading, setMergeRequestBranchesLoading] = useState(false)
  const [mergeRequestWarning, setMergeRequestWarning] = useState<string | null>(null)
  const openingIdeRef = useRef<string | null>(null)
  const [bindingStatuses, setBindingStatuses] = useState<
    Record<string, RepositoryBindingStatus>
  >({})
  const [bindingStatusVersion, setBindingStatusVersion] = useState(0)
  const branchCacheRef = useRef(new Map<string, string[]>())
  const workbenchContentRef = useRef<HTMLDivElement>(null)
  const nodeDetailRef = useRef<HTMLDivElement>(null)

  /** 飞书需求详情页地址。 */
  const requirementUrl =
    selectedRequirement && data && !selectedRequirementIsLocal
      ? `https://project.feishu.cn/${encodeURIComponent(
        data.project.key
      )}/story/detail/${encodeURIComponent(selectedRequirement.id)}`
      : null

  /** 飞书需求详情中“轻舟”页签的固定视图标识。 */
  const qingzhouTabKey = 'MII_69A014D411820BBC_dashboard_01py9t'
  const qingzhouRequirementUrl = requirementUrl
    ? `${requirementUrl}?tabKey=${qingzhouTabKey}#${qingzhouTabKey}`
    : null

  /** 仓库 ID 到仓库信息的映射。 */
  const repositoryMap = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories]
  )

  /** 打开 AI 弹窗，使用需求分析技能分析当前需求。 */
  const handleAnalyzeRequirement = (): void => {
    if (!selectedRequirement) return

    const repositoryLines = bindings.map((binding) => {
      const repository = repositoryMap.get(binding.repositoryId)

      if (!repository) return `- ${binding.repositoryId}（仓库信息不可用）`

      const requirementBranch =
        binding.mode === 'qingzhou' ? binding.requirementBranch : binding.branchName
      const details = [
        `路径：${repository.localPath}`,
        `当前分支：${repository.currentBranch ?? '未知'}`
      ]

      if (requirementBranch && requirementBranch !== repository.currentBranch) {
        details.push(`需求分支：${requirementBranch}`)
      }
      if (!repository.available) details.push('本地仓库不可用')

      return `- ${repository.name}：${details.join('；')}`
    })

    openAiDialog({
      title: 'AI 需求分析',
      autoStart: true,
      prompt: [
        selectedRequirementIsLocal
          ? '请分析下面这个本地临时需求。'
          : '请分析下面这个飞书需求。',
        '',
        ...(selectedRequirementIsLocal
          ? [
              `需求名称：${selectedRequirement.name}`,
              `所属版本：${selectedRequirement.iterationName ?? '未规划迭代'}`,
              `状态：${selectedRequirement.status ?? '未知'}`,
              `优先级：${selectedRequirement.priority ?? '未设置'}`,
              `需求描述：${selectedRequirement.description?.trim() || '暂无描述'}`,
              '',
              '该需求只保存在本机，不在 Meegle 中，不要调用 getRequirementDetail 工具。'
            ]
          : [
              `Story ID：${selectedRequirement.id}`,
              `Story 链接：${requirementUrl ?? '暂无'}`,
              '',
              '请优先使用 getRequirementDetail 工具通过 Story ID 读取需求详情，再读取相关需求文档和后端文档，结合绑定的本地仓库代码输出分析报告。'
            ]),
        '',
        '已绑定的代码仓库：',
        ...(repositoryLines.length > 0 ? repositoryLines : ['- 暂无可用仓库']),
        '',
        '分析目标：',
        '- 不要只复述需求，要告诉开发者这次需求到底要做什么、解决什么问题。',
        '- 分析结果要能直接指导开发，不要输出泛泛而谈的项目背景。',
        '- 区分事实和推断：需求、文档或代码中明确的写“已确认”，根据上下文推断的写“推断”。',
        '',
        '请按以下结构输出：',
        '1. 一句话结论：本次需求最终要交付什么。',
        '2. 要解决的问题：当前业务/用户/系统存在什么问题，为什么需要这次改动。',
        '3. 需求目标与范围：明确做什么、不做什么，以及可验证的验收标准。',
        '4. 前端需要做什么：页面、组件、交互、状态管理、接口调用、表单校验、异常处理、兼容性；没有前端改动时明确说明。',
        '5. 后端需要做什么：接口、入参出参、数据模型、业务规则、存储、权限、异步任务、兼容和数据迁移；没有后端改动时明确说明。',
        '6. 前后端协作：接口约定、字段含义、调用时序、联调点和需要双方确认的事项。',
        '7. 影响范围与风险：现有功能、数据、权限、性能、历史数据、发布顺序和回滚风险。',
        '8. 开发任务清单：按前端、后端、联调、测试分组，每项写成可执行动作。',
        '9. 测试与验收：核心用例、边界条件、异常场景和回归范围。',
        '10. 待确认问题：只列真正影响实现或验收的问题。',
        '',
        '代码分析流程：',
        '- 先调用 getRepositoryContext，把所有绑定仓库路径和需求关键词一次性传入，获取目录、命中文件和近期提交。',
        '- 需要查看具体实现时，用 readRepositoryFiles 批量读取命中的文件，一次最多 8 个，不要逐个 cat。',
        '- 如果返回 truncated=true，说明单文件超过 64KB，使用同一个 path 和 nextOffset 继续读取剩余部分。',
        '- 只有这两个工具无法覆盖时（例如读取非当前分支），才使用 executeShell；调用次数尽量不超过 2 次，并合并成一条命令。',
        '- 不要为每个目录、文件或提交单独调用 executeShell。',
        '',
        '代码分析要求：',
        '- 需要读取非当前分支时使用 `git show <branch>:<path>`，不要切换分支。',
        '- 只读取和分析代码，不修改代码、不提交。',
        '- 尽量定位到具体模块、接口、文件或数据结构；无法定位时说明需要进一步确认。',
        '- 当前分支与需求分支不一致时，在报告中说明可能影响。',
        '- 没有可用仓库或无法读取代码时，明确说明缺少代码上下文，不要猜测实现。',
        '',
        '输出要求：',
        '- 使用 Markdown，简洁、具体、可执行，不写“赋能、闭环、抓手、持续推进”等空话。',
        '- 需求未明确、代码中也没有依据的内容不要编造，放入“待确认问题”。',
        '- 本次只输出需求实施分析报告。'
      ].join('\n')
    })
  }

  /** 打开新建临时需求弹窗。 */
  const handleOpenCreateLocalRequirement = (): void => {
    setLocalModalRequirement(null)
    setLocalModalOpen(true)
  }

  /** 打开编辑临时需求弹窗。 */
  const handleOpenEditLocalRequirement = (): void => {
    if (!selectedRequirement || !selectedRequirementIsLocal) return

    setLocalModalRequirement(selectedRequirement)
    setLocalModalOpen(true)
  }

  /** 保存临时需求。 */
  const handleSubmitLocalRequirement = async (
    input: LocalRequirementInput
  ): Promise<void> => {
    const projectKey = data?.project.projectKey

    if (!projectKey) {
      message.warning('当前 Meegle 空间不可用')
      return
    }

    const editing = Boolean(localModalRequirement)

    setLocalSaving(true)

    try {
      const saved = localModalRequirement
        ? await window.electron.updateLocalRequirement(
            projectKey,
            localModalRequirement.id,
            input
          )
        : await window.electron.addLocalRequirement(projectKey, input)

      if (saved.closed && !showClosedRequirements) {
        setShowClosedRequirements(true)
      }

      setLocalModalOpen(false)
      setLocalModalRequirement(null)
      await loadRequirements()
      setSelectedRequirementId(saved.id)
      message.success(editing ? '临时需求已更新' : '临时需求已创建')
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存临时需求失败'))
    } finally {
      setLocalSaving(false)
    }
  }

  /** 删除当前临时需求。 */
  const handleDeleteLocalRequirement = async (): Promise<void> => {
    const projectKey = data?.project.projectKey

    if (!projectKey || !selectedRequirement || !selectedRequirementIsLocal) return

    setLocalDeleting(true)

    try {
      await window.electron.removeRequirementBindingWorkspace(
        selectedRequirement.id
      )
      await window.electron.removeLocalRequirement(
        projectKey,
        selectedRequirement.id
      )
      localStorage.removeItem(SELECTED_REQUIREMENT_KEY)
      setSelectedRequirementId(null)
      await loadRequirements()
      message.success('临时需求已删除')
    } catch (removeError) {
      message.error(getErrorMessage(removeError, '删除临时需求失败'))
    } finally {
      setLocalDeleting(false)
    }
  }

  /** 已绑定的仓库 ID，用于过滤新增下拉框。 */
  const boundRepositoryIds = useMemo(
    () => new Set(bindings.map((binding) => binding.repositoryId)),
    [bindings]
  )

  /** 新绑定可选的仓库。 */
  const availableRepositories = useMemo(
    () =>
      repositories.filter(
        (repository) =>
          repository.available &&
          !boundRepositoryIds.has(repository.id) &&
          (!selectedRequirementIsLocal || !repository.qingzhouEnabled)
      ),
    [boundRepositoryIds, repositories, selectedRequirementIsLocal]
  )

  /** 是否展示新增绑定表单。 */
  const showAddBinding = bindings.length === 0 || addBindingOpen

  /** 新增绑定时的分支选项。 */
  const newRepositoryBranchOptions = newRepositoryId
    ? (repoBranches[newRepositoryId] ?? []).map((branch) => ({
      value: branch,
      label: branch
    }))
    : []
  const newRepository = newRepositoryId
    ? repositoryMap.get(newRepositoryId) ?? null
    : null
  const newRepositoryIsQingzhou = newRepository?.qingzhouEnabled ?? false
  const newRepositoryBranchesLoading = Boolean(
    newRepositoryId && branchLoadingIds.has(newRepositoryId)
  )

  /** 默认展示的需求关键信息。 */
  const primaryInfoGroups: BasicInfoGroup[] = selectedRequirement
    ? [
        {
          title: '需求信息',
          fields: [
            {
              label: '需求类型',
              value: renderInfoTags(
                [
                  formatRequirementType(
                    selectedRequirement.requirementType
                  ) ?? ''
                ].filter(Boolean),
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
              label: '需求文档',
              value: selectedRequirement.documentUrl ? (
                <Typography.Link
                  className="requirement-info-doc-link"
                  href={selectedRequirement.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <LinkOutlined />
                  查看文档
                </Typography.Link>
              ) : (
                '未填写'
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
          title: '研发与版本',
          fields: [
            {
              label: '技术方案',
              wide: true,
              value: selectedRequirement.technicalSolution ?? '未填写'
            },
            {
              label: '应用',
              value: renderInfoTags(
                selectedRequirement.application
                  ? [selectedRequirement.application]
                  : [],
                'teal'
              )
            },
            {
              label: '标签',
              value: renderInfoTags(selectedRequirement.tags, 'green')
            },
            {
              label: '预计上线时间',
              value: selectedRequirement.expectedReleaseAt ?? '未填写'
            },
            {
              label: '规划版本',
              value: renderInfoTags(
                selectedRequirement.planningVersions,
                'purple'
              )
            }
          ]
        }
      ]
    : []

  /** 默认折叠的低频飞书字段。 */
  const moreInfoGroups: BasicInfoGroup[] = selectedRequirement
    ? [
        {
          title: '其他信息',
          fields: [
            {
              label: '创建人',
              value: renderPeople(
                selectedRequirement.createdBy
                  ? [selectedRequirement.createdBy]
                  : []
              )
            },
            {
              label: '提出时间',
              value: selectedRequirement.proposedAt ?? '未填写'
            },
            {
              label: '完成日期',
              value: selectedRequirement.completedAt ?? '未填写'
            },
            {
              label: '实际上车版本',
              value: renderInfoTags(
                selectedRequirement.actualReleaseVersions,
                'cyan'
              )
            }
          ]
        },
        {
          title: '研发属性',
          fields: [
            {
              label: '需求等级',
              value: renderInfoTags(
                selectedRequirement.requirementLevel
                  ? [selectedRequirement.requirementLevel]
                  : [],
                'orange'
              )
            },
            {
              label: '需求性质',
              value: renderInfoTags(
                selectedRequirement.requirementNature
                  ? [selectedRequirement.requirementNature]
                  : [],
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
                selectedRequirement.estimatedWorkload
                  ? [selectedRequirement.estimatedWorkload]
                  : [],
                'gray'
              )
            }
          ]
        },
        {
          title: '质量属性',
          fields: [
            {
              label: '是否涉及权限',
              value: selectedRequirement.permissionsInvolved
                ? renderInfoTags(
                    [selectedRequirement.permissionsInvolved],
                    getBooleanTagTone(
                      selectedRequirement.permissionsInvolved
                    )
                  )
                : '未填写'
            },
            {
              label: '是否涉及历史数据',
              value: selectedRequirement.historicalDataInvolved
                ? renderInfoTags(
                    [selectedRequirement.historicalDataInvolved],
                    getBooleanTagTone(
                      selectedRequirement.historicalDataInvolved
                    )
                  )
                : '未填写'
            },
            {
              label: '是否涉及性能测试',
              value: selectedRequirement.performanceTestInvolved
                ? renderInfoTags(
                    [selectedRequirement.performanceTestInvolved],
                    getBooleanTagTone(
                      selectedRequirement.performanceTestInvolved
                    )
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
      const result = await window.electron.getMyRequirements(
        showClosedRequirements
      )
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
  }, [showClosedRequirements])

  useEffect(() => {
    loadRequirements()
  }, [loadRequirements])

  useEffect(() => {
    let mounted = true

    setProjectsLoading(true)
    window.electron
      .listMeegleProjects()
      .then((items) => {
        if (mounted) setProjects(items)
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setProjectsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  /**
   * 切换 Meegle 空间并重新加载需求。
   * 绑定数据按 projectKey 隔离，切换后由需求 ID 重新读取。
   */
  const handleProjectChange = async (projectKey: string): Promise<void> => {
    if (!projectKey || projectKey === data?.project.projectKey) return

    setProjectSwitching(true)
    projectSwitchRef.current = true

    try {
      const project = await window.electron.setMeegleProject(projectKey)

      localStorage.removeItem(SELECTED_REQUIREMENT_KEY)
      setProjects((current) =>
        current.some((item) => item.projectKey === project.projectKey)
          ? current
          : [...current, project]
      )
      setSelectedRequirementId(null)
      setRequirementFilter('')
      setStatusFilters([])
      setIterationFilter(null)
      setCollapsedGroupKeys(new Set())
      setActivity(null)
      setBindings([])
      setData(null)
      await loadRequirements()
      window.dispatchEvent(new CustomEvent('meegle:project-changed'))
      message.success(`已切换到 ${project.name}`)
    } catch (switchError) {
      message.error(getErrorMessage(switchError))
    } finally {
      projectSwitchRef.current = false
      setProjectSwitching(false)
    }
  }

  useEffect(() => {
    const handleProjectChanged = (): void => {
      if (projectSwitchRef.current) return

      localStorage.removeItem(SELECTED_REQUIREMENT_KEY)
      setSelectedRequirementId(null)
      setRequirementFilter('')
      setStatusFilters([])
      setIterationFilter(null)
      setCollapsedGroupKeys(new Set())
      setActivity(null)
      setBindings([])
      setData(null)
      void loadRequirements()
    }

    window.addEventListener('meegle:project-changed', handleProjectChanged)

    return () => {
      window.removeEventListener('meegle:project-changed', handleProjectChanged)
    }
  }, [loadRequirements])

  /** 快速访问选中本地需求时，切换到对应需求。 */
  useEffect(() => {
    const handleOpenRequirement = (event: Event): void => {
      const detail = (
        event as CustomEvent<{ id?: string; includeClosed?: boolean }>
      ).detail
      const id = detail?.id

      localStorage.removeItem(OPEN_CLOSED_REQUIREMENT_KEY)

      if (detail?.includeClosed) {
        setShowClosedRequirements(true)
      }

      if (id) setSelectedRequirementId(id)
    }

    window.addEventListener('workbench:open-requirement', handleOpenRequirement)

    return () => {
      window.removeEventListener('workbench:open-requirement', handleOpenRequirement)
    }
  }, [])

  /** 清除快速访问留下的一次性标记，避免影响下次启动。 */
  useEffect(() => {
    localStorage.removeItem(OPEN_CLOSED_REQUIREMENT_KEY)
  }, [])

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
    if (!selectedRequirementId || isLocalRequirementId(selectedRequirementId)) {
      activityRequirementIdRef.current = null
      setActivity(null)
      setActivityLoading(false)
      setSelectedNodeKey(null)
      setActivityError(null)
      return
    }

    let cancelled = false

    if (activityRequirementIdRef.current !== selectedRequirementId) {
      setActivity(null)
    }

    setActivityLoading(true)
    setActivityError(null)

    window.electron
      .getRequirementActivity(selectedRequirementId)
      .then((result) => {
        if (cancelled) return

        activityRequirementIdRef.current = selectedRequirementId
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
   * 读取当前需求的本地个人标记。
   */
  useEffect(() => {
    const projectKey = data?.project.projectKey

    setPersonalStatusEditing(false)
    setPersonalStatusDraft('')

    if (
      !selectedRequirementId ||
      !projectKey ||
      isLocalRequirementId(selectedRequirementId)
    ) {
      setPersonalStatus(null)
      setPersonalStatusLoading(false)
      return
    }

    let cancelled = false

    setPersonalStatus(null)
    setPersonalStatusLoading(true)
    window.electron
      .getRequirementPersonalStatus(projectKey, selectedRequirementId)
      .then((state) => {
        if (cancelled) return

        setPersonalStatus(state.status)
        setPersonalStatusDraft(state.status?.value ?? '')
      })
      .catch((loadError) => {
        if (!cancelled) {
          message.error(getErrorMessage(loadError, '读取个人标记失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setPersonalStatusLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [data?.project.projectKey, message, selectedRequirementId])

  /**
   * 读取本地仓库列表。
   */
  const loadRepositories = useCallback(async (): Promise<void> => {
    setRepositoriesLoading(true)

    try {
      const state = await window.electron.getRepositoryState()
      setRepositories(state.repositories)
    } catch (loadError) {
      setBindingsError(getErrorMessage(loadError))
    } finally {
      setRepositoriesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRepositories()
  }, [loadRepositories])

  useEffect(() => {
    const unsubscribe = window.electron.onRepositoriesChanged((state) => {
      setRepositories(state.repositories)
      setBindingStatusVersion((value) => value + 1)
    })

    return unsubscribe
  }, [])

  /**
   * 读取仓库分支并缓存。
   */
  const loadBranches = useCallback(
    async (
      repositoryId: string,
      force = false,
      fetchRemote = false
    ): Promise<string[]> => {
      const cached = branchCacheRef.current.get(repositoryId)

      if (cached && !force && !fetchRemote) {
        setRepoBranches((current) =>
          current[repositoryId] ? current : { ...current, [repositoryId]: cached }
        )
        return cached
      }

      setBranchLoadingIds((current) => new Set(current).add(repositoryId))

      try {
        const result = await window.electron.listRepositoryBranches(
          repositoryId,
          fetchRemote
        )

        if (result.fetchWarning) {
          message.warning({ content: result.fetchWarning, duration: 6 })
        }

        branchCacheRef.current.set(repositoryId, result.branches)
        setRepoBranches((current) => ({
          ...current,
          [repositoryId]: result.branches
        }))

        return result.branches
      } catch (branchError) {
        if (force) message.error(getErrorMessage(branchError))
        return []
      } finally {
        setBranchLoadingIds((current) => {
          const next = new Set(current)
          next.delete(repositoryId)
          return next
        })
      }
    },
    [message]
  )

  /**
   * 切换需求时重新读取仓库绑定。
   */
  useEffect(() => {
    if (!selectedRequirementId) {
      setBindings([])
      setBindingsError(null)
      setAddBindingOpen(false)
      return
    }

    let cancelled = false
    setBindingsLoading(true)
    setBindingsError(null)
    setNewRepositoryId(null)
    setNewBranchName(null)
    setCreateBranchOpen(false)

    window.electron
      .getRequirementBindings(selectedRequirementId)
      .then((state) => {
        if (cancelled) return

        setBindings(state.bindings)
        setAddBindingOpen(state.bindings.length === 0)
      })
      .catch((bindingError) => {
        if (!cancelled) setBindingsError(getErrorMessage(bindingError))
      })
      .finally(() => {
        if (!cancelled) setBindingsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [bindingVersion, loadBranches, selectedRequirementId])

  /**
   * 读取每个绑定的目标分支是否存在。
   */
  useEffect(() => {
    if (bindings.length === 0) {
      setBindingStatuses({})
      return
    }

    let cancelled = false
    setBindingStatuses({})

    Promise.all(
      bindings.map(async (binding) => {
        const requirementBranch =
          binding.mode === 'qingzhou'
            ? binding.requirementBranch
            : binding.branchName
        const iterationBranch =
          binding.mode === 'qingzhou' ? binding.iterationBranch : null

        if (!requirementBranch && !iterationBranch) return null

        try {
          const status = await window.electron.getRepositoryBindingStatus(
            binding.repositoryId,
            requirementBranch ?? '',
            iterationBranch
          )

          return [binding.id, status] as const
        } catch {
          return null
        }
      })
    ).then((results) => {
      if (cancelled) return

      const next: Record<string, RepositoryBindingStatus> = {}

      for (const result of results) {
        if (result) next[result[0]] = result[1]
      }

      setBindingStatuses(next)
    })

    return () => {
      cancelled = true
    }
  }, [bindingStatusVersion, bindings])

  /**
   * 新增仓库绑定。
   */
  const handleAddBinding = async (): Promise<void> => {
    if (!selectedRequirementId || !newRepositoryId || !newRepository) {
      message.warning('请选择仓库')
      return
    }

    if (selectedRequirementIsLocal && newRepositoryIsQingzhou) {
      message.warning('临时需求不支持轻舟绑定')
      return
    }

    if (!newRepositoryIsQingzhou && !newBranchName) {
      message.warning('请选择开发分支')
      return
    }

    setBindingSaving(true)

    try {
      const state = newRepositoryIsQingzhou
        ? await window.electron.addQingzhouRequirementBinding(
          selectedRequirementId,
          newRepositoryId
        )
        : await window.electron.addRequirementBinding(
          selectedRequirementId,
          newRepositoryId,
          newBranchName as string
        )

      if (newRepositoryIsQingzhou) {
        await loadBranches(newRepositoryId, true, true)
      }

      const addedBinding = state.bindings.find(
        (binding) => binding.repositoryId === newRepositoryId
      )

      setBindings(state.bindings)
      setNewRepositoryId(null)
      setNewBranchName(null)
      setAddBindingOpen(false)
      message.success(
        newRepositoryIsQingzhou
          ? !addedBinding?.qingzhouTaskId
            ? '轻舟工作项已绑定，尚未创建代码任务（请在飞书需求详情的轻舟页签中创建）'
            : !addedBinding.requirementBranch
              ? '轻舟工作项已绑定，待创建需求分支'
              : '轻舟工作项已绑定'
          : '仓库绑定已保存'
      )
    } catch (bindingError) {
      message.error(getErrorMessage(bindingError))
    } finally {
      setBindingSaving(false)
    }
  }

  /**
   * 解除仓库绑定。
   */
  const handleRemoveBinding = async (bindingId: string): Promise<void> => {
    if (!selectedRequirementId) return

    setRemovingBindingId(bindingId)

    try {
      const state = await window.electron.removeRequirementBinding(
        selectedRequirementId,
        bindingId
      )
      setBindings(state.bindings)
      setAddBindingOpen(state.bindings.length === 0)
      message.success('仓库绑定已解除')
    } catch (bindingError) {
      message.error(getErrorMessage(bindingError))
    } finally {
      setRemovingBindingId(null)
    }
  }

  /**
   * 重新从轻舟拉取工作项对应的需求分支和迭代分支。
   * 分支可能在绑定后才创建，因此需要独立同步入口。
   */
  const handleSyncQingzhouBinding = async (bindingId: string): Promise<void> => {
    if (!selectedRequirementId) return

    const repositoryId = bindings.find((binding) => binding.id === bindingId)?.repositoryId

    setSyncingBindingId(bindingId)

    try {
      const state = await window.electron.syncQingzhouRequirementBinding(
        selectedRequirementId,
        bindingId
      )

      if (repositoryId) {
        await loadBranches(repositoryId, true, true)
      }

      const syncedBinding = state.bindings.find((binding) => binding.id === bindingId)

      setBindings(state.bindings)
      setBindingStatusVersion((value) => value + 1)
      message.success(
        !syncedBinding?.qingzhouTaskId
          ? '同步完成，尚未创建代码任务（请在飞书需求详情的轻舟页签中创建）'
          : !syncedBinding.requirementBranch
            ? '同步完成，待创建需求分支'
            : '轻舟分支已同步'
      )
    } catch (syncError) {
      message.error(getErrorMessage(syncError))
    } finally {
      setSyncingBindingId(null)
    }
  }

  const handleCopyBranchName = async (branchName: string): Promise<void> => {
    try {
      await window.electron.copyText(branchName)
      message.success('分支名已复制')
    } catch {
      message.error('复制分支名失败')
    }
  }

  /** 复制当前需求名称。 */
  const handleCopyRequirementName = async (): Promise<void> => {
    if (!selectedRequirement) return

    try {
      await window.electron.copyText(selectedRequirement.name)
      message.success('需求名称已复制')
    } catch {
      message.error('复制需求名称失败')
    }
  }

  /** 复制当前需求的飞书详情链接。 */
  const handleCopyRequirementUrl = async (): Promise<void> => {
    if (!requirementUrl) return

    try {
      await window.electron.copyText(requirementUrl)
      message.success('需求链接已复制')
    } catch {
      message.error('复制需求链接失败')
    }
  }

  /**
   * 打开新建分支弹窗，默认使用仓库主分支作为基线。
   */
  const openCreateBranch = async (): Promise<void> => {
    if (!newRepositoryId || newRepositoryIsQingzhou) return

    const branches =
      repoBranches[newRepositoryId]?.length > 0
        ? repoBranches[newRepositoryId]
        : await loadBranches(newRepositoryId, true)
    const repository = repositoryMap.get(newRepositoryId)
    const preferredBase =
      repository?.defaultBranch && branches.includes(repository.defaultBranch)
        ? repository.defaultBranch
        : branches[0] ?? null

    const requirementToken = selectedRequirementId
      ? isLocalRequirementId(selectedRequirementId)
        ? selectedRequirementId.slice('local:'.length, 'local:'.length + 8)
        : selectedRequirementId
      : ''

    setCreateBranchBase(preferredBase)
    setCreateBranchName(
      requirementToken
        ? `feat/${getUserNameInitials(larkUser?.name)}/${requirementToken}`
        : ''
    )
    setCreateBranchOpen(true)
  }

  /**
   * 创建开发分支并自动绑定到当前需求。
   */
  const handleCreateBranch = async (): Promise<void> => {
    if (
      !selectedRequirementId ||
      !newRepositoryId ||
      newRepositoryIsQingzhou ||
      !createBranchBase ||
      !createBranchName.trim()
    ) {
      message.warning('请选择基线分支并填写新分支名')
      return
    }

    setCreateBranchSaving(true)

    try {
      const branchName = createBranchName.trim()

      await window.electron.createRepositoryBranch(
        newRepositoryId,
        branchName,
        createBranchBase
      )
      branchCacheRef.current.delete(newRepositoryId)
      await loadBranches(newRepositoryId, true)

      try {
        const state = await window.electron.addRequirementBinding(
          selectedRequirementId,
          newRepositoryId,
          branchName
        )

        setBindings(state.bindings)
        setNewRepositoryId(null)
        setNewBranchName(null)
        setAddBindingOpen(false)
        setCreateBranchOpen(false)
        message.success('分支已创建并绑定')
      } catch (bindingError) {
        setNewBranchName(branchName)
        setAddBindingOpen(true)
        setCreateBranchOpen(false)
        message.warning({
          content: `分支「${branchName}」已创建，但绑定失败：${getErrorMessage(
            bindingError
          )}。请直接点击“添加”完成绑定。`,
          duration: 8
        })
      }
    } catch (branchError) {
      message.error(getErrorMessage(branchError))
    } finally {
      setCreateBranchSaving(false)
    }
  }

  /**
   * 在 IDE 中打开仓库。
   */
  const handleOpenInIde = async (
    binding: RequirementRepoBinding,
    branchOverride?: string,
    prefillSession = true
  ): Promise<void> => {
    if (openingIdeRef.current !== null) return

    const branchName =
      branchOverride ??
      (binding.mode === 'qingzhou'
        ? binding.requirementBranch
        : binding.branchName)

    if (!branchName) return

    openingIdeRef.current = binding.id
    setOpeningIdeBindingId(binding.id)
    let shouldRefreshStatus = false

    try {
      const ideState = await window.electron.getIdeConfig()

      if (!ideState.config || !ideState.available) {
        notification.warning({
          key: 'ide-settings-required',
          message: ideState.config ? 'IDE 当前不可用' : '还没有配置 IDE',
          description: '请先在设置中选择 IDE，并确认可执行文件可用。',
          duration: 6,
          btn: (
            <Button
              type="primary"
              size="small"
              onClick={() => {
                notification.destroy('ide-settings-required')
                onOpenSettings('ide')
              }}
            >
              去设置
            </Button>
          )
        })
        return
      }

      shouldRefreshStatus = true

      const result = await window.electron.prepareRepositoryInIde(
        binding.repositoryId,
        branchName
      )

      if (result.switched) {
        message.success(
          result.pulled
            ? `已切换到 ${branchName} 并拉取最新代码，即将打开 IDE`
            : `已切换到 ${branchName}，该分支没有远程上游，即将打开 IDE`
        )
      } else if (result.pulled) {
        message.success(`已在 ${branchName}，已拉取最新代码，即将打开 IDE`)
      } else {
        message.success('分支检查通过，即将打开 IDE')
      }

      // 留出时间让用户看到分支检查和拉取结果。
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const chatPrompt =
        prefillSession && requirementUrl
          ? `${requirementUrl}\n帮我分析一下这个需求`
          : undefined
      await window.electron.launchRepositoryInIde(binding.repositoryId, chatPrompt)
    } catch (openError) {
      message.error(getErrorMessage(openError))
    } finally {
      if (shouldRefreshStatus) {
        setBindingStatusVersion((value) => value + 1)
      }

      openingIdeRef.current = null
      setOpeningIdeBindingId(null)
    }
  }

  /**
   * 打开创建 MR 弹窗，并按当前绑定预选来源和目标分支。
   */
  const handleOpenCreateMergeRequest = async (
    binding: RequirementRepoBinding
  ): Promise<void> => {
    const repository = repositoryMap.get(binding.repositoryId)
    const source =
      binding.mode === 'qingzhou' ? binding.requirementBranch : binding.branchName
    const target =
      binding.mode === 'qingzhou'
        ? binding.iterationBranch ?? repository?.defaultBranch ?? null
        : repository?.defaultBranch ?? null

    setMergeRequestBinding(binding)
    setMergeRequestSource(source)
    setMergeRequestTarget(target)
    setMergeRequestBranches([])
    setMergeRequestWarning(null)
    setMergeRequestBranchesLoading(true)

    try {
      const result = await window.electron.listRepositoryBranches(binding.repositoryId, true)
      setMergeRequestBranches(result.branches)
      setMergeRequestWarning(result.fetchWarning)
    } catch (error) {
      setMergeRequestWarning(getErrorMessage(error))
    } finally {
      setMergeRequestBranchesLoading(false)
    }
  }

  const mergeRequestRepository = mergeRequestBinding
    ? repositoryMap.get(mergeRequestBinding.repositoryId) ?? null
    : null
  const mergeRequestUrl =
    mergeRequestSource && mergeRequestTarget
      ? getMergeRequestUrl(
        mergeRequestRepository?.remoteUrl,
        mergeRequestSource,
        mergeRequestTarget
      )
      : null
  const mergeRequestBranchOptions = Array.from(
    new Set([
      ...mergeRequestBranches,
      ...(mergeRequestSource ? [mergeRequestSource] : []),
      ...(mergeRequestTarget ? [mergeRequestTarget] : [])
    ])
  ).map((branch) => ({ value: branch, label: branch }))

  const getBranchChoiceKey = (repositoryId: string): string =>
    `qingzhou-ide-branch:${repositoryId}`

  /**
   * 轻舟仓库有两个分支时先让用户选择，普通仓库直接打开。
   */
  const handleRequestOpenInIde = async (
    binding: RequirementRepoBinding
  ): Promise<void> => {
    const requirementBranch =
      binding.mode === 'qingzhou' ? binding.requirementBranch : binding.branchName
    const iterationBranch =
      binding.mode === 'qingzhou' ? binding.iterationBranch : null
    const status = bindingStatuses[binding.id]
    const canUseRequirement = Boolean(
      requirementBranch && (!status || status.branchExists)
    )
    const canUseIteration = Boolean(
      iterationBranch && (!status || status.iterationBranchExists)
    )
    const ideState = await window.electron.getIdeConfig().catch(() => null)
    const canPrefill = ideState?.config?.preset === 'qoder'

    setCanPrefillSession(canPrefill)

    if (binding.mode === 'qingzhou' && canUseRequirement && canUseIteration) {
      const stored = localStorage.getItem(getBranchChoiceKey(binding.repositoryId))

      setBranchChoiceType(stored === 'iteration' ? 'iteration' : 'requirement')
      setBranchChoiceBinding(binding)
      setBranchChoiceOpen(true)
      return
    }

    if (canUseRequirement) {
      if (binding.mode === 'qingzhou') {
        handleOpenInIde(binding, requirementBranch as string, canPrefill)
      } else {
        setOpenIdeConfirmBinding(binding)
        setOpenIdeConfirmBranch(requirementBranch as string)
      }
      return
    }

    if (canUseIteration) {
      handleOpenInIde(binding, iterationBranch as string, canPrefill)
      return
    }

    message.error('绑定的分支在本地不存在，请先点击同步或刷新')
  }

  /** 保存预置会话勾选状态。 */
  const updateIdeSessionPrompt = (checked: boolean): void => {
    setIdeSessionPrompt(checked)
    localStorage.setItem(IDE_SESSION_PROMPT_KEY, String(checked))
  }

  const handleConfirmBranchChoice = (): void => {
    const binding = branchChoiceBinding

    if (!binding) return

    const branchName =
      branchChoiceType === 'iteration'
        ? binding.iterationBranch
        : binding.requirementBranch

    localStorage.setItem(
      getBranchChoiceKey(binding.repositoryId),
      branchChoiceType
    )
    setBranchChoiceOpen(false)
    setBranchChoiceBinding(null)

    if (branchName) {
      handleOpenInIde(
        binding,
        branchName,
        canPrefillSession && ideSessionPrompt
      )
    }
  }

  /**
   * 刷新仓库和绑定数据。
   */
  const refreshBindings = async (): Promise<void> => {
    if (!selectedRequirementId) {
      await loadRepositories()
      return
    }

    let nextBindings = bindings
    const qingzhouBindings = bindings.filter((binding) => binding.mode === 'qingzhou')

    // 轻舟数据需要串行刷新，避免多个请求同时触发登录流程。
    for (const binding of qingzhouBindings) {
      try {
        const state = await window.electron.syncQingzhouRequirementBinding(
          selectedRequirementId,
          binding.id
        )
        nextBindings = state.bindings
        setBindings(state.bindings)
      } catch (syncError) {
        message.error(getErrorMessage(syncError))
      }
    }

    branchCacheRef.current.clear()
    setRepoBranches({})
    await loadRepositories()

    const repositoryIds = new Set(
      nextBindings.map((binding) => binding.repositoryId)
    )

    if (newRepositoryId && !newRepositoryIsQingzhou) {
      repositoryIds.add(newRepositoryId)
    }

    await Promise.all(
      Array.from(repositoryIds).map((repositoryId) =>
        loadBranches(repositoryId, true, true)
      )
    )

    setBindingVersion((value) => value + 1)
  }

  /**
   * 切换需求或节点时退出内联编辑，避免把上一个节点的值带到新节点。
   */
  useEffect(() => {
    setNodeEditing(false)
    setRollbackOpen(false)
    setBranchChoiceOpen(false)
    setBranchChoiceBinding(null)
  }, [selectedNodeKey, selectedRequirementId])

  useEffect(() => {
    setCommentDraft('')
    setReplyToComment(null)
    setDescriptionExpanded(false)
    setDescriptionEditing(false)
    setDescriptionDraft('')
    setMoreFieldsOpen(false)
  }, [selectedRequirementId])

  /**
   * 打开节点内联编辑，并带入现有排期和估分。
   */
  const openNodeEditor = (): void => {
    if (!selectedNode) return

    const start =
      selectedNode.supportsSchedule && selectedNode.scheduleStart
        ? dayjs(selectedNode.scheduleStart)
        : null
    const end =
      selectedNode.supportsSchedule && selectedNode.scheduleEnd
        ? dayjs(selectedNode.scheduleEnd)
        : null

    setNodeEditRange(start?.isValid() && end?.isValid() ? [start, end] : null)
    setNodeEditPoints(selectedNode.supportsPoints ? selectedNode.points : null)
    setNodeEditOwnerKeys(
      selectedNode.owners.flatMap((owner) => (owner.userKey ? [owner.userKey] : []))
    )
    setNodeOwnerOptions(
      selectedNode.owners.filter((owner): owner is MeegleRequirementOwner =>
        Boolean(owner.userKey)
      )
    )
    setNodeOwnerSearching(false)
    nodeOwnerSearchRequestRef.current += 1

    if (nodeOwnerSearchTimerRef.current) {
      clearTimeout(nodeOwnerSearchTimerRef.current)
      nodeOwnerSearchTimerRef.current = null
    }

    setNodeEditing(true)
  }

  useEffect(() => {
    if (nodeEditing) return

    if (nodeOwnerSearchTimerRef.current) {
      clearTimeout(nodeOwnerSearchTimerRef.current)
      nodeOwnerSearchTimerRef.current = null
    }

    nodeOwnerSearchRequestRef.current += 1
    setNodeOwnerSearching(false)
  }, [nodeEditing])

  useEffect(
    () => () => {
      if (nodeOwnerSearchTimerRef.current) {
        clearTimeout(nodeOwnerSearchTimerRef.current)
      }

      nodeOwnerSearchRequestRef.current += 1
    },
    []
  )

  /**
   * 防抖搜索节点负责人。
   */
  const handleNodeOwnerSearch = (keyword: string): void => {
    const query = keyword.trim()
    const requestId = nodeOwnerSearchRequestRef.current + 1

    nodeOwnerSearchRequestRef.current = requestId

    if (nodeOwnerSearchTimerRef.current) {
      clearTimeout(nodeOwnerSearchTimerRef.current)
      nodeOwnerSearchTimerRef.current = null
    }

    if (!query) {
      setNodeOwnerSearching(false)
      return
    }

    nodeOwnerSearchTimerRef.current = setTimeout(() => {
      nodeOwnerSearchTimerRef.current = null
      setNodeOwnerSearching(true)

      window.electron
        .searchRequirementUsers(query)
        .then((owners) => {
          if (nodeOwnerSearchRequestRef.current !== requestId) return

          setNodeOwnerOptions((current) => {
            const merged = new Map(
              current.flatMap((owner) =>
                owner.userKey ? [[owner.userKey, owner] as const] : []
              )
            )

            for (const owner of owners) {
              if (owner.userKey) merged.set(owner.userKey, owner)
            }

            return Array.from(merged.values())
          })
        })
        .catch((searchError) => {
          if (nodeOwnerSearchRequestRef.current !== requestId) return
          message.error(getErrorMessage(searchError))
        })
        .finally(() => {
          if (nodeOwnerSearchRequestRef.current === requestId) {
            setNodeOwnerSearching(false)
          }
        })
    }, 300)
  }

  /**
   * 保存节点排期、估分和负责人。
   */
  const handleSaveNodeInfo = async (): Promise<void> => {
    if (!selectedRequirementId || !selectedNode) return

    const pointsChanged =
      selectedNode.supportsPoints && nodeEditPoints !== selectedNode.points

    if (!nodeEditRange && pointsChanged) {
      message.warning('修改估分前请先设置总排期')
      return
    }

    const currentOwnerKeys = selectedNode.owners
      .flatMap((owner) => (owner.userKey ? [owner.userKey] : []))
      .sort()
    const nextOwnerKeys = [...nodeEditOwnerKeys].sort()
    const ownersChanged =
      nextOwnerKeys.length !== currentOwnerKeys.length ||
      nextOwnerKeys.some((key, index) => key !== currentOwnerKeys[index])

    setNodeEditSubmitting(true)

    try {
      const originalStart = selectedNode.scheduleStart
        ? dayjs(selectedNode.scheduleStart)
        : null
      const originalEnd = selectedNode.scheduleEnd ? dayjs(selectedNode.scheduleEnd) : null
      const startAt =
        selectedNode.supportsSchedule && nodeEditRange
          ? originalStart?.isSame(nodeEditRange[0], 'day')
            ? originalStart.valueOf()
            : nodeEditRange[0].startOf('day').valueOf()
          : undefined
      const endAt =
        selectedNode.supportsSchedule && nodeEditRange
          ? originalEnd?.isSame(nodeEditRange[1], 'day')
            ? originalEnd.valueOf()
            : nodeEditRange[1].endOf('day').valueOf()
          : undefined
      const scheduleChanged =
        selectedNode.supportsSchedule &&
        nodeEditRange !== null &&
        (startAt !== undefined &&
          (!selectedNode.scheduleStart ||
            startAt !== dayjs(selectedNode.scheduleStart).valueOf()) ||
          (endAt !== undefined &&
            (!selectedNode.scheduleEnd ||
              endAt !== dayjs(selectedNode.scheduleEnd).valueOf())) ||
          (selectedNode.supportsPoints &&
            (nodeEditPoints ?? null) !== selectedNode.points))

      if (!scheduleChanged && !ownersChanged) {
        setNodeEditing(false)
        return
      }

      await window.electron.updateRequirementNode(selectedRequirementId, selectedNode.key, {
        ...(scheduleChanged ? { startAt, endAt, points: nodeEditPoints ?? undefined } : {}),
        ...(ownersChanged ? { ownerUserKeys: nextOwnerKeys } : {})
      })

      setActivity((current) =>
        current
          ? {
              ...current,
              nodes: current.nodes.map((node) =>
                node.key === selectedNode.key
                  ? {
                      ...node,
                      scheduleStart:
                        startAt === undefined
                          ? node.scheduleStart
                          : new Date(startAt).toISOString(),
                      scheduleEnd:
                        endAt === undefined
                          ? node.scheduleEnd
                          : new Date(endAt).toISOString(),
                      points: nodeEditRange ? nodeEditPoints : node.points
                    }
                  : node
              )
            }
          : current
      )
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
   * 开始编辑需求描述。
   */
  const handleStartDescriptionEdit = (): void => {
    setDescriptionDraft(selectedRequirement?.description ?? '')
    setDescriptionEditing(true)
    setDescriptionExpanded(true)
  }

  /**
   * 取消编辑需求描述。
   */
  const handleCancelDescriptionEdit = (): void => {
    setDescriptionEditing(false)
    setDescriptionDraft('')
  }

  /**
   * 保存需求描述到飞书。
   */
  const handleSaveDescription = async (): Promise<void> => {
    if (!selectedRequirementId) return

    setDescriptionSaving(true)

    try {
      await window.electron.updateRequirementDescription(
        selectedRequirementId,
        descriptionDraft
      )
      message.success('需求描述已更新')
      setDescriptionEditing(false)
      setDescriptionDraft('')
      await loadRequirements()
    } catch (saveError) {
      message.error(getErrorMessage(saveError))
    } finally {
      setDescriptionSaving(false)
    }
  }

  /** 开始编辑本地个人标记。 */
  const handleStartPersonalStatusEdit = (): void => {
    if (personalStatusLoading || personalStatusSaving) return

    setPersonalStatusDraft(personalStatus?.value ?? '')
    setPersonalStatusEditing(true)
  }

  /** 取消编辑并恢复已保存内容。 */
  const handleCancelPersonalStatusEdit = (): void => {
    setPersonalStatusDraft(personalStatus?.value ?? '')
    setPersonalStatusEditing(false)
  }

  /** 保存本地个人标记；空字符串表示清除。 */
  const handleSavePersonalStatus = async (): Promise<void> => {
    const projectKey = data?.project.projectKey

    if (!projectKey || !selectedRequirementId || personalStatusSaving) return

    const value = personalStatusDraft.trim()

    if (value === (personalStatus?.value ?? '')) {
      setPersonalStatusEditing(false)
      return
    }

    setPersonalStatusSaving(true)

    try {
      const state = await window.electron.setRequirementPersonalStatus(
        projectKey,
        selectedRequirementId,
        value
      )

      setPersonalStatus(state.status)
      setPersonalStatusDraft(state.status?.value ?? '')
      setPersonalStatusEditing(false)
    } catch (saveError) {
      message.error(getErrorMessage(saveError, '保存个人标记失败'))
    } finally {
      setPersonalStatusSaving(false)
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

  useEffect(() => {
    workbenchContentRef.current?.scrollTo({ top: 0, left: 0 })
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

  /** 迭代筛选选项。 */
  const iterationOptions = useMemo(
    () =>
      (data?.groups ?? []).map((group) => ({
        value: group.key,
        label: `${group.iterationName}（${group.requirements.length}）`
      })),
    [data]
  )

  /**
   * 先限制迭代范围，再按状态筛选，最后按需求名称、状态或迭代名称搜索。
   * 迭代名称命中时，保留该迭代下符合状态条件的全部需求。
   */
  const filteredGroups = useMemo(() => {
    const keyword = requirementFilter.trim().toLocaleLowerCase()

    const selectedStatuses = new Set(statusFilters)

    const scopedGroups = iterationFilter
      ? (data?.groups ?? []).filter((group) => group.key === iterationFilter)
      : data?.groups ?? []

    return scopedGroups.flatMap((group) => {
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
  }, [data, iterationFilter, requirementFilter, statusFilters])

  /** 当前筛选的迭代不存在时自动恢复全部迭代。 */
  useEffect(() => {
    if (!iterationFilter || !data) return

    if (!data.groups.some((group) => group.key === iterationFilter)) {
      setIterationFilter(null)
    }
  }, [data, iterationFilter])

  /** 是否存在有效搜索词、状态或迭代筛选。 */
  const hasSearch = requirementFilter.trim().length > 0
  const hasActiveFilter =
    hasSearch || statusFilters.length > 0 || Boolean(iterationFilter)

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
      className={`workbench-requirement-item${requirement.id === selectedRequirementId ? ' is-active' : ''
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
          {requirement.source === 'local' ? (
            <Tag className="local-requirement-tag" bordered={false}>
              临时
            </Tag>
          ) : null}
          {requirement.riskLabels.length > 0 ? (
            <Tooltip title={requirement.riskLabels.join('、')}>
              <span className="workbench-requirement-risk">{requirement.riskLabels[0]}</span>
            </Tooltip>
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
          <span
            className="workbench-requirement-group-count"
            aria-label={`${group.requirements.length} 个需求`}
          >
            {group.requirements.length}
            <span className="workbench-requirement-group-count-unit">项</span>
          </span>
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

  /** 本地临时需求的详情卡片。 */
  const localRequirementDetail =
    selectedRequirement && selectedRequirementIsLocal ? (
      <section className="requirement-info-section local-requirement-section">
        <div className="requirement-section-heading">
          <h2>需求信息</h2>
          <div className="local-requirement-actions">
            <Button
              type="primary"
              size="small"
              icon={<EditOutlined />}
              disabled={localDeleting}
              onClick={handleOpenEditLocalRequirement}
            >
              编辑
            </Button>
            <Popconfirm
              title="删除临时需求？"
              description="删除后无法恢复，代码仓库绑定也会一并解除。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handleDeleteLocalRequirement()}
            >
              <Button
                type="primary"
                size="small"
                danger
                icon={<DeleteOutlined />}
                loading={localDeleting}
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
                cleanMarkdownContent(selectedRequirement.description ?? '') ||
                '暂无需求描述'
              }
              className="requirement-description-markdown"
            />
          </div>
        </div>

        <dl className="requirement-info-grid local-requirement-grid">
          <div>
            <dt>所属版本</dt>
            <dd>{selectedRequirement.iterationName ?? '未规划迭代'}</dd>
          </div>
          <div>
            <dt>产品</dt>
            <dd>
              {selectedRequirement.productManagers[0] ? (
                <span className="local-requirement-product">
                  <Avatar
                    size={20}
                    src={selectedRequirement.productManagers[0].avatarUrl ?? undefined}
                  >
                    {selectedRequirement.productManagers[0].name.slice(0, 1)}
                  </Avatar>
                  <span>{selectedRequirement.productManagers[0].name}</span>
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
                  selectedRequirement.status
                )}`}
                bordered={false}
              >
                <span
                  className={`requirement-status-dot is-${getStatusTone(
                    selectedRequirement.status
                  )}`}
                />
                {selectedRequirement.status ?? '待处理'}
              </Tag>
            </dd>
          </div>
          <div>
            <dt>优先级</dt>
            <dd>
              {selectedRequirement.priority ? (
                <Tag
                  className={`requirement-header-tag is-${getPriorityTone(
                    selectedRequirement.priority
                  )}`}
                >
                  {selectedRequirement.priority}
                </Tag>
              ) : (
                '未设置'
              )}
            </dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>
              {dayjs(selectedRequirement.proposedAt).format('YYYY-MM-DD HH:mm')}
            </dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>
              {dayjs(selectedRequirement.updatedAt).format('YYYY-MM-DD HH:mm')}
            </dd>
          </div>
        </dl>
      </section>
    ) : null

  return (
    <div className="workbench">
      {/* 左侧：当前用户负责的需求，按所属迭代分组。 */}
      <aside className="workbench-sidebar">
        <div className="workbench-brand">
          <div className="workbench-brand-text">
            <strong>研发工作台</strong>
            <Select
              size="small"
              variant="borderless"
              showSearch
              className="workbench-project-select"
              value={data?.project.projectKey}
              options={projectOptions}
              loading={projectsLoading || projectSwitching}
              disabled={projectSwitching}
              optionFilterProp="label"
              popupMatchSelectWidth={220}
              onChange={(value: string) => handleProjectChange(value)}
            />
          </div>
        </div>

        <div className="workbench-sidebar-heading">
          <span className="workbench-sidebar-title">
            <span>我负责的需求</span>
            <span
              className="workbench-sidebar-count"
              aria-label={`共 ${data?.total ?? 0} 项`}
            >
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
            <Checkbox
              className="workbench-show-closed"
              checked={showClosedRequirements}
              disabled={loading || !data}
              onChange={(event) =>
                setShowClosedRequirements(event.target.checked)
              }
            >
              显示已结束
            </Checkbox>
          </span>
        </div>

        <Button
          block
          type="dashed"
          size="small"
          className="workbench-add-local"
          icon={<PlusOutlined />}
          disabled={!data}
          onClick={handleOpenCreateLocalRequirement}
        >
          新建临时需求
        </Button>

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
            allowClear
            showSearch
            className="workbench-filter-select workbench-iteration-filter"
            value={iterationFilter ?? undefined}
            options={iterationOptions}
            placeholder={`全部迭代（${data?.groups.length ?? 0}）`}
            aria-label="按迭代筛选"
            optionFilterProp="label"
            disabled={loading || !data || iterationOptions.length === 0}
            onChange={(value?: string) => setIterationFilter(value ?? null)}
          />

          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            maxTagPlaceholder={(omitted) => `+${omitted.length}`}
            className="workbench-filter-select workbench-status-filter"
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
          数据来自 Meegle 与本地临时需求
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
                  <div className="workbench-title-content">
                    <h1>{selectedRequirement.name}</h1>
                    <span className="workbench-title-copy-actions">
                      <Tooltip title="复制标题">
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined />}
                          aria-label="复制需求名称"
                          onClick={() => handleCopyRequirementName()}
                        />
                      </Tooltip>
                      {requirementUrl ? (
                        <Tooltip title="复制链接">
                          <Button
                            type="text"
                            size="small"
                            icon={<LinkOutlined />}
                            aria-label="复制需求链接"
                            onClick={() => handleCopyRequirementUrl()}
                          />
                        </Tooltip>
                      ) : null}
                    </span>
                  </div>
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
                  {selectedRequirementIsLocal ? (
                    <Tag className="local-requirement-tag" bordered={false}>
                      临时
                    </Tag>
                  ) : null}
                  <span className="workbench-updated-at">
                    {formatUpdatedAt(selectedRequirement.updatedAt)}
                  </span>
                  {!selectedRequirementIsLocal ? (
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
                        <>
                          <Input
                            className="workbench-personal-status-input"
                            variant="borderless"
                            size="small"
                            autoFocus
                            maxLength={120}
                            value={personalStatusDraft}
                            placeholder="标记当前进展"
                            aria-label="个人标记"
                            onChange={(event) => setPersonalStatusDraft(event.target.value)}
                            onBlur={() => handleSavePersonalStatus()}
                            onPressEnter={(event) => {
                              event.preventDefault()
                              event.currentTarget.blur()
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                event.preventDefault()
                                handleCancelPersonalStatusEdit()
                              }
                            }}
                          />
                        </>
                      ) : (
                        <button
                          type="button"
                          className={`workbench-personal-status-value${personalStatus?.value ? '' : ' is-placeholder'
                            }`}
                          onClick={handleStartPersonalStatusEdit}
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
                          onClick={handleStartPersonalStatusEdit}
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
                      <strong>
                        {selectedRequirementIsLocal ? '本地临时需求' : '研发执行视图'}
                      </strong>
                      <span>
                        {selectedRequirementIsLocal
                          ? '仅保存在本机，不会同步到 Meegle。'
                          : '完整字段、附件、审批和复杂流程请前往飞书处理。'}
                      </span>
                    </div>
                    <div className="workbench-scope-note-actions">
                      {requirementUrl ? (
                        <Button
                          type="primary"
                          icon={<ExportOutlined />}
                          onClick={() =>
                            window.electron.openEmbeddedBrowser(
                              requirementUrl
                            )
                          }
                        >
                          在飞书中处理
                        </Button>
                      ) : null}
                      <Button
                        type="primary"
                        ghost
                        icon={<RobotMark />}
                        onClick={handleAnalyzeRequirement}
                      >
                        AI 分析
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <div className="workbench-content" ref={workbenchContentRef}>
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

              <section className="requirement-repo-section">
                <div className="requirement-repo-heading">
                  <div className="requirement-repo-heading-title">
                    <h2>关联代码仓库</h2>
                    {bindings.length > 0 ? (
                      <span className="requirement-repo-count">
                        {bindings.length} 个仓库
                      </span>
                    ) : null}
                    <span
                      className="requirement-repo-description"
                      title="仅用于在工作台关联需求与代码仓库/分支，方便快速开发、提升效率"
                    >
                      <InfoCircleOutlined />
                      仅用于关联需求与代码分支，方便快速开发
                    </span>
                  </div>
                  <div className="requirement-repo-heading-actions">
                    <Tooltip title="刷新仓库和分支">
                      <Button
                        type="text"
                        size="small"
                        className="requirement-repo-refresh"
                        icon={<ReloadOutlined />}
                        loading={
                          repositoriesLoading || bindingsLoading || branchLoadingIds.size > 0
                        }
                        aria-label="刷新仓库和分支"
                        onClick={() => refreshBindings()}
                      >
                        刷新
                      </Button>
                    </Tooltip>
                    {bindings.length > 0 ? (
                      <Button
                        type="text"
                        size="small"
                        className="requirement-repo-add-toggle"
                        icon={addBindingOpen ? <CloseOutlined /> : <PlusOutlined />}
                        onClick={() => setAddBindingOpen((value) => !value)}
                      >
                        {addBindingOpen ? '取消' : '添加仓库'}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {bindingsError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="仓库绑定读取失败"
                    description={bindingsError}
                    className="requirement-repo-alert"
                  />
                ) : null}

                {bindingsLoading && bindings.length === 0 ? (
                  <Skeleton active paragraph={{ rows: 2 }} />
                ) : (
                  <>
                    {bindings.length > 0 ? (
                      <div className="requirement-repo-list">
                        {bindings.map((binding) => {
                          const repository = repositoryMap.get(binding.repositoryId)
                          const isQingzhou = binding.mode === 'qingzhou'
                          const openingThisBinding = openingIdeBindingId === binding.id
                          const bindingStatus = bindingStatuses[binding.id]
                          const qingzhouTasksUrl = binding.qingzhouWorkItemId
                            ? `https://z.xlbsoft.com/workList/tasks?workItemId=${encodeURIComponent(
                              binding.qingzhouWorkItemId
                            )}&archiveStatus=all${binding.qingzhouCodeRepositoryId
                              ? `&codeRepositoryId=${encodeURIComponent(
                                binding.qingzhouCodeRepositoryId
                              )}`
                              : ''
                            }`
                            : null
                          const qingzhouIterationBuildUrl =
                            isQingzhou &&
                              binding.iterationBranch &&
                              binding.qingzhouIterationBranchId
                              ? `https://z.xlbsoft.com/workList/branch/${encodeURIComponent(
                                binding.qingzhouIterationBranchId
                              )}`
                              : null
                          const remoteBranchesUrl = isQingzhou
                            ? null
                            : getRemoteBranchesUrl(repository?.remoteUrl)
                          const targetBranch = isQingzhou
                            ? binding.requirementBranch
                            : binding.branchName
                          const targetBranchMissing = Boolean(
                            targetBranch &&
                            bindingStatus &&
                            !bindingStatus.branchExists
                          )
                          const iterationBranchMissing = Boolean(
                            isQingzhou &&
                            binding.iterationBranch &&
                            bindingStatus &&
                            !bindingStatus.iterationBranchExists
                          )
                          const qingzhouBranchesMissing = Boolean(
                            isQingzhou &&
                            bindingStatus &&
                            !bindingStatus.branchExists &&
                            !bindingStatus.iterationBranchExists
                          )

                          return (
                            <div className="requirement-repo-row" key={binding.id}>
                              <div className="requirement-repo-info">
                                <span className="requirement-repo-icon">
                                  <FolderOpenOutlined />
                                </span>
                                <div className="requirement-repo-copy">
                                  <strong>{repository?.name ?? '仓库已移除'}</strong>
                                  {isQingzhou && qingzhouTasksUrl ? (
                                    <span className="requirement-repo-qingzhou-links">
                                      <Tooltip title="去创建合并">
                                        <Typography.Link
                                          className="requirement-repo-qingzhou-link"
                                          href={qingzhouTasksUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <LinkOutlined />
                                          轻舟工作任务
                                        </Typography.Link>
                                      </Tooltip>
                                      {qingzhouIterationBuildUrl ? (
                                        <Tooltip title="去构建流水线">
                                          <Typography.Link
                                            className="requirement-repo-qingzhou-link"
                                            href={qingzhouIterationBuildUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <DeploymentUnitOutlined />
                                            轻舟迭代分支构建
                                          </Typography.Link>
                                        </Tooltip>
                                      ) : null}
                                    </span>
                                  ) : remoteBranchesUrl ? (
                                    <span className="requirement-repo-qingzhou-links">
                                      <Tooltip title="打开远程仓库分支">
                                        <Typography.Link
                                          className="requirement-repo-qingzhou-link"
                                          href={remoteBranchesUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          <BranchesOutlined />
                                          远程仓库
                                        </Typography.Link>
                                      </Tooltip>
                                      {repository?.remoteUrl ? (
                                        <Tooltip title="选择来源和目标分支">
                                          <Typography.Link
                                            className="requirement-repo-qingzhou-link requirement-repo-mr-link"
                                            onClick={() =>
                                              handleOpenCreateMergeRequest(binding)
                                            }
                                          >
                                            <PullRequestOutlined />
                                            创建 MR
                                          </Typography.Link>
                                        </Tooltip>
                                      ) : null}
                                    </span>
                                  ) : null}
                                </div>
                                {repository && !repository.available ? (
                                  <Tag color="red" bordered={false}>
                                    不可用
                                  </Tag>
                                ) : null}
                              </div>

                              <div className="requirement-repo-branch-field">
                                {isQingzhou ? (
                                  <div className="requirement-repo-qingzhou">
                                    <BranchRow
                                      label="需求分支"
                                      tone="requirement"
                                      icon={<BranchesOutlined />}
                                      value={binding.requirementBranch}
                                      placeholder="待创建"
                                      status={
                                        targetBranchMissing ? (
                                          <Tag color="red" bordered={false}>
                                            不存在
                                          </Tag>
                                        ) : undefined
                                      }
                                      onCopy={handleCopyBranchName}
                                    />
                                    <BranchRow
                                      label="迭代分支"
                                      tone="iteration"
                                      icon={<TagOutlined />}
                                      value={binding.iterationBranch}
                                      placeholder="待绑定"
                                      status={
                                        iterationBranchMissing ? (
                                          <Tag color="red" bordered={false}>
                                            不存在
                                          </Tag>
                                        ) : undefined
                                      }
                                      onCopy={handleCopyBranchName}
                                    />
                                    {!binding.qingzhouTaskId ? (
                                      <div className="requirement-repo-qingzhou-state is-pending">
                                        <span>
                                          尚未创建代码任务，请在飞书需求详情的轻舟页签中创建工作项
                                        </span>
                                        {qingzhouRequirementUrl ? (
                                          <Typography.Link
                                            href={qingzhouRequirementUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            去飞书需求
                                          </Typography.Link>
                                        ) : null}
                                      </div>
                                    ) : !binding.requirementBranch ? (
                                      <div className="requirement-repo-qingzhou-state is-pending">
                                        <span>待创建需求分支</span>
                                        {qingzhouTasksUrl ? (
                                          <Typography.Link
                                            href={qingzhouTasksUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            去轻舟创建
                                          </Typography.Link>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : (
                                  <div className="requirement-repo-single-branch">
                                    <BranchesOutlined className="requirement-repo-single-branch-icon" />
                                    <span className="requirement-repo-single-branch-label">
                                      开发分支
                                    </span>
                                    {binding.branchName ? (
                                      <>
                                        <span
                                          className="requirement-repo-single-branch-name"
                                          title={binding.branchName}
                                        >
                                          {binding.branchName}
                                        </span>
                                        <Tooltip title="复制分支名">
                                          <Button
                                            type="text"
                                            size="small"
                                            className="requirement-repo-copy-branch"
                                            icon={<CopyOutlined />}
                                            aria-label="复制开发分支"
                                            onClick={() =>
                                              handleCopyBranchName(
                                                binding.branchName as string
                                              )
                                            }
                                          />
                                        </Tooltip>
                                      </>
                                    ) : (
                                      <span className="requirement-repo-branch-empty">
                                        未设置
                                      </span>
                                    )}
                                    {targetBranchMissing ? (
                                      <Tag color="red" bordered={false}>
                                        不存在
                                      </Tag>
                                    ) : null}
                                  </div>
                                )}
                              </div>

                              <div className="requirement-repo-row-actions">
                                {isQingzhou ? (
                                  <Button
                                    type="text"
                                    size="small"
                                    className="requirement-repo-sync-qingzhou"
                                    icon={<ReloadOutlined />}
                                    loading={syncingBindingId === binding.id}
                                    disabled={!repository?.available}
                                    onClick={() =>
                                      handleSyncQingzhouBinding(binding.id)
                                    }
                                  >
                                    同步
                                  </Button>
                                ) : null}
                                <Button
                                  type="text"
                                  size="small"
                                  className="requirement-repo-open-ide"
                                  icon={<CodeOutlined />}
                                  loading={openingThisBinding}
                                  disabled={
                                    !repository?.available ||
                                    (isQingzhou
                                      ? !binding.requirementBranch &&
                                      !binding.iterationBranch
                                      : bindingStatus?.branchExists === false) ||
                                    qingzhouBranchesMissing ||
                                    (openingIdeBindingId !== null && !openingThisBinding)
                                  }
                                  onClick={() => handleRequestOpenInIde(binding)}
                                >
                                  打开 IDE
                                </Button>
                                <Popconfirm
                                  title="解除仓库绑定？"
                                  description="只解除绑定，不会删除分支或本地代码。"
                                  okText="解除"
                                  cancelText="取消"
                                  onConfirm={() => handleRemoveBinding(binding.id)}
                                >
                                  <Button
                                    type="text"
                                    danger
                                    size="small"
                                    className="requirement-repo-remove"
                                    icon={<DeleteOutlined />}
                                    loading={removingBindingId === binding.id}
                                    aria-label={`解除 ${repository?.name ?? '仓库'} 绑定`}
                                  />
                                </Popconfirm>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}

                    {showAddBinding ? (
                      <div className="requirement-repo-add">
                        <div className="requirement-repo-add-title">绑定新仓库</div>
                        {repositoriesLoading ? (
                          <Skeleton active paragraph={{ rows: 1 }} title={false} />
                        ) : availableRepositories.length > 0 ? (
                          <div className="requirement-repo-add-row">
                            <div className="requirement-repo-add-field">
                              <label>仓库</label>
                              <Select
                                size="small"
                                showSearch
                                optionFilterProp="label"
                                className="requirement-repo-select"
                                placeholder="选择仓库"
                                value={newRepositoryId}
                                options={availableRepositories.map((repository) => ({
                                  value: repository.id,
                                  label: repository.name
                                }))}
                                onChange={(value: string) => {
                                  const repository = repositoryMap.get(value)

                                  setNewRepositoryId(value)
                                  setNewBranchName(null)

                                  if (!repository?.qingzhouEnabled) {
                                    loadBranches(value, true, true)
                                  }
                                }}
                              />
                            </div>
                            {newRepositoryIsQingzhou ? (
                              <div className="requirement-repo-add-field">
                                <label>轻舟工作项</label>
                                <div className="requirement-repo-qingzhou-workitem">
                                  自动使用当前需求 ID：
                                  <code>{selectedRequirementId}</code>
                                </div>
                              </div>
                            ) : (
                              <div className="requirement-repo-add-field">
                                <label>开发分支</label>
                                <Select
                                  size="small"
                                  showSearch
                                  className="requirement-repo-branch"
                                  placeholder="选择开发分支"
                                  value={newBranchName}
                                  disabled={!newRepositoryId}
                                  loading={newRepositoryBranchesLoading}
                                  notFoundContent={
                                    newRepositoryBranchesLoading ? (
                                      <Spin size="small" />
                                    ) : newRepositoryId ? (
                                      '暂无可选分支'
                                    ) : (
                                      '请先选择仓库'
                                    )
                                  }
                                  options={newRepositoryBranchOptions}
                                  onChange={(value: string) => setNewBranchName(value)}
                                />
                              </div>
                            )}
                            <div className="requirement-repo-add-actions">
                              {!newRepositoryIsQingzhou ? (
                                <Button
                                  type="text"
                                  size="small"
                                  className="requirement-repo-create-branch"
                                  icon={<PlusOutlined />}
                                  disabled={!newRepositoryId}
                                  onClick={() => openCreateBranch()}
                                >
                                  新建分支
                                </Button>
                              ) : null}
                              <Button
                                type="primary"
                                size="small"
                                className="requirement-repo-submit"
                                loading={bindingSaving}
                                disabled={
                                  !newRepositoryId ||
                                  (!newRepositoryIsQingzhou && !newBranchName)
                                }
                                onClick={() => handleAddBinding()}
                              >
                                添加
                              </Button>
                            </div>
                            {newRepositoryIsQingzhou ? (
                              <p className="requirement-repo-add-hint">
                                将自动使用当前飞书需求 ID 查询轻舟代码任务和分支。
                              </p>
                            ) : null}
                          </div>
                        ) : repositories.length === 0 ? (
                          <div className="requirement-repo-empty">
                            <FolderOpenOutlined className="requirement-repo-empty-icon" />
                            <div>
                              <strong>还没有可用代码仓库</strong>
                              <span>请先在设置中配置代码根目录和仓库。</span>
                            </div>
                            <Button
                              type="link"
                              size="small"
                              onClick={() => onOpenSettings('repositories')}
                            >
                              去设置
                            </Button>
                          </div>
                        ) : (
                          <p className="requirement-repo-hint">没有可绑定的仓库</p>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              {localRequirementDetail}

              {selectedRequirementIsLocal ? null : (
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
                      onSelectNode={handleSelectNode}
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
                                notFoundContent={
                                  nodeOwnerSearching ? '搜索中...' : '未找到用户'
                                }
                                optionRender={(option) => {
                                  const owner = nodeOwnerOptions.find(
                                    (item) => item.userKey === String(option.value)
                                  )

                                  if (!owner) return option.label

                                  return (
                                    <span className="requirement-node-owner-option">
                                      <Avatar
                                        size={24}
                                        src={owner.avatarUrl ?? undefined}
                                      >
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
                                      <Avatar
                                        size={16}
                                        src={owner.avatarUrl ?? undefined}
                                      >
                                        {owner.name.slice(0, 1)}
                                      </Avatar>
                                      <span>{owner.name}</span>
                                    </span>
                                  )
                                }}
                                onChange={(value: string[]) => setNodeEditOwnerKeys(value)}
                                onSearch={handleNodeOwnerSearch}
                              />
                            ) : (
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
                                    setNodeEditPoints(
                                      typeof value === 'number' ? value : null
                                    )
                                  }
                                />
                              ) : (
                                <strong>{formatWorkTime(selectedNode.points)}</strong>
                              )
                            ) : (
                              <strong className="requirement-node-summary-na">
                                不适用
                              </strong>
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
                              )
                            ) : (
                              <strong className="requirement-node-summary-na">
                                不适用
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
                                  <strong>
                                    {formatWorkTime(selectedNode.actualWorkTime)}
                                  </strong>
                                </div>
                              ) : null}
                              {selectedNode.supportsPoints ? (
                                <div className="requirement-node-workhour-summary">
                                  <span>
                                    总估分：{formatWorkTime(selectedNode.points)}
                                  </span>
                                  <span>
                                    总剩余工时：{formatWorkTime(nodeRemainingWorkTime)}
                                  </span>
                                </div>
                              ) : null}
                              {selectedNode.supportsActualWorkTime ? (
                                <>
                                  <div className="requirement-node-workhour-actual">
                                    实际工时需在飞书项目页面登记。
                                  </div>
                                  <div className="requirement-node-workhour-actual">
                                    实际时间：
                                    {formatNodeActualTime(
                                      selectedNode.actualStart,
                                      selectedNode.actualEnd,
                                      selectedNode.status
                                    )}
                                  </div>
                                </>
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
                                  <Button
                                    size="small"
                                    onClick={handleCancelDescriptionEdit}
                                  >
                                    取消
                                  </Button>
                                  <Button
                                    type="primary"
                                    size="small"
                                    loading={descriptionSaving}
                                    onClick={() => handleSaveDescription()}
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
                                  onClick={handleStartDescriptionEdit}
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
                                  onChange={setDescriptionDraft}
                                />
                                <p className="requirement-description-edit-hint">
                                  保存后会直接同步到飞书项目。
                                </p>
                              </>
                            ) : (() => {
                              const description = cleanMarkdownContent(selectedRequirement.description ?? '') || '暂无需求描述'
                              const collapsed =
                                !descriptionExpanded &&
                                (description.length > 420 ||
                                  description.split('\n').length > 12)

                              return (
                                <>
                                  <div
                                    className={`requirement-description-box${collapsed ? ' is-collapsed' : ''
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
                              )
                            })()}
                          </div>

                          <div className="requirement-info-groups">
                            {primaryInfoGroups.map((group) => (
                              <section
                                className="requirement-info-group"
                                key={group.title}
                              >
                                <h4>{group.title}</h4>
                                <dl className="requirement-info-grid">
                                  {group.fields.map((field) => (
                                    <div
                                      key={field.label}
                                      className={
                                        field.wide ? 'is-wide' : undefined
                                      }
                                    >
                                      {field.hideLabel ? null : (
                                        <dt>{field.label}</dt>
                                      )}
                                      <dd>{field.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </section>
                            ))}
                          </div>

                          <div className="requirement-info-more">
                            <div className="requirement-info-more-head">
                              <button
                                type="button"
                                className="requirement-info-more-toggle"
                                aria-expanded={moreFieldsOpen}
                                aria-controls="requirement-more-fields"
                                onClick={() =>
                                  setMoreFieldsOpen((value) => !value)
                                }
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
                                  <section
                                    className="requirement-info-group"
                                    key={group.title}
                                  >
                                    <h4>{group.title}</h4>
                                    <dl className="requirement-info-grid">
                                      {group.fields.map((field) => (
                                        <div
                                          key={field.label}
                                          className={
                                            field.wide
                                              ? 'is-wide'
                                              : undefined
                                          }
                                        >
                                          {field.hideLabel ? null : (
                                            <dt>{field.label}</dt>
                                          )}
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
                          {selectedRequirement.remark ? (
                            <div className="requirement-remark-block">
                              <h3>备注</h3>
                              <p>{selectedRequirement.remark}</p>
                            </div>
                          ) : null}

                          <div className="requirement-comments-heading">
                            <h3>评论</h3>
                            {activity ? (
                              <span>共 {activity.commentsTotal} 条</span>
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
                </>
              )}
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
        title="创建合并请求"
        open={Boolean(mergeRequestBinding)}
        okText="打开创建页"
        cancelText="取消"
        destroyOnHidden
        okButtonProps={{
          disabled:
            !mergeRequestUrl ||
            !mergeRequestSource ||
            !mergeRequestTarget ||
            mergeRequestSource === mergeRequestTarget
        }}
        onOk={() => {
          if (!mergeRequestUrl || !mergeRequestSource || !mergeRequestTarget) return

          if (mergeRequestSource === mergeRequestTarget) {
            message.warning('来源分支和目标分支不能相同')
            return
          }

          const url = mergeRequestUrl
          setMergeRequestBinding(null)
          window.electron.openEmbeddedBrowser(url)
        }}
        onCancel={() => {
          setMergeRequestBinding(null)
          setMergeRequestSource(null)
          setMergeRequestTarget(null)
          setMergeRequestBranches([])
          setMergeRequestWarning(null)
        }}
      >
        <div className="requirement-mr-form">
          <p>
            选择合并请求的来源和目标分支，将在应用内浏览器打开 Codeup 创建页面。
            冲突由 Codeup 显示和处理。
          </p>
          {mergeRequestWarning ? (
            <Alert type="warning" showIcon message={mergeRequestWarning} />
          ) : null}
          <label>来源分支</label>
          <Select
            showSearch
            className="requirement-mr-branch"
            value={mergeRequestSource ?? undefined}
            options={mergeRequestBranchOptions}
            loading={mergeRequestBranchesLoading}
            placeholder="选择来源分支"
            optionFilterProp="label"
            onChange={(value: string) => setMergeRequestSource(value)}
          />
          <label>目标分支</label>
          <Select
            showSearch
            className="requirement-mr-branch"
            value={mergeRequestTarget ?? undefined}
            options={mergeRequestBranchOptions}
            loading={mergeRequestBranchesLoading}
            placeholder="选择目标分支"
            optionFilterProp="label"
            onChange={(value: string) => setMergeRequestTarget(value)}
          />
          {mergeRequestSource === mergeRequestTarget && mergeRequestSource ? (
            <Alert type="warning" showIcon message="来源分支和目标分支不能相同" />
          ) : null}
          {!mergeRequestUrl && mergeRequestSource && mergeRequestTarget ? (
            <Alert type="warning" showIcon message="无法生成合并请求地址，请检查远程仓库地址" />
          ) : null}
        </div>
      </Modal>

      <Modal
        title="选择打开 IDE 的分支"
        open={branchChoiceOpen}
        okText="打开 IDE"
        cancelText="取消"
        destroyOnHidden
        onOk={handleConfirmBranchChoice}
        onCancel={() => {
          setBranchChoiceOpen(false)
          setBranchChoiceBinding(null)
        }}
      >
        <div className="requirement-branch-choice">
          <p>该轻舟仓库同时存在需求分支和迭代分支，请选择要打开的分支。</p>
          <Radio.Group
            value={branchChoiceType}
            onChange={(event) =>
              setBranchChoiceType(
                event.target.value as 'requirement' | 'iteration'
              )
            }
          >
            <Radio value="requirement">
              <span className="requirement-branch-choice-label">需求分支</span>
              <span className="requirement-branch-choice-name">
                {branchChoiceBinding?.requirementBranch}
              </span>
            </Radio>
            <Radio value="iteration">
              <span className="requirement-branch-choice-label">迭代分支</span>
              <span className="requirement-branch-choice-name">
                {branchChoiceBinding?.iterationBranch}
              </span>
            </Radio>
          </Radio.Group>
          {canPrefillSession ? (
            <div className="requirement-ide-session-option">
              <Checkbox
                className="requirement-ide-session-checkbox"
                checked={ideSessionPrompt}
                onChange={(event) => updateIdeSessionPrompt(event.target.checked)}
              >
                预置需求分析会话
              </Checkbox>
              <p className="settings-help">
                勾选后会创建 AI 会话并预填当前需求的飞书链接；取消勾选则只打开 IDE。
              </p>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="打开 IDE"
        open={Boolean(openIdeConfirmBinding)}
        okText="打开 IDE"
        cancelText="取消"
        destroyOnHidden
        onOk={() => {
          const binding = openIdeConfirmBinding
          const branchName = openIdeConfirmBranch

          setOpenIdeConfirmBinding(null)
          setOpenIdeConfirmBranch(null)

          if (binding && branchName) {
            handleOpenInIde(
              binding,
              branchName,
              canPrefillSession && ideSessionPrompt
            )
          }
        }}
        onCancel={() => {
          setOpenIdeConfirmBinding(null)
          setOpenIdeConfirmBranch(null)
        }}
      >
        <div className="requirement-ide-open-confirm">
          <p>
            即将在 IDE 中打开仓库
            {openIdeConfirmBinding
              ? `「${repositoryMap.get(openIdeConfirmBinding.repositoryId)?.name ??
              openIdeConfirmBinding.repositoryId
              }」`
              : ''}
            。
          </p>
          {openIdeConfirmBranch ? (
            <p className="requirement-ide-open-branch">
              分支：{openIdeConfirmBranch}
            </p>
          ) : null}
          {canPrefillSession ? (
            <div className="requirement-ide-session-option">
              <Checkbox
                className="requirement-ide-session-checkbox"
                checked={ideSessionPrompt}
                onChange={(event) => updateIdeSessionPrompt(event.target.checked)}
              >
                预置需求分析会话
              </Checkbox>
              <p className="settings-help">
                勾选后会创建 AI 会话并预填当前需求的飞书链接；取消勾选则只打开 IDE。
              </p>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="新建开发分支"
        open={createBranchOpen}
        okText="创建并绑定"
        cancelText="取消"
        okButtonProps={{
          disabled: !createBranchBase || !createBranchName.trim()
        }}
        confirmLoading={createBranchSaving}
        destroyOnHidden
        onOk={() => handleCreateBranch()}
        onCancel={() => setCreateBranchOpen(false)}
      >
        <div className="requirement-branch-create-form">
          <label>仓库</label>
          <div className="requirement-branch-create-repo">
            {newRepositoryId
              ? repositoryMap.get(newRepositoryId)?.name ?? newRepositoryId
              : '未选择仓库'}
          </div>
          <label>基线分支</label>
          <Select
            showSearch
            value={createBranchBase}
            options={newRepositoryBranchOptions}
            placeholder="选择基线分支"
            onChange={(value: string) => setCreateBranchBase(value)}
          />
          <label>新分支名</label>
          <Input
            value={createBranchName}
            placeholder="feat/首字母/需求ID"
            spellCheck={false}
            onChange={(event) => setCreateBranchName(event.target.value)}
          />
          <p>会从基线分支创建本地分支，并自动绑定到当前需求。</p>
        </div>
      </Modal>

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

      <LocalRequirementModal
        open={localModalOpen}
        initialRequirement={localModalRequirement}
        versions={localVersionOptions}
        saving={localSaving}
        onCancel={() => {
          setLocalModalOpen(false)
          setLocalModalRequirement(null)
        }}
        onSubmit={handleSubmitLocalRequirement}
      />
    </div>
  )
}
