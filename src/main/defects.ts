/**
 * Meegle 缺陷模块。
 * 读取当前用户通过缺陷角色参与的缺陷，按空间隔离。
 */
import { ipcMain } from 'electron'
import { runMeegle } from './meegle'
import {
  getProject,
  resolveUsers,
  resolveUsersByEmails
} from './requirements'
import { DEFECT_ROLES } from '../types/defects'
import type {
  DefectRole,
  DefectTransition,
  DefectTransitionField,
  DefectTransitionRole,
  DefectTransitionFieldValue,
  DefectTransitions,
  MeegleDefect,
  MeegleDefectCollaborator,
  MeegleDefectComment,
  MeegleDefectComments,
  MeegleDefectLinkedRequirement,
  MeegleDefectOwner,
  MeegleMyDefects,
  UpdateDefectAssigneesInput
} from '../types/defects'
import type { MeegleProject } from '../types/requirements'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface CliError {
  message?: string
}

interface MqlValue {
  string_value?: string
  string_value_list?: string[]
  long_value?: number | string
  key_label_value?: {
    key?: string
    label?: string
  }
  key_label_value_list?: Array<{
    key?: string
    label?: string
  }>
  cascade_key_label_value?: {
    label?: string
    children?: Array<{
      label?: string
      children?: Array<{
        label?: string
        children?: Array<{ label?: string }> | null
      }> | null
    }> | null
  }
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
}

interface MqlField {
  key?: string
  name?: string
  value?: MqlValue | null
}

interface MqlRow {
  moql_field_list?: MqlField[]
}

interface MqlResponse {
  data?: Record<string, MqlRow[] | null> | null
  list?: Array<{
    count?: number
    group_infos?: Array<{ group_id?: string }>
  }> | null
  session_id?: string
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
  } | null
  error?: CliError
}

interface TransitionFieldForm {
  class?: string
  key?: string
  name?: string
}

interface TransitionResponseItem {
  id?: number | string
  state_key?: string
  state_name?: string
  confirm_form?: TransitionFieldForm[] | null
}

interface TransitionsResponse {
  state_key?: string
  state_name?: string
  transition?: TransitionResponseItem[] | null
  error?: CliError
}

interface StateRequiredItem {
  class?: string
  field_type_key?: string
  finished?: boolean
  key?: string
}

interface StateRequiredResponse {
  form_items?: StateRequiredItem[] | null
  error?: CliError
}

interface MetaOption {
  option_id?: string
  option_name?: string
  children?: MetaOption[] | null
}

interface MetaFieldResponseItem {
  field_key?: string
  field_name?: string
  field_type?: string
  option?: MetaOption[] | null
  error?: CliError
}

interface MetaFieldsResponse {
  list?: MetaFieldResponseItem[] | null
  error?: CliError
}

interface MetaRoleItem {
  role_id?: string
  role_name?: string
}

interface MetaRolesResponse {
  list?: MetaRoleItem[] | null
  error?: CliError
}

const MEEGLE_QUERY_TIMEOUT_MS = 30_000
const MQL_PAGE_SIZE = 50
const MAX_MQL_PAGES = 200
const CURRENT_USER_CACHE_TTL_MS = 5 * 60 * 1000
const ROLE_NAME_CACHE_TTL_MS = 5 * 60 * 1000
const DEFECT_WORK_ITEM_TYPE = 'issue'
// BUG责任人是隐藏字段，meta-fields 不返回，只能按固定 key 更新。
const BUG_OWNER_FIELD_KEY = 'field_b16c4b'
const OPERATOR_ROLE_NAME = '经办人'
const DEFAULT_OPERATOR_ROLE_KEY = 'operator'
/** 已结束/已解决的缺陷状态，不进入待处理列表。 */
const DEFECT_DONE_STATUSES = [
  '已解决',
  '测试通过',
  '已关闭',
  '已终止',
  '转需求',
  'Not a Bug'
]
/** 计入周报的已解决缺陷状态。 */
const DEFECT_FIXED_STATUSES = ['已解决', '测试通过', '已关闭']

let currentUserCache: { expiresAt: number; userKey: string } | null = null
const roleNameCache = new Map<string, { expiresAt: number; names: Map<string, string> }>()

const isDefectRole = (value: string): value is DefectRole =>
  (DEFECT_ROLES as readonly string[]).includes(value)

const quoteMqlIdentifier = (value: string): string =>
  `\`${value.replace(/`/g, '')}\``

