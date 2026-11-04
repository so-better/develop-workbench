/**
 * 内嵌浏览器授权流程。
 * 统一处理“打开登录标签 → 轮询授权 → 重试操作 → 关闭登录标签”。
 */
import type { BrowserWindow } from 'electron'
import { delay } from '../utils'
import {
  getActiveEmbeddedBrowserTabId,
  hasEmbeddedBrowserTab,
  closeEmbeddedBrowserTab,
  openEmbeddedBrowser,
} from './embedded-browser'

const DEFAULT_POLL_INTERVAL_MS = 1_500
const DEFAULT_TIMEOUT_MS = 180_000

export interface BrowserAuthOptions<T> {
  /** 授权方名称，用于错误提示，例如“轻舟”“飞书周报”。 */
  authName: string

  /** 打开后用于用户登录的页面。 */
  loginUrl: string

  /** 首次尝试和授权成功后执行的业务操作。 */
  operation: () => Promise<T>

  /**
   * 轻量授权检查。
   * 不传时直接把 operation 作为授权检查并复用其结果。
   */
  probe?: () => Promise<unknown>

  /** 判断一个错误是否表示未登录/授权失效。 */
  isAuthError: (error: unknown) => boolean

  timeoutMs?: number
  pollIntervalMs?: number
}

/**
 * 执行带内嵌浏览器授权的操作。
 * 已授权时不会打开浏览器；未授权时打开登录页并轮询。
 */
export const withBrowserAuth = async <T>(
  window: BrowserWindow,
  options: BrowserAuthOptions<T>
): Promise<T> => {
  const {
    authName,
    loginUrl,
    operation,
    probe,
    isAuthError,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  } = options

  try {
    return await operation()
  } catch (error) {
    if (!isAuthError(error)) throw error
  }

  const opened = openEmbeddedBrowser(window, loginUrl)

  if (!opened) throw new Error(`无法打开${authName}登录页面`)
  const loginTabId = getActiveEmbeddedBrowserTabId(window)
  if (!loginTabId) throw new Error(`无法定位${authName}登录页面`)

  const deadline = Date.now() + timeoutMs

  try {
    while (Date.now() < deadline) {
      await delay(pollIntervalMs)

      if (!hasEmbeddedBrowserTab(window, loginTabId)) {
        throw new Error(`${authName}登录已取消`)
      }

      try {
        if (probe) await probe()

        const result = await operation()
        if (!hasEmbeddedBrowserTab(window, loginTabId)) throw new Error(`${authName}登录已取消`)
        return result
      } catch (error) {
        if (isAuthError(error)) continue
        throw error
      }
    }

    throw new Error(`${authName}登录超时，请重新尝试`)
  } finally {
    // 仅释放本次登录页，保留用户正在查看的其他标签和面板状态。
    closeEmbeddedBrowserTab(window, loginTabId)
  }
}
