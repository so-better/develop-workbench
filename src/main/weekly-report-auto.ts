/**
 * 周报自动提交。
 * 在本地周一 00:00 检查上一周周报，未提交且内容为空时生成并提交。
 */
import { app, ipcMain } from 'electron'
import { generateText } from 'ai'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getMainWindow } from './window'
import { resolveAiModel } from './ai/models'
import { getWeeklyWorkContext } from './weekly-work'
import {
  getWeeklyReportForAuto,
  isWeeklyReportDraftDirty,
  setWeeklyReportDraftDirty,
  submitWeeklyReportForAuto
} from './weekly-report'
import type {
  SubmitWeeklyReportInput,
  WeeklyReportAutoState,
  WeeklyReportAutoStatus,
  WeeklyReportField,
  WeeklyReportState
} from '../types/weekly-report'
import { sendLarkMessageToSelf } from './lark'
import { isRecord } from '../utils'

const AUTO_SUBMIT_HOUR = 0
const AUTO_SUBMIT_MINUTE = 0
const MAX_OUTPUT_TOKENS = 4_096
const TEXT_FIELD_TYPE = 'text'

type AutoSubmitResult = 'submitted' | 'skipped' | 'failed'

let timer: NodeJS.Timeout | null = null
let retryTimer: NodeJS.Timeout | null = null
let retryCount = 0
let running = false
let lastRunSkippedByDeadline = false
let statusWriteQueue: Promise<void> = Promise.resolve()
let autoStatus: WeeklyReportAutoStatus = {
  state: 'idle',
  message: null,
  weekStart: null,
  notificationError: null,
  updatedAt: null
}

const getPreviousWeekStartTime = (now = new Date()): number => {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day - 7)
  return date.getTime()
}

const getAutoStatusPath = (): string =>
  join(app.getPath('userData'), 'weekly-report-auto-status.json')

const loadPersistedStatus = (): void => {
  try {
    const parsed = JSON.parse(
      readFileSync(getAutoStatusPath(), 'utf8')
    ) as Partial<WeeklyReportAutoStatus>

    if (
      parsed.state === 'idle' ||
      parsed.state === 'running' ||
      parsed.state === 'submitted' ||
      parsed.state === 'skipped' ||
      parsed.state === 'failed'
    ) {
      autoStatus = {
        state: parsed.state === 'running' ? 'idle' : parsed.state,
        message: typeof parsed.message === 'string' ? parsed.message : null,
        weekStart:
          typeof parsed.weekStart === 'number' ? parsed.weekStart : null,
        notificationError:
          typeof parsed.notificationError === 'string'
            ? parsed.notificationError
            : null,
        updatedAt:
          typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null
      }
    }
  } catch {
    // 首次运行或状态文件损坏时使用 idle。
  }
}

const setAutoStatus = (
  state: WeeklyReportAutoState,
  message: string | null = null,
  notificationError: string | null = null,
  weekStart = autoStatus.weekStart ?? getPreviousWeekStartTime()
): void => {
  autoStatus = {
    state,
    message,
    weekStart,
    notificationError,
    updatedAt: Date.now()
  }

  statusWriteQueue = statusWriteQueue
    .then(() =>
      writeFile(
        getAutoStatusPath(),
        JSON.stringify(autoStatus, null, 2),
        'utf8'
      )
    )
    .catch(() => undefined)
}

const log = (message: string, detail?: unknown): void => {
  if (detail === undefined) {
    console.info(`[weekly-report-auto] ${message}`)
    return
  }

  console.info(`[weekly-report-auto] ${message}`, detail)
}

const logError = (message: string, error: unknown): void => {
  console.error(`[weekly-report-auto] ${message}`, error)
}

const formatLocalDateTime = (date: Date): string =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const textToHtml = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
    )
    .join('')

const getNextAutoSubmitTime = (from: Date): Date => {
  const next = new Date(from)

  next.setHours(AUTO_SUBMIT_HOUR, AUTO_SUBMIT_MINUTE, 0, 0)
  const day = next.getDay()
  const daysUntilMonday = (1 - day + 7) % 7

  next.setDate(next.getDate() + daysUntilMonday)

  // 若今天已经过触发时间，安排到下一个周一。
  if (next.getTime() <= from.getTime()) {
    next.setDate(next.getDate() + 7)
  }

  return next
}

