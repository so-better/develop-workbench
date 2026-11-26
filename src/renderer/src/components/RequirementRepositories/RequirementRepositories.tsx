import {
  BranchesOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  PlusOutlined,
  PullRequestOutlined,
  ReloadOutlined,
  TagOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Popconfirm,
  Select,
  Skeleton,
  Spin,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { RequirementRepoBinding } from '../../../../types/bindings'
import type {
  Repository,
  RepositoryBindingStatus
} from '../../../../types/repository'
import type { SettingsSection } from '../../../../types/settings'
import { getRemoteBranchesUrl } from '../../pages/RequirementWorkbench/workbench-utils'
import BranchRow from '../RequirementBranchRow/RequirementBranchRow'
import '../RequirementLinks/requirement-links.css'
import './RequirementRepositories.css'

interface RequirementRepositoriesProps {
  bindings: RequirementRepoBinding[]
  bindingsLoading: boolean
  bindingsError: string | null
  refreshing: boolean
  addBindingOpen: boolean
  onToggleAddBinding: () => void
  onRefresh: () => void
  repositoryMap: Map<string, Repository>
  bindingStatuses: Record<string, RepositoryBindingStatus>
  openingIdeBindingId: string | null
  syncingBindingId: string | null
  removingBindingId: string | null
  qingzhouRequirementUrl: string | null
  selectedRequirementId: string | null
  repositories: Repository[]
  repositoriesLoading: boolean
  availableRepositories: Repository[]
  newRepositoryId: string | null
  newBranchName: string | null
  newRepositoryIsQingzhou: boolean
  newRepositoryBranchesLoading: boolean
  newRepositoryBranchOptions: Array<{ value: string; label: string }>
  bindingSaving: boolean
  onNewRepositoryChange: (repositoryId: string) => void
  onNewBranchChange: (branchName: string) => void
  onOpenCreateBranch: () => void
  onAddBinding: () => void
  onOpenSettings: (section: SettingsSection) => void
  onOpenCreateMergeRequest: (binding: RequirementRepoBinding) => void
  onCopyBranchName: (branchName: string) => void
  onOpenEditBindingBranch: (binding: RequirementRepoBinding) => void
  onSyncQingzhouBinding: (bindingId: string) => void
  onRequestOpenInIde: (binding: RequirementRepoBinding) => void
  onRemoveBinding: (bindingId: string) => void
}

/**
 * 需求详情中的关联代码仓库区块。
 */
export default function RequirementRepositories({
  bindings,
  bindingsLoading,
  bindingsError,
  refreshing,
  addBindingOpen,
  onToggleAddBinding,
  onRefresh,
  repositoryMap,
  bindingStatuses,
  openingIdeBindingId,
  syncingBindingId,
  removingBindingId,
  qingzhouRequirementUrl,
  selectedRequirementId,
  repositories,
  repositoriesLoading,
  availableRepositories,
  newRepositoryId,
  newBranchName,
  newRepositoryIsQingzhou,
  newRepositoryBranchesLoading,
  newRepositoryBranchOptions,
  bindingSaving,
  onNewRepositoryChange,
  onNewBranchChange,
  onOpenCreateBranch,
  onAddBinding,
  onOpenSettings,
  onOpenCreateMergeRequest,
  onCopyBranchName,
  onOpenEditBindingBranch,
  onSyncQingzhouBinding,
  onRequestOpenInIde,
  onRemoveBinding
}: RequirementRepositoriesProps): JSX.Element {
  const showAddBinding = bindings.length === 0 || addBindingOpen

  return (
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
                refreshing
              }
              aria-label="刷新仓库和分支"
              onClick={() => onRefresh()}
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
              onClick={() => onToggleAddBinding()}
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
                                    onOpenCreateMergeRequest(binding)
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
                            onCopy={onCopyBranchName}
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
                            onCopy={onCopyBranchName}
                          />
                          {bindingStatus?.requirementMergedToIteration === false ? (
                            <div className="requirement-repo-qingzhou-state is-warning">
                              <ExclamationCircleFilled />
                              <span
                                title={`对比远程分支：origin/${binding.iterationBranch ?? ''}`}
                              >
                                需求分支还有{' '}
                                {bindingStatus.requirementAheadCommits ?? '若干'}{' '}
                                个提交未合入迭代分支
                              </span>
                            </div>
                          ) : null}
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
                                    onCopyBranchName(
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
                          <Tooltip title="修改开发分支">
                            <Button
                              type="text"
                              size="small"
                              className="requirement-repo-edit-branch"
                              icon={<EditOutlined />}
                              aria-label="修改开发分支"
                              disabled={!repository?.available}
                              onClick={() =>
                                onOpenEditBindingBranch(binding)
                              }
                            />
                          </Tooltip>
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
                            onSyncQingzhouBinding(binding.id)
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
                        onClick={() => onRequestOpenInIde(binding)}
                      >
                        打开 IDE
                      </Button>
                      <Popconfirm
                        title="解除仓库绑定？"
                        description="只解除绑定，不会删除分支或本地代码。"
                        okText="解除"
                        cancelText="取消"
                        onConfirm={() => onRemoveBinding(binding.id)}
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
                      onChange={(value: string) => onNewRepositoryChange(value)}
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
                        onChange={(value: string) => onNewBranchChange(value)}
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
                        onClick={() => onOpenCreateBranch()}
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
                      onClick={() => onAddBinding()}
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
  )
}
