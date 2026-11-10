/**
 * 飞书个人工作周报。
 * 走飞书汇报网页的内部接口，复用内嵌浏览器的登录态。
 */
import { BrowserWindow, ipcMain, session } from 'electron'
import { BROWSER_PARTITION } from './embedded-browser'
import { withBrowserAuth } from './browser-auth'
import type {
  SubmitWeeklyReportInput,
  WeeklyReportField,
  WeeklyReportState
} from '../types/weekly-report'

const REPORT_API_BASE = 'https://oa.feishu.cn/report/v3/api'
const REPORT_ENTRY_URL = 'https://oa.feishu.cn/report/record/entry'
const CSRF_TOKEN_URL = 'https://www.feishu.cn/lgw/csrf_token'
const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

interface ReportFieldDefinition {
  id: string
  title: string
  component: string
  validate?: string[]
  props?: {
    options?: string
  }
}

interface ReportFieldValue {
  id?: number
  fieldDefinitionId: string
  value: string
  valueType?: number
}

interface ReportForm {
  fieldDefinitions?: ReportFieldDefinition[]
  fieldValues?: ReportFieldValue[]
}

interface ReportRule {
  ruleId: string
  ruleName: string
  ruleIconName?: string
  ruleType?: number
  lastCommitTime?: number
  recentlyUsed?: number
  formSchema?: {
    fieldDefinitions?: ReportFieldDefinition[]
  }
}

interface ReportLastCommitInfo {
  reportId?: string
  commitTime?: number
}

interface ReportWriteView {
  ruleId?: string
  ruleName?: string
  ruleIconName?: string
  lastCommitInfo?: ReportLastCommitInfo
  form?: ReportForm
  [key: string]: unknown
}

interface ReportDetail extends ReportWriteView {
  id?: string
  commitTime?: number
}

interface ApiResponse<T> {
  code: number
  msg?: string
  data?: T
}

interface ReportContext {
  rule: ReportRule
  detail: ReportDetail
  fieldDefinitions: ReportFieldDefinition[]
  reportId: string | null
  submitted: boolean
  submittedAt: number | null
}

let cachedCsrfToken: string | null = null
let weeklyReportDraftDirty = false

/** 渲染层周报编辑草稿是否有未提交修改。 */
export const setWeeklyReportDraftDirty = (dirty: boolean): void => {
  weeklyReportDraftDirty = dirty
}

export const isWeeklyReportDraftDirty = (): boolean => weeklyReportDraftDirty

class WeeklyReportAuthRequiredError extends Error {}

const getBrowserSession = (): Electron.Session =>
  session.fromPartition(BROWSER_PARTITION)

const getCookieHeader = async (url: string): Promise<string> => {
  const cookies = await getBrowserSession().cookies.get({ url })

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}

const getWeekStart = (weekOffset = 0): number => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day + weekOffset * 7)
  return date.getTime()
}

/** 当前正在填写的周报周期；周一 08:00 前仍属于上一周。 */
const getReportWeekStart = (): number => {
  const now = new Date()
  const beforeMondayDeadline = now.getDay() === 1 && now.getHours() < 8
  return getWeekStart(beforeMondayDeadline ? -1 : 0)
}

const isInWeek = (timestampSeconds: number | undefined, weekStart: number): boolean => {
  if (!timestampSeconds) return false

  const timestamp = timestampSeconds * 1000

  return timestamp >= weekStart && timestamp < weekStart + 7 * 24 * 60 * 60 * 1000
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const createListId = (): string =>
  Math.random().toString(36).slice(2, 10)

const textToHtml = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
    )
    .join('')

interface ParsedFieldValue {
  html: string
  text: string
  at: unknown[]
  okr: unknown[]
}

