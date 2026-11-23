/**
 * 轻舟接口客户端。
 * 复用内嵌浏览器的持久化 Session，避免在应用数据中保存 Cookie 或 Token。
 */
import { BrowserWindow, session } from 'electron'
import { BROWSER_PARTITION } from './embedded-browser'
import { withBrowserAuth } from './browser-auth'

/** 查询轻舟工作项代码任务的接口。 */
const CODE_TASKS_URL =
  'https://z.xlbsoft.com/api/efficiency/api/v1/workitem/requirement/code-tasks'

/** 轻舟需求页面地址，用于登录和打开具体工作项。 */
const QINGZHOU_REQUIREMENT_URL = 'https://z.xlbsoft.com/workList/requirement'

/**
 * 代码任务关联的分支信息。
 * 轻舟接口同时返回需求分支和迭代分支，迭代分支 ID 才是构建页地址需要的字段。
 */
interface CodeTaskBranchInfo {
  /** 需求分支名称。 */
  branchName?: string

  /** 迭代分支 ID，用于拼接 /workList/branch/{id}。 */
  iterationBranchId?: number | string

  /** 迭代分支名称。 */
  iterationBranchName?: string

  /** 代码仓库地址。 */
  repositoryUrl?: string

  /** 代码任务关联的迭代分支列表，部分环境只在该列表返回分支信息。 */
  iterationBranches?: Array<{
    /** 迭代分支 ID。 */
    iterationBranchId?: number | string

    /** 迭代分支名称。 */
    iterationBranchName?: string
  }>
}

/**
 * 轻舟代码任务原始返回结构。
 */
interface CodeTask {
  /** 代码任务 ID。 */
  id?: string

  /** 所属轻舟工作项 ID。 */
  workItemId?: string

  /** 工作项标题。 */
  workItemTitle?: string

  /** 轻舟代码仓库名称。 */
  codeRepository?: string

  /** 轻舟代码仓库 ID，用于打开带仓库筛选的任务列表。 */
  codeRepositoryId?: number | string

  /** 是否已归档。 */
  isArchived?: boolean

  /** 是否被强制归档。 */
  forceArchived?: boolean

  /** 分支信息。 */
  branchInfo?: CodeTaskBranchInfo | null
}

/**
 * code-tasks 接口返回结构。
 */
interface CodeTasksResponse {
  code?: number
  msg?: string
  data?: {
    tasks?: CodeTask[]
    total?: number
  } | null
}

/**
 * 转换后的轻舟代码任务摘要。
 * 供绑定层持久化，避免渲染层直接依赖接口原始字段。
 */
export interface QingzhouCodeTaskDetail {
  /** 代码任务 ID；尚未创建任务时为 null。 */
  codeTaskId: string | null

  /** 轻舟工作项 ID，通常与飞书需求 ID 相同。 */
  workItemId: string

  /** 轻舟工作项标题。 */
  workItemTitle: string | null

  /** 代码仓库名称。 */
  repositoryName: string | null

  /** 代码仓库地址。 */
  repositoryUrl: string | null

  /** 轻舟代码仓库 ID。 */
  codeRepositoryId: string | null

  /** 需求分支名称。 */
  requirementBranch: string | null

  /** 迭代分支名称。 */
  iterationBranch: string | null

  /** 迭代分支 ID，用于打开构建页。 */
  iterationBranchId: string | null

  /** 代码任务是否已归档。 */
  archived: boolean
}

/** 仅用于内部控制登录跳转，不向渲染层暴露。 */
class QingzhouAuthRequiredError extends Error {}

/**
 * 将轻舟任务转换成绑定层使用的结构。
 * 工作项存在但尚未创建代码任务时，分支和代码任务 ID 都允许为空。
 */
