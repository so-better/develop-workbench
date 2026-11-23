import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Empty,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  BranchesOutlined,
  CheckOutlined,
  CopyOutlined,
  DeploymentUnitOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  PullRequestOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type {
  RequirementBindingsMap,
  RequirementRepoBinding
} from '../../../../types/bindings'
import type { Repository } from '../../../../types/repository'
import { getErrorMessage } from '../../../../utils'
import {
  getMergeRequestUrl,
  getRemoteBranchesUrl
} from '../../utils/git-remote'
import {
  buildVersionRepositorySummary,
  getVersionSummaryProductLines,
  groupVersionSummaryRequirements,
  type RepositoryBranchKind,
  type RepositoryBranchSummary,
  type VersionRepositorySummary as VersionRepositorySummaryData,
  type VersionSummaryGroup
} from '../../utils/version-repositories'
import './version-repository-summary.css'

const BRANCH_KIND_LABELS: Record<RepositoryBranchKind, string> = {
  development: '开发分支',
  requirement: '需求分支',
  iteration: '迭代分支'
}

const BRANCH_KIND_COLORS: Record<RepositoryBranchKind, string | undefined> = {
  development: undefined,
  requirement: 'blue',
  iteration: 'purple'
}

/** 轻舟工作任务页地址。 */
const getQingzhouTasksUrl = (binding: RequirementRepoBinding): string | null => {
  if (!binding.qingzhouWorkItemId) return null

  const query = new URLSearchParams({
    workItemId: binding.qingzhouWorkItemId,
    archiveStatus: 'all'
  })

  if (binding.qingzhouCodeRepositoryId) {
    query.set('codeRepositoryId', binding.qingzhouCodeRepositoryId)
  }

  return `https://z.xlbsoft.com/workList/tasks?${query.toString()}`
}

/** 轻舟迭代分支构建页地址。 */
const getQingzhouBuildUrl = (binding: RequirementRepoBinding): string | null =>
  binding.qingzhouIterationBranchId
    ? `https://z.xlbsoft.com/workList/branch/${encodeURIComponent(
        binding.qingzhouIterationBranchId
      )}`
    : null

interface CopyButtonProps {
  /** 要复制的文本。 */
  value: string

  /** 复制对象名称，用于提示。 */
  label: string
}

/** 带成功反馈的复制按钮。 */
function CopyButton({ value, label }: CopyButtonProps): JSX.Element {
  const { message } = App.useApp()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  const handleCopy = async (): Promise<void> => {
    try {
      await window.electron.copyText(value)
      setCopied(true)
      message.success({ content: `已复制${label}`, duration: 1.2 })

      if (timerRef.current !== null) window.clearTimeout(timerRef.current)

      timerRef.current = window.setTimeout(() => {
        setCopied(false)
        timerRef.current = null
      }, 1500)
    } catch {
      message.error(`复制${label}失败`)
    }
  }

  return (
    <Tooltip title={copied ? '已复制' : `复制${label}`}>
      <Button
        type="text"
        size="small"
        className={`version-summary-copy${copied ? ' is-copied' : ''}`}
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        aria-label={`复制${label}`}
        onClick={() => handleCopy()}
      />
    </Tooltip>
  )
}

interface VersionRepositorySummaryProps {
  /** 是否打开汇总弹窗。 */
  open: boolean

  /** 优先选中的版本分组 key。 */
  preferredVersionKey?: string | null

  /** 关闭弹窗。 */
  onClose: () => void
}

/**
 * 版本仓库汇总弹窗。
 * 打开时读取当前空间所有需求（含已结束）和本地绑定，再按所选版本聚合。
 */
