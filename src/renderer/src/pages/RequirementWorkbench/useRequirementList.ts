import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App } from 'antd'
import type {
  MeegleMyRequirements,
  MeegleProject,
  MeegleRequirement,
  MeegleRequirementGroup,
  MeegleRequirementNodeCompletion
} from '../../../../types/requirements'
import type { LocalRequirementVersionOption } from '../../components/LocalRequirementModal/LocalRequirementModal'
import { getErrorMessage, parseReleaseDate } from '../../../../utils'
import { getRequirementProductLines, isLocalRequirementId } from './workbench-utils'

/** 记住上次选择需求的 localStorage key。 */
const SELECTED_REQUIREMENT_KEY = 'develop-workbench:selected-requirement'
/** 打开已结束本地需求时的一次性标记。 */
const OPEN_CLOSED_REQUIREMENT_KEY = 'develop-workbench:open-closed-requirement'
/** 记住筛选区域是否收起的 localStorage key。 */
const FILTERS_COLLAPSED_KEY = 'develop-workbench:filters-collapsed'

/**
 * 需求列表、空间切换、筛选和选择状态。
 */
export const useRequirementList = () => {
  const { message } = App.useApp()

  const [data, setData] = useState<MeegleMyRequirements | null>(null)
  const [nodeCompletions, setNodeCompletions] = useState<
    Record<string, MeegleRequirementNodeCompletion>
  >({})
  const [projects, setProjects] = useState<MeegleProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectSwitching, setProjectSwitching] = useState(false)
  const projectSwitchRef = useRef(false)
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(
    null
  )
  const [selectedRequirementGroupKey, setSelectedRequirementGroupKey] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requirementFilter, setRequirementFilter] = useState('')
  const [showClosedRequirements, setShowClosedRequirements] = useState(
    () => localStorage.getItem(OPEN_CLOSED_REQUIREMENT_KEY) === '1'
  )
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [productLineFilters, setProductLineFilters] = useState<string[]>([])
  const [versionFilter, setVersionFilter] = useState<string | null>(null)
  const [filtersCollapsed, setFiltersCollapsed] = useState(
    () => localStorage.getItem(FILTERS_COLLAPSED_KEY) === '1'
  )
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(
    () => new Set()
  )

  const loadRequestRef = useRef(0)
  const workbenchContentRef = useRef<HTMLDivElement>(null)

  /** 当前用户全部需求，用于保持选中项和生成头部信息。 */
  const allRequirements = useMemo(() => {
    const byId = new Map<string, MeegleRequirement>()

    for (const group of data?.groups ?? []) {
      for (const requirement of group.requirements) {
        if (!byId.has(requirement.id)) byId.set(requirement.id, requirement)
      }
    }

    return Array.from(byId.values())
  }, [data])

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
    allRequirements.find((requirement) => requirement.id === selectedRequirementId) ??
    null

  /** 当前选中需求所属的版本分组。 */
  const selectedGroup = useMemo(() => {
    if (!selectedRequirementId) return null

    const groups = data?.groups ?? []
    const containsSelected = (group: MeegleRequirementGroup): boolean =>
      group.requirements.some(
        (requirement) => requirement.id === selectedRequirementId
      )

    for (const key of [versionFilter, selectedRequirementGroupKey]) {
      if (!key) continue

      const matched = groups.find(
        (group) => group.key === key && containsSelected(group)
      )

      if (matched) return matched
    }

    return groups.find(containsSelected) ?? null
  }, [data, versionFilter, selectedRequirementGroupKey, selectedRequirementId])

  /** 打开仓库汇总时优先选中的版本。 */
  const versionSummaryPreferredKey = useMemo(() => {
    if (versionFilter) return versionFilter
    if (selectedGroup) return selectedGroup.key

    const version = selectedRequirement?.planningVersions[0]

    if (version) {
      const date = parseReleaseDate(version)

      if (date) return `date:${date}`
      if (selectedRequirement?.iterationId) {
        return selectedRequirement.iterationId
      }

      return `version:${version}`
    }

    if (selectedRequirement?.iterationDate) {
      return `date:${selectedRequirement.iterationDate}`
    }

    if (selectedRequirement?.iterationId) return selectedRequirement.iterationId
    if (selectedRequirement?.iterationName) {
      return `version:${selectedRequirement.iterationName}`
    }

    return null
  }, [versionFilter, selectedGroup, selectedRequirement])

  /** 当前选中的是否为本地临时需求。 */
  const selectedRequirementIsLocal = isLocalRequirementId(selectedRequirementId)

  /** 新建/编辑临时需求时可选的现有版本。 */
  const localVersionOptions = useMemo<LocalRequirementVersionOption[]>(() => {
    const options = (data?.groups ?? []).map((group) => ({
      key: group.key,
      label: group.versionName,
      representativeIterationId: group.representativeIterationId,
      versionName: group.key === 'unplanned' ? null : group.versionName,
      versionDate: group.releaseDate
    }))

    if (!options.some((option) => option.key === 'unplanned')) {
      options.push({
        key: 'unplanned',
        label: '未规划版本',
        representativeIterationId: null,
        versionName: null,
        versionDate: null
      })
    }

    return options
  }, [data])

  /** 状态筛选项。 */
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

  /** 本地临时需求可选的产线，使用全部需求中的产线选项。 */
  const allProductLineOptions = useMemo(() => {
    const values = new Set(
      allRequirements.flatMap((requirement) => getRequirementProductLines(requirement))
    )

    return [...values].sort((left, right) => {
      if (left === '未设置产线') return 1
      if (right === '未设置产线') return -1

      return left.localeCompare(right, 'zh-CN', { numeric: true })
    })
  }, [allRequirements])

  /** 当前版本范围内的需求；未选版本时使用全部需求。 */
  const productLineScopeRequirements = useMemo(() => {
    if (!versionFilter) return allRequirements

    return (
      data?.groups.find((group) => group.key === versionFilter)?.requirements ?? []
    )
  }, [allRequirements, data, versionFilter])

  /** 产线筛选选项。 */
  const productLineOptions = useMemo(() => {
    const counts = new Map<string, number>()

    for (const requirement of productLineScopeRequirements) {
      for (const productLine of getRequirementProductLines(requirement)) {
        counts.set(productLine, (counts.get(productLine) ?? 0) + 1)
      }
    }

    return Array.from(counts.entries())
      .sort((left, right) => {
        if (left[0] === '未设置产线') return 1
        if (right[0] === '未设置产线') return -1

        return left[0].localeCompare(right[0], 'zh-CN', { numeric: true })
      })
      .map(([productLine, count]) => ({
        value: productLine,
        label: `${productLine}（${count}）`
      }))
  }, [productLineScopeRequirements])

  /** 版本筛选选项。 */
  const versionOptions = useMemo(
    () =>
      (data?.groups ?? []).map((group) => ({
        value: group.key,
        label: `${group.versionName}（${group.requirements.length}）`
      })),
    [data]
  )

  /** 筛选后的需求分组。 */
  /**
   * 先限制版本范围，再按状态筛选，最后按需求名称、状态或版本名称搜索。
   * 版本名称命中时，保留该版本下符合状态条件的全部需求。
   */
  const filteredGroups = useMemo(() => {
    const keyword = requirementFilter.trim().toLocaleLowerCase()

    const selectedStatuses = new Set(statusFilters)
    const selectedProductLines = new Set(productLineFilters)

    const scopedGroups = versionFilter
      ? (data?.groups ?? []).filter((group) => group.key === versionFilter)
      : data?.groups ?? []

    return scopedGroups.flatMap((group) => {
      const statusFiltered =
        selectedStatuses.size > 0
          ? group.requirements.filter((requirement) =>
              selectedStatuses.has(requirement.status ?? '状态未知')
            )
          : group.requirements
      const productLineFiltered =
        selectedProductLines.size > 0
          ? statusFiltered.filter((requirement) =>
              getRequirementProductLines(requirement).some((line) =>
                selectedProductLines.has(line)
              )
            )
          : statusFiltered

      if (productLineFiltered.length === 0) return []

      if (!keyword || group.versionName.toLocaleLowerCase().includes(keyword)) {
        return [{ ...group, requirements: productLineFiltered }]
      }

      const requirements = productLineFiltered.filter((requirement) =>
        [
          requirement.name,
          requirement.status ?? '',
          requirement.priority ?? '',
          requirement.requirementType ?? '',
          requirement.productLines.join(' '),
          requirement.productManagers.map((manager) => manager.name).join(' '),
          requirement.productOwners.map((owner) => owner.name).join(' ')
        ].some((value) => value.toLocaleLowerCase().includes(keyword))
      )

      return requirements.length > 0 ? [{ ...group, requirements }] : []
    })
  }, [data, versionFilter, productLineFilters, requirementFilter, statusFilters])

  /** 当前筛选的版本不存在时自动恢复全部版本。 */
  useEffect(() => {
    if (!versionFilter || !data) return

    if (!data.groups.some((group) => group.key === versionFilter)) {
      setVersionFilter(null)
    }
  }, [data, versionFilter])

  /** 是否存在有效搜索词。 */
  const hasSearch = requirementFilter.trim().length > 0
  const activeFilterCount =
    (hasSearch ? 1 : 0) +
    statusFilters.length +
    productLineFilters.length +
    (versionFilter ? 1 : 0)

  const hasActiveFilter =
    hasSearch ||
    statusFilters.length > 0 ||
    productLineFilters.length > 0 ||
    Boolean(versionFilter)

  /** 所有分组是否都已收起。 */
  const allGroupsCollapsed =
    (data?.groups.length ?? 0) > 0 &&
    (data?.groups ?? []).every((group) => collapsedGroupKeys.has(group.key))

  /** 筛选时自动展开分组，同时隐藏全部收起按钮。 */
  const showToggleAll = (data?.groups.length ?? 0) > 1 && !hasActiveFilter

  const projectName = data?.project.name ?? 'Meegle'

  /** 读取当前用户负责的需求，并尽量保留已有选择。 */
  const loadRequirements = useCallback(async (): Promise<void> => {
    const requestId = ++loadRequestRef.current

    setLoading(true)
    setError(null)

    try {
      const result = await window.electron.getMyRequirements(showClosedRequirements)

      if (requestId !== loadRequestRef.current) return

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
      if (requestId === loadRequestRef.current) {
        setError(getErrorMessage(loadError))
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
      }
    }
  }, [showClosedRequirements])

  useEffect(() => {
    loadRequirements()
  }, [loadRequirements])

  /** 分批读取当前用户负责节点的完成情况。 */
  useEffect(() => {
    const remoteIds = Array.from(
      new Set(
        (data?.groups ?? []).flatMap((group) =>
          group.requirements
            .filter((requirement) => requirement.source === 'meegle')
            .map((requirement) => requirement.id)
        )
      )
    )

    if (remoteIds.length === 0) {
      setNodeCompletions({})
      return
    }

    let cancelled = false

    const loadChunks = async (): Promise<void> => {
      const batchSize = 8

      for (let index = 0; index < remoteIds.length; index += batchSize) {
        if (cancelled) return

        const batch = remoteIds.slice(index, index + batchSize)

        try {
          const result = await window.electron.getMyRequirementNodeCompletions(batch)

          if (cancelled) return

          setNodeCompletions((current) => ({ ...current, ...result }))
        } catch {
          // 单批读取失败时跳过，不打扰左侧列表。
        }
      }
    }

    void loadChunks()

    return () => {
      cancelled = true
    }
  }, [data])

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

  /** 切换 Meegle 空间并重新加载需求。 */
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
      setVersionFilter(null)
      setCollapsedGroupKeys(new Set())
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
      setVersionFilter(null)
      setCollapsedGroupKeys(new Set())
      setData(null)
      loadRequirements()
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

  /** 记住用户选择的需求，下次打开时继续展示。 */
  useEffect(() => {
    if (selectedRequirementId) {
      localStorage.setItem(SELECTED_REQUIREMENT_KEY, selectedRequirementId)
    }
  }, [selectedRequirementId])

  /** 记住筛选区域是否收起。 */
  useEffect(() => {
    localStorage.setItem(FILTERS_COLLAPSED_KEY, filtersCollapsed ? '1' : '0')
  }, [filtersCollapsed])

  /** 版本切换后移除当前版本不存在的产线选择。 */
  useEffect(() => {
    const available = new Set(productLineOptions.map((option) => option.value))

    setProductLineFilters((current) =>
      current.every((value) => available.has(value))
        ? current
        : current.filter((value) => available.has(value))
    )
  }, [productLineOptions])

  /** 当筛选结果中不包含当前选中需求时，自动选中第一条可见需求。 */
  useEffect(() => {
    if (filteredGroups.length === 0) return

    const visibleIds = new Set(
      filteredGroups.flatMap((group) =>
        group.requirements.map((requirement) => requirement.id)
      )
    )

    if (selectedRequirementId && visibleIds.has(selectedRequirementId)) return

    const firstRequirementId = filteredGroups[0]?.requirements[0]?.id

    if (firstRequirementId) setSelectedRequirementId(firstRequirementId)
  }, [filteredGroups, selectedRequirementId])

  /** 选中需求后滚动到左侧列表可见区域。 */
  useEffect(() => {
    if (!selectedRequirementId) return

    const groupKey = selectedGroup?.key
    const element = groupKey
      ? document.getElementById(
          `workbench-requirement-${groupKey}-${selectedRequirementId}`
        )
      : document.getElementById(`workbench-requirement-${selectedRequirementId}`)

    element?.scrollIntoView({ block: 'nearest' })
  }, [selectedRequirementId, selectedGroup?.key, data, requirementFilter])

  /** 切换需求时回到详情顶部。 */
  useEffect(() => {
    workbenchContentRef.current?.scrollTo({ top: 0, left: 0 })
  }, [selectedRequirementId])

  /** 清除当前选择及持久化记录。 */
  const clearSelectedRequirement = (): void => {
    localStorage.removeItem(SELECTED_REQUIREMENT_KEY)
    setSelectedRequirementId(null)
  }

  /** 切换分组展开状态。 */
  const toggleRequirementGroup = (groupKey: string): void => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current)

      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)

      return next
    })
  }

  /** 一键展开或收起全部版本分组。 */
  const toggleAllRequirementGroups = (): void => {
    if (!data) return

    setCollapsedGroupKeys((current) => {
      const allCollapsed = data.groups.every((group) => current.has(group.key))

      return allCollapsed ? new Set() : new Set(data.groups.map((group) => group.key))
    })
  }

  return {
    data,
    nodeCompletions,
    projectsLoading,
    projectSwitching,
    selectedRequirementId,
    setSelectedRequirementId,
    setSelectedRequirementGroupKey,
    selectedRequirement,
    selectedGroup,
    selectedRequirementIsLocal,
    allRequirements,
    projectOptions,
    localVersionOptions,
    versionSummaryPreferredKey,
    loading,
    error,
    setError,
    requirementFilter,
    setRequirementFilter,
    showClosedRequirements,
    setShowClosedRequirements,
    statusFilters,
    setStatusFilters,
    productLineFilters,
    setProductLineFilters,
    versionFilter,
    setVersionFilter,
    filtersCollapsed,
    setFiltersCollapsed,
    collapsedGroupKeys,
    projectName,
    statusOptions,
    allProductLineOptions,
    productLineOptions,
    versionOptions,
    filteredGroups,
    hasSearch,
    activeFilterCount,
    allGroupsCollapsed,
    showToggleAll,
    workbenchContentRef,
    loadRequirements,
    clearSelectedRequirement,
    handleProjectChange,
    toggleRequirementGroup,
    toggleAllRequirementGroups
  }
}