const parseCommandJson = <T>(result: CommandResult, action: string): T => {
  const output = result.stdout.trim()

  if (!output) {
    throw new Error(result.stderr.trim() || `${action}失败：Meegle CLI 没有返回内容`)
  }

  let parsed: T

  try {
    parsed = JSON.parse(output) as T
  } catch {
    throw new Error(`${action}失败：无法解析 Meegle CLI 返回内容`)
  }

  const error = (parsed as { error?: CliError } | null)?.error

  if (error?.message) throw new Error(error.message.split(/\r?\n/)[0])

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `${action}失败：Meegle CLI 退出码 ${result.code}`)
  }

  return parsed
}

const getRows = (response: MqlResponse): MqlRow[] =>
  Object.values(response.data ?? {}).flatMap((rows) => rows ?? [])

/** 执行 MQL 并读取全部分页。 */
const fetchMqlRows = async (
  project: MeegleProject,
  mql: string,
  singlePage = false
): Promise<MqlRow[]> => {
  const result = await runMeegle(
    ['workitem', 'query', '--project-key', project.key, '--mql', mql, '--format', 'json'],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<MqlResponse>(result, '读取缺陷列表')
  const rows = getRows(response)

  if (singlePage) return rows

  const total = response.list?.[0]?.count ?? rows.length

  if (rows.length >= total) return rows

  const sessionId = response.session_id

  if (!sessionId) {
    throw new Error(`缺陷列表未完整加载：已读取 ${rows.length}/${total} 条`)
  }

  const groupId = response.list?.[0]?.group_infos?.[0]?.group_id ?? '1'
  const pageSize = rows.length || MQL_PAGE_SIZE
  const totalPages = Math.ceil(total / pageSize)

  if (totalPages > MAX_MQL_PAGES) {
    throw new Error(`缺陷数量超过 ${MAX_MQL_PAGES * pageSize} 条，暂时无法全部加载`)
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
    const pageResponse = parseCommandJson<MqlResponse>(pageResult, '读取缺陷列表')

    rows.push(...getRows(pageResponse))

    if (rows.length >= total) break
  }

  if (rows.length < total) {
    throw new Error(`缺陷列表未完整加载：已读取 ${rows.length}/${total} 条`)
  }

  return rows
}

const toFieldMap = (row: MqlRow): Map<string, MqlValue | null> => {
  const fields = new Map<string, MqlValue | null>()

  for (const field of row.moql_field_list ?? []) {
    const key = field.key?.trim()
    const name = field.name?.trim()

    if (key) fields.set(key, field.value ?? null)
    if (name) fields.set(name, field.value ?? null)
  }

  return fields
}

const readString = (
  fields: Map<string, MqlValue | null>,
  key: string
): string | null => {
  const value = fields.get(key)
  const text = value?.string_value?.trim()

  return text || null
}

const readId = (
  fields: Map<string, MqlValue | null>,
  key: string
): string | null => {
  const value = fields.get(key)
  const id = value?.long_value ?? value?.string_value

  return id === undefined || id === null || id === '' ? null : String(id)
}

const readLabel = (
  fields: Map<string, MqlValue | null>,
  key: string
): string | null => fields.get(key)?.key_label_value?.label?.trim() || null

const readLabels = (
  fields: Map<string, MqlValue | null>,
  key: string
): string[] => {
  const value = fields.get(key)

  return (value?.key_label_value_list ?? [])
    .map((item) => item.label?.trim())
    .filter((label): label is string => Boolean(label))
}

const toOwner = (value: {
  user_key?: string
  name_cn?: string
  name_en?: string
  email?: string
}): MeegleDefectOwner | null => {
  const name = value.name_cn?.trim() || value.name_en?.trim()

  if (!name) return null

  return {
    name,
    email: value.email?.trim() || null,
    avatarUrl: null,
    userKey: value.user_key?.trim() || null
  }
}

const readOwners = (
  fields: Map<string, MqlValue | null>,
  key: string
): MeegleDefectOwner[] => {
  const value = fields.get(key)

  return [...(value?.user_value_list ?? []), ...(value?.user_value ? [value.user_value] : [])]
    .map(toOwner)
    .filter((owner): owner is MeegleDefectOwner => owner !== null)
}

const readCascadePath = (value: MqlValue | null | undefined): string[] => {
  const cascade = value?.cascade_key_label_value

  if (!cascade) return []

  const labels: string[] = []
  let current: typeof cascade | undefined = cascade

  while (current) {
    if (current.label?.trim()) labels.push(current.label.trim())
    current = current.children?.[0]
  }

  return labels
}

const parseIterationDate = (name: string | null): string | null => {
  const match = /(\d{4})(\d{2})(\d{2})$/.exec(name ?? '')

  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

const readLinkedRequirement = (
  fields: Map<string, MqlValue | null>
): MeegleDefectLinkedRequirement | null => {
  const linked = fields.get('关联需求')?.key_label_value
  const id = linked?.key?.trim()
  const name = linked?.label?.trim()

  return id && name ? { id, name } : null
}

const parseDefect = (row: MqlRow): MeegleDefect | null => {
  const fields = toFieldMap(row)
  const id = readId(fields, '工作项id')
  const name = readString(fields, '名称')

  if (!id || !name) return null

  const iteration = fields.get('规划迭代')?.key_label_value_list?.[0]

  const collaborators: MeegleDefectCollaborator[] = DEFECT_ROLES.flatMap((role) => {
    const members = readOwners(fields, `__${role}`)

    return members.length > 0 ? [{ role, members }] : []
  })

  return {
    id,
    name,
    status: readLabels(fields, '状态')[0] ?? null,
    priority: readLabel(fields, '优先级'),
    severity: readLabel(fields, '缺陷等级'),
    iterationId: iteration?.key?.trim() || null,
    iterationName: iteration?.label?.trim() || null,
    iterationDate: parseIterationDate(iteration?.label?.trim() || null),
    productLines: readCascadePath(fields.get('产品线')),
    owners: readOwners(fields, '当前负责人'),
    collaborators,
    updatedAt: readString(fields, '更新时间'),
    completedAt: readString(fields, '完成日期'),
    description: readString(fields, '详细描述'),
    linkedRequirement: readLinkedRequirement(fields),
    affectedVersions: readLabels(fields, '影响版本'),
    fixedVersions: readLabels(fields, '解决版本'),
    findingStage: readLabel(fields, '发现阶段'),
    resolver: readOwners(fields, 'BUG解决人')[0] ?? null,
    bugOwner: readOwners(fields, 'BUG责任人')[0] ?? null,
    createdBy: readOwners(fields, '创建人')[0] ?? null,
    updatedBy: readOwners(fields, '更新人')[0] ?? null,
    watchers: readOwners(fields, '关注人'),
    proposedAt: readString(fields, '提出时间')
  }
}

const buildRoleCondition = (role: DefectRole | null): string => {
  if (role) return `\`__${role}\` = current_login_user()`

  return [
    ...DEFECT_ROLES.map(
      (item) => `\`__${item}\` = current_login_user()`
    ),
    '`BUG责任人` = current_login_user()',
    '`BUG解决人` = current_login_user()'
  ].join(' OR ')
}

/** 为缺陷相关人员补齐飞书头像。 */
const enrichDefectAvatars = async (
  project: MeegleProject,
  defects: MeegleDefect[]
): Promise<void> => {
  const emails = defects.flatMap((defect) => [
    defect.createdBy?.email ?? '',
    defect.resolver?.email ?? '',
    defect.bugOwner?.email ?? '',
    defect.updatedBy?.email ?? '',
    ...defect.owners.map((owner) => owner.email ?? ''),
    ...defect.watchers.map((owner) => owner.email ?? ''),
    ...defect.collaborators.flatMap((collaborator) =>
      collaborator.members.map((owner) => owner.email ?? '')
    )
  ])
  const users = await resolveUsersByEmails(project, emails).catch(
    () => new Map()
  )

  const applyAvatar = (owner: MeegleDefectOwner): MeegleDefectOwner => {
    const resolved = owner.email ? users.get(owner.email) : null

    return resolved
      ? {
          ...owner,
          avatarUrl: resolved.avatarUrl,
          userKey: resolved.userKey ?? owner.userKey
        }
      : owner
  }

  for (const defect of defects) {
    if (defect.createdBy) defect.createdBy = applyAvatar(defect.createdBy)
    if (defect.resolver) defect.resolver = applyAvatar(defect.resolver)
    if (defect.bugOwner) defect.bugOwner = applyAvatar(defect.bugOwner)
    if (defect.updatedBy) defect.updatedBy = applyAvatar(defect.updatedBy)
    defect.owners = defect.owners.map(applyAvatar)
    defect.watchers = defect.watchers.map(applyAvatar)
    defect.collaborators = defect.collaborators.map((collaborator) => ({
      ...collaborator,
      members: collaborator.members.map(applyAvatar)
    }))
  }
}

/** 生成缺陷名称/ID 的 MQL 搜索条件。 */
const buildDefectSearchCondition = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('搜索关键词不合法')

  const keyword = value.trim().replace(/[\\%_]/g, '').slice(0, 80)

  if (!keyword) return ''

  const escaped = keyword.replace(/'/g, "''")
  const idCondition = /^\d+$/.test(keyword) ? ` OR \`工作项id\` = ${keyword}` : ''

  return `(\`名称\` LIKE '%${escaped}%'${idCondition})`
}

/** 在当前空间内按关键词搜索全部缺陷。 */
export const searchDefects = async (query: string): Promise<MeegleMyDefects> => {
  const project = await getProject()
  const condition = buildDefectSearchCondition(query)
  const roleFields = DEFECT_ROLES.map((item) => `\`__${item}\``).join(', ')
  const rows = condition
    ? await fetchMqlRows(
        project,
        [
          `SELECT \`工作项id\`, \`名称\`, \`状态\`, \`优先级\`, \`缺陷等级\`, \`规划迭代\`, \`产品线\`, \`当前负责人\`, \`更新时间\`, \`完成日期\`, \`详细描述\`, \`关联需求\`, \`影响版本\`, \`解决版本\`, \`发现阶段\`, \`BUG解决人\`, \`BUG责任人\`, \`创建人\`, \`更新人\`, \`关注人\`, \`提出时间\`, ${roleFields}`,
          `FROM ${quoteMqlIdentifier(project.name)}.\`缺陷\``,
          `WHERE ${condition}`,
          'ORDER BY `更新时间` DESC',
          'LIMIT 20'
        ].join(' '),
        true
      )
    : []
  const defects = rows
    .map(parseDefect)
    .filter((defect): defect is MeegleDefect => defect !== null)

  try {
    await enrichDefectAvatars(project, defects)
  } catch {
    // 头像不是核心数据，补齐失败时继续展示搜索结果。
  }

  return {
    project,
    role: null,
    defects,
    total: defects.length,
    fetchedAt: new Date().toISOString()
  }
}

/** 读取当前用户参与的缺陷，可按角色过滤；includeClosed 为 true 时包含已结束缺陷。 */
export const getMyDefects = async (
  role: DefectRole | null = null,
  includeClosed = false
): Promise<MeegleMyDefects> => {
  const project = await getProject()
  const roleFields = DEFECT_ROLES.map((item) => `\`__${item}\``).join(', ')
  const rows = await fetchMqlRows(
    project,
    [
      `SELECT \`工作项id\`, \`名称\`, \`状态\`, \`优先级\`, \`缺陷等级\`, \`规划迭代\`, \`产品线\`, \`当前负责人\`, \`更新时间\`, \`完成日期\`, \`详细描述\`, \`关联需求\`, \`影响版本\`, \`解决版本\`, \`发现阶段\`, \`BUG解决人\`, \`BUG责任人\`, \`创建人\`, \`更新人\`, \`关注人\`, \`提出时间\`, ${roleFields}`,
      `FROM ${quoteMqlIdentifier(project.name)}.\`缺陷\``,
      `WHERE (${buildRoleCondition(role)})${
        includeClosed
          ? ''
          : ` AND \`状态\` not in (${DEFECT_DONE_STATUSES.map(
              (status) => `'${status.replace(/'/g, "''")}'`
            ).join(', ')})`
      }`,
      'ORDER BY `更新时间` DESC'
    ].join(' ')
  )
  const defects = rows
    .map(parseDefect)
    .filter((defect): defect is MeegleDefect => defect !== null)

  await enrichDefectAvatars(project, defects)

  return {
    project,
    role,
    defects,
    total: defects.length,
    fetchedAt: new Date().toISOString()
  }
}