export default function VersionRepositorySummary({
  open,
  preferredVersionKey,
  onClose
}: VersionRepositorySummaryProps): JSX.Element {
  const [groups, setGroups] = useState<VersionSummaryGroup[] | null>(null)
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [productLineFilters, setProductLineFilters] = useState<string[]>([])
  const [bindings, setBindings] = useState<RequirementBindingsMap>({})
  const [bindingsKey, setBindingsKey] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [loadingBindings, setLoadingBindings] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)
  const [bindingsError, setBindingsError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const selectedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    selectedKeyRef.current = selectedKey
  }, [selectedKey])

  useEffect(() => {
    if (open) return

    selectedKeyRef.current = null
    setGroups(null)
    setRepositories([])
    setSelectedKey(null)
    setProductLineFilters([])
    setBindings({})
    setBindingsKey(null)
    setDataError(null)
    setBindingsError(null)
    setLoadingData(false)
    setLoadingBindings(false)
  }, [open])

  useEffect(() => {
    if (!open) return

    const previousKey = selectedKeyRef.current
    let cancelled = false

    setLoadingData(true)
    setDataError(null)
    setBindingsError(null)
    setGroups(null)
    setRepositories([])
    setSelectedKey(null)
    setBindings({})
    setBindingsKey(null)

    Promise.all([
      window.electron.getVersionSummaryRequirements(),
      window.electron.getRepositoryState()
    ])
      .then(([requirements, repositoryState]) => {
        if (cancelled) return

        const nextGroups = groupVersionSummaryRequirements(requirements)
        const preferredKey =
          previousKey && nextGroups.some((group) => group.key === previousKey)
            ? previousKey
            : preferredVersionKey &&
                nextGroups.some((group) => group.key === preferredVersionKey)
              ? preferredVersionKey
              : nextGroups[0]?.key ?? null

        setGroups(nextGroups)
        setRepositories(repositoryState.repositories)
        setSelectedKey(preferredKey)
      })
      .catch((error) => {
        if (!cancelled) {
          setDataError(getErrorMessage(error, '读取版本汇总数据失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, preferredVersionKey, reloadToken])

  const selectedGroup = useMemo(
    () => groups?.find((group) => group.key === selectedKey) ?? null,
    [groups, selectedKey]
  )

  useEffect(() => {
    setProductLineFilters([])
  }, [selectedKey])

  const productLineOptions = useMemo(() => {
    const counts = new Map<string, number>()

    for (const requirement of selectedGroup?.requirements ?? []) {
      for (const productLine of getVersionSummaryProductLines(requirement)) {
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
  }, [selectedGroup])

  useEffect(() => {
    const available = new Set(productLineOptions.map((option) => option.value))

    setProductLineFilters((current) =>
      current.every((value) => available.has(value))
        ? current
        : current.filter((value) => available.has(value))
    )
  }, [productLineOptions])

  const selectedRequirements = useMemo(() => {
    const requirements = selectedGroup?.requirements ?? []
    const selectedLines = new Set(productLineFilters)

    return selectedLines.size > 0
      ? requirements.filter((requirement) =>
          getVersionSummaryProductLines(requirement).some((line) =>
            selectedLines.has(line)
          )
        )
      : requirements
  }, [productLineFilters, selectedGroup])

  useEffect(() => {
    if (!open || !selectedGroup) {
      setBindings({})
      setBindingsKey(null)
      setBindingsError(null)
      setLoadingBindings(false)
      return
    }

    let cancelled = false

    setLoadingBindings(true)
    setBindingsError(null)
    setBindings({})
    setBindingsKey(null)

    window.electron
      .getRequirementBindingsBatch(
        selectedGroup.requirements.map((requirement) => requirement.id)
      )
      .then((next) => {
        if (cancelled) return

        setBindings(next)
        setBindingsKey(selectedGroup.key)
      })
      .catch((error) => {
        if (!cancelled) {
          setBindingsKey(null)
          setBindingsError(getErrorMessage(error, '读取仓库绑定失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBindings(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, selectedGroup])

  const summary = useMemo(() => {
    if (!selectedGroup) return null

    return buildVersionRepositorySummary(
      selectedRequirements,
      bindings,
      repositories
    )
  }, [bindings, repositories, selectedRequirements, selectedGroup])

  const requirementNameMap = useMemo(
    () =>
      new Map(
        selectedRequirements.map((requirement) => [
          requirement.id,
          requirement.name
        ])
      ),
    [selectedRequirements]
  )

  const repositoryConfigMap = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories]
  )

  const bindingsByRepository = useMemo(() => {
    const grouped = new Map<string, RequirementRepoBinding[]>()

    for (const requirement of selectedRequirements) {
      for (const binding of bindings[requirement.id] ?? []) {
        const current = grouped.get(binding.repositoryId) ?? []
        current.push(binding)
        grouped.set(binding.repositoryId, current)
      }
    }

    return grouped
  }, [bindings, selectedRequirements])

  /** 渲染分支对应的仓库快捷入口，和需求详情保持一致。 */
  const renderBranchLinks = (
    repository: VersionRepositorySummaryData,
    branch: RepositoryBranchSummary
  ): JSX.Element | null => {
    const config = repositoryConfigMap.get(repository.repositoryId)
    const repositoryBindings =
      bindingsByRepository.get(repository.repositoryId) ?? []
    const links: Array<{
      key: string
      label: string
      icon: JSX.Element
      href: string
      embedded?: boolean
    }> = []

    if (branch.kinds.includes('development')) {
      const hasDevelopmentBinding = repositoryBindings.some(
        (binding) =>
          binding.mode === 'normal' && binding.branchName === branch.name
      )

      if (hasDevelopmentBinding) {
        const remoteUrl = getRemoteBranchesUrl(config?.remoteUrl)

        if (remoteUrl) {
          links.push({
            key: 'remote',
            label: '远程仓库',
            icon: <BranchesOutlined />,
            href: remoteUrl
          })
        }

        const mergeRequestUrl =
          config?.defaultBranch && branch.name !== config.defaultBranch
            ? getMergeRequestUrl(
                config.remoteUrl,
                branch.name,
                config.defaultBranch
              )
            : null

        if (mergeRequestUrl) {
          links.push({
            key: 'merge-request',
            label: '创建 MR',
            icon: <PullRequestOutlined />,
            href: mergeRequestUrl,
            embedded: true
          })
        }
      }
    }

    if (branch.kinds.includes('requirement')) {
      const binding = repositoryBindings.find(
        (item) =>
          item.mode === 'qingzhou' &&
          item.requirementBranch === branch.name &&
          Boolean(getQingzhouTasksUrl(item))
      )
      const url = binding ? getQingzhouTasksUrl(binding) : null

      if (url) {
        links.push({
          key: 'qingzhou-tasks',
          label: '轻舟工作任务',
          icon: <LinkOutlined />,
          href: url
        })
      }
    }

    if (branch.kinds.includes('iteration')) {
      const binding = repositoryBindings.find(
        (item) =>
          item.mode === 'qingzhou' &&
          item.iterationBranch === branch.name &&
          Boolean(getQingzhouBuildUrl(item))
      )
      const url = binding ? getQingzhouBuildUrl(binding) : null

      if (url) {
        links.push({
          key: 'qingzhou-iteration-build',
          label: '轻舟迭代分支构建',
          icon: <DeploymentUnitOutlined />,
          href: url
        })
      }
    }

    if (links.length === 0) return null

    return (
      <span className="version-summary-branch-actions">
        {links.map((link) => (
          <Typography.Link
            key={link.key}
            className="version-summary-branch-link"
            href={link.href}
            target={link.embedded ? undefined : '_blank'}
            rel={link.embedded ? undefined : 'noopener noreferrer'}
            onClick={
              link.embedded
                ? (event) => {
                    event.preventDefault()
                    window.electron.openEmbeddedBrowser(link.href)
                  }
                : undefined
            }
          >
            {link.icon}
            {link.label}
          </Typography.Link>
        ))}
      </span>
    )
  }

  const versionOptions = useMemo(
    () =>
      (groups ?? []).map((group) => ({
        value: group.key,
        label: `${group.versionName}（${group.requirements.length}）`
      })),
    [groups]
  )

  const retry = (): void => {
    setReloadToken((current) => current + 1)
  }

  return (
    <Modal
      title={
        selectedGroup
          ? `${selectedGroup.versionName}${
              productLineFilters.length > 0
                ? ` · ${productLineFilters.join('、')}`
                : ''
            } · 仓库汇总`
          : '版本仓库汇总'
      }
      open={open}
      width={920}
      footer={null}
      destroyOnHidden
      onCancel={onClose}
    >
      {loadingData || (!groups && !dataError) ? (
        <div className="version-summary-loading">
          <Spin />
        </div>
      ) : dataError ? (
        <Alert
          type="error"
          showIcon
          message="读取版本数据失败"
          description={dataError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={retry}>
              重试
            </Button>
          }
        />
      ) : groups && groups.length > 0 ? (
        <>
          <div className="version-summary-toolbar">
            <Select
              showSearch
              className="version-summary-version-select"
              value={selectedKey ?? undefined}
              options={versionOptions}
              optionFilterProp="label"
              placeholder="选择版本"
              onChange={(value: string) => setSelectedKey(value)}
            />
            <Select
              mode="multiple"
              allowClear
              showSearch
              maxTagCount="responsive"
              maxTagPlaceholder={(omitted) => `+${omitted.length}`}
              className="version-summary-product-line-select"
              value={productLineFilters}
              options={productLineOptions}
              optionFilterProp="label"
              placeholder={`全部产线（${productLineOptions.length}）`}
              onChange={(values: string[]) => setProductLineFilters(values)}
            />
            <span className="version-summary-toolbar-hint">
              包含已结束需求和本地需求
            </span>
          </div>

          <p className="version-summary-note">
            统计范围为当前空间里我参与的需求；切换版本或产线会同步更新以下统计。
          </p>

          {bindingsError ? (
            <Alert
              type="error"
              showIcon
              message="读取仓库绑定失败"
              description={bindingsError}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={retry}>
                  重试
                </Button>
              }
            />
          ) : loadingBindings ||
            !summary ||
            !selectedGroup ||
            bindingsKey !== selectedGroup.key ? (
            <div className="version-summary-loading">
              <Spin />
            </div>
          ) : (
            <>
              <div className="version-summary-stats">
                <div>
                  <strong>{selectedRequirements.length}</strong>
                  <span>需求</span>
                </div>
                <div>
                  <strong>{summary.boundRequirementCount}</strong>
                  <span>已绑定</span>
                </div>
                <div>
                  <strong>{summary.unboundRequirements.length}</strong>
                  <span>未绑定</span>
                </div>
                <div>
                  <strong>{summary.repositories.length}</strong>
                  <span>仓库</span>
                </div>
                <div>
                  <strong>{summary.branchCount}</strong>
                  <span>分支</span>
                </div>
                {summary.unavailableRepositoryCount > 0 ? (
                  <div className="is-warning">
                    <strong>{summary.unavailableRepositoryCount}</strong>
                    <span>不可用</span>
                  </div>
                ) : null}
              </div>

              {summary.repositories.length > 0 ? (
                <div className="version-summary-repositories">
                  {summary.repositories.map((repository) => (
                    <section
                      className="version-summary-repository"
                      key={repository.repositoryId}
                    >
                      <div className="version-summary-repository-head">
                        <div className="version-summary-repository-title">
                          <FolderOpenOutlined className="version-summary-repository-icon" />
                          <strong title={repository.name}>
                            {repository.name}
                          </strong>
                          {!repository.missing ? (
                            <CopyButton
                              value={repository.name}
                              label="仓库名称"
                            />
                          ) : null}
                          {repository.missing ? (
                            <Tag color="red" bordered={false}>
                              仓库已移除
                            </Tag>
                          ) : !repository.available ? (
                            <Tag color="orange" bordered={false}>
                              路径不存在
                            </Tag>
                          ) : null}
                        </div>
                      </div>

                      {repository.localPath ? (
                        <div
                          className="version-summary-repository-path"
                          title={repository.localPath}
                        >
                          {repository.localPath}
                        </div>
                      ) : repository.missing ? (
                        <div className="version-summary-repository-path">
                          仓库 ID：{repository.repositoryId}
                        </div>
                      ) : null}

                      {repository.branches.length > 0 ? (
                        <div className="version-summary-branches">
                          {repository.branches.map((branch) => {
                            const names = branch.requirementIds.map(
                              (requirementId) =>
                                requirementNameMap.get(requirementId) ??
                                requirementId
                            )

                            return (
                              <div
                                className="version-summary-branch"
                                key={branch.name}
                              >
                                <span className="version-summary-branch-kinds">
                                  {branch.kinds.map((kind) => (
                                    <Tag
                                      key={kind}
                                      color={BRANCH_KIND_COLORS[kind]}
                                      bordered={false}
                                    >
                                      {BRANCH_KIND_LABELS[kind]}
                                    </Tag>
                                  ))}
                                </span>
                                <span className="version-summary-branch-name">
                                  <code title={branch.name}>{branch.name}</code>
                                  <CopyButton
                                    value={branch.name}
                                    label="分支名称"
                                  />
                                </span>
                                <Tooltip title={names.join('、')}>
                                  <span className="version-summary-branch-requirements">
                                    {names.length} 个需求
                                  </span>
                                </Tooltip>
                                {renderBranchLinks(repository, branch)}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <span className="version-summary-branch-pending">
                          分支待创建
                        </span>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="本版本还没有绑定仓库"
                />
              )}

              {summary.unboundRequirements.length > 0 ? (
                <div className="version-summary-unbound">
                  <strong>未绑定仓库的需求：</strong>
                  <Tooltip
                    title={summary.unboundRequirements
                      .map((requirement) => requirement.name)
                      .join('、')}
                  >
                    <span>
                      {summary.unboundRequirements
                        .slice(0, 4)
                        .map((requirement) => requirement.name)
                        .join('、')}
                      {summary.unboundRequirements.length > 4
                        ? ` 等 ${summary.unboundRequirements.length} 个`
                        : ''}
                    </span>
                  </Tooltip>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前空间没有可汇总的版本"
        />
      )}
    </Modal>
  )
}
