/**
 * Meegle 需求工作台数据模块。
 * 读取当前登录用户负责的未结束需求，并按所属迭代分组后注册 IPC。
 */
import { ipcMain } from 'electron'
import {
  listLocalRequirements,
  searchLocalRequirements,
  toMeegleRequirement
} from './local-requirements'
import { runMeegle } from './meegle'
import { getPreferences, updatePreferences } from './preferences'
import type {
  IterationSummaryRequirement,
  MeegleMyRequirements,
  MeegleNodeFormItem,
  MeegleProject,
  MeegleRequirement,
  MeegleRequirementActivity,
  MeegleRequirementCollaborator,
  MeegleRequirementComment,
  MeegleRequirementGroup,
  MeegleRequirementIteration,
  MeegleRequirementOwner,
  MeegleWorkflowNode,
  UpdateNodeInfoInput
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
  pagination?: {
    has_more?: boolean
    page_num?: number
    total?: number
  }
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
    user_key?: string
    name_cn?: string
    name_en?: string
    email?: string
  }
  user_value_list?: Array<{
    user_key?: string
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
  list?: Array<{
    count?: number
    group_infos?: Array<{
      group_id?: string
    }>
  }> | null
  session_id?: string
  error?: CliError
}

/** 工作项角色配置。 */
interface RoleMetaResponse {
  list?: Array<{
    role_name?: string
  }> | null
  error?: CliError
}

interface StatusMetaResponse {
  list?: Array<{
    field_name?: string
    option?: Array<{
      option_name?: string
    }> | null
  }> | null
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
    actual_begin_time?: number | string | null
    actual_finish_time?: number | string | null
    actual_work_time?: number | null
    points?: number | null
  }
  form_items?: Array<{
    field_key?: string
    field_name?: string
    field_type?: string
    form_item_type?: string
    is_required?: boolean
    value?: unknown
    value_label?: string
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
  avatar_url?: string
}

interface TeamListResponse {
  data?: Array<{
    team_id?: string
    team_name?: string
    parent_team_ids?: string[]
    status?: string
  }> | null
  error?: CliError
}

interface TeamMemberResponse {
  members?: string[] | null
  error?: CliError
}

/** 需求查询可能比登录状态查询慢，使用更宽松的超时时间。 */
const MEEGLE_QUERY_TIMEOUT_MS = 30_000

/** Meegle 空间信息缓存时长，避免每次刷新都重复查询。 */
const PROJECT_CACHE_TTL_MS = 5 * 60 * 1000

/** 空间团队列表缓存时长。 */
const TEAM_CACHE_TTL_MS = 10 * 60 * 1000

/** MQL 单页固定 50 条，最多读取 200 页，避免异常分页导致死循环。 */
const MQL_PAGE_SIZE = 50
const MAX_MQL_PAGES = 200

/** 最近访问的 Meegle 空间缓存。 */
let cachedProject: { value: MeegleProject; expiresAt: number } | null = null

/** 工作项角色配置缓存，按空间隔离。 */
const roleCache = new Map<string, string[]>()

/** 需求状态配置缓存，按空间隔离。 */
const statusCache = new Map<string, string[]>()

/** 用户信息缓存，避免节点和评论反复解析同一批 user_key。 */
const userCache = new Map<string, MeegleRequirementOwner>()

/** 按邮箱缓存用户信息，用于补齐 MQL 人员字段的头像。 */
const emailUserCache = new Map<string, MeegleRequirementOwner>()

/** 空间根团队缓存，用于模糊搜索成员。 */
let cachedRootTeams: {
  projectKey: string
  expiresAt: number
  teamIds: string[]
} | null = null

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

const toMeegleProject = (
  project: { name?: string; project_key?: string; simple_name?: string } | undefined
): MeegleProject | null => {
  const name = project?.name?.trim()
  const projectKey = project?.project_key?.trim()
  const key = project?.simple_name?.trim() || projectKey

  if (!name || !key || !projectKey) return null

  return { key, projectKey, name }
}

const clearProjectScopedCaches = (): void => {
  cachedProject = null
  roleCache.clear()
  statusCache.clear()
  cachedRootTeams = null
}

/**
 * 读取用户可访问的 Meegle 空间。
 */
export const listMeegleProjects = async (): Promise<MeegleProject[]> => {
  const projects = new Map<string, MeegleProject>()
  let page = 1

  while (page <= 20) {
    const result = await runMeegle(
      [
        'project',
        'search',
        '--page-num',
        String(page),
        '--format',
        'json'
      ],
      MEEGLE_QUERY_TIMEOUT_MS
    )
    const response = parseCommandJson<ProjectSearchResponse>(result, '读取 Meegle 空间')

    for (const project of response.projects ?? []) {
      const normalized = toMeegleProject(project)

      if (normalized) projects.set(normalized.projectKey, normalized)
    }

    if (!response.pagination?.has_more) break

    page += 1
  }

  return Array.from(projects.values())
}

/**
 * 切换 Meegle 空间。
 * 手动选择的空间持久化在偏好中，并清空该空间相关的角色/团队缓存。
 */
