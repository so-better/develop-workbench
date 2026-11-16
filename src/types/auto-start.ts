/**
 * 开机自启状态。
 * 由操作系统登录项维护，应用只负责读取和切换。
 */
export interface AutoStartState {
  /** 当前环境是否支持开机自启。 */
  supported: boolean

  /** 当前是否已启用开机自启。 */
  enabled: boolean

  /** 不支持时的原因说明。 */
  reason?: string
}
