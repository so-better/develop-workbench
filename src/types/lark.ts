/**
 * 当前通过 lark-cli 登录的飞书用户。
 */
export interface LarkUser {
  name: string
  openId: string
  avatarUrl?: string
}

/**
 * lark-cli 路径来源。
 * settings 为用户手动设置，environment 为环境变量，auto 为应用自动探测。
 */
export type LarkCliPathSource = 'settings' | 'environment' | 'auto'

/**
 * lark-cli 可执行文件检测结果。
 */
export interface LarkCliInfo {
  path: string | null
  source: LarkCliPathSource | null
  version: string | null
  available: boolean
}

/**
 * 设备授权登录会话。
 * 二维码以 data URL 返回，device code 不暴露给渲染进程。
 */
export interface LarkLoginSession {
  qrCodeDataUrl: string
  expiresAt: number
}

/**
 * 主进程推送的登录结果。
 */
export type LarkLoginEvent =
  | { status: 'success' }
  | { status: 'error'; message: string }
