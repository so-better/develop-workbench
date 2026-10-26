import type { MeegleProject } from './requirements'

/** 当前用户参与缺陷的角色过滤项。 */
export const DEFECT_ROLES = [
  '测试验证人',
  '经办人',
  '产品经理',
  '研发负责人',
  '产品负责人',
  'QA负责人',
  '测试组长'
] as const

export type DefectRole = (typeof DEFECT_ROLES)[number]

/** BUG 处理人更新参数。 */
export interface UpdateDefectAssigneesInput {
  bugOperator?: string | null
  bugOwner?: string | null
  operatorCurrentKeys?: string[]
}

/** 缺陷相关用户。 */
export interface MeegleDefectOwner {
  name: string
  email: string | null
  avatarUrl: string | null
  userKey: string | null
}

/** 缺陷某个角色下的人员。 */
export interface MeegleDefectCollaborator {
  role: string
  members: MeegleDefectOwner[]
}

/** 缺陷关联的需求。 */
export interface MeegleDefectLinkedRequirement {
  id: string
  name: string
}

/** 缺陷流转字段选项。 */
export interface DefectTransitionOption {
  value: string
  label: string
}

/** 缺陷流转必填字段。 */
export interface DefectTransitionField {
  key: string
  name: string
  type: string
  options: DefectTransitionOption[]
}

/** 缺陷流转需要的角色。 */
export interface DefectTransitionRole {
  key: string
  name: string
}

/** 缺陷可流转状态。 */
export interface DefectTransition {
  id: string
  stateKey: string
  stateName: string
  fields: DefectTransitionField[]
  requiredRoles: DefectTransitionRole[]
}

/** 缺陷状态流转信息。 */
export interface DefectTransitions {
  currentStateKey: string
  currentStateName: string
  transitions: DefectTransition[]
}

/** 缺陷流转字段值。 */
export interface DefectTransitionFieldValue {
  fieldKey: string
  fieldValue: string
}

/** 缺陷评论。 */
export interface MeegleDefectComment {
  id: string
  content: string
  createdAt: string | null
  creator: MeegleDefectOwner | null
}

/** 缺陷评论列表。 */
export interface MeegleDefectComments {
  comments: MeegleDefectComment[]
  total: number
}

/** 单个缺陷。 */
export interface MeegleDefect {
  id: string
  name: string
  status: string | null
  priority: string | null
  severity: string | null
  iterationId: string | null
  iterationName: string | null
  owners: MeegleDefectOwner[]
  collaborators: MeegleDefectCollaborator[]
  updatedAt: string | null
  completedAt: string | null
  description: string | null
  linkedRequirement: MeegleDefectLinkedRequirement | null
  affectedVersions: string[]
  fixedVersions: string[]
  findingStage: string | null
  resolver: MeegleDefectOwner | null
  bugOwner: MeegleDefectOwner | null
  createdBy: MeegleDefectOwner | null
  updatedBy: MeegleDefectOwner | null
  watchers: MeegleDefectOwner[]
  proposedAt: string | null
}

/** 当前用户参与的缺陷列表。 */
export interface MeegleMyDefects {
  project: MeegleProject
  role: DefectRole | null
  defects: MeegleDefect[]
  total: number
  fetchedAt: string
}
