/**
 * CLI 授权过期事件。
 * Meegle/Lark 业务命令统一在主进程识别授权失效，并通知渲染进程。
 */
import { BrowserWindow } from 'electron'
import type { AuthExpiredEvent, AuthProvider } from '../types/auth'

const AUTH_EXPIRED_PATTERNS = [
  /\bnot\s+(?:logged\s+in|authenticated)\b/i,
  /\bnot_authenticated\b/i,
  /\bunauthenticated\b/i,
  /\bunauthorized\b/i,
  /\bneed[_ -]?login\b/i,
  /\blogin[_ -]?(?:required|expired)\b/i,
  /\b(?:access\s+)?token\s+(?:has\s+)?expired\b/i,
  /\b(?:expired|invalid)\s+(?:access\s+)?token\b/i,
  /\btoken[_ -]?expired\b/i,
  /\bplease\s+(?:log\s?in|sign\s+in|authenticate)\b/i,
  /\bsession\s+(?:expired|invalid)\b/i,
  /\bauthentication\s+(?:required|failed|expired)\b/i,
  /\bauthorization\s+(?:required|expired)\b/i,
  /\bhttp(?:\/\d(?:\.\d)?)?\s+401\b/i,
  /\bstatus(?:_?code)?["'\s:=]+401\b/i,
  /\b401\s+unauthorized\b/i,
  /登录(?:已)?过期/,
  /登陆(?:已)?过期/,
  /未登录/,
  /未登陆/,
  /请先登录/,
  /授权(?:已)?过期/,
  /登录(?:失效|状态失效)/,
  /身份(?:认证|验证)失败/,
  /凭证(?:已)?过期/
]

const AUTH_EXPIRED_MESSAGES: Record<AuthProvider, string> = {
  meegle: 'Meegle Cli 授权已过期，请重新授权',
  lark: 'Lark Cli 授权已过期，请重新授权'
}

const BROADCAST_COOLDOWN_MS = 10_000
const lastBroadcastAt: Partial<Record<AuthProvider, number>> = {}

/**
 * 判断命令输出是否明确表示授权失效。
 * 只匹配认证类错误，避免把普通权限不足误判为过期。
 */
export const isAuthExpiredError = (text: string): boolean => {
  if (!text.trim()) return false

  return AUTH_EXPIRED_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * 广播授权过期事件。
 * 同一 CLI 在冷却时间内只通知一次，避免并发请求重复弹提示。
 */
export const broadcastAuthExpired = (provider: AuthProvider): void => {
  const now = Date.now()

  if (now - (lastBroadcastAt[provider] ?? 0) < BROADCAST_COOLDOWN_MS) return

  lastBroadcastAt[provider] = now

  const event: AuthExpiredEvent = {
    provider,
    message: AUTH_EXPIRED_MESSAGES[provider]
  }

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:expired', event)
  }
}
