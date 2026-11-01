/**
 * 本地临时需求状态。
 */
export type LocalRequirementStatus = '待处理' | '进行中' | '已完成' | '已取消'

/**
 * 本地临时需求优先级。
 */
export type LocalRequirementPriority = 'P0' | 'P1' | 'P2'

/**
 * 本地临时需求关联的产品人员。
 */
export interface LocalRequirementPerson {
  /** 用户显示名。 */
  name: string

  /** 用户邮箱。 */
  email: string | null

  /** 用户头像地址。 */
  avatarUrl: string | null

  /** 飞书 user_key。 */
  userKey: string | null
}

/**
 * 本地临时需求。
 * 只保存在当前设备，不同步到 Meegle。
 */
export interface LocalRequirement {
  /** 本地需求 ID，格式为 local:<uuid>。 */
  id: string

  /** 所属 Meegle 空间 projectKey。 */
  projectKey: string

  /** 需求名称。 */
  name: string

  /** 需求描述。 */
  description: string | null

  /** 本地状态。 */
  status: LocalRequirementStatus

  /** 优先级。 */
  priority: LocalRequirementPriority | null

  /** 产品负责人。 */
  productManager: LocalRequirementPerson | null

  /** 所属迭代 ID；未规划时为 null。 */
  iterationId: string | null

  /** 所属迭代名称；未规划时为 null。 */
  iterationName: string | null

  /** 从迭代名称解析出的日期。 */
  iterationDate: string | null

  /** 是否已结束，用于跟随“显示已结束”开关。 */
  closed: boolean

  /** 创建时间，ISO 字符串。 */
  createdAt: string

  /** 更新时间，ISO 字符串。 */
  updatedAt: string

  /** 完成时间，ISO 字符串。 */
  completedAt: string | null
}

/**
 * 新建或编辑本地临时需求时提交的字段。
 */
export interface LocalRequirementInput {
  /** 需求名称。 */
  name: string

  /** 需求描述。 */
  description: string | null

  /** 本地状态。 */
  status: LocalRequirementStatus

  /** 优先级。 */
  priority: LocalRequirementPriority | null

  /** 产品负责人。 */
  productManager: LocalRequirementPerson | null

  /** 所属迭代 ID；未规划时为 null。 */
  iterationId: string | null

  /** 所属迭代名称；未规划时为 null。 */
  iterationName: string | null

  /** 从迭代名称解析出的日期。 */
  iterationDate: string | null
}
