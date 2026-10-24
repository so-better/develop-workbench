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

  /** 轻舟模式下的工作项 ID；普通模式为 null。 */
  qingzhouTaskId: string | null

  /** 创建时间，ISO 字符串。 */
  createdAt: string

  /** 更新时间，ISO 字符串。 */
  updatedAt: string
}

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
