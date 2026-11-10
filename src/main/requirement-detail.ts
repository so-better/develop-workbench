/**
 * 按 Story ID 或链接读取完整需求详情。
 * 独立于需求工作台列表查询，供 AI 工具和其他调用方复用。
 */
import { runMeegle } from './meegle'
import { getProject } from './requirements'

const MEEGLE_QUERY_TIMEOUT_MS = 30_000

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface CliError {
  message?: string
}

interface RequirementDetailResponse {
  pagination?: {
    has_more?: boolean
    next_page_token?: string
  }
  work_item_attribute?: {
    work_item_id?: string
    work_item_name?: string
    work_item_status?: {
      name?: string
      key?: string
    }
    work_item_type?: {
      name?: string
    }
    owned_project?: {
      name?: string
      simple_name?: string
    }
    create_by?: {
      name?: string
      email?: string
    }
    updated_by?: {
      name?: string
      email?: string
    }
    create_time?: string
    update_time?: string
    template?: {
      name?: string
    }
    role_members?: Array<{
      name?: string
      members?: Array<{
        name?: string
        email?: string
      }>
    }>
  }
  work_item_current_node?: Array<{
    name?: string
    actual_begin_time?: string
  }>
  work_item_fields?: Array<{
    key?: string
    name?: string
    value?: unknown
  }>
  error?: CliError
}

export interface RequirementDetail {
  id: string
  projectKey: string
  name: string
  status: string | null
  priority: string | null
  type: string | null
  template: string | null
  projectName: string | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  currentNodes: string[]
  roles: Array<{
    role: string
    members: string[]
  }>
  documentUrl: string | null
  description: string | null
  fields: Record<string, unknown>
}

/** 解析 CLI JSON，并把服务端错误转成可读异常。 */
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

  if (error?.message) {
    throw new Error(error.message.split(/\r?\n/)[0])
  }

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `${action}失败：Meegle CLI 退出码 ${result.code}`
    )
  }

  return parsed
}

/** 判断值是否为简单标量。 */
const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'

/** 把 Meegle 字段值压缩成适合模型阅读的结构。 */
const simplifyFieldValue = (value: unknown): unknown => {
  if (value === null || value === undefined || value === '') return null
  if (isScalar(value)) return value

  if (Array.isArray(value)) {
    const values = value
      .map((item) => simplifyFieldValue(item))
      .filter((item) => item !== null && item !== '')

    return values.length ? values : null
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const url = ['url', 'link', 'href']
      .map((key) => record[key])
      .find(
        (item): item is string =>
          typeof item === 'string' && /^https?:\/\//i.test(item.trim())
      )

    if (url) {
      const title = ['label', 'name', 'title', 'text']
        .map((key) => record[key])
        .find(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0
        )

      return title ? { title, url } : { url }
    }

    for (const key of ['label', 'name', 'title', 'text', 'iso_time']) {
      if (isScalar(record[key]) && record[key] !== '') return record[key]
    }

    if (isScalar(record.value) && record.value !== '') return record.value

    return record
  }

  return null
}

