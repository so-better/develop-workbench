/**
 * Meegle 需求工作台数据模块。
 * 读取当前登录用户的待办需求，并按所属迭代分组后注册 IPC。
 */
import { ipcMain } from 'electron'
import { runMeegle } from './meegle'
import type {
  MeegleMyRequirements,
  MeegleProject,
  MeegleRequirement,
  MeegleRequirementActivity,
  MeegleRequirementCollaborator,
  MeegleRequirementComment,
  MeegleRequirementGroup,
  MeegleRequirementOwner,
  MeegleWorkflowNode,
  UpdateNodeScheduleInput
} from '../types/requirements'

/** Meegle CLI 进程输出。 */
interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

/** Meegle CLI 返回的顶层错误。 */
interface CliError {
  message?: string
}

interface ProjectSearchResponse {
  projects?: Array<{
    name?: string
    project_key?: string
    simple_name?: string
  }>
  error?: CliError
}

interface MyWorkItem {
  project_key?: string
  work_item_info?: {
    work_item_id?: number | string
    work_item_type_key?: string
  }
}

/** meegle mywork todo 的响应结构。 */
interface MyWorkResponse {
  list?: MyWorkItem[] | null
  total?: number
  error?: CliError
}

/** MQL 返回值，按 value_type 使用不同字段。 */
interface MoqlValue {
  string_value?: string
  long_value?: number | string
  double_value?: number
  key_label_value?: {
    label?: string
  }
  key_label_value_list?: Array<{
    key?: string
    label?: string
  }>
  user_value?: {
    name_cn?: string
    name_en?: string
    email?: string
  }
  user_value_list?: Array<{
    name_cn?: string
    name_en?: string
    email?: string
  }>
  string_value_list?: string[]
  cascade_key_label_value?: {
    label?: string
    children?: Array<{
      label?: string
      children?: Array<{
        label?: string
      }> | null
    }> | null
  }
}

/** MQL 查询结果中的单个字段。 */
interface MoqlField {
  key?: string
  name?: string
  value?: MoqlValue | null
}

/** MQL 查询结果中的单行工作项。 */
interface MoqlRow {
  moql_field_list?: MoqlField[]
}

/** MQL 查询响应，data 按分组 ID 组织行数据。 */
interface MoqlResponse {
  data?: Record<string, MoqlRow[] | null> | null
  error?: CliError
}

interface WorkflowRawNode {
  basic?: {
    node_key?: string
    name?: string
    status?: string
    next_node_keys?: string[]
    pre_node_keys?: string[]
  }
  assignees?: {
    owners?: Array<{
      user_key?: string
      name?: string
      email?: string
    }>
  }
  schedule?: {
    estimate_start_time?: number | string | null
    estimate_finish_time?: number | string | null
    points?: number | null
  }
  form_items?: Array<{
    field_name?: string
    is_required?: boolean
    value?: unknown
  }>
}

interface WorkflowNodeResponse {
  list?: WorkflowRawNode[] | null
  pagination?: {
    has_more?: boolean
  }
  error?: CliError
}

interface RawComment {
  comment_id?: string
  content?: string
  created_at?: string
  creator?: string
}

interface CommentListResponse {
  comments?: RawComment[] | null
  pagination?: {
    total?: number
  }
  error?: CliError
}

interface UserSearchUser {
  user_key?: string
  name_cn?: string
  name_en?: string
  email?: string
}

/** 需求查询可能比登录状态查询慢，使用更宽松的超时时间。 */
const MEEGLE_QUERY_TIMEOUT_MS = 30_000

/** Meegle 空间信息缓存时长，避免每次刷新都重复查询。 */
const PROJECT_CACHE_TTL_MS = 5 * 60 * 1000

/** Meegle 待办接口每页固定 50 条，最多读取 20 页，避免异常分页导致死循环。 */
const MY_WORK_PAGE_SIZE = 50
const MAX_MY_WORK_PAGES = 20