const isCatchUpWindow = (now: Date): boolean => {
  if (now.getDay() !== 1) return false

  const trigger = new Date(now)
  trigger.setHours(AUTO_SUBMIT_HOUR, AUTO_SUBMIT_MINUTE, 0, 0)

  const deadline = new Date(now)
  deadline.setHours(8, 0, 0, 0)

  // 周一 00:00-08:00 允许补跑；实际运行时通常会在 00:00 或应用唤醒后立即执行。
  return now >= trigger && now < deadline
}

const getDeadline = (now = new Date()): Date => {
  const deadline = new Date(now)
  deadline.setHours(8, 0, 0, 0)
  return deadline
}

const isBeforeDeadline = (now = new Date()): boolean => now < getDeadline(now)

const parseGeneratedFields = (content: string): Record<string, string> => {
  let value = content.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value)

  if (fenced) value = fenced[1].trim()

  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')

  if (start < 0 || end <= start) {
    throw new Error('AI 没有返回 JSON 周报内容')
  }

  const parsed: unknown = JSON.parse(value.slice(start, end + 1))

  if (!isRecord(parsed)) {
    throw new Error('AI 返回的周报内容格式不正确')
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, text]) => [key, text.trim()])
      .filter(([, text]) => Boolean(text))
  )
}

const getFieldText = (
  generated: Record<string, string>,
  field: WeeklyReportField
): string => generated[field.id] ?? generated[field.title] ?? ''

const createPrompt = (
  state: WeeklyReportState,
  textFields: WeeklyReportField[],
  workContext: Awaited<ReturnType<typeof getWeeklyWorkContext>>
): string =>
  [
    '你是研发工作台的周报助手。请根据周报周期内的工作数据和周报字段，生成可以直接提交的中文周报。',
    '只输出 JSON 对象，不要 Markdown、代码块、解释或前后缀。',
    'JSON 的 key 必须是下面给出的字段 id，value 是纯文本。',
    '必须覆盖所有必填字段；不要编造数据，数据缺失时如实写“暂未记录”。',
    '',
    `周报规则：${state.ruleName}`,
    '',
    '周报周期内工作数据：',
    JSON.stringify(workContext, null, 2),
    '',
    '周报字段：',
    ...textFields.map(
      (field) =>
        `- id=${field.id}，标题=${field.title}，必填=${field.required ? '是' : '否'}`
    ),
    '',
    '字段 id 和标题的对应关系必须严格使用上面的值。'
  ].join('\n')

const createSubmitInput = (
  state: WeeklyReportState,
  textFields: WeeklyReportField[],
  generated: Record<string, string>
): SubmitWeeklyReportInput | null => {
  const fields: SubmitWeeklyReportInput['fields'] = []

  for (const field of textFields) {
    const text = getFieldText(generated, field)

    if (!text) {
      if (field.required) {
        throw new Error(`AI 未生成必填字段「${field.title}」`)
      }

      continue
    }

    fields.push({
      id: field.id,
      text,
      html: textToHtml(text),
      delta: { ops: [] }
    })
  }

  if (fields.length === 0) return null

  return {
    ruleId: state.ruleId,
    fields
  }
}

const hasExistingContent = (state: WeeklyReportState): boolean =>
  state.fields.some(
    (field) =>
      field.component === TEXT_FIELD_TYPE && field.text.trim().length > 0
  )

