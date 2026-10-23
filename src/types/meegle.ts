/**
 * Meegle CLI 路径来源。
 */
export type MeegleCliPathSource = 'settings' | 'environment' | 'auto'

/**
 * Meegle CLI 检测结果。
 */
export interface MeegleCliInfo {
  path: string | null
  source: MeegleCliPathSource | null
  version: string | null
  available: boolean
}

/**
 * Meegle 配置与登录状态。
 */
export interface MeegleState {
  cli: MeegleCliInfo
  host: string | null
  authenticated: boolean
  expiresInMinutes?: number
}

/**
 * 扫码登录会话。
 * device code 仅保留在主进程。
 */
export interface MeegleLoginSession {
  qrCodeDataUrl: string
  expiresAt: number
  userCode: string
}

/**
 * 主进程推送的 Meegle 登录结果。
 */
export type MeegleLoginEvent =
  | { status: 'success' }
  | { status: 'error'; message: string }