/** 读取当前用户在指定周解决或关闭的缺陷。 */
export const getWeeklyResolvedDefects = async (
  week: 'current' | 'last' = 'current'
): Promise<MeegleMyDefects> => {
  const project = await getProject()
  const relativeWeek = week === 'last' ? 'last_week' : 'current_week'
  const roleFields = DEFECT_ROLES.map((item) => `\`__${item}\``).join(', ')
  const rows = await fetchMqlRows(
    project,
    [
      `SELECT \`工作项id\`, \`名称\`, \`状态\`, \`优先级\`, \`缺陷等级\`, \`规划迭代\`, \`产品线\`, \`当前负责人\`, \`更新时间\`, \`完成日期\`, \`详细描述\`, \`关联需求\`, \`影响版本\`, \`解决版本\`, \`发现阶段\`, \`BUG解决人\`, \`BUG责任人\`, \`创建人\`, \`更新人\`, \`关注人\`, \`提出时间\`, ${roleFields}`,
      `FROM ${quoteMqlIdentifier(project.name)}.\`缺陷\``,
      `WHERE \`状态\` in (${DEFECT_FIXED_STATUSES.map(
        (status) => `'${status.replace(/'/g, "''")}'`
      ).join(', ')}) AND RELATIVE_DATETIME_EQ(\`完成日期\`, '${relativeWeek}') AND \`BUG解决人\` = current_login_user()`,
      'ORDER BY `完成日期` DESC',
      'LIMIT 50'
    ].join(' ')
  )
  const defects = rows
    .map(parseDefect)
    .filter((defect): defect is MeegleDefect => defect !== null)

  try {
    await enrichDefectAvatars(project, defects)
  } catch {
    // 头像不是周报核心数据，补齐失败时继续。
  }

  return {
    project,
    role: null,
    defects,
    total: defects.length,
    fetchedAt: new Date().toISOString()
  }
}

