/**
 * 内嵌浏览器授权流程。
 * 统一处理“打开登录标签 → 轮询授权 → 重试操作 → 关闭登录标签”。
 */
import type { BrowserWindow } from 'electron'
import { delay, tryNormalizeHttpUrl } from '../utils'
import {
  hasEmbeddedBrowserTab,
  closeEmbeddedBrowserTab,
  openEmbeddedBrowserForAuth
} from './embedded-browser'

const DEFAULT_POLL_INTERVAL_MS = 1_500
const DEFAULT_TIMEOUT_MS = 180_000

interface AuthTabLease {
  users: number
  owned: boolean
}

// 按真实标签而非入口 URL 计数，重定向别名命中同一页时也能共享生命周期。
const authTabLeases = new WeakMap<BrowserWindow, Map<string, AuthTabLease>>()
/** 授权入口到在用标签的映射，在打开页面之前查询，避免重置正在进行的登录。 */
const authEntryTabs = new WeakMap<BrowserWindow, Map<string, string>>()

/** 获取与释放均同步完成，避免并发授权在登记使用者之前关闭共享标签。 */
const acquireAuthTab = (window: BrowserWindow, url: string): { tabId: string; release: () => void } | null => {
  const normalizedUrl = tryNormalizeHttpUrl(url)
  if (!normalizedUrl || window.isDestroyed()) return null
  let entryTabs = authEntryTabs.get(window)
  if (!entryTabs) {
    entryTabs = new Map()
    authEntryTabs.set(window, entryTabs)
  }
  const sharedId = entryTabs.get(normalizedUrl)
  // 已在授权中的标签直接共享，不导航、不抢占用户正在查看的其他页面。
  const opened = sharedId && hasEmbeddedBrowserTab(window, sharedId)
    ? { tabId: sharedId, created: false }
    : openEmbeddedBrowserForAuth(window, normalizedUrl)
  if (!opened) return null
  entryTabs.set(normalizedUrl, opened.tabId)
  let leases = authTabLeases.get(window)
  if (!leases) {
    leases = new Map()
    authTabLeases.set(window, leases)
  }
  const lease = leases.get(opened.tabId) ?? { users: 0, owned: opened.created }
  lease.users++
  leases.set(opened.tabId, lease)
  let released = false
  return {
    tabId: opened.tabId,
    release: () => {
      if (released) return
      released = true
      lease.users--
      if (lease.users > 0) return
      leases.delete(opened.tabId)
      // 同一标签可能对应多个授权入口，最后一个使用者结束时一并清理。
      for (const [entryUrl, tabId] of entryTabs) {
        if (tabId === opened.tabId) entryTabs.delete(entryUrl)
      }
      if (entryTabs.size === 0) authEntryTabs.delete(window)
      if (leases.size === 0) authTabLeases.delete(window)
      // 用户原有页面始终保留；授权新建页面在最后一个使用者结束后释放。
      if (lease.owned && hasEmbeddedBrowserTab(window, opened.tabId)) {
        closeEmbeddedBrowserTab(window, opened.tabId)
      }
    }
  }
}

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

  const lease = acquireAuthTab(window, loginUrl)
  if (!lease) throw new Error(`无法打开${authName}登录页面`)
  const loginTabId = lease.tabId

  const deadline = Date.now() + timeoutMs

  try {
    while (Date.now() < deadline) {
      await delay(pollIntervalMs)

      if (!hasEmbeddedBrowserTab(window, loginTabId)) {
        throw new Error(`${authName}登录已取消`)
      }

      try {
        if (probe) await probe()

        // 授权探测期间可能关闭标签，在真正执行业务操作前再检查一次。
        if (!hasEmbeddedBrowserTab(window, loginTabId)) throw new Error(`${authName}登录已取消`)

        const result = await operation()
        // 操作可能已产生提交等副作用；成功结果不能因标签随后关闭而变成失败。
        return result
      } catch (error) {
        if (isAuthError(error)) continue
        throw error
      }
    }

    throw new Error(`${authName}登录超时，请重新尝试`)
  } finally {
    // 并发流程各自释放使用权，不提前关闭其他流程仍在使用的登录页。
    lease.release()
  }
}