const parseFieldValue = (raw: string): ParsedFieldValue => {
  if (!raw) return { html: '', text: '', at: [], okr: [] }

  try {
    const parsed = JSON.parse(raw) as {
      html?: unknown
      text?: unknown
      at?: unknown
      okr?: unknown
    }
    const text =
      typeof parsed.text === 'string'
        ? parsed.text.replace(/\n+$/, '')
        : ''
    const html =
      typeof parsed.html === 'string' && parsed.html.trim()
        ? parsed.html
        : textToHtml(text)

    return {
      html,
      text,
      at: Array.isArray(parsed.at) ? parsed.at : [],
      okr: Array.isArray(parsed.okr) ? parsed.okr : []
    }
  } catch {
    return {
      html: textToHtml(raw),
      text: raw,
      at: [],
      okr: []
    }
  }
}

interface QuillOp {
  insert?: unknown
  attributes?: Record<string, unknown>
}

interface RichLine {
  segments: Array<{
    text: string
    attributes?: Record<string, unknown>
  }>
  attributes?: Record<string, unknown>
}

const parseQuillLines = (ops: unknown): RichLine[] => {
  if (!Array.isArray(ops)) return []

  const lines: RichLine[] = []
  let segments: RichLine['segments'] = []

  for (const rawOp of ops) {
    const op = rawOp as QuillOp

    if (typeof op.insert !== 'string') continue

    const parts = op.insert.split('\n')

    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) {
        // Quill 把 list/header/blockquote 等块级格式放在换行 op 上。
        lines.push({ segments, attributes: op.attributes })
        segments = []
      }

      const text = parts[index]

      if (text) {
        segments.push({
          text,
          attributes: op.attributes
        })
      }
    }
  }

  if (segments.length > 0) lines.push({ segments })

  return lines
}

const toInlineAttributes = (
  source?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!source) return undefined

  const attributes: Record<string, unknown> = {}

  if (source.bold) attributes.bold = 'true'
  if (source.italic) attributes.italic = 'true'
  if (source.underline) attributes.underline = 'true'
  if (source.strike) attributes.strike = 'true'
  if (source.code) attributes.code = 'true'
  if (typeof source.color === 'string') attributes.color = source.color
  if (typeof source.background === 'string') {
    attributes.background = source.background
  }
  if (typeof source.link === 'string') {
    attributes.hyperlink = JSON.stringify({ href: source.link })
  }

  return Object.keys(attributes).length > 0 ? attributes : undefined
}

const quillDeltaToFeishuOps = (ops: unknown): Array<Record<string, unknown>> => {
  const lines = parseQuillLines(ops)
  const result: Array<Record<string, unknown>> = []
  let activeList: 'ordered' | 'bullet' | null = null
  let activeListId = ''
  let orderedIndex = 1

  for (const line of lines) {
    const lineAttributes = line.attributes ?? {}
    const list =
      lineAttributes.list === 'ordered'
        ? 'ordered'
        : lineAttributes.list === 'bullet'
          ? 'bullet'
          : null

    if (list !== activeList) {
      activeList = list
      activeListId = createListId()
      orderedIndex = 1
    }

    if (list) {
      const markerAttributes: Record<string, string> = {
        lmkr: '1',
        list: list === 'ordered' ? 'number1' : 'bullet1',
        'ol-id': activeListId
      }

      if (list === 'ordered') {
        markerAttributes['origin-start'] = String(orderedIndex)
        markerAttributes.start = String(orderedIndex)
        orderedIndex += 1
      }

      result.push({ attributes: markerAttributes, insert: '*' })
    } else if (lineAttributes.header) {
      const level = Number(lineAttributes.header)
      result.push({
        attributes: {
          lmkr: '1',
          heading: `h${Number.isFinite(level) && level > 0 ? level : 1}`
        },
        insert: '*'
      })
    } else if (lineAttributes.blockquote) {
      result.push({
        attributes: { lmkr: '1', blockquote: 'true' },
        insert: '*'
      })
    }

    for (const segment of line.segments) {
      const attributes = toInlineAttributes(segment.attributes)

      result.push({
        insert: segment.text,
        ...(attributes ? { attributes } : {})
      })
    }

    result.push({ insert: '\n' })
  }

  return result
}