/** MQL 单次最多返回 50 条，按 ID 分批查询。 */
const REQUIREMENT_BATCH_SIZE = 50

/** 最近访问的 Meegle 空间缓存。 */
let cachedProject: { value: MeegleProject; expiresAt: number } | null = null

/** 用户信息缓存，避免节点和评论反复解析同一批 user_key。 */
const userCache = new Map<string, MeegleRequirementOwner>()

/**
 * 解析 CLI JSON 输出，并把服务端错误转为可读异常。
 */
const parseCommandJson = <T>(result: CommandResult, action: string): T => {
  const output = result.stdout.trim()

  if (!output) {
    const detail = result.stderr.trim()
    throw new Error(detail || `${action}失败：Meegle CLI 没有返回内容`)
  }

  let parsed: T

  try {
    parsed = JSON.parse(output) as T
  } catch {
    throw new Error(`${action}失败：无法解析 Meegle CLI 返回内容`)
  }

  const error = (parsed as { error?: CliError } | null)?.error

  if (error?.message) {
    throw new Error(error.message.split(/\r?\n/)[0])
  }

  if (result.code !== 0) {
    const detail = result.stderr.trim()
    throw new Error(detail || `${action}失败：Meegle CLI 退出码 ${result.code}`)
  }

  return parsed
}

/**
 * 校验写操作结果。
 * 写接口成功时可能返回空响应，因此只在有输出时解析错误结构。
 */
const ensureWriteSuccess = (result: CommandResult, action: string): void => {
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `${action}失败：Meegle CLI 退出码 ${result.code}`)
  }

  if (result.stdout.trim()) {
    parseCommandJson(result, action)
  }
}

/**
 * 获取当前最近访问的 Meegle 空间。
 * 空间信息在进程内缓存，避免每次切换需求都重复查询。
 */
const getProject = async (): Promise<MeegleProject> => {
  if (cachedProject && cachedProject.expiresAt > Date.now()) {
    return cachedProject.value
  }

  const result = await runMeegle(['project', 'search', '--format', 'json'], MEEGLE_QUERY_TIMEOUT_MS)
  const response = parseCommandJson<ProjectSearchResponse>(result, '读取 Meegle 空间')
  const project = response.projects?.[0]
  const name = project?.name?.trim()
  const projectKey = project?.project_key?.trim()
  const key = project?.simple_name?.trim() || projectKey

  if (!name || !key || !projectKey) {
    throw new Error('没有找到可用的 Meegle 空间')
  }

  const value: MeegleProject = { key, projectKey, name }
  cachedProject = {
    value,
    expiresAt: Date.now() + PROJECT_CACHE_TTL_MS
  }

  return value
}

/**
 * 生成 MQL 表名，并移除无法安全转义的反引号。
 */
const quoteMqlIdentifier = (value: string): string => `\`${value.replace(/`/g, '')}\``

/**
 * 从 MQL 响应中提取工作项行。
 */
const getRows = (response: MoqlResponse): MoqlRow[] => {
  const groups = Object.values(response.data ?? {})

  return groups.flatMap((group) => (Array.isArray(group) ? group : []))
}

/**
 * 将 MQL 字段列表转换为按 field key 索引的 Map。
 */
const toFieldMap = (row: MoqlRow): Map<string, MoqlValue | null> => {
  const fields = new Map<string, MoqlValue | null>()

  for (const field of row.moql_field_list ?? []) {
    if (field.key) fields.set(field.key, field.value ?? null)
  }

  return fields
}

/**
 * 从单个 MQL 值中读取字符串。
 */
const readValueString = (value: MoqlValue | null | undefined): string | null => {
  if (!value) return null
  if (typeof value.string_value === 'string') return value.string_value || null
  if (typeof value.long_value === 'number') return String(value.long_value)
  if (typeof value.long_value === 'string') return value.long_value || null
  if (typeof value.double_value === 'number') return String(value.double_value)
  if (value.key_label_value?.label) return value.key_label_value.label
  if (value.key_label_value_list?.[0]?.label) return value.key_label_value_list[0].label

  return null
}

