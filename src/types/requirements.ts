/**
 * Meegle 空间信息。
 */
export interface MeegleProject {
  /** CLI 使用的空间 key，通常是 simpleName。 */
  key: string

  /** 空间完整 projectKey，用于匹配跨空间返回的数据。 */
  projectKey: string

  /** 空间名称。 */
  name: string
}

/**
 * 需求负责人。
 */
export interface MeegleRequirementOwner {
  /** 用户显示名。 */
  name: string

  /** 用户邮箱，接口未返回时为 null。 */
  email: string | null

  /** 用户头像地址。 */
  avatarUrl: string | null

  /** 飞书 user_key，用于评论通知。 */
  userKey: string | null
}

/**
 * 需求协作角色。
 */
export interface MeegleRequirementCollaborator {
  /** 角色名称，例如产品经理、QA。 */
  role: string

  /** 该角色下的成员。 */
  members: MeegleRequirementOwner[]
}

/**
 * 当前用户负责的需求。
 */
export interface MeegleRequirement {
  /** 需求来源：Meegle 或本地临时需求。 */
  source: 'meegle' | 'local'

  /** 需求工作项 ID。 */
  id: string

  /** 需求名称。 */
  name: string

  /** 当前状态标签。 */
  status: string | null

  /** 优先级标签，例如 P0、P1。 */
  priority: string | null

  /** 当前节点负责人。 */
  owners: MeegleRequirementOwner[]

  /** 产品经理。 */
  productManagers: MeegleRequirementOwner[]

  /** 产品负责人。 */
  productOwners: MeegleRequirementOwner[]

  /** 需求类型，例如“技术需求”。 */
  requirementType: string | null

  /** 节点风险或延期标识，例如“QA测试 今日到期”。 */
  riskLabels: string[]

  /** 需求描述。 */
  description: string | null

  /** 需求文档地址。 */
  documentUrl: string | null

  /** 创建人。 */
  createdBy: MeegleRequirementOwner | null

  /** 提出时间。 */
  proposedAt: string | null

  /** 预计上线时间。 */
  expectedReleaseAt: string | null

  /** 产品线路径，例如“门店数字化 / SOM门店营运管理”。 */
  productLines: string[]

  /** 规划版本。 */
  planningVersions: string[]

  /** 按角色整理的协作人员。 */
  collaborators: MeegleRequirementCollaborator[]

  /** 需求等级。 */
  requirementLevel: string | null

  /** 需求性质。 */
  requirementNature: string | null

  /** 需求复杂度。 */
  complexity: number | null

  /** 研发难度估分。 */
  developmentDifficulty: number | null

  /** 预估开发量。 */
  estimatedWorkload: string | null

  /** 技术方案。 */
  technicalSolution: string | null

  /** 应用。 */
  application: string | null

  /** 标签。 */
  tags: string[]

  /** 实际上车版本。 */
  actualReleaseVersions: string[]

  /** 完成日期。 */
  completedAt: string | null

  /** 是否涉及权限。 */
  permissionsInvolved: string | null

  /** 是否涉及历史数据。 */
  historicalDataInvolved: string | null

  /** 是否涉及性能测试。 */
  performanceTestInvolved: string | null

  /** 备注。 */
  remark: string | null

  /** 所属迭代 ID；未规划时为空。 */
  iterationId: string | null

  /** 所属迭代名称；未规划时为空。 */
  iterationName: string | null

  /** 从迭代名称解析出的日期，格式 YYYY-MM-DD。 */
  iterationDate: string | null

  /** 最后更新时间，接口通常返回 YYYY-MM-DD。 */
  updatedAt: string | null
}

/**
 * 按迭代分组后的需求。
 */
export interface MeegleRequirementGroup {
  /** 分组稳定键，未规划迭代时使用固定值。 */
  key: string

  /** 迭代 ID；未规划时为空。 */
  iterationId: string | null

  /** 迭代名称；未规划时为“未规划迭代”。 */
  iterationName: string

  /** 从迭代名称解析出的日期。 */
  releaseDate: string | null

  /** 该迭代下的需求。 */
  requirements: MeegleRequirement[]
}

/**
 * 节点表单字段。
 */
export interface MeegleNodeFormItem {
  /** 字段 key。 */
  key: string

  /** 字段名称。 */
  name: string

  /** 字段类型。 */
  type: string

  /** 是否必填。 */
  required: boolean

  /** 字段文本值；未填写时为空。 */
  value: string | null
}

/**
 * 需求流程节点。
 */
export interface MeegleWorkflowNode {
  /** 节点 key。 */
  key: string

  /** 节点名称。 */
  name: string

  /** 节点状态，例如 doing、finished、not_started。 */
  status: string

  /** 节点负责人。 */
  owners: MeegleRequirementOwner[]

  /** 节点排期开始时间，ISO 字符串。 */
  scheduleStart: string | null

  /** 节点排期结束时间，ISO 字符串。 */
  scheduleEnd: string | null

  /** 实际开始时间，ISO 字符串。 */
  actualStart: string | null

  /** 实际结束时间，ISO 字符串。 */
  actualEnd: string | null

  /** 实际工时。 */
  actualWorkTime: number | null

  /** 节点估分。 */
  points: number | null

  /** 节点表单字段。 */
  formItems: MeegleNodeFormItem[]

  /** 节点是否配置总排期字段。 */
  supportsSchedule: boolean

  /** 节点是否配置估分字段。 */
  supportsPoints: boolean

  /** 节点是否配置实际工时字段。 */
  supportsActualWorkTime: boolean

  /** 后续节点 key。 */
  nextNodeKeys: string[]
}

/**
 * 需求评论。
 */
export interface MeegleRequirementComment {
  /** 评论 ID。 */
  id: string

  /** Markdown 内容。 */
  content: string

  /** 创建时间。 */
  createdAt: string | null

  /** 创建人。 */
  creator: MeegleRequirementOwner | null
}

/**
 * 需求流程节点和评论。
 */
export interface MeegleRequirementActivity {
  /** 按流程顺序排列的节点。 */
  nodes: MeegleWorkflowNode[]

  /** 最新评论。 */
  comments: MeegleRequirementComment[]

  /** 评论总数。 */
  commentsTotal: number

  /** 数据读取时间，ISO 字符串。 */
  fetchedAt: string
}

/**
 * 节点信息更新参数。
 */
export interface UpdateNodeInfoInput {
  /** 开始时间，Unix 毫秒时间戳。只更新工时可省略。 */
  startAt?: number

  /** 结束时间，Unix 毫秒时间戳。只更新工时可省略。 */
  endAt?: number

  /** 显式清空总排期，与 startAt/endAt 互斥。 */
  clearSchedule?: boolean

  /** 总估分。 */
  points?: number

  /** 节点负责人 user_key 列表；传空数组表示清空负责人。 */
  ownerUserKeys?: string[]
}

/**
 * 当前用户的需求工作台数据。
 */
export interface MeegleMyRequirements {
  /** 当前使用的 Meegle 空间。 */
  project: MeegleProject

  /** 按迭代分组后的需求。 */
  groups: MeegleRequirementGroup[]

  /** 去重后的需求总数。 */
  total: number

  /** 数据读取时间，ISO 字符串。 */
  fetchedAt: string
}