export const setMeegleProject = async (projectKey: string): Promise<MeegleProject> => {
  const normalizedKey = projectKey.trim()

  if (!normalizedKey) throw new Error('空间 key 不合法')

  const result = await runMeegle(
    [
      'project',
      'search',
      '--project-key',
      normalizedKey,
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<ProjectSearchResponse>(result, '切换 Meegle 空间')
  const project = toMeegleProject(response.projects?.[0])

  if (!project) throw new Error('没有找到可用的 Meegle 空间')

  updatePreferences({ meegleProjectKey: project.projectKey })
  clearProjectScopedCaches()
  cachedProject = {
    value: project,
    expiresAt: Date.now() + PROJECT_CACHE_TTL_MS
  }

  return project
}

/**
 * 获取当前选中的 Meegle 空间。
 * 未手动选择时继续使用最近访问的空间。
 */
export const getProject = async (): Promise<MeegleProject> => {
  if (cachedProject && cachedProject.expiresAt > Date.now()) {
    return cachedProject.value
  }

  const selectedProjectKey = getPreferences().meegleProjectKey
  const result = await runMeegle(
    selectedProjectKey
      ? [
          'project',
          'search',
          '--project-key',
          selectedProjectKey,
          '--format',
          'json'
        ]
      : ['project', 'search', '--format', 'json'],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<ProjectSearchResponse>(result, '读取 Meegle 空间')
  const value = toMeegleProject(response.projects?.[0])

  if (!value) {
    throw new Error(
      selectedProjectKey ? '当前选择的 Meegle 空间不可用' : '没有找到可用的 Meegle 空间'
    )
  }

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
      name: user.name_cn?.trim() || user.name_en?.trim() || user.email?.trim() || '',
      email: user.email?.trim() || null,
      avatarUrl: null,
      userKey: user.user_key?.trim() || null
    }))
    .filter((user) => Boolean(user.name))
}

/**
 * 读取单个用户字段。
 */
const readUserFromValue = (value: MoqlValue | null | undefined): MeegleRequirementOwner | null => {
  const user = value?.user_value

  if (!user) return null

  const name = user.name_cn?.trim() || user.name_en?.trim() || user.email?.trim()

  return name
    ? {
        name,
        email: user.email?.trim() || null,
        avatarUrl: null,
        userKey: user.user_key?.trim() || null
      }
    : null
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
  productOwners: MeegleRequirementOwner[]
): MeegleRequirementCollaborator[] => {
  const collaborators: MeegleRequirementCollaborator[] = [
    { role: '产品经理', members: productManagers },
    { role: '产品负责人', members: productOwners },
    { role: '研发负责人', members: readRoleMembers(row, '__研发负责人') },
    { role: '前端负责人', members: readRoleMembers(row, '__前端负责人') },
    { role: '前端开发', members: readRoleMembers(row, '__前端开发') },
    { role: '前端APP负责人', members: readRoleMembers(row, '__前端APP负责人') },
    { role: '前端APP开发', members: readRoleMembers(row, '__前端APP开发') },
    { role: '后端负责人', members: readRoleMembers(row, '__后端负责人') },
    { role: '后端开发', members: readRoleMembers(row, '__后端开发') },
    { role: '数仓开发', members: readRoleMembers(row, '__数仓开发') },
    { role: '测试', members: readRoleMembers(row, '__QA') },
    { role: '测试负责人', members: readRoleMembers(row, '__QA负责人') },
    { role: '测试owner', members: readRoleMembers(row, '__测试owner') },
    { role: '测试组长', members: readRoleMembers(row, '__测试组长') },
    { role: '性能测试负责人', members: readRoleMembers(row, '__性能测试负责人') },
    { role: 'UI/UX', members: readRoleMembers(row, '__UI&UX') },
    { role: 'PMO', members: readRoleMembers(row, '__PMO项目经理') },
    { role: '技术专家', members: readRoleMembers(row, '__技术专家') },
    { role: '研发总监', members: readRoleMembers(row, '__研发总监') }
  ]

  return collaborators.filter((collaborator) => collaborator.members.length > 0)
}

/**
 * 读取需求关联的全部规划迭代。
 * 规划迭代是多选关联字段；同一迭代按 ID 或名称去重。
 */
