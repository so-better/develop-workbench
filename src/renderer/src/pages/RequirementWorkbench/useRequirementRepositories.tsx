import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button } from 'antd'
import type { RequirementRepoBinding } from '../../../../types/bindings'
import type { Repository, RepositoryBindingStatus } from '../../../../types/repository'
import type { LarkUser } from '../../../../types/lark'
import type { MeegleRequirement } from '../../../../types/requirements'
import type { SettingsSection } from '../../../../types/settings'
import { getErrorMessage } from '../../../../utils'
import {
  getMergeRequestUrl,
  getUserNameInitials,
  isLocalRequirementId
} from './workbench-utils'

/** 记住是否预置 IDE 会话的 localStorage key。 */
const IDE_SESSION_PROMPT_KEY = 'develop-workbench:ide-session-prompt'
/** IDE 会话里最多带入的本地需求描述长度。 */
const IDE_SESSION_DESCRIPTION_LIMIT = 2_000

interface UseRequirementRepositoriesOptions {
  active: boolean
  selectedRequirementId: string | null
  selectedRequirement: MeegleRequirement | null
  selectedRequirementIsLocal: boolean
  requirementUrl: string | null
  larkUser: LarkUser | null
  onOpenSettings: (section: SettingsSection) => void
}

/**
 * 需求关联仓库、分支、IDE 和合并请求状态。
 */