/**
 * 读取字符串或数字类型字段。
 */
const readString = (fields: Map<string, MoqlValue | null>, key: string): string | null =>
  readValueString(fields.get(key))

/**
 * 按字段显示名读取字符串。
 */
const readFieldString = (row: MoqlRow, name: string): string | null =>
  readValueString(readFieldByName(row, name))

/**
 * 按字段显示名读取多选标签。
 */
const readFieldLabelList = (row: MoqlRow, name: string): string[] =>
  (readFieldByName(row, name)?.key_label_value_list ?? [])
    .map((item) => item.label?.trim())
    .filter((value): value is string => Boolean(value))

/**
 * 按字段显示名读取数值。
 */
const readFieldNumber = (row: MoqlRow, name: string): number | null => {
  const value = readFieldByName(row, name)

  if (typeof value?.double_value === 'number') return value.double_value
  if (typeof value?.long_value === 'number') return value.long_value

  return null
}

/**
 * 从 MQL 用户值中读取成员列表。
 */
const readUsersFromValue = (value: MoqlValue | null | undefined): MeegleRequirementOwner[] => {
  const users = value?.user_value_list

  if (!Array.isArray(users)) return []

  return users
    .map((user) => ({
      name: user.name_cn?.trim() || user.name_en?.trim() || user.email?.trim() || '未知成员',
      email: user.email?.trim() || null
    }))
    .filter((user) => user.name)
}

/**
 * 读取单个用户字段。
 */
const readUserFromValue = (value: MoqlValue | null | undefined): MeegleRequirementOwner | null => {
  const user = value?.user_value

  if (!user) return null

  const name = user.name_cn?.trim() || user.name_en?.trim() || user.email?.trim()

  return name ? { name, email: user.email?.trim() || null } : null
}

/**
 * 读取用户列表字段。
 */
const readUsers = (fields: Map<string, MoqlValue | null>, key: string): MeegleRequirementOwner[] =>
  readUsersFromValue(fields.get(key))

/**
 * 读取多选标签列表。
 */
const readLabelList = (fields: Map<string, MoqlValue | null>, key: string): string[] =>
  (fields.get(key)?.key_label_value_list ?? [])
    .map((item) => item.label?.trim())
    .filter((value): value is string => Boolean(value))

/**
 * 读取级联字段路径，例如“门店数字化 / SOM门店营运管理”。
 */
const readCascadePath = (value: MoqlValue | null | undefined): string[] => {
  const cascade = value?.cascade_key_label_value

  if (!cascade) return []

  const labels: string[] = []

  if (cascade.label) labels.push(cascade.label)

  let current = cascade.children?.[0]

  while (current) {
    if (current.label) labels.push(current.label)
    current = current.children?.[0]
  }

  return labels
}

/**
 * 按字段显示名读取值。
 * 角色字段的 key 包含空间和角色 ID，无法稳定使用 key 查询。
 */
const readFieldByName = (row: MoqlRow, name: string): MoqlValue | null =>
  row.moql_field_list?.find((field) => field.name === name)?.value ?? null

/**
 * 读取节点风险或延期标识。
 */
const readRiskLabels = (row: MoqlRow): string[] => {
  const labels = readFieldByName(row, '节点延期标识')?.string_value_list

  return Array.isArray(labels) ? labels.map((label) => label.trim()).filter(Boolean) : []
}

/**
 * 读取产品经理。
 */
const readProductManagers = (row: MoqlRow): MeegleRequirementOwner[] =>
  readUsersFromValue(readFieldByName(row, '__产品经理'))

/**
 * 读取产品负责人。
 */
const readProductOwners = (row: MoqlRow): MeegleRequirementOwner[] =>
  readUsersFromValue(readFieldByName(row, '__产品负责人'))

/**
 * 读取指定角色的成员。
 */
