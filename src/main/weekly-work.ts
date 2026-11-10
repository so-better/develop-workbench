/**
 * 周报工作上下文。
 * 汇总指定周（当前周或上一周）的 Meegle/本地需求、已解决缺陷和代码提交，供 AI 一次读取。
 */
import { getWeeklyResolvedDefects } from './defects'
import {
  getWeeklyRepositoryCommits
} from './repositories'
import type { RepositoryCommitSummary } from './repositories'
import { getWeeklyWorkItems } from './requirements'
import type { WeeklyWorkItem } from './requirements'

// 控制单次周报上下文输出规模。
const MAX_FIXED_DEFECTS = 20
const MAX_COMMITS = 50
const MAX_DEFECT_DESCRIPTION = 200

/** 将文本压成单行并截断。 */
const compactText = (value: string | null, maxLength: number): string => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

/** 返回本地周（当前周或上一周）的周一和周日。 */
const getWeekRange = (
  week: 'current' | 'last' = 'current'
): { start: string; end: string } => {
  const start = new Date()
  const day = start.getDay() || 7

  start.setDate(start.getDate() - day + 1)
  if (week === 'last') start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)

  const formatDate = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const dayOfMonth = String(date.getDate()).padStart(2, '0')

    return `${date.getFullYear()}-${month}-${dayOfMonth}`
  }

  return {
    start: formatDate(start),
    end: formatDate(end)
  }
}

/** 周报中使用的已解决缺陷摘要。 */
export interface WeeklyFixedDefect {
  /** 缺陷 ID。 */
  id: string

  /** 缺陷标题。 */
  name: string

  /** 当前状态。 */
  status: string | null

  /** 优先级。 */
  priority: string | null

  /** 缺陷等级。 */
  severity: string | null

  /** 所属迭代。 */
  iteration: string | null

  /** 完成时间。 */
  completedAt: string | null

  /** 关联需求标题。 */
  linkedRequirement: string | null

  /** 解决版本。 */
  fixedVersions: string[]

  /** 解决人。 */
  resolver: string | null

  /** 详细描述摘要。 */
  description: string
}

/** 周报 AI 工具返回的完整周上下文。 */
export interface WeeklyWorkContext {
  /** 周报周期开始日期。 */
  weekStart: string

  /** 周报周期结束日期。 */
  weekEnd: string

  /** 周报周期内 Meegle 和本地临时需求。 */
  requirements: WeeklyWorkItem[]

  /** 需求总数，items 可能被截断。 */
  requirementTotal: number

  /** 需求读取说明。 */
  requirementsNote: string

  /** 周报周期内解决的缺陷。 */
  fixedDefects: WeeklyFixedDefect[]

  /** 缺陷总数，fixedDefects 可能被截断。 */
  fixedDefectTotal: number

  /** 周报周期内代码提交。 */
  commits: RepositoryCommitSummary[]

  /** 提交总数，commits 可能被截断。 */
  commitTotal: number

  /** 单个数据源失败时的提示。 */
  warnings: string[]
}

/**
 * 一次读取指定周的需求、已解决缺陷和代码提交。
 * 单个数据源失败时不阻断其他来源，将失败原因放入 warnings。
 */
export const getWeeklyWorkContext = async (
  weekType: 'current' | 'last' = 'current'
): Promise<WeeklyWorkContext> => {
  const week = getWeekRange(weekType)
  const since = new Date(`${week.start}T00:00:00`).toISOString()
  const until = new Date(`${week.end}T23:59:59.999`).toISOString()
  const [requirementsResult, defectsResult, commitsResult] =
    await Promise.allSettled([
      getWeeklyWorkItems(weekType),
      getWeeklyResolvedDefects(weekType),
      getWeeklyRepositoryCommits(since, until)
    ])
  const warnings: string[] = []
  const requirements =
    requirementsResult.status === 'fulfilled'
      ? requirementsResult.value.items
      : []
  const requirementTotal =
    requirementsResult.status === 'fulfilled'
      ? requirementsResult.value.total
      : 0
  const requirementsNote =
    requirementsResult.status === 'fulfilled'
      ? requirementsResult.value.note
      : ''

  if (requirementsResult.status === 'rejected') {
    warnings.push(
      `周报周期内需求读取失败：${getErrorMessage(requirementsResult.reason)}`
    )
  }

  const defects =
    defectsResult.status === 'fulfilled' ? defectsResult.value.defects : []
  const fixedDefects = defects
    .slice(0, MAX_FIXED_DEFECTS)
    .map<WeeklyFixedDefect>((defect) => ({
      id: defect.id,
      name: defect.name,
      status: defect.status,
      priority: defect.priority,
      severity: defect.severity,
      iteration: defect.iterationName,
      completedAt: defect.completedAt,
      linkedRequirement: defect.linkedRequirement?.name ?? null,
      fixedVersions: defect.fixedVersions,
      resolver: defect.resolver?.name ?? null,
      description: compactText(
        defect.description,
        MAX_DEFECT_DESCRIPTION
      )
    }))

  if (defectsResult.status === 'rejected') {
    warnings.push(
      `周报周期内已解决缺陷读取失败：${getErrorMessage(defectsResult.reason)}`
    )
  }

  const commits =
    commitsResult.status === 'fulfilled'
      ? commitsResult.value.commits.slice(0, MAX_COMMITS)
      : []

  if (commitsResult.status === 'fulfilled') {
    warnings.push(...commitsResult.value.warnings)
  } else {
    warnings.push(
      `周报周期内代码提交读取失败：${getErrorMessage(commitsResult.reason)}`
    )
  }

  return {
    weekStart: week.start,
    weekEnd: week.end,
    requirements,
    requirementTotal,
    requirementsNote,
    fixedDefects,
    fixedDefectTotal:
      defectsResult.status === 'fulfilled'
        ? defectsResult.value.total
        : 0,
    commits,
    commitTotal:
      commitsResult.status === 'fulfilled'
        ? commitsResult.value.commits.length
        : 0,
    warnings
  }
}

/** 提取错误首行，避免把完整堆栈塞进工具结果。 */
const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message.split(/\r?\n/)[0].trim() : '未知错误'