const readIterations = (
  fields: Map<string, MoqlValue | null>
): MeegleRequirementIteration[] => {
  const values = fields.get('planning_sprint')?.key_label_value_list ?? []
  const iterations = new Map<string, MeegleRequirementIteration>()

  for (const value of values) {
    const name = value.label?.trim()

    if (!name) continue

    const id = value.key?.trim() || null
    const key = id ?? `name:${name}`

    if (iterations.has(key)) continue

    iterations.set(key, {
      id,
      name,
      date: parseReleaseDate(name)
    })
  }

  return Array.from(iterations.values())
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
 * 读取需求工作项的角色配置。
 */
const fetchStoryRoleNames = async (project: MeegleProject): Promise<string[]> => {
  const cached = roleCache.get(project.projectKey)

  if (cached) return cached

  const result = await runMeegle(
    [
      'workitem',
      'meta-roles',
      '--project-key',
      project.key,
      '--work-item-type',
      'story',
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<RoleMetaResponse>(result, '读取需求角色配置')
  const names = Array.from(
    new Set(
      (response.list ?? [])
        .map((role) => role.role_name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  )

  roleCache.set(project.projectKey, names)

  return names
}

/**
 * 构造“当前用户参与任意角色”的 MQL 条件。
 */
const buildCurrentUserRoleCondition = (roleNames: string[]): string =>
  roleNames
    .map((role) => `\`__${role.replace(/`/g, '')}\` = current_login_user()`)
    .join(' OR ')

/** 读取当前空间真实存在的需求状态名称。 */
const fetchStoryStatusNames = async (project: MeegleProject): Promise<string[]> => {
  const cached = statusCache.get(project.projectKey)

  if (cached) return cached

  const result = await runMeegle(
    [
      'workitem',
      'meta-fields',
      '--project-key',
      project.key,
      '--work-item-type',
      'story',
      '--field-query',
      '状态',
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<StatusMetaResponse>(result, '读取需求状态配置')
  const statusField =
    (response.list ?? []).find((field) => field.field_name?.trim() === '状态') ??
    response.list?.[0]
  const names = Array.from(
    new Set(
      (statusField?.option ?? [])
        .map((option) => option.option_name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  )

  statusCache.set(project.projectKey, names)

  return names
}

/**
 * 执行 MQL 查询并读取全部分页。
 */
const fetchMqlRows = async (
  project: MeegleProject,
  mql: string,
  singlePage = false
): Promise<MoqlRow[]> => {
  const result = await runMeegle(
    ['workitem', 'query', '--project-key', project.key, '--mql', mql, '--format', 'json'],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<MoqlResponse>(result, '读取需求列表')
  const rows = [...getRows(response)]

  if (singlePage) return rows

  const total = response.list?.[0]?.count ?? rows.length

  if (rows.length >= total) return rows

  const sessionId = response.session_id

  if (!sessionId) {
    throw new Error(`需求列表未完整加载：已读取 ${rows.length}/${total} 条`)
  }

  const groupId = response.list?.[0]?.group_infos?.[0]?.group_id ?? '1'
  const pageSize = rows.length || MQL_PAGE_SIZE
  const totalPages = Math.ceil(total / pageSize)

  if (totalPages > MAX_MQL_PAGES) {
    throw new Error(
      `需求数量超过 ${MAX_MQL_PAGES * pageSize} 条，暂时无法全部加载`
    )
  }

  for (let page = 2; page <= totalPages; page += 1) {
    const pageResult = await runMeegle(
      [
        'workitem',
        'query',
        '--project-key',
        project.key,
        '--session-id',
        sessionId,
        '--group-pagination-list',
        JSON.stringify({ group_id: groupId, page_num: page }),
        '--format',
        'json'
      ],
      MEEGLE_QUERY_TIMEOUT_MS
    )
    const pageResponse = parseCommandJson<MoqlResponse>(pageResult, '读取需求列表')

    rows.push(...getRows(pageResponse))

    if (rows.length >= total) break
  }

  if (rows.length < total) {
    throw new Error(`需求列表未完整加载：已读取 ${rows.length}/${total} 条`)
  }

  return rows
}

/**
 * 将 MQL 工作项行转换为需求对象。
 */
const parseRequirement = (row: MoqlRow): MeegleRequirement | null => {
  const fields = toFieldMap(row)
  const id = readString(fields, 'work_item_id')
  const name = readString(fields, 'name')

  if (!id || !name) return null

  const iterations = readIterations(fields)
  const iteration = iterations[0] ?? { id: null, name: null, date: null }
  const owners = readUsers(fields, 'current_status_operator')
  const productManagers = readProductManagers(row)
  const productOwners = readProductOwners(row)
  const documentUrl = readString(fields, 'wiki')?.trim() || null
  const description = readString(fields, 'description')?.trim() || null

  return {
    source: 'meegle',
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
    collaborators: readCollaborators(row, productManagers, productOwners),
    requirementLevel: readFieldString(row, '需求等级'),
    requirementNature: readFieldString(row, '需求性质'),
    complexity: readFieldNumber(row, '需求复杂度'),
    developmentDifficulty: readFieldNumber(row, '研发难度估分'),
    difficultyEstimation: {
      frontendApp: readFieldNumber(row, '难度估分-前端app'),
      frontendPc: readFieldNumber(row, '难度估分-前端PC'),
      backend: readFieldNumber(row, '难度估分-后端')
    },
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
    iterationDate: iteration.date,
    iterations,
    updatedAt: readString(fields, 'updated_at')
  }
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
 * 将 user search 结果转换为统一的负责人结构。
 */
const toOwner = (user: UserSearchUser): MeegleRequirementOwner | null => {
  const name = user.name_cn?.trim() || user.name_en?.trim() || user.email?.trim()

  if (!name) return null

  return {
    name,
    email: user.email?.trim() || null,
    avatarUrl: user.avatar_url?.trim() || null,
    userKey: user.user_key?.trim() || null
  }
}

/**
 * 通过邮箱批量解析用户信息并补齐头像。
 */
export const resolveUsersByEmails = async (
  project: MeegleProject,
  emails: string[]
): Promise<Map<string, MeegleRequirementOwner>> => {
  const result = new Map<string, MeegleRequirementOwner>()
  const missing: string[] = []

  for (const email of new Set(emails.filter(Boolean))) {
    const cached = emailUserCache.get(email)

    if (cached) {
      result.set(email, cached)
    } else {
      missing.push(email)
    }
  }

  for (const batch of chunk(missing, 20)) {
    const args = ['user', 'search', '--project-key', project.key, '--format', 'json']

    for (const email of batch) {
      args.push('--user-keys', email)
    }

    const command = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)
    const users = parseCommandJson<UserSearchUser[]>(command, '读取用户头像')

    for (const user of users) {
      const owner = toOwner(user)
      const email = user.email?.trim()
      const key = user.user_key?.trim()

      if (!owner) continue

      if (key) userCache.set(key, owner)
      if (email) {
        emailUserCache.set(email, owner)
        result.set(email, owner)
      }
    }
  }

  return result
}

/**
 * 为 MQL 中的人员字段补齐真实头像。
 */
const enrichRequirementAvatars = async (
  project: MeegleProject,
  requirements: MeegleRequirement[]
): Promise<void> => {
  const emails = requirements.flatMap((requirement) => [
    requirement.createdBy?.email ?? '',
    ...requirement.productManagers.map((owner) => owner.email ?? ''),
    ...requirement.productOwners.map((owner) => owner.email ?? ''),
    ...requirement.owners.map((owner) => owner.email ?? ''),
    ...requirement.collaborators.flatMap((collaborator) =>
      collaborator.members.map((owner) => owner.email ?? '')
    )
  ])
  const users = await resolveUsersByEmails(project, emails)

  const applyAvatar = (owner: MeegleRequirementOwner): MeegleRequirementOwner => {
    const resolved = owner.email ? users.get(owner.email) : null

    return resolved
      ? {
          ...owner,
          avatarUrl: resolved.avatarUrl,
          userKey: resolved.userKey
        }
      : owner
  }

  for (const requirement of requirements) {
    if (requirement.createdBy) {
      requirement.createdBy = applyAvatar(requirement.createdBy)
    }
    requirement.productManagers = requirement.productManagers.map(applyAvatar)
    requirement.productOwners = requirement.productOwners.map(applyAvatar)
    requirement.owners = requirement.owners.map(applyAvatar)
    requirement.collaborators = requirement.collaborators.map((collaborator) => ({
      ...collaborator,
      members: collaborator.members.map(applyAvatar)
    }))
  }
}

/**
 * 通过 user_key 批量解析用户信息。
 */
export const resolveUsers = async (
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

    try {
      const command = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)
      const users = parseCommandJson<UserSearchUser[]>(command, '读取用户信息')

      for (const user of users) {
        const key = user.user_key?.trim()

        if (!key) continue

        const owner = toOwner(user)

        if (!owner) continue

        userCache.set(key, owner)
        result.set(key, owner)
      }
    } catch {
      // 人员信息属于增强数据，查询失败时保留节点和评论主体。
    }
  }

  return result
}

const fetchRootTeamIds = async (project: MeegleProject): Promise<string[]> => {
  if (
    cachedRootTeams &&
    cachedRootTeams.projectKey === project.projectKey &&
    cachedRootTeams.expiresAt > Date.now()
  ) {
    return cachedRootTeams.teamIds
  }

  const result = await runMeegle(
    ['team', 'list', '--project-key', project.key, '--format', 'json'],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<TeamListResponse>(result, '读取空间团队')
  const teams = response.data ?? []
  const rootTeams = teams.filter(
    (team) =>
      team.team_id &&
      team.status !== 'Disabled' &&
      (team.parent_team_ids?.length ?? 0) === 0
  )
  const teamIds = Array.from(
    new Set(
      (rootTeams.length > 0 ? rootTeams : teams)
        .map((team) => team.team_id)
        .filter((teamId): teamId is string => Boolean(teamId))
    )
  )

  cachedRootTeams = {
    projectKey: project.projectKey,
    expiresAt: Date.now() + TEAM_CACHE_TTL_MS,
    teamIds
  }

  return teamIds
}

const searchTeamMemberKeys = async (
  project: MeegleProject,
  query: string
): Promise<string[]> => {
  const teamIds = await fetchRootTeamIds(project)
  const results = await Promise.allSettled(
    teamIds.map(async (teamId) => {
      const result = await runMeegle(
        [
          'team',
          'list-members',
          '--project-key',
          project.key,
          '--team-id',
          teamId,
          '--include-sub-teams',
          '--query',
          query,
          '--format',
          'json'
        ],
        MEEGLE_QUERY_TIMEOUT_MS
      )
      const response = parseCommandJson<TeamMemberResponse>(
        result,
        '搜索团队成员'
      )

      return response.members ?? []
    })
  )
  const keys = new Set<string>()
  let firstError: unknown = null

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const key of result.value) {
        if (key) keys.add(key)
      }
    } else if (firstError === null) {
      firstError = result.reason
    }
  }

  if (teamIds.length > 0 && results.every((result) => result.status === 'rejected')) {
    throw firstError
  }

  return Array.from(keys)
}

const searchExactUsers = async (
  project: MeegleProject,
  query: string
): Promise<MeegleRequirementOwner[]> => {
  const result = await runMeegle(
    [
      'user',
      'search',
      '--project-key',
      project.key,
      '--user-keys',
      query,
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const users = parseCommandJson<UserSearchUser[]>(result, '搜索用户')
  const owners = new Map<string, MeegleRequirementOwner>()

  for (const user of users) {
    const owner = toOwner(user)

    if (!owner) continue

    const key = owner.userKey ?? owner.email ?? owner.name

    owners.set(key, owner)
  }

  return Array.from(owners.values())
}

/**
 * 按姓名片段、完整姓名、邮箱或 user_key 搜索 Meegle 用户。
 */
export const searchRequirementUsers = async (
  keyword: string
): Promise<MeegleRequirementOwner[]> => {
  const query = keyword.trim()

  if (!query) return []
  if (query.length > 100) throw new Error('搜索关键词过长')

  const project = await getProject()
  const [exactResult, memberResult] = await Promise.allSettled([
    searchExactUsers(project, query),
    searchTeamMemberKeys(project, query)
  ])
  const owners = new Map<string, MeegleRequirementOwner>()
  let firstError: unknown = null

  if (exactResult.status === 'fulfilled') {
    for (const owner of exactResult.value) {
      const key = owner.userKey ?? owner.email ?? owner.name

      owners.set(key, owner)
    }
  } else {
    firstError = exactResult.reason
  }

  if (memberResult.status === 'fulfilled') {
    const resolved = await resolveUsers(project, memberResult.value)

    for (const [key, owner] of resolved) {
      if (!owners.has(key)) owners.set(key, owner)
    }
  } else if (firstError === null) {
    firstError = memberResult.reason
  }

  if (owners.size === 0 && firstError !== null) {
    throw firstError
  }

  return Array.from(owners.values())
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
 * 从 Meegle 富文本值中提取纯文本。
 */
const extractRichText = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null

  const operations = Object.values(value as Record<string, unknown>).flatMap((node) => {
    const ops = (node as { ops?: Array<{ insert?: unknown }> } | null)?.ops

    return Array.isArray(ops) ? ops : []
  })
  const text = operations
    .map((operation) => (typeof operation.insert === 'string' ? operation.insert : ''))
    .join('')
    .trim()

  return text || null
}

/**
 * 将节点表单值转换成可展示文本。
 */
const normalizeFormValue = (value: unknown, valueLabel?: string): string | null => {
  const label = valueLabel?.trim()

  if (label) return label
  if (value === null || value === undefined) return null

  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()

  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed) as { doc?: unknown }

    if (parsed && typeof parsed === 'object' && 'doc' in parsed) {
      const document = typeof parsed.doc === 'string' ? JSON.parse(parsed.doc) : parsed.doc

      return extractRichText(document)
    }
  } catch {
    // 普通字符串按原值展示。
  }

  return trimmed
}

/**
 * 解析节点表单中的业务字段。
 * 排期、估分、工时等 node_field 已经在节点摘要中展示，不重复放在表单里。
 */
const readNodeFormItems = (node: WorkflowRawNode): MeegleNodeFormItem[] =>
  (node.form_items ?? [])
    .filter((item) => item.form_item_type === 'field')
    .map((item) => ({
      key: item.field_key?.trim() || item.field_name?.trim() || '',
      name: item.field_name?.trim() || '未命名字段',
      type: item.field_type?.trim() || 'text',
      required: item.is_required === true,
      value: normalizeFormValue(item.value, item.value_label)
    }))
    .filter((item) => item.key)

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
    const nodeFieldKeys = new Set(
      (node.form_items ?? [])
        .filter((item) => item.form_item_type === 'node_field')
        .map((item) => item.field_key?.trim() || '')
        .filter(Boolean)
    )

    return {
      key: basic.node_key ?? '',
      name: basic.name ?? '未命名节点',
      status: basic.status ?? 'not_started',
      owners: (node.assignees?.owners ?? [])
        .map((owner) => users.get(owner.user_key ?? ''))
        .filter((owner): owner is MeegleRequirementOwner => Boolean(owner)),
      scheduleStart: normalizeTime(schedule.estimate_start_time),
      scheduleEnd: normalizeTime(schedule.estimate_finish_time),
      actualStart: normalizeTime(schedule.actual_begin_time),
      actualEnd: normalizeTime(schedule.actual_finish_time),
      actualWorkTime:
        typeof schedule.actual_work_time === 'number' ? schedule.actual_work_time : null,
      points: typeof schedule.points === 'number' ? schedule.points : null,
      formItems: readNodeFormItems(node),
      supportsSchedule:
        nodeFieldKeys.has('schedule') ||
        schedule.estimate_start_time != null ||
        schedule.estimate_finish_time != null,
      supportsPoints:
        nodeFieldKeys.has('point') || typeof schedule.points === 'number',
      supportsActualWorkTime:
        nodeFieldKeys.has('actual_work_time') ||
        typeof schedule.actual_work_time === 'number',
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
  content: string,
  notifyUserKeys: string[] = []
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('需求 ID 不合法')

  const normalizedContent = content.trim()

  if (!normalizedContent) throw new Error('评论内容不能为空')

  const project = await getProject()
  const args = [
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
  ]

  if (notifyUserKeys.length > 0) {
    args.push('--notify-user-type', 'user_key')

    for (const key of notifyUserKeys) {
      args.push('--notify-user-list', key)
    }
  }

  const result = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)

  ensureWriteSuccess(result, '发表评论')
}

/**
 * 更新需求描述。
 */
export const updateRequirementDescription = async (
  workItemId: string,
  content: string
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('需求 ID 不合法')

  const project = await getProject()
  const result = await runMeegle(
    [
      'workitem',
      'update',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId,
      '--fields',
      JSON.stringify([
        {
          field_key: 'description',
          field_value: content
        }
      ]),
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )

  ensureWriteSuccess(result, '更新需求描述')
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
 * 更新节点排期、估分和负责人。
 * update-node 不支持一次修改多个类别，因此拆成多次调用。
 */
export const updateRequirementNode = async (
  workItemId: string,
  nodeId: string,
  input: UpdateNodeInfoInput
): Promise<void> => {
  if (!input || typeof input !== 'object') throw new Error('节点更新参数不合法')
  if (!/^\d+$/.test(workItemId)) throw new Error('需求 ID 不合法')
  if (!nodeId.trim()) throw new Error('节点 ID 不合法')

  if (
    input.ownerUserKeys !== undefined &&
    (!Array.isArray(input.ownerUserKeys) ||
      input.ownerUserKeys.some((key) => typeof key !== 'string'))
  ) {
    throw new Error('节点负责人参数不合法')
  }

  const hasOwners = input.ownerUserKeys !== undefined
  const ownerUserKeys = hasOwners
    ? Array.from(
        new Set(
          (input.ownerUserKeys ?? [])
            .map((key) => key.trim())
            .filter(Boolean)
        )
      )
    : []
  const hasSchedule = input.startAt !== undefined || input.endAt !== undefined
  const hasPoints = input.points !== undefined
  const clearSchedule = input.clearSchedule === true

  if (input.clearSchedule !== undefined && typeof input.clearSchedule !== 'boolean') {
    throw new Error('清空排期参数不合法')
  }
  if (clearSchedule && hasSchedule) {
    throw new Error('清空排期时不能同时设置起止时间')
  }
  if (hasPoints && (typeof input.points !== 'number' || !Number.isFinite(input.points) || input.points < 0)) {
    throw new Error('估分必须为非负有限数值')
  }

  if (hasSchedule) {
    if (!Number.isFinite(input.startAt) || !Number.isFinite(input.endAt)) {
      throw new Error('排期时间不合法')
    }
    if ((input.endAt as number) < (input.startAt as number)) {
      throw new Error('结束时间不能早于开始时间')
    }
  }

  if (!hasSchedule && !clearSchedule && !hasPoints && !hasOwners) {
    throw new Error('没有需要更新的节点信息')
  }

  const project = await getProject()

  // 估分与总排期共享 node-schedule，但只发送本次修改的字段。
  if (hasSchedule || clearSchedule || hasPoints) {
    const nodeSchedule: Record<string, number | boolean> = {}

    if (clearSchedule) nodeSchedule.clear_schedule = true
    if (hasSchedule) {
      nodeSchedule.estimate_start_date = input.startAt as number
      nodeSchedule.estimate_end_date = input.endAt as number
    }

    if (typeof input.points === 'number' && Number.isFinite(input.points)) {
      nodeSchedule.points = input.points
    }

    const scheduleResult = await runMeegle(
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

    ensureWriteSuccess(scheduleResult, '更新节点排期和估分')
  }

  if (hasOwners) {
    const ownerArgs = [
      'workflow',
      'update-node',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId,
      '--node-id',
      nodeId,
      '--node-owners',
      ...(ownerUserKeys.length > 0 ? ownerUserKeys : ['']),
      '--format',
      'json'
    ]
    const ownerResult = await runMeegle(ownerArgs, MEEGLE_QUERY_TIMEOUT_MS)

    ensureWriteSuccess(ownerResult, '更新节点负责人')
  }

}

/** 需求终态，默认不进入待办列表。 */
const REQUIREMENT_CLOSED_STATUSES = [
  '结束',
  '上线完成',
  '已终止',
  '已完成',
  '已关闭',
  '已取消'
]

const buildRequirementClosedCondition = (statusNames: string[]): string => {
  const closedStatuses = statusNames.filter((status) =>
    REQUIREMENT_CLOSED_STATUSES.includes(status)
  )

  if (closedStatuses.length === 0) return ''

  return `\`状态\` not in (${closedStatuses
    .map((status) => `'${status.replace(/'/g, "''")}'`)
    .join(', ')})`
}

/** 关键词搜索使用的需求字段。 */
const REQUIREMENT_SEARCH_FIELDS =
  '`工作项id`, `名称`, `状态`, `优先级`, `规划迭代`, `当前节点负责人`, `更新时间`, `需求类型`, `需求描述`, `需求文档`, `创建人`, `产品线`, `需求等级`, `需求性质`, `研发难度估分`, `难度估分-前端app`, `难度估分-前端PC`, `难度估分-后端`, `标签`, risk_label()'

/** 生成名称/ID 的 MQL 搜索条件。 */
const buildRequirementSearchCondition = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('搜索关键词不合法')

  const keyword = value.trim().replace(/[\\%_]/g, '').slice(0, 80)

  if (!keyword) return ''

  const escaped = keyword.replace(/'/g, "''")
  const idCondition = /^\d+$/.test(keyword) ? ` OR \`工作项id\` = ${keyword}` : ''

  return `(\`名称\` LIKE '%${escaped}%'${idCondition})`
}

/** 在当前空间内按关键词搜索全部需求。 */
export const searchRequirements = async (query: string): Promise<MeegleMyRequirements> => {
  const project = await getProject()
  const condition = buildRequirementSearchCondition(query)
  const remoteRequirements = condition
    ? (
        await fetchMqlRows(
          project,
          [
            `SELECT ${REQUIREMENT_SEARCH_FIELDS}`,
            `FROM ${quoteMqlIdentifier(project.name)}.\`研发需求\``,
            `WHERE ${condition}`,
            'ORDER BY `更新时间` DESC',
            'LIMIT 20'
          ].join(' '),
          true
        )
      )
        .map(parseRequirement)
        .filter((requirement): requirement is MeegleRequirement => requirement !== null)
    : []
  const localRequirements = condition
    ? (await searchLocalRequirements(project.projectKey, query)).map(
        toMeegleRequirement
      )
    : []
  const requirements = [...remoteRequirements, ...localRequirements]

  try {
    await enrichRequirementAvatars(project, requirements)
  } catch {
    // 头像不是核心数据，补齐失败时继续展示搜索结果。
  }

  return {
    project,
    groups: groupRequirements(requirements),
    total: requirements.length,
    fetchedAt: new Date().toISOString()
  }
}

/**
 * 读取当前用户通过任意角色参与的需求，并按迭代分组。
 * includeClosed 为 false 时只返回未结束需求。
 */
export const getMyRequirements = async (
  includeClosed = false
): Promise<MeegleMyRequirements> => {
  const project = await getProject()
  const [roleNames, statusNames, localRequirements] = await Promise.all([
    fetchStoryRoleNames(project),
    // 隐藏终态依赖真实状态配置，读取失败必须报错，不能降级成不带过滤的全量查询。
    // 显示全部状态时无需读取该配置。
    includeClosed ? Promise.resolve<string[]>([]) : fetchStoryStatusNames(project),
    listLocalRequirements(project.projectKey, includeClosed)
  ])
  const roleCondition = buildCurrentUserRoleCondition(roleNames)
  const closedCondition = buildRequirementClosedCondition(statusNames)
  const remoteRequirements =
    roleNames.length > 0
      ? (
          await fetchMqlRows(
            project,
            [
              'SELECT `工作项id`, `名称`, `状态`, `优先级`, `规划迭代`, `当前节点负责人`, `更新时间`, `需求类型`, `需求描述`, `需求文档`, `创建人`, `提出时间`, `预计上线时间`, `完成日期`, `规划版本`, `实际上车版本`, `产品线`, `需求等级`, `需求性质`, `需求复杂度`, `研发难度估分`, `难度估分-前端app`, `难度估分-前端PC`, `难度估分-后端`, `预估开发量`, `技术方案`, `应用`, `标签`, `是否涉及权限`, `是否涉及历史数据`, `是否涉及性能测试`, `备注`, risk_label(), `__产品经理`, `__产品负责人`, `__研发负责人`, `__前端负责人`, `__前端开发`, `__前端APP负责人`, `__前端APP开发`, `__后端负责人`, `__后端开发`, `__数仓开发`, `__QA`, `__QA负责人`, `__测试owner`, `__测试组长`, `__性能测试负责人`, `__UI&UX`, `__PMO项目经理`, `__技术专家`, `__研发总监`',
              `FROM ${quoteMqlIdentifier(project.name)}.\`研发需求\``,
              `WHERE (${roleCondition})${
                includeClosed || !closedCondition
                  ? ''
                  : ` AND ${closedCondition}`
              }`,
              'ORDER BY `更新时间` DESC'
            ].join(' ')
          )
        )
          .map(parseRequirement)
          .filter((requirement): requirement is MeegleRequirement => requirement !== null)
      : []
  const requirements = [
    ...remoteRequirements,
    ...localRequirements.map(toMeegleRequirement)
  ]

  try {
    await enrichRequirementAvatars(project, requirements)
  } catch {
    // 头像不是核心数据，补齐失败时继续展示需求。
  }

  return {
    project,
    groups: groupRequirements(requirements),
    total: requirements.length,
    fetchedAt: new Date().toISOString()
  }
}

/** 将 MQL 行解析为迭代汇总所需的轻量需求。 */
const parseIterationSummaryRequirement = (
  row: MoqlRow
): IterationSummaryRequirement | null => {
  const fields = toFieldMap(row)
  const id = readString(fields, 'work_item_id')
  const name = readString(fields, 'name')

  if (!id || !name) return null

  return {
    id,
    name,
    iterations: readIterations(fields)
  }
}

/**
 * 读取迭代仓库汇总所需的轻量需求。
 * 只查询需求 ID、名称和全部规划迭代，不补齐头像等详情字段。
 */
export const getIterationSummaryRequirements = async (): Promise<
  IterationSummaryRequirement[]
> => {
  const project = await getProject()
  const [roleNames, localRequirements] = await Promise.all([
    fetchStoryRoleNames(project),
    listLocalRequirements(project.projectKey, true)
  ])
  const roleCondition = buildCurrentUserRoleCondition(roleNames)
  const remoteRequirements = roleCondition
    ? (
        await fetchMqlRows(
          project,
          [
            'SELECT `工作项id`, `名称`, `规划迭代`',
            `FROM ${quoteMqlIdentifier(project.name)}.\`研发需求\``,
            `WHERE (${roleCondition})`
          ].join(' ')
        )
      )
        .map(parseIterationSummaryRequirement)
        .filter(
          (requirement): requirement is IterationSummaryRequirement =>
            requirement !== null
        )
    : []
  const localSummaryRequirements: IterationSummaryRequirement[] =
    localRequirements.map((requirement) => ({
      id: requirement.id,
      name: requirement.name,
      iterations: requirement.iterationName
        ? [
            {
              id: requirement.iterationId,
              name: requirement.iterationName,
              date: requirement.iterationDate
            }
          ]
        : []
    }))

  return [...remoteRequirements, ...localSummaryRequirements]
}

/** 周报工具返回的单条本周工作。 */
export interface WeeklyWorkItem {
  /** 需求来源：Meegle 或本地临时需求。 */
  source: 'meegle' | 'local'
  id: string
  name: string
  status: string | null
  priority: string | null
  iteration: string | null
  updatedAt: string | null
  completedAt: string | null
  requirementType: string | null
  tags: string[]
  riskLabels: string[]
  owners: string[]
  description: string
  technicalSolution: string
  documentUrl: string | null
}

/** 周报工具返回的本周工作集合。 */
export interface WeeklyWorkItemsResult {
  project: string
  weekStart: string
  weekEnd: string
  total: number
  hasMore: boolean
  items: WeeklyWorkItem[]
  note: string
}

/** 周报只返回最近更新的有限条数，避免单次工具结果过大。 */
const WEEKLY_WORK_ITEM_LIMIT = 20
const WEEKLY_DESCRIPTION_LIMIT = 300
const WEEKLY_SOLUTION_LIMIT = 200
const WEEKLY_OUTPUT_BUDGET = 18_000

/** 将文本压成单行并限制长度。 */
const compactText = (value: string | null, maxLength: number): string => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** 返回当前本地周的周一和周日，格式 YYYY-MM-DD。 */
const getCurrentWeekRange = (): { start: string; end: string } => {
  const start = new Date()
  const day = start.getDay() || 7

  start.setDate(start.getDate() - day + 1)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  const format = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const dayOfMonth = String(date.getDate()).padStart(2, '0')

    return `${date.getFullYear()}-${month}-${dayOfMonth}`
  }

  return { start: format(start), end: format(end) }
}

/**
 * 一次读取当前用户本周更新或完成的需求。
 * 周报生成优先使用该函数，避免模型按需求逐条调用 CLI。
 */
export const getWeeklyWorkItems = async (): Promise<WeeklyWorkItemsResult> => {
  const project = await getProject()
  const [roleNames, localRequirements] = await Promise.all([
    // 角色读取失败须交给周报汇总层生成 warnings，不能用空角色伪装成远程需求为零。
    fetchStoryRoleNames(project),
    listLocalRequirements(project.projectKey, true)
  ])
  const roleCondition = buildCurrentUserRoleCondition(roleNames)
  const week = getCurrentWeekRange()
  /** 本地时间的日期字符串是否落在本周范围内。 */
  const inCurrentWeek = (value: string | null): boolean => {
    if (!value) return false

    const timestamp = new Date(value)
    if (!Number.isFinite(timestamp.getTime())) return false
    // 本地需求存储 UTC ISO 时间，必须转换到与周起止日期一致的本地日历日期。
    const date = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`

    return date >= week.start && date <= week.end
  }
  const remoteRequirements = roleCondition
    ? (
        await fetchMqlRows(
          project,
          [
            'SELECT `工作项id`, `名称`, `状态`, `优先级`, `规划迭代`, `当前节点负责人`, `更新时间`, `需求类型`, `需求描述`, `需求文档`, `完成日期`, `技术方案`, `标签`, `risk_label()`',
            `FROM ${quoteMqlIdentifier(project.name)}.\`研发需求\``,
            `WHERE (${roleCondition}) AND (RELATIVE_DATETIME_EQ(\`更新时间\`, 'current_week') OR RELATIVE_DATETIME_EQ(\`完成日期\`, 'current_week'))`,
            'ORDER BY `更新时间` DESC'
          ].join(' ')
        )
      )
        .map(parseRequirement)
        .filter((requirement): requirement is MeegleRequirement => requirement !== null)
    : []
  // 本地需求没有 Meegle 的 current_week 查询，按更新时间或完成时间筛选。
  const localWeeklyRequirements = localRequirements
    .filter(
      (requirement) =>
        inCurrentWeek(requirement.updatedAt) ||
        inCurrentWeek(requirement.completedAt)
    )
    .map(toMeegleRequirement)
  const requirements = [...remoteRequirements, ...localWeeklyRequirements].sort(
    (left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
  )
  const items: WeeklyWorkItem[] = []

  for (const requirement of requirements.slice(0, WEEKLY_WORK_ITEM_LIMIT)) {
    const owners =
      requirement.owners.length > 0
        ? requirement.owners.map((owner) => owner.name)
        : requirement.productManagers.map((owner) => owner.name)
    const item: WeeklyWorkItem = {
      source: requirement.source,
      id: requirement.id,
      name: requirement.name,
      status: requirement.status,
      priority: requirement.priority,
      iteration: requirement.iterationName,
      updatedAt: requirement.updatedAt,
      completedAt: requirement.completedAt,
      requirementType: requirement.requirementType,
      tags: requirement.tags,
      riskLabels: requirement.riskLabels,
      owners,
      description: compactText(requirement.description, WEEKLY_DESCRIPTION_LIMIT),
      technicalSolution: compactText(
        requirement.technicalSolution,
        WEEKLY_SOLUTION_LIMIT
      ),
      documentUrl: requirement.documentUrl
    }

    if (JSON.stringify([...items, item]).length > WEEKLY_OUTPUT_BUDGET) break

    items.push(item)
  }

  return {
    project: project.name,
    weekStart: week.start,
    weekEnd: week.end,
    total: requirements.length,
    hasMore: requirements.length > items.length,
    items,
    note: requirements.length
      ? '包含本周有更新或完成的 Meegle 需求和本地临时需求；需要更多详情时再按需补充'
      : '本周没有查询到更新或完成的需求'
  }
}