const readRoleMembers = (row: MoqlRow, role: string): MeegleRequirementOwner[] =>
  readUsersFromValue(readFieldByName(row, role))

/**
 * 汇总详情页展示的协作人员。
 */
const readCollaborators = (
  row: MoqlRow,
  productManagers: MeegleRequirementOwner[],
  productOwners: MeegleRequirementOwner[],
  currentOwners: MeegleRequirementOwner[]
): MeegleRequirementCollaborator[] => {
  const collaborators: MeegleRequirementCollaborator[] = [
    { role: '产品经理', members: productManagers },
    { role: '产品负责人', members: productOwners },
    { role: '研发负责人', members: readRoleMembers(row, '__研发负责人') },
    { role: 'QA', members: readRoleMembers(row, '__QA') },
    { role: '前端负责人', members: readRoleMembers(row, '__前端负责人') },
    { role: '前端开发', members: readRoleMembers(row, '__前端开发') },
    { role: '后端负责人', members: readRoleMembers(row, '__后端负责人') },
    { role: '后端开发', members: readRoleMembers(row, '__后端开发') },
    { role: '当前节点负责人', members: currentOwners }
  ]

  return collaborators.filter((collaborator) => collaborator.members.length > 0)
}

/**
 * 读取需求所属迭代。
 * 规划迭代是多选关联字段，当前需求只取第一个迭代用于分组。
 */
const readIteration = (
  fields: Map<string, MoqlValue | null>
): { id: string | null; name: string | null } => {
  const iteration = fields.get('planning_sprint')?.key_label_value_list?.[0]

  return {
    id: iteration?.key?.trim() || null,
    name: iteration?.label?.trim() || null
  }
}

/**
 * 从迭代名称末尾解析 YYYYMMDD 日期。
 */
const parseReleaseDate = (name: string): string | null => {
  const match = /(\d{4})(\d{2})(\d{2})$/.exec(name)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}

/**
 * 按固定大小切分数组。
 */
const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }

  return result
}

/**
 * 读取当前用户的待办需求 ID。
 * mywork 会按流程节点重复返回同一个工作项，需要先去重，再过滤掉缺陷等非需求类型。
 */
const fetchMyWorkRequirementIds = async (project: MeegleProject): Promise<string[]> => {
  const ids = new Set<string>()
  let page = 1
  let total = 0

  do {
    const result = await runMeegle(
      [
        'mywork',
        'todo',
        '--action',
        'todo',
        '--todo-scope',
        'all',
        '--page-num',
        String(page),
        '--format',
        'json'
      ],
      MEEGLE_QUERY_TIMEOUT_MS
    )
    const response = parseCommandJson<MyWorkResponse>(result, '读取当前用户需求')
    const items = response.list ?? []
    const fetchedBefore = (page - 1) * MY_WORK_PAGE_SIZE

    total = typeof response.total === 'number' ? response.total : fetchedBefore + items.length

    for (const item of items) {
      const info = item.work_item_info

      if (info?.work_item_type_key !== 'story') continue
      // mywork 是跨空间接口，只保留当前空间，避免后续按 ID 查询时静默丢失。
      if (item.project_key && item.project_key !== project.projectKey) continue

      const id = String(info.work_item_id ?? '').trim()

      if (id) ids.add(id)
    }

    if (items.length === 0) break

    page += 1
  } while (page <= MAX_MY_WORK_PAGES && (page - 1) * MY_WORK_PAGE_SIZE < total)

  return Array.from(ids)
}

/**
 * 将 MQL 工作项行转换为需求对象。
 */
