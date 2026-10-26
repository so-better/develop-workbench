/** 需求详情里的本地个人状态标记。 */
export interface RequirementPersonalStatus {
  projectKey: string
  requirementId: string
  value: string
  updatedAt: string
}

/** 单条需求个人状态的读取结果。 */
export interface RequirementPersonalStatusState {
  projectKey: string
  requirementId: string
  status: RequirementPersonalStatus | null
}
