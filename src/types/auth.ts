/**
 * 需要授权的本地 CLI。
 */
export type AuthProvider = 'meegle' | 'lark'

/**
 * 主进程推送的授权过期事件。
 */
export interface AuthExpiredEvent {
  provider: AuthProvider
  message: string
}
