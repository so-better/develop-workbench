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