/**
 * 注册需求工作台 IPC。
 */
export const initializeRequirements = (): void => {
  ipcMain.handle('requirements:get-my', (_event, includeClosed: unknown) =>
    getMyRequirements(includeClosed === true)
  )
  ipcMain.handle('requirements:get-iteration-summary', () =>
    getIterationSummaryRequirements()
  )
  ipcMain.handle('requirements:search', (_event, query: unknown) =>
    searchRequirements(typeof query === 'string' ? query : '')
  )
  ipcMain.handle('requirements:list-projects', () => listMeegleProjects())
  ipcMain.handle('requirements:set-project', (_event, projectKey: unknown) => {
    if (typeof projectKey !== 'string') throw new Error('空间 key 不合法')
    return setMeegleProject(projectKey)
  })
  ipcMain.handle('requirements:search-users', (_event, keyword: unknown) => {
    if (typeof keyword !== 'string') throw new Error('搜索关键词不合法')
    return searchRequirementUsers(keyword)
  })
  ipcMain.handle(
    'requirements:update-description',
    (_event, workItemId: unknown, content: unknown) => {
      if (typeof workItemId !== 'string' || typeof content !== 'string') {
        throw new Error('需求描述参数不合法')
      }

      return updateRequirementDescription(workItemId, content)
    }
  )
  ipcMain.handle('requirements:get-activity', (_event, workItemId: unknown) => {
    if (typeof workItemId !== 'string') throw new Error('需求 ID 不合法')

    return getRequirementActivity(workItemId)
  })
  ipcMain.handle(
    'requirements:add-comment',
    (_event, workItemId: unknown, content: unknown, notifyUserKeys: unknown) => {
      if (typeof workItemId !== 'string' || typeof content !== 'string') {
        throw new Error('评论参数不合法')
      }

      const notifyKeys = Array.isArray(notifyUserKeys)
        ? notifyUserKeys.filter((key): key is string => typeof key === 'string')
        : []

      return addRequirementComment(workItemId, content, notifyKeys)
    }
  )
  ipcMain.handle(
    'requirements:transition-node',
    (
      _event,
      workItemId: unknown,
      nodeId: unknown,
      action: unknown,
      rollbackReason: unknown
    ) => {
      if (
        typeof workItemId !== 'string' ||
        typeof nodeId !== 'string' ||
        (action !== 'confirm' && action !== 'rollback')
      ) {
        throw new Error('节点操作参数不合法')
      }

      return transitionRequirementNode(
        workItemId,
        nodeId,
        action,
        typeof rollbackReason === 'string' ? rollbackReason : undefined
      )
    }
  )
  ipcMain.handle(
    'requirements:update-node',
    (_event, workItemId: unknown, nodeId: unknown, input: unknown) => {
      if (typeof workItemId !== 'string' || typeof nodeId !== 'string' || !input) {
        throw new Error('节点参数不合法')
      }

      return updateRequirementNode(workItemId, nodeId, input as UpdateNodeInfoInput)
    }
  )
}
