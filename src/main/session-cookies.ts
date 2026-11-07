/**
 * 会话 Cookie 持久化。
 * Chromium 退出时会丢弃没有过期时间的 session cookie，
 * 把指定站点域下的会话 Cookie 改写为带过期时间的持久 Cookie。
 */
import type { Cookie, Session } from 'electron'

/** 默认将登录态保留 30 天。 */
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * 判断 Cookie 域名是否属于目标站点或其子域名。
 * 使用带点的后缀匹配，避免把 evilaliyun.com 当成 aliyun.com。
 */
export const matchesCookieDomain = (
  cookieDomain: string | undefined,
  domains: string[]
): boolean => {
  if (!cookieDomain) return false

  const host = cookieDomain.replace(/^\./, '')

  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/**
 * 将单个没有过期时间的会话 Cookie 改写为持久 Cookie。
 * 写入失败时忽略，避免影响其余登录态保持。
 */
export const persistSessionCookie = async (
  target: Session,
  cookie: Cookie,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> => {
  if (cookie.expirationDate || !cookie.domain) return

  const path = cookie.path || '/'

  try {
    await target.cookies.set({
      url: `https://${cookie.domain.replace(/^\./, '')}${path}`,
      name: cookie.name,
      value: cookie.value,
      ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
      path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: Math.floor(Date.now() / 1000) + ttlSeconds
    })
  } catch {
    // 单个 Cookie 写入失败不影响当前请求。
  }
}

/**
 * 将指定站点域下所有会话 Cookie 转换为持久 Cookie。
 * 仅查询目标域名下的 session cookie，避免遍历整个 Cookie 存储。
 */
export const persistSessionCookies = async (
  target: Session,
  domains: string[],
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<void> => {
  for (const domain of domains) {
    let cookies: Cookie[]

    try {
      cookies = await target.cookies.get({ domain, session: true })
    } catch {
      continue
    }

    for (const cookie of cookies) {
      await persistSessionCookie(target, cookie, ttlSeconds)
    }
  }
}