const normalizeCodeTask = (
  task: CodeTask,
  fallbackWorkItemId: string
): QingzhouCodeTaskDetail => {
  // 需求分支是 branchName；迭代分支优先取顶层字段，兼容只返回列表的情况。
  const branchInfo = task.branchInfo ?? null
  const iterationBranch =
    branchInfo?.iterationBranchName?.trim() ||
    branchInfo?.iterationBranches?.[0]?.iterationBranchName?.trim() ||
    null
  // 优先使用顶层迭代分支 ID，兼容只在 iterationBranches 列表返回的情况。
  const iterationBranchId =
    branchInfo?.iterationBranchId ??
    branchInfo?.iterationBranches?.[0]?.iterationBranchId

  return {
    codeTaskId: task.id?.trim() || null,
    workItemId: task.workItemId?.trim() || fallbackWorkItemId,
    workItemTitle: task.workItemTitle?.trim() || null,
    repositoryName: task.codeRepository?.trim() || null,
    repositoryUrl: branchInfo?.repositoryUrl?.trim() || null,
    codeRepositoryId:
      task.codeRepositoryId !== undefined && task.codeRepositoryId !== null
        ? String(task.codeRepositoryId).trim() || null
        : null,
    requirementBranch: branchInfo?.branchName?.trim() || null,
    iterationBranch,
    iterationBranchId:
      iterationBranchId !== undefined && iterationBranchId !== null
        ? String(iterationBranchId).trim() || null
        : null,
    archived: Boolean(task.isArchived || task.forceArchived)
  }
}

/**
 * 通过 workItemId 查询代码任务。
 * 非 JSON 响应或 401/403 都按未登录处理，交给内嵌浏览器完成 OAuth。
 */
const requestCodeTasks = async (
  workItemId: string
): Promise<QingzhouCodeTaskDetail[]> => {
  const browserSession = session.fromPartition(BROWSER_PARTITION)
  const cookies = await browserSession.cookies.get({
    url: 'https://z.xlbsoft.com/'
  })
  const cookieHeader = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ')
  const response = await fetch(CODE_TASKS_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      origin: 'https://z.xlbsoft.com',
      referer: `${QINGZHOU_REQUIREMENT_URL}/${encodeURIComponent(workItemId)}`,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      ...(cookieHeader ? { cookie: cookieHeader } : {})
    },
    // 首次查询只带工作项 ID；仓库 ID 从响应中保存，仅用于后续任务页链接。
    body: JSON.stringify({ workItemId }),
    signal: AbortSignal.timeout(15_000)
  })
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

  if (
    response.status === 401 ||
    response.status === 403 ||
    !contentType.includes('application/json')
  ) {
    throw new QingzhouAuthRequiredError('需要登录轻舟')
  }

  const payload = (await response.json()) as CodeTasksResponse

  if (payload.code !== 0) {
    throw new Error(payload.msg?.trim() || '查询轻舟代码任务失败')
  }

  return (payload.data?.tasks ?? []).map((task) =>
    normalizeCodeTask(task, workItemId)
  )
}

/**
 * 查询工作项下的代码任务。
 * 如果未登录，打开内嵌浏览器完成飞书 OAuth，然后轮询接口直到成功。
 */
export const getQingzhouCodeTasks = async (
  window: BrowserWindow,
  workItemId: string
): Promise<QingzhouCodeTaskDetail[]> => {
  const normalizedWorkItemId = workItemId.trim()

  if (!/^\d+$/.test(normalizedWorkItemId)) {
    throw new Error('飞书需求 ID 不合法，无法查询轻舟工作项')
  }

  return withBrowserAuth(window, {
    authName: '轻舟',
    // 打开具体需求页面，登录成功后用户能回到原上下文。
    loginUrl: `${QINGZHOU_REQUIREMENT_URL}/${encodeURIComponent(normalizedWorkItemId)}`,
    operation: () => requestCodeTasks(normalizedWorkItemId),
    isAuthError: (error) => error instanceof QingzhouAuthRequiredError
  })
}
