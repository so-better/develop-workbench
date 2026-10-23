import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DownOutlined,
  ExportOutlined,
  NodeCollapseOutlined,
  NodeExpandOutlined,
  ReloadOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { Alert, Button, Empty, Input, Select, Skeleton, Tag, Tooltip } from 'antd'
import type { InputRef } from 'antd'
import type {
  MeegleMyRequirements,
  MeegleRequirement,
  MeegleRequirementGroup
} from '../../../types/requirements'
import type { SettingsSection } from '../../../types/settings'

interface RequirementWorkbenchProps {
  /** 打开设置弹窗，并定位到指定分类。 */
  onOpenSettings: (section: SettingsSection) => void
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
 * 需求工作台。
 * 左侧展示当前用户的需求，右侧暂时只保留需求头部信息。
 */
export default function RequirementWorkbench({
  onOpenSettings
}: RequirementWorkbenchProps): JSX.Element {
  const [data, setData] = useState<MeegleMyRequirements | null>(null)
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requirementFilter, setRequirementFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

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

  /** 飞书需求详情页地址。 */
  const requirementUrl =
    selectedRequirement && data
      ? `https://project.feishu.cn/${encodeURIComponent(
          data.project.key
        )}/story/detail/${encodeURIComponent(selectedRequirement.id)}`
      : null

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

    return [
      { value: '', label: `全部状态（${allRequirements.length}）` },
      ...Array.from(counts.entries())
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
    ]
  }, [allRequirements])

  /**
   * 先按状态筛选，再按需求名称、状态或迭代名称搜索。
   * 迭代名称命中时，保留该迭代下符合状态条件的全部需求。
   */
  const filteredGroups = useMemo(() => {
    const keyword = requirementFilter.trim().toLocaleLowerCase()

    return (data?.groups ?? []).flatMap((group) => {
      const statusFiltered = statusFilter
        ? group.requirements.filter(
            (requirement) => (requirement.status ?? '状态未知') === statusFilter
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
  }, [data, requirementFilter, statusFilter])

  /** 是否存在有效搜索词或状态筛选。 */
  const hasSearch = requirementFilter.trim().length > 0
  const hasActiveFilter = hasSearch || Boolean(statusFilter)

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
        {requirement.priority === 'P0' || requirement.priority === 'P1' ? (
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
          <span>我的待办需求</span>
          <span className="workbench-sidebar-heading-actions">
            <span className="workbench-sidebar-count">{data?.total ?? 0}</span>
            <Tooltip title="刷新数据">
              <Button
                type="text"
                size="small"
                className="workbench-sidebar-refresh"
                icon={<ReloadOutlined />}
                loading={loading}
                aria-label="刷新数据"
                onClick={() => loadRequirements()}
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
            className="workbench-status-filter"
            value={statusFilter ?? ''}
            options={statusOptions}
            aria-label="按状态筛选"
            disabled={loading || !data || allRequirements.length === 0}
            onChange={(value: string) => setStatusFilter(value || null)}
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
          数据来自 Meegle 我的待办
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
                  {projectName} / {selectedGroup?.iterationName ?? '我的待办需求'}
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
                      onClick={() => loadRequirements()}
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

            {error ? (
              <div className="workbench-content">
                <Alert
                  className="workbench-inline-alert"
                  type="warning"
                  showIcon
                  closable
                  message="刷新数据失败，当前展示上次同步结果"
                  description={error}
                  onClose={() => setError(null)}
                />
              </div>
            ) : null}
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
    </div>
  )
}
