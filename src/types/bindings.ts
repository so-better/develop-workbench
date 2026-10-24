/**
 * 需求绑定的代码仓库。
 */
export interface RequirementRepoBinding {
  /** 绑定记录 ID。 */
  id: string

  /** 关联的代码仓库 ID。 */
  repositoryId: string

  /** 该仓库对应的需求开发分支。 */
  branchName: string

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