export const useRequirementRepositories = ({
  active,
  selectedRequirementId,
  selectedRequirement,
  selectedRequirementIsLocal,
  requirementUrl,
  larkUser,
  onOpenSettings
}: UseRequirementRepositoriesOptions) => {
  const { message, notification } = App.useApp()

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
  const [branchEditBinding, setBranchEditBinding] =
    useState<RequirementRepoBinding | null>(null)
  const [branchEditName, setBranchEditName] = useState<string | null>(null)
  const [branchEditSaving, setBranchEditSaving] = useState(false)
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
  const qingzhouTabKey = 'MII_69A014D411820BBC_dashboard_01py9t'
  const qingzhouRequirementUrl = requirementUrl
    ? `${requirementUrl}?tabKey=${qingzhouTabKey}#${qingzhouTabKey}`
    : null

  /** 仓库 ID 到仓库信息的映射。 */
  const repositoryMap = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories]
  )

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

  /** 修改普通绑定分支时的可选项，保留当前值以便分支已删除时仍可展示。 */
  const branchEditBranchOptions = branchEditBinding
    ? Array.from(
      new Set([
        ...(repoBranches[branchEditBinding.repositoryId] ?? []),
        ...(branchEditBinding.branchName ? [branchEditBinding.branchName] : [])
      ])
    ).map((branch) => ({ value: branch, label: branch }))
    : []
  const branchEditBranchLoading = branchEditBinding
    ? branchLoadingIds.has(branchEditBinding.repositoryId)
    : false

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

  useEffect(() => {
    const handleWindowFocus = (): void => {
      setBindingStatusVersion((value) => value + 1)
    }

    window.addEventListener('focus', handleWindowFocus)

    return () => window.removeEventListener('focus', handleWindowFocus)
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

  /** 选择新仓库时重置分支，并按需加载可选分支。 */
  const handleNewRepositoryChange = (repositoryId: string): void => {
    const repository = repositoryMap.get(repositoryId)

    setNewRepositoryId(repositoryId)
    setNewBranchName(null)

    if (!repository?.qingzhouEnabled) {
      loadBranches(repositoryId, true, true)
    }
  }

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
    setBranchEditBinding(null)
    setBranchEditName(null)

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
    if (!active) return

    if (bindings.length === 0) {
      setBindingStatuses({})
      return
    }

    let cancelled = false

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
      const bindingIds = new Set(bindings.map((binding) => binding.id))

      for (const result of results) {
        if (result) next[result[0]] = result[1]
      }

      setBindingStatuses((current) => {
        const merged: Record<string, RepositoryBindingStatus> = {}

        for (const [id, status] of Object.entries(current)) {
          if (bindingIds.has(id)) merged[id] = status
        }

        return { ...merged, ...next }
      })
    })

    return () => {
      cancelled = true
    }
  }, [active, bindingStatusVersion, bindings])

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
   * 打开修改普通绑定开发分支的弹窗。
   */
  const handleOpenEditBindingBranch = async (
    binding: RequirementRepoBinding
  ): Promise<void> => {
    if (binding.mode !== 'normal') return

    setBranchEditBinding(binding)
    setBranchEditName(binding.branchName)

    // 读取最新分支列表；没有缓存时会同时刷新远程引用。
    await loadBranches(binding.repositoryId, false, true)
  }

  /**
   * 保存普通绑定的开发分支。
   */
  const handleSaveBindingBranch = async (): Promise<void> => {
    if (!selectedRequirementId || !branchEditBinding || !branchEditName) return

    if (branchEditName === branchEditBinding.branchName) {
      setBranchEditBinding(null)
      setBranchEditName(null)
      return
    }

    setBranchEditSaving(true)

    try {
      const state = await window.electron.updateRequirementBindingBranch(
        selectedRequirementId,
        branchEditBinding.id,
        branchEditName
      )

      setBindings(state.bindings)
      setBindingStatusVersion((value) => value + 1)
      setBranchEditBinding(null)
      setBranchEditName(null)
      message.success('开发分支已更新')
    } catch (bindingError) {
      message.error(getErrorMessage(bindingError))
    } finally {
      setBranchEditSaving(false)
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

  /** 生成 IDE 预置会话内容；本地需求没有飞书链接，直接带入需求信息。 */
  const getIdeSessionPrompt = (): string | undefined => {
    if (!selectedRequirement) return undefined

    if (!selectedRequirementIsLocal) {
      return requirementUrl ? `${requirementUrl}\n帮我分析一下这个需求` : undefined
    }

    const description = selectedRequirement.description?.trim()
    const promptDescription =
      description && description.length > IDE_SESSION_DESCRIPTION_LIMIT
        ? `${description.slice(0, IDE_SESSION_DESCRIPTION_LIMIT)}…`
        : description

    return [
      '请结合当前仓库代码分析并处理下面这个本地临时需求。',
      '',
      `需求名称：${selectedRequirement.name}`,
      `所属版本：${selectedRequirement.iterationName ?? '未规划版本'}`,
      `状态：${selectedRequirement.status ?? '未知'}`,
      `优先级：${selectedRequirement.priority ?? '未设置'}`,
      `需求描述：${promptDescription || '暂无描述'}`
    ].join('\n')
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
      const chatPrompt = prefillSession ? getIdeSessionPrompt() : undefined
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
  const mergeRequestVersionRef = useRef(0)
  useEffect(() => {
    if (!mergeRequestBinding) mergeRequestVersionRef.current += 1
  }, [mergeRequestBinding])
  useEffect(() => () => { mergeRequestVersionRef.current += 1 }, [])
  const handleOpenCreateMergeRequest = async (
    binding: RequirementRepoBinding
  ): Promise<void> => {
    const requestVersion = ++mergeRequestVersionRef.current
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
      if (requestVersion !== mergeRequestVersionRef.current) return
      setMergeRequestBranches(result.branches)
      setMergeRequestWarning(result.fetchWarning)
    } catch (error) {
      if (requestVersion === mergeRequestVersionRef.current) setMergeRequestWarning(getErrorMessage(error))
    } finally {
      if (requestVersion === mergeRequestVersionRef.current) setMergeRequestBranchesLoading(false)
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

  /** 关闭合并请求弹窗并清空选择。 */
  const handleCloseMergeRequest = (): void => {
    setMergeRequestBinding(null)
    setMergeRequestSource(null)
    setMergeRequestTarget(null)
    setMergeRequestBranches([])
    setMergeRequestWarning(null)
  }

  /** 打开合并请求创建页。 */
  const handleSubmitMergeRequest = (): void => {
    if (!mergeRequestUrl || !mergeRequestSource || !mergeRequestTarget) return

    if (mergeRequestSource === mergeRequestTarget) {
      message.warning('来源分支和目标分支不能相同')
      return
    }

    const url = mergeRequestUrl
    handleCloseMergeRequest()
    window.electron.openEmbeddedBrowser(url)
  }

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
   * 切换需求时关闭分支选择弹窗。
   */
  useEffect(() => {
    setBranchChoiceOpen(false)
    setBranchChoiceBinding(null)
  }, [selectedRequirementId])

  return {
    repositories,
    repositoriesLoading,
    bindings,
    bindingsLoading,
    bindingsError,
    branchLoadingIds,
    addBindingOpen,
    setAddBindingOpen,
    newRepositoryId,
    newBranchName,
    setNewBranchName,
    bindingSaving,
    removingBindingId,
    syncingBindingId,
    branchEditBinding,
    branchEditName,
    branchEditSaving,
    createBranchOpen,
    createBranchBase,
    createBranchName,
    createBranchSaving,
    openingIdeBindingId,
    branchChoiceOpen,
    branchChoiceBinding,
    branchChoiceType,
    ideSessionPrompt,
    canPrefillSession,
    openIdeConfirmBinding,
    openIdeConfirmBranch,
    mergeRequestBinding,
    mergeRequestUrl,
    mergeRequestSource,
    mergeRequestTarget,
    mergeRequestBranchOptions,
    mergeRequestBranchesLoading,
    mergeRequestWarning,
    bindingStatuses,
    repositoryMap,
    qingzhouRequirementUrl,
    availableRepositories,
    newRepositoryIsQingzhou,
    newRepositoryBranchesLoading,
    newRepositoryBranchOptions,
    branchEditBranchOptions,
    branchEditBranchLoading,
    handleNewRepositoryChange,
    handleAddBinding,
    handleOpenEditBindingBranch,
    handleSaveBindingBranch,
    handleRemoveBinding,
    handleSyncQingzhouBinding,
    handleCopyBranchName,
    openCreateBranch,
    handleCreateBranch,
    handleOpenInIde,
    handleOpenCreateMergeRequest,
    handleCloseMergeRequest,
    handleSubmitMergeRequest,
    handleRequestOpenInIde,
    updateIdeSessionPrompt,
    handleConfirmBranchChoice,
    refreshBindings,
    setMergeRequestSource,
    setMergeRequestTarget,
    setBranchChoiceType,
    setBranchChoiceOpen,
    setBranchChoiceBinding,
    setOpenIdeConfirmBinding,
    setOpenIdeConfirmBranch,
    setCreateBranchOpen,
    setCreateBranchBase,
    setCreateBranchName,
    setBranchEditBinding,
    setBranchEditName
  }
}
