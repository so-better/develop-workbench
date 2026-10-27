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

/** 飞书云文档搜索结果。 */
export interface LarkDocSearchResult {
  id: string
  title: string
  url: string
  type: string
  owner: string | null
  updatedAt: string | null
  summary: string | null
}

/** 飞书消息搜索结果。 */
export interface LarkMessageSearchResult {
  id: string
  chatName: string
  senderName: string
  content: string
  createdAt: string | null
  url: string
  appUrl: string | null
}