/** 更新 BUG 处理人相关字段和角色。 */
export const updateDefectAssignees = async (
  workItemId: string,
  input: UpdateDefectAssigneesInput
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('缺陷 ID 不合法')

  const project = await getProject()
  const fields: Array<{ field_key: string; field_value: string }> = []
  const roleNames =
    input.bugOperator !== undefined
      ? await getIssueRoleNames(project).catch(() => new Map<string, string>())
      : new Map<string, string>()
  const operatorRoleKey =
    Array.from(roleNames.entries()).find(
      ([, name]) => name === OPERATOR_ROLE_NAME
    )?.[0] ?? DEFAULT_OPERATOR_ROLE_KEY

  if (input.bugOwner !== undefined) {
    fields.push({
      field_key: BUG_OWNER_FIELD_KEY,
      field_value: input.bugOwner ?? ''
    })
  }

  const addOperations: Array<{
    op: string
    role_key: string
    user_keys: string[]
  }> = []
  const removeOperations: Array<{
    op: string
    role_key: string
    user_keys: string[]
  }> = []

  if (input.bugOperator !== undefined) {
    const currentKeys = Array.from(new Set(input.operatorCurrentKeys ?? []))
    const nextKey = input.bugOperator
    const removeKeys = currentKeys.filter((key) => key !== nextKey)

    if (nextKey && !currentKeys.includes(nextKey)) {
      addOperations.push({
        op: 'add',
        role_key: operatorRoleKey,
        user_keys: [nextKey]
      })
    }
    if (removeKeys.length > 0) {
      removeOperations.push({
        op: 'remove',
        role_key: operatorRoleKey,
        user_keys: removeKeys
      })
    }
  }

  if (
    fields.length === 0 &&
    addOperations.length === 0 &&
    removeOperations.length === 0
  ) {
    return
  }

  const runUpdate = async (
    roleOperations: typeof addOperations,
    includeFields: boolean
  ): Promise<void> => {
    const args = [
      'workitem',
      'update',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId
    ]

    if (includeFields && fields.length > 0) {
      args.push('--fields', JSON.stringify(fields))
    }
    if (roleOperations.length > 0) {
      args.push('--role-operate', JSON.stringify(roleOperations))
    }
    args.push('--format', 'json')

    const result = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() || `更新 BUG 处理人失败：退出码 ${result.code}`
      )
    }
    if (result.stdout.trim()) parseCommandJson(result, '更新 BUG 处理人')
  }

  // 先写入字段和新增角色，成功后再移除旧角色，避免新增失败时把旧经办人清空。
  if (fields.length > 0 || addOperations.length > 0) {
    await runUpdate(addOperations, true)
  }
  if (removeOperations.length > 0) {
    await runUpdate(removeOperations, false)
  }

}

