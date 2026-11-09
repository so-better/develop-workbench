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
  Tooltip
} from 'antd'
import {
  CheckOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import type { RequirementBindingsMap } from '../../../../types/bindings'
import type { Repository } from '../../../../types/repository'
import { getErrorMessage } from '../../../../utils'
import {
  buildIterationRepositorySummary,
  groupIterationSummaryRequirements,
  type IterationBranchKind,
  type IterationSummaryGroup
} from '../../utils/iteration-repositories'
import './iteration-repository-summary.css'

const BRANCH_KIND_LABELS: Record<IterationBranchKind, string> = {
  development: '开发分支',
  requirement: '需求分支',
  iteration: '迭代分支'
}

const BRANCH_KIND_COLORS: Record<IterationBranchKind, string | undefined> = {
  development: undefined,
  requirement: 'blue',
  iteration: 'purple'
}

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
        className={`iteration-summary-copy${copied ? ' is-copied' : ''}`}
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        aria-label={`复制${label}`}
        onClick={() => void handleCopy()}
      />
    </Tooltip>
  )
}

interface IterationRepositorySummaryProps {
  /** 是否打开汇总弹窗。 */
  open: boolean

  /** 优先选中的迭代分组 key。 */
  preferredIterationKey?: string | null

  /** 关闭弹窗。 */
  onClose: () => void
}

/**
 * 迭代仓库汇总弹窗。
 * 打开时读取当前空间所有需求（含已结束）和本地绑定，再按所选迭代聚合。
 */
export default function IterationRepositorySummary({
  open,
  preferredIterationKey,
  onClose
}: IterationRepositorySummaryProps): JSX.Element {
  const [groups, setGroups] = useState<IterationSummaryGroup[] | null>(null)
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
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
      window.electron.getIterationSummaryRequirements(),
      window.electron.getRepositoryState()
    ])
      .then(([requirements, repositoryState]) => {
        if (cancelled) return

        const nextGroups = groupIterationSummaryRequirements(requirements)
        const preferredKey =
          previousKey && nextGroups.some((group) => group.key === previousKey)
            ? previousKey
            : preferredIterationKey &&
                nextGroups.some((group) => group.key === preferredIterationKey)
              ? preferredIterationKey
              : nextGroups[0]?.key ?? null

        setGroups(nextGroups)
        setRepositories(repositoryState.repositories)
        setSelectedKey(preferredKey)
      })
      .catch((error) => {
        if (!cancelled) {
          setDataError(getErrorMessage(error, '读取迭代汇总数据失败'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, preferredIterationKey, reloadToken])

  const selectedGroup = useMemo(
    () => groups?.find((group) => group.key === selectedKey) ?? null,
    [groups, selectedKey]
  )

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

    return buildIterationRepositorySummary(
      selectedGroup.requirements,
      bindings,
      repositories
    )
  }, [bindings, repositories, selectedGroup])

  const requirementNameMap = useMemo(
    () =>
      new Map(
        (selectedGroup?.requirements ?? []).map((requirement) => [
          requirement.id,
          requirement.name
        ])
      ),
    [selectedGroup]
  )

  const iterationOptions = useMemo(
    () =>
      (groups ?? []).map((group) => ({
        value: group.key,
        label: `${group.iterationName}（${group.requirements.length}）`
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
          ? `${selectedGroup.iterationName} · 仓库汇总`
          : '迭代仓库汇总'
      }
      open={open}
      width={780}
      footer={null}
      destroyOnHidden
      onCancel={onClose}
    >
      {loadingData || (!groups && !dataError) ? (
        <div className="iteration-summary-loading">
          <Spin />
        </div>
      ) : dataError ? (
        <Alert
          type="error"
          showIcon
          message="读取迭代数据失败"
          description={dataError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={retry}>
              重试
            </Button>
          }
        />
      ) : groups && groups.length > 0 ? (
        <>
          <div className="iteration-summary-toolbar">
            <Select
              showSearch
              className="iteration-summary-iteration-select"
              value={selectedKey ?? undefined}
              options={iterationOptions}
              optionFilterProp="label"
              placeholder="选择迭代"
              onChange={(value: string) => setSelectedKey(value)}
            />
            <span className="iteration-summary-toolbar-hint">
              包含已结束需求和本地需求
            </span>
          </div>

          <p className="iteration-summary-note">
            统计范围为当前空间里我参与的需求，不受搜索和状态筛选影响。
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
            <div className="iteration-summary-loading">
              <Spin />
            </div>
          ) : (
            <>
              <div className="iteration-summary-stats">
                <div>
                  <strong>{selectedGroup.requirements.length}</strong>
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
                <div className="iteration-summary-repositories">
                  {summary.repositories.map((repository) => (
                    <section
                      className="iteration-summary-repository"
                      key={repository.repositoryId}
                    >
                      <div className="iteration-summary-repository-head">
                        <div className="iteration-summary-repository-title">
                          <FolderOpenOutlined className="iteration-summary-repository-icon" />
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
                          className="iteration-summary-repository-path"
                          title={repository.localPath}
                        >
                          {repository.localPath}
                        </div>
                      ) : repository.missing ? (
                        <div className="iteration-summary-repository-path">
                          仓库 ID：{repository.repositoryId}
                        </div>
                      ) : null}

                      {repository.branches.length > 0 ? (
                        <div className="iteration-summary-branches">
                          {repository.branches.map((branch) => {
                            const names = branch.requirementIds.map(
                              (requirementId) =>
                                requirementNameMap.get(requirementId) ??
                                requirementId
                            )

                            return (
                              <div
                                className="iteration-summary-branch"
                                key={branch.name}
                              >
                                <span className="iteration-summary-branch-kinds">
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
                                <span className="iteration-summary-branch-name">
                                  <code title={branch.name}>{branch.name}</code>
                                  <CopyButton
                                    value={branch.name}
                                    label="分支名称"
                                  />
                                </span>
                                <Tooltip title={names.join('、')}>
                                  <span className="iteration-summary-branch-requirements">
                                    {names.length} 个需求
                                  </span>
                                </Tooltip>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <span className="iteration-summary-branch-pending">
                          分支待创建
                        </span>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="本迭代还没有绑定仓库"
                />
              )}

              {summary.unboundRequirements.length > 0 ? (
                <div className="iteration-summary-unbound">
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
          description="当前空间没有可汇总的迭代"
        />
      )}
    </Modal>
  )
}