const parseRequirement = (row: MoqlRow): MeegleRequirement | null => {
  const fields = toFieldMap(row)
  const id = readString(fields, 'work_item_id')
  const name = readString(fields, 'name')

  if (!id || !name) return null

  const iteration = readIteration(fields)
  const owners = readUsers(fields, 'current_status_operator')
  const productManagers = readProductManagers(row)
  const productOwners = readProductOwners(row)
  const documentUrl = readString(fields, 'wiki')?.trim() || null
  const description = readString(fields, 'description')?.trim() || null

  return {
    id,
    name,
    status: readString(fields, 'work_item_status'),
    priority: readString(fields, 'priority'),
    owners,
    productManagers,
    productOwners,
    requirementType: readString(fields, 'template'),
    riskLabels: readRiskLabels(row),
    description,
    documentUrl,
    createdBy: readUserFromValue(readFieldByName(row, '创建人')),
    proposedAt: readString(fields, 'start_time'),
    expectedReleaseAt: readString(fields, 'exp_time'),
    productLines: readCascadePath(readFieldByName(row, '产品线')),
    planningVersions: readLabelList(fields, 'planning_version'),
    collaborators: readCollaborators(row, productManagers, productOwners, owners),
    requirementLevel: readFieldString(row, '需求等级'),
    requirementNature: readFieldString(row, '需求性质'),
    complexity: readFieldNumber(row, '需求复杂度'),
    developmentDifficulty: readFieldNumber(row, '研发难度估分'),
    estimatedWorkload: readFieldString(row, '预估开发量'),
    technicalSolution: readFieldString(row, '技术方案'),
    application: readFieldString(row, '应用'),
    tags: readFieldLabelList(row, '标签'),
    actualReleaseVersions: readFieldLabelList(row, '实际上车版本'),
    completedAt: readFieldString(row, '完成日期'),
    permissionsInvolved: readFieldString(row, '是否涉及权限'),
    historicalDataInvolved: readFieldString(row, '是否涉及历史数据'),
    performanceTestInvolved: readFieldString(row, '是否涉及性能测试'),
    remark: readFieldString(row, '备注'),
    iterationId: iteration.id,
    iterationName: iteration.name,
    iterationDate: iteration.name ? parseReleaseDate(iteration.name) : null,
    updatedAt: readString(fields, 'updated_at')
  }
}

/**
 * 按 ID 批量读取需求详情。
 */
const fetchRequirementsByIds = async (
  project: MeegleProject,
  ids: string[]
): Promise<MeegleRequirement[]> => {
  const requirements: MeegleRequirement[] = []

  for (const batch of chunk(ids, REQUIREMENT_BATCH_SIZE)) {
    if (batch.length === 0) continue

    const mql = [
      'SELECT `工作项id`, `名称`, `状态`, `优先级`, `规划迭代`, `当前节点负责人`, `更新时间`, `需求类型`, `需求描述`, `需求文档`, `创建人`, `提出时间`, `预计上线时间`, `完成日期`, `规划版本`, `实际上车版本`, `产品线`, `需求等级`, `需求性质`, `需求复杂度`, `研发难度估分`, `预估开发量`, `技术方案`, `应用`, `标签`, `是否涉及权限`, `是否涉及历史数据`, `是否涉及性能测试`, `备注`, risk_label(), `__产品经理`, `__产品负责人`, `__研发负责人`, `__QA`, `__前端负责人`, `__前端开发`, `__后端负责人`, `__后端开发`',
      `FROM ${quoteMqlIdentifier(project.name)}.\`研发需求\``,
      `WHERE \`工作项id\` in (${batch.join(', ')})`,
      'LIMIT 50'
    ].join(' ')
    const result = await runMeegle(
      ['workitem', 'query', '--project-key', project.key, '--mql', mql, '--format', 'json'],
      MEEGLE_QUERY_TIMEOUT_MS
    )
    const response = parseCommandJson<MoqlResponse>(result, '读取需求详情')

    for (const row of getRows(response)) {
      const requirement = parseRequirement(row)

      if (requirement) requirements.push(requirement)
    }
  }

  return requirements
}

/**
 * 按所属迭代分组，并按迭代日期倒序排列。
 * 未规划迭代固定放在最后。
 */