const buildRichTextValue = (
  content: {
    html: string
    text: string
    delta: { ops: Array<Record<string, unknown>> }
  },
  existingRaw: string
): string => {
  const existing = parseFieldValue(existingRaw)
  let ops = quillDeltaToFeishuOps(content.delta.ops)

  // 编辑器尚未初始化时至少保留纯文本内容。
  if (ops.length === 0 && content.text) {
    ops = content.text
      .split('\n')
      .flatMap((line) => [{ insert: line }, { insert: '\n' }])
  }

  return JSON.stringify({
    html: content.html.trim() ? content.html : textToHtml(content.text),
    text: content.text.trim() ? `${content.text.replace(/\n+$/, '')}\n` : '',
    deltaSet: {
      _deltas: {
        '0': {
          ops,
          zoneId: '0',
          zoneType: 'Z'
        }
      }
    },
    isEmpty: !content.text.trim(),
    at: existing.at,
    okr: existing.okr
  })
}

const getApiHeaders = async (
  referer: string,
  csrfToken?: string
): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    accept: '*/*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'content-type': 'application/json',
    locale: 'zh',
    origin: 'https://oa.feishu.cn',
    referer,
    timezone: String(new Date().getTimezoneOffset()),
    'user-agent': USER_AGENT,
    'x-larkgw-use-lark-session': '1',
    'x-lgw-os-type': '3',
    'x-lgw-terminal-type': '2'
  }

  if (csrfToken) headers['x-lgw-csrf-token'] = csrfToken

  return headers
}

