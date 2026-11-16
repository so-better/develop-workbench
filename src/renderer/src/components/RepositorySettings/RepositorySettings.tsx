import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip
} from 'antd'
import type { MenuProps, TableProps } from 'antd'
import {
  BranchesOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  MergeCellsOutlined,
  PullRequestOutlined,
  SearchOutlined,
  SwapOutlined
} from '@ant-design/icons'
import type { Repository, RepositoryState } from '../../../../types/repository'
import type { SettingsSection } from '../../../../types/settings'
import { getErrorMessage } from '../../../../utils'
import {
  getMergeRequestUrl,
  getRemoteBranchesUrl
} from '../../utils/git-remote'
import './RepositorySettings.css'

interface CloneFormValues {
  url: string
  directoryName?: string
}

interface RepositorySettingsProps {
  /** settings：只显示根目录配置；list：只显示仓库列表和克隆入口。 */
  mode?: 'settings' | 'list'

  /** 列表页没有配置根目录时，跳转到设置。 */
  onOpenSettings?: (section: SettingsSection) => void
}

/**
 * 代码仓库配置。
 * 数据存储在应用 userData 目录，本地代码目录不会被删除或移动。
 */
export default function RepositorySettings({
  mode = 'settings',
  onOpenSettings
}: RepositorySettingsProps): JSX.Element {
  const { message, modal, notification } = App.useApp()
  const [state, setState] = useState<RepositoryState | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectingRoot, setSelectingRoot] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openingIdeId, setOpeningIdeId] = useState<string | null>(null)
  const [openIdeConfirmRepository, setOpenIdeConfirmRepository] =
    useState<Repository | null>(null)
  const [openIdeConfirmBranch, setOpenIdeConfirmBranch] = useState<
    string | null
  >(null)
  const openingIdeRef = useRef<string | null>(null)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneLogs, setCloneLogs] = useState<string[]>([])
  const [cloneProgress, setCloneProgress] = useState<number | null>(null)
  const [cancelRequesting, setCancelRequesting] = useState(false)
  const [cloneForm] = Form.useForm<CloneFormValues>()
  const cloneLogRef = useRef<HTMLDivElement>(null)
  const cancelRequestedRef = useRef(false)
  const [branchLoadingId, setBranchLoadingId] = useState<string | null>(null)
  const [repoBranches, setRepoBranches] = useState<Record<string, string[]>>({})
  const [mergeRequestRepository, setMergeRequestRepository] =
    useState<Repository | null>(null)
  const [mergeRequestSource, setMergeRequestSource] = useState<string | null>(
    null
  )
  const [mergeRequestTarget, setMergeRequestTarget] = useState<string | null>(
    null
  )
  const [createBranchRepository, setCreateBranchRepository] =
    useState<Repository | null>(null)
  const [createBranchBase, setCreateBranchBase] = useState<string | null>(null)
  const [createBranchName, setCreateBranchName] = useState('')
  const [createBranchSaving, setCreateBranchSaving] = useState(false)
  const [mergeRepository, setMergeRepository] = useState<Repository | null>(
    null
  )
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [switchRepository, setSwitchRepository] = useState<Repository | null>(
    null
  )
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  /**
   * 读取仓库根目录和仓库列表。
   */
  const loadState = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true)

      try {
        setState(await window.electron.refreshRootRepositories())
      } catch {
        if (!silent) message.error('读取代码仓库配置失败')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [message]
  )

  /** 读取仓库分支并缓存，供新建/合并/切换/MR 弹窗使用。 */
  const loadBranches = useCallback(
    async (repositoryId: string, fetchRemote = true): Promise<string[]> => {
      setBranchLoadingId(repositoryId)

      try {
        const result = await window.electron.listRepositoryBranches(
          repositoryId,
          fetchRemote
        )

        if (result.fetchWarning) {
          message.warning({ content: result.fetchWarning, duration: 6 })
        }

        setRepoBranches((current) => ({
          ...current,
          [repositoryId]: result.branches
        }))

        return result.branches
      } catch (error) {
        message.error(getErrorMessage(error, '读取仓库分支失败'))
        return []
      } finally {
        setBranchLoadingId((current) =>
          current === repositoryId ? null : current
        )
      }
    },
    [message]
  )

  /** 刷新单个仓库的 Git 信息，更新当前分支等字段。 */
  const refreshRepositoryState = useCallback(
    async (repositoryId: string): Promise<void> => {
      setState(await window.electron.refreshRepository(repositoryId))
    },
    []
  )

  useEffect(() => {
    loadState()

    const handleWindowFocus = (): void => {
      loadState(true)
    }

    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [loadState])

  useEffect(() => {
    const unsubscribeProgress = window.electron.onRepositoryCloneProgress((progress) => {
      setCloneProgress(progress.percent)
      setCloneLogs((current) => [...current, progress.message].slice(-80))
    })
    const unsubscribeChanged = window.electron.onRepositoriesChanged((next) => {
      setState(next)
    })

    return () => {
      unsubscribeProgress()
      unsubscribeChanged()
    }
  }, [])

  useEffect(() => {
    if (!cloneLogRef.current) return

    cloneLogRef.current.scrollTop = cloneLogRef.current.scrollHeight
  }, [cloneLogs])

  const root = state?.root ?? null
  const filteredRepositories = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const repositories = state?.repositories ?? []

    if (!keyword) return repositories

    return repositories.filter(
      (repository) =>
        repository.name.toLowerCase().includes(keyword) ||
        repository.localPath.toLowerCase().includes(keyword) ||
        repository.remoteUrl?.toLowerCase().includes(keyword)
    )
  }, [query, state])

  /**
   * 设置代码根目录。
   */
  const handleSelectRoot = async (): Promise<void> => {
    setSelectingRoot(true)

    try {
      const selectedPath = await window.electron.selectDirectory('选择代码根目录', root ?? undefined)

      if (!selectedPath) return

      setState(await window.electron.setRepositoryRoot(selectedPath))
      message.success('代码根目录已保存并完成扫描')
    } catch {
      message.error('保存代码根目录失败')
    } finally {
      setSelectingRoot(false)
    }
  }

  /**
   * 清除代码根目录，不删除仓库和本地文件。
   */
  const handleClearRoot = async (): Promise<void> => {
    try {
      setState(await window.electron.clearRepositoryRoot())
      message.success('代码根目录已清除')
    } catch {
      message.error('清除代码根目录失败')
    }
  }

  /**
   * 打开 Git 克隆弹窗。
   */
  const openClone = (): void => {
    if (!root) {
      message.warning('请先选择代码根目录')
      return
    }

    cloneForm.setFieldsValue({
      url: '',
      directoryName: ''
    })
    setCloneLogs([])
    setCloneProgress(null)
    setCancelRequesting(false)
    cancelRequestedRef.current = false
    setCloneOpen(true)
  }

  /**
   * 将 Git 仓库克隆到配置的根目录。
   */
  const handleClone = async (): Promise<void> => {
    let values: CloneFormValues

    try {
      values = await cloneForm.validateFields()
    } catch {
      return
    }

    setCloning(true)
    setCloneLogs([])
    setCloneProgress(0)
    setCancelRequesting(false)
    cancelRequestedRef.current = false

    try {
      setState(await window.electron.cloneRepository(values))
      setCloneOpen(false)
      cloneForm.resetFields()
      message.success('仓库已克隆')
    } catch {
      if (cancelRequestedRef.current) {
        message.info('已取消克隆')
      } else {
        message.error('克隆仓库失败，请检查 Git 地址、权限和目录')
      }
    } finally {
      setCloning(false)
      setCancelRequesting(false)
    }
  }

  /**
   * 请求主进程终止当前 Git 克隆进程。
   */
  const handleCancelClone = async (): Promise<void> => {
    cancelRequestedRef.current = true
    setCancelRequesting(true)

    try {
      await window.electron.cancelRepositoryClone()
    } catch {
      cancelRequestedRef.current = false
      setCancelRequesting(false)
      message.error('取消克隆失败')
    }
  }

  /**
   * 切换仓库是否接入轻舟。
   */
  const handleQingzhouChange = async (repository: Repository, checked: boolean): Promise<void> => {
    setUpdatingId(repository.id)

    try {
      setState(
        await window.electron.updateRepository(repository.id, {
          qingzhouEnabled: checked
        })
      )
      message.success(checked ? '已标记为接入轻舟' : '已取消轻舟接入')
    } catch {
      message.error('更新仓库配置失败')
    } finally {
      setUpdatingId(null)
    }
  }

  /**
   * 移除仓库元数据，不删除本地代码。
   */
  const handleRemove = async (repositoryId: string): Promise<void> => {
    setDeletingId(repositoryId)

    try {
      setState(await window.electron.removeRepository(repositoryId))
      message.success('仓库已移除，本地文件未删除')
    } catch {
      message.error('移除仓库失败')
    } finally {
      setDeletingId(null)
    }
  }

  /**
   * 复制分支名称到系统剪贴板。
   */
  const handleCopyBranch = async (branch: string): Promise<void> => {
    try {
      await window.electron.copyText(branch)
      message.success('分支名已复制')
    } catch {
      message.error('复制失败')
    }
  }

  /** 在仓库目录打开终端。 */
  const handleOpenTerminal = (repository: Repository): void => {
    window.dispatchEvent(
      new CustomEvent('workbench:open-terminal', {
        detail: { cwd: repository.localPath }
      })
    )
  }

  /** 在内置浏览器打开远程仓库分支页面。 */
  const handleOpenRemoteRepository = (repository: Repository): void => {
    const url = getRemoteBranchesUrl(repository.remoteUrl)

    if (!url) {
      message.warning('仓库没有可用的远程地址')
      return
    }

    window.electron.openEmbeddedBrowser(url)
  }

  /** 打开创建 MR 弹窗。 */
  const openMergeRequest = async (repository: Repository): Promise<void> => {
    setMergeRequestRepository(repository)
    setMergeRequestSource(repository.currentBranch ?? repository.defaultBranch)
    setMergeRequestTarget(
      repository.defaultBranch &&
        repository.currentBranch !== repository.defaultBranch
        ? repository.defaultBranch
        : null
    )
    await loadBranches(repository.id, true)
  }

  const mergeRequestUrl =
    mergeRequestRepository && mergeRequestSource && mergeRequestTarget
      ? getMergeRequestUrl(
        mergeRequestRepository.remoteUrl,
        mergeRequestSource,
        mergeRequestTarget
      )
      : null

  const handleOpenMergeRequest = (): void => {
    const repository = mergeRequestRepository

    if (!repository || !mergeRequestUrl) return

    if (mergeRequestSource === mergeRequestTarget) {
      message.warning('来源分支和目标分支不能相同')
      return
    }

    setMergeRequestRepository(null)
    window.electron.openEmbeddedBrowser(mergeRequestUrl)
  }

  /** 打开新建分支弹窗。 */
  const openCreateBranch = async (repository: Repository): Promise<void> => {
    setCreateBranchRepository(repository)
    setCreateBranchName('')
    setCreateBranchBase(repository.defaultBranch ?? null)

    const branches = await loadBranches(repository.id, true)
    const preferred =
      repository.defaultBranch && branches.includes(repository.defaultBranch)
        ? repository.defaultBranch
        : branches[0] ?? null

    setCreateBranchBase(preferred)
  }

  const handleCreateBranch = async (): Promise<void> => {
    const repository = createBranchRepository

    if (!repository || !createBranchBase || !createBranchName.trim()) {
      message.warning('请选择基线分支并填写新分支名')
      return
    }

    setCreateBranchSaving(true)

    try {
      await window.electron.createRepositoryBranch(
        repository.id,
        createBranchName.trim(),
        createBranchBase
      )
      message.success('分支已创建并推送')
      setCreateBranchRepository(null)
      await loadBranches(repository.id, true)
      await refreshRepositoryState(repository.id).catch(() =>
        message.warning('分支已创建，但刷新仓库信息失败')
      )
    } catch (error) {
      message.error(getErrorMessage(error, '创建分支失败'))
    } finally {
      setCreateBranchSaving(false)
    }
  }

  /** 打开从分支合并弹窗。 */
  const openMerge = async (repository: Repository): Promise<void> => {
    setMergeRepository(repository)
    setMergeSource(null)
    await loadBranches(repository.id, true)
  }

  const handleMerge = async (): Promise<void> => {
    const repository = mergeRepository

    if (!repository || !mergeSource) {
      message.warning('请选择要合并的分支')
      return
    }

    if (mergeSource === repository.currentBranch) {
      message.info('当前分支就是要合并的分支')
      return
    }

    setMerging(true)

    try {
      const result = await window.electron.mergeRepositoryBranch(
        repository.id,
        mergeSource
      )

      if (result.conflicted) {
        setMergeRepository(null)
        await loadBranches(repository.id, true)
        await refreshRepositoryState(repository.id).catch(() => undefined)

        modal.confirm({
          title: '合并存在冲突',
          content: (
            <div className="repository-merge-conflict">
              <p>已保留冲突状态，请在 IDE 中解决冲突并提交。</p>
              {result.conflicts.length > 0 ? (
                <p>
                  冲突文件：
                  {result.conflicts.slice(0, 6).join('、')}
                  {result.conflicts.length > 6
                    ? ` 等 ${result.conflicts.length} 个`
                    : ''}
                </p>
              ) : null}
            </div>
          ),
          okText: '打开 IDE',
          cancelText: '稍后处理',
          onOk: async () => {
            if (!(await ensureIdeAvailable())) return

            try {
              await window.electron.launchRepositoryInIde(repository.id)
            } catch (error) {
              message.error(getErrorMessage(error, '打开 IDE 失败'))
            }
          }
        })

        return
      }

      const mergeTarget = repository.currentBranch ?? '当前分支'

      if (result.pushError) {
        message.warning({
          content: `已将 ${mergeSource} 合并到 ${mergeTarget}，但推送远程失败：${result.pushError}`,
          duration: 6
        })
      } else if (result.pushSkipped) {
        message.success(
          `已将 ${mergeSource} 合并到 ${mergeTarget}（本地仓库，未推送）`
        )
      } else if (result.pushed) {
        message.success(
          `已将 ${mergeSource} 合并到 ${mergeTarget}，并推送到远程`
        )
      } else {
        message.success(
          `已将 ${mergeSource} 合并到 ${mergeTarget}（未推送）`
        )
      }

      setMergeRepository(null)
      await loadBranches(repository.id, true)
      await refreshRepositoryState(repository.id).catch(() =>
        message.warning('合并已完成，但刷新仓库信息失败')
      )
    } catch (error) {
      message.error(getErrorMessage(error, '合并失败'))
    } finally {
      setMerging(false)
    }
  }

  /** 打开切换分支弹窗。 */
  const openSwitch = async (repository: Repository): Promise<void> => {
    setSwitchRepository(repository)
    setSwitchTarget(null)
    await loadBranches(repository.id, true)
  }

  const handleSwitch = async (): Promise<void> => {
    const repository = switchRepository

    if (!repository || !switchTarget) {
      message.warning('请选择目标分支')
      return
    }

    if (switchTarget === repository.currentBranch) {
      message.info('当前已经在该分支')
      setSwitchRepository(null)
      return
    }

    setSwitching(true)

    try {
      const result = await window.electron.switchRepositoryBranch(
        repository.id,
        switchTarget
      )

      message.success(
        result.pulled
          ? `已切换到 ${result.branchName} 并拉取最新代码`
          : `已切换到 ${result.branchName}`
      )
      setSwitchRepository(null)
      await loadBranches(repository.id, true)
      await refreshRepositoryState(repository.id).catch(() =>
        message.warning('切换已完成，但刷新仓库信息失败')
      )
    } catch (error) {
      message.error(getErrorMessage(error, '切换分支失败'))
    } finally {
      setSwitching(false)
    }
  }

  /** 检查 IDE 是否可用，不可用时提供设置入口。 */
  const ensureIdeAvailable = async (): Promise<boolean> => {
    const ideState = await window.electron.getIdeConfig()

    if (ideState.config && ideState.available) return true

    notification.warning({
      key: 'repository-ide-settings-required',
      message: ideState.config ? 'IDE 当前不可用' : '还没有配置 IDE',
      description: '请先在设置中选择 IDE，并确认可执行文件可用。',
      duration: 6,
      btn: (
        <Button
          type="primary"
          size="small"
          onClick={() => {
            notification.destroy('repository-ide-settings-required')
            onOpenSettings?.('ide')
          }}
        >
          去设置
        </Button>
      )
    })

    return false
  }

  /** 与需求详情页一致：先确认仓库和分支，再执行分支检查和打开 IDE。 */
  const handleRequestOpenInIde = (repository: Repository): void => {
    if (!repository.available) {
      message.warning('仓库路径不存在')
      return
    }

    if (!repository.currentBranch) {
      message.warning('当前仓库没有检出的分支')
      return
    }

    setOpenIdeConfirmRepository(repository)
    setOpenIdeConfirmBranch(repository.currentBranch)
  }

  const handleOpenInIde = async (
    repository: Repository,
    branch: string
  ): Promise<void> => {
    if (openingIdeRef.current !== null) return

    openingIdeRef.current = repository.id
    setOpeningIdeId(repository.id)

    try {
      if (!(await ensureIdeAvailable())) return

      const result = await window.electron.prepareRepositoryInIde(
        repository.id,
        branch
      )

      if (result.conflicted) {
        message.success('检测到未解决的冲突，即将打开 IDE')
      } else if (result.switched) {
        message.success(
          result.pulled
            ? `已切换到 ${branch} 并拉取最新代码，即将打开 IDE`
            : `已切换到 ${branch}，该分支没有远程上游，即将打开 IDE`
        )
      } else if (result.pulled) {
        message.success(`已在 ${branch}，已拉取最新代码，即将打开 IDE`)
      } else {
        message.success('分支检查通过，即将打开 IDE')
      }

      // 留出时间让用户看到分支检查和拉取结果。
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await window.electron.launchRepositoryInIde(repository.id)
    } catch (error) {
      message.error(getErrorMessage(error, '打开 IDE 失败'))
    } finally {
      openingIdeRef.current = null
      setOpeningIdeId(null)
    }
  }

  /** 处理「更多」菜单里的低频操作。 */
  const handleRepositoryAction = (
    repository: Repository,
    key: string
  ): void => {
    switch (key) {
      case 'open-ide':
        handleRequestOpenInIde(repository)
        break
      case 'merge-request':
        openMergeRequest(repository)
        break
      case 'create-branch':
        openCreateBranch(repository)
        break
      case 'merge':
        openMerge(repository)
        break
      case 'remove':
        modal.confirm({
          title: '移除这个仓库？',
          content: '只移除配置，不会删除本地代码。',
          okText: '移除',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => handleRemove(repository.id)
        })
        break
    }
  }

  /** 「更多」菜单项，保留图标和名称。 */
  const getRepositoryMenuItems = (
    repository: Repository
  ): MenuProps['items'] => [
      {
        key: 'open-ide',
        icon: <DesktopOutlined />,
        label:
          openingIdeId === repository.id ? '正在打开 IDE…' : '打开 IDE',
        disabled: !repository.available || openingIdeId !== null
      },
      {
        key: 'merge-request',
        icon: <PullRequestOutlined />,
        label: '创建 MR',
        disabled: !repository.available || !repository.remoteUrl
      },
      {
        key: 'create-branch',
        icon: <BranchesOutlined />,
        label: '新建分支',
        disabled: !repository.available
      },
      {
        key: 'merge',
        icon: <MergeCellsOutlined />,
        label: '合并代码',
        disabled: !repository.available || !repository.currentBranch
      },
      { type: 'divider' },
      {
        key: 'remove',
        icon: <DeleteOutlined />,
        label: '移除仓库',
        danger: true,
        disabled: deletingId === repository.id
      }
    ]

  /**
   * 渲染可省略、可悬浮查看、可复制的分支单元格。
   */
  const renderBranch = (
    branch: string | null,
    tone: 'default' | 'current' = 'default'
  ): JSX.Element | string => {
    if (!branch) return '-'

    return (
      <div className="repository-branch-cell">
        <Tag
          bordered={false}
          color={tone === 'current' ? 'processing' : 'default'}
          className={`repository-branch-tag${
            tone === 'current' ? ' is-current' : ''
          }`}
        >
          <Tooltip title={branch}>
            <span className="repository-branch-text">{branch}</span>
          </Tooltip>
        </Tag>
        <Tooltip title="复制分支名">
          <Button
            type="text"
            size="small"
            className="repository-copy-button"
            icon={<CopyOutlined />}
            aria-label={`复制分支 ${branch}`}
            onClick={() => handleCopyBranch(branch)}
          />
        </Tooltip>
      </div>
    )
  }

  const columns: TableProps<Repository>['columns'] = [
    {
      title: '仓库',
      dataIndex: 'name',
      key: 'name',
      minWidth: 300,
      fixed: 'left',
      render: (_, repository) => (
        <div className="repository-name-cell">
          <strong>{repository.name}</strong>
          <div className="repository-path-line">
            <span className="repository-path-text" title={repository.localPath}>
              {repository.localPath}
            </span>
            {!repository.available ? (
              <Tag color="red" bordered={false}>
                路径不存在
              </Tag>
            ) : null}
          </div>
        </div>
      )
    },
    {
      title: '主分支',
      dataIndex: 'defaultBranch',
      key: 'defaultBranch',
      minWidth: 120,
      render: (branch: string | null) => renderBranch(branch)
    },
    {
      title: '当前分支',
      dataIndex: 'currentBranch',
      key: 'currentBranch',
      minWidth: 200,
      render: (branch: string | null) => renderBranch(branch, 'current')
    },
    {
      title: '是否接入轻舟',
      dataIndex: 'qingzhouEnabled',
      key: 'qingzhouEnabled',
      width: 100,
      render: (_, repository) => (
        <Switch
          size="small"
          checked={repository.qingzhouEnabled}
          loading={updatingId === repository.id}
          onChange={(checked) => handleQingzhouChange(repository, checked)}
        />
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 360,
      fixed: 'right',
      render: (_, repository) => (
        <div className="repository-actions">
          <Button
            type="text"
            size="small"
            className="repository-action-button"
            icon={<CodeOutlined />}
            disabled={!repository.available}
            aria-label={`在 ${repository.name} 打开终端`}
            onClick={() => handleOpenTerminal(repository)}
          >
            在终端打开
          </Button>
          <Button
            type="text"
            size="small"
            className="repository-action-button"
            icon={<LinkOutlined />}
            disabled={!repository.available || !repository.remoteUrl}
            aria-label={`打开 ${repository.name} 的远程仓库`}
            onClick={() => handleOpenRemoteRepository(repository)}
          >
            远程仓库
          </Button>
          <span className="repository-action-divider" aria-hidden="true" />
          <Button
            type="text"
            size="small"
            className="repository-action-button"
            icon={<SwapOutlined />}
            disabled={!repository.available || !repository.currentBranch}
            aria-label={`切换 ${repository.name} 的分支`}
            onClick={() => openSwitch(repository)}
          >
            切换分支
          </Button>
          <span className="repository-action-divider" aria-hidden="true" />
          <Dropdown
            trigger={['hover']}
            mouseEnterDelay={0.1}
            menu={{
              items: getRepositoryMenuItems(repository),
              onClick: ({ key }) => handleRepositoryAction(repository, key)
            }}
          >
            <Button
              type="text"
              size="small"
              className="repository-action-button"
              icon={<EllipsisOutlined />}
              aria-label={`更多操作 ${repository.name}`}
            >
              更多
            </Button>
          </Dropdown>
        </div>
      )
    }
  ]

  const toBranchOptions = (branches: string[], selected?: string | null) =>
    Array.from(new Set([...branches, ...(selected ? [selected] : [])])).map(
      (branch) => ({ value: branch, label: branch })
    )

  const mergeRequestBranches = mergeRequestRepository
    ? repoBranches[mergeRequestRepository.id] ?? []
    : []
  const mergeRequestBranchOptions = toBranchOptions(
    mergeRequestBranches,
    mergeRequestSource
  ).concat(
    mergeRequestTarget &&
      !mergeRequestBranches.includes(mergeRequestTarget) &&
      mergeRequestTarget !== mergeRequestSource
      ? [{ value: mergeRequestTarget, label: mergeRequestTarget }]
      : []
  )

  const createBranchBranches = createBranchRepository
    ? repoBranches[createBranchRepository.id] ?? []
    : []
  const createBranchOptions = toBranchOptions(
    createBranchBranches,
    createBranchBase
  )

  const mergeBranches = mergeRepository
    ? repoBranches[mergeRepository.id] ?? []
    : []
  const mergeSourceOptions = toBranchOptions(mergeBranches, mergeSource)

  const switchBranches = switchRepository
    ? repoBranches[switchRepository.id] ?? []
    : []
  const switchTargetOptions = toBranchOptions(switchBranches, switchTarget)

  if (loading) {
    return (
      <div className="settings-loading">
        <Spin />
      </div>
    )
  }

  return (
    <>
      {mode === 'settings' ? (
        <>
          <div className="settings-panel-header">
            <h3>代码目录</h3>
            <p>配置代码根目录；仓库列表在左侧「代码」页查看。</p>
          </div>

          <div className="repository-section">
            <label className="repository-field-label" htmlFor="repository-root">
              代码根目录
            </label>
            <div className="repository-path-row">
              <Input
                id="repository-root"
                value={root ?? ''}
                readOnly
                placeholder="请选择代码根目录"
              />
              {root ? (
                <Popconfirm
                  title="更换代码根目录？"
                  description="更换后会清空当前所有仓库配置，但不会删除本地代码。"
                  okText="继续"
                  cancelText="取消"
                  onConfirm={() => handleSelectRoot()}
                >
                  <Button variant="filled" icon={<FolderOpenOutlined />} loading={selectingRoot}>
                    选择目录
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  type="primary"
                  icon={<FolderOpenOutlined />}
                  loading={selectingRoot}
                  onClick={() => handleSelectRoot()}
                >
                  选择目录
                </Button>
              )}
              {root ? (
                <Popconfirm
                  title="清除代码根目录？"
                  description="会同时清除所有仓库配置，但不会删除本地代码。"
                  okText="清除"
                  cancelText="取消"
                  onConfirm={() => handleClearRoot()}
                >
                  <Button danger>清除</Button>
                </Popconfirm>
              ) : null}
            </div>
            <p className="settings-help">扫描和克隆都会使用这个目录。</p>
          </div>
        </>
      ) : null}

      {mode === 'list' ? (
        <>
          <div className="repository-toolbar">
            <Input
              className="repository-search"
              prefix={<SearchOutlined />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索仓库名称或路径"
              allowClear
            />
            <div className="repository-toolbar-actions">
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                disabled={!root}
                onClick={openClone}
              >
                从 Git 克隆
              </Button>
            </div>
          </div>

          <Table
            bordered
            className="repository-table"
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={filteredRepositories}
            pagination={false}
            scroll={{ x: 'max-content' }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    root ? '根目录下还没有扫描到仓库' : '还没有配置代码根目录'
                  }
                >
                  {!root && onOpenSettings ? (
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => onOpenSettings('repositories')}
                    >
                      去设置
                    </Button>
                  ) : null}
                </Empty>
              )
            }}
          />

          <Modal
            title="从 Git 克隆"
            open={cloneOpen}
            okText="克隆"
            cancelText="取消"
            confirmLoading={cloning}
            cancelButtonProps={{ disabled: cloning }}
            closable={!cloning}
            keyboard={!cloning}
            maskClosable={!cloning}
            onCancel={() => {
              if (!cloning) {
                setCloneOpen(false)
                cloneForm.resetFields()
              }
            }}
            onOk={() => handleClone()}
          >
            <p className="settings-help repository-clone-target">
              克隆到：{root ?? '-'}
            </p>
            <Form form={cloneForm} layout="vertical" requiredMark={false} disabled={cloning}>
              <Form.Item
                label="Git 仓库地址"
                name="url"
                rules={[{ required: true, message: '请输入 Git 仓库地址' }]}
              >
                <Input placeholder="git@host:group/repository.git" spellCheck={false} />
              </Form.Item>
              <Form.Item label="目录名" name="directoryName">
                <Input placeholder="留空则根据仓库地址生成" spellCheck={false} />
              </Form.Item>
            </Form>

            {cloning ? (
              <div className="repository-clone-progress">
                <div className="repository-clone-progress-head">
                  <span>正在克隆仓库</span>
                  <div className="repository-clone-progress-actions">
                    <span>{cloneProgress !== null ? `${cloneProgress}%` : ''}</span>
                    <Button
                      type="text"
                      danger
                      size="small"
                      className="repository-clone-cancel"
                      loading={cancelRequesting}
                      onClick={() => handleCancelClone()}
                    >
                      取消克隆
                    </Button>
                  </div>
                </div>
                <Progress
                  percent={cloneProgress ?? 0}
                  size="small"
                  status="active"
                  showInfo={false}
                />
              </div>
            ) : null}

            {cloneLogs.length > 0 ? (
              <div className="repository-clone-log" ref={cloneLogRef}>
                {cloneLogs.map((line, index) => (
                  <div key={`${index}-${line}`}>{line}</div>
                ))}
              </div>
            ) : null}
          </Modal>

          <Modal
            title="打开 IDE"
            open={Boolean(openIdeConfirmRepository)}
            okText="打开 IDE"
            cancelText="取消"
            destroyOnHidden
            onOk={() => {
              const repository = openIdeConfirmRepository
              const branch = openIdeConfirmBranch

              setOpenIdeConfirmRepository(null)
              setOpenIdeConfirmBranch(null)

              if (repository && branch) {
                handleOpenInIde(repository, branch)
              }
            }}
            onCancel={() => {
              setOpenIdeConfirmRepository(null)
              setOpenIdeConfirmBranch(null)
            }}
          >
            <div className="requirement-ide-open-confirm">
              <p>
                即将在 IDE 中打开仓库
                {openIdeConfirmRepository
                  ? `「${openIdeConfirmRepository.name}」`
                  : ''}
                。
              </p>
              {openIdeConfirmBranch ? (
                <p className="requirement-ide-open-branch">
                  分支：{openIdeConfirmBranch}
                </p>
              ) : null}
            </div>
          </Modal>

          <Modal
            title="创建合并请求"
            open={Boolean(mergeRequestRepository)}
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
            onOk={handleOpenMergeRequest}
            onCancel={() => {
              setMergeRequestRepository(null)
              setMergeRequestSource(null)
              setMergeRequestTarget(null)
            }}
          >
            <div className="requirement-mr-form">
              <p>
                选择合并请求的来源和目标分支，将在应用内浏览器打开 Codeup 创建页面。
                冲突由 Codeup 显示和处理。
              </p>
              <label>来源分支</label>
              <Select
                showSearch
                className="requirement-mr-branch"
                value={mergeRequestSource ?? undefined}
                options={mergeRequestBranchOptions}
                loading={branchLoadingId === mergeRequestRepository?.id}
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
                loading={branchLoadingId === mergeRequestRepository?.id}
                placeholder="选择目标分支"
                optionFilterProp="label"
                onChange={(value: string) => setMergeRequestTarget(value)}
              />
              {mergeRequestSource === mergeRequestTarget && mergeRequestSource ? (
                <Alert
                  type="warning"
                  showIcon
                  message="来源分支和目标分支不能相同"
                />
              ) : null}
              {!mergeRequestUrl && mergeRequestSource && mergeRequestTarget ? (
                <Alert
                  type="warning"
                  showIcon
                  message="无法生成合并请求地址，请检查远程仓库地址"
                />
              ) : null}
            </div>
          </Modal>

          <Modal
            title="新建分支"
            open={Boolean(createBranchRepository)}
            okText="创建"
            cancelText="取消"
            confirmLoading={createBranchSaving}
            destroyOnHidden
            okButtonProps={{
              disabled: !createBranchBase || !createBranchName.trim()
            }}
            onOk={() => handleCreateBranch()}
            onCancel={() => setCreateBranchRepository(null)}
          >
            <div className="requirement-branch-create-form">
              <label>仓库</label>
              <div className="requirement-branch-create-repo">
                {createBranchRepository?.name ?? ''}
              </div>
              <label>基线分支</label>
              <Select
                showSearch
                value={createBranchBase ?? undefined}
                options={createBranchOptions}
                loading={branchLoadingId === createBranchRepository?.id}
                placeholder="选择基线分支"
                optionFilterProp="label"
                onChange={(value: string) => setCreateBranchBase(value)}
              />
              <label>新分支名</label>
              <Input
                value={createBranchName}
                placeholder="输入新分支名"
                spellCheck={false}
                onChange={(event) => setCreateBranchName(event.target.value)}
              />
              <p>会基于最新远程基线分支创建本地分支；仓库有远程时会自动推送。</p>
            </div>
          </Modal>

          <Modal
            title="从分支合并"
            open={Boolean(mergeRepository)}
            okText="合并代码"
            cancelText="取消"
            confirmLoading={merging}
            destroyOnHidden
            okButtonProps={{ disabled: !mergeSource }}
            onOk={() => handleMerge()}
            onCancel={() => setMergeRepository(null)}
          >
            <div className="requirement-branch-create-form">
              <p>
                会把所选分支合并到当前分支：
                <strong>{mergeRepository?.currentBranch ?? '未知'}</strong>。
              </p>
              <label>要合并的分支</label>
              <Select
                showSearch
                value={mergeSource ?? undefined}
                options={mergeSourceOptions}
                loading={branchLoadingId === mergeRepository?.id}
                placeholder="选择要合并的分支"
                optionFilterProp="label"
                onChange={(value: string) => setMergeSource(value)}
              />
              <p>
                合并前会拉取最新远程引用，优先使用最新远程分支，并检查未提交改动；合并成功后自动推送到远程，发生冲突时会保留冲突状态，可打开 IDE 解决。
              </p>
            </div>
          </Modal>

          <Modal
            title="切换分支"
            open={Boolean(switchRepository)}
            okText="切换"
            cancelText="取消"
            confirmLoading={switching}
            destroyOnHidden
            okButtonProps={{ disabled: !switchTarget }}
            onOk={() => handleSwitch()}
            onCancel={() => setSwitchRepository(null)}
          >
            <div className="requirement-branch-create-form">
              <p>
                当前分支：
                <strong>{switchRepository?.currentBranch ?? '未知'}</strong>
              </p>
              <label>目标分支</label>
              <Select
                showSearch
                value={switchTarget ?? undefined}
                options={switchTargetOptions}
                loading={branchLoadingId === switchRepository?.id}
                placeholder="选择目标分支"
                optionFilterProp="label"
                onChange={(value: string) => setSwitchTarget(value)}
              />
              <p>切换前会检查未提交和未推送的提交；切换成功后会自动 pull。</p>
            </div>
          </Modal>
        </>
      ) : null}
    </>
  )
}