const groupRequirements = (requirements: MeegleRequirement[]): MeegleRequirementGroup[] => {
  const groups = new Map<string, MeegleRequirementGroup>()

  for (const requirement of requirements) {
    const key =
      requirement.iterationId ??
      (requirement.iterationName ? `name:${requirement.iterationName}` : 'unplanned')
    const existing = groups.get(key)

    if (existing) {
      existing.requirements.push(requirement)
      continue
    }

    groups.set(key, {
      key,
      iterationId: requirement.iterationId,
      iterationName: requirement.iterationName ?? '未规划迭代',
      releaseDate: requirement.iterationDate,
      requirements: [requirement]
    })
  }

  for (const group of groups.values()) {
    group.requirements.sort((left, right) =>
      (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
    )
  }

  return Array.from(groups.values()).sort((left, right) => {
    // 未规划需求固定排在最后。
    if (!left.releaseDate && !right.releaseDate) {
      return right.iterationName.localeCompare(left.iterationName, 'zh-CN')
    }

    if (!left.releaseDate) return 1
    if (!right.releaseDate) return -1

    const dateCompare = right.releaseDate.localeCompare(left.releaseDate)

    return dateCompare !== 0
      ? dateCompare
      : right.iterationName.localeCompare(left.iterationName, 'zh-CN')
  })
}

/**
 * 将节点时间统一为 ISO 字符串。
 */
const normalizeTime = (value: number | string | null | undefined): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  if (typeof value === 'string' && value.trim()) {
    const timestamp = Date.parse(value)

    return Number.isNaN(timestamp) ? value : new Date(timestamp).toISOString()
  }

  return null
}

/**
 * 判断节点必填项是否仍未填写。
 */
const isFormValueEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  (typeof value === 'string' && (value === '{}' || value === '[]'))

/**
 * 通过 user_key 批量解析用户信息。
 */
const resolveUsers = async (
  project: MeegleProject,
  userKeys: string[]
): Promise<Map<string, MeegleRequirementOwner>> => {
  const result = new Map<string, MeegleRequirementOwner>()
  const missing: string[] = []

  for (const key of new Set(userKeys.filter(Boolean))) {
    const cached = userCache.get(key)

    if (cached) {
      result.set(key, cached)
    } else {
      missing.push(key)
    }
  }

  for (const batch of chunk(missing, 20)) {
    const args = ['user', 'search', '--project-key', project.key, '--format', 'json']

    for (const key of batch) {
      args.push('--user-keys', key)
    }

    const command = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)
    const users = parseCommandJson<UserSearchUser[]>(command, '读取用户信息')

    for (const user of users) {
      const key = user.user_key?.trim()

      if (!key) continue

      const owner: MeegleRequirementOwner = {
        name: user.name_cn?.trim() || user.name_en?.trim() || user.email?.trim() || '未知成员',
        email: user.email?.trim() || null
      }

      userCache.set(key, owner)
      result.set(key, owner)
    }
  }

  for (const key of userKeys) {
    if (!result.has(key)) {
      result.set(key, { name: '未知成员', email: null })
    }
  }

  return result
}

/**
 * 按节点前后关系做拓扑排序，保证流程展示顺序稳定。
 */
const orderWorkflowNodes = (nodes: MeegleWorkflowNode[]): MeegleWorkflowNode[] => {
  const nodeMap = new Map(nodes.map((node) => [node.key, node]))
  const incoming = new Set(nodes.flatMap((node) => node.nextNodeKeys))
  const queue = nodes.filter((node) => !incoming.has(node.key))
  const ordered: MeegleWorkflowNode[] = []
  const visited = new Set<string>()

  while (queue.length > 0) {
    const node = queue.shift()

    if (!node || visited.has(node.key)) continue

    visited.add(node.key)
    ordered.push(node)

    for (const nextKey of node.nextNodeKeys) {
      const nextNode = nodeMap.get(nextKey)

      if (nextNode && !visited.has(nextKey)) queue.push(nextNode)
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.key)) ordered.push(node)
  }

  return ordered
}

/**
 * 读取需求流程节点。
 */