/** 读取缺陷评论。 */
export const getDefectComments = async (
  workItemId: string
): Promise<MeegleDefectComments> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('缺陷 ID 不合法')

  const project = await getProject()
  const result = await runMeegle(
    [
      'comment',
      'list',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId,
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<CommentListResponse>(result, '读取缺陷评论')
  const rawComments = response.comments ?? []
  const users = await resolveUsers(
    project,
    rawComments.map((comment) => comment.creator ?? '')
  )
  const comments: MeegleDefectComment[] = rawComments.map((comment) => {
    const creator = users.get(comment.creator ?? '')

    return {
      id: comment.comment_id ?? '',
      content: comment.content ?? '',
      createdAt: comment.created_at?.trim() || null,
      creator: creator
        ? {
            name: creator.name,
            email: creator.email,
            avatarUrl: creator.avatarUrl,
            userKey: creator.userKey
          }
        : null
    }
  })

  return {
    comments,
    total: response.pagination?.total ?? comments.length
  }
}

const getCurrentUserKey = async (): Promise<string> => {
  if (currentUserCache && currentUserCache.expiresAt > Date.now()) {
    return currentUserCache.userKey
  }

  const result = await runMeegle(
    ['user', 'me', '--format', 'json'],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<{ user_key?: string }>(result, '读取当前用户')
  const userKey = response.user_key?.trim()

  if (!userKey) throw new Error('无法读取当前 Meegle 用户')

  currentUserCache = {
    expiresAt: Date.now() + CURRENT_USER_CACHE_TTL_MS,
    userKey
  }

  return userKey
}

const flattenMetaOptions = (
  options: MetaOption[],
  prefix: string[] = []
): Array<{ value: string; label: string }> =>
  options.flatMap((option) => {
    const name = option.option_name?.trim() || ''
    const nextPrefix = name ? [...prefix, name] : prefix
    const children = option.children ?? []

    if (children.length > 0) return flattenMetaOptions(children, nextPrefix)
    if (!option.option_id || !name) return []

    return [{ value: option.option_id, label: nextPrefix.join(' / ') }]
  })

const getIssueRoleNames = async (
  project: MeegleProject
): Promise<Map<string, string>> => {
  const cached = roleNameCache.get(project.projectKey)

  if (cached && cached.expiresAt > Date.now()) return cached.names

  const result = await runMeegle(
    [
      'workitem',
      'meta-roles',
      '--project-key',
      project.key,
      '--work-item-type',
      DEFECT_WORK_ITEM_TYPE,
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<MetaRolesResponse>(result, '读取缺陷角色配置')
  const names = new Map(
    (response.list ?? [])
      .filter((role) => role.role_id && role.role_name)
      .map((role) => [role.role_id as string, role.role_name as string])
  )

  roleNameCache.set(project.projectKey, {
    expiresAt: Date.now() + ROLE_NAME_CACHE_TTL_MS,
    names
  })

  return names
}

const resolveTransitionRoles = (
  confirmForm: TransitionFieldForm[],
  roleNames: Map<string, string>
): DefectTransitionRole[] =>
  confirmForm
    .filter((item) => item.class === 'role' && item.key)
    .map((item) => {
      const key = item.key as string
      const matchedRoleId = Array.from(roleNames.keys()).find(
        (roleId) => key === roleId || key.endsWith(roleId)
      )

      return {
        key,
        name: matchedRoleId ? (roleNames.get(matchedRoleId) ?? key) : key
      }
    })

const getTransitionFieldsMeta = async (
  project: MeegleProject,
  fieldKeys: string[]
): Promise<Map<string, MetaFieldResponseItem>> => {
  if (fieldKeys.length === 0) return new Map()

  const result = await runMeegle(
    [
      'workitem',
      'meta-fields',
      '--project-key',
      project.key,
      '--work-item-type',
      DEFECT_WORK_ITEM_TYPE,
      '--field-keys',
      JSON.stringify(fieldKeys),
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<MetaFieldsResponse>(result, '读取流转字段配置')

  return new Map(
    (response.list ?? [])
      .filter((field) => field.field_key)
      .map((field) => [field.field_key as string, field])
  )
}

/** 读取缺陷可流转状态和必填字段。 */
export const getDefectTransitions = async (
  workItemId: string
): Promise<DefectTransitions> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('缺陷 ID 不合法')

  const project = await getProject()
  const userKey = await getCurrentUserKey()
  const result = await runMeegle(
    [
      'workflow',
      'list-state-transitions',
      '--project-key',
      project.key,
      '--work-item-id',
      workItemId,
      '--work-item-type',
      DEFECT_WORK_ITEM_TYPE,
      '--user-key',
      userKey,
      '--format',
      'json'
    ],
    MEEGLE_QUERY_TIMEOUT_MS
  )
  const response = parseCommandJson<TransitionsResponse>(result, '读取缺陷流转状态')
  const transitionItems = response.transition ?? []
  const requiredItemsByTransition = await Promise.all(
    transitionItems.map(async (transition) => {
      if (!transition.state_key) return []

      try {
        const requiredResult = await runMeegle(
          [
            'workflow',
            'list-state-required',
            '--project-key',
            project.key,
            '--work-item-id',
            workItemId,
            '--state-key',
            transition.state_key,
            '--mode',
            'unfinished',
            '--format',
            'json'
          ],
          MEEGLE_QUERY_TIMEOUT_MS
        )
        const requiredResponse = parseCommandJson<StateRequiredResponse>(
          requiredResult,
          '读取流转必填项'
        )

        return requiredResponse.form_items ?? []
      } catch {
        return []
      }
    })
  )
  const fieldKeys = Array.from(
    new Set(
      transitionItems.flatMap((transition, index) => [
        ...(transition.confirm_form ?? [])
          .filter((field) => field.class === 'field' && field.key)
          .map((field) => field.key as string),
        ...requiredItemsByTransition[index]
          .filter((field) => field.class === 'field' && field.key)
          .map((field) => field.key as string)
      ])
    )
  )
  const [meta, roleNames] = await Promise.all([
    getTransitionFieldsMeta(project, fieldKeys),
    getIssueRoleNames(project)
  ])
  const transitions: DefectTransition[] = transitionItems
    .map((transition, index) => {
      if (!transition.id || !transition.state_key) return null

      const fieldTypes = new Map<string, string>()

      for (const field of transition.confirm_form ?? []) {
        if (field.class === 'field' && field.key) {
          fieldTypes.set(field.key, meta.get(field.key)?.field_type ?? 'text')
        }
      }
      for (const field of requiredItemsByTransition[index]) {
        if (field.class === 'field' && field.key) {
          fieldTypes.set(
            field.key,
            meta.get(field.key)?.field_type ?? field.field_type_key ?? 'text'
          )
        }
      }

      const fields: DefectTransitionField[] = Array.from(fieldTypes.entries()).map(
        ([key, type]) => {
          const fieldMeta = meta.get(key)
          const confirmField = (transition.confirm_form ?? []).find(
            (field) => field.key === key
          )

          return {
            key,
            name:
              fieldMeta?.field_name?.trim() ||
              confirmField?.name?.trim() ||
              key ||
              '必填项',
            type: fieldMeta?.field_type?.trim() || type,
            options:
              fieldMeta?.field_type === 'select' ||
              fieldMeta?.field_type === 'tree-multi-select' ||
              fieldMeta?.field_type === 'multi-select'
                ? flattenMetaOptions(fieldMeta.option ?? [])
                : []
          }
        }
      )

      return {
        id: String(transition.id),
        stateKey: transition.state_key,
        stateName: transition.state_name?.trim() || transition.state_key,
        fields,
        requiredRoles: resolveTransitionRoles(
          transition.confirm_form ?? [],
          roleNames
        )
      }
    })
    .filter((transition): transition is DefectTransition => transition !== null)

  return {
    currentStateKey: response.state_key?.trim() || '',
    currentStateName: response.state_name?.trim() || response.state_key?.trim() || '',
    transitions
  }
}

/** 执行缺陷状态流转。 */
export const transitionDefect = async (
  workItemId: string,
  transitionId: string,
  fields: DefectTransitionFieldValue[] = []
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('缺陷 ID 不合法')
  if (!/^\d+$/.test(transitionId)) throw new Error('流转 ID 不合法')

  const project = await getProject()
  let fieldsSaved = false

  if (fields.length > 0) {
    const updateResult = await runMeegle(
      [
        'workitem',
        'update',
        '--project-key',
        project.key,
        '--work-item-id',
        workItemId,
        '--fields',
        JSON.stringify(
          fields.map((field) => ({
            field_key: field.fieldKey,
            field_value: field.fieldValue
          }))
        ),
        '--format',
        'json'
      ],
      MEEGLE_QUERY_TIMEOUT_MS
    )

    if (updateResult.code !== 0) {
      throw new Error(
        updateResult.stderr.trim() || `补充流转字段失败：退出码 ${updateResult.code}`
      )
    }
    if (updateResult.stdout.trim()) parseCommandJson(updateResult, '补充流转字段')
    fieldsSaved = true
  }

  try {
    const result = await runMeegle(
      [
        'workflow',
        'transition-state',
        '--project-key',
        project.key,
        '--work-item-id',
        workItemId,
        '--transition-id',
        transitionId,
        '--format',
        'json'
      ],
      MEEGLE_QUERY_TIMEOUT_MS
    )

    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `缺陷流转失败：退出码 ${result.code}`)
    }
    if (result.stdout.trim()) parseCommandJson(result, '缺陷流转')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(
      fieldsSaved
        ? `必填字段已保存，但状态流转失败：${message}`
        : message
    )
  }
}

/** 发表缺陷评论。 */
export const addDefectComment = async (
  workItemId: string,
  content: string,
  notifyUserKeys: string[] = []
): Promise<void> => {
  if (!/^\d+$/.test(workItemId)) throw new Error('缺陷 ID 不合法')

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

  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `发表评论失败：退出码 ${result.code}`)
  }

  if (result.stdout.trim()) parseCommandJson(result, '发表评论')
}

/** 注册缺陷 IPC。 */
export const initializeDefects = (): void => {
  ipcMain.handle(
    'defects:update-assignees',
    (_event, workItemId: unknown, input: unknown) => {
      if (
        typeof workItemId !== 'string' ||
        !input ||
        typeof input !== 'object'
      ) {
        throw new Error('BUG 处理人参数不合法')
      }

      const patch = input as Record<string, unknown>
      const keys = ['bugOperator', 'bugOwner']

      if (
        keys.some(
          (key) =>
            patch[key] !== undefined &&
            patch[key] !== null &&
            typeof patch[key] !== 'string'
        ) ||
        (patch.operatorCurrentKeys !== undefined &&
          (!Array.isArray(patch.operatorCurrentKeys) ||
            patch.operatorCurrentKeys.some((key) => typeof key !== 'string')))
      ) {
        throw new Error('BUG 处理人参数不合法')
      }

      return updateDefectAssignees(workItemId, input as UpdateDefectAssigneesInput)
    }
  )

  ipcMain.handle('defects:get-transitions', (_event, workItemId: unknown) => {
    if (typeof workItemId !== 'string') throw new Error('缺陷 ID 不合法')
    return getDefectTransitions(workItemId)
  })

  ipcMain.handle(
    'defects:transition',
    (_event, workItemId: unknown, transitionId: unknown, fields: unknown) => {
      if (typeof workItemId !== 'string' || typeof transitionId !== 'string') {
        throw new Error('缺陷流转参数不合法')
      }

      const values = Array.isArray(fields)
        ? fields.filter(
            (field): field is DefectTransitionFieldValue =>
              Boolean(field) &&
              typeof field === 'object' &&
              typeof (field as DefectTransitionFieldValue).fieldKey === 'string' &&
              typeof (field as DefectTransitionFieldValue).fieldValue === 'string'
          )
        : []

      return transitionDefect(workItemId, transitionId, values)
    }
  )

  ipcMain.handle('defects:get-comments', (_event, workItemId: unknown) => {
    if (typeof workItemId !== 'string') throw new Error('缺陷 ID 不合法')
    return getDefectComments(workItemId)
  })

  ipcMain.handle(
    'defects:add-comment',
    (
      _event,
      workItemId: unknown,
      content: unknown,
      notifyUserKeys: unknown
    ) => {
      if (typeof workItemId !== 'string' || typeof content !== 'string') {
        throw new Error('评论参数不合法')
      }

      const keys = Array.isArray(notifyUserKeys)
        ? notifyUserKeys.filter((key): key is string => typeof key === 'string')
        : []

      return addDefectComment(workItemId, content, keys)
    }
  )

  ipcMain.handle('defects:search', (_event, query: unknown) =>
    searchDefects(typeof query === 'string' ? query : '')
  )

  ipcMain.handle(
    'defects:get-my',
    (_event, role: unknown, includeClosed: unknown) => {
      if (role !== null && role !== undefined && typeof role !== 'string') {
        throw new Error('缺陷角色参数不合法')
      }

      if (typeof role === 'string' && role && !isDefectRole(role)) {
        throw new Error('缺陷角色不存在')
      }

      return getMyDefects(
        role ? (role as DefectRole) : null,
        includeClosed === true
      )
    }
  )
}