/** 从 Story ID 或链接中提取 Story ID 和空间 key。 */
const parseStoryReference = (raw: string): {
  id: string
  projectKey: string | null
} => {
  const input = raw.trim()

  if (!input) throw new Error('Story ID 不能为空')
  if (/^\d+$/.test(input)) return { id: input, projectKey: null }

  let url: URL

  try {
    url = new URL(input)
  } catch {
    throw new Error('Story 链接格式不正确')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const storyIndex = parts.findIndex((part) => part === 'story')
  const projectKey =
    storyIndex > 0 ? decodeURIComponent(parts[0] ?? '') || null : null
  let id = ''

  if (storyIndex >= 0) {
    const afterStory = parts.slice(storyIndex + 1)

    if (afterStory[0] === 'detail') afterStory.shift()

    id = afterStory.find((part) => /^\d+$/.test(part)) ?? ''
  }

  if (!id) {
    const queryId = url.searchParams.get('work_item_id') ?? ''
    if (/^\d+$/.test(queryId)) id = queryId
  }

  if (!/^\d+$/.test(id)) {
    throw new Error('无法从 Story 链接中解析需求 ID')
  }

  return { id, projectKey }
}

/**
 * 按 Story ID 或链接读取需求详情。
 * 自动处理字段分页，一次返回需求基本信息、角色、节点和字段。
 */
export const getRequirementDetail = async (raw: string): Promise<RequirementDetail> => {
  const reference = parseStoryReference(raw)
  const projectKey = reference.projectKey ?? (await getProject()).key
  const fields: RequirementDetailResponse['work_item_fields'] = []
  const currentNodeNames = new Set<string>()
  const seenPageTokens = new Set<string>()
  let attribute: RequirementDetailResponse['work_item_attribute']
  let pageToken: string | undefined

  for (let page = 0; page < 10; page += 1) {
    const args = [
      'workitem',
      'get',
      '--project-key',
      projectKey,
      '--work-item-id',
      reference.id,
      '--fields',
      '_all',
      '--format',
      'json'
    ]

    if (pageToken) args.push('--page-token', pageToken)

    const result = await runMeegle(args, MEEGLE_QUERY_TIMEOUT_MS)
    const response = parseCommandJson<RequirementDetailResponse>(
      result,
      '读取需求详情'
    )

    attribute ??= response.work_item_attribute
    fields.push(...(response.work_item_fields ?? []))

    for (const node of response.work_item_current_node ?? []) {
      if (node.name?.trim()) currentNodeNames.add(node.name.trim())
    }

    if (!response.pagination?.has_more) {
      pageToken = undefined
      break
    }

    // 声明有下一页却缺少有效 token，或 token 循环，均不能当作完整详情返回。
    const nextPageToken = response.pagination.next_page_token

    if (typeof nextPageToken !== 'string' || !nextPageToken.trim()) {
      throw new Error('需求字段分页异常：缺少有效的下一页 token，无法完整读取')
    }
    if (seenPageTokens.has(nextPageToken)) {
      throw new Error('需求字段分页异常：下一页 token 重复，无法完整读取')
    }

    seenPageTokens.add(nextPageToken)
    // token 是服务端的不透明标识，校验后原样传回，不修改其内容。
    pageToken = nextPageToken
  }

  if (pageToken) {
    throw new Error('需求字段分页过多，暂时无法完整读取')
  }

  if (!attribute?.work_item_id) {
    throw new Error(`没有找到需求 ${reference.id}`)
  }

  const fieldMap: Record<string, unknown> = {}

  for (const field of fields) {
    const name = field.name?.trim()
    const value = simplifyFieldValue(field.value)

    if (!name || value === null) continue

    fieldMap[name] = value
  }

  const roles = (attribute.role_members ?? [])
    .map((role) => ({
      role: role.name?.trim() ?? '',
      members: (role.members ?? [])
        .map((member) => member.name?.trim() ?? '')
        .filter(Boolean)
    }))
    .filter((role) => role.role && role.members.length > 0)

  return {
    id: attribute.work_item_id,
    projectKey,
    name: attribute.work_item_name?.trim() ?? '',
    status: attribute.work_item_status?.name?.trim() || null,
    priority:
      typeof fieldMap['优先级'] === 'string' ? fieldMap['优先级'] : null,
    type: attribute.work_item_type?.name?.trim() || null,
    template: attribute.template?.name?.trim() || null,
    projectName: attribute.owned_project?.name?.trim() || null,
    createdBy: attribute.create_by?.name?.trim() || null,
    updatedBy: attribute.updated_by?.name?.trim() || null,
    createdAt: attribute.create_time?.trim() || null,
    updatedAt: attribute.update_time?.trim() || null,
    currentNodes: [...currentNodeNames],
    roles,
    documentUrl:
      typeof fieldMap['需求文档'] === 'string'
        ? fieldMap['需求文档']
        : typeof fieldMap['wiki'] === 'string'
          ? fieldMap['wiki']
          : null,
    description:
      typeof fieldMap['需求描述'] === 'string' ? fieldMap['需求描述'] : null,
    fields: fieldMap
  }
}