const fetchWorkflowNodes = async (
  project: MeegleProject,
  workItemId: string
): Promise<MeegleWorkflowNode[]> => {
  const rawNodes: WorkflowRawNode[] = []
  let page = 1
  let hasMore = false

  do {
    const result = await runMeegle(
      [
        'workflow',
        'get-node',
        '--project-key',
        project.key,
        '--work-item-id',
        workItemId,
        '--node-id-list',
        '_all',
        '--field-key-list',
        '_all',
        '--page-num',
        String(page),
        '--format',
        'json'
      ],
      MEEGLE_QUERY_TIMEOUT_MS
    )
    const response = parseCommandJson<WorkflowNodeResponse>(result, '读取流程节点')

    rawNodes.push(...(response.list ?? []))
    hasMore = response.pagination?.has_more === true
    page += 1
  } while (hasMore && page <= 10)

  const userKeys = rawNodes.flatMap((node) =>
    (node.assignees?.owners ?? []).map((owner) => owner.user_key ?? '')
  )
  const users = await resolveUsers(project, userKeys)

  const nodes = rawNodes.map((node): MeegleWorkflowNode => {
    const basic = node.basic ?? {}
    const schedule = node.schedule ?? {}

    return {
      key: basic.node_key ?? '',
      name: basic.name ?? '未命名节点',
      status: basic.status ?? 'not_started',
      owners: (node.assignees?.owners ?? []).map(
        (owner) => users.get(owner.user_key ?? '') ?? { name: '未知成员', email: null }
      ),
      scheduleStart: normalizeTime(schedule.estimate_start_time),
      scheduleEnd: normalizeTime(schedule.estimate_finish_time),
      points: typeof schedule.points === 'number' ? schedule.points : null,
      requiredFields: (node.form_items ?? [])
        .filter((item) => item.is_required && isFormValueEmpty(item.value))
        .map((item) => item.field_name?.trim() || '未命名必填项'),
      nextNodeKeys: basic.next_node_keys ?? []
    }
  })

  return orderWorkflowNodes(nodes.filter((node) => node.key))
}

/**
 * 读取需求评论。
 */