const getCsrfToken = async (): Promise<string> => {
  const browserSession = getBrowserSession()
  const cookies = await browserSession.cookies.get({
    url: 'https://oa.feishu.cn/'
  })
  const cookieToken = cookies.find(
    (cookie) => cookie.name === 'lgw_csrf_token'
  )?.value

  // 优先使用浏览器页面当前持有的 token，避免请求头和 Cookie 不一致。
  if (cookieToken) {
    cachedCsrfToken = cookieToken
    return cookieToken
  }

  if (cachedCsrfToken) return cachedCsrfToken

  const cookieHeader = await getCookieHeader('https://www.feishu.cn/')
  let responseToken: string | null = null

  try {
    const response = await fetch(CSRF_TOKEN_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
        ...(cookieHeader ? { cookie: cookieHeader } : {})
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    const setCookie = response.headers.get('set-cookie') ?? ''
    responseToken =
      setCookie.match(/lgw_csrf_token=([^;]+)/)?.[1] ?? null
  } catch {
    // 已有 Cookie 时继续尝试直接读取。
  }

  const token = responseToken

  if (!token) {
    throw new WeeklyReportAuthRequiredError('需要登录飞书周报')
  }

  cachedCsrfToken = token
  return token
}

const apiPost = async <T>(
  endpoint: string,
  body: unknown,
  referer: string,
  withCsrf = false
): Promise<T> => {
  const cookieHeader = await getCookieHeader('https://oa.feishu.cn/')

  if (!cookieHeader) {
    throw new WeeklyReportAuthRequiredError('需要登录飞书周报')
  }

  const csrfToken = withCsrf ? await getCsrfToken() : undefined
  const cookieWithoutCsrf = cookieHeader
    .replace(/(^|;\s*)lgw_csrf_token=[^;]*/g, '$1')
    .replace(/;\s*;+/g, ';')
    .replace(/^;\s*|;\s*$/g, '')
    .trim()
  const requestCookieHeader = csrfToken
    ? [cookieWithoutCsrf, `lgw_csrf_token=${csrfToken}`]
        .filter(Boolean)
        .join('; ')
    : cookieHeader
  const response = await fetch(`${REPORT_API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      ...(await getApiHeaders(referer, csrfToken)),
      cookie: requestCookieHeader
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await response.text()
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const looksLikeHtml = /^\s*</.test(text)

  if (
    response.status === 401 ||
    response.status === 403 ||
    !contentType.includes('application/json') ||
    looksLikeHtml ||
    !text.trim()
  ) {
    throw new WeeklyReportAuthRequiredError('飞书周报登录态失效')
  }

  let payload: ApiResponse<T>

  try {
    payload = JSON.parse(text) as ApiResponse<T>
  } catch {
    throw new Error('飞书周报接口返回了无法解析的内容')
  }

  if (
    response.status === 401 ||
    response.status === 403 ||
    payload.code === 99991668
  ) {
    throw new WeeklyReportAuthRequiredError('飞书周报登录态失效')
  }

  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || `飞书周报请求失败（${response.status}）`)
  }

  return payload.data as T
}

const getWeeklyRule = async (): Promise<ReportRule> => {
  const data = await apiPost<{ userRuleWriteViewVOList?: ReportRule[] }>(
    'GetUserRuleWriteViewList',
    {},
    REPORT_ENTRY_URL
  )
  const rules = data.userRuleWriteViewVOList ?? []
  const weeklyRules = rules
    .filter(
      (rule) =>
        rule.ruleType === 1 ||
        rule.ruleIconName === 'weekReportIcon' ||
        rule.ruleName.includes('周报')
    )
    .sort((left, right) => (right.recentlyUsed ?? 0) - (left.recentlyUsed ?? 0))

  const rule = weeklyRules[0]

  if (!rule) {
    throw new Error('没有找到可填写的飞书个人工作周报规则')
  }

  return rule
}

const getWriteView = async (ruleId: string): Promise<ReportWriteView> => {
  const data = await apiPost<{
    userRuleWriteViewWriteVO?: ReportWriteView
  }>(
    'GetUserRuleWriteView',
    {
      ruleId,
      isSupply: 0,
      commitTime: 0
    },
    `https://oa.feishu.cn/report/record/detail?ruleId=${encodeURIComponent(ruleId)}&editMode=true`
  )

  if (!data.userRuleWriteViewWriteVO) {
    throw new Error('无法读取飞书周报内容')
  }

  return data.userRuleWriteViewWriteVO
}

const getCommittedDetail = async (reportId: string): Promise<ReportDetail> => {
  const data = await apiPost<{ reportDetail?: ReportDetail }>(
    'GetCommittedReportDetail',
    { id: reportId },
    `https://oa.feishu.cn/report/record/detail?reportId=${encodeURIComponent(reportId)}&editMode=true`
  )

  if (!data.reportDetail) {
    throw new Error('无法读取飞书周报详情')
  }

  return data.reportDetail
}

const loadReportContext = async (
  weekStart = getWeekStart()
): Promise<ReportContext> => {
  const rule = await getWeeklyRule()
  const writeView = await getWriteView(rule.ruleId)
  const lastCommitInfo = writeView.lastCommitInfo
  const submitted =
    isInWeek(lastCommitInfo?.commitTime, weekStart) ||
    isInWeek(rule.lastCommitTime, weekStart)
  let detail: ReportDetail = writeView
  let reportId: string | null = null

  if (submitted && lastCommitInfo?.reportId) {
    reportId = lastCommitInfo.reportId
    detail = await getCommittedDetail(reportId)
  }

  const fieldDefinitions =
    detail.form?.fieldDefinitions ??
    writeView.form?.fieldDefinitions ??
    rule.formSchema?.fieldDefinitions ??
    []

  return {
    rule,
    detail,
    fieldDefinitions,
    reportId,
    submitted,
    submittedAt:
      (lastCommitInfo?.commitTime ?? rule.lastCommitTime ?? 0) > 0
        ? (lastCommitInfo?.commitTime ?? rule.lastCommitTime ?? 0) * 1000
        : null
  }
}

const toState = (context: ReportContext): WeeklyReportState => {
  const valueMap = new Map(
    (context.detail.form?.fieldValues ?? []).map((fieldValue) => [
      fieldValue.fieldDefinitionId,
      fieldValue.value
    ])
  )

  const fields: WeeklyReportField[] = context.fieldDefinitions.map((field) => {
    const parsed = parseFieldValue(valueMap.get(field.id) ?? '')

    return {
      id: field.id,
      title: field.title,
      required: field.validate?.includes('required') ?? false,
      component: field.component,
      html: parsed.html,
      text: parsed.text
    }
  })

  return {
    ruleId: context.rule.ruleId,
    ruleName: context.rule.ruleName,
    ruleIconName: context.rule.ruleIconName ?? '',
    reportId: context.reportId,
    submitted: context.submitted,
    submittedAt: context.submittedAt,
    fields
  }
}

/**
 * 未登录时打开飞书周报页，轮询到登录成功后关闭面板并重试原操作。
 */
const withWeeklyReportAuth = <T>(
  window: BrowserWindow,
  operation: () => Promise<T>
): Promise<T> =>
  withBrowserAuth(window, {
    authName: '飞书周报',
    loginUrl: REPORT_ENTRY_URL,
    operation,
    // 以读取汇报规则成功作为登录完成信号。
    probe: getWeeklyRule,
    isAuthError: (error) => error instanceof WeeklyReportAuthRequiredError
  })

/** 自动提交使用：读取上一周周报状态，但不启动登录授权流程。 */
export const getWeeklyReportForAuto = async (): Promise<WeeklyReportState> =>
  toState(await loadReportContext(getWeekStart(-1)))

/**
 * 读取当前用户的本周周报。
 */
export const getWeeklyReport = async (
  window: BrowserWindow
): Promise<WeeklyReportState> =>
  withWeeklyReportAuth(window, async () => {
    const context = await loadReportContext(getReportWeekStart())

    return toState(context)
  })

/**
 * 提交周报。
 * 内部接口不是飞书开放平台 API，提交前会保留页面二次确认。
 */
const isReportRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** IPC 类型声明不等于运行时校验；完整检查后才允许进入授权和网络提交流程。 */
const validateWeeklyReportInput = (value: unknown): SubmitWeeklyReportInput => {
  if (!isReportRecord(value)) throw new Error('周报参数不合法')
  if (typeof value.ruleId !== 'string' || !value.ruleId.trim()) {
    throw new Error('周报规则不合法')
  }
  if (!Array.isArray(value.fields)) throw new Error('周报内容不合法')

  const ids = new Set<string>()
  for (const [index, field] of value.fields.entries()) {
    const label = `周报第 ${index + 1} 个字段`
    if (!isReportRecord(field) || typeof field.id !== 'string' || !field.id.trim()) {
      throw new Error(`${label} ID 不合法`)
    }
    if (ids.has(field.id)) throw new Error(`${label} ID 重复`)
    ids.add(field.id)
    if (typeof field.text !== 'string' || typeof field.html !== 'string') {
      throw new Error(`${label}文本格式不合法`)
    }
    if (!isReportRecord(field.delta) || !Array.isArray(field.delta.ops)) {
      throw new Error(`${label}富文本格式不合法`)
    }
    // 提交的是编辑器内容快照：支持文本或嵌入对象，不接受 retain/delete 增量操作。
    for (const op of field.delta.ops) {
      if (!isReportRecord(op) ||
          (typeof op.insert !== 'string' && !isReportRecord(op.insert)) ||
          'retain' in op || 'delete' in op ||
          (op.attributes !== undefined && !isReportRecord(op.attributes))) {
        throw new Error(`${label}富文本操作不合法`)
      }
    }
  }

  // 校验不改写或截断文本、HTML 和 Delta，交给现有转换逻辑处理。
  return value as unknown as SubmitWeeklyReportInput
}

const submitWeeklyReportInternal = async (
  input: SubmitWeeklyReportInput,
  weekStart = getWeekStart()
): Promise<WeeklyReportState> => {
  if (!input || typeof input !== 'object') {
    throw new Error('周报参数不合法')
  }

  if (typeof input.ruleId !== 'string' || !input.ruleId.trim()) {
    throw new Error('周报规则不合法')
  }

  if (!Array.isArray(input.fields)) {
    throw new Error('周报内容不合法')
  }

  const context = await loadReportContext(weekStart)

  if (context.rule.ruleId !== input.ruleId) {
    throw new Error('周报规则已变化，请刷新后重试')
  }

  const inputMap = new Map(
    input.fields.map((field) => [field.id, field])
  )
  const existingValues = new Map(
    (context.detail.form?.fieldValues ?? []).map((fieldValue) => [
      fieldValue.fieldDefinitionId,
      fieldValue
    ])
  )

  const fieldValues = context.fieldDefinitions.map((field) => {
    const existing = existingValues.get(field.id)
    const inputField = inputMap.get(field.id)

    if (field.component !== 'text' || inputField === undefined) {
      return (
        existing ?? {
          id: 0,
          fieldDefinitionId: field.id,
          value: '',
          valueType: 0
        }
      )
    }

    if (
      field.validate?.includes('required') &&
      !inputField.text.trim()
    ) {
      throw new Error(`请填写「${field.title}」`)
    }

    return {
      id: existing?.id ?? 0,
      fieldDefinitionId: field.id,
      value: buildRichTextValue(
        {
          html: inputField.html ?? '',
          text: inputField.text ?? '',
          delta: inputField.delta ?? { ops: [] }
        },
        existing?.value ?? ''
      ),
      valueType: 1
    }
  })

  const reportDetail: ReportDetail = {
    id: context.detail.id,
    ruleName: context.detail.ruleName,
    ruleId: context.detail.ruleId,
    commitTime: 0,
    form: {
      ...(context.detail.form ?? {}),
      fieldDefinitions: context.fieldDefinitions,
      fieldValues
    },
    ccGroupRules: context.detail.ccGroupRules,
    fromUser: context.detail.fromUser,
    toGroupRules: context.detail.toGroupRules,
    systemTemplateType: context.detail.systemTemplateType,
    ruleIconName: context.detail.ruleIconName,
    isEmptyReport: context.detail.isEmptyReport,
    canForward: context.detail.canForward,
    locationInfo: context.detail.locationInfo,
    ruleControlVersion: context.detail.ruleControlVersion
  }

  await apiPost(
    'PutReportDetail',
    { reportDetail },
    `https://oa.feishu.cn/report/record/detail?${
      context.reportId
        ? `reportId=${encodeURIComponent(context.reportId)}`
        : `ruleId=${encodeURIComponent(context.rule.ruleId)}`
    }&editMode=true`,
    true
  )

  try {
    return toState(await loadReportContext(weekStart))
  } catch (error) {
    if (!(error instanceof WeeklyReportAuthRequiredError)) throw error

    return toState({
      ...context,
      detail: reportDetail,
      submitted: true,
      submittedAt: Date.now()
    })
  }
}

/**
 * 提交周报。
 * 内部接口不是飞书开放平台 API，提交前会保留页面二次确认。
 */
export const submitWeeklyReport = async (
  window: BrowserWindow,
  value: unknown
): Promise<WeeklyReportState> => {
  const input = validateWeeklyReportInput(value)
  return withWeeklyReportAuth(window, () =>
    submitWeeklyReportInternal(input, getReportWeekStart())
  )
}

/** 自动提交使用：按上一周周报周期校验并提交。 */
export const submitWeeklyReportForAuto = async (
  window: BrowserWindow,
  value: unknown
): Promise<WeeklyReportState> => {
  const input = validateWeeklyReportInput(value)
  return withWeeklyReportAuth(window, () =>
    submitWeeklyReportInternal(input, getWeekStart(-1))
  )
}

export const initializeWeeklyReport = (): void => {
  ipcMain.handle('weekly-report:get', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) throw new Error('无法获取当前窗口')

    return getWeeklyReport(window)
  })
  ipcMain.handle('weekly-report:submit', (event, input: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    if (!window) throw new Error('无法获取当前窗口')

    return submitWeeklyReport(window, input)
  })
  ipcMain.on('weekly-report:set-draft-dirty', (_event, dirty: unknown) => {
    weeklyReportDraftDirty = dirty === true
  })
}