const runAutoSubmit = async (): Promise<AutoSubmitResult> => {
  lastRunSkippedByDeadline = false

  if (running) return 'skipped'

  if (!isBeforeDeadline()) {
    lastRunSkippedByDeadline = true
    setAutoStatus('skipped', '已超过 08:00 截止时间')
    log('跳过：已超过 08:00 截止时间')
    return 'skipped'
  }

  const window = getMainWindow()

  if (!window || window.isDestroyed()) {
    setAutoStatus('failed', '没有可用主窗口')
    log('跳过：没有可用主窗口')
    return 'failed'
  }

  running = true
  setAutoStatus('running', null, null, getPreviousWeekStartTime())

  try {
    const state = await getWeeklyReportForAuto()

    if (state.submitted) {
      setAutoStatus('skipped', '上一周周报已提交')
      log('跳过：上一周周报已提交')
      return 'skipped'
    }

    if (hasExistingContent(state) || isWeeklyReportDraftDirty()) {
      setAutoStatus('skipped', '周报已有内容或正在编辑')
      log('跳过：周报已有内容或正在编辑，不覆盖用户填写')
      return 'skipped'
    }

    const textFields = state.fields.filter(
      (field) => field.component === TEXT_FIELD_TYPE
    )

    if (textFields.length === 0) {
      setAutoStatus('skipped', '周报没有可填写的文本字段')
      log('跳过：周报没有可填写的文本字段')
      return 'skipped'
    }

    const workContext = await getWeeklyWorkContext('last')
    const criticalWarnings = workContext.warnings.filter(
      (warning) =>
        warning.includes('需求读取失败') ||
        warning.includes('缺陷读取失败') ||
        warning.includes('代码提交读取失败')
    )

    if (criticalWarnings.length > 0) {
      const message = `本周数据读取不完整：${criticalWarnings.join('；')}`
      setAutoStatus('failed', message)
      log('失败：数据读取不完整，不自动提交', message)
      return 'failed'
    }

    const model = await resolveAiModel()
    const result = await generateText({
      model: model.model,
      prompt: createPrompt(state, textFields, workContext),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(180_000)
    })
    const generated = parseGeneratedFields(result.text)
    const input = createSubmitInput(state, textFields, generated)

    if (!input) {
      setAutoStatus('skipped', 'AI 没有生成可提交内容')
      log('跳过：AI 没有生成可提交内容')
      return 'skipped'
    }

    if (!isBeforeDeadline()) {
      setAutoStatus('failed', 'AI 生成完成时已超过 08:00，未提交')
      log('失败：AI 生成完成时已超过 08:00，不提交')
      return 'failed'
    }

    await submitWeeklyReportForAuto(window, input)
    setWeeklyReportDraftDirty(false)
    setAutoStatus('submitted', '上一周周报已自动提交')
    log('自动提交成功', { ruleId: input.ruleId, fields: input.fields.length })
    return 'submitted'
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '自动提交失败'
    setAutoStatus('failed', message)
    logError('自动提交失败', error)
    return 'failed'
  } finally {
    running = false
  }
}

const notifyWeeklyReportResult = async (
  success: boolean,
  detail?: string | null
): Promise<void> => {
  const message = success
    ? '上一周周报已由工作台自动提交，无需重复提交。'
    : `上一周周报自动提交失败${detail ? `：${detail}` : ''}`

  try {
    await sendLarkMessageToSelf(message)
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : '发送飞书通知失败'
    setAutoStatus(
      autoStatus.state,
      autoStatus.message,
      detail,
      autoStatus.weekStart ?? getPreviousWeekStartTime()
    )
    logError('发送飞书通知失败', error)
  }
}

const runAutoSubmitWithRetry = async (): Promise<void> => {
  const retryAttempt = retryCount > 0
  const result = await runAutoSubmit()

  // 最后一次重试恰好跨过 08:00 时，runAutoSubmit 会返回 skipped；
  // 此时仍需通知用户自动提交最终失败，而不是静默结束。
  if (retryAttempt && result === 'skipped' && lastRunSkippedByDeadline) {
    retryCount = 0
    await notifyWeeklyReportResult(false, autoStatus.message)
    return
  }

  if (result === 'submitted') {
    retryCount = 0
    await notifyWeeklyReportResult(true)
    return
  }

  if (result !== 'failed') {
    retryCount = 0
    return
  }

  if (retryCount >= 5 || !isBeforeDeadline()) {
    retryCount = 0
    await notifyWeeklyReportResult(false, autoStatus.message)
    return
  }

  const delay = Math.min(
    2 * 60 * 1000,
    getDeadline().getTime() - Date.now() - 1_000
  )

  if (delay <= 0) {
    retryCount = 0
    await notifyWeeklyReportResult(false, autoStatus.message)
    return
  }

  retryCount += 1
  log('安排自动提交重试', `第 ${retryCount} 次`)
  retryTimer = setTimeout(() => {
    retryTimer = null
    void runAutoSubmitWithRetry()
  }, delay)
}

const scheduleNext = (): void => {
  if (timer) clearTimeout(timer)

  const now = new Date()
  const next = getNextAutoSubmitTime(now)
  const delay = Math.max(1_000, next.getTime() - now.getTime())

  log('安排下一次自动提交', formatLocalDateTime(next))
  timer = setTimeout(() => {
    void runAutoSubmitWithRetry().finally(scheduleNext)
  }, delay)
}

/**
 * 初始化周报自动提交。
 * 只负责周一触发和上一周状态检查，失败不会影响应用启动。
 */
export const initializeWeeklyReportAutoSubmit = (): void => {
  loadPersistedStatus()
  ipcMain.handle('weekly-report:auto-status', () => autoStatus)

  const now = new Date()

  if (isCatchUpWindow(now)) {
    void runAutoSubmitWithRetry()
  }

  scheduleNext()

  app.once('before-quit', () => {
    if (timer) clearTimeout(timer)
    if (retryTimer) clearTimeout(retryTimer)
    timer = null
    retryTimer = null
  })
}