const fetchComments = async (
  project: MeegleProject,
  workItemId: string
): Promise<{ comments: MeegleRequirementComment[]; total: number }> => {
  const result = await runMeegle(
    ['comment', 'list', '--project-key', project.key, '--work-item-id', workItemId, '--format', 'json'],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<CommentListResponse>(result, '读取需求评论')
  const rawComments = response.comments ?? []
  const users = await resolveUsers(
    project,
    rawComments.map((comment) => comment.creator ?? '')
  )

  return {
    comments: rawComments.map((comment) => ({
      id: comment.comment_id ?? '',
      content: comment.content ?? '',
      createdAt: comment.created_at?.trim() || null,
      creator: users.get(comment.creator ?? '') ?? null
    })),
    total: response.pagination?.total ?? rawComments.length
  }
}

/**
 * 读取需求流程和评论。
 */
export const getRequirementActivity = async (
  workItemId: string
): Promise<MeegleRequirementActivity> => {
  if (!/^\d+$/.test(workItemId)) {
    throw new Error('需求 ID 不合法')
  }

  const project = await getProject()
  const [nodes, commentData] = await Promise.all([
    fetchWorkflowNodes(project, workItemId),
    fetchComments(project, workItemId)
  ])

  return {
    nodes,
    comments: commentData.comments,
    commentsTotal: commentData.total,
    fetchedAt: new Date().toISOString()
  }
}

/**
 * 添加需求评论。
 */
export const addRequirementComment = async (
  workItemId: string,
  content: string
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('需求 ID 不合法')

  const normalizedContent = content.trim()

  if (!normalizedContent) throw new Error('评论内容不能为空')

  const project = await getProject()
  const result = await runMeegle(
    [
      'comment',
      'add',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId,
      '--content',
      normalizedContent,
      '--action',
      'create',
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )

  ensureWriteSuccess(result, '发表评论')
}

/**
 * 完成或回滚流程节点。
 */
export const transitionRequirementNode = async (
  workItemId: string,
  nodeId: string,
  action: 'confirm' | 'rollback',
  rollbackReason?: string
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('需求 ID 不合法')
  if (!nodeId.trim()) throw new Error('节点 ID 不合法')

  const project = await getProject()
  const args = [
    'workflow',
    'transition',
    '--project-key',
    project.key,
    '--work-item-id',
    workItemId,
    '--node-id',
    nodeId,
    '--action',
    action,
    '--format',
    'json'
  ]

  if (action === 'rollback') {
    args.push('--rollback-reason', rollbackReason?.trim() || '从研发工作台回滚')
  }

  const result = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)
  ensureWriteSuccess(result, action === 'confirm' ? '完成节点' : '回滚节点')
}

/**
 * 更新节点排期和估分。
 */
export const updateRequirementNodeSchedule = async (
  workItemId: string,
  nodeId: string,
  input: UpdateNodeScheduleInput
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('需求 ID 不合法')
  if (!nodeId.trim()) throw new Error('节点 ID 不合法')
  if (!Number.isFinite(input.startAt) || !Number.isFinite(input.endAt)) {
    throw new Error('排期时间不合法')
  }
  if (input.endAt < input.startAt) throw new Error('结束时间不能早于开始时间')

  const project = await getProject()
  const nodeSchedule: Record<string, number> = {
    estimate_start_time: input.startAt,
    estimate_finish_time: input.endAt
  }

  if (typeof input.points === 'number' && Number.isFinite(input.points)) {
    nodeSchedule.points = input.points
  }

  const result = await runMeegle(
    [
      'workflow',
      'update-node',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId,
      '--node-id',
      nodeId,
      '--node-schedule',
      JSON.stringify(nodeSchedule),
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )

  ensureWriteSuccess(result, '更新节点排期')
}

/**
 * 读取当前用户的全部待办需求，并按迭代分组。
 */
export const getMyRequirements = async (): Promise<MeegleMyRequirements> => {
  const project = await getProject()
  const requirementIds = await fetchMyWorkRequirementIds(project)
  const requirements =
    requirementIds.length > 0 ? await fetchRequirementsByIds(project, requirementIds) : []

  return {
    project,
    groups: groupRequirements(requirements),
    total: requirements.length,
    fetchedAt: new Date().toISOString()
  }
}

/**
 * 注册需求工作台 IPC。
 */
export const initializeRequirements = (): void => {
  ipcMain.handle('requirements:get-my', () => getMyRequirements())
  ipcMain.handle('requirements:get-activity', (_event, workItemId: unknown) => {
    if (typeof workItemId !== 'string') throw new Error('需求 ID 不合法')

    return getRequirementActivity(workItemId)
  })
  ipcMain.handle(
    'requirements:add-comment',
    (_event, workItemId: unknown, content: unknown) => {
      if (typeof workItemId !== 'string' || typeof content !== 'string') {
        throw new Error('评论参数不合法')
      }

      return addRequirementComment(workItemId, content)
    }
  )
  ipcMain.handle(
    'requirements:transition-node',
    (_event, workItemId: unknown, nodeId: unknown, action: unknown) => {
      if (
        typeof workItemId !== 'string' ||
        typeof nodeId !== 'string' ||
        (action !== 'confirm' && action !== 'rollback')
      ) {
        throw new Error('节点操作参数不合法')
      }

      return transitionRequirementNode(workItemId, nodeId, action)
    }
  )
  ipcMain.handle(
    'requirements:update-node-schedule',
    (_event, workItemId: unknown, nodeId: unknown, input: unknown) => {
      if (typeof workItemId !== 'string' || typeof nodeId !== 'string' || !input) {
        throw new Error('排期参数不合法')
      }

      return updateRequirementNodeSchedule(
        workItemId,
        nodeId,
        input as UpdateNodeScheduleInput
      )
    }
  )
}
