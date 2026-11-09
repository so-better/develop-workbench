/**
 * 需求绑定的代码仓库。
 */
export interface RequirementRepoBinding {
  /** 绑定记录 ID。 */
  id: string

  /** 关联的代码仓库 ID。 */
  repositoryId: string

  /** 绑定模式：普通分支或轻舟工作项。 */
  mode: 'normal' | 'qingzhou'

  /** 普通模式下的开发分支；轻舟模式为 null。 */
  branchName: string | null

  /** 轻舟工作项 ID，通常与飞书需求 ID 相同。 */
  qingzhouWorkItemId: string | null

  /** 轻舟代码任务 ID；尚未创建代码任务时为 null。 */
  qingzhouTaskId: string | null

  /** 轻舟工作项名称。 */
  qingzhouWorkItemTitle: string | null

  /** 轻舟代码仓库 ID；普通模式为 null。 */
  qingzhouCodeRepositoryId: string | null

  /** 轻舟需求分支；普通模式为 null。 */
  requirementBranch: string | null

  /** 轻舟迭代分支；普通模式为 null。 */
  iterationBranch: string | null

  /** 轻舟迭代分支 ID，用于打开构建页；普通模式或缺失时为 null。 */
  qingzhouIterationBranchId: string | null

  /** 轻舟绑定最后一次同步时间。 */
  lastSyncedAt: string | null

  /** 创建时间，ISO 字符串。 */
  createdAt: string

  /** 更新时间，ISO 字符串。 */
  updatedAt: string
}

/**
 * 需求 ID 到仓库绑定列表的映射。
 */
export type RequirementBindingsMap = Record<string, RequirementRepoBinding[]>

/**
 * 单个需求的仓库绑定状态。
 */
export interface RequirementBindingState {
  /** Meegle 需求 ID。 */
  requirementId: string

  /** Meegle 空间 projectKey。 */
  projectKey: string

  /** 已绑定的仓库列表。 */
  bindings: RequirementRepoBinding[]
}
