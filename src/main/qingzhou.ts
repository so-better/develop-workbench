/**
 * 轻舟接口客户端。
 * 复用内嵌浏览器的持久化 Session，避免在应用数据中保存 Cookie 或 Token。
 */
import { BrowserWindow, session } from 'electron'
import type { Session } from 'electron'
import {
  BROWSER_PARTITION,
  isEmbeddedBrowserVisible,
  openEmbeddedBrowser,
  requestEmbeddedBrowserClose
} from './embedded-browser'

const CODE_TASKS_URL =
  'https://z.xlbsoft.com/api/efficiency/api/v1/workitem/requirement/code-tasks'
const QINGZHOU_REQUIREMENT_URL = 'https://z.xlbsoft.com/workList/requirement'
const AUTH_POLL_INTERVAL_MS = 1_500
const AUTH_TIMEOUT_MS = 180_000
const AUTH_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60

interface CodeTaskBranchInfo {
  branchName?: string
  iterationBranchName?: string
  iterationCode?: string
  repositoryUrl?: string
  iterationBranches?: Array<{
    iterationBranchName?: string
  }>
}

interface CodeTask {
  id?: string
  workItemId?: string
  workItemTitle?: string
  codeRepository?: string
  isArchived?: boolean
  forceArchived?: boolean
  branchInfo?: CodeTaskBranchInfo | null
}

interface CodeTasksResponse {
  code?: number
  msg?: string
  data?: {
    tasks?: CodeTask[]
    total?: number
  } | null
}

export interface QingzhouCodeTaskDetail {
  codeTaskId: string | null
  workItemId: string
  workItemTitle: string | null
  repositoryName: string | null
  repositoryUrl: string | null
  requirementBranch: string | null
  iterationBranch: string | null
  iterationCode: string | null
  archived: boolean
}

/** 仅用于内部控制登录跳转，不向渲染层暴露。 */
class QingzhouAuthRequiredError extends Error {}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

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

  return {
    codeTaskId: task.id?.trim() || null,
    workItemId: task.workItemId?.trim() || fallbackWorkItemId,
    workItemTitle: task.workItemTitle?.trim() || null,
    repositoryName: task.codeRepository?.trim() || null,
    repositoryUrl: branchInfo?.repositoryUrl?.trim() || null,
    requirementBranch: branchInfo?.branchName?.trim() || null,
    iterationBranch,
    iterationCode: branchInfo?.iterationCode?.trim() || null,
    archived: Boolean(task.isArchived || task.forceArchived)
  }
}

/**
 * 轻舟登录会把 token 写在会话 Cookie 里，应用重启后会被 Chromium 丢弃。
 * 登录成功后将 xlbsoft.com 下的会话 Cookie 转成 30 天持久化 Cookie。
 */
const persistQingzhouCookies = async (browserSession: Session): Promise<void> => {
  const cookies = await browserSession.cookies.get({ domain: 'xlbsoft.com' })
  const expirationDate = Math.floor(Date.now() / 1000) + AUTH_COOKIE_TTL_SECONDS

  for (const cookie of cookies) {
    if (cookie.expirationDate || !cookie.domain) continue

    try {
      await browserSession.cookies.set({
        url: `https://${cookie.domain.replace(/^\./, '')}${cookie.path || '/'}`,
        name: cookie.name,
        value: cookie.value,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate
      })
    } catch {
      // 单个 Cookie 写入失败不影响当前请求。
    }
  }
}

/**
 * 通过 workItemId 查询代码任务。
 * 非 JSON 响应或 401/403 都按未登录处理，交给内嵌浏览器完成 OAuth。
 */
const requestCodeTasks = async (workItemId: string): Promise<QingzhouCodeTaskDetail[]> => {
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

  await persistQingzhouCookies(browserSession)

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

  // 已登录时直接返回，正常流程不会打开浏览器面板。
  try {
    return await requestCodeTasks(normalizedWorkItemId)
  } catch (error) {
    if (!(error instanceof QingzhouAuthRequiredError)) throw error
  }

  // 打开具体需求页面，登录成功后用户能回到原上下文。
  const opened = openEmbeddedBrowser(
    window,
    `${QINGZHOU_REQUIREMENT_URL}/${encodeURIComponent(normalizedWorkItemId)}`
  )

  if (!opened) throw new Error('无法打开轻舟登录页面')

  const deadline = Date.now() + AUTH_TIMEOUT_MS

  try {
    // 不解析登录页 DOM，直接轮询接口；接口成功才是真正的登录完成。
    while (Date.now() < deadline) {
      await delay(AUTH_POLL_INTERVAL_MS)

      if (!isEmbeddedBrowserVisible(window)) {
        throw new Error('轻舟登录已取消')
      }

      try {
        return await requestCodeTasks(normalizedWorkItemId)
      } catch (error) {
        if (error instanceof QingzhouAuthRequiredError) continue
        throw error
      }
    }

    throw new Error('轻舟登录超时，请重新尝试')
  } finally {
    requestEmbeddedBrowserClose(window)
  }
}
